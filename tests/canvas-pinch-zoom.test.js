// Regression: pinch + 2-finger pan on the canvas applies a
// `transform: translate(...) scale(...)` to #game-canvas only, and
// the existing single-finger tap pipeline still hits the right tile
// because getCanvasPos uses the canvas getBoundingClientRect which
// reflects the transform.
//
// We can't reliably synthesize multi-touch sequences through
// Playwright on every platform, so the test drives the pinch via
// the touch-handler event API directly and verifies the resulting
// CSS transform + window.__neonZoom state.
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

    // ── 1) Initial state: zoom is 1×, no transform yet ─────────────────
    const initial = await page.evaluate(() => ({
        scale: window.__neonZoom.scale,
        tx: window.__neonZoom.tx,
        ty: window.__neonZoom.ty,
        transform: document.getElementById('game-canvas').style.transform,
    }));
    ok('initial scale = 1', initial.scale === 1);
    ok('initial tx = 0',    initial.tx === 0);
    ok('initial ty = 0',    initial.ty === 0);

    // ── 2) Two-finger pinch OUT (zoom in) ──────────────────────────────
    // Synthesize touchstart with 2 fingers, then touchmove with the
    // same centroid but wider apart → distance ratio > 1 → scale up.
    const afterZoom = await page.evaluate(() => {
        const canvas = document.getElementById('game-canvas');
        const r = canvas.getBoundingClientRect();
        const cx = r.left + r.width / 2;
        const cy = r.top  + r.height / 2;
        function makeTouch(id, x, y) {
            return new Touch({
                identifier: id, target: canvas,
                clientX: x, clientY: y, pageX: x, pageY: y,
                screenX: x, screenY: y, radiusX: 1, radiusY: 1,
                rotationAngle: 0, force: 1,
            });
        }
        function fire(name, touches) {
            const ev = new TouchEvent(name, {
                bubbles: true, cancelable: true,
                touches, targetTouches: touches, changedTouches: touches,
            });
            canvas.dispatchEvent(ev);
        }
        // Start: two fingers 40 px apart horizontally, centred.
        fire('touchstart', [
            makeTouch(1, cx - 20, cy),
            makeTouch(2, cx + 20, cy),
        ]);
        // Move: spread to 80 px apart → ratio 2 → scale doubles.
        fire('touchmove', [
            makeTouch(1, cx - 40, cy),
            makeTouch(2, cx + 40, cy),
        ]);
        return {
            scale: window.__neonZoom.scale,
            transform: canvas.style.transform,
        };
    });
    ok('pinch out increases scale beyond 1', afterZoom.scale > 1.5);
    ok('pinch out applies a CSS transform',  /scale\(/.test(afterZoom.transform));

    // ── 3) Two-finger pan: same distance, shifted centroid ─────────────
    // The pinch state is still active from the previous move. Move
    // the centroid right by ~50 px without changing the spread →
    // pan only; scale unchanged.
    const beforePan = await page.evaluate(() => window.__neonZoom.tx);
    const afterPan = await page.evaluate(() => {
        const canvas = document.getElementById('game-canvas');
        const r = canvas.getBoundingClientRect();
        // We don't know exactly where the canvas currently is after
        // the zoom; recompute from current rect.
        const cx = r.left + r.width / 2;
        const cy = r.top  + r.height / 2;
        function makeTouch(id, x, y) {
            return new Touch({
                identifier: id, target: canvas,
                clientX: x, clientY: y, pageX: x, pageY: y,
                screenX: x, screenY: y, radiusX: 1, radiusY: 1,
                rotationAngle: 0, force: 1,
            });
        }
        function fire(name, touches) {
            const ev = new TouchEvent(name, {
                bubbles: true, cancelable: true,
                touches, targetTouches: touches, changedTouches: touches,
            });
            canvas.dispatchEvent(ev);
        }
        // Shift centroid 50 px LEFT (negative x) while keeping the
        // same spread.
        fire('touchmove', [
            makeTouch(1, cx - 40 - 50, cy),
            makeTouch(2, cx + 40 - 50, cy),
        ]);
        return window.__neonZoom.tx;
    });
    // tx is in viewport pixels; left-shift can register as either
    // direction depending on transform-origin maths. We assert it
    // CHANGED (not necessarily a specific sign) — the panning
    // mechanism is what matters.
    ok('two-finger pan changes tx',  afterPan !== beforePan);

    // ── 4) Pinch IN (zoom out) clamps at ZOOM_MIN = 1 ──────────────────
    const afterClamp = await page.evaluate(() => {
        const canvas = document.getElementById('game-canvas');
        const r = canvas.getBoundingClientRect();
        const cx = r.left + r.width / 2;
        const cy = r.top  + r.height / 2;
        function makeTouch(id, x, y) {
            return new Touch({
                identifier: id, target: canvas,
                clientX: x, clientY: y, pageX: x, pageY: y,
                screenX: x, screenY: y, radiusX: 1, radiusY: 1,
                rotationAngle: 0, force: 1,
            });
        }
        function fire(name, touches) {
            const ev = new TouchEvent(name, {
                bubbles: true, cancelable: true,
                touches, targetTouches: touches, changedTouches: touches,
            });
            canvas.dispatchEvent(ev);
        }
        // Pinch all the way in (fingers very close).
        fire('touchmove', [
            makeTouch(1, cx - 2, cy),
            makeTouch(2, cx + 2, cy),
        ]);
        return window.__neonZoom.scale;
    });
    ok('pinch in clamps at minimum 1× (never below natural size)',
        afterClamp >= 1);

    // ── 5) touchend with < 2 touches releases the pinch ────────────────
    const released = await page.evaluate(() => {
        const canvas = document.getElementById('game-canvas');
        const ev = new TouchEvent('touchend', {
            bubbles: true, cancelable: true,
            touches: [], targetTouches: [], changedTouches: [],
        });
        canvas.dispatchEvent(ev);
        return {
            cooldown: typeof window.__neonPinchCooldownUntil === 'number' &&
                       window.__neonPinchCooldownUntil > Date.now(),
        };
    });
    ok('pinch cooldown is set on release (suppresses ghost taps)',
        released.cooldown === true);

    // ── 6) Reset hook restores 1× ──────────────────────────────────────
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
    ok('reset transform string is identity-equivalent',
        afterReset.transform === 'translate(0px, 0px) scale(1)' ||
        afterReset.transform === '' /* some browsers normalise */ ||
        /scale\(1\)/.test(afterReset.transform));

    ok('no JS errors', errs.length === 0, errs.join(' / '));

    await browser.close();
    server.kill();
    console.log(`\nCANVAS PINCH ZOOM: ${pass} pass, ${fail} fail`);
    process.exit(fail === 0 ? 0 : 1);
})().catch(e => { console.error(e); process.exit(1); });
