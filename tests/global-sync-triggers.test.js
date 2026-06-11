// Regression: the global board's send policy is BANDWIDTH-GATED.
//
// History: this suite originally locked in aggressive triggers
// (broadcast on peer-join, on visibility-wake, 60-s timer) added when
// two devices' scores wouldn't merge. The broker-RETAINED snapshot
// (global-retained.test.js) now does newcomer catch-up server-side,
// and the broker connection is metered — so the policy inverted:
//
//   * publish() sends immediately (a fresh score is always novel).
//   * maybeBroadcast() — used by the slow heartbeat — sends ONLY
//     when the board holds an entry no inbound packet has shown us.
//     An idle, fully-synced client sends nothing at all.
//   * broadcastNow() stays unconditional (manual nudge / tests).
//   * There is NO send on peer-join and NO send on visibility-wake.
//
// DIAG* names are a reserved diagnostics prefix and must never be
// accepted onto the board (stray test entries would otherwise squat
// for the full 30-day TTL).

'use strict';

const transport = require('../src/multiplayer/transport.js');
const globalMod = require('../src/multiplayer/global.js');

let pass = 0, fail = 0;
function ok(name, cond, extra) {
    if (cond) { console.log('ok', name); pass++; }
    else      { console.log('FAIL', name, extra || ''); fail++; }
}

// Count sends by wrapping a mock-hub room.
function countingRoom(hub, room, id) {
    const r = hub.join(room, id);
    const counted = Object.create(r);
    counted.sends = 0;
    counted.send = (msg) => { counted.sends++; return r.send(msg); };
    return counted;
}

// ─────────────────────────────────────────────────────────────────────
// Phase 1 — publish() sends; broadcastNow() is unconditional
// ─────────────────────────────────────────────────────────────────────
{
    const hub = transport.createMockHub();
    let t = 1000000;
    const A = globalMod.createGlobalBoard({ now: () => t });
    const B = globalMod.createGlobalBoard({ now: () => t });
    const roomA = countingRoom(hub, 'NEON23', 'A');
    A.attach(roomA);
    B.attach(hub.join('NEON23', 'B'));

    A.publish({ name: 'ALICE', wave: 12, tier: 2 });
    ok('publish reaches B', B.snapshot().some(e => e.name === 'ALICE'));
    ok('publish cost exactly one send', roomA.sends === 1, roomA.sends);

    const before = A.getLastBroadcastAt();
    t += 50;
    const sent = A.broadcastNow();
    ok('broadcastNow returns entries sent', sent >= 1);
    ok('getLastBroadcastAt advances after broadcastNow', A.getLastBroadcastAt() > before);

    A.stop(); B.stop();
}

// ─────────────────────────────────────────────────────────────────────
// Phase 2 — novelty gate: known entries are never re-sent
// ─────────────────────────────────────────────────────────────────────
{
    const hub = transport.createMockHub();
    // Injectable clock — the per-peer anti-flood gate (100 ms) would
    // otherwise drop packets in a fast-running test.
    let t = 5000000;
    const tick = () => { t += 200; };
    const A = globalMod.createGlobalBoard({ now: () => t });
    const B = globalMod.createGlobalBoard({ now: () => t });
    const roomB = countingRoom(hub, 'NEON23', 'B');
    A.attach(hub.join('NEON23', 'A'));
    B.attach(roomB);

    // B learns ALICE from the wire → that entry is public knowledge.
    A.publish({ name: 'ALICE', wave: 30, tier: 0 });
    tick();
    ok('B merged the inbound entry', B.snapshot().some(e => e.name === 'ALICE'));
    const sendsBefore = roomB.sends;
    ok('maybeBroadcast with nothing novel sends NOTHING',
        B.maybeBroadcast() === 0 && roomB.sends === sendsBefore, roomB.sends);

    // B restores a historical score from its local save (boot relay
    // path: _mergeEntry, no network). That IS novel → one send.
    B._mergeEntry(B._validateEntry({ name: 'OLD TIMER', wave: 77, tier: 0 }));
    tick();
    ok('maybeBroadcast with a novel local entry sends',
        B.maybeBroadcast() >= 1 && roomB.sends === sendsBefore + 1);
    ok('the novel historical entry reached A',
        A.snapshot().some(e => e.name === 'OLD TIMER' && e.wave === 77));

    // B still considers OLD TIMER novel until it hears it from the
    // room. A re-broadcasting its merged board is that echo — after
    // it, B's gate closes.
    tick();
    A.broadcastNow();
    tick();
    ok('after hearing its own entry back, B goes quiet again',
        B.maybeBroadcast() === 0);

    A.stop(); B.stop();
}

// ─────────────────────────────────────────────────────────────────────
// Phase 3 — DIAG* reserved prefix is rejected everywhere
// ─────────────────────────────────────────────────────────────────────
{
    const v = globalMod.validateEntry;
    ok('DIAG-prefixed names are rejected',
        v({ name: 'DIAG SYNC', wave: 777, tier: 0 }) === null);
    ok('compact-form DIAG names are rejected too',
        v({ n: 'DIAGNOSTIC', w: 10, r: 0, t: Date.now() }) === null);
    ok('normal names still pass',
        v({ name: 'PROBE SYNC', wave: 10, tier: 0 }) !== null);

    const hub = transport.createMockHub();
    const A = globalMod.createGlobalBoard();
    A.attach(hub.join('NEON23', 'A'));
    const res = A.publish({ name: 'DIAG SYNC', wave: 777, tier: 0 });
    ok('publishing a DIAG name is refused', res.ok === false);
    A.stop();
}

console.log(`\nGLOBAL SYNC TRIGGERS: ${pass} pass, ${fail} fail`);
process.exit(fail === 0 ? 0 : 1);
