// Regression: scoreboard click-through. Real player flow from the main
// menu through every element of the scoreboard overlay, asserting an
// expected outcome at each step. Catches the "button does nothing"
// class of bugs (where the overlay opens but is occluded by the
// menu it came from, or back doesn't return cleanly).
const { chromium } = require('playwright');
const { spawn } = require('child_process');
const path = require('path');

(async () => {
    const PORT = 8801;
    const server = spawn(process.execPath, ['tests/helpers/http-server.js', String(PORT)],
        { cwd: path.join(__dirname, '..'), stdio: 'ignore' });
    await new Promise(r => setTimeout(r, 600));
    const browser = await chromium.launch({ headless: true });

    let pass = 0, fail = 0;
    function ok(name, cond, extra) {
        if (cond) { console.log('ok', name); pass++; }
        else      { console.log('FAIL', name, extra || ''); fail++; }
    }

    async function freshPage(viewport) {
        const ctx = await browser.newContext(viewport || {});
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
        await page.evaluate(() => { localStorage.setItem('neonPlayerName', 'CLICK'); });
        return { ctx, page, errs };
    }

    // Reading helper used by every assertion.
    const visibleId = (page, id) => page.evaluate((id) => {
        const el = document.getElementById(id);
        if (!el) return false;
        if (el.classList.contains('hidden')) return false;
        const cs = getComputedStyle(el);
        return cs.display !== 'none' && cs.visibility !== 'hidden';
    }, id);

    // ─────────────────────────────────────────────────────────────────
    // Scenario 1 — DESKTOP click-through from main menu
    // ─────────────────────────────────────────────────────────────────
    {
        const { ctx, page, errs } = await freshPage({ viewport: { width: 1280, height: 800 } });

        // 1) Main menu is visible; SCOREBOARD button is in it.
        ok('main menu visible at start',   await visibleId(page, 'main-menu'));
        ok('SCOREBOARD button exists',     await page.locator('#menu-scores-btn').count() === 1);
        ok('scoreboard overlay starts hidden',
            (await visibleId(page, 'scoreboard-screen')) === false);

        // 2) Real Playwright click on SCOREBOARD. After commit f206e67
        //    the button only removed the .hidden class but didn't hide
        //    main-menu, so the overlay competed with the menu for
        //    clicks. The fix in this commit calls hideScreen('main-
        //    menu') too. Verify both.
        await page.click('#menu-scores-btn');
        await page.waitForTimeout(150);
        ok('SCOREBOARD click opens overlay',
            await visibleId(page, 'scoreboard-screen'));
        ok('SCOREBOARD click HIDES main-menu',
            (await visibleId(page, 'main-menu')) === false);

        // 3) Tier tabs exist, A0 selected by default.
        const tabsInfo = await page.evaluate(() => {
            const tabs = Array.from(document.querySelectorAll('#sb-tabs .score-tab'));
            return {
                count: tabs.length,
                selectedText: (tabs.find(t => t.classList.contains('selected')) || {}).textContent,
            };
        });
        ok('tier tabs are rendered',          tabsInfo.count >= 1);
        ok('the first tab is "selected"',     /A\d/.test(tabsInfo.selectedText || ''));

        // 4) Clicking a different tier tab updates the selection.
        await page.evaluate(() => {
            const tabs = Array.from(document.querySelectorAll('#sb-tabs .score-tab'));
            const target = tabs.find(t => !t.classList.contains('selected'));
            if (target) target.click();
        });
        await page.waitForTimeout(80);
        const afterTab = await page.evaluate(() => {
            const tabs = Array.from(document.querySelectorAll('#sb-tabs .score-tab'));
            const sel = tabs.find(t => t.classList.contains('selected'));
            return sel ? sel.textContent : null;
        });
        ok('clicking a tier tab moves the selection', afterTab !== tabsInfo.selectedText);

        // 5) Autopilot filter checkbox is clickable.
        await page.evaluate(() => {
            save.highScores['a0'] = [
                { name: 'HUMAN', wave: 30, tier: 0, autopilot: false },
                { name: 'BOT',   wave: 90, tier: 0, autopilot: true  },
            ];
            NeonSave.write(save);
            window.openScoreboard();
        });
        await page.waitForTimeout(120);
        const beforeFilter = await page.evaluate(() =>
            Array.from(document.querySelectorAll('#sb-list .sb-row .sb-name'))
                .map(el => el.textContent.trim()));
        ok('autopilot row visible by default',
            beforeFilter.some(n => /BOT/.test(n)));

        await page.click('#sb-hide-autopilot');
        await page.waitForTimeout(120);
        const afterFilter = await page.evaluate(() =>
            Array.from(document.querySelectorAll('#sb-list .sb-row .sb-name'))
                .map(el => el.textContent.trim()));
        ok('ticking Hide Autopilot removes the BOT row',
            !afterFilter.some(n => /BOT/.test(n)) &&
            afterFilter.some(n => /HUMAN/.test(n)));

        // 6) Untick autopilot filter → BOT row comes back.
        await page.click('#sb-hide-autopilot');
        await page.waitForTimeout(120);
        const afterUntick = await page.evaluate(() =>
            Array.from(document.querySelectorAll('#sb-list .sb-row .sb-name'))
                .map(el => el.textContent.trim()));
        ok('unticking Hide Autopilot restores the BOT row',
            afterUntick.some(n => /BOT/.test(n)));

        // 7) Cheated filter — start checked by default. Add a cheated
        //    row and verify it's NOT visible; untick to show it.
        await page.evaluate(() => {
            save.highScores['a0'].push({ name: 'HACK', wave: 999, tier: 0, cheated: true });
            NeonSave.write(save);
            window.openScoreboard();
        });
        await page.waitForTimeout(80);
        const cheatedHidden = await page.evaluate(() =>
            Array.from(document.querySelectorAll('#sb-list .sb-row .sb-name'))
                .map(el => el.textContent.trim()));
        ok('cheated row hidden by default (filter checked)',
            !cheatedHidden.some(n => /HACK/.test(n)));

        await page.click('#sb-hide-cheated');
        await page.waitForTimeout(80);
        const cheatedShown = await page.evaluate(() =>
            Array.from(document.querySelectorAll('#sb-list .sb-row .sb-name'))
                .map(el => el.textContent.trim()));
        ok('unticking Hide Cheated shows the HACK row',
            cheatedShown.some(n => /HACK/.test(n)));

        // 8) Both filter prefs persist to localStorage.
        const persisted = await page.evaluate(() => ({
            auto: localStorage.getItem('neonSbHideAuto'),
            cheat: localStorage.getItem('neonSbHideCheated'),
        }));
        ok('autopilot filter pref persists in localStorage',
            persisted.auto === '0');   // we unticked at step 6
        ok('cheated filter pref persists in localStorage',
            persisted.cheat === '0');  // we unticked at step 7

        // 9) BACK button returns to main menu and hides the overlay.
        await page.click('#sb-back-btn');
        await page.waitForTimeout(150);
        ok('BACK hides the scoreboard',
            (await visibleId(page, 'scoreboard-screen')) === false);
        ok('BACK reveals main-menu again',
            await visibleId(page, 'main-menu'));

        ok('desktop: no JS errors', errs.length === 0, errs.join(' / '));
        await ctx.close();
    }

    // ─────────────────────────────────────────────────────────────────
    // Scenario 2 — MOBILE: open via menu, BACK closes
    // ─────────────────────────────────────────────────────────────────
    {
        const { ctx, page, errs } = await freshPage({
            viewport: { width: 390, height: 844 },
            hasTouch: true, isMobile: true,
        });
        ok('mobile: scoreboard hidden at start',
            (await visibleId(page, 'scoreboard-screen')) === false);

        await page.click('#menu-scores-btn');
        await page.waitForTimeout(150);
        ok('mobile: SCOREBOARD click opens overlay',
            await visibleId(page, 'scoreboard-screen'));
        ok('mobile: SCOREBOARD click hides main-menu',
            (await visibleId(page, 'main-menu')) === false);

        await page.click('#sb-back-btn');
        await page.waitForTimeout(150);
        ok('mobile: BACK returns to main-menu',
            await visibleId(page, 'main-menu'));

        ok('mobile: no JS errors', errs.length === 0, errs.join(' / '));
        await ctx.close();
    }

    // ─────────────────────────────────────────────────────────────────
    // Scenario 3 — From the RUN SETUP screen
    // ─────────────────────────────────────────────────────────────────
    {
        const { ctx, page, errs } = await freshPage({ viewport: { width: 1280, height: 800 } });
        await page.click('#menu-start-btn');
        await page.waitForTimeout(200);
        ok('start-screen visible after menu-start-btn', await visibleId(page, 'start-screen'));

        ok('setup-scores-btn exists',
            (await page.locator('#setup-scores-btn').count()) === 1);
        await page.click('#setup-scores-btn');
        await page.waitForTimeout(150);
        ok('setup-scores-btn opens scoreboard',
            await visibleId(page, 'scoreboard-screen'));
        ok('setup-scores-btn hides start-screen',
            (await visibleId(page, 'start-screen')) === false);

        await page.click('#sb-back-btn');
        await page.waitForTimeout(150);
        ok('BACK from scoreboard returns to start-screen',
            await visibleId(page, 'start-screen'));

        ok('setup-screen: no JS errors', errs.length === 0, errs.join(' / '));
        await ctx.close();
    }

    await browser.close();
    server.kill();
    console.log(`\nSCOREBOARD CLICKTHROUGH: ${pass} pass, ${fail} fail`);
    process.exit(fail === 0 ? 0 : 1);
})().catch(e => { console.error(e); process.exit(1); });
