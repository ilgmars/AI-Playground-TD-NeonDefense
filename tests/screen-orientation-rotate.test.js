// Feature: the "Screen orientation" option rotates the whole game view 90°
// (portrait ⇄ landscape), independent of the board shape. Touch/pointer input
// is un-rotated so towers still place where you tap.
//
// Proven by an input invariant that needs no exact pixel math:
//   • rotation OFF → a horizontal screen move changes the logical X coord.
//   • rotation ON (90°) → the SAME horizontal screen move changes the logical
//     Y coord instead (the field is turned a quarter-turn).
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
    await ctx.addInitScript(() => { window.__neonAegisDev = true; });
    const page = await ctx.newPage();
    const errs = [];
    page.on('pageerror', e => errs.push(e.message));

    let pass = 0, fail = 0;
    const ok = (n, c, x) => { if (c) { console.log('ok', n); pass++; } else { console.log('FAIL', n, x || ''); fail++; } };

    await page.goto(`http://127.0.0.1:${PORT}/index.html`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(700);
    await page.evaluate(() => {
        localStorage.setItem('neonPlayerName', 'ROT');
        localStorage.setItem('neonScreenRotate', '0');
        localStorage.setItem('neonAutoFlip', '0');   // isolate the 90° rotation
    });
    await page.click('#menu-start-btn'); await page.waitForTimeout(200);
    await page.click('#start-btn');     await page.waitForTimeout(700);

    // Move the pointer to a canvas-relative fraction of its bounding box and
    // read the resulting logical mousePos.
    const probe = (fx, fy) => page.evaluate(({ fx, fy }) => {
        const c = document.getElementById('game-canvas');
        const r = c.getBoundingClientRect();
        c.dispatchEvent(new PointerEvent('pointermove',
            { clientX: r.left + r.width * fx, clientY: r.top + r.height * fy, bubbles: true }));
        return { x: mousePos.x, y: mousePos.y };
    }, { fx, fy });

    // ── rotation OFF: horizontal screen move → horizontal logical ─────────
    const offC = await probe(0.5, 0.5);
    const offR = await probe(0.75, 0.5);
    const offDx = Math.abs(offR.x - offC.x), offDy = Math.abs(offR.y - offC.y);
    ok('rotation off: horizontal screen move maps to logical X', offDx > offDy * 3 && offDx > 5,
        JSON.stringify({ offC, offR }));

    // ── rotation ON (90°) ─────────────────────────────────────────────────
    const rot = await page.evaluate(() => {
        localStorage.setItem('neonScreenRotate', '1');
        applyScreenRotation();
        const c = document.getElementById('game-canvas');
        return { transform: c.style.transform, deg: canvasRotationDeg() };
    });
    await page.waitForTimeout(150);
    ok('rotation on: canvas is rotate(90deg)', /rotate\(90deg\)/.test(rot.transform) && rot.deg === 90, JSON.stringify(rot));

    const onC = await probe(0.5, 0.5);
    const onR = await probe(0.75, 0.5);
    const onDx = Math.abs(onR.x - onC.x), onDy = Math.abs(onR.y - onC.y);
    ok('rotation on: horizontal screen move maps to logical Y (view turned 90°)',
        onDy > onDx * 3 && onDy > 5, JSON.stringify({ onC, onR }));
    ok('rotated mapping is finite and on-field', isFinite(onR.x) && isFinite(onR.y) && onR.x >= -40 && onR.y >= -40,
        JSON.stringify(onR));
    // Centre maps to ~field centre regardless of rotation (rotation is about it).
    ok('canvas centre still maps to field centre when rotated',
        Math.abs(onC.x - offC.x) < 30 && Math.abs(onC.y - offC.y) < 30, JSON.stringify({ offC, onC }));

    ok('no JS errors', errs.length === 0, errs.join(' / '));
    await browser.close();
    server.kill();
    console.log(`\nSCREEN ORIENTATION ROTATE: ${pass} pass, ${fail} fail`);
    process.exit(fail === 0 ? 0 : 1);
})().catch(e => { console.error(e); process.exit(1); });
