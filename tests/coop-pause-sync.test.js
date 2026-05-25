// Regression: in coop the HOST's pause / resume propagates to every
// peer through a 'pause' message. The receiver mirrors locally via
// window.__neonMPApplyPause without re-broadcasting.
const { chromium } = require('playwright');
const { spawn } = require('child_process');
const path = require('path');

(async () => {
    const PORT = 8779;
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

    // Launch a run.
    await page.click('#menu-start-btn'); await page.waitForTimeout(200);
    await page.click('#start-btn');     await page.waitForTimeout(700);

    // The mirror hook exists and is callable.
    const hookExists = await page.evaluate(() =>
        typeof window.__neonMPApplyPause === 'function');
    ok('window.__neonMPApplyPause is exposed', hookExists === true);

    // 1) Apply remote pause → local game pauses.
    await page.evaluate(() => window.__neonMPApplyPause(true));
    await page.waitForTimeout(100);
    const stateAfterPause = await page.evaluate(() => window.game.state);
    ok('remote pause message pauses local game', stateAfterPause === 'paused');

    // 2) Apply remote resume → local game resumes.
    await page.evaluate(() => window.__neonMPApplyPause(false));
    await page.waitForTimeout(100);
    const stateAfterResume = await page.evaluate(() => window.game.state);
    ok('remote resume message resumes local game',
        stateAfterResume === 'playing' || stateAfterResume === 'paused' /* tolerant */);
    // (Tighter assertion: must be exactly 'playing'.)
    ok('remote resume leaves state = playing', stateAfterResume === 'playing');

    // 3) Idempotent — paused then paused again is still paused.
    await page.evaluate(() => window.__neonMPApplyPause(true));
    await page.evaluate(() => window.__neonMPApplyPause(true));
    await page.waitForTimeout(80);
    const stillPaused = await page.evaluate(() => window.game.state);
    ok('double-pause stays paused', stillPaused === 'paused');

    ok('no JS errors', errs.length === 0, errs.join(' / '));

    await browser.close();
    server.kill();
    console.log(`\nCOOP PAUSE SYNC: ${pass} pass, ${fail} fail`);
    process.exit(fail === 0 ? 0 : 1);
})().catch(e => { console.error(e); process.exit(1); });
