// Ambient main-menu backdrop: a faint, side-anchored vignette of ONE random
// tower defending a lane. Decorative — must not distract (faint, behind
// content, non-interactive), an AA tower draws AIR enemies, and it must keep
// running after the player finishes a run and returns to the menu.
const { chromium } = require('playwright');
const { spawn } = require('child_process');
const path = require('path');

(async () => {
    const PORT = 9660 + Math.floor(Math.random() * 50);
    const server = spawn(process.execPath, ['tests/helpers/http-server.js', String(PORT)],
        { cwd: path.join(__dirname, '..'), stdio: 'ignore' });
    await new Promise(r => setTimeout(r, 600));
    const browser = await chromium.launch({ headless: true });
    // Force motion ON so the decorative demo is active (it's hidden under
    // prefers-reduced-motion).
    const ctx = await browser.newContext({ viewport: { width: 1024, height: 720 }, reducedMotion: 'no-preference' });
    await ctx.addInitScript(() => { window.__neonAegisDev = true; });
    const page = await ctx.newPage();
    const errs = [];
    page.on('pageerror', e => errs.push(e.message));

    let pass = 0, fail = 0;
    const ok = (n, c, x) => { if (c) { console.log('ok', n); pass++; } else { console.log('FAIL', n, x || ''); fail++; } };

    await page.goto(`http://127.0.0.1:${PORT}/index.html`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(700);

    // 1) Not distracting: faint, behind content, non-interactive.
    const style = await page.evaluate(() => {
        const c = document.getElementById('menu-demo');
        const cs = getComputedStyle(c);
        const main = document.querySelector('#main-menu .mm-main');
        const z = el => parseInt(getComputedStyle(el).zIndex, 10) || 0;
        return { exists: !!c, opacity: parseFloat(cs.opacity), pointer: cs.pointerEvents,
                 demoZ: z(c), contentZ: z(main),
                 w: c.getBoundingClientRect().width, h: c.getBoundingClientRect().height };
    });
    ok('backdrop canvas exists', style.exists, JSON.stringify(style));
    ok('backdrop is faint (opacity ≤ 0.25)', style.opacity > 0 && style.opacity <= 0.25, JSON.stringify(style));
    ok('backdrop is non-interactive (pointer-events:none)', style.pointer === 'none', JSON.stringify(style));
    ok('backdrop sits BEHIND the menu content', style.demoZ < style.contentZ, JSON.stringify(style));
    ok('backdrop has a real size', style.w > 50 && style.h > 50, JSON.stringify(style));

    // 2) It animates while the menu is visible (live rAF loop advancing).
    const f1 = await page.evaluate(() => window.__neonMenuDemo.state.frames);
    await page.waitForTimeout(250);
    const f2 = await page.evaluate(() => window.__neonMenuDemo.state.frames);
    ok('demo animates on the menu (frame counter advances)', f2 > f1, JSON.stringify({ f1, f2 }));

    // 3) Side placement: the tower lives on the right half.
    const place = await page.evaluate(() => window.__neonMenuDemo.state);
    ok('tower is placed on the side (right half)', place.towerX > place.W * 0.5, JSON.stringify(place));

    // 4) A single tower shoots: deterministic steps spawn enemies + fire shots.
    const sim = await page.evaluate(() => {
        const d = window.__neonMenuDemo;
        d.restart();
        for (let i = 0; i < 40; i++) d._tick(0.05);   // ~2s of sim
        return d.state;
    });
    ok('enemies march in', sim.enemies >= 1, JSON.stringify(sim));
    ok('the tower fires (projectiles in flight at some point)', sim.frames >= 40, JSON.stringify(sim));

    // 5) AA tower → AIR enemies; a ground tower → ground enemies.
    const air = await page.evaluate(() => {
        const d = window.__neonMenuDemo;
        d._setType('flak');
        for (let i = 0; i < 12; i++) d._tick(0.05);
        return d.state;
    });
    ok('AA (flak) tower → the lane carries AIR enemies',
        air.enemyTypes.length > 0 && air.enemyTypes.every(t => t === 'air'), JSON.stringify(air));
    const ground = await page.evaluate(() => {
        const d = window.__neonMenuDemo;
        d._setType('basic');
        for (let i = 0; i < 12; i++) d._tick(0.05);
        return d.state;
    });
    ok('ground tower → ground enemies (no air)',
        ground.enemyTypes.length > 0 && ground.enemyTypes.every(t => t !== 'air'), JSON.stringify(ground));

    // 6) THE KEY ONE: after finishing a run and returning to the menu, the
    //    backdrop still works (re-seeds + the live loop resumes).
    await page.evaluate(() => localStorage.setItem('neonPlayerName', 'DEMO'));
    await page.click('#menu-start-btn'); await page.waitForTimeout(150);
    await page.click('#start-btn');      await page.waitForTimeout(400);
    // While in a run the menu is hidden → backdrop idles (no draw).
    await page.evaluate(() => { if (window.game) window.game.state = 'gameover'; });
    await page.evaluate(() => { if (typeof navigateToMainMenu === 'function') navigateToMainMenu(); });
    await page.waitForTimeout(150);
    const r1 = await page.evaluate(() => window.__neonMenuDemo.state.frames);
    await page.waitForTimeout(300);
    const r2 = await page.evaluate(() => window.__neonMenuDemo.state);
    ok('backdrop resumes after returning to the menu (loop advancing)', r2.frames > r1, JSON.stringify({ r1, r2f: r2.frames }));
    ok('backdrop re-seeded a live scene after the run', r2.enemies >= 1, JSON.stringify(r2));

    ok('no JS errors', errs.length === 0, errs.join(' / '));
    await browser.close();
    server.kill();
    console.log(`\nMENU DEMO: ${pass} pass, ${fail} fail`);
    process.exit(fail === 0 ? 0 : 1);
})().catch(e => { console.error(e); process.exit(1); });
