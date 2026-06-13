// Feature: the path-digging boss, v2 (user direction: "the main idea
// was to have a boss that can PERMA MOVE the road, or even make
// ADDITIONAL paths... not building only straight paths. If there are
// towers in the way, move that tower to the closest possible
// location. Make sure that you test the pathfinding after the change
// and that it is not gamebreaking.")
//
//   * digReroute carves a CONTIGUOUS stepped trench (4-adjacent
//     tiles, with bends — never a single straight line when both
//     axes differ), deterministically from (map seed, from, to).
//   * mode 'replace' permanently MOVES the road through the trench;
//     mode 'branch' keeps the old road AND adds the trench as an
//     additional route — spawns alternate between them.
//   * Towers on the trench are RELOCATED to the nearest free
//     buildable tile, never deleted.
//   * Not gamebreaking: pickDigSite caps how much road one dig can
//     erase (≤45% of the path).
//   * PATHFINDING: real enemies must complete BOTH routes end-to-end
//     after a dig.
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

// Hairpin map: entry (0,2) → 20 road tiles → exit (0,4), on a roomy
// 14×14 grid so trenches have space to bend.
function hairpinMap() {
    sandbox.COLS = 14; sandbox.ROWS = 14;
    const m = new GameMap(42);
    m.grid = Array.from({ length: 14 }, () => new Array(14).fill(0));
    m.path = [];
    for (let c = 0; c <= 9; c++)  m.path.push({ c, r: 2 });
    m.path.push({ c: 9, r: 3 });
    m.path.push({ c: 9, r: 4 });
    for (let c = 8; c >= 0; c--)  m.path.push({ c, r: 4 });
    for (const p of m.path) m.grid[p.r][p.c] = 1;
    m._shortcuts = null;
    m._rev = 0;
    m.altRoutes = [];
    delete m.path._shortcuts;
    return m;
}

function contiguous(a, route, b) {
    const pts = [a, ...route, b];
    for (let i = 1; i < pts.length; i++) {
        const d = Math.abs(pts[i].c - pts[i - 1].c) + Math.abs(pts[i].r - pts[i - 1].r);
        if (d !== 1) return false;
    }
    return true;
}
function bends(a, route, b) {
    const pts = [a, ...route, b];
    let turns = 0;
    for (let i = 2; i < pts.length; i++) {
        const d1 = [pts[i - 1].c - pts[i - 2].c, pts[i - 1].r - pts[i - 2].r];
        const d2 = [pts[i].c - pts[i - 1].c, pts[i].r - pts[i - 1].r];
        if (d1[0] !== d2[0] || d1[1] !== d2[1]) turns++;
    }
    return turns;
}

// ── 1) Trench geometry: contiguous, bending, deterministic ─────────
{
    const m = hairpinMap();
    const site = m.pickDigSite([]);
    ok('a dig site exists on the hairpin', !!site, JSON.stringify(site));
    const a = m.path[site.from], b = m.path[site.to];
    const rng1 = (() => { const f = m.buildDugRoute.bind(m); return f; })();
    const res = m.digReroute(site.from, site.to, { mode: 'replace', towers: [] });
    ok('trench tiles are CONTIGUOUS 4-adjacent steps',
        contiguous(a, res.dug, b), JSON.stringify(res.dug));
    ok('trench BENDS (not a single straight line)',
        bends(a, res.dug, b) >= 1, `turns=${bends(a, res.dug, b)}`);
    ok('trench tiles became road', res.dug.every(t => m.grid[t.r][t.c] === 1));

    // Determinism: a fresh identical map digs the identical trench.
    const m2 = hairpinMap();
    const res2 = m2.digReroute(site.from, site.to, { mode: 'replace', towers: [] });
    ok('same seed + site → identical trench (coop/seed safe)',
        JSON.stringify(res.dug) === JSON.stringify(res2.dug));
}

// ── 2) REPLACE mode permanently moves the road ──────────────────────
{
    const m = hairpinMap();
    const before = m.path.length;
    const site = m.pickDigSite([]);
    m.digReroute(site.from, site.to, { mode: 'replace', towers: [] });
    ok('replace: canonical path got shorter', m.path.length < before,
        `${before} → ${m.path.length}`);
    ok('replace: start/end tiles preserved',
        m.path[0].c === 0 && m.path[0].r === 2 && m.endPoint.c === 0 && m.endPoint.r === 4);
    // PATHFINDING: a real enemy walks the moved road end-to-end.
    const e = new Enemy(m.path, 'normal', 1);
    let g = 0;
    while (e.active && g++ < 30000) e.update();
    ok('replace: enemy completes the MOVED road', e.reachedEnd === true);
}

// ── 3) BRANCH mode adds an ADDITIONAL route ─────────────────────────
{
    const m = hairpinMap();
    const before = m.path.length;
    const site = m.pickDigSite([]);
    const res = m.digReroute(site.from, site.to, { mode: 'branch', towers: [] });
    ok('branch: canonical path unchanged', m.path.length === before);
    ok('branch: an additional route exists', m.altRoutes.length === 1);
    ok('branch: result reports its mode', res.mode === 'branch');
    // PATHFINDING: enemies complete BOTH routes.
    const e1 = new Enemy(m.path, 'normal', 1);
    let g = 0;
    while (e1.active && g++ < 30000) e1.update();
    const e2 = new Enemy(m.altRoutes[0], 'tank', 1);
    g = 0;
    while (e2.active && g++ < 30000) e2.update();
    ok('branch: enemy completes the OLD road', e1.reachedEnd === true);
    ok('branch: enemy completes the NEW trench route', e2.reachedEnd === true);
}

// ── 4) Towers on the trench are RELOCATED, never deleted ────────────
{
    const m = hairpinMap();
    const site = m.pickDigSite([]);
    // Find where the trench will go (same rng → dry-run on a clone).
    const probe = hairpinMap();
    const probeRes = probe.digReroute(site.from, site.to, { mode: 'replace', towers: [] });
    const spot = probeRes.dug[Math.floor(probeRes.dug.length / 2)];
    const tower = { c: spot.c, r: spot.r, x: spot.c * 40, y: spot.r * 40,
        type: 'sniper', upgrades: [2, 1, 0], totalSpent: 480 };
    const res = m.digReroute(site.from, site.to, { mode: 'replace', towers: [tower] });
    ok('blocking tower was moved (not deleted)', res.moved.length === 1 && res.moved[0] === tower);
    ok('tower no longer stands on the trench',
        !res.dug.some(d => d.c === tower.c && d.r === tower.r),
        JSON.stringify({ c: tower.c, r: tower.r }));
    ok('tower landed on a free buildable tile', m.grid[tower.r][tower.c] === 0);
    ok('tower landed CLOSE to its old spot (≤3 tiles)',
        Math.max(Math.abs(tower.c - spot.c), Math.abs(tower.r - spot.r)) <= 3,
        JSON.stringify({ from: spot, to: { c: tower.c, r: tower.r } }));
    ok('tower kept its upgrades/state', tower.upgrades[0] === 2 && tower.totalSpent === 480);
    ok('tower pixel coords follow the move',
        tower.x === tower.c * 40 && tower.y === tower.r * 40);
}

// ── 5) Not gamebreaking: one dig can't erase half the road ──────────
{
    const m = hairpinMap();
    const site = m.pickDigSite([]);
    ok('dig site savings capped at 45% of the path',
        (site.to - site.from) <= m.path.length * 0.45,
        JSON.stringify({ site, len: m.path.length }));
}

console.log(`\nDIGGER BOSS: ${pass} pass, ${fail} fail`);
process.exit(fail === 0 ? 0 : 1);
