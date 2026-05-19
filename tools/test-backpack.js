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

console.log(`\nBACKPACK LOGIC: ${pass} checks passed`);
