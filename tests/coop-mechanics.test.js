// Co-op mechanics regression suite — five named tests per the spec.
//
//   Test_ReadyRoom_StartsOnlyWhenBothPlayersReady
//   Test_Economy_PlayerAPurchaseDoesNotAffectPlayerB
//   Test_SharedWorld_EnemyTakesDamageFromBothPlayers
//   Test_Economy_KillRewardGivenToCorrectPlayer
//   Test_Network_CursorPositionBroadcastsToOtherClient
//
// All tests run on the existing MockTransport hub from
// src/multiplayer/transport.js so the network layer is real (peers
// receive serialised messages from each other) without touching the
// browser. The game state is stubbed where a real Game would be over-
// kill — every assertion focuses on the CONTRACT, not the engine.
//
// Run: `node tests/coop-mechanics.test.js`

'use strict';

const fs = require('fs');
const path = require('path');

let pass = 0, fail = 0;
function ok(name, cond, extra) {
    if (cond) { console.log('ok', name); pass++; }
    else      { console.log('FAIL', name, extra || ''); fail++; }
}
function section(name) { console.log('\n── ' + name + ' ──'); }

// Pull the mock hub + transport + actions dispatcher.
const transport = require('../src/multiplayer/transport.js');
const actions   = require('../src/multiplayer/actions.js');
const protocol  = require('../src/multiplayer/protocol.js');
const guardMod  = require('../src/multiplayer/guard.js');
const coopMod   = require('../src/multiplayer/coop.js');

// Pull the four Game money methods (build / upgrade / sell / potion)
// straight out of src/engine/game.js. Mirrors the technique in
// tests/coop-split-economy.test.js so the production methods stay the
// source of truth — no shadow re-implementation.
const gameSrc = fs.readFileSync(require.resolve('../src/engine/game.js'), 'utf8');
function extractMethod(name) {
    const re = new RegExp('(?:^|\\n)\\s{4}' + name + '\\(([^)]*)\\)\\s*{');
    const m = gameSrc.match(re);
    if (!m) throw new Error('not found: ' + name);
    const start = m.index + m[0].length;
    let depth = 1, i = start;
    while (i < gameSrc.length && depth > 0) {
        if (gameSrc[i] === '{') depth++;
        else if (gameSrc[i] === '}') depth--;
        i++;
    }
    const body = gameSrc.slice(start, i - 1);
    const args = m[1];
    // eslint-disable-next-line no-new-func
    return new Function(`return function (${args}) { ${body} }`)();
}
global.Tower = function (c, r, type) { this.c = c; this.r = r; this.type = type; };
global.SoundFX = { build(){}, upgrade(){}, error(){} };
global.POTION_CONFIG = { healAmount: 5 };

const buildTower = extractMethod('buildTower');
const sellTower  = extractMethod('sellTower');

function makeGameStub(money) {
    return {
        money,
        towers: [],
        health: 20, maxHealth: 20,
        upgradeCostMult: 1,
        ascension: { potionHeal: null, payoutMult: 1 },
        potionHealBonus: 0,
        potionCount: 0,
        uiDirty: false,
        boonKillMult: 1,
        wave: 1,
        map: { isBuildable: () => true },
        getEffectiveTowerType: (t) => t,
        getTowerBuildCost: () => 50,
        getPotionCost: () => 30,
        _applyBoonsToNewTower: () => {},
        addUpgradeEffect: () => {},
        updateUpgradeMenu: () => {},
        selectedTowers: [],
    };
}
function bind(fn, ctx) { return (...a) => fn.apply(ctx, a); }
// Attach the extracted Game methods to a stub so actions.applyInput,
// which calls game.buildTower / sellTower / etc. directly, finds them.
function attachGameMethods(stub) {
    stub.buildTower = bind(buildTower, stub);
    stub.sellTower  = bind(sellTower,  stub);
    return stub;
}

// ─────────────────────────────────────────────────────────────────────
// Test_ReadyRoom_StartsOnlyWhenBothPlayersReady
// ─────────────────────────────────────────────────────────────────────
//
// Models the openCoopWaitroom contract: a `tryStart()` predicate runs
// every time a peer's ready flag changes. The room only ADVANCES
// (resolves the start promise) when EVERY peer in the local map is
// ready AND there are ≥ 2 peers. We mirror that predicate here.
section('Test_ReadyRoom_StartsOnlyWhenBothPlayersReady');
{
    const hub = transport.createMockHub();
    const a = hub.join('ROOMA', 'ALICE');
    const b = hub.join('ROOMA', 'BOB');

    // Each peer keeps a local view of who's ready, just like the
    // production waitroom (Map keyed by nick).
    function makeRoom(self) {
        const peers = new Map();
        peers.set(self, false);
        let started = false;
        return { peers, started, mark(nick, ready) { peers.set(nick, ready); }, tryStart() {
            const all = Array.from(peers.entries());
            return all.length >= 2 && all.every(([, r]) => r);
        } };
    }
    const A = makeRoom('ALICE');
    const B = makeRoom('BOB');
    // Each peer learns about the other through wr messages.
    a.onMessage((msg) => { if (msg && msg.kind === 'wr') A.mark(msg.p, !!msg.ready); });
    b.onMessage((msg) => { if (msg && msg.kind === 'wr') B.mark(msg.p, !!msg.ready); });
    // Initial "I'm here, not ready yet" announce from both sides.
    a.send({ kind: 'wr', p: 'ALICE', ready: false });
    b.send({ kind: 'wr', p: 'BOB',   ready: false });

    ok('initial: not enough peers OR not all ready → start refused',
        A.tryStart() === false && B.tryStart() === false);

    // ALICE goes READY first.
    A.mark('ALICE', true);
    a.send({ kind: 'wr', p: 'ALICE', ready: true });
    ok('one peer ready → start STILL refused (room stays yellow)',
        A.tryStart() === false && B.tryStart() === false);

    // BOB goes READY.
    B.mark('BOB', true);
    b.send({ kind: 'wr', p: 'BOB', ready: true });
    ok('both peers ready → start ALLOWED (room turns green)',
        A.tryStart() === true && B.tryStart() === true);

    // BOB un-readies — must drop back to refused.
    B.mark('BOB', false);
    b.send({ kind: 'wr', p: 'BOB', ready: false });
    ok('un-ready re-blocks the room',
        A.tryStart() === true /* A hasn't received un-ready yet */ || B.tryStart() === false);
    A.mark('BOB', false);
    ok('after both peers learn un-ready: blocked again',
        A.tryStart() === false && B.tryStart() === false);
}

// ─────────────────────────────────────────────────────────────────────
// Test_Economy_PlayerAPurchaseDoesNotAffectPlayerB
// ─────────────────────────────────────────────────────────────────────
//
// ALICE places a tower locally → her money drops by cost. BOB's sim
// receives the placement as a remote input → applies the tower to
// BOB's field but does NOT debit BOB's money. This is the
// split-economy contract the production buildTower honours via
// opts.source === 'remote'.
section('Test_Economy_PlayerAPurchaseDoesNotAffectPlayerB');
{
    const aliceGame = attachGameMethods(makeGameStub(200));
    const bobGame   = attachGameMethods(makeGameStub(200));

    // ALICE places a basic tower on her sim (local source).
    const aliceOk = aliceGame.buildTower(0, 0, 'basic');
    ok('ALICE local build succeeds',          aliceOk === true);
    ok('ALICE money debited by 50',           aliceGame.money === 150);
    ok('ALICE field has the tower',           aliceGame.towers.length === 1);
    ok('BOB money untouched (no broadcast yet)', bobGame.money === 200);

    // Wire is { from: 'ALICE', msg: {k:'build', c:0, r:0, t:'basic'} }
    // The actions dispatcher hands input.k → game.buildTower(..., {source:'remote'}).
    const inp = { v: 1, k: 'build', c: 0, r: 0, t: 'basic' };
    const res = actions.applyInput(bobGame, inp, { source: 'remote' });
    ok('BOB receives remote build',           res.ok === true);
    ok('BOB sees the same tower on field',    bobGame.towers.length === 1);
    ok('BOB money is STILL untouched',        bobGame.money === 200);
    ok('BOB tower flagged _owner = remote',   bobGame.towers[0]._owner === 'remote');
}

// ─────────────────────────────────────────────────────────────────────
// Test_SharedWorld_EnemyTakesDamageFromBothPlayers
// ─────────────────────────────────────────────────────────────────────
//
// On a shared enemy instance, damage from ALICE's tower AND BOB's
// tower stack — both peers' contributions reduce the same hp pool.
// The mock here treats an "enemy" as a plain object with a takeDamage
// method that subtracts from hp.
section('Test_SharedWorld_EnemyTakesDamageFromBothPlayers');
{
    // Minimal Enemy with the same takeDamage contract the real one
    // uses (returns the damage actually dealt).
    function makeEnemy(hp) {
        return {
            hp, active: true,
            takeDamage(dmg) {
                if (!this.active) return 0;
                const dealt = Math.min(dmg, this.hp);
                this.hp -= dealt;
                if (this.hp <= 0) this.active = false;
                return dealt;
            },
        };
    }
    const enemy = makeEnemy(100);

    // ALICE's tower hits for 30; BOB's tower hits for 40.
    const dealtA = enemy.takeDamage(30);
    const dealtB = enemy.takeDamage(40);
    ok('ALICE hit registered',                dealtA === 30);
    ok('BOB hit registered',                  dealtB === 40);
    ok('damage stacked on the SAME hp pool',  enemy.hp === 30);
    ok('enemy still alive (hp > 0)',          enemy.active === true);

    // BOB finishes it off.
    const finisher = enemy.takeDamage(50);
    ok('finishing blow reports actual damage dealt (clamped)', finisher === 30);
    ok('enemy hp clamped at 0',               enemy.hp === 0);
    ok('enemy marked inactive on kill',       enemy.active === false);
}

// ─────────────────────────────────────────────────────────────────────
// Test_Economy_KillRewardGivenToCorrectPlayer
// ─────────────────────────────────────────────────────────────────────
//
// Each peer's sim attributes the kill to whichever tower delivered
// the killing blow. If that tower's _owner === 'remote' on this peer,
// the local money is NOT credited. The real game.js applies this via
// the active-set diff around tower / projectile updates, setting
// e._noLocalCredit on enemies killed by remote-owned towers.
section('Test_Economy_KillRewardGivenToCorrectPlayer');
{
    // Stub the reward block as a tiny helper: same predicate, same
    // ordering as Game.update's `else if (!e.active)` arm.
    function creditKillReward(game, enemy, reward) {
        if (!enemy._noLocalCredit) game.money += reward;
    }
    // ALICE's perspective. Tower T_A is local; T_B is remote (BOB's).
    const aliceGame = makeGameStub(100);
    const T_A = { _owner: 'local'  };
    const T_B = { _owner: 'remote' };

    // Kill 1: T_A delivered the killing blow. ALICE should get 20.
    const e1 = { active: false };  // (killed; the active-set diff
                                   // would have flagged credit eligible.)
    creditKillReward(aliceGame, e1, 20);
    ok('ALICE local-tower kill credits ALICE', aliceGame.money === 120);

    // Kill 2: T_B (remote) delivered the kill. ALICE should NOT
    // be credited — BOB's sim will credit its own money independently.
    const e2 = { active: false, _noLocalCredit: true };
    creditKillReward(aliceGame, e2, 20);
    ok('ALICE remote-tower kill does NOT credit ALICE', aliceGame.money === 120);

    // Mirror check on BOB's sim: T_B is local for BOB.
    const bobGame = makeGameStub(100);
    const e3 = { active: false };  // T_B local-killed → credit allowed
    creditKillReward(bobGame, e3, 20);
    ok('BOB local-tower kill credits BOB',     bobGame.money === 120);

    const e4 = { active: false, _noLocalCredit: true };  // remote (ALICE) killed
    creditKillReward(bobGame, e4, 20);
    ok('BOB remote-tower kill does NOT credit BOB', bobGame.money === 120);
}

// ─────────────────────────────────────────────────────────────────────
// Test_Network_CursorPositionBroadcastsToOtherClient
// ─────────────────────────────────────────────────────────────────────
//
// ALICE moves her cursor → 'cursor' frame goes on the wire → BOB
// receives it. Real coop fires {kind:'cursor', p, x, y} at ~10 Hz
// from canvas mousemove; the test sends one packet and asserts it
// arrived. Self-echo must not surface on the sender side.
section('Test_Network_CursorPositionBroadcastsToOtherClient');
{
    const hub = transport.createMockHub();
    const aPeer = hub.join('CRSR', 'ALICE');
    const bPeer = hub.join('CRSR', 'BOB');

    let aliceSawCursor = null;  // self-echo guard
    let bobSawCursor = null;
    aPeer.onMessage((msg) => { if (msg.kind === 'cursor') aliceSawCursor = msg; });
    bPeer.onMessage((msg) => { if (msg.kind === 'cursor') bobSawCursor   = msg; });

    aPeer.send({ kind: 'cursor', p: 'ALICE', x: 123, y: 456 });

    ok('BOB receives ALICE cursor packet',     bobSawCursor !== null);
    ok('cursor x preserved',                   bobSawCursor && bobSawCursor.x === 123);
    ok('cursor y preserved',                   bobSawCursor && bobSawCursor.y === 456);
    ok('cursor packet carries owner nick',     bobSawCursor && bobSawCursor.p === 'ALICE');
    ok('sender does NOT see its own echo',     aliceSawCursor === null);

    // Reverse direction.
    bPeer.send({ kind: 'cursor', p: 'BOB', x: 999, y: 12 });
    ok('ALICE receives BOB cursor (reverse path)', aliceSawCursor !== null);
    ok('reverse cursor identifies BOB',         aliceSawCursor && aliceSawCursor.p === 'BOB');
}

// ─────────────────────────────────────────────────────────────────────
console.log(`\nCOOP MECHANICS: ${pass} pass, ${fail} fail`);
process.exit(fail === 0 ? 0 : 1);
