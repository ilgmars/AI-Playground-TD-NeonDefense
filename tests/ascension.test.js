// Endless ascension — node logic tests. Catches a regression of the
// upper-bound clamp and pins the per-step endless multiplier formula.
const assert = require('assert');
const path = require('path');
const fs   = require('fs');
const vm   = require('vm');

const sandbox = { window: {}, document: {}, Math, console };
vm.createContext(sandbox);
vm.runInContext(
    fs.readFileSync(path.join(__dirname, '..', 'src/config/config.js'), 'utf8')
      .replace(/^const /gm, 'var ').replace(/^let /gm, 'var '),
    sandbox);

const { getAscensionEffects, getAscensionTierSpec, ASCENSION_NAMED_MAX_TIER, ASCENSION_ENDLESS_STEP } = sandbox;
let pass = 0, fail = 0;
function ok(name, cond) { if (cond) { console.log('ok', name); pass++; } else { console.log('FAIL', name); fail++; } }

// ── Baseline & named tiers ──────────────────────────────────────────────
ok('A0 is baseline (no modifiers)', (() => {
    const e = getAscensionEffects(0);
    return e.hpMult === 1 && e.countMult === 1 && e.payoutMult === 1 && e.startMoneyMult === 1;
})());

const eA1 = getAscensionEffects(1);
ok('A1 stacks +15% HP', Math.abs(eA1.hpMult - 1.15) < 1e-9);

const eA10 = getAscensionEffects(10);
ok('A10 has hpMult > 1 (named modifiers applied)',  eA10.hpMult > 1);
ok('A10 has countMult > 1 (named modifiers applied)', eA10.countMult > 1);
ok('A10 has payoutMult < 1 (A5 -40% applied)',       eA10.payoutMult < 1);

// ── Endless climb ──────────────────────────────────────────────────────
// Step multipliers live in ASCENSION_ENDLESS_STEP so the test stays in
// sync with config.js — bumping the curve only requires editing one
// place. (Older revisions pinned literal 1.05 / 1.03 / 0.97 here; the
// curve is now steeper to give the leaderboard real spread.)
const STEP = ASCENSION_ENDLESS_STEP;
const eA11 = getAscensionEffects(11);
ok('A11 = A10 × one endless step (HP)',     Math.abs(eA11.hpMult     - eA10.hpMult     * STEP.hpMult)     < 1e-9);
ok('A11 = A10 × one endless step (count)',  Math.abs(eA11.countMult  - eA10.countMult  * STEP.countMult)  < 1e-9);
ok('A11 = A10 × one endless step (payout)', Math.abs(eA11.payoutMult - eA10.payoutMult * STEP.payoutMult) < 1e-9);

const eA20 = getAscensionEffects(20);
ok('A20 = A10 × 10 endless steps (HP)',
    Math.abs(eA20.hpMult - eA10.hpMult * Math.pow(STEP.hpMult, 10)) < 1e-6);

const eA100 = getAscensionEffects(100);
ok('A100 produces finite multipliers',
    Number.isFinite(eA100.hpMult) && Number.isFinite(eA100.countMult) && Number.isFinite(eA100.payoutMult));
ok('A100 HP multiplier is massive but finite (> 50× A0)',  eA100.hpMult > 50);
ok('A100 payout multiplier is well below baseline',         eA100.payoutMult < 0.05);

// Monotonicity: HP must grow with each step; payout must shrink.
let prev = eA10;
let monotonic = true;
for (let t = 11; t <= 30; t++) {
    const e = getAscensionEffects(t);
    if (!(e.hpMult > prev.hpMult) || !(e.payoutMult < prev.payoutMult)) { monotonic = false; break; }
    prev = e;
}
ok('endless tiers are monotonic (HP up, payout down)', monotonic);

// ── Spec lookup ────────────────────────────────────────────────────────
ok('getAscensionTierSpec(0) is baseline',  getAscensionTierSpec(0).kind === 'baseline');
ok('getAscensionTierSpec(5) is named stat', getAscensionTierSpec(5).kind === 'stat');
ok('getAscensionTierSpec(10) is named',     getAscensionTierSpec(10).label === 'A10');
ok('getAscensionTierSpec(11) is endless',   getAscensionTierSpec(11).kind === 'endless');
ok('getAscensionTierSpec(11).label is A11', getAscensionTierSpec(11).label === 'A11');
ok('getAscensionTierSpec(100).label is A100', getAscensionTierSpec(100).label === 'A100');
ok('getAscensionTierSpec(100).name says Endless +90', /Endless \+90/.test(getAscensionTierSpec(100).name));

// ── Defensive inputs ───────────────────────────────────────────────────
ok('negative tier clamps to baseline',       JSON.stringify(getAscensionEffects(-5)) === JSON.stringify(getAscensionEffects(0)));
ok('NaN tier clamps to baseline',            JSON.stringify(getAscensionEffects(NaN)) === JSON.stringify(getAscensionEffects(0)));
ok('string number tier coerces',             Math.abs(getAscensionEffects('11').hpMult - eA11.hpMult) < 1e-9);

ok('ASCENSION_NAMED_MAX_TIER is 10', ASCENSION_NAMED_MAX_TIER === 10);

console.log(`\nASCENSION ENDLESS: ${pass} pass, ${fail} fail`);
process.exit(fail === 0 ? 0 : 1);
