// Input dispatcher — applies validated peer inputs against a Game.
// Every kind funnels through the same method the local UI uses, so
// Aegis' money/HP audit sees the same small deltas it always has.
// See multiplayer/anti-cheat.md ("The network is an untrusted input
// device, not a privileged caller").

(function () {
    'use strict';

    const protocol = (typeof require === 'function')
        ? require('./protocol.js')
        : (typeof window !== 'undefined' && window.NeonMP && window.NeonMP.protocol);

    function applyInput(game, input, opts) {
        if (!game || !input || !input.k) return { ok: false, reason: 'bad-args' };
        const source = (opts && opts.source) || 'remote';

        switch (input.k) {
            case 'build': {
                if (typeof game.buildTower !== 'function') return { ok: false, reason: 'no-build' };
                const r = game.buildTower(input.c, input.r, input.t, { source });
                return r === false
                    ? { ok: false, reason: 'rejected' }
                    : { ok: true, kind: 'build' };
            }
            case 'upgrade': {
                if (typeof game.upgradeTower !== 'function') return { ok: false, reason: 'no-upgrade' };
                const tower = pickTower(game, input.tower);
                if (!tower) return { ok: false, reason: 'no-tower' };
                const r = game.upgradeTower(tower, input.slot, { source });
                return r === false
                    ? { ok: false, reason: 'rejected' }
                    : { ok: true, kind: 'upgrade' };
            }
            case 'sell': {
                if (typeof game.sellTower !== 'function') return { ok: false, reason: 'no-sell' };
                const tower = pickTower(game, input.tower);
                if (!tower) return { ok: false, reason: 'no-tower' };
                const r = game.sellTower(tower, { source });
                return r === false
                    ? { ok: false, reason: 'rejected' }
                    : { ok: true, kind: 'sell' };
            }
            case 'potion': {
                if (typeof game.buyPotion !== 'function') return { ok: false, reason: 'no-potion' };
                const r = game.buyPotion({ source });
                return r === false
                    ? { ok: false, reason: 'rejected' }
                    : { ok: true, kind: 'potion' };
            }
            case 'boon': {
                if (typeof game.pickBoon !== 'function') return { ok: false, reason: 'no-boon' };
                const r = game.pickBoon(input.id, { source });
                return r === false
                    ? { ok: false, reason: 'rejected' }
                    : { ok: true, kind: 'boon' };
            }
            case 'ability': {
                if (typeof game.useAbility !== 'function') return { ok: false, reason: 'no-ability' };
                const r = game.useAbility(input.id, { source });
                return r === false
                    ? { ok: false, reason: 'rejected' }
                    : { ok: true, kind: 'ability' };
            }
            default:
                return { ok: false, reason: 'bad-kind' };
        }
    }

    function pickTower(game, idx) {
        const list = Array.isArray(game.towers) ? game.towers : [];
        if (idx < 0 || idx >= list.length) return null;
        return list[idx];
    }

    function applyFrame(game, frame, opts) {
        const allow = opts && opts.allowBuildTypes;
        const v = protocol.validateFrame(frame, allow);
        if (!v.ok) return { ok: false, reason: v.reason, applied: [], dropped: [] };

        const applied = [];
        const dropped = [];
        for (const input of v.frame.i) {
            const r = applyInput(game, input, opts);
            if (r.ok) applied.push({ kind: input.k });
            else dropped.push({ kind: input.k, reason: r.reason });
        }
        return { ok: true, applied, dropped, frame: v.frame };
    }

    const api = { applyInput, applyFrame };
    if (typeof window !== 'undefined') window.NeonMP = Object.assign(window.NeonMP || {}, { actions: api });
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();
