// Regression: co-op uses SPLIT economy — each peer pays for their
// OWN tower placements and upgrades, but both see the same field
// and the same monsters. A remote-source build/upgrade/sell/potion
// places/applies on the local sim but does NOT mutate local money.
//
// The earlier "shared everything" coop drained both peers' banks on
// every action because actions.applyInput ran the same buildTower
// path that subtracts cost. Now buildTower/upgradeTower/sellTower/
// buyPotion accept an opts.source === 'remote' switch and skip the
// money mutation for that case.

let pass = 0, fail = 0;
function ok(name, cond, extra) {
    if (cond) { console.log('ok', name); pass++; }
    else      { console.log('FAIL', name, extra || ''); fail++; }
}

// Pure-node logic test: load actions.applyInput + a fake Game and
// verify the source flag.
global.window = {};
global.SoundFX = { build(){}, upgrade(){}, error(){} };

// Minimal Game stub mirroring the production shape.
function makeGame(money) {
    return {
        money,
        towers: [],
        health: 20, maxHealth: 20,
        upgradeCostMult: 1,
        ascension: { potionHeal: null },
        potionHealBonus: 0,
        potionCount: 0,
        uiDirty: false,
        map: { isBuildable: () => true },
        getEffectiveTowerType: (t) => t,
        getTowerBuildCost: () => 50,
        getPotionCost: () => 30,
        _applyBoonsToNewTower: () => {},
        addUpgradeEffect: () => {},
        updateUpgradeMenu: () => {},
        selectedTowers: [],
    };
}

// We can't pull the real Game class easily (it depends on globals),
// so verify the contract on a recreated production shape directly.
// Re-import the relevant methods by eval'ing them into a class. The
// public surface (opts.source) is what we care about — the assertions
// confirm "remote" sources never debit money.
const fs = require('fs');
const gameSrc = fs.readFileSync(require.resolve('../src/engine/game.js'), 'utf8');

// Pull just the four method bodies and run them as standalone fns.
function extractMethod(name) {
    const re = new RegExp('(?:^|\\n)\\s{4}' + name + '\\(([^)]*)\\)\\s*{');
    const m = gameSrc.match(re);
    if (!m) throw new Error('not found: ' + name);
    const start = m.index + m[0].length;
    // Scan for the balanced }.
    let depth = 1;
    let i = start;
    while (i < gameSrc.length && depth > 0) {
        if (gameSrc[i] === '{') depth++;
        else if (gameSrc[i] === '}') depth--;
        i++;
    }
    const body = gameSrc.slice(start, i - 1);
    const args = m[1];
    // eslint-disable-next-line no-new-func
    return new Function('args', `return function (${args}) { ${body} }`)();
}

// Build a class-like shim with `this` bound to the Game stub.
function bind(methodFn, gameLike) {
    return (...args) => methodFn.apply(gameLike, args);
}

global.Tower = function (c, r, type) { this.c = c; this.r = r; this.type = type; };
global.POTION_CONFIG = { healAmount: 5 };

const buildTower   = extractMethod('buildTower');
const upgradeTower = extractMethod('upgradeTower');
const sellTower    = extractMethod('sellTower');
const buyPotion    = extractMethod('buyPotion');

// ── Test 1: local build deducts money ───────────────────────────────
{
    const g = makeGame(200);
    const r = bind(buildTower, g)(0, 0, 'basic');
    ok('local build returns true',   r === true);
    ok('local build deducts money',  g.money === 150);
    ok('tower placed on field',      g.towers.length === 1);
}

// ── Test 2: remote build places the tower but does NOT deduct ──────
{
    const g = makeGame(0); // even with NO money the remote build succeeds
    const r = bind(buildTower, g)(1, 1, 'basic', { source: 'remote' });
    ok('remote build returns true even with no local money', r === true);
    ok('remote build does NOT deduct local money',           g.money === 0);
    ok('remote tower placed on field',                       g.towers.length === 1);
    ok('remote tower flagged with _owner',                   g.towers[0]._owner === 'remote');
}

// ── Test 3: local upgrade deducts; remote upgrade does not ─────────
{
    const g = makeGame(500);
    const t = { upgrade(){}, getUpgradeCost: () => 80 };
    g.towers.push(t);
    bind(upgradeTower, g)(t, 0);
    ok('local upgrade deducts money',  g.money === 420);
    bind(upgradeTower, g)(t, 0, { source: 'remote' });
    ok('remote upgrade does NOT deduct', g.money === 420);
}

// ── Test 4: local sell credits; remote sell removes but no credit ──
{
    const g = makeGame(100);
    const tA = { getSellValue: () => 30 };
    const tB = { getSellValue: () => 30 };
    g.towers.push(tA, tB);
    bind(sellTower, g)(tA);
    ok('local sell credits money',     g.money === 130);
    ok('local sell removes tower',     g.towers.length === 1);
    bind(sellTower, g)(tB, { source: 'remote' });
    ok('remote sell does NOT credit',  g.money === 130);
    ok('remote sell removes tower',    g.towers.length === 0);
}

// ── Test 5: local potion debits + heals; remote does neither ───────
{
    const g = makeGame(100);
    g.health = 10;
    bind(buyPotion, g)();
    ok('local potion deducts money',  g.money === 70);
    ok('local potion heals',          g.health > 10);

    const g2 = makeGame(0);
    g2.health = 5;
    const r = bind(buyPotion, g2)({ source: 'remote' });
    ok('remote potion returns true even broke',  r === true);
    ok('remote potion does NOT deduct',          g2.money === 0);
    ok('remote potion does NOT heal local HP',   g2.health === 5);
    ok('remote potion still bumps counter',      g2.potionCount === 1);
}

console.log(`\nCOOP SPLIT ECONOMY: ${pass} pass, ${fail} fail`);
process.exit(fail === 0 ? 0 : 1);
