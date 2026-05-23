// Trystero adapter — browser-only. Lazy-loads the Trystero library
// (BitTorrent-tracker strategy by default; falls back to Nostr if
// trackers fail) on first joinRoom() call so the static page stays
// small for the 99 % of visitors who never open multiplayer.
//
// Exposes the same {send, onMessage, leave} surface as the MockPeer in
// transport.js so race.js / coop / versus controllers are transport-
// agnostic.
//
// Loaded only after the user opens the multiplayer overlay. No
// top-level network requests at page load.

(function () {
    'use strict';

    // Pinned to a specific Trystero version. Bumping requires a smoke
    // test that the API surface (joinRoom, getPeers, .send/.recv) still
    // matches the adapter below. Using the ESM build from a CDN that
    // serves the package's package.json "exports" field. esm.sh proxies
    // the unpkg/jsdelivr file, so if one CDN is blocked the other can
    // be swapped here without touching the rest of the code.
    const TRYSTERO_URL = 'https://esm.sh/trystero@0.21.5/torrent';
    const TRYSTERO_FALLBACK_URL = 'https://cdn.jsdelivr.net/npm/trystero@0.21.5/+esm';

    let _trysteroPromise = null;
    function loadTrystero() {
        if (_trysteroPromise) return _trysteroPromise;
        _trysteroPromise = (async () => {
            const tried = [];
            for (const url of [TRYSTERO_URL, TRYSTERO_FALLBACK_URL]) {
                try {
                    // Dynamic import; will succeed once the CDN responds.
                    // The wider `await import(url)` is needed because
                    // ESM modules can't be `require()`d.
                    const mod = await import(/* @vite-ignore */ url);
                    if (mod && typeof mod.joinRoom === 'function') return mod;
                    tried.push(url + ' (no joinRoom)');
                } catch (e) {
                    tried.push(url + ' (' + (e && e.message ? e.message : e) + ')');
                }
            }
            throw new Error('Trystero CDN load failed: ' + tried.join('; '));
        })();
        return _trysteroPromise;
    }

    // Joins a Trystero room and returns a TrysteroPeer that exposes the
    // same surface as the mock transport: {id, send, onMessage, leave}.
    // The 'appId' is the Trystero room namespace — Trystero recommends a
    // domain-like string so different apps using the same tracker don't
    // collide. We hard-code our own.
    const APP_ID = 'neon-defense';

    async function joinRoom(roomCode, peerId) {
        const t = await loadTrystero();
        const room = t.joinRoom({ appId: APP_ID }, String(roomCode));
        // Trystero's send-action API: makeAction returns [send, receive].
        const [sendMP, recvMP] = room.makeAction('mp');

        const listeners = [];
        recvMP((msg, peer) => {
            // Defensive: only deliver plain objects. Anything else
            // (binary blobs, ArrayBuffers) is ignored — our wire format
            // is pure JSON.
            if (!msg || typeof msg !== 'object') return;
            for (const fn of listeners) {
                try { fn(msg, peer); } catch (_) { /* swallow */ }
            }
        });

        let left = false;
        return {
            id: String(peerId || 'me'),
            send(msg) {
                if (left) return;
                try { sendMP(msg); } catch (_) { /* swallow */ }
            },
            onMessage(fn) {
                listeners.push(fn);
                return () => {
                    const i = listeners.indexOf(fn);
                    if (i >= 0) listeners.splice(i, 1);
                };
            },
            leave() {
                if (left) return;
                left = true;
                listeners.length = 0;
                try { room.leave(); } catch (_) { /* swallow */ }
            },
            // Expose peer count for the UI (so the lobby can show
            // "Waiting for friends" vs "2 connected").
            peerCount() {
                try { return Object.keys(room.getPeers()).length; }
                catch (_) { return 0; }
            },
            // Trystero-specific extras the UI can use to surface state.
            onPeerJoin(fn) {
                try { room.onPeerJoin((id) => fn({ id })); } catch (_) {}
            },
            onPeerLeave(fn) {
                try { room.onPeerLeave((id) => fn({ id })); } catch (_) {}
            },
        };
    }

    const api = { loadTrystero, joinRoom, APP_ID, TRYSTERO_URL };
    if (typeof window !== 'undefined') {
        window.NeonMP = Object.assign(window.NeonMP || {}, { trystero: api });
    }
})();
