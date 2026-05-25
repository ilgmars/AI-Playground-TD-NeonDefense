// Regression: the race-mode leaderboard overlay must NOT be visible
// during a single-player run, and its × button must actually dismiss
// it when it does appear.
//
// The bug: #mp-race-overlay started life with class="hidden" in the
// HTML, but the only CSS rule that translates `.hidden` into
// `display:none` is `.overlay.hidden` — and #mp-race-overlay isn't
// an `.overlay`. So the panel was effectively always visible from
// page load and clicking × added a class that did nothing.
const { chromium } = require('playwright');
const { spawn } = require('child_process');
const path = require('path');

(async () => {
    const PORT = 8772;
    const server = spawn(process.execPath, ['tests/helpers/http-server.js', String(PORT)],
        { cwd: path.join(__dirname, '..'), stdio: 'ignore' });
    await new Promise(r => setTimeout(r, 600));

    let pass = 0, fail = 0;
    function ok(name, cond, extra) {
        if (cond) { console.log('ok', name); pass++; }
        else      { console.log('FAIL', name, extra || ''); fail++; }
    }

    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    await page.setViewportSize({ width: 1280, height: 800 });
    const errs = [];
    page.on('pageerror', e => errs.push(e.message));

    await page.goto(`http://127.0.0.1:${PORT}/index.html`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(600);
    // Pre-set the player name so start-btn doesn't block on the prompt
    // (gating added by 37d884f). The overlay-visibility test isn't
    // about the name flow.
    await page.evaluate(() => { localStorage.setItem('neonPlayerName', 'TESTER'); });

    // Element exists, has .hidden class, AND is actually invisible.
    const initial = await page.evaluate(() => {
        const el = document.getElementById('mp-race-overlay');
        if (!el) return { exists: false };
        return {
            exists: true,
            hasHiddenClass: el.classList.contains('hidden'),
            visible: el.offsetWidth > 0 && el.offsetHeight > 0,
            computedDisplay: getComputedStyle(el).display,
        };
    });
    ok('overlay exists in DOM',           initial.exists === true);
    ok('overlay has .hidden class',       initial.hasHiddenClass === true);
    ok('overlay has display:none',        initial.computedDisplay === 'none');
    ok('overlay not visible on menu',     initial.visible === false);

    // Launch a single-player run; the overlay must stay hidden.
    await page.click('#menu-start-btn');
    await page.waitForTimeout(250);
    await page.click('#start-btn');
    await page.waitForTimeout(700);

    const inGame = await page.evaluate(() => {
        const el = document.getElementById('mp-race-overlay');
        return {
            hasHiddenClass: el.classList.contains('hidden'),
            visible: el.offsetWidth > 0 && el.offsetHeight > 0,
            computedDisplay: getComputedStyle(el).display,
            gameState: window.game ? window.game.state : null,
        };
    });
    ok('single-player run started',                inGame.gameState === 'playing' || inGame.gameState === 'paused');
    ok('overlay STILL hidden during SP run',       inGame.hasHiddenClass === true);
    ok('overlay STILL display:none during SP run', inGame.computedDisplay === 'none');
    ok('overlay STILL not visible during SP run',  inGame.visible === false);

    // Force-show the overlay (simulates the "stuck visible" symptom
    // players reported) and click ×. It must actually dismiss.
    await page.evaluate(() => {
        document.getElementById('mp-race-overlay').classList.remove('hidden');
    });
    const afterForceShow = await page.evaluate(() => {
        const el = document.getElementById('mp-race-overlay');
        return { visible: el.offsetWidth > 0 && el.offsetHeight > 0 };
    });
    ok('force-shown overlay is now visible (sanity)', afterForceShow.visible === true);

    await page.click('#mp-race-leave');
    await page.waitForTimeout(120);
    const afterClose = await page.evaluate(() => {
        const el = document.getElementById('mp-race-overlay');
        return {
            hasHiddenClass: el.classList.contains('hidden'),
            visible: el.offsetWidth > 0 && el.offsetHeight > 0,
        };
    });
    ok('× re-hides the overlay (class)',     afterClose.hasHiddenClass === true);
    ok('× re-hides the overlay (rendered)',  afterClose.visible === false);

    ok('no JS errors during SP flow', errs.length === 0, errs.join(' / '));

    await browser.close();
    server.kill();
    console.log(`\nSP NO RACE OVERLAY: ${pass} pass, ${fail} fail`);
    process.exit(fail === 0 ? 0 : 1);
})().catch(e => { console.error(e); process.exit(1); });
