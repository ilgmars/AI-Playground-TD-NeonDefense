// Backpack logic + save-economy unit tests (node, no browser).
const assert = require('assert');
global.localStorage = { _d: {}, getItem(k){return this._d[k] ?? null;}, setItem(k,v){this._d[k]=v;} };
const { NeonBackpack: B } = require('../src/progression/backpack.js');
const { NeonSave } = require('../src/progression/save.js');

let pass = 0;
function ok(name, cond) { assert.ok(cond, name); console.log('ok', name); pass++; }

// Rotation: full circle returns to start; 90° changes footprint.
const L = [[1,0],[1,1]];
ok('rot4 == rot0', JSON.stringify(B.shapeOffsets(L,4)) === JSON.stringify(B.shapeOffsets(L,0)));
ok('rot1 differs', JSON.stringify(B.shapeOffsets(L,1)) !== JSON.stringify(B.shapeOffsets(L,0)));
ok('shapeSize rot1 swaps', (s => s.w === 2 && s.h === 2)(B.shapeSize(L,1)));

const ITEMS = {
  a: { id:'a', tags:['tech'], shape:[[1]], effect:{ damage:0.1 } },
  b: { id:'b', tags:['power'], shape:[[1]], effect:{ damage:0.1 },
       synergy:{ tags:['tech'], perAdj:{ damage:0.05 }, max:4 } },
  big: { id:'big', tags:['core'], shape:[[1,1],[1,1]], effect:{ maxHP:8 } },
};

// Placement / overlap / bounds.
let bp = { w:4, h:4, placed:[{id:'a',x:0,y:0,rot:0}], stash:[] };
ok('overlap rejected', B.canPlace(bp, ITEMS, ITEMS.b, 0,0,0) === false);
ok('free cell ok',     B.canPlace(bp, ITEMS, ITEMS.b, 1,0,0) === true);
ok('out of bounds rejected', B.canPlace(bp, ITEMS, ITEMS.big, 3,3,0) === false);
ok('2x2 in-bounds ok', B.canPlace(bp, ITEMS, ITEMS.big, 2,2,0) === true);

// Stats: base + adjacency synergy (b next to tech item a).
bp = { w:4, h:4, placed:[{id:'a',x:0,y:0,rot:0},{id:'b',x:1,y:0,rot:0}], stash:[] };
const st = B.computeStats(bp, ITEMS);
ok('adjacency synergy applied (0.25)', Math.abs(st.damage - 0.25) < 1e-9);

// Non-adjacent: no synergy (0.10 + 0.10).
bp = { w:4, h:4, placed:[{id:'a',x:0,y:0,rot:0},{id:'b',x:3,y:3,rot:0}], stash:[] };
ok('no synergy when apart (0.20)', Math.abs(B.computeStats(bp, ITEMS).damage - 0.20) < 1e-9);

// Empty backpack → all-zero stats (fresh save / harness must be unaffected).
const zero = B.computeStats({ w:5,h:4,placed:[],stash:[] }, ITEMS);
ok('empty backpack is no-op', B.STAT_KEYS.every(k => zero[k] === 0));

// salvageRoll deterministic with a stub RNG (weighted).
const idr = B.salvageRoll({ x:{rarity:'common'}, y:{rarity:'rare'} }, { common:90, rare:10 }, () => 0.0);
ok('salvageRoll picks first bucket at r=0', idr === 'x');

// Save schema: fresh save has a backpack; salvage spends metaXP + stashes.
const s = NeonSave.createFreshSave();
ok('fresh save has backpack grid', s.backpack && s.backpack.w >= 1 && Array.isArray(s.backpack.stash));
s.metaXP = 100000;
const c1 = NeonSave.getSalvageCost(s);
const paid = NeonSave.salvage(s, 'plasma_cell');
ok('salvage deducts cost', paid === c1 && s.metaXP === 100000 - c1);
ok('salvage stashes item', s.backpack.stash[s.backpack.stash.length-1] === 'plasma_cell');
ok('salvage cost escalates', NeonSave.getSalvageCost(s) > c1);
s.metaXP = 0;
ok('salvage fails when poor', NeonSave.salvage(s, 'plasma_cell') === -1);

// Backfill tolerates a junk backpack.
const junk = NeonSave.createFreshSave();
junk.backpack = { w:'x', h:-3, placed:[{id:5},{id:'plasma_cell',x:1,y:2,rot:9}], stash:['credit_chip', 7] };
NeonSave.load && NeonSave.write(junk);
const { NeonSave: NS2 } = require('../src/progression/save.js');
NS2.write(junk); // triggers nothing; call backfill via load path:
const reloaded = JSON.parse(localStorage.getItem(NS2.KEY) || '{}');
ok('junk backpack sanitised on load', (() => {
  localStorage.setItem(NS2.KEY, JSON.stringify(junk));
  const L2 = NS2.load();
  return L2.backpack.w >= 1 && L2.backpack.h >= 1 &&
         L2.backpack.placed.every(p => typeof p.id === 'string' && p.rot >= 0 && p.rot < 4) &&
         L2.backpack.stash.every(x => typeof x === 'string');
})());

// ── Iteration 2: loot rarity bias, grantItem, bag expansion ──────────────
const RIT = { a:{rarity:'common'}, b:{rarity:'uncommon'}, r:{rarity:'rare'} };
let lc = { common:0, uncommon:0, rare:0 };
let seed = 7; const rng = () => { seed=(seed*1664525+1013904223)%4294967296; return seed/4294967296; };
for (let i=0;i<4000;i++) lc[RIT[B.lootRoll(RIT, 6, rng)].rarity]++;
ok('high luck biases away from common', lc.common < lc.uncommon && lc.common < lc.rare);
let lc0 = { common:0, uncommon:0, rare:0 };
for (let i=0;i<4000;i++) lc0[RIT[B.lootRoll(RIT, 0, rng)].rarity]++;
ok('luck 0 is common-dominant', lc0.common > lc0.rare);

const g = NeonSave.createFreshSave(); g.metaXP = 1e7;
ok('grantItem stashes (no XP cost)', NeonSave.grantItem(g,'plasma_cell') === true &&
   g.backpack.stash.includes('plasma_cell') && g.metaXP === 1e7);
ok('grantItem rejects non-string', NeonSave.grantItem(g, 42) === false);

const e1 = NeonSave.getExpandCost(g);
const epaid = NeonSave.expandBackpack(g, 'w');
ok('expand grows width + charges', epaid === e1 && g.backpack.w === 3 && g.metaXP === 1e7 - e1);
ok('expand cost escalates', NeonSave.getExpandCost(g) > e1);
g.backpack.w = 9;
ok('expand capped at max width', NeonSave.expandBackpack(g,'w') === -1);
g.metaXP = 0;
ok('expand fails when poor', NeonSave.expandBackpack(g,'h') === -1);

// ── Salvage Luck sink ────────────────────────────────────────────────────
const LS = NeonSave.createFreshSave();
ok('luck booster locked at fresh save', NeonSave.luckBoostUnlocked(LS) === false);
ok('locked buy returns -1', NeonSave.buyLuckBoost(LS) === -1);
LS.maxWaveReached = 25; LS.metaXP = 1e7;
ok('reaching wave 20 unlocks the booster', NeonSave.luckBoostUnlocked(LS) === true);
const luckCost0 = NeonSave.getLuckBoostCost(LS);
const paidL = NeonSave.buyLuckBoost(LS);
ok('first luck buy deducts cost + rank++',
   paidL === luckCost0 && LS.backpack.luckBoost === 1 && LS.metaXP === 1e7 - luckCost0);
ok('luck cost escalates after a buy', NeonSave.getLuckBoostCost(LS) > luckCost0);
const luckCost1 = NeonSave.getLuckBoostCost(LS);
ok('luck cost grows geometrically (≈ ×1.35)', luckCost1 / luckCost0 > 1.25 && luckCost1 / luckCost0 < 1.50);
LS.metaXP = 0;
ok('luck buy fails when poor', NeonSave.buyLuckBoost(LS) === -1);

// ── Sell refund ──────────────────────────────────────────────────────────
ok('refund table common = 100',   NeonSave.getSellRefund('common')   === 100);
ok('refund table uncommon = 250', NeonSave.getSellRefund('uncommon') === 250);
ok('refund table rare = 500',     NeonSave.getSellRefund('rare')     === 500);
ok('refund 0 for unknown',        NeonSave.getSellRefund('mythic')   === 0);
const SS = NeonSave.createFreshSave(); SS.metaXP = 1000;
ok('sellItem credits metaXP', NeonSave.sellItem(SS, 'rare') === 500 && SS.metaXP === 1500);

console.log(`\nBACKPACK LOGIC: ${pass} checks passed`);
