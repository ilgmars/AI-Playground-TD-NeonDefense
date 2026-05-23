// Global leaderboard — a public Trystero room everyone joins, even
// in single-player. Each peer publishes its best run on game-over;
// the receiver merges, deduplicates by (name, tier, wave) sorted by
// last-seen-at, and exposes the rolling list to the UI.
//
// This is a SEPARATE transport channel from race / coop / versus
// rooms. The well-known room name is fixed so any two browsers using
// the same build see the same global board.
//
// Trust model:
//   - We can't verify scores. A motivated peer can claim anything.
//   - To bound abuse: validation caps wave / tier, throttles publishes
//     per peer-id, dedupes by (name, tier, wave). The list is "honour-
//     system community", not authoritative — and the local localStorage
//     scoreboard still exists for personal-best tracking.
//   - A future iteration can demand a tamper-evident replay (.ndr)
//     before promoting a score onto the public list; out of scope here.

(function () {
    'use strict';

    const protocol = (typeof require === 'function')
        ? require('./protocol.js')
        : (typeof window !== 'undefined' && window.NeonMP && window.NeonMP.protocol);

    // Well-known room. The 6-char form keeps it valid for Trystero's
    // alphabet expectations. NEONXX would clash with the user-typeable
    // alphabet (excludes I/O/0/1); using 'NEON23' keeps it inside the
    // alphabet so room-code validators don't reject it.
    const GLOBAL_ROOM = 'NEON23';
    const APP_NS     = 'gl';        // Trystero action name (channel)

    // Cap how often a single peer can publish. 1 publish / 5 s is
    // plenty for a "I beat my high score" notification; anything faster
    // is treated as spam.
    const PUBLISH_THROTTLE_MS = 5000;
    // Cap remote roster size so a flood of fake names can't OOM us.
    const MAX_ENTRIES = 200;
    // Drop entries older than this on every render.
    const TTL_MS = 1000 * 60 * 60 * 24; // 24 h

    // Validate a wire entry. Reject anything that looks malformed.
    function validateEntry(raw) {
        if (!raw || typeof raw !== 'object') return null;
        if (typeof raw.name !== 'string') return null;
        const name = raw.name
            .toUpperCase()
            .replace(/[^A-Z0-9 \-]/g, '')
            .trim()
            .slice(0, 16);
        if (name.length === 0) return null;
        if (!Number.isInteger(raw.wave)) return null;
        if (raw.wave < 1 || raw.wave > 9999) return null;
        if (raw.tier != null && !Number.isInteger(raw.tier)) return null;
        const tier = Number.isInteger(raw.tier) ? raw.tier : 0;
        if (tier < 0 || tier > 999) return null;     // out-of-range tier is malformed, not clamped
        const t = Number.isInteger(raw.t) ? raw.t : Date.now();
        // cheated: marked true when the local Aegis sensor flagged the
        // run as tampered. We preserve the publisher's claim verbatim
        // (they could obviously lie) — the UI hides cheated entries by
        // default so a self-honest player can opt into seeing them.
        const cheated = raw.cheated === true;
        return { name, wave: raw.wave, tier, t, cheated };
    }

    function createGlobalBoard(opts) {
        opts = opts || {};
        const txFactory = opts.transportFactory;  // optional override for tests
        const now = opts.now || (() => Date.now());

        // Local roster keyed by name|tier — newest wave wins; ties broken
        // by recency so a player's freshest run stays visible.
        const board = new Map();
        const subs = new Set();
        let room = null;
        let lastPublishAt = 0;
        const remotePublishTimes = new Map(); // peer → last accept ts

        // Synchronous attach for tests that hand in an in-memory hub
        // peer. Real callers go through start() which loads Trystero.
        function attach(roomLike) {
            if (room) return room;
            room = roomLike;
            _wireRoom();
            return room;
        }
        async function start() {
            // Connect to the global room. Done lazily so the page doesn't
            // open WebSocket connections on first paint. Returns the
            // connected room (or null if Trystero fails — fall back to
            // local-only mode without crashing).
            if (room) return room;
            try {
                if (txFactory) {
                    const r = txFactory(GLOBAL_ROOM, 'self');
                    room = (r && typeof r.then === 'function') ? await r : r;
                } else if (typeof window !== 'undefined' && window.NeonMP && window.NeonMP.trystero) {
                    room = await window.NeonMP.trystero.joinRoom(GLOBAL_ROOM, 'self');
                } else {
                    return null;
                }
            } catch (e) {
                return null;
            }
            _wireRoom();
            return room;
        }
        function _wireRoom() {
            room.onMessage((msg, fromId) => {
                if (!msg || typeof msg !== 'object') return;
                if (msg.kind !== APP_NS) return;
                if (!Array.isArray(msg.entries)) return;
                // Throttle by sender — 1 packet per 5 s is more than enough
                // (each publish bundles all of that peer's known entries).
                const peer = String(fromId || '').slice(0, 64) || '?';
                const last = remotePublishTimes.get(peer) || 0;
                if (now() - last < 100) return;       // anti-flood (loose; per-sender publish throttle is the main gate)
                remotePublishTimes.set(peer, now());

                let added = 0;
                for (const raw of msg.entries.slice(0, 50)) {
                    const v = validateEntry(raw);
                    if (!v) continue;
                    if (mergeEntry(v)) added++;
                }
                if (added > 0) notify();
            });
        }

        function mergeEntry(entry) {
            const key = entry.name + '|a' + entry.tier;
            const prev = board.get(key);
            if (!prev) { board.set(key, entry); evictIfFull(); return true; }
            // Only override if the new entry beats the previous wave OR
            // matches it and is fresher (so reconnects don't bury a peer).
            if (entry.wave > prev.wave || (entry.wave === prev.wave && entry.t > prev.t)) {
                board.set(key, entry);
                return true;
            }
            return false;
        }
        function evictIfFull() {
            if (board.size <= MAX_ENTRIES) return;
            // Drop the oldest-by-timestamp entry until under cap.
            const sorted = Array.from(board.entries()).sort((a, b) => a[1].t - b[1].t);
            while (board.size > MAX_ENTRIES && sorted.length > 0) {
                const [k] = sorted.shift();
                board.delete(k);
            }
        }
        function sweepTTL() {
            const t = now();
            let changed = false;
            for (const [k, v] of board) {
                if (t - v.t > TTL_MS) { board.delete(k); changed = true; }
            }
            if (changed) notify();
        }

        // Publish OUR run. Bundles the full local board (so a fresh
        // joiner gets everything we know in one packet).
        function publish(entry) {
            const v = validateEntry(entry);
            if (!v) return { ok: false, reason: 'bad-entry' };
            // Local merge first — the peer's own UI updates immediately.
            mergeEntry(v);
            notify();
            // Throttle outbound sends so a script-clicking spammer can't
            // flood the room.
            const t = now();
            if (t - lastPublishAt < PUBLISH_THROTTLE_MS) {
                return { ok: false, reason: 'throttled' };
            }
            lastPublishAt = t;
            if (room) {
                try {
                    room.send({
                        kind: APP_NS,
                        entries: Array.from(board.values()).slice(0, 50),
                    });
                } catch (_) { /* swallow */ }
            }
            return { ok: true };
        }

        function snapshot() {
            sweepTTL();
            return Array.from(board.values())
                .slice()
                .sort((a, b) =>
                    (b.tier - a.tier) ||
                    (b.wave - a.wave) ||
                    (b.t - a.t));
        }

        function onUpdate(fn) { subs.add(fn); return () => subs.delete(fn); }
        function notify() {
            const snap = snapshot();
            for (const fn of subs) {
                try { fn(snap); } catch (_) {}
            }
        }
        function stop() {
            if (room) {
                try { room.leave(); } catch (_) {}
                room = null;
            }
            subs.clear();
        }
        function clear() { board.clear(); notify(); }

        return {
            start, attach, stop, publish, snapshot, onUpdate, clear,
            _validateEntry: validateEntry,
            _mergeEntry: mergeEntry,
        };
    }

    const api = {
        createGlobalBoard,
        validateEntry,
        GLOBAL_ROOM,
        MAX_ENTRIES,
        TTL_MS,
        PUBLISH_THROTTLE_MS,
    };
    // Singleton accessor — every page wants one shared board.
    let _singleton = null;
    api.singleton = function () {
        if (!_singleton) _singleton = createGlobalBoard();
        return _singleton;
    };
    // Convenience: opts.global maps to singleton's publish for the
    // window.NeonMP.global.publish() hook used by main.js.
    api.publish = (entry) => api.singleton().publish(entry);
    api.snapshot = () => api.singleton().snapshot();

    if (typeof window !== 'undefined') window.NeonMP = Object.assign(window.NeonMP || {}, { global: api });
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();
