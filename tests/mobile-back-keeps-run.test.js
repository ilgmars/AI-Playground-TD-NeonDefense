// The system Back button (browser history on web, hardware Back in the APK —
// which calls webView.goBack()) must NOT drop an active run. It used to fall
// through to navigateToMainMenu and quit the game. Now an active run consumes
// Back (re-arms a history entry) and keeps playing; only the in-game EXIT
// button leaves a run.
const { chromium } = require('playwright');
const { spawn } = require('child_process');
const path = require('path');

(async () => {
    const PORT = 9640 + Math.floor(Math.random() * 50);
    const server = spawn(process.execPath, ['tests/helpers/http-server.js', String(PORT)],
        { cwd: path.join(__dirname, '..'), stdio: 'ignore' });
    await new Promise(r => setTimeout(r, 600));
    const browser = await chromium.launch({ headless: true });
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
    await ctx.addInitScript(() => { window.__neonAegisDev = true; });
    const page = await ctx.newPage();
    const errs = [];
    page.on('pageerror', e => errs.push(e.message));

    let pass = 0, fail = 0;
    const ok = (n, c, x) => { if (c) { console.log('ok', n); pass++; } else { console.log('FAIL', n, x || ''); fail++; } };

    await page.goto(`http://127.0.0.1:${PORT}/index.html`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(700);
    await page.evaluate(() => localStorage.setItem('neonPlayerName', 'BACK'));
    await page.click('#menu-start-btn'); await page.waitForTimeout(200);
    await page.click('#start-btn');     await page.waitForTimeout(700);

    const before = await page.evaluate(() => ({
        state: game.state,
        menuHidden: document.getElementById('main-menu').classList.contains('hidden'),
    }));
    ok('a run is active before Back', before.state === 'playing' || before.state === 'paused', JSON.stringify(before));

    // Fire the system Back twice — must NOT exit the run nor return to menu.
    await page.evaluate(() => history.back()); await page.waitForTimeout(200);
    await page.evaluate(() => history.back()); await page.waitForTimeout(200);

    const after = await page.evaluate(() => ({
        state: game && game.state,
        menuHidden: document.getElementById('main-menu').classList.contains('hidden'),
    }));
    ok('Back keeps the run alive (still playing/paused)',
        after.state === 'playing' || after.state === 'paused', JSON.stringify(after));
    ok('Back does NOT pop back to the main menu', after.menuHidden === true, JSON.stringify(after));
    ok('page did not unload (game survived Back)', after.state !== undefined, JSON.stringify(after));

    // Sanity: the in-game EXIT path still works (a run CAN be left intentionally).
    const exited = await page.evaluate(() => {
        if (typeof navigateToMainMenu === 'function') navigateToMainMenu();
        return document.getElementById('main-menu').classList.contains('hidden');
    });
    ok('explicit navigateToMainMenu still returns to the menu', exited === false, String(exited));

    ok('no JS errors', errs.length === 0, errs.join(' / '));
    await browser.close();
    server.kill();
    console.log(`\nMOBILE BACK KEEPS RUN: ${pass} pass, ${fail} fail`);
    process.exit(fail === 0 ? 0 : 1);
})().catch(e => { console.error(e); process.exit(1); });
