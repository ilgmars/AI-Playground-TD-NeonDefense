// Validates every entry in BACKPACK_ITEMS is well-formed and exercises
// the pool through salvageRoll + lootRoll + computeStats. Catches typos,
// unknown stat keys, and bad shapes the moment a new item is added.
const assert = require('assert');
const path = require('path');
const fs = require('fs');

// Source config.js into a vm sandbox so its `const BACKPACK_ITEMS = ...`
// is reachable from node. We rewrite the top-level `const`/`let` to
// `var` so the bindings attach to the sandbox object — config.js is
// designed to run as a classic <script>, not a CommonJS module.
const vm = require('vm');
const configSrc = fs.readFileSync(path.join(__dirname, '..', 'src/config/config.js'), 'utf8')
    .replace(/^const /gm, 'var ')
    .replace(/^let /gm,   'var ');
const sandbox = { window: {}, document: {} };
vm.createContext(sandbox);
vm.runInContext(configSrc, sandbox);
const BACKPACK_ITEMS = sandbox.BACKPACK_ITEMS;
const BACKPACK_RARITY_WEIGHT = sandbox.BACKPACK_RARITY_WEIGHT;

const { NeonBackpack: B } = require('../src/progression/backpack.js');

let pass = 0, fail = 0;
function ok(name, cond) {
    if (cond) { console.log('ok', name); pass++; }
    else      { console.log('FAIL', name); fail++; }
}

const ids = Object.keys(BACKPACK_ITEMS);
ok('pool has 25+ items', ids.length >= 25);

const VALID_RARITIES = ['common', 'uncommon', 'rare', 'epic', 'legendary'];
const STAT_KEYS = new Set(B.STAT_KEYS);
const seenIds = new Set();

for (const id of ids) {
    const def = BACKPACK_ITEMS[id];
    ok(`[${id}] id matches key`, def.id === id);
    ok(`[${id}] name is non-empty string`, typeof def.name === 'string' && def.name.length > 0);
    ok(`[${id}] desc is non-empty string`, typeof def.desc === 'string' && def.desc.length > 0);
    ok(`[${id}] rarity is valid`, VALID_RARITIES.includes(def.rarity));
    ok(`[${id}] tags is non-empty array`, Array.isArray(def.tags) && def.tags.length > 0);

    // Shape is a rectangular 0/1 matrix with at least one 1.
    const sh = def.shape;
    const shapeOk = Array.isArray(sh) && sh.length > 0 && sh.every(r => Array.isArray(r) && r.length === sh[0].length && r.every(v => v === 0 || v === 1));
    ok(`[${id}] shape is a rectangular 0/1 matrix`, shapeOk);
    const cellCount = shapeOk ? sh.flat().filter(v => v === 1).length : 0;
    ok(`[${id}] shape has at least one occupied cell`, cellCount >= 1);

    ok(`[${id}] effect is object`, def.effect && typeof def.effect === 'object');
    for (const k of Object.keys(def.effect || {})) {
        ok(`[${id}] effect key '${k}' is in STAT_KEYS`, STAT_KEYS.has(k));
    }

    if (def.synergy) {
        ok(`[${id}] synergy.tags is non-empty array`, Array.isArray(def.synergy.tags) && def.synergy.tags.length > 0);
        ok(`[${id}] synergy.perAdj is object`, def.synergy.perAdj && typeof def.synergy.perAdj === 'object');
        for (const k of Object.keys(def.synergy.perAdj)) {
            ok(`[${id}] synergy.perAdj key '${k}' is in STAT_KEYS`, STAT_KEYS.has(k));
        }
        if (def.synergy.max !== undefined) {
            ok(`[${id}] synergy.max is positive int`, Number.isInteger(def.synergy.max) && def.synergy.max > 0);
        }
    }

    ok(`[${id}] id is unique`, !seenIds.has(id));
    seenIds.add(id);
}

// Rarity distribution sanity — every tier should be populated, with the
// higher tiers necessarily rarer than the lower ones in the pool.
const counts = { common: 0, uncommon: 0, rare: 0, epic: 0, legendary: 0 };
for (const id of ids) counts[BACKPACK_ITEMS[id].rarity]++;
ok('common pool has ≥ 12 items',    counts.common    >= 12);
ok('uncommon pool has ≥ 12 items',  counts.uncommon  >= 12);
ok('rare pool has ≥ 10 items',      counts.rare      >= 10);
ok('epic pool has ≥ 5 items',       counts.epic      >= 5);
ok('legendary pool has ≥ 3 items',  counts.legendary >= 3);

// salvageRoll should be able to reach every item id given enough samples.
// (Weighted by rarity; commons dominate, but uncommons + rares must still
// hit within a few thousand rolls.)
const hitIds = new Set();
let seed = 1; const rng = () => { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed / 4294967296; };
for (let i = 0; i < 20000; i++) hitIds.add(B.salvageRoll(BACKPACK_ITEMS, BACKPACK_RARITY_WEIGHT, rng));
ok('salvageRoll reaches every id in 20K samples', hitIds.size === ids.length);

// lootRoll at luck=8 should still cover the full pool over many samples.
const lootIds = new Set();
for (let i = 0; i < 20000; i++) lootIds.add(B.lootRoll(BACKPACK_ITEMS, 8, rng));
ok('lootRoll at luck=8 reaches every id', lootIds.size === ids.length);

// computeStats over a backpack containing one of every item shouldn't
// throw and should sum to non-negative values in each stat key.
const placed = [];
let cursor = 0;
for (const id of ids) {
    const def = BACKPACK_ITEMS[id];
    placed.push({ id, x: cursor, y: 0, rot: 0 });
    cursor += 5;       // far apart so adjacency synergies don't fire
}
const stats = B.computeStats({ w: cursor + 5, h: 10, placed, stash: [] }, BACKPACK_ITEMS);
ok('computeStats over full pool returns object', stats && typeof stats === 'object');
for (const k of B.STAT_KEYS) ok(`stat '${k}' is finite & non-negative`, Number.isFinite(stats[k]) && stats[k] >= 0);

console.log(`\nBACKPACK ITEMS: ${pass} pass, ${fail} fail (pool size ${ids.length})`);
process.exit(fail === 0 ? 0 : 1);
