// Performance regressions — measures throughput of the hot paths that
// run inside the game loop and the meta-progression layer.
//
//   • NeonAegis.fnv1a      — base hash; runs ~10 times per sentinel tick.
//   • NeonAegis.sign       — runs on every NeonSave.write + ND2 export.
//   • NeonBackpack.salvageRoll      — every SALVAGE click + every loot drop.
//   • NeonBackpack.computeStats     — once at Game construction.
//
// Each metric has a HARD MINIMUM — if throughput drops below it the
// suite fails. Floors are deliberately conservative (≈ half what an
// idle laptop manages) so the same numbers work on slower CI runners.
//
// Set WRITE_PERF_HISTORY=1 to append a timestamped entry to
// perf-history.json so the trend can be eyeballed locally.

const fs   = require('fs');
const path = require('path');
const cp   = require('child_process');

global.window = {};
const { NeonAegis }     = require('../src/security/aegis.js');
global.NeonAegis = NeonAegis;
global.localStorage = { _d:{}, getItem(k){return this._d[k]??null;}, setItem(k,v){this._d[k]=v;}, removeItem(k){delete this._d[k];} };
const { NeonSave }      = require('../src/progression/save.js');
const { NeonBackpack: B } = require('../src/progression/backpack.js');

const vm = require('vm');
const sandbox = { window: {}, document: {}, Math, console };
vm.createContext(sandbox);
vm.runInContext(
    fs.readFileSync(path.join(__dirname, '..', 'src/config/config.js'), 'utf8')
      .replace(/^const /gm, 'var ').replace(/^let /gm, 'var '),
    sandbox);
const BACKPACK_ITEMS = sandbox.BACKPACK_ITEMS;
const BACKPACK_RARITY_WEIGHT = sandbox.BACKPACK_RARITY_WEIGHT;

function bench(label, fn, minMs = 200) {
    // Warm-up run (V8 inlining + IC stabilisation).
    const warmStart = process.hrtime.bigint();
    let warmOps = 0;
    while (Number(process.hrtime.bigint() - warmStart) / 1e6 < 60) { fn(); warmOps++; }
    // Measured run.
    let ops = 0;
    const start = process.hrtime.bigint();
    while (Number(process.hrtime.bigint() - start) / 1e6 < minMs) { fn(); ops++; }
    const elapsedMs = Number(process.hrtime.bigint() - start) / 1e6;
    const opsPerSec = Math.round((ops / elapsedMs) * 1000);
    return { label, ops, elapsedMs: Math.round(elapsedMs), opsPerSec };
}

// ── Build representative inputs ───────────────────────────────────────
const SIGN_PAYLOAD = JSON.stringify(NeonSave.createFreshSave()) + '_' + 'x'.repeat(1024);
const HASH_PAYLOAD = SIGN_PAYLOAD;
const ids = Object.keys(BACKPACK_ITEMS);
const fullBackpack = {
    w: 12, h: 8, placed: ids.map((id, i) => ({ id, x: (i % 6) * 2, y: Math.floor(i / 6) * 2, rot: 0 })),
    stash: [], luckBoost: 0,
};
// Trim placements that overflow the 12×8 grid bounds.
fullBackpack.placed = fullBackpack.placed.filter(p => {
    const def = BACKPACK_ITEMS[p.id];
    return B.canPlace(fullBackpack, BACKPACK_ITEMS, def, p.x, p.y, 0);
});

let rngState = 1;
const rng = () => { rngState = (rngState * 1664525 + 1013904223) % 4294967296; return rngState / 4294967296; };

const results = [
    bench('fnv1a',         () => NeonAegis.fnv1a(HASH_PAYLOAD)),
    bench('sign',          () => NeonAegis.sign(SIGN_PAYLOAD)),
    bench('salvageRoll',   () => B.salvageRoll(BACKPACK_ITEMS, BACKPACK_RARITY_WEIGHT, rng)),
    bench('lootRoll@L5',   () => B.lootRoll(BACKPACK_ITEMS, 5, rng)),
    bench('computeStats',  () => B.computeStats(fullBackpack, BACKPACK_ITEMS)),
];

// ── Minimum acceptable performance rating (ops/sec) ──────────────────
//   Numbers measured on a modest laptop divided by ~2-3× for slack on
//   slower CI runners. If a regression makes one of these drop below
//   the floor, the test fails and the runner stops the build.
// Minimums sit at roughly 1/3 of the throughput observed on the dev
// laptop (May 2026) so the same numbers still pass on the slower
// shared GitHub Actions runners. Regressions ≥ 3× will trip the gate.
const MIN_OPS = {
    fnv1a:         40000,    // observed ~130k on dev
    sign:          15000,    // observed ~44k  on dev (three FNV passes per call)
    salvageRoll:   60000,    // observed ~190k on dev
    'lootRoll@L5': 60000,    // observed ~200k on dev
    computeStats: 200000,    // observed ~2.1M on dev (66-item grid)
};

let allOk = true;
console.log('label                ops/sec       (min)       runtime');
console.log('─────────────────────────────────────────────────────────');
for (const r of results) {
    const min = MIN_OPS[r.label] || 0;
    const status = r.opsPerSec >= min ? '✓' : '✗';
    if (r.opsPerSec < min) allOk = false;
    console.log(`${status} ${r.label.padEnd(17)} ${String(r.opsPerSec).padStart(10)}   ${String(min).padStart(8)}    ${r.elapsedMs}ms`);
}
console.log('');

// ── History tracking ────────────────────────────────────────────────
if (process.env.WRITE_PERF_HISTORY === '1') {
    const histPath = path.join(__dirname, '..', 'perf-history.json');
    let history = [];
    try { history = JSON.parse(fs.readFileSync(histPath, 'utf8')); } catch (_) {}
    let sha = '';
    try { sha = cp.execSync('git rev-parse --short HEAD', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim(); } catch (_) {}
    history.push({
        ts: new Date().toISOString(),
        sha,
        node: process.version,
        platform: process.platform,
        metrics: Object.fromEntries(results.map(r => [r.label, r.opsPerSec])),
    });
    fs.writeFileSync(histPath, JSON.stringify(history, null, 2) + '\n');
    console.log(`(appended to ${path.relative(process.cwd(), histPath)} — ${history.length} entries)`);
} else {
    console.log('(set WRITE_PERF_HISTORY=1 to append to perf-history.json)');
}

console.log(allOk ? '\nPERF: all metrics above minimum' : '\nPERF: at least one metric BELOW minimum — see ✗ above');
process.exit(allOk ? 0 : 1);
