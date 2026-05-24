// Trystero adapter — browser-only. Lazy-loads the Trystero library
// (MQTT primary, Nostr fallback) on first joinRoom() call so the
// static page stays small for visitors who never open multiplayer.
//
// Exposes the same {send, onMessage, leave} surface as the MockPeer in
// transport.js so race / coop / versus controllers are transport-
// agnostic.
//
// Why MQTT and not BitTorrent: the WebTorrent tracker set bundled with
// Trystero 0.21.5 is mostly dead in 2026 (cert errors, 404s, hung
// WebSocket handshakes). Public MQTT brokers (HiveMQ, EMQX, Mosquitto)
// are operationally healthy and serve the same role — peers exchange
// SDP offers/answers over a pub/sub channel keyed by appId+roomCode,
// then talk directly via WebRTC data channels.
//
// Fallback ladder:
//   1. mqtt   (public brokers — current default)
//   2. nostr  (public relays — kicks in if mqtt fails to load OR if
//              joinRoom doesn't emit a peer-join within FIRST_PEER_MS)
//
// History: an earlier revision had no timeout on the CDN load or
// progress callback. When the player's network blocked esm.sh, the
// lobby would hang on "Connecting…" with no diagnostics. This version
// surfaces every step through opts.onStatus and refuses to wait
// forever (CDN_LOAD_TIMEOUT_MS).

(function () {
    'use strict';

    // Pinned Trystero version. Bumping past 0.25 requires switching to
    // the new @trystero-p2p/* split-package layout — for now 0.21.5
    // remains the last stable monolith.
    const TRYSTERO_VERSION = '0.21.5';

    // Per-strategy CDN URL + fallback (two CDNs in case one is blocked).
    const STRATEGY_URLS = {
        mqtt: [
            `https://esm.sh/trystero@${TRYSTERO_VERSION}/mqtt`,
            `https://cdn.jsdelivr.net/npm/trystero@${TRYSTERO_VERSION}/+esm`,
        ],
        nostr: [
            `https://esm.sh/trystero@${TRYSTERO_VERSION}/nostr`,
        ],
        torrent: [
            `https://esm.sh/trystero@${TRYSTERO_VERSION}/torrent`,
        ],
    };

    // Curated broker / relay lists overriding Trystero's baked-in
    // defaults. The 0.21.5 MQTT default set includes hivemq:8884 which
    // the official broker matrix lists as having NO TLS WebSocket
    // (only plain 8000 — blocked from HTTPS pages by mixed-content).
    // Same MQTT defaults also include mosquitto:8081 which works but
    // we add :443 as a redundant entry.
    //
    // Multiple URLs per strategy = Trystero picks one that responds;
    // peers using the same list converge on the same broker quickly.
    // EMQX MQTT broker. Protocol picked per page scheme:
    //   HTTPS page  → wss://broker.emqx.io:8084/mqtt  (secure WS)
    //   HTTP  page  → ws://broker.emqx.io:8083/mqtt   (plain WS)
    // Browsers BLOCK plain ws:// from https:// pages (mixed content)
    // and BLOCK secure wss:// from http:// origins isn't an issue but
    // wastes the TLS handshake locally. This picks the right one.
    function mqttRelayUrls() {
        const httpOrigin = typeof location !== 'undefined' && location.protocol === 'http:';
        return httpOrigin
            ? ['ws://broker.emqx.io:8083/mqtt']
            : ['wss://broker.emqx.io:8084/mqtt'];
    }
    const STRATEGY_RELAY_URLS = {
        // mqtt's relay list is computed at join time (so we can read
        // location.protocol). See readStrategyRelayUrls below.
        mqtt: 'auto',
        // Nostr left at Trystero defaults — the relay list is large
        // and most are reachable. Override here if specific relays
        // are needed.
        nostr: null,
    };
    function readStrategyRelayUrls(strategy) {
        const v = STRATEGY_RELAY_URLS[strategy];
        if (v === 'auto' && strategy === 'mqtt') return mqttRelayUrls();
        return v;
    }

    const CDN_LOAD_TIMEOUT_MS = 15000;
    const FIRST_PEER_MS       = 12000;  // how long to wait on the
                                        // primary strategy before
                                        // auto-switching to fallback.

    let _cachedModules = {};   // strategy → loaded module (or null)

    function withTimeout(p, ms, reason) {
        return new Promise((resolve, reject) => {
            let done = false;
            const t = setTimeout(() => {
                if (!done) { done = true; reject(new Error(reason || ('timed out after ' + ms + 'ms'))); }
            }, ms);
            Promise.resolve(p).then(
                (v) => { if (!done) { done = true; clearTimeout(t); resolve(v); } },
                (e) => { if (!done) { done = true; clearTimeout(t); reject(e); } }
            );
        });
    }

    async function loadStrategy(strategy, onStatus) {
        if (_cachedModules[strategy]) return _cachedModules[strategy];
        const status = typeof onStatus === 'function' ? onStatus : () => {};
        const urls = STRATEGY_URLS[strategy];
        if (!urls) throw new Error('unknown strategy: ' + strategy);
        const tried = [];
        for (const url of urls) {
            status({ kind: 'cdn-load', url, strategy });
            try {
                const mod = await withTimeout(
                    import(/* @vite-ignore */ url),
                    CDN_LOAD_TIMEOUT_MS,
                    `${strategy} CDN load timed out (15s): ${url}`
                );
                if (mod && typeof mod.joinRoom === 'function') {
                    status({ kind: 'cdn-ok', url, strategy });
                    _cachedModules[strategy] = mod;
                    return mod;
                }
                tried.push(url + ' (no joinRoom export)');
            } catch (e) {
                tried.push(url + ' (' + (e && e.message ? e.message : e) + ')');
                status({ kind: 'cdn-fail', url, strategy, error: e && e.message || String(e) });
            }
        }
        throw new Error(`Trystero ${strategy} CDN load failed: ${tried.join('; ')}`);
    }

    // Back-compat alias for the connectivity probe + tests.
    function loadTrystero(onStatus) {
        return loadStrategy(opts && opts.strategy || 'mqtt', onStatus);
    }

    const APP_ID = 'neon-defense-v1';

    // Read the ICE config built by tools/install-turn-config.sh (which
    // reads .credentials or the NEON_TURN_CONFIG env var). When the
    // bundle exists, Trystero gets TURN + STUN servers via the rtcConfig
    // option; otherwise WebRTC falls back to Trystero's baked-in
    // Google STUN servers only (works for non-symmetric NAT).
    function readIceServers() {
        try {
            const cfg = (typeof window !== 'undefined') && window.__neonTurnConfig;
            if (!cfg || !Array.isArray(cfg.iceServers) || cfg.iceServers.length === 0) return null;
            return cfg.iceServers;
        } catch (_) { return null; }
    }

    // Build the adapter shell around a strategy-specific room handle.
    // Same surface as the mock transport: {id, send, onMessage, leave,
    // peerCount, onPeerJoin, onPeerLeave}.
    //
    // Trystero 0.21.5's room.onPeerJoin / onPeerLeave are SETTERS: each
    // call REPLACES the previous callback. We multiplex by registering
    // ONE underlying handler that fans out to a local listener list,
    // so multiple consumers (race overlay, coop waitroom, status
    // callback) can all subscribe without overwriting each other.
    function wrapRoom(strategy, room, peerId, onStatus) {
        const status = typeof onStatus === 'function' ? onStatus : () => {};
        const [sendMP, recvMP] = room.makeAction('mp');
        const msgListeners  = [];
        const joinListeners = [];
        const leaveListeners = [];
        recvMP((msg, peer) => {
            if (!msg || typeof msg !== 'object') return;
            for (const fn of msgListeners) {
                try { fn(msg, peer); } catch (_) { /* swallow */ }
            }
        });
        let _peerCount = 0;
        try {
            room.onPeerJoin((id) => {
                _peerCount += 1;
                status({ kind: 'peer-join', id, peerCount: _peerCount, strategy });
                for (const fn of joinListeners) {
                    try { fn({ id }); } catch (_) {}
                }
            });
            room.onPeerLeave((id) => {
                _peerCount = Math.max(0, _peerCount - 1);
                status({ kind: 'peer-leave', id, peerCount: _peerCount, strategy });
                for (const fn of leaveListeners) {
                    try { fn({ id }); } catch (_) {}
                }
            });
        } catch (_) { /* defensive */ }
        let left = false;
        return {
            id: String(peerId || 'me'),
            strategy,
            send(msg) {
                if (left) return;
                try { sendMP(msg); } catch (_) { /* swallow */ }
            },
            onMessage(fn) {
                msgListeners.push(fn);
                return () => {
                    const i = msgListeners.indexOf(fn);
                    if (i >= 0) msgListeners.splice(i, 1);
                };
            },
            leave() {
                if (left) return;
                left = true;
                msgListeners.length = 0;
                joinListeners.length = 0;
                leaveListeners.length = 0;
                try { room.leave(); } catch (_) { /* swallow */ }
            },
            peerCount() {
                try { return Object.keys(room.getPeers()).length; }
                catch (_) { return _peerCount; }
            },
            onPeerJoin(fn) {
                if (typeof fn === 'function') joinListeners.push(fn);
            },
            onPeerLeave(fn) {
                if (typeof fn === 'function') leaveListeners.push(fn);
            },
        };
    }

    // Top-level join. Runs MULTIPLE strategies in PARALLEL by default
    // (mqtt + nostr): peers find each other via whichever channel
    // works. Same room code on both. Outgoing messages fan out to all
    // joined rooms; incoming messages fan in to the single onMessage
    // listener list. This is much more robust than the serial fallback
    // since you don't need both peers to pick the same strategy.
    //
    // If opts.strategies is a single string OR an array of length 1,
    // the adapter degrades to the legacy serial-fallback behaviour.
    async function joinRoom(roomCode, peerId, opts) {
        opts = opts || {};
        const status = typeof opts.onStatus === 'function' ? opts.onStatus : () => {};
        const requested = Array.isArray(opts.strategies)
            ? opts.strategies
            : (opts.strategies ? [opts.strategies] : ['mqtt', 'nostr']);

        const iceServers = readIceServers();
        const baseCfg = { appId: APP_ID };
        if (iceServers) {
            baseCfg.rtcConfig = { iceServers };
            status({ kind: 'ice-config', count: iceServers.length });
        }

        // Try each requested strategy in parallel. Resolve the
        // settlement (mix of fulfilled / rejected) and keep every
        // room that joined.
        const attempts = requested.map(async (strategy) => {
            status({ kind: 'try-strategy', strategy });
            const mod = await loadStrategy(strategy, status);
            const cfg = Object.assign({}, baseCfg);
            // Override Trystero's baked-in relay list per strategy if
            // we have a curated set. Critically for mqtt: the 0.21.5
            // defaults include hivemq:8884 which has no TLS WS in 2026
            // (deprecated). Our list keeps only confirmed-working WSS
            // endpoints.
            const relays = readStrategyRelayUrls(strategy);
            if (relays && relays.length) {
                cfg.relayUrls = relays;
                status({ kind: 'relay-urls', strategy, urls: relays });
            }
            const room = mod.joinRoom(cfg, String(roomCode));
            status({ kind: 'joined', room: roomCode, strategy });
            return { strategy, room };
        });
        const settled = await Promise.allSettled(attempts);
        const rooms = [];
        const errors = [];
        for (const r of settled) {
            if (r.status === 'fulfilled') rooms.push(r.value);
            else errors.push(r.reason);
        }
        if (rooms.length === 0) {
            throw new Error('All Trystero strategies failed. Errors: ' +
                errors.map(e => e && e.message || String(e)).join('; '));
        }
        if (rooms.length === 1) {
            // Single-strategy path: avoid the dedupe overhead.
            return wrapRoom(rooms[0].strategy, rooms[0].room, peerId, status);
        }
        return wrapMultiRoom(rooms, peerId, status);
    }

    // Multi-strategy wrapper: fans out sends to every joined room,
    // fans in messages from all rooms (deduped by peer+kind+content
    // hash to avoid double-delivery when peers also have multiple
    // strategies up). Peer-join/leave is union: any strategy
    // surfacing a peer counts; the same peer arriving on a second
    // strategy is ignored.
    function wrapMultiRoom(rooms, peerId, onStatus) {
        const status = typeof onStatus === 'function' ? onStatus : () => {};
        const wrappers = rooms.map(({ strategy, room }) => wrapRoom(strategy, room, peerId, status));
        const msgListeners  = [];
        const joinListeners = [];
        const leaveListeners = [];
        const seenPeers = new Set();
        const recentMsgs = new Map(); // msg-hash → expiry ms

        function hashMsg(msg, from) {
            try { return (from || '?') + '|' + JSON.stringify(msg); }
            catch (_) { return null; }
        }
        function sweepDedupe(now) {
            for (const [k, v] of recentMsgs) if (v < now) recentMsgs.delete(k);
        }
        function onAnyMsg(msg, from) {
            const now = Date.now();
            sweepDedupe(now);
            const h = hashMsg(msg, from);
            if (h) {
                if (recentMsgs.has(h)) return;
                recentMsgs.set(h, now + 3000);   // 3 s dedupe window
            }
            for (const fn of msgListeners) {
                try { fn(msg, from); } catch (_) {}
            }
        }

        // Wire every sub-adapter into the multi-room fan-out.
        for (const w of wrappers) {
            w.onMessage(onAnyMsg);
            w.onPeerJoin(({ id }) => {
                if (seenPeers.has(id)) return;
                seenPeers.add(id);
                status({ kind: 'peer-join', id, strategy: w.strategy });
                for (const fn of joinListeners) {
                    try { fn({ id }); } catch (_) {}
                }
            });
            w.onPeerLeave(({ id }) => {
                if (!seenPeers.has(id)) return;
                seenPeers.delete(id);
                status({ kind: 'peer-leave', id, strategy: w.strategy });
                for (const fn of leaveListeners) {
                    try { fn({ id }); } catch (_) {}
                }
            });
        }

        let left = false;
        return {
            id: String(peerId || 'me'),
            strategy: wrappers.map(w => w.strategy).join('+'),
            send(msg) {
                if (left) return;
                for (const w of wrappers) w.send(msg);
            },
            onMessage(fn) {
                msgListeners.push(fn);
                return () => {
                    const i = msgListeners.indexOf(fn);
                    if (i >= 0) msgListeners.splice(i, 1);
                };
            },
            leave() {
                if (left) return;
                left = true;
                msgListeners.length = 0;
                joinListeners.length = 0;
                leaveListeners.length = 0;
                for (const w of wrappers) {
                    try { w.leave(); } catch (_) {}
                }
            },
            peerCount() { return seenPeers.size; },
            onPeerJoin(fn) {
                if (typeof fn === 'function') joinListeners.push(fn);
            },
            onPeerLeave(fn) {
                if (typeof fn === 'function') leaveListeners.push(fn);
            },
        };
    }

    const api = {
        loadTrystero, loadStrategy, joinRoom,
        APP_ID, TRYSTERO_VERSION,
        STRATEGY_URLS,
        CDN_LOAD_TIMEOUT_MS, FIRST_PEER_MS,
    };
    if (typeof window !== 'undefined') {
        window.NeonMP = Object.assign(window.NeonMP || {}, { trystero: api });
    }
})();
