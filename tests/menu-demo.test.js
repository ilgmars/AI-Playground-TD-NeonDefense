// Ambient main-menu backdrop: a faint vignette of ONE REAL Tower defending
// against REAL Enemies that converge from random directions — built on the
// actual game classes (Tower/Enemy/Projectile), so combat/art/projectiles
// match the game exactly. Must stay subtle (faint, behind content,
// non-interactive), keep the tower near the title without obstruction, fire
// real per-type projectiles (rocket tower → rockets), and keep working after a
// run ends and the player returns to the menu.
const { chromium } = require('playwright');
const { spawn } = require('child_process');
const path = require('path');

(async () => {
    const PORT = 9660 + Math.floor(Math.random() * 50);
    const server = spawn(process.execPath, ['tests/helpers/http-server.js', String(PORT)],
        { cwd: path.join(__dirname, '..'), stdio: 'ignore' });
    await new Promise(r => setTimeout(r, 600));
    const browser = await chromium.launch({ headless: true });
    const ctx = await browser.newContext({ viewport: { width: 1024, height: 720 }, reducedMotion: 'no-preference' });
    await ctx.addInitScript(() => { window.__neonAegisDev = true; });
    const page = await ctx.newPage();
    const errs = [];
    page.on('pageerror', e => errs.push(e.message));

    let pass = 0, fail = 0;
    const ok = (n, c, x) => { if (c) { console.log('ok', n); pass++; } else { console.log('FAIL', n, x || ''); fail++; } };

    await page.goto(`http://127.0.0.1:${PORT}/index.html`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(700);

    // 1) Not distracting.
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

    // 2) It animates while the menu is visible.
    const f1 = await page.evaluate(() => window.__neonMenuDemo.state.frames);
    await page.waitForTimeout(300);
    const f2 = await page.evaluate(() => window.__neonMenuDemo.state.frames);
    ok('demo animates on the menu (frame counter advances)', f2 > f1, JSON.stringify({ f1, f2 }));

    // 3) Tower near the title and clear of the buttons.
    const place = await page.evaluate(() => {
        const d = window.__neonMenuDemo.state;
        const cr = document.getElementById('menu-demo').getBoundingClientRect();
        const sx = cr.left + d.towerX, sy = cr.top + d.towerY;
        const tr = document.querySelector('#main-menu .neon-logo').getBoundingClientRect();
        const btns = [...document.querySelectorAll('.menu-buttons button')].map(b => b.getBoundingClientRect());
        const inside = (r) => sx >= r.left && sx <= r.right && sy >= r.top && sy <= r.bottom;
        return { sx, sy, titleTop: tr.top, towerX: d.towerX, W: d.W, overButton: btns.some(inside), nBtns: btns.length };
    });
    ok('tower sits just above the title (near it)', place.sy < place.titleTop && (place.titleTop - place.sy) < 170, JSON.stringify(place));
    ok('tower is not obstructed by any menu button', place.nBtns > 0 && place.overButton === false, JSON.stringify(place));
    ok('tower stays on-screen (within canvas width)', place.towerX > 30 && place.towerX < place.W - 30, JSON.stringify(place));

    // 4) Gradient confines the scene above the content — backdrop pixels over a
    //    button are fully erased.
    const confined = await page.evaluate(() => {
        const c = document.getElementById('menu-demo');
        const b = c.getContext('2d');
        const btn = document.querySelector('.menu-buttons button').getBoundingClientRect();
        const cr = c.getBoundingClientRect();
        const sx = Math.round((btn.left + btn.width / 2 - cr.left) * (c.width / cr.width));
        const sy = Math.round((btn.top + btn.height / 2 - cr.top) * (c.height / cr.height));
        return { alpha: b.getImageData(sx, sy, 1, 1).data[3] };
    });
    ok('gradient confines the scene — nothing drawn over the buttons', confined.alpha === 0, JSON.stringify(confined));

    // 5) REAL entities & MATCH: spy on the draw helpers and confirm the demo
    //    makes the same calls the game does — drawTower with the tile CORNER
    //    (centre = corner + size/2) at the game tile size, and a rocket tower
    //    fires a real 'rocket' projectile.
    const match = await page.evaluate(() => {
        const d = window.__neonMenuDemo;
        d._setType('rocket');
        const tw = [], pj = [];
        const oT = window.drawTower, oP = window.drawProjectile;
        window.drawTower = (c, x, y, t, s, a, l) => { tw.push({ x, y, t, s }); return oT(c, x, y, t, s, a, l); };
        window.drawProjectile = (c, x, y, t, a) => { pj.push({ t }); return oP(c, x, y, t, a); };
        for (let i = 0; i < 150 && pj.length === 0; i++) d._tick();
        window.drawTower = oT; window.drawProjectile = oP;
        return { st: d.state, tw: tw[tw.length - 1], pj: pj[0], TILE: window.TILE_SIZE, isReal: typeof Tower !== 'undefined' };
    });
    ok('uses the real game entity classes', match.isReal === true, JSON.stringify(match));
    ok('tower uses the game CORNER convention (centre = corner + size/2)',
        match.tw && Math.abs((match.tw.x + match.tw.s / 2) - match.st.towerX) < 1 &&
        Math.abs((match.tw.y + match.tw.s / 2) - match.st.towerY) < 1, JSON.stringify(match));
    ok('tower drawn at the game tile size', match.tw && match.tw.s === match.TILE, JSON.stringify(match));
    ok('rocket tower fires a real ROCKET projectile (matches the game)', match.pj && match.pj.t === 'rocket', JSON.stringify(match));

    // 6) Monsters come from RANDOM DIRECTIONS (angles span the compass).
    const dirs = await page.evaluate(() => window.__neonMenuDemo._sampleDirections(16));
    const quadrants = new Set(dirs.map(a => Math.floor(((a % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI) / (Math.PI / 2))));
    ok('monsters approach from random directions (≥3 quadrants)', quadrants.size >= 3, JSON.stringify({ n: dirs.length, quadrants: [...quadrants] }));

    // 7) AA (flak) tower → AIR enemies; a ground tower → ground enemies.
    const air = await page.evaluate(() => { const d = window.__neonMenuDemo; d._setType('flak'); for (let i = 0; i < 4; i++) d._tick(); return d.state; });
    ok('AA (flak) tower → AIR enemies', air.enemyTypes.length > 0 && air.enemyTypes.every(t => t === 'air'), JSON.stringify(air));
    const ground = await page.evaluate(() => { const d = window.__neonMenuDemo; d._setType('basic'); for (let i = 0; i < 4; i++) d._tick(); return d.state; });
    ok('ground tower → ground enemies (no air)', ground.enemyTypes.length > 0 && ground.enemyTypes.every(t => t !== 'air'), JSON.stringify(ground));

    // 8) Render decoupling: the tower draws at ITS position even when the GAME's
    //    render transform/zoom is set (left over from a run).
    const decoupled = await page.evaluate(() => {
        window.__neonZoom = { scale: 3, tx: -300, ty: -250 };
        window.__neonRenderT = { a: 6, ox: -1800, oy: -1500 };
        const d = window.__neonMenuDemo;
        d.restart();
        for (let i = 0; i < 8; i++) d._tick();
        const s = d.state, c = document.getElementById('menu-demo'), b = c.getContext('2d');
        const dpr = c.width / c.getBoundingClientRect().width;
        const cx = Math.round(s.towerX * dpr), cy = Math.round(s.towerY * dpr), R = Math.round(18 * dpr);
        const img = b.getImageData(cx - R, cy - R, 2 * R, 2 * R).data;
        let opaque = 0; for (let i = 3; i < img.length; i += 4) if (img[i] > 0) opaque++;
        window.__neonZoom = { scale: 1, tx: 0, ty: 0 };
        return { opaque };
    });
    ok('tower renders at its own position despite a game zoom/pan transform', decoupled.opaque > 0, JSON.stringify(decoupled));

    // 9) Landscape: scene stays on-screen.
    await page.setViewportSize({ width: 760, height: 360 });
    await page.waitForTimeout(120);
    const land = await page.evaluate(() => { const d = window.__neonMenuDemo; d.restart(); for (let i = 0; i < 20; i++) d._tick(); return d.state; });
    ok('landscape: tower stays on-screen', land.towerY > 0 && land.towerY < land.H && land.towerX > 30 && land.towerX < land.W - 30, JSON.stringify(land));
    await page.setViewportSize({ width: 1024, height: 720 });
    await page.waitForTimeout(120);

    // 10) Survives a run: re-seeds + resumes after returning to the menu.
    await page.evaluate(() => localStorage.setItem('neonPlayerName', 'DEMO'));
    await page.click('#menu-start-btn'); await page.waitForTimeout(150);
    await page.click('#start-btn');      await page.waitForTimeout(400);
    await page.evaluate(() => { if (window.game) window.game.state = 'gameover'; });
    await page.evaluate(() => { if (typeof navigateToMainMenu === 'function') navigateToMainMenu(); });
    await page.waitForTimeout(150);
    const r1 = await page.evaluate(() => window.__neonMenuDemo.state.frames);
    await page.waitForTimeout(300);
    const r2 = await page.evaluate(() => window.__neonMenuDemo.state.frames);
    ok('backdrop resumes after returning to the menu (loop advancing)', r2 > r1, JSON.stringify({ r1, r2 }));

    // The demo must NEVER beep: a real Tower.update plays SoundFX, but the demo
    // silences it. Sound stays disabled after a demo tick.
    const silent = await page.evaluate(() => {
        const before = (typeof soundEnabled !== 'undefined') ? soundEnabled : null;
        window.__neonMenuDemo._setType('rapid');
        for (let i = 0; i < 10; i++) window.__neonMenuDemo._tick();
        const after = (typeof soundEnabled !== 'undefined') ? soundEnabled : null;
        return { before, after };
    });
    ok('demo leaves sound state untouched (no beeping)', silent.after === silent.before, JSON.stringify(silent));

    ok('no JS errors', errs.length === 0, errs.join(' / '));
    await browser.close();
    server.kill();
    console.log(`\nMENU DEMO: ${pass} pass, ${fail} fail`);
    process.exit(fail === 0 ? 0 : 1);
})().catch(e => { console.error(e); process.exit(1); });
