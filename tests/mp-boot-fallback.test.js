// Regression: APK lobby JOIN must survive a Capacitor-style reload.
//
// User report: "apk version fails to join lobby, exits to main
// screen". Likely cause — some WebView builds (Capacitor / Cordova
// on certain Android versions) wipe sessionStorage on
// location.reload(), so the JOIN intent stashed there before the
// reload is gone by the time neonMPBoot runs, and the page lands
// straight on the main menu.
//
// Fix: write the JOIN intent to BOTH sessionStorage AND localStorage
// (with a timestamp). The pre-boot prefers sessionStorage, falls
// back to localStorage if it's <30s old.
//
// This test extracts the neonMPBoot logic from index.html and runs
// it against fake storage objects under three scenarios:
//   1. Only sessionStorage has the intent → consumed.
//   2. sessionStorage empty, localStorage fresh → consumed via fallback.
//   3. sessionStorage empty, localStorage stale (>30s) → ignored.

'use strict';

let pass = 0, fail = 0;
function ok(name, cond, extra) {
    if (cond) { console.log('ok', name); pass++; }
    else      { console.log('FAIL', name, extra || ''); fail++; }
}

const fs = require('fs');
const path = require('path');

// Pull the neonMPBoot IIFE source out of index.html and eval it
// against a sandbox that mimics the WebView APIs we care about.
const htmlSrc = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const m = htmlSrc.match(/\(function neonMPBoot\(\)[\s\S]*?\}\)\(\);/);
if (!m) {
    console.log('FAIL could not extract neonMPBoot from index.html');
    process.exit(1);
}
const bootSrc = m[0];

function makeFakeStorage() {
    const m = new Map();
    return {
        getItem(k)    { return m.has(k) ? m.get(k) : null; },
        setItem(k, v) { m.set(k, String(v)); },
        removeItem(k) { m.delete(k); },
        clear()       { m.clear(); },
        _map:         m,
    };
}

function runBoot({ session, local }) {
    const win  = {};
    // We need a Math we can MUTATE without polluting the real global
    // (the boot reassigns Math.random). Object.assign({}, Math)
    // doesn't copy random because Math's properties are non-
    // enumerable, so we build it explicitly.
    const mockMath = Object.create(Math);
    mockMath.random = Math.random.bind(Math);
    const fn = new Function('window', 'sessionStorage', 'localStorage', 'Math', 'Date', bootSrc);
    fn(win, session, local, mockMath, Date);
    return {
        pending: win.__neonMPPending || null,
        dev:     !!win.__neonAegisDev,
        nativeRandom: typeof win.__neonNativeRandom === 'function',
        sessionLeft: session._map.has('neonMP'),
        localLeft:   local._map.has('neonMP'),
    };
}

// ── 1) sessionStorage has the intent → consumed ─────────────────────
{
    const sess = makeFakeStorage();
    const loc  = makeFakeStorage();
    sess.setItem('neonMP', JSON.stringify({
        mode: 'coop', roomCode: 'NEAN42', nick: 'A',
        seed: 12345, startSpeed: 2, ts: Date.now(),
    }));
    const r = runBoot({ session: sess, local: loc });
    ok('sessionStorage intent → __neonMPPending set',
        r.pending && r.pending.roomCode === 'NEAN42');
    ok('aegis dev flag set',                  r.dev === true);
    ok('native random captured',              r.nativeRandom === true);
}

// ── 2) sessionStorage empty + fresh localStorage → fallback path ────
{
    const sess = makeFakeStorage();
    const loc  = makeFakeStorage();
    loc.setItem('neonMP', JSON.stringify({
        mode: 'coop', roomCode: 'NEAN42', nick: 'A',
        seed: 12345, startSpeed: 2, ts: Date.now() - 500,   // fresh
    }));
    const r = runBoot({ session: sess, local: loc });
    ok('fresh localStorage intent consumed via fallback',
        r.pending && r.pending.roomCode === 'NEAN42');
    ok('localStorage NOT cleared on success (consumed later by resume)',
        r.localLeft === true);
}

// ── 3) Stale localStorage (>30s) → ignored AND cleared ──────────────
{
    const sess = makeFakeStorage();
    const loc  = makeFakeStorage();
    loc.setItem('neonMP', JSON.stringify({
        mode: 'coop', roomCode: 'NEAN42', nick: 'A',
        seed: 12345, startSpeed: 2, ts: Date.now() - 60000,  // 60s old
    }));
    const r = runBoot({ session: sess, local: loc });
    ok('stale localStorage intent IGNORED',           r.pending === null);
    ok('stale localStorage CLEARED so it can\'t re-fire',
        r.localLeft === false);
}

// ── 4) Both stores empty → no-op ────────────────────────────────────
{
    const sess = makeFakeStorage();
    const loc  = makeFakeStorage();
    const r = runBoot({ session: sess, local: loc });
    ok('empty stores → no pending state',     r.pending === null);
    ok('empty stores → aegis dev flag NOT set', r.dev === false);
}

// ── 5) Malformed localStorage → cleared and ignored ─────────────────
{
    const sess = makeFakeStorage();
    const loc  = makeFakeStorage();
    loc.setItem('neonMP', 'not-json-at-all');
    const r = runBoot({ session: sess, local: loc });
    ok('malformed localStorage doesn\'t crash boot',  r.pending === null);
    ok('malformed localStorage gets cleared',         r.localLeft === false);
}

console.log(`\nMP BOOT FALLBACK: ${pass} pass, ${fail} fail`);
process.exit(fail === 0 ? 0 : 1);
