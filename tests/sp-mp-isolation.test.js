// Regression: race overlay must NOT appear in single-player runs,
// AND navigating back to the main menu after an MP session must
// tear down MP state (race controller stops, _activeMode clears,
// race overlay hidden).
const { chromium } = require('playwright');
const { spawn } = require('child_process');
const path = require('path');

(async () => {
    const PORT = 8820 + (Math.floor(Math.random() * 100));
    const server = spawn(process.execPath, ['tests/helpers/http-server.js', String(PORT)],
        { cwd: path.join(__dirname, '..'), stdio: 'ignore' });
    await new Promise(r => setTimeout(r, 600));
    const browser = await chromium.launch({ headless: true });
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    await ctx.addInitScript(() => { window.__neonAegisDev = true; });
    const page = await ctx.newPage();
    const errs = [];
    page.on('pageerror', e => errs.push(e.message));
    page.on('console', m => {
        if (m.type() !== 'error') return;
        const t = m.text();
        if (/mqtt|websocket|nostr|hivemq|emqx|relay\.verified-nostr/i.test(t)) return;
        errs.push('console: ' + t);
    });
    await page.goto(`http://127.0.0.1:${PORT}/index.html`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(700);
    await page.evaluate(() => { localStorage.setItem('neonPlayerName', 'SP'); });

    let pass = 0, fail = 0;
    function ok(name, cond, extra) {
        if (cond) { console.log('ok', name); pass++; }
        else      { console.log('FAIL', name, extra || ''); fail++; }
    }

    function visibleId(id) { return page.evaluate((id) => {
        const el = document.getElementById(id);
        if (!el || el.classList.contains('hidden')) return false;
        const cs = getComputedStyle(el);
        return cs.display !== 'none' && cs.visibility !== 'hidden';
    }, id); }

    // ── 1) Cold SP start: race overlay must be hidden ────────────────
    ok('race overlay hidden on page load',
        (await visibleId('mp-race-overlay')) === false);

    await page.click('#menu-start-btn'); await page.waitForTimeout(200);
    await page.click('#start-btn');     await page.waitForTimeout(700);
    ok('race overlay hidden during SP run',
        (await visibleId('mp-race-overlay')) === false);

    // ── 2) Simulate a leftover MP session (no real Trystero) and then
    //      navigate back to the main menu. Race overlay must hide.
    await page.evaluate(() => {
        // Pretend coop was running by flipping _activeMode via the
        // test hook AND making the overlay visible.
        window.__neonMPSetMode('coop');
        document.getElementById('mp-race-overlay').classList.remove('hidden');
    });
    const beforeBack = await visibleId('mp-race-overlay');
    ok('race overlay manually shown (precondition)', beforeBack === true);

    // Trigger navigateToMainMenu via the EXIT button path.
    await page.evaluate(() => navigateToMainMenu());
    await page.waitForTimeout(150);
    ok('main-menu visible after EXIT-to-menu',
        await visibleId('main-menu'));
    ok('race overlay HIDDEN after EXIT-to-menu',
        (await visibleId('mp-race-overlay')) === false);

    // Now start an SP run from the menu. Race must STILL be hidden.
    await page.click('#menu-start-btn'); await page.waitForTimeout(200);
    await page.click('#start-btn');     await page.waitForTimeout(500);
    ok('race overlay STILL hidden in subsequent SP run',
        (await visibleId('mp-race-overlay')) === false);

    // ── 3) Canvas transform is empty at base zoom (mobile line fix) ─
    const transformAtBase = await page.evaluate(() => ({
        transform: document.getElementById('game-canvas').style.transform,
        origin:    document.getElementById('game-canvas').style.transformOrigin,
    }));
    ok('canvas has NO transform at 1x zoom (no hairline)',
        transformAtBase.transform === '');
    ok('canvas has NO transform-origin at 1x zoom',
        transformAtBase.origin === '');

    ok('no JS errors', errs.length === 0, errs.join(' / '));

    await browser.close();
    server.kill();
    console.log(`\nSP/MP ISOLATION: ${pass} pass, ${fail} fail`);
    process.exit(fail === 0 ? 0 : 1);
})().catch(e => { console.error(e); process.exit(1); });
