// Race mode — each peer plays its own world from a shared seed.
// The data channel carries only display heartbeats: wave / hp / money /
// score / alive. No state is merged; nothing here can affect the local
// simulation, so Aegis stays naive (see multiplayer/anti-cheat.md and
// multiplayer/game-modes.md "Race").
//
// Pure controller — no DOM. The UI subscribes via onUpdate() and renders.
// All clocks are injected for deterministic tests.

(function () {
    'use strict';

    const protocol = (typeof require === 'function')
        ? require('./protocol.js')
        : (typeof window !== 'undefined' && window.NeonMP && window.NeonMP.protocol);

    // Heartbeat cadence and timeouts. Bandwidth budget: ~40B per second
    // per peer (see game-modes.md "Data exchanged").
    const DEFAULT_HEARTBEAT_MS = 1000;
    // After STALE_MS without a heartbeat, the peer's row dims. After
    // DROP_MS it's removed. STALE_MS is conservative — a fast-paced
    // game still drops one heartbeat to GC sometimes.
    const DEFAULT_STALE_MS = 4000;
    const DEFAULT_DROP_MS  = 30000;

    // Wire envelope for a race heartbeat. We keep the field names short
    // because they go over WebRTC; clarity comes from validateHeartbeat
    // re-emitting them with canonical names on the local roster.
    //
    // { v:1, k:'hb', p:'ALICE', w:14, h:18, mh:20, m:320, s:1280, a:1, f:N }
    //   v  protocol version
    //   k  'hb' (heartbeat)
    //   p  peer nickname (3-12 chars from the room-code alphabet space,
    //      reused for sanity)
    //   w  wave number (int, 0..9999)
    //   h  current health (int, 0..9999)
    //   mh max health      (int, 0..9999)
    //   m  money (floored int)
    //   s  score (floored int)
    //   a  1 alive, 0 dead/final
    //   f  monotonic counter — same role as protocol.validateFrame.f,
    //      keeps replays of an old heartbeat from "resurrecting" a
    //      peer who already showed final.

    function validateHeartbeat(raw) {
        if (!raw || typeof raw !== 'object') return reject('not-object');
        if (raw.v !== protocol.PROTOCOL_VERSION) return reject('bad-version');
        if (raw.k !== 'hb') return reject('bad-kind');
        if (typeof raw.p !== 'string' || raw.p.length === 0 || raw.p.length > 32) return reject('bad-peer');
        for (const k of ['w', 'h', 'mh', 'm', 's', 'a', 'f']) {
            if (!Number.isInteger(raw[k])) return reject('bad-' + k);
        }
        if (raw.w  < 0 || raw.w  > 9999) return reject('range-w');
        if (raw.h  < 0 || raw.h  > 9999) return reject('range-h');
        if (raw.mh < 0 || raw.mh > 9999) return reject('range-mh');
        if (raw.m  < 0 || raw.m  > 999999999) return reject('range-m');
        if (raw.s  < 0 || raw.s  > 999999999) return reject('range-s');
        if (raw.a !== 0 && raw.a !== 1) return reject('range-a');
        if (raw.f  < 0) return reject('range-f');
        return { ok: true, hb: {
            v: raw.v, k: 'hb', p: raw.p,
            w: raw.w, h: raw.h, mh: raw.mh, m: raw.m, s: raw.s, a: raw.a, f: raw.f,
        }};
    }
    function reject(reason) { return { ok: false, reason }; }

    // Build a heartbeat from a Game-like object. Anything missing
    // becomes 0; callers shouldn't fabricate fields the game doesn't
    // expose because the receiver's UI just shows "—".
    function buildHeartbeat(opts) {
        const peer = String(opts.peer || '').slice(0, 32);
        const game = opts.game || {};
        const frame = opts.frame | 0;
        const alive = game.state !== 'gameover' ? 1 : 0;
        // toNum() collapses anything non-finite (NaN, 'lol', undefined)
        // into 0 before clamping. Otherwise Math.floor(NaN) = NaN and
        // the heartbeat would fail validateHeartbeat at the receiver.
        function toNum(v) { const n = +v; return Number.isFinite(n) ? n : 0; }
        return {
            v: protocol.PROTOCOL_VERSION, k: 'hb', p: peer,
            w:  Math.max(0, Math.min(9999, toNum(game.wave) | 0)),
            h:  Math.max(0, Math.min(9999, toNum(game.health) | 0)),
            mh: Math.max(0, Math.min(9999, toNum(game.maxHealth) | 0)),
            m:  Math.max(0, Math.min(999999999, Math.floor(toNum(game.money)))),
            s:  Math.max(0, Math.min(999999999, Math.floor(toNum(game.score)))),
            a: alive, f: Math.max(0, frame),
        };
    }

    // Race controller. Maintains a roster keyed by peer name and emits
    // 'update' callbacks when it changes. Mounts onto any transport
    // peer that exposes {send, onMessage, leave} — MockTransport in
    // tests, Trystero adapter in the browser.
    //
    // opts = {
    //   peer:           string  (our nickname),
    //   transport:      object  (joined room handle),
    //   getGame:        () => game-like object,
    //   now:            () => ms (defaults to Date.now),
    //   heartbeatMs:    number  (default 1000),
    //   staleMs:        number  (default 4000),
    //   dropMs:         number  (default 30000),
    //   maxRosterSize:  number  (default 16) — caps memory under abuse,
    // }
    function createRace(opts) {
        opts = opts || {};
        const me = String(opts.peer || '').slice(0, 32) || 'PLAYER';
        const tx = opts.transport;
        const getGame = typeof opts.getGame === 'function' ? opts.getGame : () => ({});
        const now = typeof opts.now === 'function' ? opts.now : () => Date.now();
        const heartbeatMs = opts.heartbeatMs || DEFAULT_HEARTBEAT_MS;
        const staleMs = opts.staleMs || DEFAULT_STALE_MS;
        const dropMs  = opts.dropMs  || DEFAULT_DROP_MS;
        const maxRoster = opts.maxRosterSize || 16;
        // 30 heartbeats per second is plenty; same per-peer rate-limit
        // that protocol uses for inputs prevents heartbeat floods.
        const throttle = protocol.createThrottle(30, now);
        // Per-peer highest frame so a re-broadcast old heartbeat can't
        // overwrite a fresher one. Mirrors guard.js monotonic check.
        const highestSeen = new Map();

        // roster[peerName] = { peer, w, h, mh, m, s, alive, lastSeen, stale }
        const roster = Object.create(null);
        const subs = new Set();
        let frame = 0;
        let stopped = false;
        let timer = null;
        let unsubMessage = null;
        let staleSweepTimer = null;
        const cancelers = [];

        function notify() {
            const list = Object.keys(roster).map(p => Object.assign({}, roster[p]));
            // Newest wave first, ties broken by score so the leaderboard
            // reads top→bottom as "who's winning".
            list.sort((a, b) => (b.w - a.w) || (b.s - a.s));
            for (const fn of subs) {
                try { fn({ me, peers: list }); } catch (_) { /* swallow */ }
            }
        }

        function upsertSelf() {
            const hb = buildHeartbeat({ peer: me, game: getGame(), frame });
            roster[me] = rosterRowFromHB(hb, now());
            return hb;
        }
        function rosterRowFromHB(hb, t) {
            return {
                peer: hb.p, w: hb.w, h: hb.h, mh: hb.mh, m: hb.m, s: hb.s,
                alive: hb.a === 1, lastSeen: t, stale: false,
            };
        }

        function tick() {
            if (stopped) return;
            frame += 1;
            const hb = upsertSelf();
            if (tx && typeof tx.send === 'function') {
                try { tx.send(hb); } catch (_) { /* swallow */ }
            }
            notify();
        }

        function onIncoming(msg, fromId) {
            if (stopped) return;
            if (!msg || msg.k !== 'hb') return;
            const v = validateHeartbeat(msg);
            if (!v.ok) return;
            const hb = v.hb;
            // Refuse our own name from another wire (a collision / impostor
            // attempt). The local seat is owned by us; remote claims of
            // the same name are dropped to keep the UI consistent.
            if (hb.p === me) return;
            // Per-peer monotonic — drop replays / out-of-order olds.
            const prev = highestSeen.get(hb.p);
            if (prev != null && hb.f <= prev) return;
            // Throttle by peer name; if a peer floods us, we stop
            // updating their row until they slow down. Drops onward.
            if (!throttle.accept(hb.p)) return;
            highestSeen.set(hb.p, hb.f);
            // Cap roster size to bound memory under abusive joins.
            if (!roster[hb.p] && Object.keys(roster).length >= maxRoster) return;
            roster[hb.p] = rosterRowFromHB(hb, now());
            notify();
        }

        function sweepStale() {
            if (stopped) return;
            const t = now();
            let changed = false;
            for (const peer of Object.keys(roster)) {
                if (peer === me) continue;
                const row = roster[peer];
                const age = t - row.lastSeen;
                if (age > dropMs) {
                    delete roster[peer]; changed = true;
                } else if (age > staleMs && !row.stale) {
                    row.stale = true; changed = true;
                } else if (age <= staleMs && row.stale) {
                    row.stale = false; changed = true;
                }
            }
            if (changed) notify();
        }

        function start() {
            if (stopped || timer) return;
            if (tx && typeof tx.onMessage === 'function') {
                unsubMessage = tx.onMessage(onIncoming);
            }
            // Fire one tick immediately so the local row appears now.
            tick();
            timer = setInterval(tick, heartbeatMs);
            // Stale sweep at heartbeat cadence — cheap; iterate < 16 peers.
            staleSweepTimer = setInterval(sweepStale, Math.min(heartbeatMs, 1000));
            if (timer && typeof timer.unref === 'function') timer.unref();
            if (staleSweepTimer && typeof staleSweepTimer.unref === 'function') staleSweepTimer.unref();
        }

        function stop() {
            stopped = true;
            if (timer) { clearInterval(timer); timer = null; }
            if (staleSweepTimer) { clearInterval(staleSweepTimer); staleSweepTimer = null; }
            if (typeof unsubMessage === 'function') {
                try { unsubMessage(); } catch (_) {}
                unsubMessage = null;
            }
            for (const c of cancelers) { try { c(); } catch (_) {} }
            cancelers.length = 0;
        }

        function onUpdate(fn) {
            subs.add(fn);
            return () => subs.delete(fn);
        }

        // For tests: drive the loop deterministically without setInterval.
        function _tickOnce() { tick(); }
        function _sweepOnce() { sweepStale(); }
        function _ingest(msg, fromId) { onIncoming(msg, fromId); }

        return {
            start, stop, onUpdate,
            get roster() { return Object.assign({}, roster); },
            get me() { return me; },
            _tickOnce, _sweepOnce, _ingest,
        };
    }

    const api = {
        validateHeartbeat,
        buildHeartbeat,
        createRace,
        DEFAULT_HEARTBEAT_MS,
        DEFAULT_STALE_MS,
        DEFAULT_DROP_MS,
    };
    if (typeof window !== 'undefined') window.NeonMP = Object.assign(window.NeonMP || {}, { race: api });
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();
