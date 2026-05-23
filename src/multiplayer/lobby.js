// Lobby — room-code generation, nickname persistence, room state for
// the menu UI. No transport logic here; once the lobby produces a
// {roomCode, nick, mode} triple, main.js hands it to race.js (or co-op).
//
// Browser-only: persists nick + last room to localStorage. In tests we
// just exercise the room-code generator.

(function () {
    'use strict';

    const protocol = (typeof require === 'function')
        ? require('./protocol.js')
        : (typeof window !== 'undefined' && window.NeonMP && window.NeonMP.protocol);

    const NICK_KEY = 'neonMPNick';
    const LASTROOM_KEY = 'neonMPLastRoom';

    // Modes the lobby currently knows about. Co-op and versus are
    // declared here so the UI selector can list them, even before the
    // implementation lands — the runtime just refuses to start them.
    const MODES = ['race', 'coop', 'versus'];

    // Build a room code from cryptographic randomness when available,
    // otherwise from Math.random + a salt of Date.now to make
    // collisions vanishingly unlikely. The room code is also the
    // world seed, so we want each host's room to be effectively unique.
    function generateRoomCode() {
        const alphabet = protocol.ROOM_ALPHABET;
        const len = 6;
        let out = '';
        if (typeof globalThis !== 'undefined' && globalThis.crypto && globalThis.crypto.getRandomValues) {
            const buf = new Uint32Array(len);
            globalThis.crypto.getRandomValues(buf);
            for (let i = 0; i < len; i++) {
                out += alphabet[buf[i] % alphabet.length];
            }
        } else {
            // Fallback: Math.random salted with time. Not used in tests
            // because tests inject the code, but kept robust.
            const t = (Date.now() | 0).toString(36);
            for (let i = 0; i < len; i++) {
                const r = (Math.random() * alphabet.length) | 0;
                out += alphabet[(r + t.charCodeAt(i % t.length)) % alphabet.length];
            }
        }
        return out;
    }

    // Normalises whatever the player typed: upper-case, strips
    // non-alphabet chars (so they can paste with dashes / spaces), then
    // validates. Returns { ok, code, reason }.
    function parseRoomCode(raw) {
        if (typeof raw !== 'string') return { ok: false, reason: 'empty' };
        let s = raw.toUpperCase().replace(/[^A-Z2-9]/g, '');
        // Strip ambiguous letters the alphabet already excludes.
        s = s.replace(/[IO01]/g, '');
        if (s.length === 0) return { ok: false, reason: 'empty' };
        if (s.length !== 6) return { ok: false, reason: 'length' };
        if (!protocol.isValidRoomCode(s)) return { ok: false, reason: 'alphabet' };
        return { ok: true, code: s };
    }

    // Nicknames: 3-12 chars, A-Z and digits. Anything else gets folded
    // into '?'. Empty input falls back to a random-letter default.
    function sanitiseNick(raw) {
        let s = typeof raw === 'string' ? raw.toUpperCase() : '';
        s = s.replace(/[^A-Z0-9]/g, '').slice(0, 12);
        if (s.length === 0) {
            // Stable fallback so tests don't have to inject crypto.
            const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
            const seed = Math.floor(Math.random() * alphabet.length);
            s = 'P' + alphabet[seed] + Math.floor(Math.random() * 100).toString().padStart(2, '0');
        }
        if (s.length < 3) s = (s + 'XYZ').slice(0, 3);
        return s;
    }

    // localStorage helpers — silent on quota / privacy failures (the
    // lobby still works without persisted state, just less convenient).
    function safeRead(key) {
        try { return globalThis.localStorage && globalThis.localStorage.getItem(key); }
        catch (_) { return null; }
    }
    function safeWrite(key, val) {
        try { globalThis.localStorage && globalThis.localStorage.setItem(key, val); }
        catch (_) { /* swallow */ }
    }

    function loadNick() {
        const saved = safeRead(NICK_KEY);
        return saved ? sanitiseNick(saved) : sanitiseNick('');
    }
    function saveNick(nick) {
        safeWrite(NICK_KEY, sanitiseNick(nick));
    }
    function loadLastRoom() {
        const saved = safeRead(LASTROOM_KEY);
        if (!saved) return null;
        const r = parseRoomCode(saved);
        return r.ok ? r.code : null;
    }
    function saveLastRoom(code) {
        const r = parseRoomCode(code);
        if (r.ok) safeWrite(LASTROOM_KEY, r.code);
    }

    function isValidMode(mode) { return MODES.indexOf(mode) >= 0; }

    const api = {
        MODES,
        generateRoomCode,
        parseRoomCode,
        sanitiseNick,
        loadNick, saveNick,
        loadLastRoom, saveLastRoom,
        isValidMode,
    };
    if (typeof window !== 'undefined') window.NeonMP = Object.assign(window.NeonMP || {}, { lobby: api });
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();
