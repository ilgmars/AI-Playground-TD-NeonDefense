// Regression: the boon chooser has a per-run "auto-pick remaining"
// toggle. While checked, subsequent pendingBoon triggers skip the
// chooser overlay and auto-take the first rolled choice. Useful for
// long endless runs where the player just wants to focus on building.
const { chromium } = require('playwright');
const { spawn } = require('child_process');
const path = require('path');

(async () => {
    const PORT = 8774;
    const server = spawn(process.execPath, ['tests/helpers/http-server.js', String(PORT)],
        { cwd: path.join(__dirname, '..'), stdio: 'ignore' });
    await new Promise(r => setTimeout(r, 600));
    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
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

    // Launch a run.
    await page.click('#menu-start-btn');
    await page.waitForTimeout(250);
    await page.click('#start-btn');
    await page.waitForTimeout(500);

    // Trigger first boon — chooser opens. Tick the auto-pick box, then
    // pick a card. Verify boonAutoPick is now true.
    await page.evaluate(() => {
        window.game.autopilot = false;
        window.game.pendingBoon = true;
    });
    await page.waitForSelector('#boon-overlay:not(.hidden)', { timeout: 4000 });
    const checkboxExists = await page.locator('#boon-autopick').count();
    ok('auto-pick checkbox is in the overlay', checkboxExists === 1);

    await page.click('#boon-autopick');
    const checkedState = await page.evaluate(() => ({
        cb: document.getElementById('boon-autopick').checked,
        run: !!window.game.boonAutoPick,
    }));
    ok('checkbox is checked',                  checkedState.cb === true);
    ok('game.boonAutoPick is set on the run',  checkedState.run === true);

    // Pick first boon → overlay closes.
    await page.locator('.boon-card').first().click();
    await page.waitForTimeout(200);
    const afterPick = await page.evaluate(() => ({
        boons: window.game.boons.length,
        hidden: document.getElementById('boon-overlay').classList.contains('hidden'),
        autoPick: !!window.game.boonAutoPick,
    }));
    ok('first boon was picked',           afterPick.boons === 1);
    ok('chooser is hidden after pick',    afterPick.hidden === true);
    ok('boonAutoPick survives the pick',  afterPick.autoPick === true);

    // Trigger a SECOND boon — chooser should NOT open. The boon is
    // auto-picked synchronously when the main loop drains pendingBoon.
    await page.evaluate(() => { window.game.pendingBoon = true; });
    // Wait a tick — the RAF loop drains pendingBoon and calls
    // NeonBoons.open(), which auto-takes the first choice without
    // showing the overlay.
    await page.waitForTimeout(400);
    const afterAuto = await page.evaluate(() => ({
        boons: window.game.boons.length,
        hidden: document.getElementById('boon-overlay').classList.contains('hidden'),
        boonActive: window.NeonBoons.isActive(),
    }));
    ok('second boon auto-picked (count incremented)', afterAuto.boons === 2);
    ok('chooser overlay stayed hidden',               afterAuto.hidden === true);
    ok('NeonBoons.isActive() is false',               afterAuto.boonActive === false);

    // Turn auto-pick off again → next boon should re-open the chooser.
    // (We trigger the chooser one more time and untick.)
    await page.evaluate(() => { window.game.boonAutoPick = false; window.game.pendingBoon = true; });
    await page.waitForSelector('#boon-overlay:not(.hidden)', { timeout: 4000 });
    const overlayShown = await page.evaluate(() =>
        !document.getElementById('boon-overlay').classList.contains('hidden'));
    ok('overlay re-opens after auto-pick is turned off', overlayShown === true);

    ok('no JS errors', errs.length === 0, errs.join(' / '));

    await browser.close();
    server.kill();
    console.log(`\nBOON AUTOPICK: ${pass} pass, ${fail} fail`);
    process.exit(fail === 0 ? 0 : 1);
})().catch(e => { console.error(e); process.exit(1); });
