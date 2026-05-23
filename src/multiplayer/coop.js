// Co-op mode — shared input streaming.
//
// Both peers run the same Game from the same room-seeded PRNG, so
// enemy spawns / boon rolls / loot rolls converge by construction.
// The data channel carries player inputs (build / upgrade / sell /
// potion / boon / ability); each peer applies remote inputs through
// the same actions dispatcher a local click goes through, so the
// existing Aegis money/HP audit sees identical deltas on every side.
//
// This is NOT strict tick-locked lockstep — peers can be a few frames
// apart and won't pause-wait for each other. For low-input games like
// Neon Defense the cosmetic divergence (tower-fire timing) is bounded
// and recovers naturally as inputs propagate. The lockstep controller
// (src/multiplayer/lockstep.js) is available if a future iteration
// wants stricter sync.
//
// Wire envelope: protocol.validateFrame's standard frame, wrapped
// inside { kind: 'coop-frame', frame: {...} } for transport routing.

(function () {
    'use strict';

    const protocol = (typeof require === 'function')
        ? require('./protocol.js')
        : (typeof window !== 'undefined' && window.NeonMP && window.NeonMP.protocol);
    const actions = (typeof require === 'function')
        ? require('./actions.js')
        : (typeof window !== 'undefined' && window.NeonMP && window.NeonMP.actions);
    const guardMod = (typeof require === 'function')
        ? require('./guard.js')
        : (typeof window !== 'undefined' && window.NeonMP && window.NeonMP.guard);

    // opts = {
    //   peer:       string nickname
    //   transport:  joined room (send/onMessage/leave)
    //   getGame:    () => game instance
    //   allowBuildTypes: Set<string> (optional — usually Object.keys(TOWERS))
    //   secret:     room-derived HMAC secret (recommended)
    //   onPeerJoin: ({peer}) => void
    //   onApply:    ({peer, input}) => void   (post-apply hook, e.g. cursor SFX)
    //   onReject:   ({peer, reason}) => void
    // }
    function createCoop(opts) {
        opts = opts || {};
        const me = String(opts.peer || '').slice(0, 32) || 'P0';
        const tx = opts.transport || { send() {}, onMessage() { return () => {}; }, leave() {} };
        const getGame = typeof opts.getGame === 'function' ? opts.getGame : () => null;
        const onApply = typeof opts.onApply === 'function' ? opts.onApply : null;
        const onReject = typeof opts.onReject === 'function' ? opts.onReject : null;
        const guard = guardMod.createGuard({
            allowBuildTypes: opts.allowBuildTypes,
            secret: opts.secret || null,
            // Co-op inputs are click-driven; protocol default of 30/sec
            // matches the documented anti-abuse cap.
            onReject: onReject ? (info) => onReject(info) : null,
        });

        let unsub = null;
        let frameCounter = 0;
        // Locally-known peer set (for the cursor / HUD rendering).
        const peers = new Set([me]);

        function onIncoming(msg) {
            if (!msg || typeof msg !== 'object') return;
            if (msg.kind !== 'coop-frame') return;
            const checked = guard.check(msg.frame);
            if (!checked.ok) return;
            const f = checked.frame;
            // Drop our own echo (mock hub doesn't echo; real transports might).
            if (f.p === me) return;
            if (!peers.has(f.p)) peers.add(f.p);
            const game = getGame();
            if (!game) return;
            for (const inp of f.i) {
                const res = actions.applyInput(game, inp, { source: 'remote' });
                if (onApply && res.ok) {
                    try { onApply({ peer: f.p, input: inp, result: res }); } catch (_) {}
                }
                if (!res.ok && onReject) {
                    try { onReject({ peer: f.p, reason: 'apply:' + res.reason }); } catch (_) {}
                }
            }
        }

        function start() {
            if (typeof tx.onMessage === 'function') unsub = tx.onMessage(onIncoming);
        }
        function stop() {
            if (typeof unsub === 'function') {
                try { unsub(); } catch (_) {}
                unsub = null;
            }
        }

        // Broadcast a local input that's ALREADY been applied to the
        // local game. The local effect (sound, UI) happens at the call
        // site; this just tells peers.
        function broadcast(input) {
            const v = protocol.validateInput(input, opts.allowBuildTypes);
            if (!v.ok) {
                if (onReject) try { onReject({ peer: me, reason: 'local-bad:' + v.reason }); } catch (_) {}
                return { ok: false, reason: v.reason };
            }
            const frame = {
                v: protocol.PROTOCOL_VERSION, p: me, f: frameCounter++,
                i: [v.input],
            };
            const signed = guard.signFrame ? guard.signFrame(frame) : frame;
            try { tx.send({ kind: 'coop-frame', frame: signed }); } catch (_) {}
            return { ok: true };
        }

        // Public surface for cursor / HUD rendering. Callers that
        // already have a race controller for the leaderboard can
        // reuse this peers set or spin up a separate race.js instance
        // for richer HUD info.
        return {
            start, stop, broadcast,
            get me() { return me; },
            get peers() { return Array.from(peers); },
            _guard: guard,
        };
    }

    const api = { createCoop };
    if (typeof window !== 'undefined') window.NeonMP = Object.assign(window.NeonMP || {}, { coop: api });
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();
