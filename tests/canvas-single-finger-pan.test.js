// Regression: single-finger drag pans the canvas WHEN ZOOMED IN.
// At base zoom (scale === 1) the canvas already fits, so single-
// finger touches still resolve as taps (place / select). After a
// pinch zooms in, a one-finger drag scrolls the field.
//
// Threshold: PAN_THRESHOLD_PX = 12. A jitter shorter than that does
// NOT activate pan — the touchend still fires as a tap so the player
// can place a tower precisely.
const { chromium } = require('playwright');
const { spawn } = require('child_process');
const path = require('path');

(async () => {
    const PORT = 8784;
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
    await page.evaluate(() => { localStorage.setItem('neonPlayerName', 'PAN'); });

    let pass = 0, fail = 0;
    function ok(name, cond, extra) {
        if (cond) { console.log('ok', name); pass++; }
        else      { console.log('FAIL', name, extra || ''); fail++; }
    }

    await page.click('#menu-start-btn'); await page.waitForTimeout(200);
    await page.click('#start-btn');     await page.waitForTimeout(700);

    // Helper: synthesise a touch sequence on the canvas.
    async function touchSeq(events) {
        return page.evaluate((events) => {
            const canvas = document.getElementById('game-canvas');
            function makeTouch(id, x, y) {
                return new Touch({
                    identifier: id, target: canvas,
                    clientX: x, clientY: y, pageX: x, pageY: y,
                    screenX: x, screenY: y, radiusX: 1, radiusY: 1,
                    rotationAngle: 0, force: 1,
                });
            }
            for (const ev of events) {
                const touches = (ev.touches || []).map((t, i) => makeTouch(i + 1, t[0], t[1]));
                const tev = new TouchEvent(ev.type, {
                    bubbles: true, cancelable: true,
                    touches, targetTouches: touches, changedTouches: touches,
                });
                canvas.dispatchEvent(tev);
            }
        }, events);
    }

    // ── 1) At scale=1, a single-finger drag does NOT pan ──────────────
    // (Pan is gated on zoom > 1 so taps at base zoom still place
    //  towers / select.) tx and ty should remain 0.
    await page.evaluate(() => window.__neonResetZoom());
    await touchSeq([
        { type: 'touchstart', touches: [[100, 200]] },
        { type: 'touchmove',  touches: [[200, 250]] },
        { type: 'touchmove',  touches: [[300, 300]] },
        { type: 'touchend',   touches: [] },
    ]);
    const noPanAtBase = await page.evaluate(() => ({
        tx: window.__neonZoom.tx, ty: window.__neonZoom.ty, scale: window.__neonZoom.scale,
    }));
    ok('at scale=1, single-finger drag does NOT change tx', noPanAtBase.tx === 0);
    ok('at scale=1, single-finger drag does NOT change ty', noPanAtBase.ty === 0);

    // ── 2) Pinch to zoom IN, then single-finger drag DOES pan ─────────
    // Zoom to ~2× around centre of canvas.
    await page.evaluate(() => {
        const canvas = document.getElementById('game-canvas');
        const r = canvas.getBoundingClientRect();
        const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
        function mk(id, x, y) {
            return new Touch({ identifier: id, target: canvas, clientX: x, clientY: y,
                pageX: x, pageY: y, screenX: x, screenY: y,
                radiusX: 1, radiusY: 1, rotationAngle: 0, force: 1 });
        }
        function fire(type, touches) {
            canvas.dispatchEvent(new TouchEvent(type, {
                bubbles: true, cancelable: true,
                touches, targetTouches: touches, changedTouches: touches,
            }));
        }
        fire('touchstart', [mk(1, cx - 20, cy), mk(2, cx + 20, cy)]);
        fire('touchmove',  [mk(1, cx - 40, cy), mk(2, cx + 40, cy)]);
        fire('touchend',   []);
    });
    const zoomed = await page.evaluate(() => window.__neonZoom.scale);
    ok('pinch raised scale > 1 (precondition for pan test)', zoomed > 1);

    const txBefore = await page.evaluate(() => window.__neonZoom.tx);
    // Drag right ~80 px with a SINGLE finger.
    await touchSeq([
        { type: 'touchstart', touches: [[150, 300]] },
        { type: 'touchmove',  touches: [[170, 300]] },   // < threshold
        { type: 'touchmove',  touches: [[230, 300]] },   // past threshold → activates
        { type: 'touchmove',  touches: [[300, 300]] },
        { type: 'touchend',   touches: [] },
    ]);
    const txAfter = await page.evaluate(() => window.__neonZoom.tx);
    ok('single-finger drag at scale>1 changes tx',  txAfter !== txBefore);

    // ── 3) Tiny jitter (< 12 px) does NOT activate pan ────────────────
    const txBeforeTap = await page.evaluate(() => window.__neonZoom.tx);
    await touchSeq([
        { type: 'touchstart', touches: [[200, 300]] },
        { type: 'touchmove',  touches: [[204, 302]] },   // 4.5 px — well under 12
        { type: 'touchmove',  touches: [[207, 304]] },   // ~8 px
        { type: 'touchend',   touches: [] },
    ]);
    const txAfterTap = await page.evaluate(() => window.__neonZoom.tx);
    ok('jitter under PAN_THRESHOLD does NOT pan', txAfterTap === txBeforeTap);

    // ── 4) Pan cooldown is set after an active pan ────────────────────
    // (so the lifting finger doesn't fire pointerdown / place a tower)
    const cooldown = await page.evaluate(() =>
        window.__neonPinchCooldownUntil > Date.now() - 500);
    ok('pan release sets the pinch-cooldown flag', cooldown === true);

    // ── 5) Pan is clamped (can't shove canvas completely off-screen) ──
    // Reset zoom, zoom back in, then try to drag canvas WAY to the
    // right. tx should clamp to 0 (can't pan when there's no room).
    await page.evaluate(() => window.__neonResetZoom());
    await page.evaluate(() => {
        const canvas = document.getElementById('game-canvas');
        const r = canvas.getBoundingClientRect();
        const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
        function mk(id, x, y) {
            return new Touch({ identifier: id, target: canvas, clientX: x, clientY: y,
                pageX: x, pageY: y, screenX: x, screenY: y,
                radiusX: 1, radiusY: 1, rotationAngle: 0, force: 1 });
        }
        function fire(type, touches) {
            canvas.dispatchEvent(new TouchEvent(type, {
                bubbles: true, cancelable: true,
                touches, targetTouches: touches, changedTouches: touches,
            }));
        }
        // Zoom heavy (~3x).
        fire('touchstart', [mk(1, cx - 10, cy), mk(2, cx + 10, cy)]);
        fire('touchmove',  [mk(1, cx - 30, cy), mk(2, cx + 30, cy)]);
        fire('touchend',   []);
    });
    await touchSeq([
        { type: 'touchstart', touches: [[100, 300]] },
        { type: 'touchmove',  touches: [[300, 300]] },
        { type: 'touchmove',  touches: [[800, 300]] },  // huge rightward drag
        { type: 'touchend',   touches: [] },
    ]);
    const clamped = await page.evaluate(() => window.__neonZoom.tx);
    ok('pan clamps so tx never goes positive (canvas stays in view)',
        clamped <= 0);

    ok('no JS errors', errs.length === 0, errs.join(' / '));

    await browser.close();
    server.kill();
    console.log(`\nCANVAS SINGLE-FINGER PAN: ${pass} pass, ${fail} fail`);
    process.exit(fail === 0 ? 0 : 1);
})().catch(e => { console.error(e); process.exit(1); });
