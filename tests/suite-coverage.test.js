// Meta-regression: every tests/*.test.js MUST be registered in
// tests/run.js (the CI gate). A regression test that exists but isn't
// wired into the runner never executes in CI — it's a false sense of
// safety. This suite fails loudly the moment a test file is added
// without registering it, enforcing the "write a regression CI test
// for every bugfix" rule mechanically.
//
// Smoke-only suites (tests/*.smoke.js) and helpers are intentionally
// excluded — they're not part of the standard `npm test` gate.
const fs = require('fs');
const path = require('path');

let pass = 0, fail = 0;
function ok(name, c, extra) {
    if (c) { console.log('ok', name); pass++; }
    else   { console.log('FAIL', name, extra || ''); fail++; }
}

const testsDir = __dirname;
const runJs = fs.readFileSync(path.join(testsDir, 'run.js'), 'utf8');

// Every *.test.js on disk (this meta-suite excepted — it's a leaf).
const onDisk = fs.readdirSync(testsDir)
    .filter(f => f.endsWith('.test.js') && f !== 'suite-coverage.test.js');

const unregistered = onDisk.filter(f => !runJs.includes('tests/' + f));
ok('every tests/*.test.js is registered in run.js (no orphaned regressions)',
    unregistered.length === 0,
    unregistered.length ? 'UNREGISTERED: ' + unregistered.join(', ') : '');

// And this meta-suite itself must be registered, or it never runs.
ok('suite-coverage.test.js is itself registered',
    runJs.includes('tests/suite-coverage.test.js'));

console.log(`\nSUITE COVERAGE: ${pass} pass, ${fail} fail`);
process.exit(fail === 0 ? 0 : 1);
