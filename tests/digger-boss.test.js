// Feature: the path-digging boss (Trello, LV: "random boss kas 1/30
// vilņos iespawnojas un var izrakt jaunu path").
//
// Every 30th wave's boss is a DIGGER. At spawn it picks the
// longest-saving tower-free shortcut; if it survives the crossing,
// the dig COMMITS: crossing tiles become permanent road, the
// canonical path is rebuilt shorter, towers on the trail are crushed
// (full refund), and the cached map layer re-rasterizes (map._rev).
// Kill it mid-crossing and nothing is carved.
const fs = require('fs');
const vm = require('vm');
const path = require('path');

let pass = 0, fail = 0;
function ok(name, c, extra) {
    if (c) { console.log('ok', name); pass++; }
    else   { console.log('FAIL', name, extra || ''); fail++; }
}

const load = f => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
const sandbox = {
    window: {}, Math, Set, console,
    SoundFX: { explosion() {}, hit() {}, build() {}, shootElectric() {} },
};
vm.createContext(sandbox);
vm.runInContext(load('src/config/config.js') + '\n' + load('src/engine/map.js') +
    '\n' + load('src/entities/entities.js') +
    '\n;globalThis.__X = { GameMap, Enemy };', sandbox);
const { GameMap, Enemy } = sandbox.__X;

// Hairpin map: entry (0,2) → 20 road tiles → exit (0,4).
function hairpinMap() {
    sandbox.COLS = 12; sandbox.ROWS = 12;
    const m = new GameMap(1);
    m.grid = Array.from({ length: 12 }, () => new Array(12).fill(0));
    m.path = [];
    for (let c = 0; c <= 9; c++)  m.path.push({ c, r: 2 });
    m.path.push({ c: 9, r: 3 });
    m.path.push({ c: 9, r: 4 });
    for (let c = 8; c >= 0; c--)  m.path.push({ c, r: 4 });
    for (const p of m.path) m.grid[p.r][p.c] = 1;
    m._shortcuts = null;
    delete m.path._shortcuts;
    return m;
}

// ── 1) Dig-site picking respects towers ─────────────────────────────
{
    const m = hairpinMap();
    const free = m.pickDigSite([]);
    ok('digger finds a site on an open hairpin', !!free, JSON.stringify(free));
    // Wall the whole crossing row with towers → no site (or one
    // further along, never through the towers).
    const towers = [];
    for (let c = 0; c <= 9; c++) towers.push({ c, r: 3 });
    const blockedSite = m.pickDigSite(towers);
    ok('tower wall blocks the dig site', blockedSite === null, JSON.stringify(blockedSite));
}

// ── 2) digShortcut carves road + rebuilds the path ──────────────────
{
    const m = hairpinMap();
    const site = m.pickDigSite([]);
    const oldLen = m.path.length;
    const dug = m.digShortcut(site.from, site.to);
    ok('dig returns the carved tiles', Array.isArray(dug) && dug.length >= 1, JSON.stringify(dug));
    ok('carved tiles became road (grid 1)', dug.every(t => m.grid[t.r][t.c] === 1));
    ok('canonical path got SHORTER', m.path.length < oldLen,
        `${oldLen} → ${m.path.length}`);
    ok('path still starts and ends at the same tiles',
        m.path[0].c === 0 && m.path[0].r === 2 &&
        m.endPoint.c === 0 && m.endPoint.r === 4, JSON.stringify(m.endPoint));
    ok('map revision bumped (cache bust)', m._rev === 1);
    // New spawns walk the dug path end-to-end.
    const e = new Enemy(m.path, 'normal', 1);
    let guard = 0;
    while (e.active && guard++ < 20000) e.update();
    ok('a fresh enemy walks the dug path to the end', e.reachedEnd === true);
}

// ── 3) The digger boss commits only when it FINISHES the crossing ──
{
    const m = hairpinMap();
    const site = m.pickDigSite([]);
    const boss = new Enemy(m.path, 'tank', 1);
    boss.isBoss = true;
    boss.isDigger = true;
    boss._digSite = site;
    let committed = 0;
    boss._onDigComplete = () => committed++;

    let guard = 0;
    while (boss.pathIndex < site.from && guard++ < 8000) boss.update();
    boss.update();
    ok('digger enters its crossing at the site entry', !!boss._crawl);
    ok('nothing carved while still crawling', committed === 0);

    guard = 0;
    while (boss._crawl && guard++ < 20000) boss.update();
    ok('finishing the crossing fires the dig commit exactly once', committed === 1);
    ok('digger rejoins the road past the exit', boss.pathIndex === site.to + 1);

    // Killed mid-crossing → no commit. (Fresh boss, fresh map.)
    const m2 = hairpinMap();
    const site2 = m2.pickDigSite([]);
    const boss2 = new Enemy(m2.path, 'tank', 1);
    boss2.isDigger = true;
    boss2._digSite = site2;
    let committed2 = 0;
    boss2._onDigComplete = () => committed2++;
    guard = 0;
    while (boss2.pathIndex < site2.from && guard++ < 8000) boss2.update();
    boss2.update(); boss2.update();
    boss2.active = false;                       // killed mid-crawl
    ok('a digger killed mid-crossing never commits', committed2 === 0);
}

console.log(`\nDIGGER BOSS: ${pass} pass, ${fail} fail`);
process.exit(fail === 0 ? 0 : 1);
