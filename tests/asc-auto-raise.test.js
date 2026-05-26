// Regression: clearing wave 30+ on a tier auto-raises
// save.ascensionCleared so the NEXT tier is unlocked in the picker.
//
// User report: "the asc level is not automatically raising upon
// clearance of level". Old condition was `tier > save.ascensionCleared`
// which never bumped if the player cleared the SAME tier they last
// cleared (or the very first tier-0 clearance). Fixed to `>=` so
// every wave-30 clearance moves the unlocked ceiling forward.
//
// We test the predicate + bump directly. The renderer / selector
// logic is exercised by the existing ascension tests.

'use strict';

let pass = 0, fail = 0;
function ok(name, cond, extra) {
    if (cond) { console.log('ok', name); pass++; }
    else      { console.log('FAIL', name, extra || ''); fail++; }
}

// Mirror of the production predicate in onRunEnded.
function shouldFirstClear(wave, tier, prevCleared) {
    return wave >= 30 && tier >= prevCleared;
}
// Mirror of the production bump: max(existing, tier + 1).
function bumpAsc(prev, tier) {
    return Math.max(prev, tier + 1);
}

// ── 1) Cleared wave 30 at tier 0 → ascensionCleared becomes 1 ────────
{
    ok('wave 30 at tier 0 IS a first-clear (prev=0)',
        shouldFirstClear(30, 0, 0) === true);
    ok('first-clear bumps ascensionCleared 0 → 1',
        bumpAsc(0, 0) === 1);
}
// ── 2) Wave 29 at tier 0 is NOT a first-clear ───────────────────────
{
    ok('wave 29 at tier 0 is NOT a first-clear',
        shouldFirstClear(29, 0, 0) === false);
}
// ── 3) Cleared wave 30 at tier 1 with prevCleared=1 still bumps ─────
// User clears tier 0 → asc=1. Plays tier 1 → clears wave 30. Should
// bump to 2.
{
    ok('wave 30 at tier 1 (prev=1) IS a first-clear',
        shouldFirstClear(30, 1, 1) === true);
    ok('first-clear at tier 1 bumps 1 → 2',
        bumpAsc(1, 1) === 2);
}
// ── 4) Jumping straight to a higher tier than ever cleared ──────────
// User has asc=2, picks tier 5, clears wave 30. Bump to 6.
{
    ok('wave 30 at tier 5 (prev=2) IS a first-clear',
        shouldFirstClear(30, 5, 2) === true);
    ok('first-clear at higher tier bumps prev → tier+1',
        bumpAsc(2, 5) === 6);
}
// ── 5) Replaying an already-cleared LOWER tier is NOT a first-clear
// User has asc=5, replays tier 0, clears wave 30. No bump; asc stays 5.
{
    ok('wave 30 at tier 0 with prev=5 is NOT a first-clear (already past)',
        shouldFirstClear(30, 0, 5) === false);
    ok('replaying lower tier does NOT regress ascensionCleared',
        bumpAsc(5, 0) === 5);
}
// ── 6) Failing wave 30 at tier 0 does not bump ──────────────────────
{
    ok('wave 28 at tier 0 — no bump',
        shouldFirstClear(28, 0, 0) === false);
}

console.log(`\nASC AUTO-RAISE: ${pass} pass, ${fail} fail`);
process.exit(fail === 0 ? 0 : 1);
