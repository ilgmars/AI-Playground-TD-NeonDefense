// Feature: FIELD orientation (Trello: "rotate field −90°, enemies come
// from above"). TALL boards transpose the grid to 16×24 and the map
// walker runs top→bottom; WIDE (24×16, left→right) stays the default
// and is byte-identical to the pre-feature generator for every seed.
//
// Asserts:
//   1. Default boot is WIDE 24×16, path enters at col 0, exits at the
//      last col — and a FIXED SEED produces the exact same path as the
//      original generator (seed compatibility).
//   2. With the option on, a run is TALL 16×24, the path enters at
//      row 0 (top) and exits at the bottom row; enemies move DOWN.
//   3. The menu button toggles + persists the preference.
//   4. Multiplayer mode forces WIDE even with the option on.
const { chromium } = require('playwright');
const { spawn } = require('child_process');
const path = require('path');

(async () => {
    const PORT = 9460 + Math.floor(Math.random() * 60);
    const server = spawn(process.execPath, ['tests/helpers/http-server.js', String(PORT)],
        { cwd: path.join(__dirname, '..'), stdio: 'ignore' });
    await new Promise(r => setTimeout(r, 600));
    const browser = await chromium.launch({ headless: true });
    const ctx = await browser.newContext({ viewport: { width: 900, height: 1200 } });
    await ctx.addInitScript(() => { window.__neonAegisDev = true; });
    const page = await ctx.newPage();
    const errs = [];
    page.on('pageerror', e => errs.push(e.message));

    let pass = 0, fail = 0;
    function ok(name, cond, extra) {
        if (cond) { console.log('ok', name); pass++; }
        else      { console.log('FAIL', name, extra || ''); fail++; }
    }

    // ── 1) Default: WIDE + seed-compatible ─────────────────────────────
    await page.goto(`http://127.0.0.1:${PORT}/index.html#777`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(700);
    await page.evaluate(() => { localStorage.setItem('neonPlayerName', 'FLD'); });
    await page.click('#menu-start-btn'); await page.waitForTimeout(200);
    await page.click('#start-btn');     await page.waitForTimeout(700);

    const wide = await page.evaluate(() => ({
        cols: window.COLS, rows: window.ROWS,
        first: window.game.map.path[0],
        last:  window.game.map.path[window.game.map.path.length - 1],
        sig:   window.game.map.path.slice(0, 12).map(p => p.c + ',' + p.r).join(';'),
    }));
    ok('default board is WIDE 24×16', wide.cols === 24 && wide.rows === 16,
        JSON.stringify(wide));
    ok('wide path enters at col 0, exits at last col',
        wide.first.c === 0 && wide.last.c === 23, JSON.stringify(wide));
    // Seed 777's wide path opening, captured from the ORIGINAL
    // generator before this feature (verified byte-identical against
    // the pre-feature map.js from git) — must never change.
    ok('seed 777 wide map unchanged (seed compatibility)',
        wide.sig === '0,10;1,10;2,10;2,11;2,12;3,12;4,12;5,12;5,13;5,14;6,14;7,14',
        wide.sig);

    // ── 2) TALL: portrait board, enemies from above ────────────────────
    await page.evaluate(() => { localStorage.setItem('neonFieldTall', '1'); });
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(700);
    await page.click('#menu-start-btn'); await page.waitForTimeout(200);
    await page.click('#start-btn');     await page.waitForTimeout(700);

    const tall = await page.evaluate(() => {
        const g = window.game;
        const P = g.map.path;
        // Spawn one enemy and tick it to verify downward motion.
        const e = new Enemy(P, 'normal', 1);
        const y0 = e.y;
        for (let i = 0; i < 60; i++) e.update();
        return {
            cols: window.COLS, rows: window.ROWS,
            firstRow: P[0].r, lastRow: P[P.length - 1].r,
            gridRows: g.map.grid.length, gridCols: g.map.grid[0].length,
            moved: e.y - y0,
            canvasPortrait: g.canvas.height > g.canvas.width,
        };
    });
    ok('tall board is 16×24', tall.cols === 16 && tall.rows === 24, JSON.stringify(tall));
    ok('tall grid matches dims', tall.gridRows === 24 && tall.gridCols === 16);
    ok('tall path enters at TOP row, exits at bottom row',
        tall.firstRow === 0 && tall.lastRow === 23, JSON.stringify(tall));
    ok('enemies move DOWNWARD on a tall board', tall.moved > 20, tall.moved);
    ok('canvas is portrait for a tall board', tall.canvasPortrait === true);

    // ── 3) Menu toggle + persistence ───────────────────────────────────
    await page.evaluate(() => navigateToMainMenu());
    await page.waitForTimeout(200);
    const label1 = await page.evaluate(() => document.getElementById('menu-field-btn').textContent);
    await page.click('#menu-field-btn');
    const label2 = await page.evaluate(() => ({
        label: document.getElementById('menu-field-btn').textContent,
        stored: localStorage.getItem('neonFieldTall'),
    }));
    ok('field button shows TALL while option is on', /TALL/.test(label1), label1);
    ok('clicking toggles back to WIDE and persists', /WIDE/.test(label2.label) && label2.stored === '0',
        JSON.stringify(label2));

    // ── 4) Multiplayer forces WIDE ─────────────────────────────────────
    const mp = await page.evaluate(() => {
        localStorage.setItem('neonFieldTall', '1');
        window.__neonMPSetMode('coop');          // dev hook (Aegis dev mode on)
        restartGame(12345);
        const dims = { cols: window.COLS, rows: window.ROWS };
        window.__neonMPSetMode(null);
        return dims;
    });
    ok('multiplayer run forces WIDE board despite TALL option',
        mp.cols === 24 && mp.rows === 16, JSON.stringify(mp));

    ok('no JS errors', errs.length === 0, errs.join(' / '));

    await browser.close();
    server.kill();
    console.log(`\nFIELD ORIENTATION: ${pass} pass, ${fail} fail`);
    process.exit(fail === 0 ? 0 : 1);
})().catch(e => { console.error(e); process.exit(1); });
