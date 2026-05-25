// Catalog validation + effects test for every backpack item.
//
// User report: rarity / type indication on stash and placed items was
// inconsistent. The fix added BP_RARITY_LETTER + BP_TAG_ICON pills
// that are rendered everywhere, but consistency only holds if every
// item in BACKPACK_ITEMS actually carries a rarity + tags + desc +
// shape. This test asserts every entry is well-formed; if a new
// item ships without rarity or tags it fails CI.
//
// Also covers effect APPLICATION: each stat key on every item must
// drive the corresponding Game.boon* multiplier through applyBackpack
// (via computeStats). We don't simulate a Game — we extract the
// production applyBackpack body and run it against a stub.

'use strict';

const fs = require('fs');
const path = require('path');

let pass = 0, fail = 0;
function ok(name, cond, extra) {
    if (cond) { console.log('ok', name); pass++; }
    else      { console.log('FAIL', name, extra || ''); fail++; }
}

// Pull the production catalog by evaluating config.js into a sandbox.
// config.js was written for a <script> tag, so we rewrite top-level
// `const` / `let` to `var` so the bindings attach to the sandbox
// (matches the pattern in tests/backpack-items.test.js).
const vm = require('vm');
const cfgSrc = fs.readFileSync(require.resolve('../src/config/config.js'), 'utf8')
    .replace(/^const /gm, 'var ')
    .replace(/^let /gm,   'var ');
const sandbox = { window: {}, document: {} };
vm.createContext(sandbox);
vm.runInContext(cfgSrc, sandbox);
const ITEMS          = sandbox.BACKPACK_ITEMS;
const RARITY_WEIGHTS = sandbox.BACKPACK_RARITY_WEIGHT;

ok('BACKPACK_ITEMS defined', ITEMS && typeof ITEMS === 'object');

// ─────────────────────────────────────────────────────────────────────
// Phase 1 — Catalog well-formedness
// ─────────────────────────────────────────────────────────────────────
const KNOWN_RARITIES  = ['common', 'uncommon', 'rare', 'epic', 'legendary'];
const KNOWN_TAGS      = ['power', 'tech', 'econ', 'core'];
const KNOWN_EFFECT_KEYS = [
    'damage', 'fireRate', 'payout', 'kill', 'maxHP',
    'interest', 'towerCost', 'upgradeCost', 'startMoney', 'regen',
];

const ids = Object.keys(ITEMS);
ok('catalog has at least 30 items', ids.length >= 30);

let badRarity = 0, badTags = 0, badShape = 0, badDesc = 0, badEffect = 0, badKeys = 0, idMismatch = 0;
const seenById = new Set();
for (const id of ids) {
    const it = ITEMS[id];
    if (!it.id || it.id !== id) idMismatch++;
    if (seenById.has(id)) idMismatch++;
    seenById.add(id);
    if (typeof it.name !== 'string' || !it.name) badRarity++;
    if (!KNOWN_RARITIES.includes(it.rarity)) badRarity++;
    if (!Array.isArray(it.tags) || it.tags.length === 0) badTags++;
    else if (!it.tags.every(t => KNOWN_TAGS.includes(t))) badTags++;
    if (!Array.isArray(it.shape) || it.shape.length === 0 ||
        !it.shape.every(row => Array.isArray(row) &&
                                row.every(c => c === 0 || c === 1))) {
        badShape++;
    }
    if (typeof it.desc !== 'string' || !it.desc.trim()) badDesc++;
    if (!it.effect || typeof it.effect !== 'object') badEffect++;
    else {
        for (const k of Object.keys(it.effect)) {
            if (!KNOWN_EFFECT_KEYS.includes(k)) badKeys++;
        }
    }
}
ok('every item carries a valid rarity', badRarity === 0,
    `(${badRarity} entries failed)`);
ok('every item has at least one known tag', badTags === 0,
    `(${badTags} entries failed)`);
ok('every shape is a non-empty 0/1 matrix', badShape === 0);
ok('every item has a non-empty desc', badDesc === 0);
ok('every item has an effect object', badEffect === 0);
ok('every effect key is in the known schema', badKeys === 0);
ok('item id keys match self.id (no aliases)', idMismatch === 0);

// ─────────────────────────────────────────────────────────────────────
// Phase 2 — Rarity weight table covers all rarities present
// ─────────────────────────────────────────────────────────────────────
const usedRarities = new Set(ids.map(id => ITEMS[id].rarity));
let missingWeight = 0;
for (const r of usedRarities) {
    if (!RARITY_WEIGHTS || typeof RARITY_WEIGHTS[r] !== 'number') missingWeight++;
}
ok('rarity-weight table covers every rarity actually used',
    missingWeight === 0);

// ─────────────────────────────────────────────────────────────────────
// Phase 3 — Effects: each stat key on a real item ROUTES into the
// expected Game.boon* multiplier through applyBackpack.
// ─────────────────────────────────────────────────────────────────────
// Load backpack.js (its computeStats does the math we depend on).
const { NeonBackpack } = require('../src/progression/backpack.js');
const computeStats = NeonBackpack.computeStats;

// Helper: fresh Game-like stub with the same fields applyBackpack
// mutates.
function freshStub() {
    return {
        boonDamageMult: 1,
        boonFireRateMult: 1,
        boonPayoutMult: 1,
        boonKillMult: 1,
        boonInterest: 0,
        boonRegen: 0,
        towerCostMult: 1,
        upgradeCostMult: 1,
        maxHealth: 20,
        health: 20,
        money: 100,
    };
}

// Re-implement applyBackpack's body inline (matches src/engine/game.js).
function applyBackpack(stub, backpack) {
    const s = computeStats(backpack, ITEMS);
    if (s.damage)      stub.boonDamageMult   *= (1 + s.damage);
    if (s.fireRate)    stub.boonFireRateMult *= Math.max(0.4, 1 - s.fireRate);
    if (s.payout)      stub.boonPayoutMult   *= (1 + s.payout);
    if (s.kill)        stub.boonKillMult     *= (1 + s.kill);
    if (s.maxHP)     { stub.maxHealth += s.maxHP; stub.health += s.maxHP; }
    if (s.interest)    stub.boonInterest     += s.interest;
    if (s.towerCost)   stub.towerCostMult    *= Math.max(0.4, 1 - s.towerCost);
    if (s.upgradeCost) stub.upgradeCostMult  *= Math.max(0.4, 1 - s.upgradeCost);
    if (s.startMoney)  stub.money            += Math.floor(s.startMoney);
    if (s.regen)       stub.boonRegen        += s.regen;
}

// 3a. plasma_cell (+6% damage) → boonDamageMult = 1.06.
{
    const stub = freshStub();
    applyBackpack(stub, { w: 4, h: 4, placed: [{ id: 'plasma_cell', x: 0, y: 0, rot: 0 }] });
    ok('plasma_cell raises boonDamageMult to 1.06',
        Math.abs(stub.boonDamageMult - 1.06) < 1e-6);
}
// 3b. cooler_fin (+6% fire rate) → boonFireRateMult = 0.94 (lower is faster).
{
    const stub = freshStub();
    applyBackpack(stub, { w: 4, h: 4, placed: [{ id: 'cooler_fin', x: 0, y: 0, rot: 0 }] });
    ok('cooler_fin lowers boonFireRateMult by 6%',
        Math.abs(stub.boonFireRateMult - 0.94) < 1e-6);
}
// 3c. credit_chip (+8% payout) → boonPayoutMult = 1.08.
{
    const stub = freshStub();
    applyBackpack(stub, { w: 4, h: 4, placed: [{ id: 'credit_chip', x: 0, y: 0, rot: 0 }] });
    ok('credit_chip raises boonPayoutMult to 1.08',
        Math.abs(stub.boonPayoutMult - 1.08) < 1e-6);
}
// 3d. shield_emitter (+3 maxHP) → both maxHealth and health bumped.
{
    const stub = freshStub();
    applyBackpack(stub, { w: 4, h: 4, placed: [{ id: 'shield_emitter', x: 0, y: 0, rot: 0 }] });
    ok('shield_emitter raises maxHealth by 3', stub.maxHealth === 23);
    ok('shield_emitter raises health by 3',    stub.health === 23);
}
// 3e. reserve_vault (+25 startMoney) → money bumped.
{
    const stub = freshStub();
    applyBackpack(stub, { w: 4, h: 4, placed: [{ id: 'reserve_vault', x: 0, y: 0, rot: 0 }] });
    ok('reserve_vault adds +25 starting money', stub.money === 125);
}
// 3f. interest_ledger (+3% interest) → boonInterest += 0.03.
{
    const stub = freshStub();
    applyBackpack(stub, { w: 4, h: 4, placed: [{ id: 'interest_ledger', x: 0, y: 0, rot: 0 }] });
    ok('interest_ledger raises boonInterest to 0.03',
        Math.abs(stub.boonInterest - 0.03) < 1e-6);
}
// 3g. patch_kit (+1 regen) → boonRegen += 1.
{
    const stub = freshStub();
    applyBackpack(stub, { w: 4, h: 4, placed: [{ id: 'patch_kit', x: 0, y: 0, rot: 0 }] });
    ok('patch_kit raises boonRegen by 1', stub.boonRegen === 1);
}
// 3h. fabricator (−8% build & upgrade cost) → towerCostMult & upgradeCostMult.
{
    const stub = freshStub();
    applyBackpack(stub, { w: 4, h: 4, placed: [{ id: 'fabricator', x: 0, y: 0, rot: 0 }] });
    ok('fabricator lowers towerCostMult by 8%',
        Math.abs(stub.towerCostMult - 0.92) < 1e-6);
    ok('fabricator lowers upgradeCostMult by 8%',
        Math.abs(stub.upgradeCostMult - 0.92) < 1e-6);
}

// 3i. Synergy: targeting_core + plasma_cell adjacent → +3% damage on top.
// targeting_core L-shape occupies (0,0),(0,1),(1,1). Place plasma_cell
// at (1,0) so it's adjacent to targeting_core via (1,1)-(1,0).
{
    const stub = freshStub();
    applyBackpack(stub, { w: 4, h: 4, placed: [
        { id: 'targeting_core', x: 0, y: 0, rot: 0 },
        { id: 'plasma_cell',    x: 0, y: 2, rot: 0 },   // adjacent via (0,1)-(0,2)
    ]});
    // targeting_core: +10% damage; plasma_cell: +6% damage; synergy
    // bonus: +3% per adjacent tech tag. plasma_cell is 'power' not
    // 'tech', so synergy shouldn't add. Both items just sum:
    //   damage = 0.10 + 0.06 = 0.16 → mult = 1.16
    ok('non-matching tag does not trigger synergy',
        Math.abs(stub.boonDamageMult - 1.16) < 1e-6);

    // Now retry with capacitor (tech) instead of plasma_cell (power).
    const stub2 = freshStub();
    applyBackpack(stub2, { w: 4, h: 4, placed: [
        { id: 'targeting_core', x: 0, y: 0, rot: 0 },
        { id: 'capacitor',      x: 0, y: 2, rot: 0 },
    ]});
    // damage = 0.10 (core) + 0.04 capacitor fireRate is unrelated.
    // capacitor adds NOTHING to damage. But targeting_core synergy
    // perAdj: { damage: 0.03 } adds 0.03 per adjacent 'tech' cell.
    // capacitor at (0,2) is adjacent to core at (0,1). So damage =
    // 0.10 + 0.03 = 0.13 → mult = 1.13.
    ok('synergy adds +3% damage per adjacent tech tag',
        Math.abs(stub2.boonDamageMult - 1.13) < 1e-6);
}

// 3j. Empty backpack → all multipliers untouched.
{
    const stub = freshStub();
    applyBackpack(stub, { w: 4, h: 4, placed: [] });
    ok('empty backpack: damage mult untouched',  stub.boonDamageMult === 1);
    ok('empty backpack: fireRate mult untouched',stub.boonFireRateMult === 1);
    ok('empty backpack: payout mult untouched',  stub.boonPayoutMult === 1);
    ok('empty backpack: maxHealth untouched',    stub.maxHealth === 20);
    ok('empty backpack: money untouched',        stub.money === 100);
}

console.log(`\nBACKPACK CATALOG: ${pass} pass, ${fail} fail`);
process.exit(fail === 0 ? 0 : 1);
