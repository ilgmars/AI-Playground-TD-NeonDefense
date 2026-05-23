// Seeded PRNG for multiplayer / replay determinism.
//
// In single-player Math.random is fine — players don't see each other's
// boon rolls. In co-op or versus we need both peers to land on the same
// boon pick / OVERCLOCK surge layout / loot roll given the same seed.
// Replacing Math.random with a room-seeded mulberry32 makes the whole
// gameplay surface deterministic for the duration of the room.
//
// Why this collides with Aegis: the security/aegis.js RNG sensor flags
// any Math.random swap as console tampering. The accommodation is the
// existing __neonAegisDev hatch (see multiplayer/anti-cheat.md). The
// caller MUST set window.__neonAegisDev = true BEFORE aegis.js runs;
// once aegis has snapshotted the original Math.random, the sensor is
// arm-locked and the swap will trip it.
//
// Usage (browser, before any other script tag):
//
//   <script>
//     // Read the room seed from a URL fragment or sessionStorage and
//     // install BEFORE aegis.js, otherwise the sensor will flag the swap.
//     const seed = window.__neonMPSeed | 0;
//     if (seed) {
//         window.__neonAegisDev = true;
//         // install seeded RNG inline so aegis snapshots the seeded fn.
//         // (Implementation matches NeonMP.prng.installFromSeed.)
//     }
//   </script>
//
// Test usage (Node): require('./prng.js').install(seed) — no Aegis on
// the server side, so the dev flag is irrelevant.

(function () {
    'use strict';

    // mulberry32 — same algorithm as src/engine/map.js so a room code
    // hashed via protocol.roomCodeToSeed produces a sequence identical
    // to the one map.js already produces for the same numeric seed.
    function mulberry32(seed) {
        let a = (seed | 0) >>> 0;
        return function () {
            a = (a + 0x6d2b79f5) | 0;
            let t = a;
            t = Math.imul(t ^ (t >>> 15), t | 1);
            t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
            return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
        };
    }

    // install: swap Math.random with a freshly-seeded generator.
    // Returns a restore() function the caller can invoke to put the
    // original Math.random back when leaving multiplayer.
    function install(seed) {
        const root = (typeof globalThis !== 'undefined') ? globalThis
                   : (typeof window !== 'undefined' ? window : (typeof global !== 'undefined' ? global : {}));
        if (!root.Math) return () => {};
        const rng = mulberry32(seed);
        const original = root.Math.random;
        root.Math.random = rng;
        return function restore() {
            try { root.Math.random = original; } catch (_) { /* swallow */ }
        };
    }

    // installFromRoomCode: convenience for the lobby flow — derive the
    // seed via protocol.roomCodeToSeed if available, otherwise FNV-1a
    // the string here so the same module works standalone in tests.
    function installFromRoomCode(roomCode) {
        const proto = (typeof require === 'function')
            ? require('./protocol.js')
            : (typeof window !== 'undefined' && window.NeonMP && window.NeonMP.protocol);
        const seed = proto && proto.roomCodeToSeed
            ? proto.roomCodeToSeed(roomCode)
            : fnv1a(String(roomCode).toUpperCase());
        return install(seed);
    }
    function fnv1a(s) {
        let h = 0x811c9dc5;
        for (let i = 0; i < s.length; i++) {
            h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193);
        }
        return h >>> 0;
    }

    const api = { mulberry32, install, installFromRoomCode };
    if (typeof window !== 'undefined') window.NeonMP = Object.assign(window.NeonMP || {}, { prng: api });
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();
