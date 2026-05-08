// Seeded PRNG injection script.
// Runs via page.addInitScript before any game code loads.
// Overrides Math.random to use a deterministic mulberry32 PRNG with a fixed seed.

function createSeededRng(seed) {
    return function() {
        seed |= 0;
        seed = seed + 0x6D2B79F5 | 0;
        let t = Math.imul(seed ^ seed >>> 15, 1 | seed);
        t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
        return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
}

// Global PRNG instance created once per page load.
// All Math.random() calls will consume from this instance.
const _deterministicRng = createSeededRng(window._SEED || 12345);

// Override Math.random to use our seeded PRNG.
const _origMathRandom = Math.random;
Math.random = function() {
    return _deterministicRng();
};

// Expose on window for debugging / inspection.
window._deterministicRng = _deterministicRng;
