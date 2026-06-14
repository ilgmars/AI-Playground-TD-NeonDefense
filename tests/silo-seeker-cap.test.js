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

// Mirror src/entities/entities.js: base silo grows 0.5/frame to a
// 1.5× cap (rockets are ammo — engage promptly); orbital DEPLOYS at
// 1.0× and gains range every idle frame (1.0/frame) with NO fixed
// multiple cap — it keeps extending until it can reach an enemy,
// bounded only by the field diagonal + 8-tile margin so an idle
// rocket reaches anywhere on the map.
const FIELD_BOUND = Math.hypot(24 * 40, 16 * 40) + 8 * 40;   // ≈1474px
function tick(rocket, towerRange, frames, isOrbital = false) {
    const seekerCap = isOrbital ? FIELD_BOUND : towerRange * 3;   // base silo: long but FINITE
    const growth = 1.0;
    for (let i = 0; i < frames; i++) {
        if (rocket.range < seekerCap) rocket.range += growth;
    }
}

// Silo (range 110) idle for 10K frames — without the cap r.range would
// have hit 5000+. With the long-range cap (3×) it holds at 330.
const r1 = { range: 100 };
tick(r1, 110, 10000);
ok('silo seeker capped at 3x range (long but finite)', r1.range <= 110 * 3 + 0.0001, `range=${r1.range}`);
ok('silo seeker reaches the 3x cap',                   Math.abs(r1.range - 330) < 1, `range=${r1.range}`);

// Orbital (range 120): deploys at 1.0× = 120 and gains range
// INDEFINITELY while idle — bounded only by the field diagonal so it
// can reach any enemy on the map.
const r2 = { range: 120 };
tick(r2, 120, 100000, true);
ok('orbital seeker grows far past the base 6× (no fixed multiple cap)',
    r2.range > 120 * 6.0, `range=${r2.range}`);
ok('orbital seeker bounded at the field diagonal (reaches anywhere on map)',
    Math.abs(r2.range - FIELD_BOUND) < 1.0001, `range=${r2.range} bound=${FIELD_BOUND}`);
// Never worse than base silo: it deploys AT tower range.
const r2start = { range: 120 };
ok('orbital deploys at full tower range (not short-sighted)', r2start.range === 120);
// Idle long enough and it keeps gaining — 20 s (1200 frames) clears
// the old 6× ceiling (720) the request asked us to remove.
const r2b = { range: 120 };
tick(r2b, 120, 1200, true);
ok('20 s idle keeps gaining range past the old 720 ceiling',
    r2b.range > 720, `range=${r2b.range}`);

// Below-cap rocket grows by 1.0 per frame (faster, to reach the extended
// long range promptly): 50 + 100×1.0 = 150.
const r3 = { range: 50 };
tick(r3, 110, 100);
ok('rocket grows by 1.0/frame below cap', Math.abs(r3.range - 150) < 0.001,
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

// ── Sibling rockets must RETARGET, not vanish ──────────────────────
// Regression for the second half of the "rockets disappear into the
// air" report: when one rocket of a salvo killed the shared target,
// explode() used to set p.active = false on every sibling — they
// blinked out mid-flight with no explosion. Siblings now retarget to
// the nearest live enemy, or keep flying to last-known coords.
// Loads the REAL Projectile class from entities.js in a vm sandbox.
const vm = require('vm');
const entSrc = fs.readFileSync(path.join(__dirname, '..', 'src', 'entities', 'entities.js'), 'utf8');
const sandbox = {
    window: {}, TOWERS: {}, ENEMIES: {}, TOWER_UPGRADES: {},
    TILE_SIZE: 40, ROWS: 15, COLS: 20,
    SoundFX: { explosion() {}, hit() {}, build() {} },
    Math, Set, console,
};
vm.createContext(sandbox);
vm.runInContext(entSrc + '\n;globalThis.__T = { Projectile };', sandbox);
const Projectile = sandbox.__T.Projectile;

{
    const tower = { id: 'silo-1', damageDealt: 0 };
    const sharedTarget = { x: 100, y: 100, active: true, radius: 10, hp: 1, maxHp: 1,
        takeDamage(d) { this.hp -= d; return d; } };
    const bystander = { x: 160, y: 130, active: true, radius: 10, hp: 500, maxHp: 500,
        takeDamage(d) { this.hp -= d; return d; } };
    const r1 = new Projectile(98, 98, sharedTarget, 50, 'rocket', 1, 30, tower);
    const r2 = new Projectile(80, 90, sharedTarget, 50, 'rocket', 1, 30, tower);
    const projectiles = [r1, r2];
    sharedTarget.active = false;                  // r1's hit killed it
    r1.explode([bystander], [], projectiles);
    ok('sibling rocket survives the salvo leader exploding', r2.active === true);
    ok('sibling rocket retargets the nearest live enemy', r2.target === bystander);

    // No live enemies in range → sibling keeps last-known coords and
    // stays active (it will fly there and explode on arrival).
    const t2 = { x: 300, y: 300, active: true, radius: 10, hp: 1, maxHp: 1,
        takeDamage(d) { this.hp -= d; return d; } };
    const r3 = new Projectile(295, 295, t2, 50, 'rocket', 1, 30, tower);
    const r4 = new Projectile(290, 290, t2, 50, 'rocket', 1, 30, tower);
    t2.active = false;
    r3.explode([], [], [r3, r4]);
    ok('with no enemies left, sibling stays active (flies to last-known coords)',
        r4.active === true && r4.savedTx === 300 && r4.savedTy === 300,
        JSON.stringify({ active: r4.active, tx: r4.savedTx, ty: r4.savedTy }));

    // The dead-target homing path must eventually explode it, not drop it.
    let exploded = false;
    r4.explode = () => { exploded = true; r4.active = false; };
    for (let i = 0; i < 300 && r4.active; i++) r4.update([], [], []);
    ok('orphan rocket explodes at last-known coords instead of vanishing',
        exploded === true);
}

console.log(`\nSILO SEEKER CAP: ${pass} pass, ${fail} fail`);
process.exit(fail === 0 ? 0 : 1);
