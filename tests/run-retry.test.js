// Regression: the test runner retries ONLY suites marked
// `retries: N` (the real-WebRTC/network suites that flake on CI), and
// deterministic suites still FAIL FAST on the first failure so a true
// bug is never masked by a retry.
//
// Drives the REAL tests/run.js via the NEON_RUN_SUITES test seam with
// fixture scripts whose pass/fail is controlled by a counter file.
const { spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

let pass = 0, fail = 0;
function ok(name, c, extra) {
    if (c) { console.log('ok', name); pass++; }
    else   { console.log('FAIL', name, extra || ''); fail++; }
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'neon-retry-'));
const root = path.resolve(__dirname, '..');

// Fixture: fails its first `failTimes` runs, then passes. State lives
// in a per-fixture counter file so attempts persist across spawns.
function writeFixture(name, failTimes) {
    const counter = path.join(tmp, name + '.count');
    fs.writeFileSync(counter, '0');
    const file = path.join(tmp, name + '.js');
    fs.writeFileSync(file, `
        const fs = require('fs');
        const cf = ${JSON.stringify(counter)};
        let n = parseInt(fs.readFileSync(cf, 'utf8'), 10) || 0;
        n++; fs.writeFileSync(cf, String(n));
        if (n <= ${failTimes}) { console.log('fixture fail attempt ' + n); process.exit(1); }
        console.log('fixture pass attempt ' + n); process.exit(0);
    `);
    return { file, counter };
}

function runRunner(suiteList) {
    const res = spawnSync(process.execPath, ['tests/run.js'], {
        cwd: root, encoding: 'utf8',
        env: { ...process.env, NEON_RUN_SUITES: JSON.stringify(suiteList) },
    });
    return { status: res.status, out: (res.stdout || '') + (res.stderr || '') };
}

// 1) Flaky suite (fails once) WITH retries → runner passes overall.
{
    const fx = writeFixture('flaky', 1);
    const r = runRunner([{ name: 'flaky', file: fx.file, retries: 2 }]);
    const attempts = parseInt(fs.readFileSync(fx.counter, 'utf8'), 10);
    ok('flaky suite retried and the run passed', r.status === 0, `status=${r.status}`);
    ok('flaky suite ran twice (1 fail + 1 pass)', attempts === 2, `attempts=${attempts}`);
    ok('retry was reported in output', /flaky↻|passed on retry/.test(r.out), r.out.slice(-200));
}

// 2) Same fixture WITHOUT retries → runner fails (no masking).
{
    const fx = writeFixture('flaky-noretry', 1);
    const r = runRunner([{ name: 'flaky-noretry', file: fx.file }]);
    const attempts = parseInt(fs.readFileSync(fx.counter, 'utf8'), 10);
    ok('un-tagged suite is NOT retried', attempts === 1, `attempts=${attempts}`);
    ok('un-tagged failure fails the run', r.status === 1, `status=${r.status}`);
}

// 3) Deterministic failure even WITH retries exhausts and fails — a
// genuine bug can't hide behind retries forever.
{
    const fx = writeFixture('always-fail', 99);
    const r = runRunner([{ name: 'always-fail', file: fx.file, retries: 2 }]);
    const attempts = parseInt(fs.readFileSync(fx.counter, 'utf8'), 10);
    ok('always-failing suite exhausts its retries (3 attempts)', attempts === 3, `attempts=${attempts}`);
    ok('exhausted retries still fail the run', r.status === 1, `status=${r.status}`);
}

// 4) Fail-fast: a deterministic suite failing BEFORE a later suite
// means the later suite never runs.
{
    const bad = writeFixture('bad-first', 99);
    const later = writeFixture('later', 0);
    const r = runRunner([
        { name: 'bad-first', file: bad.file },
        { name: 'later', file: later.file },
    ]);
    const laterRan = parseInt(fs.readFileSync(later.counter, 'utf8'), 10);
    ok('fail-fast: suite after a failure never runs', laterRan === 0, `laterRan=${laterRan}`);
    ok('fail-fast run exits non-zero', r.status === 1, `status=${r.status}`);
}

// 5) The real run.js actually tags the 3 network suites with retries.
{
    const src = fs.readFileSync(path.join(root, 'tests', 'run.js'), 'utf8');
    const tagged = ['mp-peer-id', 'mp-connectivity', 'mp-lobby-act']
        .every(n => new RegExp(n + "[^}]*retries:\\s*[1-9]").test(src));
    ok('mp-peer-id / mp-connectivity / mp-lobby-act are tagged with retries', tagged);
}

try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (_) {}
console.log(`\nRUN RETRY: ${pass} pass, ${fail} fail`);
process.exit(fail === 0 ? 0 : 1);
