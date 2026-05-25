// Regression: in multiplayer the SPEED tile is LOCKED — clicking it
// is a no-op so a non-host can't desync the run by cycling speed. The
// game's speed is set once by applyMultiplayerSpeed from the host's
// chosen startSpeed (the lobby select on the host's side).
const { chromium } = require('playwright');
const { spawn } = require('child_process');
const path = require('path');

(async () => {
    const PORT = 8776;
    const server = spawn(process.execPath, ['tests/helpers/http-server.js', String(PORT)],
        { cwd: path.join(__dirname, '..'), stdio: 'ignore' });
    await new Promise(r => setTimeout(r, 600));
    const browser = await chromium.launch({ headless: true });
    const ctx = await browser.newContext();
    // Dev flag must be set BEFORE main.js IIFE evaluates so the
    // __neonMPSetMode test hook is honoured.
    await ctx.addInitScript(() => { window.__neonAegisDev = true; });
    const page = await ctx.newPage();
    await page.setViewportSize({ width: 1280, height: 800 });
    const errs = [];
    page.on('pageerror', e => errs.push(e.message));
    await page.goto(`http://127.0.0.1:${PORT}/index.html`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(600);

    let pass = 0, fail = 0;
    function ok(name, cond, extra) {
        if (cond) { console.log('ok', name); pass++; }
        else      { console.log('FAIL', name, extra || ''); fail++; }
    }

    // Launch a single-player run first so we can verify the SPEED toggle
    // works the normal way in SP, then switch into a pseudo-MP state and
    // verify the SAME click is a no-op.
    await page.evaluate(() => { localStorage.setItem('neonPlayerName', 'SPDLK'); });
    await page.click('#menu-start-btn');
    await page.waitForTimeout(200);
    await page.click('#start-btn');
    await page.waitForTimeout(700);

    // SP: clicking SPEED cycles the displayed value.
    const readSpeed = () => page.evaluate(() =>
        document.getElementById('speed-display').textContent);
    const beforeSP = await readSpeed();
    await page.click('#speed-btn');
    await page.waitForTimeout(80);
    const afterSP = await readSpeed();
    ok('SP: SPEED click changes display value', afterSP !== beforeSP);

    // Use the test hook to flip the closure-scoped _activeMode flag.
    const stamped = await page.evaluate(() =>
        typeof window.__neonMPSetMode === 'function' && window.__neonMPSetMode('race'));
    ok('test hook __neonMPSetMode is available', stamped === true);

    // Now click SPEED — display must NOT change (MP lock kicks in).
    const beforeMP = await readSpeed();
    await page.click('#speed-btn');
    await page.waitForTimeout(150);
    await page.click('#speed-btn');
    await page.waitForTimeout(150);
    const afterMP = await readSpeed();
    ok('MP: SPEED clicks do NOT change the display (lock holds)',
        beforeMP === afterMP, `before=${beforeMP} after=${afterMP}`);

    // Clear MP mode → SPEED toggle works again.
    await page.evaluate(() => window.__neonMPSetMode(null));
    await page.click('#speed-btn');
    await page.waitForTimeout(150);
    const afterClear = await readSpeed();
    ok('SP: SPEED cycles again after clearing MP mode',
        afterClear !== afterMP);

    ok('no JS errors', errs.length === 0, errs.join(' / '));

    await browser.close();
    server.kill();
    console.log(`\nMP SPEED LOCK: ${pass} pass, ${fail} fail`);
    process.exit(fail === 0 ? 0 : 1);
})().catch(e => { console.error(e); process.exit(1); });
