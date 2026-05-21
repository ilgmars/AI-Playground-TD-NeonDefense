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
    { name: 'backpack',        file: 'tests/backpack.test.js' },
    { name: 'backpack-items',  file: 'tests/backpack-items.test.js' },
    { name: 'ascension',       file: 'tests/ascension.test.js' },
    { name: 'perf',            file: 'tests/perf.test.js' },

    // ── Browser flows (Playwright + chromium) ─────────────────────────────
    { name: 'mobile-nav',      file: 'tests/mobile-nav.test.js' },
    { name: 'variant-mastery', file: 'tests/variant-mastery.test.js' },
    { name: 'backpack-ui',     file: 'tests/backpack-ui.test.js' },
    { name: 'backpack-iter2',  file: 'tests/backpack-iter2.test.js' },
    { name: 'hold-spend',      file: 'tests/hold-spend.test.js' },
    { name: 'boons',           file: 'tests/boons.test.js' },
    { name: 'minigame',        file: 'tests/minigame.test.js' },
    { name: 'extra',           file: 'tests/extra.test.js' },
];

const SMOKE_SUITES = [
    // Optional smoke: autopilot run at 2048× to wave 30 (~ 2 minutes).
    { name: 'autopilot-smoke', file: 'tests/autopilot.smoke.js', args: ['--snapshots=10,30', '--speed=2048', '--ascension=3'] },
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
