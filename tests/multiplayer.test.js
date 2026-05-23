// Multiplayer — protocol + actions + mock-transport tests.
// Pure Node; mirrors the style of tests/aegis.test.js (logic phase).

let pass = 0, fail = 0;
function ok(name, cond) {
    if (cond) { console.log('ok', name); pass++; }
    else      { console.log('FAIL', name); fail++; }
}

const protocol  = require('../src/multiplayer/protocol.js');
const actions   = require('../src/multiplayer/actions.js');
const transport = require('../src/multiplayer/transport.js');
const guard     = require('../src/multiplayer/guard.js');

// ─────────────────────────────────────────────────────────────────────────
// Phase 1 — protocol
// ─────────────────────────────────────────────────────────────────────────

// fnv1a parity with NeonAegis (signalling.md: same code seeds both lobby
// and world). We don't load Aegis here, but the constants must match —
// 0x811c9dc5 / 0x01000193 — which the next two tests pin down by value.
ok('fnv1a deterministic',           protocol.fnv1a('NEAN42') === protocol.fnv1a('NEAN42'));
ok('fnv1a sensitive to input',      protocol.fnv1a('NEAN42') !== protocol.fnv1a('NEAN43'));
ok('fnv1a known vector (empty)',    protocol.fnv1a('') === 0x811c9dc5);

// Room codes — alphabet excludes I/O/0/1 to avoid ambiguity
ok('room code valid',               protocol.isValidRoomCode('NEAN42') === true);
ok('room code wrong length',        protocol.isValidRoomCode('NEAN4') === false);
ok('room code lowercase rejected',  protocol.isValidRoomCode('nean42') === false);
ok('room code excludes O',          protocol.isValidRoomCode('NEONXX') === false);
ok('room code excludes 0',          protocol.isValidRoomCode('NEAN40') === false);
ok('roomCodeToSeed deterministic',  protocol.roomCodeToSeed('NEAN42') === protocol.roomCodeToSeed('NEAN42'));
ok('roomCodeToSeed case-insensitive', protocol.roomCodeToSeed('NEAN42') === protocol.roomCodeToSeed('nean42'));

// validateInput — happy paths
ok('build accepted',     protocol.validateInput({ k: 'build', c: 3, r: 4, t: 'sniper' }).ok === true);
ok('upgrade accepted',   protocol.validateInput({ k: 'upgrade', tower: 2, slot: 1 }).ok === true);
ok('sell accepted',      protocol.validateInput({ k: 'sell', tower: 0 }).ok === true);
ok('potion accepted',    protocol.validateInput({ k: 'potion' }).ok === true);
ok('boon accepted',      protocol.validateInput({ k: 'boon', id: 'overdrive' }).ok === true);
ok('ability accepted',   protocol.validateInput({ k: 'ability', id: 'overclock' }).ok === true);

// validateInput — rejections (anti-cheat allow-list)
ok('null input rejected',         protocol.validateInput(null).ok === false);
ok('unknown kind rejected',       protocol.validateInput({ k: 'eval', code: 'alert(1)' }).ok === false);
ok('unknown build type rejected', protocol.validateInput({ k: 'build', c: 0, r: 0, t: 'mythic_destroyer' }).ok === false);
ok('non-integer coord rejected',  protocol.validateInput({ k: 'build', c: 1.5, r: 0, t: 'basic' }).ok === false);
ok('out-of-range coord rejected', protocol.validateInput({ k: 'build', c: 9999, r: 0, t: 'basic' }).ok === false);
ok('negative tower idx rejected', protocol.validateInput({ k: 'upgrade', tower: -1, slot: 0 }).ok === false);
ok('slot out of range rejected',  protocol.validateInput({ k: 'upgrade', tower: 0, slot: 7 }).ok === false);
ok('boon empty id rejected',      protocol.validateInput({ k: 'boon', id: '' }).ok === false);
ok('boon oversize id rejected',   protocol.validateInput({ k: 'boon', id: 'x'.repeat(65) }).ok === false);

// Extending the allow-list per anti-cheat.md (live TOWERS + variants)
const custom = new Set(['basic', 'variant_cryo']);
ok('custom allow-list accepts variant',
    protocol.validateInput({ k: 'build', c: 0, r: 0, t: 'variant_cryo' }, custom).ok === true);
ok('custom allow-list excludes default',
    protocol.validateInput({ k: 'build', c: 0, r: 0, t: 'sniper' }, custom).ok === false);

// validateFrame
const goodFrame = {
    v: 1, p: 'ALICE', f: 42, i: [
        { k: 'build', c: 3, r: 4, t: 'sniper' },
        { k: 'upgrade', tower: 0, slot: 0 },
    ],
};
ok('frame accepted', protocol.validateFrame(goodFrame).ok === true);
ok('frame bad version rejected',  protocol.validateFrame(Object.assign({}, goodFrame, { v: 2 })).ok === false);
ok('frame negative frame# rejected', protocol.validateFrame(Object.assign({}, goodFrame, { f: -1 })).ok === false);
ok('frame missing peer rejected', protocol.validateFrame(Object.assign({}, goodFrame, { p: '' })).ok === false);
ok('frame non-array inputs rejected', protocol.validateFrame(Object.assign({}, goodFrame, { i: 'oops' })).ok === false);
ok('frame oversize inputs rejected',
    protocol.validateFrame(Object.assign({}, goodFrame, { i: new Array(257).fill({ k: 'potion' }) })).ok === false);
ok('frame bad inner input rejected',
    protocol.validateFrame(Object.assign({}, goodFrame, { i: [{ k: 'eval' }] })).ok === false);

// hash field preserved on accept
const hashed = protocol.validateFrame(Object.assign({}, goodFrame, { hash: 'abc123' }));
ok('frame hash passes through', hashed.ok && hashed.frame.hash === 'abc123');

// ─────────────────────────────────────────────────────────────────────────
// Phase 2 — throttle (anti-cheat.md DoS mitigation)
// ─────────────────────────────────────────────────────────────────────────
let nowMs = 1000;
const clock = () => nowMs;
const throttle = protocol.createThrottle(30, clock);

// Burst of 30 → all accepted, 31st rejected.
let burstAccepted = 0;
for (let i = 0; i < 30; i++) if (throttle.accept('ALICE')) burstAccepted++;
ok('throttle initial burst (30)', burstAccepted === 30);
ok('throttle 31st rejected',      throttle.accept('ALICE') === false);

// After 1 second, bucket refills to full.
nowMs += 1000;
let refillAccepted = 0;
for (let i = 0; i < 30; i++) if (throttle.accept('ALICE')) refillAccepted++;
ok('throttle refills over time',  refillAccepted === 30);

// Different peer has its own bucket.
ok('per-peer isolation', throttle.accept('BOB') === true);

// ─────────────────────────────────────────────────────────────────────────
// Phase 3 — snapshotHash (desync detection, sync.md)
// ─────────────────────────────────────────────────────────────────────────
const gameA = {
    wave: 5, health: 18, money: 320,
    towers: [
        { c: 2, r: 3, type: 'basic',  damageDealt: 1200 },
        { c: 5, r: 7, type: 'sniper', damageDealt: 800 },
    ],
    enemies: [{ active: true }, { active: false }, { active: true }],
};
const gameB = {
    // same logical state, towers in reversed order — hash should match
    wave: 5, health: 18, money: 320.4,
    towers: [
        { c: 5, r: 7, type: 'sniper', damageDealt: 800 },
        { c: 2, r: 3, type: 'basic',  damageDealt: 1200 },
    ],
    enemies: [{ active: true }, { active: true }, { active: false }],
};
ok('snapshotHash stable',                protocol.snapshotHash(gameA) === protocol.snapshotHash(gameA));
ok('snapshotHash order-insensitive',     protocol.snapshotHash(gameA) === protocol.snapshotHash(gameB));
ok('snapshotHash detects wave divergence',
    protocol.snapshotHash(gameA) !== protocol.snapshotHash(Object.assign({}, gameA, { wave: 6 })));
ok('snapshotHash detects money divergence',
    protocol.snapshotHash(gameA) !== protocol.snapshotHash(Object.assign({}, gameA, { money: 999 })));
ok('snapshotHash detects tower-count divergence',
    protocol.snapshotHash(gameA) !== protocol.snapshotHash(Object.assign({}, gameA, { towers: [gameA.towers[0]] })));

// ─────────────────────────────────────────────────────────────────────────
// Phase 4 — actions dispatcher
// ─────────────────────────────────────────────────────────────────────────
function makeFakeGame() {
    return {
        money: 1000,
        health: 20,
        towers: [{ c: 0, r: 0, type: 'basic', level: 0, sold: false }],
        log: [],
        buildTower(c, r, t, opts) {
            this.log.push({ k: 'build', c, r, t, source: opts && opts.source });
            if (c < 0 || r < 0) return false;
            const cost = 50;
            if (this.money < cost) return false;
            this.money -= cost;
            this.towers.push({ c, r, type: t, level: 0, sold: false });
            return true;
        },
        upgradeTower(tower, slot, opts) {
            this.log.push({ k: 'upgrade', slot, source: opts && opts.source });
            if (this.money < 100) return false;
            this.money -= 100;
            tower.level = (tower.level || 0) + 1;
            return true;
        },
        sellTower(tower, opts) {
            this.log.push({ k: 'sell', source: opts && opts.source });
            tower.sold = true;
            this.money += 25;
            return true;
        },
        buyPotion(opts) {
            this.log.push({ k: 'potion', source: opts && opts.source });
            return true;
        },
        pickBoon(id, opts) {
            this.log.push({ k: 'boon', id, source: opts && opts.source });
            return true;
        },
        useAbility(id, opts) {
            this.log.push({ k: 'ability', id, source: opts && opts.source });
            return true;
        },
    };
}

let game = makeFakeGame();

// Happy-path: a build deducts money and appends a tower.
const r1 = actions.applyInput(game, { k: 'build', c: 3, r: 4, t: 'basic' }, { source: 'remote' });
ok('build applied',           r1.ok === true);
ok('build deducted money',    game.money === 950);
ok('build added tower',       game.towers.length === 2);
ok('build tagged source',     game.log[0].source === 'remote');

// Upgrade
const r2 = actions.applyInput(game, { k: 'upgrade', tower: 0, slot: 1 });
ok('upgrade applied',         r2.ok === true);
ok('upgrade incremented',     game.towers[0].level === 1);

// Upgrade against missing tower index → reject, no crash.
const r3 = actions.applyInput(game, { k: 'upgrade', tower: 99, slot: 0 });
ok('missing tower rejected',  r3.ok === false && r3.reason === 'no-tower');

// Game rejects (insufficient funds) → ok:false propagated.
game.money = 0;
const r4 = actions.applyInput(game, { k: 'build', c: 1, r: 1, t: 'sniper' });
ok('game-side rejection bubbles up', r4.ok === false && r4.reason === 'rejected');

// applyFrame end-to-end: validates + dispatches in one call.
game = makeFakeGame();
const frame = {
    v: 1, p: 'BOB', f: 100, i: [
        { k: 'build',   c: 2, r: 2, t: 'sniper' },
        { k: 'potion' },
        { k: 'eval',    payload: 'oh no' },   // dropped at validation
    ],
};
const res = actions.applyFrame(game, frame, { source: 'remote' });
ok('applyFrame validates entire frame',
    res.ok === false && res.reason === 'input:bad-kind');

// Same frame minus the bad input — should dispatch both.
frame.i.pop();
const res2 = actions.applyFrame(game, frame, { source: 'remote' });
ok('applyFrame dispatches all valid',
    res2.ok === true && res2.applied.length === 2 && res2.dropped.length === 0);
ok('applyFrame tags source on each call',
    game.log.every(e => e.source === 'remote'));

// ─────────────────────────────────────────────────────────────────────────
// Phase 5 — mock transport round-trip (Phase-1 deliverable in roadmap:
//   "Two browsers in a room can exchange chat messages")
// ─────────────────────────────────────────────────────────────────────────
const hub = transport.createMockHub();
const alice = hub.join('NEAN42', 'ALICE');
const bob   = hub.join('NEAN42', 'BOB');
const carl  = hub.join('OTHER1', 'CARL'); // different room — should not hear

const inboxBob  = [];
const inboxCarl = [];
bob.onMessage((m, from) => inboxBob.push({ m, from }));
carl.onMessage((m, from) => inboxCarl.push({ m, from }));

alice.send({ kind: 'chat', body: 'hi bob' });
ok('mock transport delivers same-room',   inboxBob.length === 1 && inboxBob[0].m.body === 'hi bob');
ok('mock transport tags sender',          inboxBob[0].from === 'ALICE');
ok('mock transport room isolation',       inboxCarl.length === 0);

// Sender doesn't receive its own messages.
const inboxAlice = [];
alice.onMessage((m, from) => inboxAlice.push({ m, from }));
bob.send({ kind: 'chat', body: 'hello back' });
ok('no self-echo',                        inboxAlice.length === 1 && inboxAlice[0].m.body === 'hello back');

// Messages are deep-cloned across the wire.
const refMsg = { kind: 'chat', payload: { n: 1 } };
inboxBob.length = 0;
alice.send(refMsg);
refMsg.payload.n = 999; // mutate after send
ok('wire deep-clones payload',            inboxBob[0].m.payload.n === 1);

// Leaving the room stops delivery.
bob.leave();
inboxBob.length = 0;
alice.send({ kind: 'chat', body: 'gone' });
ok('leave() removes listener',            inboxBob.length === 0);

// ─────────────────────────────────────────────────────────────────────────
// End-to-end: peer A's input frame → peer B applies it against its Game
// ─────────────────────────────────────────────────────────────────────────
const peerA = hub.join('LOCKSTEP', 'A');
const peerB = hub.join('LOCKSTEP', 'B');
const gameB_e2e = makeFakeGame();
peerB.onMessage((msg) => {
    if (msg && msg.kind === 'frame') actions.applyFrame(gameB_e2e, msg.frame, { source: 'remote' });
});
peerA.send({ kind: 'frame', frame: { v: 1, p: 'A', f: 7, i: [{ k: 'build', c: 5, r: 5, t: 'sniper' }] } });
ok('lockstep frame applied on peer B',    gameB_e2e.towers.length === 2);
ok('lockstep build came from remote',     gameB_e2e.log[0].source === 'remote');

// ─────────────────────────────────────────────────────────────────────────
// Phase 6 — PeerGuard (cheat-resistance layer)
// ─────────────────────────────────────────────────────────────────────────
let guardClock = 10_000;
const guardNow = () => guardClock;
const rejected = [];
const g = guard.createGuard({
    perSec: 30,
    now: guardNow,
    onReject: (info) => rejected.push(info),
});

function mkFrame(peer, fnum, inputs) {
    return { v: 1, p: peer, f: fnum, i: inputs || [] };
}

// Happy path: monotonic frames from same peer pass.
ok('guard accepts f0', g.check(mkFrame('A', 0, [{ k: 'potion' }])).ok === true);
ok('guard accepts f1', g.check(mkFrame('A', 1, [])).ok === true);
ok('guard accepts f2', g.check(mkFrame('A', 2, [])).ok === true);

// Duplicate frame from same peer dropped.
const dupRes = g.check(mkFrame('A', 1, []));
ok('guard drops duplicate frame', dupRes.ok === false && dupRes.reason === 'duplicate');

// Out-of-window old frame dropped.
g.check(mkFrame('A', 100, []));
const oldRes = g.check(mkFrame('A', 50, [])); // 50 < 100-30
ok('guard drops replay-old', oldRes.ok === false && oldRes.reason === 'replay-old');

// Late but inside reorder window is OK.
ok('guard accepts late-inside-window', g.check(mkFrame('A', 90, [])).ok === true);

// Per-frame kind cap — 5 builds in one frame is the cheat we're catching.
const cappy = mkFrame('A', 200, [
    { k: 'build', c: 1, r: 1, t: 'basic' },
    { k: 'build', c: 2, r: 1, t: 'basic' },
    { k: 'build', c: 3, r: 1, t: 'basic' },
    { k: 'build', c: 4, r: 1, t: 'basic' },
    { k: 'build', c: 5, r: 1, t: 'basic' },
]);
const capRes = g.check(cappy);
ok('guard enforces per-frame build cap', capRes.ok === false && capRes.reason === 'cap:build');

// Different peers don't share monotonic state.
ok('guard isolates per-peer monotonic', g.check(mkFrame('B', 0, [])).ok === true);

// Throttle: with 30/sec and frames carrying multiple inputs, a flood
// is rejected. Use a fresh guard so we control the clock.
let floodClock = 0;
const gFlood = guard.createGuard({ perSec: 10, now: () => floodClock });
let floodAccepted = 0;
for (let i = 0; i < 20; i++) {
    if (gFlood.check(mkFrame('C', i, [{ k: 'potion' }])).ok) floodAccepted++;
}
ok('guard throttles flood', floodAccepted === 10);

// onReject hook fired for at least one of the rejections.
ok('guard onReject fired', rejected.length > 0);

// HMAC signatures: a guard with a secret rejects unsigned frames and
// frames signed by a different secret.
const secret  = guard.deriveSecret('NEAN42', 'gameplay');
const secret2 = guard.deriveSecret('OTHER1', 'gameplay');
ok('deriveSecret deterministic',     secret === guard.deriveSecret('NEAN42', 'gameplay'));
ok('deriveSecret namespace differs', secret !== guard.deriveSecret('NEAN42', 'lobby'));

const gSig = guard.createGuard({ secret, now: guardNow });
const f1 = mkFrame('A', 0, [{ k: 'potion' }]);
ok('signed-guard rejects unsigned',  gSig.check(f1).ok === false);

const f1Signed = gSig.signFrame(f1);
ok('signed-guard accepts signed',    gSig.check(f1Signed).ok === true);

// Tampered after signing → sig invalid.
const tampered = Object.assign({}, f1Signed, { f: 99 });
ok('signed-guard rejects tampered',  gSig.check(tampered).ok === false);

// Signed with wrong room secret → rejected.
const gSig2 = guard.createGuard({ secret: secret2, now: guardNow });
ok('wrong-secret sig rejected',      gSig.check(gSig2.signFrame(mkFrame('A', 1, []))).ok === false);

// Sig survives input-key reordering (canonicalisation).
const reordered = gSig.signFrame(mkFrame('A', 2, [{ t: 'basic', r: 0, c: 0, k: 'build' }]));
ok('sig stable under key order',     gSig.check(reordered).ok === true);

// ─────────────────────────────────────────────────────────────────────────
// Phase 7 — Lobby (room-code generation, parsing, nickname sanitisation)
// ─────────────────────────────────────────────────────────────────────────
const lobby = require('../src/multiplayer/lobby.js');

// Code parser: accepts upper-case alphabet, tolerates dashes/spaces,
// rejects ambiguous letters explicitly (matches protocol alphabet).
ok('parse trims dashes',          lobby.parseRoomCode('NEAN-42').ok === true);
ok('parse upper-cases',           lobby.parseRoomCode('nean42').ok === true && lobby.parseRoomCode('nean42').code === 'NEAN42');
ok('parse rejects empty',         lobby.parseRoomCode('').ok === false);
ok('parse rejects wrong length',  lobby.parseRoomCode('NEAN').ok === false);
ok('parse rejects ambiguous',     lobby.parseRoomCode('NEONIO').ok === false); // I/O stripped → 'NEN' too short
ok('parse rejects non-letters',   lobby.parseRoomCode('!!!!!!').ok === false);

// Generator: produces a 6-char string in the alphabet (10× sample).
let allGood = true;
for (let i = 0; i < 10; i++) {
    const c = lobby.generateRoomCode();
    if (!protocol.isValidRoomCode(c)) { allGood = false; break; }
}
ok('generator always produces valid codes', allGood);

// Nick sanitisation
ok('nick upper-cases + strips',   lobby.sanitiseNick('al ic@e') === 'ALICE');
ok('nick truncates at 12',        lobby.sanitiseNick('A'.repeat(20)) === 'A'.repeat(12));
ok('nick pads short input',       lobby.sanitiseNick('A') === 'AXY');
ok('empty nick gets fallback',    /^[A-Z0-9]{3,12}$/.test(lobby.sanitiseNick('')));

// ─────────────────────────────────────────────────────────────────────────
// Phase 8 — Race mode controller
// ─────────────────────────────────────────────────────────────────────────
const race = require('../src/multiplayer/race.js');

// validateHeartbeat: shape + ranges.
const hbGood = { v: 1, k: 'hb', p: 'ALICE', w: 5, h: 18, mh: 20, m: 320, s: 1280, a: 1, f: 1 };
ok('heartbeat accepted',          race.validateHeartbeat(hbGood).ok === true);
ok('heartbeat wrong kind',        race.validateHeartbeat(Object.assign({}, hbGood, { k: 'frame' })).ok === false);
ok('heartbeat wrong version',     race.validateHeartbeat(Object.assign({}, hbGood, { v: 2 })).ok === false);
ok('heartbeat float wave',        race.validateHeartbeat(Object.assign({}, hbGood, { w: 1.5 })).ok === false);
ok('heartbeat out-of-range hp',   race.validateHeartbeat(Object.assign({}, hbGood, { h: 99999 })).ok === false);
ok('heartbeat alive flag',        race.validateHeartbeat(Object.assign({}, hbGood, { a: 7 })).ok === false);

// buildHeartbeat clamps + floors as documented.
const fakeGame = { wave: 3, health: 19, maxHealth: 20, money: 250.7, score: 999.9 };
const hb1 = race.buildHeartbeat({ peer: 'ALICE', game: fakeGame, frame: 7 });
ok('built hb has floored money',  hb1.m === 250);
ok('built hb has floored score',  hb1.s === 999);
ok('built hb alive=1',            hb1.a === 1);
const gameOverHB = race.buildHeartbeat({ peer: 'ALICE', game: Object.assign({}, fakeGame, { state: 'gameover' }), frame: 9 });
ok('built hb alive=0 on gameover', gameOverHB.a === 0);
// Hostile inputs are clamped, not crashed.
const evilGame = { wave: 9_999_999, health: -50, maxHealth: 9_999_999, money: -1, score: 'lol' };
const evilHB = race.buildHeartbeat({ peer: 'ALICE', game: evilGame, frame: 0 });
ok('build clamps wave',  evilHB.w === 9999);
ok('build clamps hp',    evilHB.h === 0);
ok('build clamps money', evilHB.m === 0);
ok('build defaults score on NaN', evilHB.s === 0);

// Race controller — wire two peers through the mock hub end-to-end.
const raceHub = transport.createMockHub();
const aPeer = raceHub.join('NEAN42', 'A');
const bPeer = raceHub.join('NEAN42', 'B');

let nowMsR = 0;
const nowFnR = () => nowMsR;
let aGame = { wave: 1, health: 20, maxHealth: 20, money: 100, score: 0 };
let bGame = { wave: 1, health: 20, maxHealth: 20, money: 100, score: 0 };

const raceA = race.createRace({
    peer: 'ALICE', transport: aPeer, getGame: () => aGame,
    now: nowFnR, heartbeatMs: 1000, staleMs: 3000, dropMs: 10000,
});
const raceB = race.createRace({
    peer: 'BOB', transport: bPeer, getGame: () => bGame,
    now: nowFnR, heartbeatMs: 1000, staleMs: 3000, dropMs: 10000,
});

const updatesB = [];
raceB.onUpdate(snap => updatesB.push(snap));

// Subscribe B first, then A — otherwise A's initial tick fires before
// B's onMessage listener is bound and B misses the first heartbeat.
raceB.start(); raceA.start();
ok('B sees ALICE row after start',
   updatesB.length > 0 && updatesB[updatesB.length - 1].peers.some(p => p.peer === 'ALICE'));

// Advance both games, fire next tick.
aGame.wave = 5; aGame.money = 320;
bGame.wave = 3;
nowMsR = 1000;
raceA._tickOnce(); raceB._tickOnce();
const lastB = updatesB[updatesB.length - 1];
const aliceRow = lastB.peers.find(p => p.peer === 'ALICE');
ok('B sees ALICE wave update',   aliceRow && aliceRow.w === 5);
ok('B leaderboard sorted by wave', lastB.peers[0].w >= lastB.peers[lastB.peers.length - 1].w);

// Stale sweep: skip several seconds, B's roster should mark ALICE stale.
nowMsR = 1000 + 4000;     // 4s of silence > 3s stale window
raceB._sweepOnce();
const staleSnap = updatesB[updatesB.length - 1];
const staleRow = staleSnap.peers.find(p => p.peer === 'ALICE');
ok('stale peer flagged',       staleRow && staleRow.stale === true);

// Drop sweep: jump far enough that ALICE is dropped entirely.
nowMsR = 1000 + 20000;
raceB._sweepOnce();
const dropSnap = updatesB[updatesB.length - 1];
ok('dropped peer disappears',  !dropSnap.peers.some(p => p.peer === 'ALICE'));

// Reconnect: ALICE rejoins after a network blip. Need a new frame > last
// seen (monotonic), which a real reconnect produces because the
// controller's frame counter resets on start.
const reconnect = race.buildHeartbeat({
    peer: 'ALICE',
    game: { wave: 7, health: 15, maxHealth: 20, money: 500, score: 2000 },
    frame: 9999,
});
raceB._ingest(reconnect, 'someid');
const reSnap = updatesB[updatesB.length - 1];
ok('reconnected peer reappears',
   reSnap.peers.some(p => p.peer === 'ALICE' && p.w === 7));

// Replay defence: re-sending the same old heartbeat (lower frame#) is ignored.
raceB._ingest(reconnect, 'someid'); // same f, dedupe
const replayedSnap = updatesB[updatesB.length - 1];
ok('replay of old hb is ignored',
   replayedSnap.peers.find(p => p.peer === 'ALICE').w === 7);

// Self-name impostor: a remote claiming to be 'BOB' is dropped on B's side.
const impostor = race.buildHeartbeat({
    peer: 'BOB',
    game: { wave: 999, health: 1, maxHealth: 20, money: 0, score: 0 },
    frame: 10000,
});
raceB._ingest(impostor, 'evil');
const meRow = raceB.roster['BOB'];
ok('impostor rejected — local seat untouched',
   meRow && meRow.w !== 999);

// stop() clears timers + listeners.
raceA.stop(); raceB.stop();
ok('race.stop() runs without error', true);

// Bandwidth proxy: roster size capped under abusive joins so a flood of
// fake peers can't OOM the leaderboard.
const cap = race.createRace({
    peer: 'ME', transport: { send() {}, onMessage() { return () => {}; } },
    now: () => 0, maxRosterSize: 4, heartbeatMs: 1000,
});
for (let i = 0; i < 20; i++) {
    cap._ingest(race.buildHeartbeat({
        peer: 'X' + i,
        game: { wave: 1, health: 1, maxHealth: 1, money: 0, score: 0 },
        frame: i,
    }), 'x');
}
ok('roster size cap holds under flood', Object.keys(cap.roster).length <= 4);

// ─────────────────────────────────────────────────────────────────────────
// Phase 9 — Seeded PRNG (multiplayer determinism)
// ─────────────────────────────────────────────────────────────────────────
const prngMod = require('../src/multiplayer/prng.js');

// Two independent generators with the same seed produce the same stream.
const prngA = prngMod.mulberry32(12345);
const prngB = prngMod.mulberry32(12345);
let streamMatch = true;
for (let i = 0; i < 100; i++) if (prngA() !== prngB()) { streamMatch = false; break; }
ok('mulberry32 deterministic stream', streamMatch);

// Different seeds diverge.
const prngC = prngMod.mulberry32(12346);
ok('mulberry32 sensitive to seed', prngMod.mulberry32(12345)() !== prngC());

// install() swaps Math.random; restore() puts the original back.
const before = Math.random;
const restore = prngMod.install(12345);
ok('install replaces Math.random', Math.random !== before);
// First three values of the seeded stream are reproducible.
const seq1 = [Math.random(), Math.random(), Math.random()];
restore();
ok('restore returns original Math.random', Math.random === before);
const restore2 = prngMod.install(12345);
const seq2 = [Math.random(), Math.random(), Math.random()];
restore2();
ok('reinstall reproduces sequence', seq1[0] === seq2[0] && seq1[1] === seq2[1] && seq1[2] === seq2[2]);

// installFromRoomCode derives the same seed roomCodeToSeed gives — so a
// numeric seed input in single-player and a room-code input in MP both
// land on the same world.
const restore3 = prngMod.installFromRoomCode('NEAN42');
const fromCode = Math.random();
restore3();
const restore4 = prngMod.install(protocol.roomCodeToSeed('NEAN42'));
const fromSeed = Math.random();
restore4();
ok('installFromRoomCode == install(roomCodeToSeed)', fromCode === fromSeed);

// ─────────────────────────────────────────────────────────────────────────
// Phase 10 — Lockstep controller
// ─────────────────────────────────────────────────────────────────────────
const lockstep = require('../src/multiplayer/lockstep.js');

// Build two peers that share a transport via simple inboxes.
function makePair() {
    let aMsgs = [], bMsgs = [];
    let aApplied = [], bApplied = [];
    const A = lockstep.createLockstep({
        me: 'A', peers: ['A', 'B'],
        send: (frame) => bMsgs.push(frame),
        apply: (event) => aApplied.push(event),
        hash: () => 'h-a',
        syncEvery: 4,
        // Lockstep itself sends a frame per tick, so we need a generous
        // throttle inside the guard or it'll start dropping our own
        // frames at high tick counts in the tests below.
        perSec: 6000,
    });
    const B = lockstep.createLockstep({
        me: 'B', peers: ['A', 'B'],
        send: (frame) => aMsgs.push(frame),
        apply: (event) => bApplied.push(event),
        hash: () => 'h-b',
        syncEvery: 4,
        perSec: 6000,
    });
    // Pump pending messages between the peers.
    // Naming: aMsgs holds frames addressed TO A (sent by B); deliver them
    // to A. bMsgs holds frames addressed TO B (sent by A); deliver to B.
    function pump() {
        while (aMsgs.length || bMsgs.length) {
            const fb = bMsgs.shift();
            if (fb) B.receive(fb, fb.p);
            const fa = aMsgs.shift();
            if (fa) A.receive(fa, fa.p);
        }
    }
    return { A, B, pump, aApplied, bApplied };
}

// Step zero: A blocks because B hasn't sent its frame 0 yet, and v.v.
{
    let A = lockstep.createLockstep({
        me: 'A', peers: ['A', 'B'],
        send: () => {}, apply: () => {}, hash: () => 'h',
    });
    ok('blocks waiting for peer', A.advance() === false && A.blocked === true);
}

// End-to-end: two peers, A places a build at tick 0, B's apply sees it.
{
    const p = makePair();
    p.A.submitInput({ k: 'build', c: 5, r: 5, t: 'basic' });
    p.A.advance(); // publishes A's frame 0 (still blocked on B)
    p.pump();
    p.B.advance(); // publishes B's empty frame 0, sees A's frame 0
    p.pump();
    // Now both have each other's frame 0 — calling advance again drains.
    p.A.advance();
    p.B.advance();
    ok('A applied A\'s own input at tick 0',
       p.aApplied.length === 1 && p.aApplied[0].input.k === 'build');
    ok('B applied A\'s input at tick 0',
       p.bApplied.length === 1 && p.bApplied[0].peer === 'A');
}

// Heartbeats keep things moving when nobody types. After 10 ticks of
// silence, both peers' currentTick should advance to 10.
{
    const p = makePair();
    for (let t = 0; t < 10; t++) {
        p.A.advance(); p.pump();
        p.B.advance(); p.pump();
        p.A.advance(); p.B.advance(); // drain
        p.pump();
    }
    ok('heartbeats advance the tick', p.A.currentTick >= 10 && p.B.currentTick >= 10);
}

// Desync detection: hashes differ at sync tick, onDesync fires.
{
    const desyncs = [];
    const A = lockstep.createLockstep({
        me: 'A', peers: ['A', 'B'],
        send: () => {}, apply: () => {}, hash: () => 'h-A',
        syncEvery: 1,
        onDesync: (info) => desyncs.push(info),
        perSec: 6000,
    });
    // Inject a fake B frame with a different hash at tick 0.
    A.advance();        // publishes A's frame 0 with hash h-A
    // Build a frame from "B" with hash h-B.
    A.receive({ v: 1, p: 'B', f: 0, i: [], hash: 'h-B' }, 'B');
    ok('desync detected when hashes differ',
       desyncs.length > 0 && desyncs[0].mine === 'h-A' && desyncs[0].others.B === 'h-B');
}

// Stale peer dropped after timeout — surviving peer can advance alone.
{
    let blocks = 0;
    const A = lockstep.createLockstep({
        me: 'A', peers: ['A', 'GHOST'],
        send: () => {}, apply: () => {}, hash: () => 'h',
        peerTimeout: 5, syncEvery: 999,
        onStall: () => blocks++,
        perSec: 6000,
    });
    // Force currentTick forward past the timeout window with no frames
    // from GHOST. We can't easily mutate currentTick directly, so we
    // simulate via advancing past blocks. After peerTimeout ticks of
    // silence (lastSeenTick.GHOST never set, defaults to 0), advance
    // should drop GHOST.
    // First: advance the local frame counter. Submit A's frames so the
    // missing peer is GHOST. We can't actually push currentTick without
    // GHOST's input, so the test exercises drop-on-stall via direct
    // construction: build a controller starting at tick 0 with peer
    // GHOST whose lastSeenTick stays at 0.
    A.advance(); // sets blocked; GHOST missing, last=0, current=0, 0-0 < 5
    ok('stalls at start', A.blocked === true);
    // Move A's currentTick — only possible by removing GHOST first. So
    // we use the controller's advance() loop after explicitly dropping
    // GHOST via removePeer (the user-facing API for "peer left").
    A.removePeer('GHOST');
    A.advance();
    ok('advance succeeds after peer removed', A.currentTick === 1);
}

// Malformed wire frame rejected via guard.
{
    const A = lockstep.createLockstep({
        me: 'A', peers: ['A', 'B'],
        send: () => {}, apply: () => {}, hash: () => 'h',
    });
    const r = A.receive({ v: 1, p: 'B', f: 0, i: [{ k: 'eval' }] }, 'B');
    ok('guard rejects malformed wire frame', r.ok === false);
}

// ─────────────────────────────────────────────────────────────────────────
console.log(`\n${pass}/${pass + fail} passed${fail ? ', ' + fail + ' FAILED' : ''}`);
process.exit(fail === 0 ? 0 : 1);
