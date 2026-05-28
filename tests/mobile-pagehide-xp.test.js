// Regression: a paused single-player run on mobile that gets killed by
// the OS (closed browser, swiped tab) MUST still award XP for the wave
// the player reached. The bug: only Game.gameOver() called onRunEnded,
// so a backgrounded tab being destroyed left metaXP unchanged.
//
// The fix: a `pagehide` + `visibilitychange→hidden` handler in main.js
// calls onRunEnded({retired:true, hpEverLost:true}) when a run is
// in-progress and the page is being torn down. Multiplayer runs are
// excluded (host-coordinated scoring).
//
// We assert:
//   1. The test hook __neonEndRunOnHide is installed.
//   2. While paused at wave N, firing the hook bumps save.metaXP by
//      calculateRunXP(N, tier, false).total.
//   3. The hook is idempotent — firing twice doesn't double-pay.
//   4. While in MP (window.__neonMPFairPlay = true) the hook is a no-op.
//   5. When game.state is 'gameover' the hook is a no-op.

const { chromium } = require('playwright');
const { spawn } = require('child_process');
const path = require('path');

(async () => {
    const PORT = 9300 + Math.floor(Math.random() * 90);
    const server = spawn(process.execPath, ['tests/helpers/http-server.js', String(PORT)],
        { cwd: path.join(__dirname, '..'), stdio: 'ignore' });
    await new Promise(r => setTimeout(r, 600));
    const browser = await chromium.launch({ headless: true });
    // Use mobile viewport so we exercise the same code path the user
    // hits (the bug was reported on mobile browsers).
    const ctx = await browser.newContext({
        viewport: { width: 390, height: 844 },
        hasTouch: true, isMobile: true,
    });
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

    await page.evaluate(() => { localStorage.setItem('neonPlayerName', 'MOB'); });
    await page.click('#menu-start-btn'); await page.waitForTimeout(150);
    await page.click('#start-btn');     await page.waitForTimeout(500);

    // 1) Hook installed
    const hooked = await page.evaluate(() => typeof window.__neonEndRunOnHide === 'function');
    ok('window.__neonEndRunOnHide is installed', hooked);

    // 2) Pause + fire hook → metaXP bumps
    const before = await page.evaluate(() => {
        window.game.state = 'paused';
        window.game.wave  = 7;            // simulate the player having reached wave 7
        window.game.ascensionTier = 0;
        return {
            metaXP: window.save.metaXP,
            expected: window.NeonSave.calculateRunXP(7, 0, false).total,
        };
    });
    ok('expected XP for wave 7 is > 0', before.expected > 0,
        `calculateRunXP(7,0,false).total=${before.expected}`);

    await page.evaluate(() => { window.__neonEndRunOnHide(); });
    const afterFire = await page.evaluate(() => window.save.metaXP);
    ok('metaXP increased by exactly calculateRunXP(7,0,false).total',
        afterFire - before.metaXP === before.expected,
        `before=${before.metaXP} after=${afterFire} expected=${before.expected}`);

    // 3) Idempotent
    await page.evaluate(() => { window.__neonEndRunOnHide(); });
    const afterTwice = await page.evaluate(() => window.save.metaXP);
    ok('second fire is a no-op (idempotent)', afterTwice === afterFire,
        `after2=${afterTwice} after1=${afterFire}`);

    // 4) MP gate: a fresh run with __neonMPFairPlay=true must NOT award.
    await page.evaluate(() => {
        // Reset run state to simulate a new mp run starting.
        window.game.state = 'playing';
        window.game.wave  = 12;
        window.__neonMPFairPlay = true;
        // Reset the latch so the hook would fire if the gate weren't there.
        window.__neonEndRunOnHide.__resetTest = true; // not actually used
    });
    // The latch is closure-local — we can't reset it from outside. So
    // instead, reload the page to get a fresh latch, re-enter a run,
    // and exercise the MP gate cleanly.
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(700);
    await page.click('#menu-start-btn'); await page.waitForTimeout(150);
    await page.click('#start-btn');     await page.waitForTimeout(500);
    const mpBefore = await page.evaluate(() => {
        window.__neonMPFairPlay = true;
        window.game.state = 'paused';
        window.game.wave  = 9;
        return window.save.metaXP;
    });
    await page.evaluate(() => { window.__neonEndRunOnHide(); });
    const mpAfter = await page.evaluate(() => window.save.metaXP);
    ok('MP run: hook does NOT award XP', mpBefore === mpAfter,
        `before=${mpBefore} after=${mpAfter}`);

    // 5) gameover gate
    await page.evaluate(() => { window.__neonMPFairPlay = false; });
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(700);
    await page.click('#menu-start-btn'); await page.waitForTimeout(150);
    await page.click('#start-btn');     await page.waitForTimeout(500);
    const goBefore = await page.evaluate(() => {
        window.game.state = 'gameover';   // run already ended; hook should no-op
        window.game.wave  = 11;
        return window.save.metaXP;
    });
    await page.evaluate(() => { window.__neonEndRunOnHide(); });
    const goAfter = await page.evaluate(() => window.save.metaXP);
    ok('gameover state: hook is a no-op', goBefore === goAfter,
        `before=${goBefore} after=${goAfter}`);

    ok('no JS errors', errs.length === 0, errs.join(' / '));

    await browser.close();
    server.kill();
    console.log(`\nMOBILE PAGEHIDE XP: ${pass} pass, ${fail} fail`);
    process.exit(fail === 0 ? 0 : 1);
})().catch(e => { console.error(e); process.exit(1); });
