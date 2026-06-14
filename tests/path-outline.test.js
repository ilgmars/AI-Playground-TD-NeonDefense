// Feature: a super-thin, gently-pulsing neon outline traces the road
// corridor to improve readability (user: "the path needs yellow, slightly
// neony pulsating neon outline … super thin neon tube"). Near death it
// ramps as a warning: ≤6 health → orange, ≤3 → red, otherwise yellow. It is
// drawn EACH FRAME (not in the cached map layer) so it can pulse + recolour,
// and it recomputes its geometry when the map revision changes — so the
// path-digging boss's re-routes are outlined too.
const { chromium } = require('playwright');
const { spawn } = require('child_process');
const path = require('path');

(async () => {
    const PORT = 9790 + Math.floor(Math.random() * 30);
    const server = spawn(process.execPath, ['tests/helpers/http-server.js', String(PORT)],
        { cwd: path.join(__dirname, '..'), stdio: 'ignore' });
    await new Promise(r => setTimeout(r, 600));
    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    const errs = [];
    page.on('pageerror', e => errs.push(e.message));

    let pass = 0, fail = 0;
    function ok(name, cond, extra) {
        if (cond) { console.log('ok', name); pass++; }
        else      { console.log('FAIL', name, extra || ''); fail++; }
    }

    await page.goto(`http://127.0.0.1:${PORT}/index.html`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(700);
    await page.evaluate(() => localStorage.setItem('neonPlayerName', 'PATH'));
    // Start a real run so a real GameMap with a path exists.
    await page.click('#menu-start-btn'); await page.waitForTimeout(200);
    await page.click('#start-btn');      await page.waitForTimeout(700);

    const ready = await page.evaluate(() => !!(window.game && window.game.map && window.game.map.grid));
    ok('a run is running with a real map', ready);

    // 1) Health → colour thresholds (the near-death ramp).
    const colors = await page.evaluate(() => {
        const g = window.game;
        const at = (h) => { g.health = h; return g._pathOutlineColor().core.toLowerCase(); };
        return { hi: at(20), six: at(6), seven: at(7), three: at(3), one: at(1) };
    });
    ok('healthy path outline is yellow',        colors.hi === '#ffe23b', JSON.stringify(colors));
    ok('>6 health stays yellow',                colors.seven === '#ffe23b', colors.seven);
    ok('≤6 health turns orange',                colors.six === '#ff9e2c', colors.six);
    ok('≤3 health turns red',                   colors.three === '#ff3b3b' && colors.one === '#ff3b3b',
        JSON.stringify(colors));

    // 2) The outline traces the road edge and strokes a glow + a thin core.
    const drawn = await page.evaluate(() => {
        const g = window.game;
        g.health = 20;
        g._pathOutlineKey = null;                 // force a fresh segment build
        const segs = g._pathOutlineSegments();
        const ctx = g.ctx;
        const strokes = [];
        const dashes = [];
        let moveCount = 0;
        const oStroke = ctx.stroke.bind(ctx);
        const oMove = ctx.moveTo.bind(ctx);
        const oDash = ctx.setLineDash.bind(ctx);
        ctx.moveTo = (...a) => { moveCount++; return oMove(...a); };
        ctx.stroke = () => { strokes.push({ color: String(ctx.strokeStyle), width: ctx.lineWidth, alpha: ctx.globalAlpha, dashed: ctx.getLineDash().length > 0, offset: ctx.lineDashOffset }); return oStroke(); };
        ctx.setLineDash = (a) => { if (a && a.length) dashes.push(a.slice()); return oDash(a); };
        // Two frames apart so the shimmer's dash offset is observably animated.
        // (Captured at stroke time — ctx.restore() resets lineDashOffset.)
        g._animClock = 0;    g._drawPathOutline(ctx);
        g._animClock = 1000; g._drawPathOutline(ctx);
        ctx.stroke = oStroke; ctx.moveTo = oMove; ctx.setLineDash = oDash;
        const dashedStrokes = strokes.filter(s => s.dashed).length;
        return {
            segCount: segs.length,
            moveCount,                                // both calls: 2×segs (outline only — no centerline pass)
            strokeCount: strokes.length,
            hasThinCore: strokes.some(s => s.width <= 1),
            coreColor: (strokes.find(s => s.width <= 1) || {}).color,
            dashedStrokes,                            // the removed centerline "shimmer" was the only dashed pass
        };
    });
    ok('outline produces road-edge segments', drawn.segCount > 4, JSON.stringify(drawn));
    ok('every edge segment is traced (outline only, no centerline pass)',
        drawn.moveCount === 2 * drawn.segCount, JSON.stringify(drawn));
    ok('outline draws its glow + core passes', drawn.strokeCount >= 2, JSON.stringify(drawn));
    ok('core tube is super thin (lineWidth ≤ 1)', drawn.hasThinCore, JSON.stringify(drawn));
    ok('thin core uses the yellow colour at full health',
        (drawn.coreColor || '').toLowerCase() === '#ffe23b', drawn.coreColor);
    // The moving centerline "shimmer" was removed by request — outline only.
    ok('no animated centerline / shimmer pass (removed)', drawn.dashedStrokes === 0, JSON.stringify(drawn));

    // 3) Boss re-route: bumping map._rev (what digReroute does) must rebuild
    //    the outline geometry so the new road is outlined.
    const reroute = await page.evaluate(() => {
        const g = window.game;
        const before = g._pathOutlineSegments().length;
        // Carve an extra road tile onto a buildable cell and bump the rev,
        // exactly the shape of a digger commit.
        const grid = g.map.grid;
        let placed = false;
        for (let r = 0; r < grid.length && !placed; r++) {
            for (let c = 0; c < grid[0].length && !placed; c++) {
                if (grid[r][c] === 0) { grid[r][c] = 1; placed = true; }
            }
        }
        g.map._rev = (g.map._rev || 0) + 1;
        const after = g._pathOutlineSegments().length;
        return { before, after, placed };
    });
    ok('outline recomputes after a map-revision (boss re-route) change',
        reroute.placed && reroute.after !== reroute.before, JSON.stringify(reroute));

    // 4) The outline is actually wired into the per-frame draw (not dead code).
    const wired = await page.evaluate(() => {
        const g = window.game;
        let called = 0;
        const orig = g._drawPathOutline.bind(g);
        g._drawPathOutline = (ctx) => { called++; return orig(ctx); };
        g.draw();
        g._drawPathOutline = orig;
        return called;
    });
    ok('draw() invokes the path outline every frame', wired === 1, String(wired));

    ok('no JS errors', errs.length === 0, errs.join(' / '));

    await browser.close();
    server.kill();
    console.log(`\nPATH OUTLINE: ${pass} pass, ${fail} fail`);
    process.exit(fail === 0 ? 0 : 1);
})().catch(e => { console.error(e); process.exit(1); });
