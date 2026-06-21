// Regression: the long-press tower tooltip (mobile) hangs ~1.2 s after the
// finger lifts. Nothing dismissed it when the player then touched the field to
// place a tower, so it sat over the board blocking the view (user video). A
// document-level capture touchstart now hides any visible tooltip on the next
// touch, so it can never block a placement.
const { chromium } = require('playwright');
const { spawn } = require('child_process');
const path = require('path');

(async () => {
    const PORT = 9720 + Math.floor(Math.random() * 40);
    const server = spawn(process.execPath, ['tests/helpers/http-server.js', String(PORT)],
        { cwd: path.join(__dirname, '..'), stdio: 'ignore' });
    await new Promise(r => setTimeout(r, 600));
    const browser = await chromium.launch({ headless: true });
    const ctx = await browser.newContext({ viewport: { width: 412, height: 880 }, hasTouch: true, isMobile: true });
    const page = await ctx.newPage();
    const errs = [];
    page.on('pageerror', e => errs.push(e.message));
    let pass = 0, fail = 0;
    const ok = (n, c, x) => { if (c) { console.log('ok', n); pass++; } else { console.log('FAIL', n, x || ''); fail++; } };

    await page.goto(`http://127.0.0.1:${PORT}/index.html`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(500);

    const r = await page.evaluate(() => {
        const tip = document.getElementById('tower-tooltip');
        if (!tip) return { noTip: true };
        // Simulate the lingering-after-long-press state.
        tip.classList.remove('hidden');
        const wasVisible = !tip.classList.contains('hidden');
        // A fresh touch anywhere (player reaching for the field) must dismiss it.
        document.dispatchEvent(new Event('touchstart', { bubbles: true }));
        const hiddenAfterTouch = tip.classList.contains('hidden');
        // Dispatching again when already hidden must be a harmless no-op.
        let threw = false;
        try { document.dispatchEvent(new Event('touchstart', { bubbles: true })); } catch (_) { threw = true; }
        return { wasVisible, hiddenAfterTouch, threw, stillHidden: tip.classList.contains('hidden') };
    });

    ok('tooltip element exists', !r.noTip, JSON.stringify(r));
    ok('tooltip was visible before the touch', r.wasVisible === true, JSON.stringify(r));
    ok('a fresh touch dismisses the lingering tooltip', r.hiddenAfterTouch === true, JSON.stringify(r));
    ok('dismiss on an already-hidden tooltip is a no-op', r.threw === false && r.stillHidden === true, JSON.stringify(r));
    ok('no JS errors', errs.length === 0, errs.join(' / '));

    await ctx.close();
    await browser.close();
    server.kill();
    console.log(`\nTOOLTIP DISMISS: ${pass} pass, ${fail} fail`);
    process.exit(fail === 0 ? 0 : 1);
})().catch(e => { console.error(e); process.exit(1); });
