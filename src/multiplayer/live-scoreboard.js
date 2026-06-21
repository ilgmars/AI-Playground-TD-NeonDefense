// Live in-match multiplayer scoreboard.
//
// Distinct from the GLOBAL all-time board (global.js): this tracks the
// CURRENT score of every player in THIS room during a live co-op / versus
// match, so everyone sees a live ranking that updates as the run goes on.
//
// The logic here is pure and transport-agnostic: feed it incoming peer
// updates, ask it for standings, and let it decide WHEN your own score is
// worth broadcasting. Sends are novelty-gated because bandwidth is a hard
// constraint (same rule as global.js / the coop digest). Wire `setSelf`'s
// return value into the coop/mqtt transport and feed received payloads back
// through `ingest`.
(function () {
    'use strict';

    const DEFAULTS = {
        ttlMs: 30000,        // drop a player not heard from in 30 s (they left)
        heartbeatMs: 10000,  // resend at least this often so peers don't time us out
        minScoreDelta: 50,   // ignore sub-50 score wiggles to save bandwidth
    };

    // Pure: live standings, strongest first. Entries older than ttlMs are
    // dropped — a disconnected player falls off the board. Ties break on
    // wave, then name, then id so the order is stable across peers.
    function rankEntries(entries, now, ttlMs) {
        return entries
            .filter(e => e && (now - e.ts) <= ttlMs)
            .slice()
            .sort((a, b) =>
                b.score - a.score ||
                b.wave - a.wave ||
                String(a.name).localeCompare(String(b.name)) ||
                String(a.id).localeCompare(String(b.id)))
            .map((e, i) => ({ rank: i + 1, id: e.id, name: e.name, score: e.score, wave: e.wave }));
    }

    // Pure: is `next` worth the bandwidth given the last payload we sent?
    // Yes on the first send, any wave change, a meaningful score jump, or
    // once the heartbeat interval has elapsed.
    function shouldBroadcast(prev, next, now, opts) {
        const o = Object.assign({}, DEFAULTS, opts);
        if (!prev) return true;
        if (next.wave !== prev.wave) return true;
        if (Math.abs(next.score - prev.score) >= o.minScoreDelta) return true;
        if ((now - prev.ts) >= o.heartbeatMs) return true;
        return false;
    }

    function createLiveBoard(opts) {
        const o = Object.assign({}, DEFAULTS, opts);
        const selfId = o.selfId;
        const entries = new Map();   // id -> { id, name, score, wave, ts }
        let lastSent = null;         // last payload we actually broadcast

        // Record/refresh a player (self or peer). Coerces fields so a hostile
        // peer can't poison the board with non-numbers.
        function ingest(u, now) {
            if (!u || u.id == null) return null;
            const e = {
                id: u.id,
                name: String(u.name == null ? u.id : u.name).slice(0, 24),
                score: u.score | 0,
                wave: u.wave | 0,
                ts: now,
            };
            entries.set(u.id, e);
            return e;
        }

        // Update our own score. Returns the payload to broadcast, or null when
        // gating says it isn't worth sending yet. Local state still updates so
        // our own row is always current even when we stay quiet on the wire.
        function setSelf(name, score, wave, now) {
            const next = {
                id: selfId,
                name: String(name == null ? selfId : name).slice(0, 24),
                score: score | 0,
                wave: wave | 0,
            };
            ingest(next, now);
            if (!shouldBroadcast(lastSent, next, now, o)) return null;
            lastSent = { id: next.id, name: next.name, score: next.score, wave: next.wave, ts: now };
            return { id: next.id, name: next.name, score: next.score, wave: next.wave };
        }

        function standings(now) {
            return rankEntries(Array.from(entries.values()), now, o.ttlMs);
        }

        function prune(now) {
            for (const [id, e] of entries) if ((now - e.ts) > o.ttlMs) entries.delete(id);
        }

        function remove(id) { entries.delete(id); }
        function size() { return entries.size; }

        return { ingest, setSelf, standings, prune, remove, size };
    }

    const api = { createLiveBoard, rankEntries, shouldBroadcast, DEFAULTS };
    if (typeof window !== 'undefined') {
        window.NeonMP = Object.assign(window.NeonMP || {}, { liveScoreboard: api });
    }
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();
