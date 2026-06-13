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

    // 3) The quick-launch / skip-setup feature was REMOVED: there's no
    // toggle, the old pref is force-reset to false on load, and START
    // always shows the full launch screen (loadout visible, level
    // picker present) — never an instant launch.
    const removed = await page.evaluate(() => {
        // Simulate a save that had the old pref on, then reload it.
        save.settings = save.settings || {};
        save.settings.skipRunSetup = true;
        NeonSave.write(save);
        const reloaded = NeonSave.load();
        navigateToMainMenu();
        document.getElementById('menu-start-btn').click();
        const ss = document.getElementById('start-screen');
        const heroRow = ss.querySelector('.loadout-row:has(#run-hero-select)');
        return {
            prefReset: reloaded.settings.skipRunSetup === false,
            noToggle: !document.getElementById('skipsetup-toggle'),
            screenVisible: !ss.classList.contains('hidden'),
            ascButtons: ss.querySelectorAll('.ascension-buttons[data-context="start"] button').length,
            loadoutVisible: heroRow ? getComputedStyle(heroRow).display !== 'none' : false,
            gameState: (window.game || {}).state || 'no-game',
        };
    });
    ok('old skip-setup pref is force-reset to false', removed.prefReset, JSON.stringify(removed));
    ok('the skip-setup toggle is gone', removed.noToggle);
    ok('START still shows the launch screen with the level picker + loadout',
        removed.screenVisible && removed.ascButtons >= 3 && removed.loadoutVisible,
        JSON.stringify(removed));
    ok('START never instant-launches (stays on setup, not playfield)',
        removed.gameState !== 'playing', removed.gameState);

    ok('no JS errors', errs.length === 0, errs.join(' / '));

    await browser.close();
    server.kill();
    console.log(`\nSTART LEVEL CHOICE: ${pass} pass, ${fail} fail`);
    process.exit(fail === 0 ? 0 : 1);
})().catch(e => { console.error(e); process.exit(1); });
