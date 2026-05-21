#!/usr/bin/env node
// Sequential test runner for CI and local use.
//
// Each suite is its own node script (logic + browser). We run them in
// dependency order — pure-logic / signature tests first because they
// fail fastest; browser flows after. A failure stops the runner with a
// non-zero exit so CI fails the job.
//
// Skipped by default: the legacy root-level `test-*.js` files
// (autopilot, defense, retire, diag, screenshot) which are multi-minute
// game sims used for tuning / smoke runs, not regression assertions.
// Pass `--with-smoke` to include the autopilot smoke.

const { spawnSync } = require('child_process');
const path = require('path');

const SUITES = [
    // ── Fast logic + crypto-ish unit tests (no browser) ───────────────────
    { name: 'test-aegis',           file: 'tools/test-aegis.js' },
    { name: 'test-backpack',        file: 'tools/test-backpack.js' },
    { name: 'test-backpack-items',  file: 'tools/test-backpack-items.js' },
    { name: 'test-ascension',       file: 'tools/test-ascension.js' },
    { name: 'test-perf',            file: 'tools/test-perf.js' },

    // ── Browser flows (Playwright + chromium) ─────────────────────────────
    { name: 'test-mobile-nav',      file: 'tools/test-mobile-nav.js' },
    { name: 'test-variant-mastery', file: 'tools/test-variant-mastery.js' },
    { name: 'test-backpack-ui',     file: 'tools/test-backpack-ui.js' },
    { name: 'test-backpack2',       file: 'tools/test-backpack2.js' },
    { name: 'test-hold-spend',      file: 'tools/test-hold-spend.js' },
    { name: 'test-boons',           file: 'tools/test-boons.js' },
    { name: 'test-minigame',        file: 'tools/test-minigame.js' },
    { name: 'test-extra',           file: 'tools/test-extra.js' },
];

const SMOKE_SUITES = [
    // Optional smoke: autopilot run at 2048× to wave 30 (~ 2 minutes).
    { name: 'autopilot-smoke', file: 'test-autopilot.js', args: ['--snapshots=10,30', '--speed=2048', '--ascension=3'] },
];

const withSmoke = process.argv.includes('--with-smoke');
const suites = withSmoke ? SUITES.concat(SMOKE_SUITES) : SUITES;

const root = path.resolve(__dirname, '..');
const startedAt = Date.now();
const results = [];
let firstFailure = null;

for (const suite of suites) {
    const label = suite.name.padEnd(22, ' ');
    process.stdout.write(`▶ ${label} ... `);
    const t0 = Date.now();
    const res = spawnSync('node', [suite.file].concat(suite.args || []), {
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
        // Dump the failed suite's output so CI logs show what broke.
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
