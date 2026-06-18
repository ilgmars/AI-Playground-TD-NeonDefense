// Regression: pinch + 2-finger pan zoom the canvas through the RENDER
// TRANSFORM (Game.draw reads window.__neonZoom), NOT through a CSS
// `transform` on #game-canvas. CSS-scaling stretches the rasterized
// bitmap — blurry at any zoom > 1 — while the render transform
// re-rasterizes every vector path at the zoomed resolution, so the
// field stays crisp at any zoom on any screen. The canvas element must
// therefore never carry a style.transform, and the input pipeline
// (getCanvasPos) must invert the zoom explicitly.
//
// We can't reliably synthesize multi-touch sequences through
// Playwright on every platform, so the test drives the pinch via
// the touch-handler event API directly.
const { chromium } = require('playwright');
const { spawn } = require('child_process');
const path = require('path');

(async () => {
    const PORT = 8781;
    const server = spawn(process.execPath, ['tests/helpers/http-server.js', String(PORT)],
        { cwd: path.join(__dirname, '..'), stdio: 'ignore' });
    await new Promise(r => setTimeout(r, 600));
    const browser = await chromium.launch({ headless: true });
    const ctx = await browser.newContext({
        viewport: { width: 390, height: 844 },
        hasTouch: true, isMobile: true,
    });
    const page = await ctx.newPage();
    const errs = [];
    page.on('pageerror', e => errs.push(e.message));
    await page.goto(`http://127.0.0.1:${PORT}/index.html`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(700);
    await page.evaluate(() => { localStorage.setItem('neonPlayerName', 'PINCH'); });

    let pass = 0, fail = 0;
    function ok(name, cond, extra) {
        if (cond) { console.log('ok', name); pass++; }
        else      { console.log('FAIL', name, extra || ''); fail++; }
    }

    await page.click('#menu-start-btn'); await page.waitForTimeout(200);
    await page.click('#start-btn');     await page.waitForTimeout(700);

    // Shared in-page touch helpers.
    await page.evaluate(() => {
        const canvas = document.getElementById('game-canvas');
        window.__t = {
            makeTouch(id, x, y) {
                return new Touch({
                    identifier: id, target: canvas,
                    clientX: x, clientY: y, pageX: x, pageY: y,
                    screenX: x, screenY: y, radiusX: 1, radiusY: 1,
                    rotationAngle: 0, force: 1,
                });
            },
            fire(name, touches) {
                canvas.dispatchEvent(new TouchEvent(name, {
                    bubbles: true, cancelable: true,
                    touches, targetTouches: touches, changedTouches: touches,
                }));
            },
            centre() {
                const r = canvas.getBoundingClientRect();
                return { cx: r.left + r.width / 2, cy: r.top + r.height / 2, r };
            },
        };
    });

    // ── 1) Initial state: zoom is 1×, no element transform ─────────────
    const initial = await page.evaluate(() => ({
        scale: window.__neonZoom.scale,
        tx: window.__neonZoom.tx,
        ty: window.__neonZoom.ty,
        transform: document.getElementById('game-canvas').style.transform,
    }));
    ok('initial scale = 1', initial.scale === 1);
    ok('initial tx = 0',    initial.tx === 0);
    ok('initial ty = 0',    initial.ty === 0);
    ok('initial: no CSS transform on the canvas', initial.transform === '');

    // ── 2) Two-finger pinch OUT (zoom in) ──────────────────────────────
    const afterZoom = await page.evaluate(() => {
        const { makeTouch, fire, centre } = window.__t;
        const { cx, cy } = centre();
        fire('touchstart', [makeTouch(1, cx - 20, cy), makeTouch(2, cx + 20, cy)]);
        fire('touchmove',  [makeTouch(1, cx - 40, cy), makeTouch(2, cx + 40, cy)]);
        // One explicit draw so the render transform reflects the pinch.
        window.game.draw();
        const t = window.game.ctx.getTransform();
        return {
            scale: window.__neonZoom.scale,
            transform: document.getElementById('game-canvas').style.transform,
            gesture: window.__neonZoomGesture,
            ctxScale: t.a,
            renderScale: window.RENDER_SCALE,
        };
    });
    ok('pinch out increases scale beyond 1', afterZoom.scale > 1.5);
    ok('zoom does NOT touch the element style (vector-crisp render path)',
        afterZoom.transform === '', afterZoom.transform);
    ok('render transform = RENDER_SCALE × zoom (re-rasterizes at zoom res)',
        Math.abs(afterZoom.ctxScale - afterZoom.renderScale * afterZoom.scale) < 1e-6,
        `ctx.a=${afterZoom.ctxScale} expected=${afterZoom.renderScale * afterZoom.scale}`);
    ok('gesture flag set while fingers are down', afterZoom.gesture === true);

    // ── 3) Input mapping inverts the zoom: a pointer at client (px,py)
    // must land on the logical coordinate ((px-rect.left-tx)/s)·scaleX.
    const mapping = await page.evaluate(() => {
        const canvas = document.getElementById('game-canvas');
        const r = canvas.getBoundingClientRect();
        const Z = window.__neonZoom;
        const px = r.left + r.width * 0.5, py = r.top + r.height * 0.5;
        canvas.dispatchEvent(new PointerEvent('pointermove', {
            bubbles: true, clientX: px, clientY: py,
        }));
        const logicalW = window.COLS * window.TILE_SIZE;
        const logicalH = window.ROWS * window.TILE_SIZE;
        // The canvas fills the container; the field is drawn centred inside it
        // (offset FIELD_OFF*, size FIELD_CSS_*). Invert that too.
        const fieldW = window.FIELD_CSS_W, fieldH = window.FIELD_CSS_H;
        const offX = window.FIELD_OFFX_CSS, offY = window.FIELD_OFFY_CSS;
        const ex = ((px - r.left - offX - Z.tx) / Z.scale) * (logicalW / fieldW);
        const ey = ((py - r.top  - offY - Z.ty) / Z.scale) * (logicalH / fieldH);
        return { gotX: mousePos.x, gotY: mousePos.y, ex, ey };
    });
    ok('getCanvasPos inverts the zoom transform',
        Math.abs(mapping.gotX - mapping.ex) < 0.5 && Math.abs(mapping.gotY - mapping.ey) < 0.5,
        JSON.stringify(mapping));

    // ── 4) Two-finger pan: same distance, shifted centroid ─────────────
    const beforePan = await page.evaluate(() => window.__neonZoom.tx);
    const afterPan = await page.evaluate(() => {
        const { makeTouch, fire, centre } = window.__t;
        const { cx, cy } = centre();
        fire('touchmove', [makeTouch(1, cx - 40 - 50, cy), makeTouch(2, cx + 40 - 50, cy)]);
        return window.__neonZoom.tx;
    });
    ok('two-finger pan changes tx', afterPan !== beforePan);

    // ── 5) Pinch IN (zoom out) clamps at ZOOM_MIN = 1 ──────────────────
    const afterClamp = await page.evaluate(() => {
        const { makeTouch, fire, centre } = window.__t;
        const { cx, cy } = centre();
        fire('touchmove', [makeTouch(1, cx - 2, cy), makeTouch(2, cx + 2, cy)]);
        return window.__neonZoom.scale;
    });
    ok('pinch in clamps at minimum 1× (never below natural size)',
        afterClamp >= 1);

    // ── 6) touchend releases pinch, clears gesture flag, and the next
    // draw re-rasterizes the map layer at the settled transform.
    const released = await page.evaluate(() => {
        const { fire } = window.__t;
        fire('touchend', []);
        window.game.draw();
        const Z = window.__neonZoom;
        const RS = window.RENDER_SCALE;
        const key = String(window.game._mapLayerKey || '');
        return {
            cooldown: typeof window.__neonPinchCooldownUntil === 'number' &&
                       window.__neonPinchCooldownUntil > Date.now(),
            gesture: window.__neonZoomGesture,
            // The cached layer's key embeds the transform it was
            // rasterized under — after release it must match the live one.
            keyMatchesLiveTransform: key.indexOf('|' + (RS * Z.scale) + '|') !== -1,
        };
    });
    ok('pinch cooldown is set on release (suppresses ghost taps)',
        released.cooldown === true);
    ok('gesture flag cleared on release', released.gesture === false);
    ok('map layer re-rasterized at the settled zoom (crisp at rest)',
        released.keyMatchesLiveTransform === true);

    // ── 7) Reset hook restores 1× ──────────────────────────────────────
    const afterReset = await page.evaluate(() => {
        window.__neonResetZoom();
        return {
            scale: window.__neonZoom.scale,
            tx: window.__neonZoom.tx,
            ty: window.__neonZoom.ty,
            transform: document.getElementById('game-canvas').style.transform,
        };
    });
    ok('reset returns scale to 1', afterReset.scale === 1);
    ok('reset zeroes tx',          afterReset.tx === 0);
    ok('reset zeroes ty',          afterReset.ty === 0);
    ok('canvas style stays transform-free after reset', afterReset.transform === '');

    ok('no JS errors', errs.length === 0, errs.join(' / '));

    await browser.close();
    server.kill();
    console.log(`\nCANVAS PINCH ZOOM: ${pass} pass, ${fail} fail`);
    process.exit(fail === 0 ? 0 : 1);
})().catch(e => { console.error(e); process.exit(1); });
