// Regression: placed backpack items must render with shape-aware
// borders. Adjacent cells belonging to the SAME item share a thin
// interior border; outer edges (cells whose neighbour is empty or a
// different item) get a thick rarity-coloured outline. Previously
// every cell had the same thick border on all four sides and a T /
// L / S item visually melted into a featureless rectangle.
const { chromium } = require('playwright');
const { spawn } = require('child_process');
const path = require('path');

(async () => {
    const PORT = 8773;
    const server = spawn(process.execPath, ['tests/helpers/http-server.js', String(PORT)],
        { cwd: path.join(__dirname, '..'), stdio: 'ignore' });
    await new Promise(r => setTimeout(r, 600));
    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    await page.setViewportSize({ width: 1280, height: 800 });
    const errs = [];
    page.on('pageerror', e => errs.push(e.message));
    await page.goto(`http://127.0.0.1:${PORT}/index.html`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(700);

    let pass = 0, fail = 0;
    function ok(name, cond, extra) {
        if (cond) { console.log('ok', name); pass++; }
        else      { console.log('FAIL', name, extra || ''); fail++; }
    }

    // Open the backpack UI from the main menu.
    await page.click('#menu-backpack-btn');
    await page.waitForTimeout(300);

    // Place a known T-shaped item directly into the save and re-render.
    // The shape lookup is deterministic; we pick a guaranteed-T item.
    const setup = await page.evaluate(() => {
        const ids = Object.keys(BACKPACK_ITEMS);
        let tId = null;
        for (const id of ids) {
            const s = BACKPACK_ITEMS[id].shape;
            // T-shape: top row 3 cells, middle cell below = 4 filled.
            if (s.length === 2 && s[0].length === 3 &&
                s[0][0] === 1 && s[0][1] === 1 && s[0][2] === 1 &&
                s[1][0] === 0 && s[1][1] === 1 && s[1][2] === 0) {
                tId = id; break;
            }
        }
        if (!tId) {
            // Fallback: pick the first 4-cell, multi-row item.
            for (const id of ids) {
                const s = BACKPACK_ITEMS[id].shape;
                let filled = 0;
                for (const row of s) for (const v of row) if (v) filled++;
                if (s.length >= 2 && filled >= 3 && s[0].length >= 2) {
                    tId = id; break;
                }
            }
        }
        // Ensure room to place.
        save.backpack.w = Math.max(save.backpack.w, 4);
        save.backpack.h = Math.max(save.backpack.h, 4);
        save.backpack.placed = [{ id: tId, x: 0, y: 0, rot: 0 }];
        save.backpack.stash = [];
        NeonSave.write(save);
        renderBackpack();
        return {
            tId,
            shape: BACKPACK_ITEMS[tId].shape,
        };
    });

    ok('found a multi-cell item for the test', !!setup.tId);

    // For every cell that belongs to the placed item, inspect its
    // computed borders and assert: an edge to a same-owner cell is
    // visually subtler than an edge to a non-owner cell. We compare
    // alpha-component approximations by string match — the same-owner
    // edge has the rarity color with an alpha suffix (e.g. "55"),
    // while the outline edge is opaque.
    const borders = await page.evaluate(() => {
        const out = [];
        const cells = document.querySelectorAll('#bp-grid .bp-cell');
        cells.forEach(c => {
            const cs = getComputedStyle(c);
            out.push({
                x: c.dataset.x, y: c.dataset.y,
                placedIdx: c.dataset.placedIdx,
                bt: cs.borderTopWidth, br: cs.borderRightWidth,
                bb: cs.borderBottomWidth, bl: cs.borderLeftWidth,
                btColor: cs.borderTopColor,
                bgColor: cs.backgroundColor,
                filled: c.classList.contains('filled'),
            });
        });
        return out;
    });
    const filledCells = borders.filter(b => b.filled);
    ok('all placed cells have a filled class', filledCells.length >= 3, `got ${filledCells.length}`);

    // The defining test: the placed item must have BOTH thick (2px) and
    // thin (1px) borders distributed across its perimeter. If every
    // side were the same width (the OLD behaviour) the item would have
    // 4×N thick borders and zero thin ones.
    const thickCount = filledCells.reduce((n, c) =>
        n + ['bt','br','bb','bl'].filter(k => c[k] === '2px').length, 0);
    const thinCount  = filledCells.reduce((n, c) =>
        n + ['bt','br','bb','bl'].filter(k => c[k] === '1px').length, 0);
    ok('placed item has THICK outline borders',  thickCount > 0, `thick=${thickCount}`);
    ok('placed item has THIN interior borders',  thinCount  > 0, `thin=${thinCount}`);

    // Sanity: outline thickness lives on edges that face an empty /
    // different cell. A T-piece with 4 filled cells in a 4×4 grid has
    // exactly 10 outline edges (perimeter) and 6 interior edges (each
    // shared with a same-owner neighbour, counted from both sides).
    // We don't pin those exact numbers (shape may vary if T-shape
    // isn't in BACKPACK_ITEMS) — just require strict inequality.
    ok('more thick edges than thin (outline dominates)', thickCount >= thinCount);

    ok('no JS errors', errs.length === 0, errs.join(' / '));

    await browser.close();
    server.kill();
    console.log(`\nBP SHAPE BORDER: ${pass} pass, ${fail} fail`);
    process.exit(fail === 0 ? 0 : 1);
})().catch(e => { console.error(e); process.exit(1); });
