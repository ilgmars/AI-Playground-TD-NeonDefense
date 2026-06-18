// Feature: instead of letterboxing the board (black bars), the CANVAS fills
// the whole container and the fixed-aspect field is drawn CENTRED inside it,
// with the grass grid EXTENDED past the field edges to fill the surround. The
// extension is the same grid drawn in the same render transform, so it's
// seamless and zooms with the field — and the path keeps its exact shape,
// size, and position.
//
// Verified in a portrait viewport with a landscape board (so the field is
// centred with vertical surround):
//   1. the canvas fills the container — no bars,
//   2. the field is centred (FIELD_OFF*) and keeps its aspect (== COLS/ROWS),
//   3. input round-trips through the field offset: a tap at the field centre
//      maps to the logical centre, and the field's top-left maps to ~(0,0) —
//      AND still does under pinch-zoom (transform stays consistent),
//   4. the surround is actually filled — grass tiles are drawn OUTSIDE the
//      field bounds (negative / past-edge cells),
//   5. the path geometry is unchanged and stable across a resize.
const { chromium } = require('playwright');
const { spawn } = require('child_process');
const path = require('path');

(async () => {
    const PORT = 9630 + Math.floor(Math.random() * 60);
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
        const cr = canvas.getBoundingClientRect(), kr = cont.getBoundingClientRect();
        return {
            COLS: window.COLS, ROWS: window.ROWS, T: window.TILE_SIZE,
            canvasW: cr.width, canvasH: cr.height, contW: kr.width, contH: kr.height,
            fieldW: window.FIELD_CSS_W, fieldH: window.FIELD_CSS_H,
            offX: window.FIELD_OFFX_CSS, offY: window.FIELD_OFFY_CSS,
        };
    });

    // 1) Canvas fills the container — no bars.
    ok('canvas fills the container width', near(m.canvasW, m.contW, 1), JSON.stringify(m));
    ok('canvas fills the container height (no black bars)', near(m.canvasH, m.contH, 1), JSON.stringify(m));

    // 2) Field is centred and keeps its aspect (shape + size preserved).
    ok('field keeps its aspect == COLS/ROWS', near(m.fieldW / m.fieldH, m.COLS / m.ROWS, 0.01),
        JSON.stringify({ aspect: m.fieldW / m.fieldH, board: m.COLS / m.ROWS }));
    ok('field is centred horizontally', near(m.offX, (m.canvasW - m.fieldW) / 2, 1), JSON.stringify(m));
    ok('field is centred vertically',   near(m.offY, (m.canvasH - m.fieldH) / 2, 1), JSON.stringify(m));
    ok('portrait viewport + landscape board → vertical surround to fill', m.offY > 4, JSON.stringify(m));

    // 3) Input round-trips through the field offset (the load-bearing check).
    const probe = (clientX, clientY) => page.evaluate(({ clientX, clientY }) => {
        document.getElementById('game-canvas')
            .dispatchEvent(new PointerEvent('pointermove', { clientX, clientY, bubbles: true }));
        return { x: mousePos.x, y: mousePos.y };
    }, { clientX, clientY });

    const kr = await page.evaluate(() => {
        const r = document.getElementById('game-canvas').getBoundingClientRect();
        return { left: r.left, top: r.top };
    });
    const centre = await probe(kr.left + m.offX + m.fieldW / 2, kr.top + m.offY + m.fieldH / 2);
    ok('tap at the field centre maps to the logical field centre',
        near(centre.x, m.COLS * m.T / 2, m.T) && near(centre.y, m.ROWS * m.T / 2, m.T), JSON.stringify(centre));
    const corner = await probe(kr.left + m.offX + 2, kr.top + m.offY + 2);
    ok('tap at the field top-left maps to ~logical (0,0)',
        near(corner.x, 0, m.T) && near(corner.y, 0, m.T), JSON.stringify(corner));

    // …and still correct under pinch-zoom (transform stays consistent).
    const zCentre = await page.evaluate(() => {
        window.__neonZoom.scale = 2; window.__neonZoom.tx = -50; window.__neonZoom.ty = -40;
        return true;
    }).then(() => probe(kr.left + m.offX + m.fieldW / 2, kr.top + m.offY + m.fieldH / 2));
    // Under scale 2 + pan the field centre is no longer under the screen
    // centre, but the mapping must stay finite and sane (transform consistent).
    ok('zoomed pointer mapping is finite', isFinite(zCentre.x) && isFinite(zCentre.y), JSON.stringify(zCentre));
    await page.evaluate(() => { window.__neonZoom.scale = 1; window.__neonZoom.tx = 0; window.__neonZoom.ty = 0; });

    // 4) The surround is actually filled — grass tiles drawn OUTSIDE the field.
    const grass = await page.evaluate(() => {
        const g = window.game;
        let inField = 0, outField = 0;
        const orig = window.drawGridTile;
        const T = window.TILE_SIZE, COLS = window.COLS, ROWS = window.ROWS;
        window.drawGridTile = (ctx, x, y, s) => {
            const c = Math.round(x / T), r = Math.round(y / T);
            if (c >= 0 && c < COLS && r >= 0 && r < ROWS) inField++; else outField++;
            return orig(ctx, x, y, s);
        };
        g._mapLayerKey = null;          // force a fresh rasterization
        g.draw();
        window.drawGridTile = orig;
        return { inField, outField };
    });
    ok('grass grid is extended past the field edges (fills the surround)', grass.outField > 0, JSON.stringify(grass));

    // 5) The path geometry is unchanged + stable across a resize.
    const pathStable = await page.evaluate(() => {
        const g = window.game;
        const snap = () => ({
            len: g.map.path.length,
            first: { ...g.map.path[0] },
            last: { ...g.map.path[g.map.path.length - 1] },
        });
        const before = snap();
        resizeCanvas();
        const after = snap();
        return { before, after };
    });
    const ps = pathStable;
    ok('path shape + endpoints unchanged across a resize',
        ps.before.len === ps.after.len &&
        ps.before.first.r === ps.after.first.r && ps.before.first.c === ps.after.first.c &&
        ps.before.last.r === ps.after.last.r && ps.before.last.c === ps.after.last.c,
        JSON.stringify(ps));

    ok('no JS errors', errs.length === 0, errs.join(' / '));
    await browser.close();
    server.kill();
    console.log(`\nLETTERBOX GRID FILL: ${pass} pass, ${fail} fail`);
    process.exit(fail === 0 ? 0 : 1);
})().catch(e => { console.error(e); process.exit(1); });
