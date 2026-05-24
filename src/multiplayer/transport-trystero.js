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

    // Top-level join. Strategy order: mqtt → nostr → torrent (last-
    // resort, mostly dead). If the primary strategy loads but no
    // peer connects within FIRST_PEER_MS, we leave it and try the
    // next. The returned adapter then routes ALL future traffic over
    // whichever strategy actually connected.
    async function joinRoom(roomCode, peerId, opts) {
        opts = opts || {};
        const status = typeof opts.onStatus === 'function' ? opts.onStatus : () => {};
        const strategies = Array.isArray(opts.strategies)
            ? opts.strategies
            : ['mqtt', 'nostr'];

        let lastErr = null;
        for (const strategy of strategies) {
            status({ kind: 'try-strategy', strategy });
            let mod;
            try {
                mod = await loadStrategy(strategy, status);
            } catch (e) {
                lastErr = e;
                status({ kind: 'strategy-load-fail', strategy, error: e && e.message || String(e) });
                continue;
            }
            status({ kind: 'joining', room: roomCode, strategy });
            let room;
            try {
                room = mod.joinRoom({ appId: APP_ID }, String(roomCode));
            } catch (e) {
                lastErr = e;
                status({ kind: 'join-fail', strategy, error: e && e.message || String(e) });
                continue;
            }
            status({ kind: 'joined', room: roomCode, strategy });
            return wrapRoom(strategy, room, peerId, status);
        }
        throw new Error('All Trystero strategies failed. Last error: ' +
            (lastErr && lastErr.message || lastErr || 'unknown'));
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
