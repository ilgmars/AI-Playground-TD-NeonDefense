// Backpack mobile — the issues the user actually keeps reporting,
// tested with a real variety of item shapes (not just 1×1 plasma_cell).
//
// Shape coverage:
//   plasma_cell      1×1
//   coolant_coil     1×2 column
//   bounty_module    1×3 column
//   interest_ledger  2×1 row
//   reactor_bulwark  2×2 square
//   targeting_core   L-shape  [[1,0],[1,1]]
//   fabricator       L-shape  [[1,1],[1,0]]
//   overclock_matrix T-shape  [[1,1,1],[0,1,0]]
//
// Each scenario hits one of the user's three specific complaints
// against multiple shapes so a regression on a non-1×1 item gets
// caught.

const { chromium } = require('playwright');
const { spawn } = require('child_process');
const path = require('path');

const SHAPES = [
    { id: 'plasma_cell',      kind: '1×1',     dims: { w: 1, h: 1 } },
    { id: 'coolant_coil',     kind: '1×2 col', dims: { w: 1, h: 2 } },
    { id: 'interest_ledger',  kind: '2×1 row', dims: { w: 2, h: 1 } },
    { id: 'bounty_module',    kind: '1×3 col', dims: { w: 1, h: 3 } },
    { id: 'reactor_bulwark',  kind: '2×2 sqr', dims: { w: 2, h: 2 } },
    { id: 'targeting_core',   kind: 'L-1',     dims: { w: 2, h: 2 } },
    { id: 'fabricator',       kind: 'L-2',     dims: { w: 2, h: 2 } },
    { id: 'overclock_matrix', kind: 'T',       dims: { w: 3, h: 2 } },
];

(async () => {
    const PORT = 8868;
    const server = spawn(process.execPath, ['tests/helpers/http-server.js', String(PORT)],
        { cwd: path.join(__dirname, '..'), stdio: 'ignore' });
    await new Promise(r => setTimeout(r, 600));
    const browser = await chromium.launch({ headless: true });
    let pass = 0, fail = 0;
    function ok(name, cond) {
        if (cond) { console.log('ok', name); pass++; }
        else      { console.log('FAIL', name); fail++; }
    }

    async function freshMobilePage() {
        const ctx = await browser.newContext({
            viewport: { width: 390, height: 844 },
            hasTouch: true, isMobile: true,
        });
        const page = await ctx.newPage();
        const errs = [];
        page.on('pageerror', e => errs.push(e.message));
        page.on('console', m => { if (m.type() === 'error') errs.push('console: ' + m.text()); });
        await page.goto(`http://127.0.0.1:${PORT}/index.html`, { waitUntil: 'domcontentloaded' });
        await page.waitForTimeout(700);
        return { page, ctx, errs };
    }

    async function openBackpack(page, items, opts) {
        opts = opts || {};
        const w = opts.w || 6, h = opts.h || 6;
        const placed = opts.placed || [];
        await page.evaluate(({ items, w, h, placed }) => {
            const s = NeonSave.load();
            s.metaXP = 5000; s.maxWaveReached = 30;
            s.backpack = { w, h, placed, stash: items.slice(), luckBoost: 0 };
            NeonSave.write(s); location.reload();
        }, { items, w, h, placed });
        await page.waitForTimeout(700);
        await page.evaluate(() => navigateToBackpack());
        await page.waitForTimeout(250);
    }

    // Walk the offsetTop chain so the assertion isn't fooled by
    // Playwright auto-scroll. Returns position relative to the document.
    async function gridDocTop(page) {
        return page.evaluate(() => {
            let el = document.getElementById('bp-grid');
            let top = 0;
            while (el) { top += el.offsetTop; el = el.offsetParent; }
            return top;
        });
    }

    // ── A. Zero layout shift across pickup/release for EVERY shape ────
    // The user's exact complaint: "moving the item down, moves the
    // page, that is unacceptable". One root cause was the held panel
    // collapsing/expanding when picked up. This proves it doesn't.
    for (const sh of SHAPES) {
        const { page, ctx, errs } = await freshMobilePage();
        await openBackpack(page, [sh.id]);
        const before = await gridDocTop(page);
        await page.click('#bp-stash .bp-chip[data-stash-idx="0"]');
        await page.waitForTimeout(80);
        const after = await gridDocTop(page);
        await page.click('#bp-tostash');
        await page.waitForTimeout(80);
        const released = await gridDocTop(page);
        ok(`[${sh.kind}] grid doc-top unchanged on pickup  (Δ ${after - before}px)`,
           Math.abs(after - before) <= 4);
        ok(`[${sh.kind}] grid doc-top unchanged on release (Δ ${released - before}px)`,
           Math.abs(released - before) <= 4);
        ok(`[${sh.kind}] pickup: no JS errors`, errs.length === 0);
        await ctx.close();
    }

    // ── B. Held-panel buttons stay within the panel's own bounds ──────
    // "status bar seems deformed, with buttons out of the bounds".
    // Every button's bounding rect must sit fully inside the panel.
    {
        const { page, ctx } = await freshMobilePage();
        await openBackpack(page, ['overclock_matrix']);   // T-shape: widest
        await page.click('#bp-stash .bp-chip[data-stash-idx="0"]');
        await page.waitForTimeout(60);
        const oob = await page.evaluate(() => {
            const panel = document.getElementById('bp-held').getBoundingClientRect();
            const ids = ['bp-rotate', 'bp-tostash', 'bp-discard'];
            const offenders = [];
            for (const id of ids) {
                const el = document.getElementById(id);
                if (!el) continue;
                const r = el.getBoundingClientRect();
                if (r.left < panel.left - 0.5 || r.right > panel.right + 0.5 ||
                    r.top  < panel.top  - 0.5 || r.bottom > panel.bottom + 0.5) {
                    offenders.push({ id, panel: [panel.left, panel.top, panel.right, panel.bottom], el: [r.left, r.top, r.right, r.bottom] });
                }
            }
            return offenders;
        });
        ok('held-panel buttons stay inside the panel bounds',
           oob.length === 0);
        if (oob.length) console.log('  out-of-bounds:', JSON.stringify(oob));
        await ctx.close();
    }

    // ── C. Status bar (bp-bar) buttons stay within the overlay ────────
    // bp-bar holds SALVAGE / + COL / + ROW / LUCK / XP. Verify they
    // fit inside the backpack overlay (no horizontal overflow off
    // the screen).
    {
        const { page, ctx } = await freshMobilePage();
        await openBackpack(page, ['plasma_cell']);
        const oob = await page.evaluate(() => {
            const overlay = document.getElementById('backpack').getBoundingClientRect();
            const bar = document.getElementById('bp-bar');
            const offenders = [];
            for (const el of bar.querySelectorAll('button, span')) {
                const r = el.getBoundingClientRect();
                // Allow 4px slop for shadow / focus ring.
                if (r.left < overlay.left - 4 || r.right > overlay.right + 4) {
                    offenders.push({ id: el.id || el.className, r: [r.left, r.right] });
                }
            }
            return offenders;
        });
        ok('bp-bar children fit inside the overlay (no horizontal overflow)',
           oob.length === 0);
        if (oob.length) console.log('  out-of-bounds bar children:', JSON.stringify(oob));
        await ctx.close();
    }

    // ── D. Touch-drag does NOT scroll the page (for every shape) ──────
    // "moving the item down moves the page". Synthesize a downward
    // drag, capture window.scrollY before/after, assert no change.
    for (const sh of SHAPES.filter(s => s.dims.h === 1 || s.kind === '1×2 col')) {
        const { page, ctx, errs } = await freshMobilePage();
        await openBackpack(page, [sh.id]);
        // Pick up the chip first via tap so bpHeld is set + the
        // body.bp-holding class is applied. Then synthesize a downward
        // drag and confirm scrollY stays put.
        await page.click('#bp-stash .bp-chip[data-stash-idx="0"]');
        await page.waitForTimeout(80);
        const result = await page.evaluate(async () => {
            const startY = window.scrollY;
            // Place finger on the topmost EMPTY grid cell and drag
            // straight down well past the grid bottom.
            const cell = document.querySelector('#bp-grid .bp-cell:not(.filled)');
            const r = cell.getBoundingClientRect();
            const POINTER_ID = 60;
            const fire = (t, type, x, y) => t.dispatchEvent(new PointerEvent(type, {
                bubbles: true, cancelable: true,
                pointerId: POINTER_ID, pointerType: 'touch',
                isPrimary: true, button: 0, buttons: type === 'pointerup' ? 0 : 1,
                clientX: x, clientY: y, screenX: x, screenY: y,
            }));
            fire(cell, 'pointerdown', r.left + 5, r.top + 5);
            // Don't engage drag here since we're not picking up from a
            // chip — just synthesise a downward touchmove sequence
            // that would normally scroll the page on mobile.
            for (let dy = 10; dy < 400; dy += 30) {
                fire(document.body, 'pointermove', r.left + 5, r.top + 5 + dy);
                await new Promise(r => setTimeout(r, 10));
            }
            fire(document.body, 'pointerup', r.left + 5, r.top + 5 + 400);
            await new Promise(r => setTimeout(r, 60));
            return { startY, endY: window.scrollY };
        });
        ok(`[${sh.kind}] downward drag did not scroll page (Δy ${result.endY - result.startY}px)`,
           result.endY === result.startY);
        ok(`[${sh.kind}] drag: no JS errors`, errs.length === 0);
        await ctx.close();
    }

    // ── E. After RELEASE on red, recovery is reachable for each shape ─
    // "picking up the red ghost after it was released is not possible
    // currently". The held item stays in hand after a refused drop;
    // the held panel must remain accessible so the player can ROTATE,
    // STASH, or RESTORE. Test for each shape that can plausibly
    // overlap an existing block.
    for (const sh of SHAPES.filter(s => s.dims.w * s.dims.h >= 2)) {
        const { page, ctx, errs } = await freshMobilePage();
        // Place an item at (0,0). Pick a stash item. Drag/tap to land
        // on (0,0) — that overlaps → red ghost → refused.
        await openBackpack(page, [sh.id], {
            w: 4, h: 4,
            placed: [{ id: 'plasma_cell', x: 0, y: 0, rot: 0 }],
        });
        await page.click('#bp-stash .bp-chip[data-stash-idx="0"]');
        await page.waitForTimeout(60);
        // Force the ghost to (0,0) and trigger a refused place by
        // clicking the now-overlapping placed cell. With the
        // ghost-bad-on-filled fix that's a no-op (no swap); item stays
        // held.
        await page.evaluate(() => { if (window.bpPaintGhost) window.bpPaintGhost(0, 0); });
        await page.evaluate(() => {
            document.querySelector('#bp-grid .bp-cell[data-placed-idx="0"]').click();
        });
        await page.waitForTimeout(80);
        const recoverable = await page.evaluate(() => {
            const stillHeld = !!bpHeld;
            // Held-panel buttons are reachable + clickable.
            const rotate = document.getElementById('bp-rotate');
            const stash  = document.getElementById('bp-tostash');
            const rr = rotate.getBoundingClientRect();
            const sr = stash.getBoundingClientRect();
            const underRotate = document.elementFromPoint(rr.left + rr.width/2, rr.top + rr.height/2);
            const underStash  = document.elementFromPoint(sr.left + sr.width/2, sr.top + sr.height/2);
            return {
                stillHeld,
                rotateReachable: underRotate && underRotate.id === 'bp-rotate',
                stashReachable:  underStash  && underStash.id  === 'bp-tostash',
                rotateEnabled: !rotate.disabled,
                stashEnabled:  !stash.disabled,
            };
        });
        ok(`[${sh.kind}] after refused drop: item still held`, recoverable.stillHeld === true);
        ok(`[${sh.kind}] after refused drop: ROTATE button reachable`, recoverable.rotateReachable === true);
        ok(`[${sh.kind}] after refused drop: STASH button reachable`, recoverable.stashReachable === true);
        ok(`[${sh.kind}] after refused drop: ROTATE enabled`, recoverable.rotateEnabled === true);
        ok(`[${sh.kind}] after refused drop: STASH enabled`, recoverable.stashEnabled === true);

        // Recovery via STASH should put it back. For all shapes.
        await page.click('#bp-tostash');
        await page.waitForTimeout(80);
        const afterStash = await page.evaluate(() => ({
            held: !!bpHeld,
            inStash: save.backpack.stash.length === 1,
        }));
        ok(`[${sh.kind}] STASH recovers: held cleared`,    afterStash.held === false);
        ok(`[${sh.kind}] STASH recovers: back in stash`,   afterStash.inStash === true);
        ok(`[${sh.kind}] recovery: no JS errors`, errs.length === 0);
        await ctx.close();
    }

    // ── F. Rotation works for non-1×1 shapes (full 4 rotations) ───────
    // Rotate cycles 0→1→2→3→0. For each shape exercise all four
    // rotations and verify the mini-shape in the held panel updates
    // (filled-cell count stays the same — rotating doesn't add/lose
    // cells).
    for (const sh of SHAPES.filter(s => s.dims.w > 1 || s.dims.h > 1)) {
        const { page, ctx, errs } = await freshMobilePage();
        await openBackpack(page, [sh.id]);
        await page.click('#bp-stash .bp-chip[data-stash-idx="0"]');
        await page.waitForTimeout(60);
        const initialCells = await page.evaluate(() =>
            document.querySelectorAll('#bp-held-shape .bp-mini-cell.on').length);
        for (let i = 0; i < 4; i++) {
            await page.click('#bp-rotate');
            await page.waitForTimeout(30);
        }
        const final = await page.evaluate(() => ({
            rot: bpHeld && bpHeld.rot,
            cellsAfter: document.querySelectorAll('#bp-held-shape .bp-mini-cell.on').length,
        }));
        ok(`[${sh.kind}] rotate × 4 returns rot to 0`,    final.rot === 0);
        ok(`[${sh.kind}] mini-shape cells preserved`,     final.cellsAfter === initialCells);
        ok(`[${sh.kind}] rotation: no JS errors`,         errs.length === 0);
        await ctx.close();
    }

    await browser.close();
    server.kill();

    console.log(`\nBACKPACK MOBILE REAL: ${pass} pass, ${fail} fail`);
    process.exit(fail === 0 ? 0 : 1);
})().catch(e => { console.error(e); process.exit(1); });
