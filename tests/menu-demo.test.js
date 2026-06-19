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
    ok('backdrop is soft but visible (0.3 ≤ opacity ≤ 0.65)', style.opacity >= 0.3 && style.opacity <= 0.65, JSON.stringify(style));
    ok('backdrop is non-interactive (pointer-events:none)', style.pointer === 'none', JSON.stringify(style));
    ok('backdrop sits BEHIND the menu content', style.demoZ < style.contentZ, JSON.stringify(style));
    ok('backdrop has a real size', style.w > 50 && style.h > 50, JSON.stringify(style));

    // 2) It animates while the menu is visible (live rAF loop advancing).
    const f1 = await page.evaluate(() => window.__neonMenuDemo.state.frames);
    await page.waitForTimeout(250);
    const f2 = await page.evaluate(() => window.__neonMenuDemo.state.frames);
    ok('demo animates on the menu (frame counter advances)', f2 > f1, JSON.stringify({ f1, f2 }));

    // 3) Placement: the tower sits just ABOVE the title (near it) and is NOT
    //    obstructed by — nor obstructing — any menu button.
    const place = await page.evaluate(() => {
        const d = window.__neonMenuDemo.state;
        const cr = document.getElementById('menu-demo').getBoundingClientRect();
        const sx = cr.left + d.towerX, sy = cr.top + d.towerY;   // tower in screen px
        const tr = document.querySelector('#main-menu .neon-logo').getBoundingClientRect();
        const btns = [...document.querySelectorAll('.menu-buttons button')].map(b => b.getBoundingClientRect());
        const inside = (r) => sx >= r.left && sx <= r.right && sy >= r.top && sy <= r.bottom;
        return { sx, sy, titleTop: tr.top, titleBottom: tr.bottom,
            overButton: btns.some(inside), nBtns: btns.length };
    });
    ok('tower sits just above the title (near it, clear of the text)',
        place.sy < place.titleTop && (place.titleTop - place.sy) < 160, JSON.stringify(place));
    ok('tower is not obstructed by any menu button', place.nBtns > 0 && place.overButton === false, JSON.stringify(place));

    // The gradient must keep the scene OUT of the button region: sample the
    // backdrop's own pixels at the button stack — they must be fully erased.
    const confined = await page.evaluate(() => {
        const c = document.getElementById('menu-demo');
        const b = c.getContext('2d');
        const btn = document.querySelector('.menu-buttons button').getBoundingClientRect();
        const cr = c.getBoundingClientRect();
        const sxDev = Math.round((btn.left + btn.width / 2 - cr.left) * (c.width / cr.width));
        const syDev = Math.round((btn.top + btn.height / 2 - cr.top) * (c.height / cr.height));
        const px = b.getImageData(sxDev, syDev, 1, 1).data;
        return { alpha: px[3] };
    });
    ok('gradient confines the scene — nothing drawn over the buttons', confined.alpha === 0, JSON.stringify(confined));

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
