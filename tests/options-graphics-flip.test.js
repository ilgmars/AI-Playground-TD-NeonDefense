// OPTIONS: "Crisp graphics" supersamples the canvas backing, and "Auto-flip
// orientation" rotates the view 180° when the device is upside-down with the
// pointer mapping negated so placing/aiming stays correct.
const { chromium } = require('playwright');
const { spawn } = require('child_process');
const path = require('path');

(async () => {
    const PORT = 9620 + Math.floor(Math.random() * 60);
    const server = spawn(process.execPath, ['tests/helpers/http-server.js', String(PORT)],
        { cwd: path.join(__dirname, '..'), stdio: 'ignore' });
    await new Promise(r => setTimeout(r, 600));
    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage({ viewport: { width: 900, height: 700 } });
    const errs = [];
    page.on('pageerror', e => errs.push(e.message));
    let pass = 0, fail = 0;
    function ok(n, c, x) { if (c) { console.log('ok', n); pass++; } else { console.log('FAIL', n, x === undefined ? '' : JSON.stringify(x)); fail++; } }

    await page.goto(`http://127.0.0.1:${PORT}/index.html`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(700);

    // 1) Crisp graphics supersamples → larger canvas backing.
    const gfx = await page.evaluate(() => {
        localStorage.setItem('neonHiQuality', '0'); resizeCanvas();
        const w0 = document.getElementById('game-canvas').width;
        localStorage.setItem('neonHiQuality', '1'); resizeCanvas();
        const w1 = document.getElementById('game-canvas').width;
        localStorage.setItem('neonHiQuality', '0'); resizeCanvas();
        return { w0, w1 };
    });
    ok('crisp graphics raises the canvas backing resolution', gfx.w1 > gfx.w0, gfx);

    // 2) Auto-flip applies a 180° rotation only when ENABLED and the device is
    //    in a secondary (upside-down) orientation.
    const flip = await page.evaluate(() => {
        try { Object.defineProperty(screen, 'orientation', { configurable: true, value: { type: 'landscape-secondary', addEventListener() {} } }); } catch (_) {}
        const c = document.getElementById('game-canvas');
        localStorage.setItem('neonAutoFlip', '1'); applyAutoFlip();
        const on = !!window.__neonFlip180 && c.classList.contains('flip-180');
        localStorage.setItem('neonAutoFlip', '0'); applyAutoFlip();
        const offWhenDisabled = !!window.__neonFlip180 || c.classList.contains('flip-180');
        localStorage.setItem('neonAutoFlip', '1'); applyAutoFlip();   // leave enabled for step 3
        return { on, offWhenDisabled };
    });
    ok('auto-flip rotates 180° in a secondary (upside-down) orientation', flip.on, flip);
    ok('auto-flip disabled → no rotation even when upside-down', flip.offWhenDisabled === false, flip);

    // 3) Under the 180° flip, the pointer maps to the NEGATED point (around the
    //    canvas centre) so taps still land where the player intends.
    const remap = await page.evaluate(() => {
        const c = document.getElementById('game-canvas');
        const r = c.getBoundingClientRect();
        const logicalW = window.COLS * window.TILE_SIZE, logicalH = window.ROWS * window.TILE_SIZE;
        const X = r.left + r.width * 0.25, Y = r.top + r.height * 0.25;
        const move = () => { c.dispatchEvent(new MouseEvent('pointermove', { clientX: X, clientY: Y, bubbles: true })); return { x: mousePos.x, y: mousePos.y }; };
        window.__neonFlip180 = false; const p1 = move();
        window.__neonFlip180 = true;  const p2 = move();
        window.__neonFlip180 = false;
        return { p1, p2, logicalW, logicalH };
    });
    ok('180° flip negates the pointer mapping around the centre',
        Math.abs(remap.p2.x - (remap.logicalW - remap.p1.x)) < 2 &&
        Math.abs(remap.p2.y - (remap.logicalH - remap.p1.y)) < 2, remap);

    ok('no JS errors', errs.length === 0, errs.join(' / '));

    await browser.close();
    server.kill();
    console.log(`\nOPTIONS GFX/FLIP: ${pass} pass, ${fail} fail`);
    process.exit(fail === 0 ? 0 : 1);
})().catch(e => { console.error(e); process.exit(1); });
