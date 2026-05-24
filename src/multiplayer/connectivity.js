// Connectivity probe — diagnoses why multiplayer might not be working.
//
// Real-world failure modes the lobby would otherwise just show as
// "stuck waiting":
//   1. CDN load fails (corporate proxy blocks esm.sh / jsdelivr).
//   2. CDN loads, but every WebTorrent tracker WebSocket is blocked
//      (firewall, ISP filtering, expired tracker cert).
//   3. WebRTC is unavailable (browser policy, incognito flags).
//   4. WebRTC works but every STUN server is unreachable, so peers
//      can't find each other's public address (symmetric NAT, blocked
//      UDP).
//   5. The player is testing alone — nothing's broken, there's just
//      no peer in the room.
//
// probe() returns a structured report so the lobby can show specific
// remedies instead of a spinner. Each check has its own timeout so a
// hung sub-test can't freeze the report.

(function () {
    'use strict';

    const CDN_URLS = [
        'https://esm.sh/trystero@0.21.5/mqtt',
        'https://cdn.jsdelivr.net/npm/trystero@0.21.5/+esm',
    ];

    // Public MQTT brokers Trystero rotates through for signalling.
    // Switched here in 2026 because most WebTorrent trackers had gone
    // stale (cert errors / 404s) — MQTT is operationally healthier.
    // Baked-in list matches trystero@0.21.5/es2022/mqtt.mjs.
    const TRACKER_URLS = [
        'wss://broker.hivemq.com:8884/mqtt',
        'wss://broker.emqx.io:8084/mqtt',
        'wss://test.mosquitto.org:8081/mqtt',
    ];

    const STUN_URL = 'stun:stun.l.google.com:19302';
    const STEP_TIMEOUT_MS = 6000;

    // Wraps any promise with a hard timeout so a hung handshake doesn't
    // stall the whole probe. The wrapper RESOLVES with a timeout error
    // rather than rejecting, so Promise.all-style consumers don't lose
    // the partial results.
    function withTimeout(p, ms, label) {
        return new Promise((resolve) => {
            let done = false;
            const t = setTimeout(() => {
                if (!done) { done = true; resolve({ ok: false, reason: 'timeout', label, ms }); }
            }, ms);
            Promise.resolve(p).then(
                (v) => { if (!done) { done = true; clearTimeout(t); resolve(v); } },
                (e) => { if (!done) { done = true; clearTimeout(t); resolve({ ok: false, reason: String(e && e.message || e), label }); } }
            );
        });
    }

    // HEAD-ish probe via `fetch` — falls back to GET if HEAD is denied.
    // We don't actually parse the response; the goal is "did the network
    // reach the host within the timeout".
    async function probeCDN(url) {
        const t0 = (typeof performance !== 'undefined') ? performance.now() : Date.now();
        try {
            // fetch with method:HEAD often returns 405; GET with a tiny
            // accept budget is more reliable across CDNs. We don't read
            // the body — abort early once headers arrive.
            const controller = new AbortController();
            const res = await fetch(url, { method: 'GET', mode: 'cors', signal: controller.signal, cache: 'no-store' });
            const ms = Math.round(((typeof performance !== 'undefined') ? performance.now() : Date.now()) - t0);
            if (!res.ok) return { ok: false, url, status: res.status, ms };
            // Cancel the body stream to free the socket — we already
            // got what we wanted (headers / status).
            controller.abort();
            return { ok: true, url, status: res.status, ms };
        } catch (e) {
            const ms = Math.round(((typeof performance !== 'undefined') ? performance.now() : Date.now()) - t0);
            return { ok: false, url, reason: String(e && e.message || e), ms };
        }
    }

    function probeTracker(url) {
        return new Promise((resolve) => {
            const t0 = (typeof performance !== 'undefined') ? performance.now() : Date.now();
            let ws;
            let done = false;
            const finish = (ok, reason) => {
                if (done) return;
                done = true;
                const ms = Math.round(((typeof performance !== 'undefined') ? performance.now() : Date.now()) - t0);
                if (ws && ws.readyState !== 3 /* CLOSED */) {
                    try { ws.close(); } catch (_) {}
                }
                resolve({ ok, url, reason, ms });
            };
            try {
                ws = new WebSocket(url);
                ws.onopen  = () => finish(true);
                ws.onerror = () => finish(false, 'ws-error');
                ws.onclose = (e) => {
                    if (!done) finish(false, 'closed:' + (e && e.code || '?'));
                };
            } catch (e) {
                finish(false, String(e && e.message || e));
            }
        });
    }

    // WebRTC + STUN sanity check. Creates a transient RTCPeerConnection
    // with one STUN server and waits for ICE gathering to surface at
    // least one host candidate. A srflx candidate (server-reflexive)
    // means STUN actually answered — that's the strongest signal.
    function probeWebRTC() {
        return new Promise((resolve) => {
            const t0 = (typeof performance !== 'undefined') ? performance.now() : Date.now();
            if (typeof RTCPeerConnection === 'undefined') {
                resolve({ ok: false, reason: 'no-rtc' });
                return;
            }
            let pc;
            let done = false;
            const hostCands = [];
            const srflxCands = [];
            const finish = (ok, reason) => {
                if (done) return;
                done = true;
                const ms = Math.round(((typeof performance !== 'undefined') ? performance.now() : Date.now()) - t0);
                if (pc) { try { pc.close(); } catch (_) {} }
                resolve({
                    ok, reason, ms,
                    hostCandidates: hostCands.length,
                    srflxCandidates: srflxCands.length,
                    stunWorks: srflxCands.length > 0,
                });
            };
            try {
                pc = new RTCPeerConnection({ iceServers: [{ urls: STUN_URL }] });
                // Need a media section or data channel to start ICE.
                pc.createDataChannel('probe');
                pc.onicecandidate = (e) => {
                    if (!e.candidate) {
                        // Gathering finished. Resolve with what we got.
                        finish(hostCands.length > 0, hostCands.length > 0 ? null : 'no-host-candidates');
                        return;
                    }
                    const c = e.candidate.candidate || '';
                    if (/typ host/.test(c)) hostCands.push(c);
                    else if (/typ srflx/.test(c)) srflxCands.push(c);
                };
                pc.createOffer()
                    .then(o => pc.setLocalDescription(o))
                    .catch(err => finish(false, 'offer:' + (err && err.message || err)));
            } catch (e) {
                finish(false, String(e && e.message || e));
            }
        });
    }

    // Full probe — runs every sub-check in parallel with per-check
    // timeouts so the worst sub-test bounds the whole probe to
    // ~STEP_TIMEOUT_MS, not Σ(timeouts).
    async function probe(opts) {
        opts = opts || {};
        const timeoutMs = opts.timeoutMs || STEP_TIMEOUT_MS;
        const cdnProbes = CDN_URLS.map(u => withTimeout(probeCDN(u), timeoutMs, 'cdn:' + u));
        const trackerProbes = TRACKER_URLS.map(u => withTimeout(probeTracker(u), timeoutMs, 'tracker:' + u));
        const rtcProbe = withTimeout(probeWebRTC(), timeoutMs, 'webrtc');

        const [cdnResults, trackerResults, rtcResult] = await Promise.all([
            Promise.all(cdnProbes),
            Promise.all(trackerProbes),
            rtcProbe,
        ]);

        const cdnOK     = cdnResults.some(r => r.ok);
        const trackerOK = trackerResults.filter(r => r.ok).length;
        const rtcOK     = rtcResult.ok;
        // Verdict: enough infra to play if at least one CDN works,
        // at least one tracker is reachable, and WebRTC is alive.
        // STUN failure is concerning but not fatal — host-only ICE
        // candidates still work for local-network peers.
        const verdict = cdnOK && trackerOK >= 1 && rtcOK
            ? 'ok'
            : !cdnOK
                ? 'cdn-blocked'
                : trackerOK === 0
                    ? 'trackers-blocked'
                    : !rtcOK
                        ? 'no-webrtc'
                        : 'unknown';

        return {
            verdict,
            cdn:     { results: cdnResults,     anyOk: cdnOK },
            tracker: { results: trackerResults, okCount: trackerOK, total: trackerResults.length },
            webrtc:  rtcResult,
            timestamp: Date.now(),
        };
    }

    // Human-readable summary for the lobby UI. One-line per failure
    // category, with the specific tracker / CDN that failed quoted so
    // a player on a managed network can show it to IT.
    function summarise(report) {
        const lines = [];
        if (report.verdict === 'ok') {
            lines.push('✓ Connection looks good.');
            lines.push('Trackers reachable: ' + report.tracker.okCount + '/' + report.tracker.total + '.');
            if (report.webrtc.stunWorks) lines.push('STUN ok — peers should reach you across the internet.');
            else if (report.webrtc.hostCandidates > 0) lines.push('STUN unreachable but local-network play should work.');
            return lines.join('\n');
        }
        if (!report.cdn.anyOk) {
            lines.push('✗ Cannot reach CDN — Trystero library blocked.');
            for (const c of report.cdn.results) {
                if (!c.ok) lines.push('  ' + c.url + ' → ' + (c.reason || c.status || 'fail'));
            }
        }
        if (report.tracker.okCount === 0) {
            lines.push('✗ All ' + report.tracker.total + ' MQTT signalling brokers unreachable.');
            for (const t of report.tracker.results) {
                if (!t.ok) lines.push('  ' + t.url + ' → ' + (t.reason || 'fail'));
            }
        }
        if (!report.webrtc.ok) {
            lines.push('✗ WebRTC unavailable: ' + (report.webrtc.reason || 'unknown'));
        }
        return lines.join('\n');
    }

    const api = {
        probe, summarise,
        probeCDN, probeTracker, probeWebRTC,
        CDN_URLS, TRACKER_URLS, STUN_URL,
        _withTimeout: withTimeout,
    };
    if (typeof window !== 'undefined') {
        window.NeonMP = Object.assign(window.NeonMP || {}, { connectivity: api });
    }
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();
