// Regression: scoreboard wire format is compressed (half-size) but
// older peers still parse it. validateEntry accepts BOTH the new
// compact form {n,w,r,t,f} and the legacy long form {name,wave,
// tier,t,cheated,autopilot,retired}.
//
// Why: TURN + broker bandwidth is metered. 50 entries × ~100 bytes
// every 60 s per peer is the dominant wire chatter. The compact
// form ~halves it.

'use strict';

const globalMod = require('../src/multiplayer/global.js');
const transport = require('../src/multiplayer/transport.js');

let pass = 0, fail = 0;
function ok(name, cond, extra) {
    if (cond) { console.log('ok', name); pass++; }
    else      { console.log('FAIL', name, extra || ''); fail++; }
}

// ── 1) packEntry produces the compact shape ─────────────────────────
{
    const e = {
        name: 'ALICE', wave: 42, tier: 0, t: 1700000000000,
        cheated: false, autopilot: false, retired: false,
    };
    const p = globalMod.packEntry(e);
    ok('compact has n (name)',    p.n === 'ALICE');
    ok('compact has w (wave)',    p.w === 42);
    ok('compact has r (tier)',    p.r === 0);
    ok('compact has t',           p.t === 1700000000000);
    ok('flags omitted when all false',
        !('f' in p));
    // Roundtrip
    const v = globalMod.validateEntry(p);
    ok('roundtrip preserves name',  v.name === 'ALICE');
    ok('roundtrip preserves wave',  v.wave === 42);
    ok('roundtrip preserves tier',  v.tier === 0);
    ok('roundtrip flags default false (cheated)',  v.cheated === false);
    ok('roundtrip flags default false (autopilot)', v.autopilot === false);
    ok('roundtrip flags default false (retired)',  v.retired === false);
}

// ── 2) Flags bitmask packing ────────────────────────────────────────
{
    const e = {
        name: 'BOT', wave: 99, tier: 3, t: 1,
        cheated: true, autopilot: true, retired: true,
    };
    const p = globalMod.packEntry(e);
    ok('compact carries f for any true flag',     p.f === 0b111);
    const v = globalMod.validateEntry(p);
    ok('roundtrip cheated=true',                  v.cheated === true);
    ok('roundtrip autopilot=true',                v.autopilot === true);
    ok('roundtrip retired=true',                  v.retired === true);
}

// ── 3) Each flag bit independently ──────────────────────────────────
{
    const cases = [
        { src: { cheated: true,  autopilot: false, retired: false }, mask: 1 },
        { src: { cheated: false, autopilot: true,  retired: false }, mask: 2 },
        { src: { cheated: false, autopilot: false, retired: true  }, mask: 4 },
    ];
    for (const c of cases) {
        const e = Object.assign({ name: 'X', wave: 5, tier: 0, t: 1 }, c.src);
        const p = globalMod.packEntry(e);
        ok(`flag mask ${c.mask}: f === ${c.mask}`, p.f === c.mask);
        const v = globalMod.validateEntry(p);
        ok(`flag mask ${c.mask}: cheated round-trips`,   v.cheated   === c.src.cheated);
        ok(`flag mask ${c.mask}: autopilot round-trips`, v.autopilot === c.src.autopilot);
        ok(`flag mask ${c.mask}: retired round-trips`,   v.retired   === c.src.retired);
    }
}

// ── 4) Legacy long-form entries still parse (back-compat) ───────────
{
    const legacy = {
        name: 'OLD', wave: 7, tier: 1, t: 100,
        cheated: false, autopilot: true, retired: false,
    };
    const v = globalMod.validateEntry(legacy);
    ok('legacy long-form still parsed', v && v.name === 'OLD');
    ok('legacy flags work',             v.autopilot === true);
}

// ── 5) Mixed payload (some compact, some legacy) ────────────────────
{
    const mixed = [
        { n: 'A', w: 10, r: 0, t: 1 },              // compact, no flags
        { name: 'B', wave: 20, tier: 0, t: 2,       // legacy
          cheated: false, autopilot: false, retired: false },
        { n: 'C', w: 30, r: 0, t: 3, f: 2 },        // compact w/ autopilot
    ];
    const out = mixed.map(globalMod.validateEntry);
    ok('all three parse',          out.every(v => v !== null));
    ok('compact A name',           out[0].name === 'A');
    ok('legacy B name',            out[1].name === 'B');
    ok('compact C autopilot',      out[2].autopilot === true);
}

// ── 6) Size comparison: compact form is meaningfully smaller ────────
{
    const e = {
        name: 'ALICE', wave: 42, tier: 0, t: 1700000000000,
        cheated: false, autopilot: false, retired: false,
    };
    const longJson    = JSON.stringify(e);
    const compactJson = JSON.stringify(globalMod.packEntry(e));
    ok(`compact is smaller (${compactJson.length} vs ${longJson.length} bytes)`,
        compactJson.length < longJson.length);
    const ratio = compactJson.length / longJson.length;
    ok(`compact is ≤ 55% of long-form size (got ${(ratio * 100).toFixed(0)}%)`,
        ratio <= 0.55);
}

// ── 7) End-to-end through MockTransport: A sends compact, B parses ──
{
    const hub = transport.createMockHub();
    const A = globalMod.createGlobalBoard();
    const B = globalMod.createGlobalBoard();
    A.attach(hub.join('NEON23', 'A'));
    B.attach(hub.join('NEON23', 'B'));
    let bSeen = null;
    B.onUpdate(snap => { bSeen = snap; });
    A.publish({ name: 'ZED', wave: 99, tier: 2, autopilot: true });
    ok('E2E: B parsed compact entry from A',
        bSeen && bSeen.some(e => e.name === 'ZED' && e.autopilot === true));
    A.stop(); B.stop();
}

console.log(`\nGLOBAL WIRE COMPRESSION: ${pass} pass, ${fail} fail`);
process.exit(fail === 0 ? 0 : 1);
