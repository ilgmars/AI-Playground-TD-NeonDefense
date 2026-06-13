// Regression: pressing START RUN must ALWAYS offer the level
// (Ascension) choice. "Skip Run Setup" used to launch instantly and
// removed that choice; now it only collapses the loadout dropdowns —
// the launch screen with the ascension picker + INITIALIZE always
// shows.
const { chromium } = require('playwright');
const { spawn } = require('child_process');
const path = require('path');

(async () => {
    const PORT = 9700 + Math.floor(Math.random() * 60);
    const server = spawn(process.execPath, ['tests/helpers/http-server.js', String(PORT)],
        { cwd: path.join(__dirname, '..'), stdio: 'ignore' });
    await new Promise(r => setTimeout(r, 600));
    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    const errs = [];
    page.on('pageerror', e => errs.push(e.message));

    let pass = 0, fail = 0;
    function ok(name, cond, extra) {
        if (cond) { console.log('ok', name); pass++; }
        else      { console.log('FAIL', name, extra || ''); fail++; }
    }

    await page.goto(`http://127.0.0.1:${PORT}/index.html`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(700);
    await page.evaluate(() => { localStorage.setItem('neonPlayerName', 'LVL'); });

    // 1) Default save: START RUN → launch screen with the level picker.
    const def = await page.evaluate(() => {
        document.getElementById('menu-start-btn').click();
        const ss = document.getElementById('start-screen');
        const btns = ss.querySelectorAll('.ascension-buttons[data-context="start"] button');
        return {
            screenVisible: !ss.classList.contains('hidden'),
            ascButtons: btns.length,
            hasPlusMinus: [...btns].some(b => b.textContent === '+') && [...btns].some(b => b.textContent === '−'),
            initialize: !!document.getElementById('start-btn'),
        };
    });
    ok('START RUN opens the launch screen', def.screenVisible);
    ok('launch screen offers the Ascension level picker (+/−)',
        def.ascButtons >= 3 && def.hasPlusMinus, JSON.stringify(def));
    ok('INITIALIZE button present', def.initialize);

    // 2) The +/− actually changes the chosen level.
    const changed = await page.evaluate(() => {
        const before = (typeof selectedTier !== 'undefined') ? selectedTier : null;
        // Unlock a few tiers so + can move.
        save.ascensionCleared = 5; NeonSave.write(save);
        renderAscensionSelector('start');
        const plus = [...document.querySelectorAll('.ascension-buttons[data-context="start"] button')]
            .find(b => b.textContent === '+');
        plus.click();
        return { before, after: selectedTier };
    });
    ok('the level picker changes the selected tier', changed.after > (changed.before || 0),
        JSON.stringify(changed));

    // 3) Quick-launch (skip-setup) STILL shows the level choice, just
    // hides the loadout dropdowns.
    const skip = await page.evaluate(() => {
        save.settings.skipRunSetup = true; NeonSave.write(save);
        navigateToMainMenu();
        document.getElementById('menu-start-btn').click();
        const ss = document.getElementById('start-screen');
        const asc = ss.querySelectorAll('.ascension-buttons[data-context="start"] button').length;
        const heroRow = ss.querySelector('.loadout-row:has(#run-hero-select)');
        const heroHidden = heroRow ? getComputedStyle(heroRow).display === 'none' : null;
        return {
            screenVisible: !ss.classList.contains('hidden'),
            ascButtons: asc,
            skipClass: ss.classList.contains('skip-loadout'),
            heroHidden,
        };
    });
    ok('skip-setup still opens the launch screen', skip.screenVisible);
    ok('skip-setup KEEPS the level picker', skip.ascButtons >= 3, JSON.stringify(skip));
    ok('skip-setup collapses the loadout dropdowns', skip.skipClass && skip.heroHidden === true,
        JSON.stringify(skip));

    ok('no JS errors', errs.length === 0, errs.join(' / '));

    await browser.close();
    server.kill();
    console.log(`\nSTART LEVEL CHOICE: ${pass} pass, ${fail} fail`);
    process.exit(fail === 0 ? 0 : 1);
})().catch(e => { console.error(e); process.exit(1); });
