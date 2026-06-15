// Feature: the "Screen orientation" option (Portrait ⇄ Landscape) locks the
// DEVICE orientation via screen.orientation.lock(), so the OS rotates the WHOLE
// UI natively to match how the player holds the phone. It does NOT rotate the
// canvas or remap input (that approach was rejected — only the field turned,
// leaving black bars). Verified by spying on screen.orientation.lock:
//   • saved '0' (Landscape) → applyScreenRotation() locks 'landscape'.
//   • saved '1' (Portrait)  → applyScreenRotation() locks 'portrait'.
//   • canvas is never rotated by this toggle (canvasRotationDeg stays 0).
const { chromium } = require('playwright');
const { spawn } = require('child_process');
const path = require('path');

(async () => {
    const PORT = 9560 + Math.floor(Math.random() * 60);
    const server = spawn(process.execPath, ['tests/helpers/http-server.js', String(PORT)],
        { cwd: path.join(__dirname, '..'), stdio: 'ignore' });
    await new Promise(r => setTimeout(r, 600));
    const browser = await chromium.launch({ headless: true });
    const ctx = await browser.newContext({ viewport: { width: 900, height: 700 } });
    // Stub screen.orientation.lock so we can observe what the toggle requests
    // regardless of whether the headless browser can actually lock.
    await ctx.addInitScript(() => {
        window.__neonAegisDev = true;
        window.__lockCalls = [];
        try {
            Object.defineProperty(screen, 'orientation', {
                configurable: true,
                value: {
                    type: 'landscape-primary',
                    lock(t) { window.__lockCalls.push(t); return Promise.resolve(); },
                    unlock() {},
                    addEventListener() {}
                }
            });
        } catch (_) {}
    });
    const page = await ctx.newPage();
    const errs = [];
    page.on('pageerror', e => errs.push(e.message));

    let pass = 0, fail = 0;
    const ok = (n, c, x) => { if (c) { console.log('ok', n); pass++; } else { console.log('FAIL', n, x || ''); fail++; } };

    await page.goto(`http://127.0.0.1:${PORT}/index.html`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(700);

    // Landscape (default / saved '0').
    const land = await page.evaluate(() => {
        window.__lockCalls.length = 0;
        localStorage.setItem('neonScreenRotate', '0');
        localStorage.setItem('neonAutoFlip', '0');   // isolate from the 180° flip
        applyScreenRotation();
        return { calls: window.__lockCalls.slice(), deg: canvasRotationDeg(),
                 xform: document.getElementById('game-canvas').style.transform };
    });
    ok('landscape: locks the device to "landscape"', land.calls[land.calls.length - 1] === 'landscape', JSON.stringify(land));
    ok('landscape: toggle does not rotate the canvas', land.deg === 0 && !/rotate/.test(land.xform), JSON.stringify(land));

    // Portrait (saved '1').
    const port = await page.evaluate(() => {
        window.__lockCalls.length = 0;
        localStorage.setItem('neonScreenRotate', '1');
        applyScreenRotation();
        return { calls: window.__lockCalls.slice(), deg: canvasRotationDeg(),
                 xform: document.getElementById('game-canvas').style.transform };
    });
    ok('portrait: locks the device to "portrait"', port.calls[port.calls.length - 1] === 'portrait', JSON.stringify(port));
    ok('portrait: still does not rotate the canvas (whole UI turns, not the field)',
        port.deg === 0 && !/rotate/.test(port.xform), JSON.stringify(port));

    // Robustness: a platform without orientation.lock must not throw.
    const safe = await page.evaluate(() => {
        try {
            Object.defineProperty(screen, 'orientation', { configurable: true, value: undefined });
            applyScreenRotation();
            return 'ok';
        } catch (e) { return String(e); }
    });
    ok('no-op safe when orientation.lock is unavailable', safe === 'ok', safe);

    ok('no JS errors', errs.length === 0, errs.join(' / '));
    await browser.close();
    server.kill();
    console.log(`\nSCREEN ORIENTATION ROTATE: ${pass} pass, ${fail} fail`);
    process.exit(fail === 0 ? 0 : 1);
})().catch(e => { console.error(e); process.exit(1); });
