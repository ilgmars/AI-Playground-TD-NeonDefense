// Regression: scoreboard MERGE persists.
//
// User report: "scoreboard did not save the merged values, this needs
// tests. idea is that if player appears online, their scores are
// shared and other players keep them to share further"
//
// We assert that:
//   1. save.globalCache is a defined field (schema-level).
//   2. backfillV1Fields fills it in for old saves.
//   3. Manually persisting a snapshot into save.globalCache survives
//      a round-trip through localStorage (NeonSave.write → load).
//   4. The cache structure is per-tier keyed by 'a' + N, matching
//      the same shape as save.highScores so render code can merge.

'use strict';

let pass = 0, fail = 0;
function ok(name, cond, extra) {
    if (cond) { console.log('ok', name); pass++; }
    else      { console.log('FAIL', name, extra || ''); fail++; }
}

global.window = {};
global.localStorage = {
    _d: {},
    getItem(k) { return this._d[k] ?? null; },
    setItem(k, v) { this._d[k] = v; },
    removeItem(k) { delete this._d[k]; },
    clear() { this._d = {}; },
};
require('../src/security/aegis.js');
global.NeonAegis = global.window.NeonAegis;
const { NeonSave } = require('../src/progression/save.js');

// ── 1) Fresh save has globalCache as an empty object ────────────────
{
    const fresh = NeonSave.createFreshSave();
    ok('createFreshSave includes globalCache',
        fresh.globalCache && typeof fresh.globalCache === 'object');
    ok('fresh globalCache is empty',
        Object.keys(fresh.globalCache).length === 0);
}

// ── 2) An old save WITHOUT globalCache is backfilled on load ────────
{
    localStorage.clear();
    const ancient = {
        version: 'ND.v1',  // Force the load path to backfill.
        metaXP: 100,
        totalXPEarned: 100,
        ascensionCleared: 0,
        unlockedNodes: ['hero.pioneer', 'kit.standard'],
        towerMastery: {},
        highScores: {},
        // Deliberately NO globalCache.
    };
    NeonSave.write(ancient);
    const loaded = NeonSave.load();
    ok('loaded save gets globalCache backfilled',
        loaded.globalCache && typeof loaded.globalCache === 'object');
}

// ── 3) Persist a merged snapshot → reload → entries survive ─────────
{
    localStorage.clear();
    const s = NeonSave.createFreshSave();
    s.globalCache = {
        a0: [
            { name: 'ALICE', wave: 30, tier: 0, autopilot: false, retired: false, cheated: false, t: 1000 },
            { name: 'BOB',   wave: 25, tier: 0, autopilot: true,  retired: false, cheated: false, t: 900 },
        ],
        a2: [
            { name: 'PRO', wave: 120, tier: 2, autopilot: false, retired: true, cheated: false, t: 2000 },
        ],
    };
    NeonSave.write(s);

    const reloaded = NeonSave.load();
    ok('a0 cache survives round-trip',
        Array.isArray(reloaded.globalCache.a0) && reloaded.globalCache.a0.length === 2);
    ok('a2 cache survives round-trip',
        Array.isArray(reloaded.globalCache.a2) && reloaded.globalCache.a2.length === 1);
    ok('cached entry preserves name',
        reloaded.globalCache.a0[0].name === 'ALICE');
    ok('cached entry preserves wave',
        reloaded.globalCache.a0[0].wave === 30);
    ok('cached entry preserves autopilot tag',
        reloaded.globalCache.a0[1].autopilot === true);
    ok('cached entry preserves retired tag',
        reloaded.globalCache.a2[0].retired === true);
}

// ── 4) Cache key shape matches highScores: 'a' + tier ───────────────
{
    const s = NeonSave.createFreshSave();
    s.globalCache = { a0: [], a1: [], a2: [] };
    NeonSave.write(s);
    const reloaded = NeonSave.load();
    const keys = Object.keys(reloaded.globalCache).sort();
    ok('cache keys are "a" + tier (a0, a1, a2)',
        keys[0] === 'a0' && keys[1] === 'a1' && keys[2] === 'a2');
}

console.log(`\nGLOBAL CACHE PERSIST: ${pass} pass, ${fail} fail`);
process.exit(fail === 0 ? 0 : 1);
