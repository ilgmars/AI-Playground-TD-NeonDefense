// Regression tests for mobile UX bugs that have bitten before:
//
//   1. Backpack overlay was not scrollable on mobile — nested
//      max-height + overflow:auto on #bp-grid-wrap and #bp-stash
//      hijacked the gesture and the whole panel felt frozen with
//      anything more than a handful of stash items.
//
//   2. The device Back button on mobile dropped the player out of the
//      WebView / browser instead of stepping back through the menu.
//      We push a sentinel state on each sub-screen entry so popstate
//      returns to the main menu.
const { chromium } = require('playwright');
const { spawn } = require('child_process');
const path = require('path');

(async () => {
    const server = spawn(process.execPath, ['tests/helpers/http-server.js', '8830'], { cwd: path.join(__dirname, '..'), stdio: 'ignore' });
    await new Promise(r => setTimeout(r, 600));
    const browser = await chromium.launch({ headless: true });
    let pass = 0, fail = 0;
    function ok(name, cond) {
        if (cond) { console.log('ok', name); pass++; }
        else      { console.log('FAIL', name); fail++; }
    }

    // ── 1) Backpack mobile scroll ────────────────────────────────────────
    {
        const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
        const page = await ctx.newPage();
        const errs = [];
        page.on('pageerror', e => errs.push(e.message));
        await page.goto('http://127.0.0.1:8830/index.html', { waitUntil: 'domcontentloaded' });
        await page.waitForTimeout(700);
        // Stuff the stash so the panel definitely exceeds the viewport.
        await page.evaluate(() => {
            const s = NeonSave.load();
            s.metaXP = 50000;
            s.maxWaveReached = 25;
            s.backpack = { w: 5, h: 4, placed: [], stash: Array(18).fill('plasma_cell'), luckBoost: 2 };
            NeonSave.write(s);
            location.reload();
        });
        await page.waitForTimeout(800);
        await page.evaluate(() => navigateToBackpack());
        await page.waitForTimeout(300);
        const dims = await page.evaluate(() => {
            const ov = document.getElementById('backpack');
            return { scrollHeight: ov.scrollHeight, clientHeight: ov.clientHeight };
        });
        ok('backpack overlay overflows the viewport (content > client)',
           dims.scrollHeight > dims.clientHeight);
        // Programmatic scroll should move the overlay's scrollTop.
        await page.evaluate(() => { document.getElementById('backpack').scrollTop = 300; });
        await page.waitForTimeout(100);
        const st = await page.evaluate(() => document.getElementById('backpack').scrollTop);
        ok('overlay accepts scrollTop assignment', st === 300);
        // Wheel events at the overlay's centre should move it. (Hover
        // first so the wheel target is the overlay, not the body.)
        await page.evaluate(() => { document.getElementById('backpack').scrollTop = 0; });
        await page.mouse.move(195, 400);
        await page.mouse.wheel(0, 250);
        await page.waitForTimeout(150);
        const wheelTop = await page.evaluate(() => document.getElementById('backpack').scrollTop);
        ok('wheel scroll moves overlay scrollTop > 0', wheelTop > 0);
        ok('no JS errors during mobile scroll', errs.length === 0);
        await ctx.close();
    }

    // ── 2) History back returns to main menu ─────────────────────────────
    for (const sub of [
        { name: 'backpack',      open: 'navigateToBackpack()',     visibleId: 'backpack' },
        { name: 'mastery lab',   open: 'navigateToTowerMastery()', visibleId: 'tower-mastery' },
        { name: 'tech tree',     open: 'navigateToTechTree()',     visibleId: 'tech-tree' },
        { name: 'run setup',     open: 'navigateToRunSetup()',     visibleId: 'start-screen' },
    ]) {
        const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
        const page = await ctx.newPage();
        await page.goto('http://127.0.0.1:8830/index.html', { waitUntil: 'domcontentloaded' });
        await page.waitForTimeout(700);
        await page.evaluate(`(() => { ${sub.open}; })()`);
        await page.waitForTimeout(200);
        const opened = await page.evaluate((id) => !document.getElementById(id).classList.contains('hidden'), sub.visibleId);
        ok(`opened ${sub.name}`, opened === true);
        // Simulate hardware Back.
        await page.goBack();
        await page.waitForTimeout(250);
        const backOnMain = await page.evaluate((id) => ({
            subHidden: document.getElementById(id).classList.contains('hidden'),
            mainVisible: !document.getElementById('main-menu').classList.contains('hidden'),
        }), sub.visibleId);
        ok(`back from ${sub.name} hides the sub-screen`,  backOnMain.subHidden === true);
        ok(`back from ${sub.name} shows the main menu`,   backOnMain.mainVisible === true);
        await ctx.close();
    }

    await browser.close();
    server.kill();

    console.log(`\nMOBILE NAV: ${pass} pass, ${fail} fail`);
    process.exit(fail === 0 ? 0 : 1);
})().catch(e => { console.error(e); process.exit(1); });
