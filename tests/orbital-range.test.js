// Regression: the Orbital Strike (silo_orbital) is a LONG-RANGE weapon
// whose idle rockets gain range INDEFINITELY until they can strike.
// Drives the real Tower.update loop:
//
//   * a target up close fires (almost) immediately,
//   * an idle rocket keeps gaining range frame after frame (no plateau
//     at a fixed multiple) until it reaches an enemy,
//   * targets anywhere on the field (incl. 25 tiles out) are reachable
//     given enough idle time; only something beyond the field bound
//     never is (sane upper limit, no runaway numbers),
//   * orbital deploys at FULL tower range (never worse than base silo
//     up close).
const fs = require('fs');
const vm = require('vm');
const path = require('path');

let pass = 0, fail = 0;
function ok(name, c, extra) {
    if (c) { console.log('ok', name); pass++; }
    else   { console.log('FAIL', name, extra || ''); fail++; }
}

const load = f => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
// Deterministic Math.random in the sandbox so the rocket's orbit
// deploy angle/dist is fixed run-to-run — otherwise the engagement
// frame jitters with the random orbit phase (this is what flaked CI).
function seededMath() {
    let s = 0x1234abcd;
    const m = Object.create(Math);
    m.random = () => {
        s ^= s << 13; s ^= s >>> 17; s ^= s << 5; s >>>= 0;
        return s / 4294967296;
    };
    return m;
}
const sb = {
    window: {}, Math: seededMath(), Set, console, TILE_SIZE: 40,
    SoundFX: { explosion() {}, hit() {}, build() {}, shootElectric() {} },
};
vm.createContext(sb);
vm.runInContext(load('src/config/config.js') + '\n' + load('src/entities/entities.js') +
    '\n;globalThis.__X = { Tower, TOWERS };', sb);
const { Tower, TOWERS } = sb.__X;

const cx = 220, cy = 220;   // tower centre for a tower at tile (5,5)
const baseRange = TOWERS.silo_orbital.range;

// Fire a single distant target and report the frame the orbital first
// looses a rocket (or -1 if it never does within `frames`).
function fireFrame(distPx, frames = 8000) {
    const t = new Tower(5, 5, 'silo_orbital');
    const e = { x: cx + distPx, y: cy, active: true, hp: 1e9, maxHp: 1e9,
        radius: 12, isAir: false, takeDamage(d) { return d; } };
    const proj = [];
    for (let f = 0; f < frames; f++) {
        t.update([e], proj, []);
        if (proj.length > 0) return f;
    }
    return -1;
}

// Deploy range: the first hover rocket starts at full tower range.
{
    const t = new Tower(5, 5, 'silo_orbital');
    t.update([], [], []);                 // one tick deploys a rocket (no target)
    ok('orbital deploys a hover rocket', t.hoverRockets.length === 1);
    ok('hover rocket deploys at FULL tower range (≥ base, not short-sighted)',
        t.hoverRockets[0].range >= baseRange,
        `start=${t.hoverRockets[0].range} base=${baseRange}`);
}

// The orbital seeker now grows INDEFINITELY while idle, bounded only
// by the field diagonal + 8-tile margin (≈1474px ≈ 37 tiles). Targets
// anywhere on the map are reachable; only something beyond the field
// bound never is. Distances account for the rocket's ±48px orbit:
// guaranteed-reachable when (distance + 48) ≤ bound.
const FIELD_BOUND = Math.hypot(24 * 40, 16 * 40) + 8 * 40;   // ≈1474px
const fClose = fireFrame(100);
const fMid   = fireFrame(400);
const fFar   = fireFrame(1000);                    // 25 tiles — far, still on-field
const fPast  = fireFrame(FIELD_BOUND + 200, 200000); // beyond the field bound

ok('close target (2.5 tiles) fires promptly', fClose >= 0 && fClose < 120,
    `frame=${fClose}`);
ok('mid target (10 tiles, beyond base range) IS hit once charged',
    fMid > 0, `frame=${fMid}`);
ok('far target (25 tiles, across the field) is reachable while idle',
    fFar > 0, `frame=${fFar}`);
ok('charge-up is gradual: farther targets take longer to engage',
    fClose < fMid && fMid < fFar,
    JSON.stringify({ fClose, fMid, fFar }));
ok('a target BEYOND the field bound is never reached (sane upper bound)',
    fPast === -1, `frame=${fPast}`);

// The core request: a rocket idling with NOTHING in reach keeps
// gaining range frame after frame (it doesn't plateau at some fixed
// multiple) until it can finally strike. Verify the deployed rocket's
// range strictly increases over a long idle and clears the old 720
// ceiling.
{
    const t = new Tower(5, 5, 'silo_orbital');
    t.update([], [], []);                      // deploy one rocket, no enemies
    const r0 = t.hoverRockets[0].range;
    for (let f = 0; f < 600; f++) t.update([], [], []);
    const r1 = t.hoverRockets[0].range;
    for (let f = 0; f < 600; f++) t.update([], [], []);
    const r2 = t.hoverRockets[0].range;
    ok('idle rocket keeps gaining range (no plateau at a fixed multiple)',
        r1 > r0 && r2 > r1 && r2 > 720,
        JSON.stringify({ r0: Math.round(r0), r1: Math.round(r1), r2: Math.round(r2) }));
}

// Base silo: a long-range SWARM. Its seeker now reaches 3× tower range
// (was 1.5×), so distant targets the old cap missed are hit — but it stays
// FINITE (unlike orbital), so a target past 3× is never reached.
function siloFireFrame(distPx, frames = 8000) {
    const t = new Tower(5, 5, 'silo');
    const e = { x: cx + distPx, y: cy, active: true, hp: 1e9, maxHp: 1e9,
        radius: 12, isAir: false, takeDamage(d) { return d; } };
    const proj = [];
    for (let f = 0; f < frames; f++) {
        t.update([e], proj, []);
        if (proj.length > 0) return f;
    }
    return -1;
}
const siloRange = TOWERS.silo.range;
ok('base silo FIRES at a distant target beyond the old 1.5× cap',
    siloFireFrame(siloRange * 2) > 0, `range=${siloRange}`);
ok('base silo stays finite — a target past 3× range is never reached (distinct from orbital)',
    siloFireFrame(siloRange * 3 + 200, 4000) === -1);

console.log(`\nORBITAL RANGE: ${pass} pass, ${fail} fail`);
process.exit(fail === 0 ? 0 : 1);
