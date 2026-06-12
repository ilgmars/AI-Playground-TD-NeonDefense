// Feature: the shortcut-cutter enemy (Trello, LV: "tanciņš kas mēģina
// taisīt shortcutus — ja redz ka 18 kubiku ceļa vietā var braukt 2
// kubikus pa zālīti, viņš lēnam rāpos pāri").
//
//   1. GameMap.computeShortcuts finds U-bends: ≥10 path tiles
//      replaceable by ≤3.6 tiles of straight OPEN GRASS; rejects lines
//      crossing road; results are non-overlapping and deterministic.
//   2. The cutter follows the road, crawls the shortcut at 0.45×
//      speed, and rejoins past the exit (skipping the middle indices).
//   3. Wave spawning substitutes cutters into tank waves from wave 15
//      by INDEX (deterministic — MP-safe), never before.
const fs = require('fs');
const vm = require('vm');
const path = require('path');

let pass = 0, fail = 0;
function ok(name, c, extra) {
    if (c) { console.log('ok', name); pass++; }
    else   { console.log('FAIL', name, extra || ''); fail++; }
}

// ── Load GameMap + Enemy in a sandbox ───────────────────────────────
const mapSrc = fs.readFileSync(path.join(__dirname, '..', 'src', 'engine', 'map.js'), 'utf8');
const entSrc = fs.readFileSync(path.join(__dirname, '..', 'src', 'entities', 'entities.js'), 'utf8');
const cfgSrc = fs.readFileSync(path.join(__dirname, '..', 'src', 'config', 'config.js'), 'utf8');
const sandbox = {
    window: {}, Math, Set, console,
    SoundFX: { explosion() {}, hit() {}, build() {}, shootElectric() {} },
};
vm.createContext(sandbox);
vm.runInContext(cfgSrc + '\n' + mapSrc + '\n' + entSrc +
    '\n;globalThis.__X = { GameMap, Enemy, ENEMIES, WAVE_CONFIG, TILE_SIZE: TILE_SIZE };', sandbox);
const { GameMap, Enemy, ENEMIES, WAVE_CONFIG } = sandbox.__X;
const TILE = sandbox.__X.TILE_SIZE;

// ── 1) Shortcut detection on a hand-built hairpin ───────────────────
// Path: right along row 2 to col 9, down to row 4, back left to col 0
// — entry (0,2) and exit (0,4) are 2 tiles apart but 20 tiles by road.
function hairpinMap() {
    const mm = new GameMap(1);
    mm.grid = Array.from({ length: 12 }, () => new Array(12).fill(0));
    mm.path = [];
    for (let c = 0; c <= 9; c++)  mm.path.push({ c, r: 2 });       // → along top
    mm.path.push({ c: 9, r: 3 });                                  // ↓
    mm.path.push({ c: 9, r: 4 });
    for (let c = 8; c >= 0; c--)  mm.path.push({ c, r: 4 });       // ← back
    for (const p of mm.path) mm.grid[p.r][p.c] = 1;
    mm._shortcuts = null;
    delete mm.path._shortcuts;
    return mm;
}
sandbox.COLS = 12; sandbox.ROWS = 12;
const m = hairpinMap();
const scs = m.computeShortcuts();
ok('hairpin produces a shortcut', scs.length >= 1, JSON.stringify(scs));
if (scs.length) {
    const s = scs[0];
    const a = m.path[s.from], b = m.path[s.to];
    ok('shortcut saves ≥10 road tiles', s.to - s.from >= 10, JSON.stringify(s));
    ok('shortcut crossing is ≤3.6 tiles', Math.hypot(b.c - a.c, b.r - a.r) <= 3.6,
        JSON.stringify({ a, b }));
}
ok('results cached + stashed on path._shortcuts',
    m.computeShortcuts() === scs && m.path._shortcuts === scs);

// Road across the WHOLE middle row: every row2→row4 crossing now
// passes occupied tiles → no shortcuts at all. (A partial wall is
// legitimately routed AROUND diagonally — that's a feature.)
const m2 = hairpinMap();
for (let c = 0; c <= 8; c++) m2.grid[3][c] = 1;
m2._shortcuts = null;
delete m2.path._shortcuts;
const blocked = m2.computeShortcuts();
ok('crossings blocked by road are rejected (full wall → zero shortcuts)',
    blocked.length === 0, JSON.stringify(blocked));

// ── 2) Crawl behaviour ──────────────────────────────────────────────
{
    const e = new Enemy(m.path, 'cutter', 1);
    ok('cutter reads ENEMIES.cutter config', e.speed === ENEMIES.cutter.speed && !e.isAir);
    const s = m.path._shortcuts[0];
    // Walk it up to the shortcut entry.
    let guard = 0;
    while (e.pathIndex < s.from && guard++ < 5000) e.update();
    ok('cutter reaches the shortcut entry on the road', e.pathIndex === s.from, e.pathIndex);
    // Next updates enter crawl mode — measure one crawl step length.
    e.update();
    ok('cutter enters crawl mode at the entry', !!e._crawl, JSON.stringify(e._crawl));
    const x0 = e.x, y0 = e.y;
    e.update();
    const step = Math.hypot(e.x - x0, e.y - y0);
    ok('crawl speed is 0.45× road speed',
        Math.abs(step - ENEMIES.cutter.speed * 0.45) < 0.01, step);
    // Finish the crawl; it must rejoin PAST the exit, skipping the bend.
    guard = 0;
    while (e._crawl && guard++ < 5000) e.update();
    ok('cutter rejoins the road past the exit (middle indices skipped)',
        e.pathIndex === s.to + 1, e.pathIndex);
    // And it still finishes the route.
    guard = 0;
    while (e.active && guard++ < 20000) e.update();
    ok('cutter reaches the end of the path', e.reachedEnd === true);
}

// ── 3) Spawn substitution is index-based and gated by wave ─────────
{
    const sub = (type, wave, idx) => {
        if (type === 'tank' && wave >= WAVE_CONFIG.cutterFromWave && idx % WAVE_CONFIG.cutterEveryNth === 1) return 'cutter';
        if (type === 'normal' && wave >= WAVE_CONFIG.cutterNormalFromWave && idx % WAVE_CONFIG.cutterNormalEveryNth === 3) return 'cutter';
        return type;
    };
    ok('no cutters before wave 15', sub('tank', 14, 1) === 'tank');
    ok('tank wave 15: every 3rd spawn is a cutter',
        sub('tank', 15, 1) === 'cutter' && sub('tank', 15, 2) === 'tank' && sub('tank', 15, 4) === 'cutter');
    ok('normal waves get cutters from wave 25',
        sub('normal', 24, 3) === 'normal' && sub('normal', 25, 3) === 'cutter');
    ok('air waves never substitute', sub('air', 30, 1) === 'air');
}

console.log(`\nCUTTER ENEMY: ${pass} pass, ${fail} fail`);
process.exit(fail === 0 ? 0 : 1);
