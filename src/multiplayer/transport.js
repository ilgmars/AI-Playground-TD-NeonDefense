// Transport abstraction. Real builds plug in Trystero (or clipboard
// fallback) and get the same {send, onMessage, leave} surface. Tests
// use MockTransport to wire two peers together synchronously.
//
// The real transports live behind dynamic import — we don't pull
// Trystero into the static bundle until the player actually opens
// the multiplayer lobby.

(function () {
    'use strict';

    // Shared hub keyed by room. Peers in the same room see each other's
    // messages. Mirrors Trystero's `joinRoom(roomId)` API surface.
    function createMockHub() {
        const rooms = new Map(); // roomId -> Set<peer>
        return {
            join(roomId, peerId) {
                let peers = rooms.get(roomId);
                if (!peers) { peers = new Set(); rooms.set(roomId, peers); }
                const peer = new MockPeer(peers, peerId);
                peers.add(peer);
                return peer;
            },
            _rooms: rooms,
        };
    }

    class MockPeer {
        constructor(peers, id) {
            this._peers = peers;
            this.id = id;
            this._listeners = [];
            this._left = false;
        }
        send(msg) {
            if (this._left) return;
            // Serialise → deserialise so receivers get a fresh object,
            // matching real wire behaviour (no shared references).
            const wire = JSON.parse(JSON.stringify({ from: this.id, msg }));
            for (const peer of this._peers) {
                if (peer === this || peer._left) continue;
                for (const fn of peer._listeners) {
                    try { fn(wire.msg, wire.from); } catch (e) { /* swallow */ }
                }
            }
        }
        onMessage(fn) {
            this._listeners.push(fn);
            return () => {
                const i = this._listeners.indexOf(fn);
                if (i >= 0) this._listeners.splice(i, 1);
            };
        }
        leave() {
            this._left = true;
            this._peers.delete(this);
            this._listeners.length = 0;
        }
    }

    const api = { createMockHub, MockPeer };
    if (typeof window !== 'undefined') window.NeonMP = Object.assign(window.NeonMP || {}, { transport: api });
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();
