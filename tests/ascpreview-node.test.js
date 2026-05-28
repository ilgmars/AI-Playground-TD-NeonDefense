// Regression: qol.ascpreview was a 500-XP tier-3 tech-tree node with
// NO wiring — owning it had zero gameplay effect. Now it appends the
// next-tier modifier to the ascension preview line when the selector
// is at the player's currently-unlocked max.

const { chromium } = require('playwright');
const { spawn } = require('child_process');
const path = require('path');

(async () => {
    const PORT = 9400 + Math.floor(Math.random() * 90);
    const server = spawn(process.execPath, ['tests/helpers/http-server.js', String(PORT)],
        { cwd: path.join(__dirname, '..'), stdio: 'ignore' });
    await new Promise(r => setTimeout(r, 600));
    const browser = await chromium.launch({ headless: true });
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const page = await ctx.newPage();
    const errs = [];
    page.on('pageerror', e => errs.push(e.message));
    await page.goto(`http://127.0.0.1:${PORT}/index.html`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(700);

    let pass = 0, fail = 0;
    function ok(name, cond, extra) {
        if (cond) { console.log('ok', name); pass++; }
        else      { console.log('FAIL', name, extra || ''); fail++; }
    }

    // Baseline: ascpreview LOCKED, selector at top of unlocked range → no "next:" hint.
    const baseline = await page.evaluate(() => {
        window.save.ascensionCleared = 0;
        window.save.unlockedNodes = (window.save.unlockedNodes || []).filter(n => n !== 'qol.ascpreview');
        if (typeof setTier === 'function') setTier(1);     // unlockedMax for cleared=0 is 1
        if (typeof renderAscensionSelector === 'function') renderAscensionSelector('start');
        const el = document.querySelector('.ascension-modifiers-preview[data-context="start"]');
        return el ? el.textContent : null;
    });
    ok('preview rendered without ascpreview',
        baseline && !baseline.includes('next:'),
        `baseline="${baseline}"`);

    // Unlock ascpreview + render → "next:" hint must appear.
    const previewed = await page.evaluate(() => {
        if (!window.save.unlockedNodes.includes('qol.ascpreview'))
            window.save.unlockedNodes.push('qol.ascpreview');
        if (typeof renderAscensionSelector === 'function') renderAscensionSelector('start');
        const el = document.querySelector('.ascension-modifiers-preview[data-context="start"]');
        return el ? el.textContent : null;
    });
    ok('preview now includes next-tier hint',
        previewed && previewed.includes('next:'),
        `previewed="${previewed}"`);

    // Node is referenced in the wiring layer (not just config)
    const fs = require('fs');
    const main = fs.readFileSync(path.join(__dirname, '..', 'src', 'engine', 'main.js'), 'utf8');
    ok('main.js references qol.ascpreview', main.includes('qol.ascpreview'));

    ok('no JS errors', errs.length === 0, errs.join(' / '));

    await browser.close();
    server.kill();
    console.log(`\nASCPREVIEW NODE: ${pass} pass, ${fail} fail`);
    process.exit(fail === 0 ? 0 : 1);
})().catch(e => { console.error(e); process.exit(1); });
