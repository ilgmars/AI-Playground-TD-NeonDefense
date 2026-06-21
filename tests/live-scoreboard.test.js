// Live in-match multiplayer scoreboard — pure ranking + broadcast-gating.
// Pure Node; mirrors the style of tests/multiplayer.test.js (logic phase).

let pass = 0, fail = 0;
function ok(name, cond) {
    if (cond) { console.log('ok', name); pass++; }
    else      { console.log('FAIL', name); fail++; }
}

const lb = require('../src/multiplayer/live-scoreboard.js');
const now = 100000;

// ── rankEntries ────────────────────────────────────────────────────────────
const entries = [
    { id: 'a', name: 'Ann',  score: 300, wave: 5, ts: now - 1000 },
    { id: 'b', name: 'Bob',  score: 300, wave: 7, ts: now - 1000 }, // tie score, higher wave -> ahead of Ann
    { id: 'c', name: 'Cara', score: 900, wave: 4, ts: now - 1000 }, // top
    { id: 'd', name: 'Dan',  score: 500, wave: 9, ts: now - 999999 }, // stale -> dropped
];
const r = lb.rankEntries(entries, now, 30000);
ok('top score ranks first',        r[0].id === 'c' && r[0].rank === 1);
ok('wave breaks a score tie',      r[1].id === 'b' && r[2].id === 'a');
ok('stale entry is dropped',       r.length === 3 && !r.find(x => x.id === 'd'));
ok('ranks are 1-based + dense',    r.map(x => x.rank).join(',') === '1,2,3');

// ── shouldBroadcast (bandwidth gating) ──────────────────────────────────────
const O = { heartbeatMs: 10000, minScoreDelta: 50 };
ok('first send always broadcasts', lb.shouldBroadcast(null, { score: 0, wave: 1 }, now, O) === true);
ok('wave change broadcasts',       lb.shouldBroadcast({ score: 100, wave: 1, ts: now }, { score: 100, wave: 2 }, now, O) === true);
ok('big score jump broadcasts',    lb.shouldBroadcast({ score: 100, wave: 1, ts: now }, { score: 160, wave: 1 }, now, O) === true);
ok('tiny change is gated',         lb.shouldBroadcast({ score: 100, wave: 1, ts: now }, { score: 120, wave: 1 }, now, O) === false);
ok('heartbeat forces a resend',    lb.shouldBroadcast({ score: 100, wave: 1, ts: now - 10000 }, { score: 100, wave: 1 }, now, O) === true);

// ── createLiveBoard end-to-end ──────────────────────────────────────────────
const board = lb.createLiveBoard({ selfId: 'me', ttlMs: 30000, heartbeatMs: 10000, minScoreDelta: 50 });
board.ingest({ id: 'p2', name: 'Rival', score: 400, wave: 6 }, now);

const first = board.setSelf('Me', 100, 2, now);
ok('setSelf broadcasts first time', !!first && first.score === 100 && first.id === 'me');
ok('gated update returns null',     board.setSelf('Me', 130, 2, now + 1) === null); // +30 < 50, same wave
const jump = board.setSelf('Me', 500, 3, now + 2);
ok('score jump re-broadcasts',      !!jump && jump.score === 500);

const st = board.standings(now + 2);
ok('standings include self + peer', st.length === 2);
ok('self leads after the jump',     st[0].id === 'me' && st[1].id === 'p2');
ok('local score current despite gate', st[0].score === 500); // 130 update was gated on the wire but kept locally

board.ingest({ id: 'p3', name: 'Late', score: 50, wave: 1 }, now + 2);
ok('size counts all tracked',       board.size() === 3);

board.remove('p3');
ok('remove drops a player',         board.size() === 2);

board.prune(now + 2 + 40000); // 40 s later, nobody refreshed -> all stale
ok('prune drops everyone stale',    board.size() === 0);
ok('empty board has no standings',  board.standings(now + 2 + 40000).length === 0);

// hostile input can't poison the board
const safe = lb.createLiveBoard({ selfId: 'me' });
safe.ingest({ id: 'x', name: 'z'.repeat(50), score: 'abc', wave: {} }, now);
const sx = safe.standings(now)[0];
ok('coerces bad score/wave to ints', sx.score === 0 && sx.wave === 0);
ok('name length is capped at 24',    sx.name.length === 24);

console.log(pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
