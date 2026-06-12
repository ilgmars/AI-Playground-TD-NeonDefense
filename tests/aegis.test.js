// AEGIS — extensive anti-cheat test suite.
//
//   Logic (node, fast): signature determinism + tamper rejection,
//   ND2 round-trip, ND1 legacy compatibility.
//
//   Browser (playwright): every detection layer is exercised AND the
//   no-false-positive case is verified. Cheating consequences (zero XP,
//   sticky flag, RESET clears) are checked end-to-end.

const assert = require('assert');
let pass = 0, fail = 0;
function ok(name, cond) {
    if (cond) { console.log('ok', name); pass++; }
    else      { console.log('FAIL', name); fail++; }
}

// ─────────────────────────────────────────────────────────────────────────
// Phase 1 — Node logic tests
// ─────────────────────────────────────────────────────────────────────────
global.window = {};
const { NeonAegis } = require('../src/security/aegis.js');
global.NeonAegis = NeonAegis;
global.localStorage = {
    _d: {},
    getItem(k) { return this._d[k] ?? null; },
    setItem(k, v) { this._d[k] = v; },
    removeItem(k) { delete this._d[k]; },
    clear() { this._d = {}; },
};
const { NeonSave } = require('../src/progression/save.js');

// fnv1a basic
ok('fnv1a deterministic',     NeonAegis.fnv1a('hello') === NeonAegis.fnv1a('hello'));
ok('fnv1a sensitive to input', NeonAegis.fnv1a('hello') !== NeonAegis.fnv1a('hellO'));

// sign() determinism + tamper sensitivity
const s1 = NeonAegis.sign('alpha');
ok('sign deterministic',    s1 === NeonAegis.sign('alpha'));
ok('sign differs on input', s1 !== NeonAegis.sign('alphaa'));
ok('sign has 3 dot fields', s1.split('.').length === 3);

// verify positive + negative + edge cases
ok('verify matching sig',      NeonAegis.verify('alpha', s1) === true);
ok('verify wrong payload',     NeonAegis.verify('alphaa', s1) === false);
ok('verify empty sig string',  NeonAegis.verify('alpha', '') === false);
ok('verify undefined sig',     NeonAegis.verify('alpha', undefined) === false);
ok('verify tampered outer',    NeonAegis.verify('alpha', s1.replace(/^./, 'z')) === false);
ok('verify tampered middle',   NeonAegis.verify('alpha', s1.split('.').map((p,i) => i===1 ? p.replace(/.$/, 'z') : p).join('.')) === false);
ok('verify tampered inner',    NeonAegis.verify('alpha', s1.split('.').map((p,i) => i===2 ? p.replace(/.$/, 'z') : p).join('.')) === false);

// ND2 round-trip
const s = NeonSave.createFreshSave();
s.metaXP = 4242;
s.backpack.luckBoost = 3;
const code = NeonSave.encodeSaveCode(s);
ok('encodeSaveCode is ND2',   code.startsWith('ND2.'));
const decoded = NeonSave.decodeSaveCode(code);
ok('ND2 round-trip preserves metaXP',     decoded.metaXP === 4242);
ok('ND2 round-trip preserves luckBoost',  decoded.backpack.luckBoost === 3);

// ND2 tamper rejection (flip a base64 character)
const parts = code.split('.');
const tamperedB64 = parts[0] + '.' + parts[1].replace(/[A-Za-z]/, c => c === 'A' ? 'B' : 'A') + '.' + parts.slice(2).join('.');
let rejected1 = false;
try { NeonSave.decodeSaveCode(tamperedB64); } catch (_) { rejected1 = true; }
ok('ND2 payload tamper rejected', rejected1);

// ND2 signature tamper rejection
const tamperedSig = parts.slice(0, 2).join('.') + '.' + parts[2].replace(/.$/, c => c === 'a' ? 'b' : 'a') + '.' + parts[3] + '.' + parts[4];
let rejected2 = false;
try { NeonSave.decodeSaveCode(tamperedSig); } catch (_) { rejected2 = true; }
ok('ND2 signature tamper rejected', rejected2);

// ND1 legacy decode still works (handcraft an ND1 code from a save object).
// We can't call encodeSaveCode (it produces ND2 now), so we construct the
// legacy format manually.
function legacyEncode(saveObj) {
    const json = JSON.stringify(saveObj);
    let h = 0;
    for (let i = 0; i < json.length; i++) h = ((h << 5) - h + json.charCodeAt(i)) | 0;
    return 'ND1.' + Buffer.from(json, 'utf8').toString('base64') + '.' + Math.abs(h).toString(36);
}
const legacy = NeonSave.createFreshSave();
legacy.metaXP = 999;
const legacyCode = legacyEncode(legacy);
const legacyDecoded = NeonSave.decodeSaveCode(legacyCode);
ok('ND1 legacy code still decodes', legacyDecoded.metaXP === 999);

// localStorage signing: write produces a sig; tampering JSON without
// updating sig is caught on next load.
localStorage.clear();
const writeMe = NeonSave.createFreshSave();
writeMe.metaXP = 555;
NeonSave.write(writeMe);
const storedJson = localStorage.getItem(NeonSave.KEY);
const storedSig = localStorage.getItem('neonDefense.save.sig');
ok('write stores a sig alongside save', typeof storedSig === 'string' && storedSig.length > 0);
ok('stored sig verifies clean save',    NeonAegis.verify(storedJson, storedSig));

// Save-tamper handling: the new contract is that load() does NOT corrupt
// the save by setting a sticky cheaterDetected flag. The save heals
// itself (re-signed). Cheat detection for the next run lives in the
// run-scoped runtime flag, not on the save.
const tamperedJson = storedJson.replace('"metaXP":555', '"metaXP":999999');
localStorage.setItem(NeonSave.KEY, tamperedJson);
const loaded = NeonSave.load();
ok('localStorage tamper does NOT brick save', loaded.cheaterDetected === false);
ok('load re-signs the tampered save', NeonAegis.verify(localStorage.getItem(NeonSave.KEY), localStorage.getItem('neonDefense.save.sig')));

console.log(`\nNODE LOGIC: ${pass} pass, ${fail} fail`);
const nodeFail = fail;

// ─────────────────────────────────────────────────────────────────────────
// Phase 2 — Browser tests
// ─────────────────────────────────────────────────────────────────────────
const { chromium } = require('playwright');
const { spawn } = require('child_process');
const path = require('path');

(async () => {
    const server = spawn(process.execPath, ['tests/helpers/http-server.js', '8810'], { cwd: path.join(__dirname, '..'), stdio: 'ignore' });
    await new Promise(r => setTimeout(r, 600));
    const browser = await chromium.launch({ headless: true });
    let bPass = 0, bFail = 0;
    function bok(name, cond) {
        if (cond) { console.log('  ok', name); bPass++; }
        else      { console.log('  FAIL', name); bFail++; }
    }

    // ── Helpers ───────────────────────────────────────────────────────────
    async function freshPage({ devModeBeforeLoad = false } = {}) {
        const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
        if (devModeBeforeLoad) {
            await ctx.addInitScript(() => { window.__neonAegisDev = true; });
        }
        const page = await ctx.newPage();
        const errs = [];
        page.on('pageerror', e => errs.push(e.message));
        await page.goto('http://127.0.0.1:8810/index.html', { waitUntil: 'domcontentloaded' });
        await page.waitForTimeout(700);
        // Pre-set the player name so start-btn doesn't block on the
        // name prompt added in 37d884f.
        await page.evaluate(() => { localStorage.setItem('neonPlayerName', 'TEST'); });
        page._errs = errs;
        page._ctx = ctx;
        return page;
    }
    async function startRun(page) {
        await page.click('#menu-start-btn'); await page.waitForTimeout(250);
        await page.click('#start-btn');      await page.waitForTimeout(500);
    }

    // Helper: read the runtime run-scoped flag set by NeonAegis.flag().
    const readRunFlag = (page) => page.evaluate(() => ({
        flagged: NeonAegis.isRunFlagged(),
        reason:  NeonAegis.runFlagReason(),
        saveFlagged: !!save.cheaterDetected,    // must stay false now
    }));

    // ── 1) Normal play: no false-positive ────────────────────────────────
    console.log('\nbrowser: normal play (no false-positive)');
    {
        const page = await freshPage();
        await startRun(page);
        await page.waitForTimeout(2500);
        const r = await readRunFlag(page);
        bok('normal play does not flag',  r.flagged === false);
        bok('save not corrupted by play', r.saveFlagged === false);
        bok('no JS errors during normal play', page._errs.length === 0);
        await page._ctx.close();
    }

    // ── 2) Math.random override → run flagged (save untouched) ───────────
    console.log('\nbrowser: Math.random override is flagged');
    {
        const page = await freshPage();
        await startRun(page);
        await page.evaluate(() => { Math.random = () => 0; });
        await page.waitForTimeout(1700);
        const r = await readRunFlag(page);
        bok('rng override flags run',  r.flagged === true);
        bok('reason is rng-override',  r.reason === 'rng-override');
        bok('save NOT corrupted',      r.saveFlagged === false);
        await page._ctx.close();
    }

    // ── 3) Date.now override → run flagged ───────────────────────────────
    console.log('\nbrowser: Date.now override is flagged');
    {
        const page = await freshPage();
        await startRun(page);
        await page.evaluate(() => { Date.now = () => 0; });
        await page.waitForTimeout(1700);
        const r = await readRunFlag(page);
        bok('Date.now override flags run', r.flagged === true);
        bok('reason is time-override',     r.reason === 'time-override');
        bok('save NOT corrupted',          r.saveFlagged === false);
        await page._ctx.close();
    }

    // ── 4) game.money / game.health writes no longer flag ───────────────
    // The state audit was removed (too many false positives at endless
    // wave 300+; the RNG/time/imul sensors still catch real cheats).
    console.log('\nbrowser: money/health writes are tolerated (no false positive)');
    {
        const page = await freshPage();
        await startRun(page);
        await page.evaluate(() => {
            window.game.money = 1e9;
            window.game.health = 9999;
            window.game.money += 1000;
        });
        await page.waitForTimeout(150);
        const r = await readRunFlag(page);
        bok('massive money write does NOT flag (state audit removed)', r.flagged === false);
        bok('huge health value does NOT flag (state audit removed)',   r.flagged === false);
        bok('save remains clean',                                       r.saveFlagged === false);
        await page._ctx.close();
    }

    // ── 7) localStorage tamper → save heals, no sticky cheater flag ──────
    console.log('\nbrowser: localStorage tamper heals on reload (no save corruption)');
    {
        const page = await freshPage();
        await page.evaluate(() => { save.metaXP = 100; NeonSave.write(save); });
        await page.evaluate(() => {
            const json = localStorage.getItem(NeonSave.KEY);
            localStorage.setItem(NeonSave.KEY, json.replace('"metaXP":100', '"metaXP":999999'));
        });
        await page.reload();
        await page.waitForTimeout(700);
        const r = await page.evaluate(() => ({
            saveFlagged: !!save.cheaterDetected,
            metaXP:  save.metaXP,
        }));
        bok('save NOT marked cheater on reload (uncorrupted)', r.saveFlagged === false);
        bok('save heal preserved the (tampered) numeric value', r.metaXP === 999999);
        await page._ctx.close();
    }

    // ── 8) End-of-run consequences: zero XP, banner, save still clean ────
    console.log('\nbrowser: cheater end-of-run consequences');
    {
        const page = await freshPage();
        await startRun(page);
        // Trigger the run flag via the RNG sensor (state audit is no
        // longer wired). The sentinel runs every ~1.2 s.
        await page.evaluate(() => { Math.random = () => 0; });
        await page.waitForTimeout(1700);
        const before = await page.evaluate(() => ({
            metaXP: save.metaXP, stash: save.backpack.stash.length,
            flagged: NeonAegis.isRunFlagged(),
        }));
        bok('run flag is set by RNG override',                 before.flagged === true);
        await page.evaluate(() => window.onRunEnded({ wave: 50, tier: 2, retired: false }));
        await page.waitForTimeout(150);
        const after = await page.evaluate(() => ({
            metaXP: save.metaXP,
            stash:  save.backpack.stash.length,
            saveFlagged: !!save.cheaterDetected,
            banner: (document.querySelector('.aegis-banner') || {}).textContent || null,
            xpTotal: (document.getElementById('xp-total') || {}).textContent || null,
        }));
        bok('metaXP unchanged (no gains for this cheated run)', after.metaXP === before.metaXP);
        bok('no loot granted for this run',                    after.stash === before.stash);
        bok('AEGIS LOCK banner rendered',                      /AEGIS LOCK/.test(after.banner || ''));
        bok('XP total field is 0 in banner',                   after.xpTotal === '0');
        bok('save remains uncorrupted after the cheat',        after.saveFlagged === false);
        await page._ctx.close();
    }

    // ── 9) Flag does NOT survive reload (save uncorruption) ──────────────
    console.log('\nbrowser: run flag does not persist across reload');
    {
        const page = await freshPage();
        await startRun(page);
        // RNG override sets the run flag (state audit no longer
        // exists). Sentinel ticks every ~1.2 s.
        await page.evaluate(() => { Math.random = () => 0; });
        await page.waitForTimeout(1700);
        await page.evaluate(() => NeonSave.write(save));
        await page.reload();
        await page.waitForTimeout(700);
        const r = await page.evaluate(() => ({
            runFlagged: NeonAegis.isRunFlagged(),
            saveFlagged: !!save.cheaterDetected,
        }));
        bok('run flag cleared after reload',  r.runFlagged === false);
        bok('save not sticky-cheater',        r.saveFlagged === false);
        await page._ctx.close();
    }

    // ── 10) RESET SAVE still works (clears progression entirely) ─────────
    console.log('\nbrowser: RESET SAVE zeroes progression');
    {
        const page = await freshPage();
        // RESET SAVE now demands the typed phrase (see
        // reset-save-confirm.test.js) — supply it to the prompt.
        page.on('dialog', d => d.accept('delete all progress'));
        await page.evaluate(() => { save.metaXP = 500; NeonSave.write(save); });
        await Promise.all([
            page.waitForLoadState('load'),
            page.locator('#menu-reset-btn').click(),
        ]);
        await page.waitForTimeout(500);
        const r = await page.evaluate(() => ({
            metaXP:  save.metaXP,
            saveFlagged: !!save.cheaterDetected,
        }));
        bok('RESET zeroes metaXP',           r.metaXP === 0);
        bok('RESET leaves clean save state', r.saveFlagged === false);
        await page._ctx.close();
    }

    // ── 11) Dev mode bypass via addInitScript ────────────────────────────
    console.log('\nbrowser: pre-load dev-mode flag bypasses sensors');
    {
        const page = await freshPage({ devModeBeforeLoad: true });
        await startRun(page);
        await page.evaluate(() => {
            Math.random = () => 0;
            window.game.money = 1e9;
            window.game.health = 9999;
        });
        await page.waitForTimeout(1700);
        const r = await readRunFlag(page);
        bok('pre-load dev flag fully bypasses sensors', r.flagged === false);
        await page._ctx.close();
    }

    // ── 12) POST-load dev-mode flag does NOT bypass ──────────────────────
    console.log('\nbrowser: post-load dev-mode flag is ignored');
    {
        const page = await freshPage();
        await startRun(page);
        await page.evaluate(() => {
            window.__neonAegisDev = true;
            Math.random = () => 0;
        });
        await page.waitForTimeout(1700);
        const r = await readRunFlag(page);
        bok('post-load dev flag does NOT bypass run-scoped detection', r.flagged === true);
        await page._ctx.close();
    }

    await browser.close();
    server.kill();

    console.log(`\nBROWSER: ${bPass} pass, ${bFail} fail`);
    const total = pass + bPass;
    const totalFail = nodeFail + bFail;
    console.log(`\nAEGIS TOTAL: ${total} pass, ${totalFail} fail`);
    process.exit(totalFail === 0 ? 0 : 1);
})().catch(e => { console.error(e); process.exit(1); });
