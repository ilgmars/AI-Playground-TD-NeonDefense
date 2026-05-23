// Multiplayer protocol primitives — wire format validation, room-code
// → seed derivation, per-peer input throttling, and the deterministic
// state hash used for desync detection. See multiplayer/sync.md and
// multiplayer/anti-cheat.md for the design.
//
// Pure logic, no DOM. Safe to require from Node tests.

(function (root) {
    'use strict';

    const PROTOCOL_VERSION = 1;

    // Input kinds and build types accepted from peers. Anything outside
    // these sets is dropped on receive (anti-cheat.md "Peer sent garbage").
    const ALLOW_INPUT_KINDS = new Set([
        'build', 'upgrade', 'sell', 'potion', 'boon', 'ability',
    ]);

    // Default tower types. The game ships more (variants, kits), but
    // protocol.js stays decoupled — callers extend the allow-list at
    // wire time with the live `Object.keys(TOWERS)` snapshot.
    const DEFAULT_ALLOW_BUILD_TYPES = new Set([
        'basic', 'sniper', 'shotgun', 'laser', 'rocket',
        'flak', 'tesla', 'silo', 'relay',
    ]);

    // 6-char room code alphabet from signalling.md. No 0/O/1/I/etc.
    const ROOM_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

    // Per-peer input throttle. Humans click a few per second; 30/sec is
    // a comfortable headroom that still drops floods. See anti-cheat.md.
    const DEFAULT_THROTTLE_PER_SEC = 30;

    // FNV-1a — duplicated here so this module has zero dependencies and
    // can be loaded before aegis.js. Same constant as NeonAegis.fnv1a so
    // a roomCode hashed here matches a roomCode hashed there.
    function fnv1a(s) {
        let h = 0x811c9dc5;
        for (let i = 0; i < s.length; i++) {
            h ^= s.charCodeAt(i);
            h = Math.imul(h, 0x01000193);
        }
        return h >>> 0;
    }

    function isValidRoomCode(code) {
        if (typeof code !== 'string' || code.length !== 6) return false;
        for (let i = 0; i < 6; i++) {
            if (ROOM_ALPHABET.indexOf(code[i]) < 0) return false;
        }
        return true;
    }

    function roomCodeToSeed(code) {
        return fnv1a(String(code).toUpperCase());
    }

    // Validate a single input envelope. Returns {ok, reason, input}.
    // `allowBuildTypes` is optional; pass live TOWERS keys when calling
    // from game.js. Without it, the default set is used.
    function validateInput(raw, allowBuildTypes) {
        if (!raw || typeof raw !== 'object') return reject('not-object');
        const k = raw.k;
        if (!ALLOW_INPUT_KINDS.has(k)) return reject('bad-kind');

        const types = allowBuildTypes instanceof Set
            ? allowBuildTypes
            : DEFAULT_ALLOW_BUILD_TYPES;

        switch (k) {
            case 'build': {
                if (!Number.isInteger(raw.c) || !Number.isInteger(raw.r)) return reject('bad-coord');
                if (raw.c < 0 || raw.r < 0 || raw.c > 999 || raw.r > 999) return reject('coord-range');
                if (typeof raw.t !== 'string' || !types.has(raw.t)) return reject('bad-type');
                return accept({ k, c: raw.c, r: raw.r, t: raw.t });
            }
            case 'upgrade':
            case 'sell': {
                if (!Number.isInteger(raw.tower) || raw.tower < 0) return reject('bad-tower');
                if (k === 'upgrade') {
                    if (!Number.isInteger(raw.slot) || raw.slot < 0 || raw.slot > 2) return reject('bad-slot');
                    return accept({ k, tower: raw.tower, slot: raw.slot });
                }
                return accept({ k, tower: raw.tower });
            }
            case 'potion': {
                return accept({ k });
            }
            case 'boon': {
                if (typeof raw.id !== 'string' || raw.id.length === 0 || raw.id.length > 64) return reject('bad-id');
                return accept({ k, id: raw.id });
            }
            case 'ability': {
                if (typeof raw.id !== 'string' || raw.id.length === 0 || raw.id.length > 64) return reject('bad-id');
                return accept({ k, id: raw.id });
            }
        }
        return reject('unhandled');
    }

    function accept(input) { return { ok: true, input }; }
    function reject(reason) { return { ok: false, reason }; }

    // Validate the full frame envelope.
    function validateFrame(frame, allowBuildTypes) {
        if (!frame || typeof frame !== 'object') return reject('not-object');
        if (frame.v !== PROTOCOL_VERSION) return reject('bad-version');
        if (typeof frame.p !== 'string' || frame.p.length === 0 || frame.p.length > 32) return reject('bad-peer');
        if (!Number.isInteger(frame.f) || frame.f < 0) return reject('bad-frame');
        if (!Array.isArray(frame.i)) return reject('bad-inputs');
        if (frame.i.length > 256) return reject('inputs-too-many');
        const inputs = [];
        for (const raw of frame.i) {
            const r = validateInput(raw, allowBuildTypes);
            if (!r.ok) return reject('input:' + r.reason);
            inputs.push(r.input);
        }
        const out = { v: PROTOCOL_VERSION, p: frame.p, f: frame.f, i: inputs };
        if (typeof frame.hash === 'string') out.hash = frame.hash;
        return { ok: true, frame: out };
    }

    // Token-bucket per peer. now() is injected so tests are deterministic.
    function createThrottle(perSec, now) {
        const limit = perSec || DEFAULT_THROTTLE_PER_SEC;
        const clock = now || (() => Date.now());
        const state = new Map(); // peer -> {tokens, last}
        return {
            // Returns true if the input should be accepted.
            accept(peer) {
                const t = clock();
                let s = state.get(peer);
                if (!s) { s = { tokens: limit, last: t }; state.set(peer, s); }
                const elapsed = Math.max(0, t - s.last);
                s.tokens = Math.min(limit, s.tokens + (elapsed / 1000) * limit);
                s.last = t;
                if (s.tokens < 1) return false;
                s.tokens -= 1;
                return true;
            },
            _peek(peer) { return state.get(peer); },
        };
    }

    // Deterministic snapshot hash. game arg is duck-typed — only the
    // fields named in sync.md (#desync-detection) are read.
    function snapshotHash(game) {
        if (!game) return '0';
        const parts = [];
        parts.push('w', (game.wave | 0).toString(36));
        parts.push('h', (game.health | 0).toString(36));
        parts.push('m', (Math.floor(game.money || 0)).toString(36));
        const towers = Array.isArray(game.towers) ? game.towers : [];
        parts.push('tN', towers.length.toString(36));
        const sig = towers
            .map(t => [t.c | 0, t.r | 0, String(t.type || ''), Math.floor(t.damageDealt || 0)])
            .sort((a, b) => (a[0] - b[0]) || (a[1] - b[1]) || (a[2] < b[2] ? -1 : a[2] > b[2] ? 1 : 0))
            .map(row => row.join(','))
            .join('|');
        parts.push('tS', sig);
        const enemies = Array.isArray(game.enemies) ? game.enemies : [];
        const active = enemies.filter(e => e && e.active).length;
        parts.push('eA', active.toString(36));
        return fnv1a(parts.join(';')).toString(36);
    }

    const api = {
        PROTOCOL_VERSION,
        ALLOW_INPUT_KINDS,
        DEFAULT_ALLOW_BUILD_TYPES,
        ROOM_ALPHABET,
        DEFAULT_THROTTLE_PER_SEC,
        fnv1a,
        isValidRoomCode,
        roomCodeToSeed,
        validateInput,
        validateFrame,
        createThrottle,
        snapshotHash,
    };

    if (typeof window !== 'undefined') window.NeonMP = Object.assign(window.NeonMP || {}, { protocol: api });
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
