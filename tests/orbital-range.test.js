// Regression: the Orbital Strike (silo_orbital) is a LONG-RANGE
// weapon — its hover rockets must actually FIRE at distant targets,
// not just grow a number. Drives the real Tower.update loop:
//
//   * a target up close fires (almost) immediately,
//   * a target ~10 tiles out (400px, beyond base range) gets hit once
//     the seeker has charged,
//   * a target ~18 tiles out (≈720px = 6× range) is still reachable,
//   * a target past the cap (800px) is never hit (bounded — not the
//     old "fires half a screen away at random" bug),
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
const sb = {
    window: {}, Math, Set, console, TILE_SIZE: 40,
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

const fClose = fireFrame(100);
const fMid   = fireFrame(400);
const fFar   = fireFrame(700);
const fPast  = fireFrame(820);

ok('close target (2.5 tiles) fires promptly', fClose >= 0 && fClose < 120,
    `frame=${fClose}`);
ok('mid target (10 tiles, beyond base range) IS hit once charged',
    fMid > 0, `frame=${fMid}`);
ok('far target (~17.5 tiles) is still reachable — long-range weapon',
    fFar > 0, `frame=${fFar}`);
ok('charge-up is gradual: farther targets take longer to engage',
    fClose < fMid && fMid < fFar,
    JSON.stringify({ fClose, fMid, fFar }));
ok('target past the 6× cap (>18 tiles) is NEVER hit (bounded reach)',
    fPast === -1, `frame=${fPast}`);
// Sanity: the far engagement is on the order of ~10 s, not minutes.
ok('far engagement happens within ~12 s (not the old multi-minute creep)',
    fFar > 0 && fFar < 12 * 60, `frame=${fFar} (${(fFar / 60).toFixed(1)}s)`);

console.log(`\nORBITAL RANGE: ${pass} pass, ${fail} fail`);
process.exit(fail === 0 ? 0 : 1);
