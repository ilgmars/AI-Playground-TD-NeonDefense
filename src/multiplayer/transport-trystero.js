// Trystero adapter — browser-only. Lazy-loads the Trystero library
// (BitTorrent-tracker strategy by default; Nostr fallback) on first
// joinRoom() call so the static page stays small for the 99 % of
// visitors who never open multiplayer.
//
// Exposes the same {send, onMessage, leave} surface as the MockPeer in
// transport.js so race.js / coop / versus controllers are transport-
// agnostic.
//
// Loaded only after the user opens the multiplayer overlay. No
// top-level network requests at page load.
//
// History: an earlier revision had no timeout on the CDN load or
// progress callback. When the player's network blocked esm.sh, the
// lobby would hang on "Connecting…" with no diagnostics. This version
// surfaces every step through opts.onStatus and refuses to wait
// forever (CDN_LOAD_TIMEOUT_MS).

(function () {
    'use strict';

    // Pinned to a specific Trystero version. Bumping requires a smoke
    // test that the API surface (joinRoom, makeAction) still matches.
    const TRYSTERO_URL = 'https://esm.sh/trystero@0.21.5/torrent';
    const TRYSTERO_FALLBACK_URL = 'https://cdn.jsdelivr.net/npm/trystero@0.21.5/+esm';
    const CDN_LOAD_TIMEOUT_MS = 15000;

    let _trysteroPromise = null;

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

    function loadTrystero(onStatus) {
        if (_trysteroPromise) return _trysteroPromise;
        const status = typeof onStatus === 'function' ? onStatus : () => {};
        _trysteroPromise = (async () => {
            const tried = [];
            for (const url of [TRYSTERO_URL, TRYSTERO_FALLBACK_URL]) {
                status({ kind: 'cdn-load', url });
                try {
                    const mod = await withTimeout(
                        import(/* @vite-ignore */ url),
                        CDN_LOAD_TIMEOUT_MS,
                        'CDN load timed out (15s): ' + url
                    );
                    if (mod && typeof mod.joinRoom === 'function') {
                        status({ kind: 'cdn-ok', url });
                        return mod;
                    }
                    tried.push(url + ' (no joinRoom export)');
                } catch (e) {
                    tried.push(url + ' (' + (e && e.message ? e.message : e) + ')');
                    status({ kind: 'cdn-fail', url, error: e && e.message || String(e) });
                }
            }
            // Reset so a retry from the lobby can try again — otherwise
            // the cached failed promise would lock the player out.
            _trysteroPromise = null;
            throw new Error('Trystero CDN load failed. Tried: ' + tried.join('; '));
        })();
        return _trysteroPromise;
    }

    const APP_ID = 'neon-defense';

    async function joinRoom(roomCode, peerId, opts) {
        opts = opts || {};
        const status = typeof opts.onStatus === 'function' ? opts.onStatus : () => {};

        const t = await loadTrystero(status);
        status({ kind: 'joining', room: roomCode });
        // Trystero's joinRoom is synchronous — returns the room handle
        // immediately and connects in the background. We surface tracker
        // / peer events via the callback so the lobby can show progress.
        let room;
        try {
            room = t.joinRoom({ appId: APP_ID }, String(roomCode));
        } catch (e) {
            status({ kind: 'join-fail', error: e && e.message || String(e) });
            throw e;
        }
        status({ kind: 'joined', room: roomCode });

        // makeAction returns [send, receive] for a named sub-channel.
        const [sendMP, recvMP] = room.makeAction('mp');

        const listeners = [];
        recvMP((msg, peer) => {
            if (!msg || typeof msg !== 'object') return;
            for (const fn of listeners) {
                try { fn(msg, peer); } catch (_) { /* swallow */ }
            }
        });

        // Surface peer join/leave events to the UI so a long wait can
        // show "still waiting for a friend".
        let _peerCount = 0;
        try {
            room.onPeerJoin((id) => {
                _peerCount += 1;
                status({ kind: 'peer-join', id, peerCount: _peerCount });
            });
            room.onPeerLeave((id) => {
                _peerCount = Math.max(0, _peerCount - 1);
                status({ kind: 'peer-leave', id, peerCount: _peerCount });
            });
        } catch (_) { /* Trystero shouldn't throw here, but be safe */ }

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
            peerCount() {
                try { return Object.keys(room.getPeers()).length; }
                catch (_) { return _peerCount; }
            },
            // External onPeerJoin / onPeerLeave so the lobby can subscribe
            // to its OWN handler without stealing the adapter's count
            // tracker. Multiple handlers stack.
            onPeerJoin(fn) {
                try { room.onPeerJoin((id) => fn({ id })); } catch (_) {}
            },
            onPeerLeave(fn) {
                try { room.onPeerLeave((id) => fn({ id })); } catch (_) {}
            },
        };
    }

    const api = { loadTrystero, joinRoom, APP_ID, TRYSTERO_URL, CDN_LOAD_TIMEOUT_MS };
    if (typeof window !== 'undefined') {
        window.NeonMP = Object.assign(window.NeonMP || {}, { trystero: api });
    }
})();
