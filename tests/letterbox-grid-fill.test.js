// Feature: on phones the board keeps its fixed aspect and letterboxes. The
// dead space is filled with the SAME neon grid the playfield uses, flowing
// out of the field seamlessly — same colour, same cell size, aligned to the
// canvas tiles — WITHOUT changing the field's shape, size, or the path.
//
// Proven behaviourally in a portrait viewport with a landscape board (so it
// letterboxes top/bottom):
//   1. there really are bars (canvas shorter than its container),
//   2. the field is fit-not-stretched: canvas aspect == COLS/ROWS, fills the
//      constrained axis — never scaled to cover or squashed to fill,
//   3. the backdrop is the grass grid (colour #0f172a + grid gradient),
//   4. SEAMLESS: backdrop cell size == the canvas's displayed tile size and
//      the grid is phase-aligned to the canvas edge,
//   5. the fill is cosmetic: stripping the container background leaves the
//      canvas backing + the map path geometry byte-for-byte identical.
const { chromium } = require('playwright');
const { spawn } = require('child_process');
const path = require('path');

(async () => {
    const PORT = 9630 + Math.floor(Math.random() * 60);
    const server = spawn(process.execPath, ['tests/helpers/http-server.js', String(PORT)],
        { cwd: path.join(__dirname, '..'), stdio: 'ignore' });
    await new Promise(r => setTimeout(r, 600));
    const browser = await chromium.launch({ headless: true });
    // Portrait phone + landscape board → guaranteed top/bottom letterbox.
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
    await ctx.addInitScript(() => { window.__neonAegisDev = true; });
    const page = await ctx.newPage();
    const errs = [];
    page.on('pageerror', e => errs.push(e.message));

    let pass = 0, fail = 0;
    const ok = (n, c, x) => { if (c) { console.log('ok', n); pass++; } else { console.log('FAIL', n, x || ''); fail++; } };
    const near = (a, b, tol) => Math.abs(a - b) <= tol;

    await page.goto(`http://127.0.0.1:${PORT}/index.html`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(700);
    await page.evaluate(() => {
        localStorage.setItem('neonPlayerName', 'GRID');
        localStorage.setItem('neonFieldTall', '0');   // landscape board (20×15)
        localStorage.setItem('neonScreenRotate', '0');
    });
    await page.click('#menu-start-btn'); await page.waitForTimeout(200);
    await page.click('#start-btn');     await page.waitForTimeout(800);

    const m = await page.evaluate(() => {
        const canvas = document.getElementById('game-canvas');
        const cont = document.getElementById('game-container');
        const cr = canvas.getBoundingClientRect();
        const kr = cont.getBoundingClientRect();
        const cs = getComputedStyle(cont);
        const parsePair = s => (s || '').split(' ').map(v => parseFloat(v));
        return {
            COLS: window.COLS, ROWS: window.ROWS, TILE: window.TILE_SIZE,
            canvasW: cr.width, canvasH: cr.height,
            contW: kr.width, contH: kr.height,
            offX: cr.left - kr.left, offY: cr.top - kr.top,
            bgColor: cs.backgroundColor,
            bgImage: cs.backgroundImage,
            bgSize: parsePair(cs.backgroundSize),
            bgPos: parsePair(cs.backgroundPosition),
            backW: canvas.width, backH: canvas.height,
        };
    });

    // 1) There is genuinely a letterbox to fill (vertical bars here).
    ok('field letterboxes — there are bars to fill', m.canvasH < m.contH - 4,
        JSON.stringify({ canvasH: m.canvasH, contH: m.contH }));

    // 2) Field is fit, not stretched/cropped: aspect == board aspect, and it
    //    fills the constrained (width) axis exactly.
    const boardAspect = m.COLS / m.ROWS;
    ok('field keeps its shape — canvas aspect == COLS/ROWS', near(m.canvasW / m.canvasH, boardAspect, 0.01),
        JSON.stringify({ aspect: m.canvasW / m.canvasH, boardAspect }));
    ok('field keeps its size — fills the constrained axis (not scaled to cover)', near(m.canvasW, m.contW, 1.5),
        JSON.stringify({ canvasW: m.canvasW, contW: m.contW }));

    // 3) Backdrop is the grass grid, not flat black.
    ok('bars painted the grass colour (#0f172a = rgb(15,23,42))', m.bgColor === 'rgb(15, 23, 42)', m.bgColor);
    ok('bars carry the grid (two linear-gradients)',
        (m.bgImage.match(/linear-gradient/g) || []).length >= 2, m.bgImage);

    // 4) SEAMLESS: backdrop cell == displayed canvas tile, phase-aligned.
    const cell = m.canvasW / m.COLS;                 // displayed tile size (CSS px)
    ok('grid cell matches the field tile size (no scale jump)',
        near(m.bgSize[0], cell, 0.5) && near(m.bgSize[1], cell, 0.5),
        JSON.stringify({ bgSize: m.bgSize, cell }));
    const wrap = (v, n) => ((v % n) + n) % n;
    ok('grid is phase-aligned to the canvas edge (lines continue across the seam)',
        near(wrap(m.bgPos[0] - wrap(m.offX, cell), cell), 0, 0.5) &&
        near(wrap(m.bgPos[1] - wrap(m.offY, cell), cell), 0, 0.5),
        JSON.stringify({ bgPos: m.bgPos, offX: m.offX, offY: m.offY, cell }));

    // 4b) SEAMLESS UNDER ZOOM: pinch-zoom is a render transform inside the
    //     canvas (window.__neonZoom), so the backdrop must scale + pan with it
    //     or the bars stop matching the field the moment you zoom.
    const zoom = await page.evaluate(() => {
        const canvas = document.getElementById('game-canvas');
        const cont = document.getElementById('game-container');
        // Mutate the live zoom object (keeps the input closure's ref intact).
        window.__neonZoom.scale = 2; window.__neonZoom.tx = -37; window.__neonZoom.ty = -24;
        updateLetterboxGrid();
        const cs = getComputedStyle(cont);
        const parsePair = s => (s || '').split(' ').map(parseFloat);
        const cr = canvas.getBoundingClientRect(), kr = cont.getBoundingClientRect();
        return {
            cssW: parseFloat(canvas.style.width), COLS: window.COLS,
            offX: cr.left - kr.left, offY: cr.top - kr.top,
            bgSize: parsePair(cs.backgroundSize), bgPos: parsePair(cs.backgroundPosition),
            tx: window.__neonZoom.tx, ty: window.__neonZoom.ty, scale: window.__neonZoom.scale,
        };
    });
    const zCell = (zoom.cssW / zoom.COLS) * zoom.scale;
    ok('zoom: backdrop cell scales with the field (baseCell × zoom)', near(zoom.bgSize[0], zCell, 0.5),
        JSON.stringify({ bgSize: zoom.bgSize, zCell }));
    ok('zoom: backdrop stays phase-aligned with the panned+zoomed field',
        near(wrap(zoom.bgPos[0] - wrap(zoom.offX + zoom.tx, zCell), zCell), 0, 0.5) &&
        near(wrap(zoom.bgPos[1] - wrap(zoom.offY + zoom.ty, zCell), zCell), 0, 0.5),
        JSON.stringify({ bgPos: zoom.bgPos, offX: zoom.offX, offY: zoom.offY, tx: zoom.tx, ty: zoom.ty, zCell }));
    // Reset zoom so the cosmetic-strip check below runs at the base view.
    await page.evaluate(() => { window.__neonZoom.scale = 1; window.__neonZoom.tx = 0; window.__neonZoom.ty = 0; });

    // 5) The fill is purely cosmetic — removing the container background must
    //    not change the canvas backing or the map path (same shape & size).
    const stable = await page.evaluate(() => {
        const canvas = document.getElementById('game-canvas');
        const cont = document.getElementById('game-container');
        const before = {
            backW: canvas.width, backH: canvas.height,
            cssW: canvas.style.width, cssH: canvas.style.height,
            pathLen: game.map.path.length,
            first: game.map.path[0], last: game.map.path[game.map.path.length - 1],
        };
        cont.style.backgroundImage = 'none';   // strip the fill
        cont.style.backgroundColor = '#000';
        resizeCanvas();                        // re-fit with no backdrop
        const after = {
            backW: canvas.width, backH: canvas.height,
            cssW: canvas.style.width, cssH: canvas.style.height,
            pathLen: game.map.path.length,
            first: game.map.path[0], last: game.map.path[game.map.path.length - 1],
        };
        return { before, after };
    });
    const s = stable;
    ok('canvas backing unchanged by the fill', s.before.backW === s.after.backW && s.before.backH === s.after.backH,
        JSON.stringify(s));
    ok('canvas display size unchanged by the fill', s.before.cssW === s.after.cssW && s.before.cssH === s.after.cssH,
        JSON.stringify(s));
    ok('path geometry (shape + endpoints) unchanged by the fill',
        s.before.pathLen === s.after.pathLen &&
        s.before.first.r === s.after.first.r && s.before.first.c === s.after.first.c &&
        s.before.last.r === s.after.last.r && s.before.last.c === s.after.last.c,
        JSON.stringify(s));

    ok('no JS errors', errs.length === 0, errs.join(' / '));
    await browser.close();
    server.kill();
    console.log(`\nLETTERBOX GRID FILL: ${pass} pass, ${fail} fail`);
    process.exit(fail === 0 ? 0 : 1);
})().catch(e => { console.error(e); process.exit(1); });
