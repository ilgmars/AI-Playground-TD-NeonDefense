// PeerGuard — per-peer cheat-resistant gate that every inbound frame
// passes through before it reaches the action dispatcher.
//
// Trust model (see multiplayer/anti-cheat.md):
//   • A peer may lie about the simulation it ran, but the LOCAL sim
//     is the only source of truth here. Peer inputs are an untrusted
//     input device; they must replay a legitimate UI gesture.
//   • Aegis still owns money/HP audits — guard.js is the wire layer.
//
// What this layer adds on top of protocol.validateFrame:
//   1. Per-peer monotonic frame numbers — no time-travel / replay of
//      old frames.
//   2. Per-{peer, frame} dedupe — a re-broadcast frame is dropped on
//      the second copy.
//   3. Per-second token-bucket throttle (DoS).
//   4. Per-frame input cap and per-kind sub-caps (a single frame
//      can't contain 200 'boon' picks).
//   5. Optional HMAC over the frame body using a room-derived secret,
//      so a stranger who lands in the same Trystero room cannot
//      successfully impersonate a peer that joined with the code.
//
// All checks are local — no cross-peer coordination needed.

(function () {
    'use strict';

    const protocol = (typeof require === 'function')
        ? require('./protocol.js')
        : (typeof window !== 'undefined' && window.NeonMP && window.NeonMP.protocol);

    // Sub-caps: actions a single frame can legitimately contain. A frame
    // is 1 simulation tick (~16ms); a human can't push more than 1-2
    // gestures inside that. Build/upgrade/sell coverage 4 leaves room
    // for fast-typing hotkey chords.
    const DEFAULT_PER_FRAME_CAPS = {
        build:   4,
        upgrade: 4,
        sell:    4,
        potion:  1,
        boon:    1,
        ability: 2,
    };

    // Frames older than this (vs the highest seen) are rejected as
    // replays. Lockstep tolerates short reorder windows for late
    // arrivals; anything beyond is a sign of replay attack.
    const DEFAULT_REORDER_WINDOW = 30;

    function createGuard(opts) {
        opts = opts || {};
        const allowBuildTypes = opts.allowBuildTypes;
        const perFrameCaps = Object.assign({}, DEFAULT_PER_FRAME_CAPS, opts.perFrameCaps || {});
        const reorderWindow = opts.reorderWindow != null ? opts.reorderWindow : DEFAULT_REORDER_WINDOW;
        const throttle = protocol.createThrottle(opts.perSec, opts.now);
        const secret = opts.secret || null; // room-derived HMAC key
        const onReject = typeof opts.onReject === 'function' ? opts.onReject : null;

        // Per-peer state: highest frame seen + set of seen frame numbers
        // inside the reorder window (so we can detect dupes).
        const peerState = new Map();

        function reject(peer, reason, extra) {
            if (onReject) {
                try { onReject({ peer, reason, extra }); } catch (e) { /* swallow */ }
            }
            return { ok: false, reason, extra };
        }

        function checkSignature(frame) {
            if (!secret) return true;
            if (typeof frame.sig !== 'string') return false;
            const body = canonicalise(frame);
            return frame.sig === sign(body, secret);
        }

        function check(frame) {
            const peer = frame && frame.p;
            if (typeof peer !== 'string' || peer.length === 0) return reject(peer, 'bad-peer');

            // Signature first — if a forged frame arrives at all, we
            // want it dropped without touching peerState.
            if (secret && !checkSignature(frame)) return reject(peer, 'bad-sig');

            const v = protocol.validateFrame(frame, allowBuildTypes);
            if (!v.ok) return reject(peer, 'schema:' + v.reason);
            const f = v.frame;

            // Per-frame kind caps.
            const counts = {};
            for (const inp of f.i) {
                counts[inp.k] = (counts[inp.k] || 0) + 1;
                const cap = perFrameCaps[inp.k];
                if (cap != null && counts[inp.k] > cap) {
                    return reject(peer, 'cap:' + inp.k);
                }
            }

            // Monotonic + dedupe per peer.
            let s = peerState.get(peer);
            if (!s) { s = { highest: -1, seen: new Set() }; peerState.set(peer, s); }
            if (f.f <= s.highest - reorderWindow) return reject(peer, 'replay-old', { frame: f.f, highest: s.highest });
            const key = f.f;
            if (s.seen.has(key)) return reject(peer, 'duplicate', { frame: f.f });

            // Throttle: each input in the frame consumes one token. A
            // frame with N inputs counts as N actions, so a flooder
            // can't pack thousands of inputs into one envelope.
            const cost = Math.max(1, f.i.length);
            for (let i = 0; i < cost; i++) {
                if (!throttle.accept(peer)) return reject(peer, 'throttled');
            }

            // Commit
            s.seen.add(key);
            if (f.f > s.highest) s.highest = f.f;
            // Garbage-collect the dedupe set so it doesn't grow forever.
            if (s.seen.size > reorderWindow * 4) {
                const cutoff = s.highest - reorderWindow;
                for (const v of s.seen) if (v < cutoff) s.seen.delete(v);
            }
            return { ok: true, frame: f };
        }

        function signFrame(frame) {
            if (!secret) return frame;
            const sig = sign(canonicalise(frame), secret);
            return Object.assign({}, frame, { sig });
        }

        return { check, signFrame, _peerState: peerState };
    }

    // Stable JSON ordering for the signed payload. We do NOT sign `sig`
    // itself, and we do NOT sign `hash` (peers may add it post-validation
    // for desync detection — see sync.md).
    function canonicalise(frame) {
        const inputs = frame.i.map(canonicaliseInput);
        return JSON.stringify({ v: frame.v, p: frame.p, f: frame.f, i: inputs });
    }
    function canonicaliseInput(inp) {
        // Sort keys so re-serialised input doesn't break sig.
        const keys = Object.keys(inp).sort();
        const out = {};
        for (const k of keys) out[k] = inp[k];
        return out;
    }

    // HMAC-ish using FNV-1a. Not cryptographically strong against a
    // motivated attacker — but the threat we're defending against is
    // "stranger lands in the same Trystero room and forges a peer
    // name", not a state-level adversary. The room code is itself low
    // entropy (~30 bits) so a real MAC is overkill. We use a double
    // FNV-1a with secret padding, similar to NeonAegis.sign().
    function sign(body, secret) {
        const a = protocol.fnv1a(secret + ':' + body).toString(36);
        const b = protocol.fnv1a(a + ':' + secret + ':' + body.length).toString(36);
        return a + '.' + b;
    }

    function deriveSecret(roomCode, salt) {
        // The room code is shared; we still derive a per-namespace key
        // so the lobby channel and the gameplay channel have distinct
        // MACs and can't be cross-replayed.
        return protocol.fnv1a((salt || 'mp') + ':' + String(roomCode)).toString(36);
    }

    const api = {
        createGuard,
        deriveSecret,
        DEFAULT_PER_FRAME_CAPS,
        DEFAULT_REORDER_WINDOW,
        _sign: sign,
        _canonicalise: canonicalise,
    };
    if (typeof window !== 'undefined') window.NeonMP = Object.assign(window.NeonMP || {}, { guard: api });
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();
