// Versus mode — spike protocol.
//
// Each player runs their OWN simulation (different seeds: roomCode+'A'
// and roomCode+'B'); the data channel only carries spike messages and
// the same lightweight heartbeat race.js uses. Killing enemies fills a
// local spike meter; when it crosses thresholds, the spike is sent to
// the opponent and applied at their NEXT wave boundary (never
// mid-wave — that would desync spawn placement).
//
// See multiplayer/game-modes.md "Versus" for the design rules.
//
// Wire envelope for one spike:
//   { v:1, k:'spike', p:'ALICE', n:42, amount:6, mix:{normal:3, fast:2, air:1}, target:'BOB' }
//     v       protocol version
//     k       'spike'
//     p       sender nick
//     n       monotonic spike number (per peer) — dedupes + replay defence
//     amount  total extra enemies queued
//     mix     {type: count} (only types in protocol.DEFAULT_ENEMY_TYPES)
//     target  opponent nick (or omitted for 2-player: every other peer)
//
// Pure logic — no DOM, no transport. createVersus is wired by the lobby
// once a versus room exists.

(function () {
    'use strict';

    const protocol = (typeof require === 'function')
        ? require('./protocol.js')
        : (typeof window !== 'undefined' && window.NeonMP && window.NeonMP.protocol);

    // Enemy archetypes the spike envelope can carry. Limiting the set
    // matches anti-cheat.md "Peer sent garbage" — anything else is
    // dropped at receive without flagging the peer as a cheater.
    const ALLOW_ENEMY_TYPES = new Set(['normal', 'fast', 'tank', 'air']);

    // Default meter math: 1 kill = 1 charge; spike fires at 20.
    // Sudden-death halves the threshold; comeback (HP <= 5) doubles
    // the fill rate.
    const DEFAULT_THRESHOLD = 20;
    const DEFAULT_SUDDEN_DEATH_THRESHOLD = 10;
    const DEFAULT_COMEBACK_MULT = 2;
    // Spikes can't exceed this many enemies to keep the receiver's
    // simulation tractable. Anything beyond is clamped at receive.
    const DEFAULT_MAX_SPIKE_AMOUNT = 30;
    // Beyond this we treat the spike as malformed.
    const HARD_MAX_SPIKE_AMOUNT = 100;

    function validateSpike(raw) {
        if (!raw || typeof raw !== 'object') return reject('not-object');
        if (raw.v !== protocol.PROTOCOL_VERSION) return reject('bad-version');
        if (raw.k !== 'spike') return reject('bad-kind');
        if (typeof raw.p !== 'string' || raw.p.length === 0 || raw.p.length > 32) return reject('bad-peer');
        if (!Number.isInteger(raw.n) || raw.n < 0) return reject('bad-n');
        if (!Number.isInteger(raw.amount) || raw.amount <= 0) return reject('bad-amount');
        if (raw.amount > HARD_MAX_SPIKE_AMOUNT) return reject('amount-too-large');
        if (!raw.mix || typeof raw.mix !== 'object') return reject('bad-mix');
        const cleanMix = {};
        let total = 0;
        for (const k of Object.keys(raw.mix)) {
            if (!ALLOW_ENEMY_TYPES.has(k)) return reject('mix-type');
            const v = raw.mix[k];
            if (!Number.isInteger(v) || v < 0) return reject('mix-count');
            if (v > 0) { cleanMix[k] = v; total += v; }
        }
        if (total === 0) return reject('mix-empty');
        // Allow a small drift between amount and mix-sum so senders that
        // round don't get rejected; clamp here.
        const clean = {
            v: protocol.PROTOCOL_VERSION, k: 'spike', p: raw.p, n: raw.n,
            amount: Math.min(total, DEFAULT_MAX_SPIKE_AMOUNT),
            mix: cleanMix,
        };
        if (typeof raw.target === 'string' && raw.target.length > 0 && raw.target.length <= 32) {
            clean.target = raw.target;
        }
        return { ok: true, spike: clean };
    }
    function reject(reason) { return { ok: false, reason }; }

    // SpikeMeter tracks local kills, decides when to fire, and produces
    // a packet. Kept independent of the controller so a Game.update()
    // hook can call onKill() without pulling the full controller in.
    function createSpikeMeter(opts) {
        opts = opts || {};
        let charge = 0;
        let nextSpikeN = 0;
        const mix = Object.create(null);
        let threshold = opts.threshold || DEFAULT_THRESHOLD;
        let comebackMult = opts.comebackMult || DEFAULT_COMEBACK_MULT;
        let suddenDeath = false;

        function setSuddenDeath(on) {
            suddenDeath = !!on;
            threshold = on
                ? (opts.suddenDeathThreshold || DEFAULT_SUDDEN_DEATH_THRESHOLD)
                : (opts.threshold || DEFAULT_THRESHOLD);
        }

        function recordKill(type, gameCtx) {
            const t = ALLOW_ENEMY_TYPES.has(type) ? type : 'normal';
            // Comeback mechanic: if HP <= 5, fill 2× to give a comeback
            // window. game-modes.md "catch-up problem".
            const lowHp = !!(gameCtx && Number.isFinite(gameCtx.health) && gameCtx.health <= 5);
            const fill = lowHp ? comebackMult : 1;
            charge += fill;
            mix[t] = (mix[t] || 0) + 1;
        }

        // Try to produce a spike. Returns the spike envelope to send,
        // or null if the meter hasn't reached threshold.
        function tryFire(peer, target) {
            if (charge < threshold) return null;
            const amount = Math.min(DEFAULT_MAX_SPIKE_AMOUNT, Math.max(1, Math.floor(charge / 2)));
            // Distribute amount across recorded kill mix in proportion to
            // their counts; preserves the killer's "flavor" (lots of
            // fast kills → spike that's mostly fast).
            const out = {};
            let total = 0;
            for (const t of Object.keys(mix)) total += mix[t];
            if (total === 0) return null;
            let remaining = amount;
            const keys = Object.keys(mix);
            for (let i = 0; i < keys.length; i++) {
                const t = keys[i];
                if (i === keys.length - 1) {
                    if (remaining > 0) out[t] = (out[t] || 0) + remaining;
                    remaining = 0;
                } else {
                    const share = Math.floor((mix[t] / total) * amount);
                    if (share > 0) out[t] = share;
                    remaining -= share;
                }
            }
            // Reset state. Charge spills above threshold are forfeited
            // so a giant kill streak can't queue back-to-back spikes
            // — players still have to keep playing.
            charge = 0;
            // Decay the mix proportionally so the next spike reflects
            // RECENT kills rather than every kill since match start.
            for (const t of keys) mix[t] = Math.floor(mix[t] / 2);
            const envelope = {
                v: protocol.PROTOCOL_VERSION, k: 'spike',
                p: String(peer || ''), n: nextSpikeN++,
                amount, mix: out,
            };
            if (target) envelope.target = String(target);
            return envelope;
        }

        return {
            recordKill, tryFire, setSuddenDeath,
            get charge() { return charge; },
            get threshold() { return threshold; },
            get suddenDeath() { return suddenDeath; },
            _peekMix: () => Object.assign({}, mix),
        };
    }

    // SpikeQueue collects incoming spikes for the next wave boundary.
    // game-modes.md: spikes apply at wave-clear, never mid-wave.
    function createSpikeQueue(opts) {
        const seen = new Map(); // peer -> max n seen
        const queued = []; // {peer, mix, amount}
        const onApply = (opts && typeof opts.onApply === 'function') ? opts.onApply : null;

        function ingest(rawSpike) {
            const r = validateSpike(rawSpike);
            if (!r.ok) return r;
            const s = r.spike;
            const last = seen.get(s.p);
            if (last != null && s.n <= last) return { ok: false, reason: 'replay' };
            seen.set(s.p, s.n);
            queued.push({ peer: s.p, n: s.n, amount: s.amount, mix: s.mix });
            return { ok: true, spike: s };
        }

        // drain: called by the game's wave-boundary logic. Merges all
        // queued spikes into a single composite mix the wave generator
        // can consume and adds to the next wave's spawn list. Returns
        // the merged result and resets the queue.
        function drain() {
            if (queued.length === 0) return { amount: 0, mix: {} };
            const mix = {};
            let amount = 0;
            for (const q of queued) {
                amount += q.amount;
                for (const t of Object.keys(q.mix)) {
                    mix[t] = (mix[t] || 0) + q.mix[t];
                }
            }
            const drained = { amount, mix, sources: queued.map(q => ({ peer: q.peer, n: q.n })) };
            queued.length = 0;
            if (onApply) { try { onApply(drained); } catch (_) {} }
            return drained;
        }

        return {
            ingest, drain,
            get queuedCount() { return queued.length; },
            _peek: () => queued.slice(),
        };
    }

    // Top-level versus controller — composes meter + queue, wires a
    // transport peer, and exposes hooks the game integration will call.
    function createVersus(opts) {
        opts = opts || {};
        const me = String(opts.peer || '').slice(0, 32) || 'P0';
        const tx = opts.transport || { send() {}, onMessage() { return () => {}; }, leave() {} };
        const target = opts.target || null;
        const meter = createSpikeMeter(opts.meterOpts || {});
        const queue = createSpikeQueue({ onApply: opts.onApply });
        let unsub = null;

        function onIncoming(msg) {
            if (!msg || msg.k !== 'spike') return;
            // Drop frames addressed to someone else (>2 player rooms).
            if (msg.target && msg.target !== me) return;
            // Drop a spike sent BY us (echo from the room).
            if (msg.p === me) return;
            queue.ingest(msg);
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
        // Public surface used by the game integration.
        function recordKill(type, ctx) {
            meter.recordKill(type, ctx);
            const env = meter.tryFire(me, target);
            if (env && typeof tx.send === 'function') {
                try { tx.send(env); } catch (_) {}
            }
            return env;
        }
        function nextWaveSpike() { return queue.drain(); }

        return {
            start, stop, recordKill, nextWaveSpike,
            get meter() { return { charge: meter.charge, threshold: meter.threshold, suddenDeath: meter.suddenDeath }; },
            setSuddenDeath: (on) => meter.setSuddenDeath(on),
            _meter: meter,
            _queue: queue,
        };
    }

    const api = {
        validateSpike,
        createSpikeMeter,
        createSpikeQueue,
        createVersus,
        ALLOW_ENEMY_TYPES,
        DEFAULT_THRESHOLD,
        DEFAULT_SUDDEN_DEATH_THRESHOLD,
        DEFAULT_MAX_SPIKE_AMOUNT,
        HARD_MAX_SPIKE_AMOUNT,
    };
    if (typeof window !== 'undefined') window.NeonMP = Object.assign(window.NeonMP || {}, { versus: api });
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();
