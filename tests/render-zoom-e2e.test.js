// E2E: vector-crisp zoom, measured on actual pixels.
//
// Three end-to-end concerns:
//
//   1. FIDELITY — at 2.5× zoom the frame must be sharper than the old
//      CSS-transform model. We quantify it: render the zoomed view
//      through the real pipeline, then simulate the legacy path by
//      bitmap-upscaling a 1× raster of the same view, and compare
//      edge widths along a scanline (count of gradient pixels — a
//      smeared edge spreads its gradient over ~zoom× more pixels).
//      The vector render must have measurably narrower edges.
//
//   2. INTERACTION — while zoomed+panned, a tap through the REAL
//      pointer pipeline must land on the world tile under the finger
//      (the zoom inverse in getCanvasPos, end to end).
//
//   3. CACHE STABILITY — steady-state draws must NOT re-rasterize the
//      static map layer (one key, no churn); a zoom change must
//      re-rasterize exactly once.
const { chromium } = require('playwright');
const { spawn } = require('child_process');
const path = require('path');

(async () => {
    const PORT = 8802;
    const server = spawn(process.execPath, ['tests/helpers/http-server.js', String(PORT)],
        { cwd: path.join(__dirname, '..'), stdio: 'ignore' });
    await new Promise(r => setTimeout(r, 600));
    const browser = await chromium.launch({ headless: true });
    const ctx = await browser.newContext({
        viewport: { width: 800, height: 600 },
        deviceScaleFactor: 2,
        hasTouch: true,
    });
    const page = await ctx.newPage();
    const errs = [];
    page.on('pageerror', e => errs.push(e.message));
    await page.goto(`http://127.0.0.1:${PORT}/index.html#13371337`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(700);
    await page.evaluate(() => { localStorage.setItem('neonPlayerName', 'E2E'); });

    let pass = 0, fail = 0;
    function ok(name, cond, extra) {
        if (cond) { console.log('ok', name); pass++; }
        else      { console.log('FAIL', name, extra || ''); fail++; }
    }

    await page.click('#menu-start-btn'); await page.waitForTimeout(250);
    await page.click('#start-btn');     await page.waitForTimeout(800);

    // ── 1) Pixel-level fidelity at 2.5× zoom ───────────────────────────
    const sharp = await page.evaluate(() => {
        const g = window.game;
        g.state = 'paused';
        g.enemies.length = 0; g.projectiles.length = 0; g.particles.length = 0;

        // Edge-sharpness stats along a horizontal scanline. Bitmap
        // upscaling + smoothing spreads every luminance step over
        // ~zoom× more pixels, which always LOWERS the per-pixel
        // gradient: the maximum delta drops and strong edges (delta
        // above a firm threshold) vanish. A vector re-rasterization
        // keeps step edges at full strength.
        function edgeStats(imgData, w) {
            let strong = 0, maxDelta = 0, prev = null;
            for (let x = 0; x < w; x++) {
                const i = x * 4;
                const lum = 0.299 * imgData.data[i] + 0.587 * imgData.data[i + 1] + 0.114 * imgData.data[i + 2];
                if (prev !== null) {
                    const d = Math.abs(lum - prev);
                    if (d > 10) strong++;
                    if (d > maxDelta) maxDelta = d;
                }
                prev = lum;
            }
            return { strong, maxDelta };
        }

        const W = g.canvas.width, H = g.canvas.height;
        const ZOOM = 2.5;

        // Legacy-model reference: rasterize at 1× and bitmap-upscale,
        // exactly what CSS `transform: scale(2.5)` showed players.
        const Z = window.__neonZoom;
        Z.scale = 1; Z.tx = 0; Z.ty = 0;
        g._mapLayerKey = null;
        g.draw();
        const base = document.createElement('canvas');
        base.width = W; base.height = H;
        base.getContext('2d').drawImage(g.canvas, 0, 0);
        const blurry = document.createElement('canvas');
        blurry.width = W; blurry.height = H;
        const bctx = blurry.getContext('2d');
        bctx.imageSmoothingEnabled = true;
        bctx.drawImage(base, 0, 0, W * ZOOM, H * ZOOM);

        // Real pipeline at 2.5× (same world region: tx = ty = 0).
        Z.scale = ZOOM; Z.tx = 0; Z.ty = 0;
        g._mapLayerKey = null;
        g.draw();

        // Aggregate over several scanlines so a single quiet row can't
        // skew the verdict.
        let crisp = { strong: 0, maxDelta: 0 }, blur = { strong: 0, maxDelta: 0 };
        for (const fy of [0.3, 0.45, 0.6, 0.75]) {
            const y = Math.floor(H * fy);
            const c = edgeStats(g.ctx.getImageData(0, y, W, 1), W);
            const b = edgeStats(bctx.getImageData(0, y, W, 1), W);
            crisp.strong += c.strong; blur.strong += b.strong;
            crisp.maxDelta = Math.max(crisp.maxDelta, c.maxDelta);
            blur.maxDelta  = Math.max(blur.maxDelta,  b.maxDelta);
        }

        Z.scale = 1; Z.tx = 0; Z.ty = 0;
        g._mapLayerKey = null;
        return { crisp, blur };
    });
    ok('zoomed frame renders content (strong edges found on scanlines)',
        sharp.crisp.strong > 5, JSON.stringify(sharp));
    ok('vector zoom keeps more strong edges than the legacy bitmap upscale',
        sharp.crisp.strong > sharp.blur.strong * 1.25,
        JSON.stringify(sharp));
    ok('vector zoom keeps higher peak edge contrast than the bitmap upscale',
        sharp.crisp.maxDelta > sharp.blur.maxDelta * 1.15,
        JSON.stringify(sharp));

    // ── 2) Zoomed + panned tap lands on the right world tile ───────────
    const tap = await page.evaluate(() => {
        const canvas = document.getElementById('game-canvas');
        const Z = window.__neonZoom;
        Z.scale = 2; Z.tx = -120; Z.ty = -80;
        window.game.draw();
        const r = canvas.getBoundingClientRect();
        const px = r.left + r.width * 0.4;
        const py = r.top  + r.height * 0.45;
        canvas.dispatchEvent(new PointerEvent('pointermove', {
            bubbles: true, clientX: px, clientY: py,
        }));
        const logicalW = window.COLS * window.TILE_SIZE;
        const logicalH = window.ROWS * window.TILE_SIZE;
        // Field is drawn centred in the full-container canvas (offset
        // FIELD_OFF*, size FIELD_CSS_*) — mirror that in the expected mapping.
        const fieldW = window.FIELD_CSS_W, fieldH = window.FIELD_CSS_H;
        const offX = window.FIELD_OFFX_CSS, offY = window.FIELD_OFFY_CSS;
        const wantX = ((px - r.left - offX - Z.tx) / Z.scale) * (logicalW / fieldW);
        const wantY = ((py - r.top  - offY - Z.ty) / Z.scale) * (logicalH / fieldH);
        const got = { x: mousePos.x, y: mousePos.y };
        const wantCol = Math.floor(wantX / window.TILE_SIZE);
        const wantRow = Math.floor(wantY / window.TILE_SIZE);
        const gotCol  = Math.floor(got.x / window.TILE_SIZE);
        const gotRow  = Math.floor(got.y / window.TILE_SIZE);
        Z.scale = 1; Z.tx = 0; Z.ty = 0;
        return { wantCol, wantRow, gotCol, gotRow };
    });
    ok('zoomed+panned pointer maps to the expected world tile',
        tap.gotCol === tap.wantCol && tap.gotRow === tap.wantRow,
        JSON.stringify(tap));

    // ── 3) Map-layer cache stability ───────────────────────────────────
    const cache = await page.evaluate(() => {
        const g = window.game;
        g.draw();
        const key1 = g._mapLayerKey;
        // Spy on map.draw to count actual re-rasterizations.
        let rasterCalls = 0;
        const origDraw = g.map.draw.bind(g.map);
        g.map.draw = (c) => { rasterCalls++; return origDraw(c); };
        for (let i = 0; i < 30; i++) g.draw();
        const steadyCalls = rasterCalls;
        window.__neonZoom.scale = 3; window.__neonZoom.tx = -50; window.__neonZoom.ty = -50;
        g.draw(); g.draw(); g.draw();
        const afterZoomCalls = rasterCalls;
        g.map.draw = origDraw;
        window.__neonZoom.scale = 1; window.__neonZoom.tx = 0; window.__neonZoom.ty = 0;
        return { key1: String(key1), steadyCalls, zoomCalls: afterZoomCalls - steadyCalls };
    });
    ok('steady-state frames never re-rasterize the map (cache holds)',
        cache.steadyCalls === 0, JSON.stringify(cache));
    ok('a zoom change re-rasterizes the map exactly once',
        cache.zoomCalls === 1, JSON.stringify(cache));

    // ── 4) Mid-gesture pan must never show unrendered patches ──────────
    // User report: holding + dragging while zoomed exposed blank areas.
    // Cause: the stale map raster only covers the OLD viewport; warping
    // it leaves holes where new world scrolls in. The fix falls back to
    // direct vector drawing for frames the stale layer can't cover.
    const gesture = await page.evaluate(() => {
        const g = window.game;
        const Z = window.__neonZoom;
        // Settle at zoom 2 panned to the far corner, cache rasterizes.
        Z.scale = 2; Z.tx = -300; Z.ty = -200;
        window.__neonZoomGesture = false;
        g.draw();
        // Now drag back toward origin DURING a gesture — this scrolls
        // world regions into view that the cached raster never held.
        window.__neonZoomGesture = true;
        Z.tx = -20; Z.ty = -10;
        g.draw();
        // Sample a grid of points across the full viewport; every one
        // must be painted (alpha 255 — the map tiles every pixel).
        let holes = 0;
        const W = g.canvas.width, H = g.canvas.height;
        for (const fx of [0.05, 0.3, 0.6, 0.95]) {
            for (const fy of [0.05, 0.4, 0.95]) {
                const px = g.ctx.getImageData(Math.floor(W * fx), Math.floor(H * fy), 1, 1).data;
                if (px[3] !== 255) holes++;
            }
        }
        window.__neonZoomGesture = false;
        Z.scale = 1; Z.tx = 0; Z.ty = 0;
        g._mapLayerKey = null;
        g.draw();
        return { holes };
    });
    ok('mid-gesture pan leaves no unrendered patches', gesture.holes === 0,
        JSON.stringify(gesture));

    // ── 5) Entity sprite cache: populated, bounded, scale-keyed ────────
    const sprites = await page.evaluate(() => {
        const g = window.game;
        // A handful of representative entities.
        g.towers.push(new Tower(2, 2, 'basic'), new Tower(3, 2, 'sniper'), new Tower(4, 2, 'silo'));
        const P = g.map.path;
        for (const t of ['normal', 'fast', 'tank', 'air']) {
            const e = new Enemy(P, t, 1);
            e.x = P[1].x * window.TILE_SIZE; e.y = P[1].y * window.TILE_SIZE;
            g.enemies.push(e);
        }
        g.draw();
        const count1 = window.__neonSpriteCacheSize();
        for (let i = 0; i < 20; i++) g.draw();
        const count2 = window.__neonSpriteCacheSize();
        return { count1, count2 };
    });
    ok('entity sprites cached after first draw', sprites.count1 > 0, JSON.stringify(sprites));
    ok('sprite cache is stable across frames (no churn/growth)',
        sprites.count2 === sprites.count1, JSON.stringify(sprites));

    // ── 6) Moving enemies blit SUB-PIXEL so motion is smooth ──
    // Enemy sprites used to be SNAPPED to whole device pixels (to avoid
    // sub-pixel resampling "shimmer"), but that made slow movers hop
    // pixel-to-pixel — the reported jitter/vibration. drawEnemy now passes
    // smooth=true to blitSprite, so two positions a fraction of a device
    // pixel apart render DIFFERENTLY: proof the placement tracks sub-pixel
    // motion instead of quantising it. (Static sprites — towers — keep the
    // crisp snap; see blitSprite.)
    const snap = await page.evaluate(() => {
        const g = window.game;
        g.state = 'paused';
        g.towers.length = 0; g.projectiles.length = 0; g.particles.length = 0;
        g.enemies.length = 0;
        const P = g.map.path;
        const e = new Enemy(P, 'normal', 1);
        g.enemies.push(e);
        const T = window.__neonRenderT;
        // Two logical x positions ~0.4 device px apart, both rounding to the
        // SAME device pixel — snapping would render them identically.
        const base = Math.floor(T.a * 200 + T.ox) + 0.3;
        const x1 = (base - T.ox) / T.a;
        const x2 = (base + 0.4 - T.ox) / T.a;
        e.y = 200;
        e.x = x1; g.draw();
        const W = g.canvas.width, H = g.canvas.height;
        const f1 = g.ctx.getImageData(0, 0, W, H).data;
        e.x = x2; g.draw();
        const f2 = g.ctx.getImageData(0, 0, W, H).data;
        // The HP bar is LIVE vector and antialiases at sub-pixel positions;
        // exclude its rows so we measure only the body/glow sprite.
        const barTop    = Math.floor(T.a * (200 - e.radius - 10) + T.oy);
        const barBottom = Math.ceil(T.a * (200 - e.radius - 2) + T.oy);
        let diff = 0;
        for (let i = 0; i < f1.length; i++) {
            if (f1[i] !== f2[i]) {
                const row = Math.floor((i >> 2) / W);
                if (row < barTop || row > barBottom) diff++;
            }
        }
        g.enemies.length = 0;
        return { diff, snapped: typeof T === 'object' };
    });
    ok('render transform published for blits', snap.snapped === true);
    ok('moving enemies blit sub-pixel (smooth motion, not pixel-snapped)',
        snap.diff > 0, `diff=${snap.diff}`);

    ok('no JS errors', errs.length === 0, errs.join(' / '));

    await browser.close();
    server.kill();
    console.log(`\nRENDER ZOOM E2E: ${pass} pass, ${fail} fail`);
    process.exit(fail === 0 ? 0 : 1);
})().catch(e => { console.error(e); process.exit(1); });
