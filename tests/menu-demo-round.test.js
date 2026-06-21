// Regression: the main-menu demo tower must render ROUND, not oval, across
// resolutions (incl. uncommon ones) AND after a layout-driven box change.
//
// Oval = the canvas backing store fell out of sync with its CSS box, so the
// browser stretches it non-uniformly. The demo draws with a uniform transform
// (setTransform(dpr,dpr)), so roundness ⇔ the device-pixel scale is uniform on
// both axes: backing.w / cssBox.w ≈ backing.h / cssBox.h. We assert that.
//
// The "layout-driven box change" case (changing the canvas box WITHOUT a window
// resize — logo image load, button reflow, mobile address-bar) is the one that
// only ResizeObserver catches; a plain window 'resize' listener misses it and
// leaves the stale, stretched backing store. That case fails without the fix.

const { chromium } = require('playwright');
const { spawn } = require('child_process');
const path = require('path');

const RES = [
    [1920, 1080], [1366, 768], [1024, 600], [2560, 1080], [3440, 1440], // wide / common
    [360, 640], [412, 915], [768, 1024],                                // mobile / tablet
    [731, 413], [1023, 769], [600, 600], [280, 653], [1001, 1000],      // uncommon / odd / off-by-one
];
const DPRS = [1, 2, 3];
const TOL = 0.01; // 1% — rounding is sub-pixel; a stretched (stale) box is far over this

let pass = 0, fail = 0;
function ok(name, cond) {
    if (cond) { console.log('ok', name); pass++; }
    else { console.log('FAIL', name); fail++; }
}

function measure(page) {
    return page.evaluate(() => {
        const c = document.getElementById('menu-demo');
        const r = c.getBoundingClientRect();
        return { bw: c.width, bh: c.height, cw: r.width, ch: r.height };
    });
}
function roundOK(m) {
    if (m.cw < 1 || m.ch < 1) return false;          // hidden / unmeasured
    const sx = m.bw / m.cw, sy = m.bh / m.ch;
    return Math.abs(sx - sy) / Math.max(sx, sy) <= TOL;
}

(async () => {
    const PORT = 9300 + Math.floor(Math.random() * 90);
    const server = spawn(process.execPath, ['tests/helpers/http-server.js', String(PORT)],
        { cwd: path.join(__dirname, '..'), stdio: 'ignore' });
    await new Promise(r => setTimeout(r, 700));
    const browser = await chromium.launch({ headless: true });
    const url = `http://localhost:${PORT}/index.html`;
    try {
        for (const dpr of DPRS) {
            const ctx = await browser.newContext({
                deviceScaleFactor: dpr, viewport: { width: 1280, height: 800 },
                reducedMotion: 'no-preference',
            });
            const page = await ctx.newPage();
            await page.goto(url, { waitUntil: 'load' });
            await page.waitForFunction(
                () => { const c = document.getElementById('menu-demo'); return c && c.getBoundingClientRect().width > 1; },
                { timeout: 5000 });
            for (const [w, h] of RES) {
                if (dpr >= 3 && w * h > 1600 * 1000) continue;   // skip giant backing stores at dpr3
                await page.setViewportSize({ width: w, height: h });
                await page.waitForTimeout(120);                  // window 'resize' + RO + layout settle
                ok(`round @ ${w}x${h} dpr${dpr}`, roundOK(await measure(page)));
            }
            await ctx.close();
        }

        // Regression: a LAYOUT-driven box change with NO window resize must re-sync.
        const ctx = await browser.newContext({
            deviceScaleFactor: 2, viewport: { width: 900, height: 900 }, reducedMotion: 'no-preference',
        });
        const page = await ctx.newPage();
        await page.goto(url, { waitUntil: 'load' });
        await page.waitForFunction(
            () => { const c = document.getElementById('menu-demo'); return c && c.getBoundingClientRect().width > 1; },
            { timeout: 5000 });
        ok('round initially', roundOK(await measure(page)));
        // shrink the canvas box from the top (inset:0 means style.height is ignored,
        // but top wins) — a pure layout change, no window 'resize' fires.
        await page.evaluate(() => { document.getElementById('menu-demo').style.top = '40%'; });
        await page.waitForTimeout(180);
        ok('round after layout-driven box change (ResizeObserver re-syncs)', roundOK(await measure(page)));
        await ctx.close();
    } finally {
        await browser.close();
        try { server.kill(); } catch (_) { /* ignore */ }
    }
    console.log(`${pass} passed, ${fail} failed`);
    process.exit(fail ? 1 : 0);
})().catch(e => { console.log('ERROR', e && e.message); process.exit(1); });
