// Regression: in coop the host broadcasts wave alignment so a
// non-host whose local sim has drifted snaps to the host's wave on
// the next 'wave' message. Tested via the
// window.__neonMPApplyWave hook (mirror what arrives over the room).
const { chromium } = require('playwright');
const { spawn } = require('child_process');
const path = require('path');

(async () => {
    const PORT = 8780;
    const server = spawn(process.execPath, ['tests/helpers/http-server.js', String(PORT)],
        { cwd: path.join(__dirname, '..'), stdio: 'ignore' });
    await new Promise(r => setTimeout(r, 600));
    const browser = await chromium.launch({ headless: true });
    const ctx = await browser.newContext();
    await ctx.addInitScript(() => { window.__neonAegisDev = true; });
    const page = await ctx.newPage();
    await page.setViewportSize({ width: 1280, height: 800 });
    const errs = [];
    page.on('pageerror', e => errs.push(e.message));
    await page.goto(`http://127.0.0.1:${PORT}/index.html`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(600);
    await page.evaluate(() => { localStorage.setItem('neonPlayerName', 'TEST'); });

    let pass = 0, fail = 0;
    function ok(name, cond, extra) {
        if (cond) { console.log('ok', name); pass++; }
        else      { console.log('FAIL', name, extra || ''); fail++; }
    }

    await page.click('#menu-start-btn'); await page.waitForTimeout(200);
    await page.click('#start-btn');     await page.waitForTimeout(700);

    const hookExists = await page.evaluate(() =>
        typeof window.__neonMPApplyWave === 'function');
    ok('window.__neonMPApplyWave is exposed', hookExists === true);

    // 1) Apply a host wave that is AHEAD of ours.
    await page.evaluate(() => window.__neonMPApplyWave(7));
    await page.waitForTimeout(100);
    const wAfter = await page.evaluate(() => window.game.wave);
    ok('wave snaps forward to host value', wAfter === 7);

    // 2) Apply a host wave that is BEHIND — also snaps (host is authoritative).
    await page.evaluate(() => window.__neonMPApplyWave(3));
    await page.waitForTimeout(80);
    const wBack = await page.evaluate(() => window.game.wave);
    ok('wave snaps back to host value', wBack === 3);

    // 3) Invalid input is ignored.
    await page.evaluate(() => {
        window.__neonMPApplyWave(0);
        window.__neonMPApplyWave(-5);
        window.__neonMPApplyWave('foo');
        window.__neonMPApplyWave(null);
    });
    const wStable = await page.evaluate(() => window.game.wave);
    ok('invalid wave inputs ignored', wStable === 3);

    ok('no JS errors', errs.length === 0, errs.join(' / '));

    await browser.close();
    server.kill();
    console.log(`\nCOOP WAVE SYNC: ${pass} pass, ${fail} fail`);
    process.exit(fail === 0 ? 0 : 1);
})().catch(e => { console.error(e); process.exit(1); });
