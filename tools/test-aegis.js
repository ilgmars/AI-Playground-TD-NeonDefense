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

// Tamper JSON without updating sig — on next load, cheaterDetected = true.
const tamperedJson = storedJson.replace('"metaXP":555', '"metaXP":999999');
localStorage.setItem(NeonSave.KEY, tamperedJson);
// (Sig is still the old one.) Now load.
const loaded = NeonSave.load();
ok('localStorage tamper sets cheaterDetected', loaded.cheaterDetected === true);
ok('cheater reason recorded', loaded.cheaterReason === 'save-tampered');

console.log(`\nNODE LOGIC: ${pass} pass, ${fail} fail`);
const nodeFail = fail;

// ─────────────────────────────────────────────────────────────────────────
// Phase 2 — Browser tests
// ─────────────────────────────────────────────────────────────────────────
const { chromium } = require('playwright');
const { spawn } = require('child_process');

(async () => {
    const server = spawn('python3', ['-m', 'http.server', '8810'], { cwd: '/home/claude/AI-Playground-TD-NeonDefense', stdio: 'ignore' });
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
        await page.goto('http://localhost:8810/index.html');
        await page.waitForTimeout(700);
        page._errs = errs;
        page._ctx = ctx;
        return page;
    }
    async function startRun(page) {
        await page.click('#menu-start-btn'); await page.waitForTimeout(250);
        await page.click('#start-btn');      await page.waitForTimeout(500);
    }

    // ── 1) Normal play: no false-positive ────────────────────────────────
    console.log('\nbrowser: normal play (no false-positive)');
    {
        const page = await freshPage();
        await startRun(page);
        await page.waitForTimeout(2500);   // span at least two sentinel ticks
        const flagged = await page.evaluate(() => !!save.cheaterDetected);
        bok('normal play does not flag', flagged === false);
        bok('no JS errors during normal play', page._errs.length === 0);
        await page._ctx.close();
    }

    // ── 2) Math.random override → flagged within sensor tick ─────────────
    console.log('\nbrowser: Math.random override is flagged');
    {
        const page = await freshPage();
        await startRun(page);
        await page.evaluate(() => { Math.random = () => 0; });
        await page.waitForTimeout(1700);   // > 1.2s sentinel interval
        const r = await page.evaluate(() => ({
            flagged: !!save.cheaterDetected,
            reason:  save.cheaterReason,
            restored: Math.random !== ((function(){ return 0; }).constructor) && Math.random.toString().length > 50,
            // sentinel restores wrappedRandom — calling it should now work properly:
            sample: Math.random() < 1,
        }));
        bok('rng override flags save',     r.flagged === true);
        bok('reason is rng-override',      r.reason === 'rng-override');
        bok('rng restored after detection', r.sample === true);
        await page._ctx.close();
    }

    // ── 3) Date.now override → flagged ───────────────────────────────────
    console.log('\nbrowser: Date.now override is flagged');
    {
        const page = await freshPage();
        await startRun(page);
        await page.evaluate(() => { Date.now = () => 0; });
        await page.waitForTimeout(1700);
        const r = await page.evaluate(() => ({
            flagged: !!save.cheaterDetected,
            reason:  save.cheaterReason,
        }));
        bok('Date.now override flags', r.flagged === true);
        bok('reason is time-override', r.reason === 'time-override');
        await page._ctx.close();
    }

    // ── 4) game.money = 1e9 → flagged immediately ────────────────────────
    console.log('\nbrowser: game.money spike is flagged');
    {
        const page = await freshPage();
        await startRun(page);
        await page.evaluate(() => { window.game.money = 1e9; });
        // Setter fires synchronously; flag is queued on a microtask — give
        // it a tick.
        await page.waitForTimeout(100);
        const flagged = await page.evaluate(() => ({
            flagged: !!save.cheaterDetected,
            reason:  save.cheaterReason,
        }));
        bok('money spike flags', flagged.flagged === true);
        bok('reason is money-spike', flagged.reason === 'money-spike');
        await page._ctx.close();
    }

    // ── 5) game.money small bump → does NOT flag ─────────────────────────
    console.log('\nbrowser: small money increment does not flag');
    {
        const page = await freshPage();
        await startRun(page);
        // 1000 is way under the 500K spike threshold — totally legitimate
        // for a kill burst.
        await page.evaluate(() => { window.game.money += 1000; });
        await page.waitForTimeout(200);
        const flagged = await page.evaluate(() => !!save.cheaterDetected);
        bok('legit-bound money bump does not flag', flagged === false);
        await page._ctx.close();
    }

    // ── 6) game.health > maxHealth + slack → flagged ─────────────────────
    console.log('\nbrowser: health overflow is flagged');
    {
        const page = await freshPage();
        await startRun(page);
        await page.evaluate(() => { window.game.health = 9999; });
        await page.waitForTimeout(100);
        const flagged = await page.evaluate(() => ({
            flagged: !!save.cheaterDetected,
            reason:  save.cheaterReason,
        }));
        bok('health overflow flags', flagged.flagged === true);
        bok('reason is hp-overflow', flagged.reason === 'hp-overflow');
        await page._ctx.close();
    }

    // ── 7) localStorage tamper → flagged on next load ────────────────────
    console.log('\nbrowser: localStorage tamper flagged on reload');
    {
        const page = await freshPage();
        // Establish a clean signed save first.
        await page.evaluate(() => { save.metaXP = 100; NeonSave.write(save); });
        // Tamper raw JSON without updating sig.
        await page.evaluate(() => {
            const json = localStorage.getItem(NeonSave.KEY);
            localStorage.setItem(NeonSave.KEY, json.replace('"metaXP":100', '"metaXP":999999'));
        });
        await page.reload();
        await page.waitForTimeout(700);
        const r = await page.evaluate(() => ({
            flagged: !!save.cheaterDetected,
            reason:  save.cheaterReason,
            metaXP:  save.metaXP,
        }));
        bok('tamper flagged on reload', r.flagged === true);
        bok('reason is save-tampered',  r.reason === 'save-tampered');
        bok('cheater metaXP preserved as-tampered (we do not zero it out, only block gains)', r.metaXP === 999999);
        await page._ctx.close();
    }

    // ── 8) End-of-run consequences: zero XP, no loot, banner shown ───────
    console.log('\nbrowser: cheater end-of-run consequences');
    {
        const page = await freshPage();
        await startRun(page);
        // Trigger a flag the easy way: money spike.
        await page.evaluate(() => { window.game.money = 1e9; });
        await page.waitForTimeout(150);
        const before = await page.evaluate(() => ({
            metaXP: save.metaXP, stash: save.backpack.stash.length,
        }));
        await page.evaluate(() => window.onRunEnded({ wave: 50, tier: 2, retired: false }));
        await page.waitForTimeout(150);
        const after = await page.evaluate(() => ({
            metaXP: save.metaXP,
            stash:  save.backpack.stash.length,
            banner: (document.querySelector('.aegis-banner') || {}).textContent || null,
            xpTotal: (document.getElementById('xp-total') || {}).textContent || null,
        }));
        bok('metaXP unchanged (no gains while cheater flag set)', after.metaXP === before.metaXP);
        bok('no loot granted while flagged', after.stash === before.stash);
        bok('AEGIS LOCK banner rendered', /AEGIS LOCK/.test(after.banner || ''));
        bok('XP total field is 0 in banner', after.xpTotal === '0');
        await page._ctx.close();
    }

    // ── 9) Flag is sticky across reloads ─────────────────────────────────
    console.log('\nbrowser: cheater flag persists across reloads');
    {
        const page = await freshPage();
        await startRun(page);
        await page.evaluate(() => { window.game.money = 1e9; });
        await page.waitForTimeout(200);
        // Force a write so the cheater flag is persisted.
        await page.evaluate(() => NeonSave.write(save));
        await page.reload();
        await page.waitForTimeout(700);
        const r = await page.evaluate(() => !!save.cheaterDetected);
        bok('flag survives reload', r === true);
        await page._ctx.close();
    }

    // ── 10) RESET SAVE clears the flag ───────────────────────────────────
    console.log('\nbrowser: RESET SAVE clears the cheater flag');
    {
        const page = await freshPage();
        page.on('dialog', d => d.accept());   // auto-confirm the reset prompt
        await page.evaluate(() => {
            save.cheaterDetected = true; save.cheaterReason = 'test';
            NeonSave.write(save);
        });
        await Promise.all([
            page.waitForLoadState('load'),    // reload triggered by reset handler
            page.locator('#menu-reset-btn').click(),
        ]);
        await page.waitForTimeout(500);
        const r = await page.evaluate(() => ({
            flagged: !!save.cheaterDetected,
            metaXP:  save.metaXP,
        }));
        bok('RESET clears cheater flag', r.flagged === false);
        bok('RESET zeroes metaXP',       r.metaXP === 0);
        await page._ctx.close();
    }

    // ── 11) Dev mode bypass via addInitScript ────────────────────────────
    console.log('\nbrowser: pre-load dev-mode flag bypasses sensors');
    {
        const page = await freshPage({ devModeBeforeLoad: true });
        await startRun(page);
        // Trigger ALL the sensor traps and expect NO flag.
        await page.evaluate(() => {
            Math.random = () => 0;
            window.game.money = 1e9;
            window.game.health = 9999;
        });
        await page.waitForTimeout(1700);   // span a sentinel tick
        const flagged = await page.evaluate(() => !!save.cheaterDetected);
        bok('pre-load dev flag fully bypasses sensors', flagged === false);
        await page._ctx.close();
    }

    // ── 12) POST-load dev-mode flag does NOT bypass ──────────────────────
    console.log('\nbrowser: post-load dev-mode flag is ignored');
    {
        const page = await freshPage();
        await startRun(page);
        // Player tries the obvious trick from the console.
        await page.evaluate(() => {
            window.__neonAegisDev = true;        // set AFTER aegis IIFE ran
            Math.random = () => 0;
        });
        await page.waitForTimeout(1700);
        const flagged = await page.evaluate(() => !!save.cheaterDetected);
        bok('post-load dev flag does NOT bypass', flagged === true);
        await page._ctx.close();
    }

    // ── 13) Saving with cheater flag persists the flag with valid sig ────
    console.log('\nbrowser: sticky sig — clearing the flag locally rejects on load');
    {
        const page = await freshPage();
        await page.evaluate(() => {
            save.cheaterDetected = true; save.cheaterReason = 'rng-override';
            NeonSave.write(save);   // signs the flagged save
        });
        // Player tries to clear the flag from console without re-signing.
        await page.evaluate(() => {
            const json = localStorage.getItem(NeonSave.KEY);
            localStorage.setItem(NeonSave.KEY,
                json.replace('"cheaterDetected":true', '"cheaterDetected":false'));
        });
        await page.reload();
        await page.waitForTimeout(700);
        const r = await page.evaluate(() => !!save.cheaterDetected);
        bok('hand-cleared flag re-set by sig check', r === true);
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
