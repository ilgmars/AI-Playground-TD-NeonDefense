// Regression: scores are saved on RST and retire (not only on the
// game-over name-submit click). Player name is required before a run
// can start, so RST/retire always have a name to attach.
const { chromium } = require('playwright');
const { spawn } = require('child_process');
const path = require('path');

(async () => {
    const PORT = 8775;
    const server = spawn(process.execPath, ['tests/helpers/http-server.js', String(PORT)],
        { cwd: path.join(__dirname, '..'), stdio: 'ignore' });
    await new Promise(r => setTimeout(r, 600));
    const browser = await chromium.launch({ headless: true });
    let pass = 0, fail = 0;
    function ok(name, cond, extra) {
        if (cond) { console.log('ok', name); pass++; }
        else      { console.log('FAIL', name, extra || ''); fail++; }
    }

    // ── 1) start-btn refuses to launch a run without a cached name ─────
    {
        const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
        const page = await ctx.newPage();
        // Dismiss the name prompt — should prevent the run from starting.
        page.on('dialog', d => d.dismiss());
        await page.goto(`http://127.0.0.1:${PORT}/index.html`, { waitUntil: 'domcontentloaded' });
        await page.waitForTimeout(600);
        await page.evaluate(() => { try { localStorage.removeItem('neonPlayerName'); } catch (_) {} });
        await page.click('#menu-start-btn');
        await page.waitForTimeout(150);
        await page.click('#start-btn');
        await page.waitForTimeout(500);
        const state = await page.evaluate(() => window.game ? window.game.state : null);
        ok('cancelled name prompt → run does NOT start', state === 'start' || state === null);
        await ctx.close();
    }

    // ── 2) name accepted via prompt → run starts AND save records it ──
    {
        const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
        const page = await ctx.newPage();
        page.on('dialog', d => d.accept('TESTER'));
        await page.goto(`http://127.0.0.1:${PORT}/index.html`, { waitUntil: 'domcontentloaded' });
        await page.waitForTimeout(600);
        await page.evaluate(() => { try { localStorage.removeItem('neonPlayerName'); } catch (_) {} });
        await page.click('#menu-start-btn');
        await page.waitForTimeout(200);
        await page.click('#start-btn');
        await page.waitForTimeout(700);
        const result = await page.evaluate(() => ({
            state: window.game && window.game.state,
            cached: localStorage.getItem('neonPlayerName'),
        }));
        ok('accepted name kicks off the run',          result.state === 'playing' || result.state === 'paused');
        ok('name cached in localStorage',              result.cached === 'TESTER');
        await ctx.close();
    }

    // ── 3) RST saves the in-progress score ─────────────────────────────
    {
        const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
        const page = await ctx.newPage();
        page.on('dialog', d => d.accept());
        await page.goto(`http://127.0.0.1:${PORT}/index.html`, { waitUntil: 'domcontentloaded' });
        await page.waitForTimeout(600);
        await page.evaluate(() => { localStorage.setItem('neonPlayerName', 'RSTER'); });
        // Launch directly bypassing name prompt.
        await page.click('#menu-start-btn');
        await page.waitForTimeout(200);
        await page.click('#start-btn');
        await page.waitForTimeout(600);
        // Sim some progress.
        await page.evaluate(() => { window.game.wave = 17; });
        // Now click RST → confirm.
        await page.click('#restart-btn');
        await page.waitForTimeout(200);
        await page.click('#confirm-yes');
        await page.waitForTimeout(400);
        const board = await page.evaluate(() => {
            const tier = window.selectedTier || 0;
            return (save.highScores['a' + tier] || []).slice();
        });
        const entry = board.find(e => e.name === 'RSTER' && e.wave === 17);
        ok('RST records a high-score entry',         !!entry);
        ok('RST entry is NOT marked as retired',     entry && entry.retired === false);
        await ctx.close();
    }

    // ── 4) retire-confirm-yes saves the score ──────────────────────────
    {
        const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
        const page = await ctx.newPage();
        page.on('dialog', d => d.accept());
        await page.goto(`http://127.0.0.1:${PORT}/index.html`, { waitUntil: 'domcontentloaded' });
        await page.waitForTimeout(600);
        await page.evaluate(() => { localStorage.setItem('neonPlayerName', 'RETIR'); });
        await page.click('#menu-start-btn');
        await page.waitForTimeout(200);
        await page.click('#start-btn');
        await page.waitForTimeout(600);
        // Force wave >= 30 so retire is unlocked.
        await page.evaluate(() => {
            window.game.wave = 42;
            // Re-evaluate the SYS button's data-action.
            if (typeof updateUI === 'function') try { updateUI(); } catch (_) {}
        });
        await page.waitForTimeout(150);
        // Force the SYS button into retire mode (it normally swaps at wave>=30).
        await page.evaluate(() => {
            const b = document.getElementById('restart-btn');
            if (b) b.dataset.action = 'retire';
        });
        await page.click('#restart-btn');
        await page.waitForTimeout(200);
        await page.click('#retire-confirm-yes');
        await page.waitForTimeout(400);
        const board = await page.evaluate(() => {
            const tier = window.selectedTier || 0;
            return (save.highScores['a' + tier] || []).slice();
        });
        const entry = board.find(e => e.name === 'RETIR' && e.wave === 42);
        ok('retire records a high-score entry',  !!entry);
        ok('retire entry IS marked as retired',  entry && entry.retired === true);
        await ctx.close();
    }

    // ── 5) autopilot usage tags the entry ──────────────────────────────
    {
        const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
        const page = await ctx.newPage();
        page.on('dialog', d => d.accept());
        await page.goto(`http://127.0.0.1:${PORT}/index.html`, { waitUntil: 'domcontentloaded' });
        await page.waitForTimeout(600);
        await page.evaluate(() => { localStorage.setItem('neonPlayerName', 'BOT'); });
        await page.click('#menu-start-btn');
        await page.waitForTimeout(200);
        await page.click('#start-btn');
        await page.waitForTimeout(600);
        // Flip autopilot on, then back off.
        await page.click('#autopilot-btn');
        await page.waitForTimeout(150);
        await page.click('#autopilot-btn');
        await page.waitForTimeout(150);
        await page.evaluate(() => { window.game.wave = 9; });
        await page.click('#restart-btn');
        await page.waitForTimeout(200);
        await page.click('#confirm-yes');
        await page.waitForTimeout(400);
        const entry = await page.evaluate(() => {
            const tier = window.selectedTier || 0;
            return (save.highScores['a' + tier] || []).find(e => e.name === 'BOT' && e.wave === 9);
        });
        ok('autopilot run is tagged with autopilot:true',
            !!entry && entry.autopilot === true);
        await ctx.close();
    }

    await browser.close();
    server.kill();
    console.log(`\nAUTO-SAVE SCORE: ${pass} pass, ${fail} fail`);
    process.exit(fail === 0 ? 0 : 1);
})().catch(e => { console.error(e); process.exit(1); });
