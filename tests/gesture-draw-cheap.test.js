// Zoom/pan must stay smooth: during an active pinch/pan GESTURE the map must
// NOT be re-vectored every frame. The map layer is rasterized once and
// warp-blitted; even when a fast pan scrolls past the cached layer's coverage,
// a gesture frame paints a cheap opaque grass fill + blit rather than running
// the full map.draw + per-tile extended-grass loop (that loop, made heavier by
// the field now filling the whole container, was the "zoom/move is laggy"
// report). This asserts the cheap path is taken — and still leaves no blank
// patches (every pixel opaque).
const { chromium } = require('playwright');
const { spawn } = require('child_process');
const path = require('path');

(async () => {
    const PORT = 9650 + Math.floor(Math.random() * 50);
    const server = spawn(process.execPath, ['tests/helpers/http-server.js', String(PORT)],
        { cwd: path.join(__dirname, '..'), stdio: 'ignore' });
    await new Promise(r => setTimeout(r, 600));
    const browser = await chromium.launch({ headless: true });
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
    await ctx.addInitScript(() => { window.__neonAegisDev = true; });
    const page = await ctx.newPage();
    const errs = [];
    page.on('pageerror', e => errs.push(e.message));

    let pass = 0, fail = 0;
    const ok = (n, c, x) => { if (c) { console.log('ok', n); pass++; } else { console.log('FAIL', n, x || ''); fail++; } };

    await page.goto(`http://127.0.0.1:${PORT}/index.html`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(700);
    await page.evaluate(() => localStorage.setItem('neonPlayerName', 'PERF'));
    await page.click('#menu-start-btn'); await page.waitForTimeout(200);
    await page.click('#start-btn');     await page.waitForTimeout(700);

    const r = await page.evaluate(() => {
        const g = window.game;
        // Settle zoomed + panned to a far corner so the cached layer maps that
        // region; not a gesture, so it rasterizes once here.
        const Z = window.__neonZoom;
        Z.scale = 2.5; Z.tx = -300; Z.ty = -260;
        window.__neonZoomGesture = false;
        g.draw();

        // Spy on the EXPENSIVE per-frame work.
        let mapDraws = 0, grassLoops = 0;
        const origMap = g.map.draw.bind(g.map);
        const origGrass = g._drawExtendedGrass.bind(g);
        g.map.draw = (...a) => { mapDraws++; return origMap(...a); };
        g._drawExtendedGrass = (...a) => { grassLoops++; return origGrass(...a); };

        // Drag far across several gesture frames — scrolls uncached world in.
        window.__neonZoomGesture = true;
        const pans = [[-20, -10], [-200, -180], [-40, -250], [-260, -20]];
        for (const [tx, ty] of pans) { Z.tx = tx; Z.ty = ty; g.draw(); }

        // Holes check on the last gesture frame: every sampled pixel opaque.
        let holes = 0;
        const W = g.canvas.width, H = g.canvas.height;
        for (const fx of [0.05, 0.3, 0.6, 0.95]) {
            for (const fy of [0.05, 0.4, 0.95]) {
                const px = g.ctx.getImageData(Math.floor(W * fx), Math.floor(H * fy), 1, 1).data;
                if (px[3] !== 255) holes++;
            }
        }

        g.map.draw = origMap; g._drawExtendedGrass = origGrass;
        window.__neonZoomGesture = false; Z.scale = 1; Z.tx = 0; Z.ty = 0;
        g._mapLayerKey = null; g.draw();
        return { frames: pans.length, mapDraws, grassLoops, holes };
    });

    ok('gesture frames do NOT re-vector the map (no per-frame map.draw)', r.mapDraws === 0, JSON.stringify(r));
    ok('gesture frames do NOT run the per-tile extended-grass loop', r.grassLoops === 0, JSON.stringify(r));
    ok('cheap gesture path still leaves no blank patches (all pixels opaque)', r.holes === 0, JSON.stringify(r));

    ok('no JS errors', errs.length === 0, errs.join(' / '));
    await browser.close();
    server.kill();
    console.log(`\nGESTURE DRAW CHEAP: ${pass} pass, ${fail} fail`);
    process.exit(fail === 0 ? 0 : 1);
})().catch(e => { console.error(e); process.exit(1); });
