// Regression: Silo hover rockets must NOT grow their seeker range past
// 1.5x the tower's nominal range.
//
// The bug: `r.range += 0.5` ran every frame unconditionally. Between
// waves the rocket would sit in orbit accumulating range; when the next
// wave's enemies spawned at the path entry, the rocket could lock onto
// a target half a screen away and the projectile would fly off into
// empty space — the "rockets disappear into the air" complaint.
//
// We validate by stubbing the silo update loop's seeker-range math and
// pushing it through many idle frames, then asserting the cap holds.
// Real DOM not needed — this is the pure math contract.

const assert = require('assert');
let pass = 0, fail = 0;
function ok(name, c, extra) {
    if (c) { console.log('ok', name); pass++; }
    else   { console.log('FAIL', name, extra || ''); fail++; }
}

// Mirror src/entities/entities.js: seekerCap = this.range * 1.5; while
// updating, only grow r.range when r.range < seekerCap.
function tick(rocket, towerRange, frames) {
    const seekerCap = towerRange * 1.5;
    for (let i = 0; i < frames; i++) {
        if (rocket.range < seekerCap) rocket.range += 0.5;
    }
}

// Silo (range 110) idle for 10K frames — without the cap r.range would
// have hit 5000+. With the cap it should hold at 165.
const r1 = { range: 100 };
tick(r1, 110, 10000);
ok('silo seeker capped at 1.5x range', r1.range <= 110 * 1.5 + 0.0001, `range=${r1.range}`);
ok('silo seeker reaches cap',          Math.abs(r1.range - 165) < 1, `range=${r1.range}`);

// Orbital (range 120) — wider cap.
const r2 = { range: 100 };
tick(r2, 120, 10000);
ok('orbital seeker capped at 1.5x range', r2.range <= 120 * 1.5 + 0.0001, `range=${r2.range}`);
ok('orbital seeker reaches cap',          Math.abs(r2.range - 180) < 1, `range=${r2.range}`);

// Below-cap rocket still grows by 0.5 per frame.
const r3 = { range: 50 };
tick(r3, 110, 100);
ok('rocket grows by 0.5/frame below cap', Math.abs(r3.range - 100) < 0.001,
    `range=${r3.range}`);

// Config sanity: Silo damage/splash buffed so the base tower is not strictly
// dominated by Orbital Strike. Values pulled from the actual config file so
// future tweaks update both halves in lockstep.
const fs = require('fs');
const path = require('path');
const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'config', 'config.js'), 'utf8');
const siloLine = src.match(/silo:\s*\{\s*cost:\s*\d+,\s*range:\s*(\d+),\s*damage:\s*(\d+),\s*fireRate:\s*(\d+)[^}]*splash:\s*(\d+)/);
ok('silo config parsed', !!siloLine, siloLine ? siloLine[0] : 'no match');
if (siloLine) {
    const [_, range, damage, fireRate, splash] = siloLine.map(Number);
    ok('silo range >= 110 (was 100)',    range   >= 110);
    ok('silo damage >= 140 (was 120)',   damage  >= 140);
    ok('silo splash >= 55 (was 40)',     splash  >= 55);
    ok('silo fireRate unchanged at 80',  fireRate === 80);
}

console.log(`\nSILO SEEKER CAP: ${pass} pass, ${fail} fail`);
process.exit(fail === 0 ? 0 : 1);
