// Tech Tree v2 logic — node unit tests (no browser). Drives the real
// NeonTree + NeonSave + config code paths by evaluating the three source
// files into one sandbox (the ascension.test.js pattern). Covers:
//   * prerequisite gating + variable per-node base cost,
//   * the global escalating cost (each skill pricier than the last),
//   * computeStats summing (incl. keystone downsides) + empty no-op,
//   * grant ids pushed to unlockedNodes for existing consumers,
//   * respec: 30% refund, treeSpent accounting, protected nodes kept,
//   * one-time v2 migration: refund + clear old nodes, idempotent.
const assert = require('assert');
const path = require('path');
const fs   = require('fs');
const vm   = require('vm');

const sandbox = {
    window: {}, document: {}, Math, console, JSON, Object, Array, Number,
    Buffer,
    localStorage: { _d: {}, getItem(k){return this._d[k] ?? null;}, setItem(k,v){this._d[k]=v;}, removeItem(k){delete this._d[k];} }
};
vm.createContext(sandbox);
for (const file of ['src/config/config.js', 'src/progression/save.js', 'src/progression/tree.js']) {
    vm.runInContext(
        fs.readFileSync(path.join(__dirname, '..', file), 'utf8')
          .replace(/^const /gm, 'var ').replace(/^let /gm, 'var '),
        sandbox);
}
const { NeonTree, NeonSave, TECH_TREE, TREE_RESPEC_REFUND } = sandbox;

let pass = 0, fail = 0;
function ok(name, cond, extra) {
    if (cond) { console.log('ok', name); pass++; }
    else      { console.log('FAIL', name, extra === undefined ? '' : JSON.stringify(extra)); fail++; }
}
function fresh(xp) { const s = NeonSave.createFreshSave(); s.metaXP = xp || 0; return s; }

// ── Tree shape (the spec asks for ≥50 clustered nodes) ──────────────────
const ids = Object.keys(TECH_TREE);
ok('tree has at least 50 skills', ids.length >= 50, ids.length);
const branches = new Set(ids.map(id => TECH_TREE[id].branch));
ok('skills are clustered into multiple branches', branches.size >= 5, [...branches]);
ok('costs are variable (not all the same)',
    new Set(ids.map(id => TECH_TREE[id].baseCost)).size > 3);

// ── Prerequisite gating ─────────────────────────────────────────────────
let s = fresh(100000);
ok('root node (no prereqs) is purchasable', NeonTree.canPurchase(s, 'off_dmg1').ok);
ok('node with unmet prereq is locked', NeonTree.canPurchase(s, 'off_dmg2').ok === false);
ok('locked reason mentions prerequisites', /prerequisit/i.test(NeonTree.canPurchase(s, 'off_dmg2').reason));
NeonTree.purchase(s, 'off_dmg1');
ok('prereq satisfied unlocks the dependent node', NeonTree.canPurchase(s, 'off_dmg2').ok);

// ── Variable base cost ──────────────────────────────────────────────────
const s2 = fresh(100000);
ok('cheap vs deep node costs differ (variable cost)',
    NeonTree.effectiveCost(s2, 'off_dmg1') < NeonTree.effectiveCost(s2, 'asc_singularity'));

// ── Escalating cost: each owned skill makes the next pricier ────────────
const baseCost = NeonTree.effectiveCost(fresh(0), 'asc_singularity');
const loaded = fresh(0);
// Own 12 real allocatable nodes (escalation counts these; pre-unlocks don't).
['off_dmg1','off_dmg2','off_dmg3','off_dmg4','off_rate1','off_rate2',
 'eco_pay1','eco_pay2','eco_kill1','def_hp1','def_hp2','def_reg1'
].forEach(id => loaded.unlockedNodes.push(id));
const escalated = NeonTree.effectiveCost(loaded, 'asc_singularity');
ok('cost escalates with owned-node count', escalated > baseCost * 1.4, { baseCost, escalated });
ok('pre-unlocks do NOT count toward escalation',
    NeonTree.allocatedCount(fresh(0)) === 0);

// ── Insufficient XP rejected ────────────────────────────────────────────
ok('too-poor purchase rejected', NeonTree.canPurchase(fresh(5), 'off_dmg1').ok === false);
ok('too-poor reason is XP', /XP/i.test(NeonTree.canPurchase(fresh(5), 'off_dmg1').reason));

// ── treeSpent accounting + grant ids ────────────────────────────────────
const s3 = fresh(100000);
const c1 = NeonTree.canPurchase(s3, 'off_dmg1').cost;
NeonTree.purchase(s3, 'off_dmg1');
ok('treeSpent tracks exact XP paid', s3.treeSpent === c1, { treeSpent: s3.treeSpent, c1 });
NeonTree.purchase(s3, 'ars_scan');     // grants ability.scan
ok('purchasing a grant node exposes its grant id to consumers',
    NeonSave.hasUnlocked(s3, 'ability.scan'));

// ── computeStats: summed effects, downsides, empty ──────────────────────
ok('fresh save sums to no passives (no-op)',
    Object.keys(NeonTree.computeStats(fresh(0))).length === 0);
const sStats = fresh(0);
sStats.unlockedNodes.push('off_dmg1', 'off_dmg2', 'off_rate1');  // +.05 +.06 dmg, +.05 rate
const stats = NeonTree.computeStats(sStats);
ok('computeStats sums damage across owned nodes', Math.abs(stats.damage - 0.11) < 1e-9, stats);
ok('computeStats sums fire rate', Math.abs(stats.fireRate - 0.05) < 1e-9, stats);
const sKey = fresh(0); sKey.unlockedNodes.push('off_key');
ok('keystone downside is a negative effect value',
    NeonTree.computeStats(sKey).towerCost < 0);
ok('grant-only nodes contribute no passive stats',
    Object.keys(NeonTree.computeStats((x => { x.unlockedNodes.push('ars_scan'); return x; })(fresh(0)))).length === 0);

// ── Respec: 30% refund, protected kept, escalation reset ────────────────
const r = fresh(100000);
NeonTree.purchase(r, 'off_dmg1');
NeonTree.purchase(r, 'off_dmg2');
NeonTree.purchase(r, 'ars_econ');        // grants kit.economist (also a protected ascension id)
r.unlockedNodes.push('kit.economist');   // simulate it ALSO being an ascension auto-grant
const spentBefore = r.treeSpent;
const xpBefore = r.metaXP;
const res = NeonTree.respec(r);
ok('respec refunds exactly 30% of spent', res.refund === Math.floor(spentBefore * TREE_RESPEC_REFUND), res);
ok('respec credits the refund to metaXP', r.metaXP === xpBefore + res.refund);
ok('respec resets treeSpent (escalation resets)', r.treeSpent === 0 && NeonTree.allocatedCount(r) === 0);
ok('respec clears bought tree nodes', !NeonSave.hasUnlocked(r, 'off_dmg1') && !NeonSave.hasUnlocked(r, 'ars_econ'));
ok('respec keeps pre-unlocks (hero.pioneer/kit.standard)',
    NeonSave.hasUnlocked(r, 'hero.pioneer') && NeonSave.hasUnlocked(r, 'kit.standard'));
ok('respec keeps a PROTECTED grant id even when its node is cleared',
    NeonSave.hasUnlocked(r, 'kit.economist'));
ok('respec strips a non-protected grant id', !NeonSave.hasUnlocked(fresh(0), 'ability.scan'));

// ── Migration: refund + clear old purchased nodes, idempotent ───────────
const old = NeonSave.createFreshSave();
old.treeV2Migrated = false;
old.metaXP = 100;
old.treeSpent = 0;
old.unlockedNodes = ['hero.pioneer', 'kit.standard', 'kit.economist',
                     'hero.engineer', 'ability.scan', 'ability.freeze'];
const refunded = NeonTree.migrateV2(old);
ok('migration refunds old node costs (50+50+500)', refunded === 600, refunded);
ok('migration credits metaXP', old.metaXP === 700, old.metaXP);
ok('migration clears old purchased nodes',
    !NeonSave.hasUnlocked(old, 'hero.engineer') && !NeonSave.hasUnlocked(old, 'ability.freeze'));
ok('migration keeps pre-unlocks + protected ascension grants',
    NeonSave.hasUnlocked(old, 'hero.pioneer') && NeonSave.hasUnlocked(old, 'kit.economist'));
ok('migration sets the done flag', old.treeV2Migrated === true);
const xpAfterMigrate = old.metaXP;
ok('migration is idempotent (re-run is a no-op)',
    NeonTree.migrateV2(old) === 0 && old.metaXP === xpAfterMigrate);

console.log(`\nTREE LOGIC: ${pass} pass, ${fail} fail`);
process.exit(fail === 0 ? 0 : 1);
