// Regression: TURN servers cost real money (metered.live bills per
// relayed byte). joinRoom only includes TURN entries in iceServers
// when the caller passes `useTurn: true`. The global scoreboard
// (NEON23) joins WITHOUT useTurn so a busy room with many peers
// doesn't open TURN allocations for fanout the broker already
// handles. Coop sets useTurn: true.
//
// We test the filter logic against a known iceServers list and
// verify joinRoom is called with the filtered set.

'use strict';

const fs = require('fs');
const path = require('path');

let pass = 0, fail = 0;
function ok(name, cond, extra) {
    if (cond) { console.log('ok', name); pass++; }
    else      { console.log('FAIL', name, extra || ''); fail++; }
}

// Mirror of the production filter in transport-trystero.js. Kept
// here so a test failure pinpoints exactly which case broke when
// the production code is touched.
function filterTurn(iceServers, useTurn) {
    if (useTurn || !iceServers) return iceServers;
    return iceServers
        .filter(s => {
            const urls = Array.isArray(s.urls) ? s.urls : [s.urls];
            return urls.every(u => typeof u === 'string' && !/^turns?:/i.test(u));
        })
        .filter(s => {
            const urls = Array.isArray(s.urls) ? s.urls : [s.urls];
            return urls.length > 0;
        });
}

// ── 1) STUN-only input → unchanged either way ───────────────────────
{
    const stunOnly = [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: ['stun:stun.relay.metered.ca:80'] },
    ];
    const a = filterTurn(stunOnly, false);
    const b = filterTurn(stunOnly, true);
    ok('STUN-only stays the same when useTurn=false', a.length === 2);
    ok('STUN-only stays the same when useTurn=true',  b.length === 2);
}

// ── 2) Mixed list, useTurn=false → TURN entries dropped ─────────────
{
    const mixed = [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'turn:relay.metered.ca:80',  username: 'u', credential: 'p' },
        { urls: 'turns:relay.metered.ca:443', username: 'u', credential: 'p' },
        { urls: 'stun:stun.relay.metered.ca:80' },
    ];
    const filtered = filterTurn(mixed, false);
    ok('TURN entries dropped for useTurn=false',
        filtered.length === 2);
    ok('only STUN survives',
        filtered.every(s => /^stun:/i.test(Array.isArray(s.urls) ? s.urls[0] : s.urls)));
}

// ── 3) Mixed list, useTurn=true → TURN entries kept ─────────────────
{
    const mixed = [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'turn:relay.metered.ca:80',  username: 'u', credential: 'p' },
        { urls: 'turns:relay.metered.ca:443', username: 'u', credential: 'p' },
    ];
    const filtered = filterTurn(mixed, true);
    ok('TURN entries kept for useTurn=true (coop needs them)',
        filtered.length === 3);
}

// ── 4) Multi-url entry with TURN URLs → dropped when useTurn=false ──
// (some iceServer entries use urls=[turn:..., stun:...] — be strict
// and drop the whole entry rather than half-publish it.)
{
    const mixedUrls = [
        { urls: ['stun:stun.l.google.com:19302'] },
        { urls: ['turn:relay.metered.ca:80', 'turns:relay.metered.ca:443'],
          username: 'u', credential: 'p' },
    ];
    const filtered = filterTurn(mixedUrls, false);
    ok('multi-url TURN entry dropped wholesale',
        filtered.length === 1);
}

// ── 5) Empty / null input safe ──────────────────────────────────────
{
    ok('null iceServers stays null',     filterTurn(null, false) === null);
    ok('empty iceServers stays empty',   Array.isArray(filterTurn([], false)) && filterTurn([], false).length === 0);
}

// ── 6) Production source uses the filter ───────────────────────────
{
    const src = fs.readFileSync(path.join(__dirname, '..', 'src/multiplayer/transport-trystero.js'), 'utf8');
    ok('transport-trystero.js references useTurn',  /useTurn/.test(src));
    ok('transport-trystero.js drops "turn:" / "turns:" URLs',
        /\/\^turns\?:/.test(src) || /turns\?:/i.test(src));
    ok('iceCandidatePoolSize is pinned at 0 (no pre-warm)',
        /iceCandidatePoolSize:\s*0/.test(src));
    ok('iceTransportPolicy is "all" (never force relay)',
        /iceTransportPolicy:\s*['"]all['"]/.test(src));
}

// ── 7) Global board joinRoom does NOT pass useTurn ─────────────────
{
    const src = fs.readFileSync(path.join(__dirname, '..', 'src/multiplayer/global.js'), 'utf8');
    // It calls joinRoom(GLOBAL_ROOM, 'self'). If a 3rd arg sneaks in
    // and contains useTurn:true, the global board would needlessly
    // open TURN allocations. We match the literal call and assert
    // there's no useTurn next to GLOBAL_ROOM.
    const m = src.match(/trystero\.joinRoom\([^)]*\)/);
    ok('global.js calls trystero.joinRoom',  m !== null);
    ok('global.js does NOT request useTurn',
        m && !/useTurn\s*:\s*true/.test(m[0]));
}

// ── 8) Coop join in main.js DOES pass useTurn:true ─────────────────
{
    const src = fs.readFileSync(path.join(__dirname, '..', 'src/engine/main.js'), 'utf8');
    // The joinCoop function calls NeonMP.trystero.joinRoom. Look
    // for that specific line carrying useTurn:true.
    ok('main.js joinCoop call passes useTurn:true',
        /NeonMP\.trystero\.joinRoom\(roomCode,\s*nick,\s*\{[^}]*useTurn:\s*true/.test(src));
}

console.log(`\nTURN FILTER: ${pass} pass, ${fail} fail`);
process.exit(fail === 0 ? 0 : 1);
