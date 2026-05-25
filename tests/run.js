#!/usr/bin/env node
// Sequential test runner for CI and local use.
//
// Every suite is its own node script (logic + browser). They run in
// dependency order — pure-logic / signature tests first because they
// fail fastest, browser flows after. The first failure stops the run
// (its stdout + stderr are echoed) and returns a non-zero exit so CI
// fails the job. Pass --with-smoke to include the multi-minute
// autopilot smoke (tests/autopilot.smoke.js).

const { spawnSync } = require('child_process');
const path = require('path');

const SUITES = [
    // ── Fast logic + crypto-ish unit tests (no browser) ───────────────────
    { name: 'aegis',           file: 'tests/aegis.test.js' },
    { name: 'multiplayer',     file: 'tests/multiplayer.test.js' },
    { name: 'backpack',        file: 'tests/backpack.test.js' },
    { name: 'backpack-items',  file: 'tests/backpack-items.test.js' },
    { name: 'ascension',       file: 'tests/ascension.test.js' },
    { name: 'perf',            file: 'tests/perf.test.js' },

    // ── Browser flows (Playwright + chromium) ─────────────────────────────
    { name: 'mp-browser',      file: 'tests/mp-browser.test.js' },
    // Regression: Trystero peer IDs must be unique even though the
    // pre-boot reseeds Math.random with a room-derived mulberry32.
    // Without the fix in transport-trystero.js, both peers got the
    // same Trystero ID and deduped each other as "self".
    { name: 'mp-peer-id',      file: 'tests/mp-peer-id.test.js' },
    { name: 'sp-no-race-overlay', file: 'tests/sp-no-race-overlay.test.js' },
    { name: 'bp-shape-border',    file: 'tests/bp-shape-border.test.js' },
    { name: 'boon-autopick',      file: 'tests/boon-autopick.test.js' },
    { name: 'auto-save-score',    file: 'tests/auto-save-score.test.js' },
    { name: 'mp-speed-lock',      file: 'tests/mp-speed-lock.test.js' },
    { name: 'coop-split-economy', file: 'tests/coop-split-economy.test.js' },
    { name: 'scoreboard-window',  file: 'tests/scoreboard-window.test.js' },
    { name: 'coop-pause-sync',    file: 'tests/coop-pause-sync.test.js' },
    { name: 'coop-wave-sync',     file: 'tests/coop-wave-sync.test.js' },
    { name: 'canvas-pinch-zoom',  file: 'tests/canvas-pinch-zoom.test.js' },
    { name: 'coop-mechanics',     file: 'tests/coop-mechanics.test.js' },
    // Real two-client end-to-end over actual Trystero. Self-skips when
    // the environment can't reach trackers / WebRTC (set NEON_MP_FORCE=1
    // to make those skips into failures, e.g. for a release smoke).
    { name: 'mp-connectivity', file: 'tests/mp-connectivity.test.js' },
    // Full UI-driven two-client lobby flow. Two browsers, real
    // Trystero/MQTT signalling, real race-mode JOIN, asserts both
    // peers see each other in the leaderboard. Self-skips when the
    // sandbox can't reach signalling brokers. NEON_MP_FORCE=1
    // promotes skips to failures (use locally before releasing).
    { name: 'mp-lobby-act',    file: 'tests/mp-lobby-act.test.js' },
    { name: 'mobile-nav',      file: 'tests/mobile-nav.test.js' },
    { name: 'backpack-touch',         file: 'tests/backpack-touch-drag.test.js' },
    { name: 'backpack-touch-contin',  file: 'tests/backpack-touch-drag-continuity.test.js' },
    { name: 'backpack-mobile-issues', file: 'tests/backpack-mobile-issues.test.js' },
    // Real-shape sweep — runs every assertion across plasma_cell (1×1),
    // coolant_coil (1×2), bounty_module (1×3), interest_ledger (2×1),
    // reactor_bulwark (2×2), targeting_core / fabricator (L-shapes),
    // overclock_matrix (T). Catches mobile regressions that 1×1-only
    // tests miss.
    { name: 'backpack-mobile-real',   file: 'tests/backpack-mobile-real.test.js' },
    { name: 'retire-flawless',        file: 'tests/retire-flawless.test.js' },
    { name: 'variant-mastery', file: 'tests/variant-mastery.test.js' },
    { name: 'backpack-ui',     file: 'tests/backpack-ui.test.js' },
    { name: 'backpack-iter2',  file: 'tests/backpack-iter2.test.js' },
    { name: 'hold-spend',      file: 'tests/hold-spend.test.js' },
    { name: 'boons',           file: 'tests/boons.test.js' },
    { name: 'extra',           file: 'tests/extra.test.js' },
];

const SMOKE_SUITES = [
    // Optional smoke: autopilot run at 2048× to wave 30 (~ 2 minutes).
    { name: 'autopilot-smoke', file: 'tests/autopilot.smoke.js', args: ['--snapshots=10,30', '--speed=2048', '--ascension=3'] },
    // Long-haul to wave 450 / lives==0 — guards the "money disappears at
    // milestone waves" regression. ~5-8 minutes on a fast box.
    { name: 'wave450',         file: 'tests/wave450.smoke.js',   args: ['--target=450', '--speed=8192', '--ascension=0'] },
];

const withSmoke = process.argv.includes('--with-smoke');
const suites = withSmoke ? SUITES.concat(SMOKE_SUITES) : SUITES;

const root = path.resolve(__dirname, '..');
const startedAt = Date.now();
const results = [];
let firstFailure = null;

for (const suite of suites) {
    const label = suite.name.padEnd(20, ' ');
    process.stdout.write(`▶ ${label} ... `);
    const t0 = Date.now();
    const res = spawnSync(process.execPath, [suite.file].concat(suite.args || []), {
        cwd: root,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
    });
    const ms = Date.now() - t0;
    const ok = res.status === 0;
    results.push({ name: suite.name, ok, ms, stdout: res.stdout, stderr: res.stderr });

    if (ok) {
        process.stdout.write(`✓  ${ms}ms\n`);
    } else {
        process.stdout.write(`✗  ${ms}ms\n`);
        if (!firstFailure) firstFailure = suite.name;
        if (res.stdout) {
            process.stdout.write('  ── stdout ─────────────────────────────────────────\n');
            process.stdout.write(res.stdout.split('\n').map(l => '  ' + l).join('\n'));
            if (!res.stdout.endsWith('\n')) process.stdout.write('\n');
        }
        if (res.stderr) {
            process.stdout.write('  ── stderr ─────────────────────────────────────────\n');
            process.stdout.write(res.stderr.split('\n').map(l => '  ' + l).join('\n'));
            if (!res.stderr.endsWith('\n')) process.stdout.write('\n');
        }
        break;     // fail fast
    }
}

const totalMs = Date.now() - startedAt;
const passed = results.filter(r => r.ok).length;
const failed = results.length - passed;

console.log('');
console.log('────────────────────────────────────────────────────────────');
console.log(`  ${passed}/${suites.length} suites passed in ${(totalMs / 1000).toFixed(1)}s`);
if (failed) console.log(`  first failure: ${firstFailure}`);
console.log('────────────────────────────────────────────────────────────');

process.exit(failed ? 1 : 0);
