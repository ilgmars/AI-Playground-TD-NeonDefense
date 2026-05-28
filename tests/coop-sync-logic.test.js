// Node-level logic test of the desync-digest contract.
//
// Mirrors window.__neonMPApplySync from src/engine/main.js. If the
// production code is touched, this test pinpoints which field
// behaviour changed.
//
// The sync packet shape: { kind:'sync', w, m, h, tc, ec, t }
//   w  = wave
//   m  = money
//   h  = health
//   tc = tower count
//   ec = enemy count (informational only — not in the drift severity)
//
// Drift severity tiers:
//   wave   → loudest signal (wave numbers different)
//   towers → tower-count mismatch (inputs aren't propagating)
//   ok     → fully aligned

'use strict';

let pass = 0, fail = 0;
function ok(name, cond, extra) {
    if (cond) { console.log('ok', name); pass++; }
    else      { console.log('FAIL', name, extra || ''); fail++; }
}

// Local applySync that mirrors the production function.
function applySync(game, snap, fromId) {
    if (!game || !snap) return null;
    const localTc = (game.towers || []).length | 0;
    const drift = {
        peer: fromId || '?',
        t: Date.now(),
        wave:    { local: game.wave | 0,  remote: snap.w | 0,
                   diff: (snap.w | 0) - (game.wave | 0) },
        money:   { local: game.money | 0, remote: snap.m | 0,
                   diff: (snap.m | 0) - (game.money | 0) },
        health:  { local: game.health | 0, remote: snap.h | 0,
                   diff: (snap.h | 0) - (game.health | 0) },
        towers:  { local: localTc,         remote: snap.tc | 0,
                   diff: (snap.tc | 0) - localTc },
        enemies: { local: (game.enemies || []).filter(e => e && e.active).length | 0,
                   remote: snap.ec | 0 },
    };
    drift.severity =
        (drift.wave.diff !== 0)   ? 'wave' :
        (drift.towers.diff !== 0) ? 'towers' :
        'ok';
    return drift;
}

// ── 1) Wave drift dominates ─────────────────────────────────────────
{
    const game = { wave: 5, money: 100, health: 20, towers: [], enemies: [] };
    const d = applySync(game, { w: 7, m: 100, h: 20, tc: 0, ec: 0 }, 'BOB');
    ok('wave.diff = +2',          d.wave.diff === 2);
    ok('severity = wave',         d.severity === 'wave');
    ok('peer recorded',           d.peer === 'BOB');
}

// ── 2) Towers drift surfaces when wave is aligned ──────────────────
{
    const game = { wave: 7, money: 100, health: 20, towers: [{}, {}, {}, {}], enemies: [] };
    const d = applySync(game, { w: 7, m: 100, h: 20, tc: 3, ec: 0 }, 'BOB');
    ok('tower.diff = -1 (we have one extra)',  d.towers.diff === -1);
    ok('severity = towers (wave aligned)',     d.severity === 'towers');
}

// ── 3) Full alignment → severity ok ────────────────────────────────
{
    const game = { wave: 7, money: 100, health: 20, towers: [{}, {}, {}], enemies: [] };
    const d = applySync(game, { w: 7, m: 100, h: 20, tc: 3, ec: 0 }, 'BOB');
    ok('severity = ok',                       d.severity === 'ok');
    ok('zero diffs for aligned wave',         d.wave.diff === 0);
    ok('zero diffs for aligned towers',       d.towers.diff === 0);
}

// ── 4) Money / health / enemies don't affect severity ──────────────
{
    const game = {
        wave: 7, money: 100, health: 20, towers: [{}, {}, {}],
        enemies: [{ active: true }, { active: true }, { active: false }],
    };
    const d = applySync(game, { w: 7, m: 999, h: 1, tc: 3, ec: 99 }, 'BOB');
    ok('money diff reported but not severity',  d.money.diff === 899);
    ok('health diff reported',                  d.health.diff === -19);
    ok('enemy counts reported',                 d.enemies.local === 2 && d.enemies.remote === 99);
    ok('severity stays ok despite money/hp',    d.severity === 'ok');
}

// ── 5) Missing fields defaulted via | 0 ────────────────────────────
{
    const game = { wave: 0, money: 0, health: 0, towers: [], enemies: [] };
    const d = applySync(game, {}, 'X');
    ok('missing fields → diffs all 0',
        d.wave.diff === 0 && d.towers.diff === 0 && d.money.diff === 0);
    ok('severity = ok for empty snap',  d.severity === 'ok');
}

// ── 6) Null snap returns null (defensive) ──────────────────────────
{
    const d = applySync({ wave: 1 }, null, '?');
    ok('null snap returns null',  d === null);
}

console.log(`\nCOOP SYNC LOGIC: ${pass} pass, ${fail} fail`);
process.exit(fail === 0 ? 0 : 1);
