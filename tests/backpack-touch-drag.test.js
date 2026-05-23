// Backpack drag-to-place (pointer events). The player drags a stash
// chip with a finger; the ghost preview tracks the finger position.
// On release the item is placed at the ghost cell.
const { chromium } = require('playwright');
const { spawn } = require('child_process');
const path = require('path');

(async () => {
    const server = spawn(process.execPath, ['tests/helpers/http-server.js', '8860'],
        { cwd: path.join(__dirname, '..'), stdio: 'ignore' });
    await new Promise(r => setTimeout(r, 600));
    const browser = await chromium.launch({ headless: true });
    let pass = 0, fail = 0;
    function ok(name, cond) { if (cond) { console.log('ok', name); pass++; } else { console.log('FAIL', name); fail++; } }

    async function freshMobilePage() {
        const ctx = await browser.newContext({
            viewport: { width: 390, height: 844 },
            hasTouch: true, isMobile: true,
        });
        const page = await ctx.newPage();
        const errs = [];
        page.on('pageerror', e => errs.push(e.message));
        await page.goto('http://127.0.0.1:8860/index.html', { waitUntil: 'domcontentloaded' });
        await page.waitForTimeout(700);
        return { page, ctx, errs };
    }

    // Synthesises pointerdown → pointermove (past threshold, triggers
    // pickup + renderBackpack) → pointermove (final position, with the
    // target cell re-queried after the held panel pushes the grid
    // down) → pointerup. All events go through document.body because
    // setPointerCapture routes them there.
    async function dispatchPointerDrag(page, sourceSel, targetX, targetY) {
        return await page.evaluate(async ({ sourceSel, targetX, targetY }) => {
            const src = document.querySelector(sourceSel);
            if (!src) return { error: 'no source: ' + sourceSel };
            const r = src.getBoundingClientRect();
            const fromX = r.left + r.width / 2;
            const fromY = r.top  + r.height / 2;
            const POINTER_ID = 7;

            const fire = (target, type, x, y) => {
                target.dispatchEvent(new PointerEvent(type, {
                    bubbles: true, cancelable: true,
                    pointerId: POINTER_ID, pointerType: 'touch',
                    isPrimary: true, button: 0, buttons: type === 'pointerup' ? 0 : 1,
                    clientX: x, clientY: y, screenX: x, screenY: y,
                }));
            };

            fire(src, 'pointerdown', fromX, fromY);
            await new Promise(r => setTimeout(r, 20));
            // Cross drag threshold — triggers bpPickStash → renderBackpack.
            fire(document.body, 'pointermove', fromX + 30, fromY + 30);
            await new Promise(r => setTimeout(r, 40));

            // Re-query target after the held panel pushes the grid.
            const bp = save.backpack;
            const cells = document.querySelectorAll('#bp-grid .bp-cell');
            const targetCell = cells[targetY * bp.w + targetX];
            if (!targetCell) return { error: 'no target cell' };
            const t = targetCell.getBoundingClientRect();
            // Bottom-attach: the item's bottom edge sits at the
            // finger Y; the ghost cell is half a block above. For a
            // 1×1 item that means finger at the bottom edge of the
            // target cell. Use t.bottom - 1 to stay inside the cell
            // after floor rounding.
            const fingerX = t.left + t.width / 2;
            const fingerY = t.bottom - 1;

            fire(document.body, 'pointermove', fingerX, fingerY);
            await new Promise(r => setTimeout(r, 30));
            const ghosted = {
                ok:  targetCell.classList.contains('ghost-ok'),
                bad: targetCell.classList.contains('ghost-bad'),
            };
            fire(document.body, 'pointerup', fingerX, fingerY);
            await new Promise(r => setTimeout(r, 80));
            return { ok: true, ghosted };
        }, { sourceSel, targetX, targetY });
    }

    // ── Scenario 1 — drag a 1×1 stash item onto an empty cell ────────────
    {
        const { page, ctx, errs } = await freshMobilePage();
        await page.evaluate(() => {
            const s = NeonSave.load();
            s.metaXP = 5000; s.maxWaveReached = 25;
            s.backpack = { w: 5, h: 5, placed: [], stash: ['plasma_cell'], luckBoost: 0 };
            NeonSave.write(s); location.reload();
        });
        await page.waitForTimeout(700);
        await page.evaluate(() => navigateToBackpack());
        await page.waitForTimeout(250);

        const drag = await dispatchPointerDrag(page,
            '#bp-stash .bp-chip[data-stash-idx="0"]',
            2, 2);
        ok('drag completed without error',     drag && drag.ok === true);
        ok('mid-drag painted ghost-ok on target', drag && drag.ghosted && drag.ghosted.ok === true);
        await page.waitForTimeout(100);

        const result = await page.evaluate(() => ({
            placed:    save.backpack.placed.slice(),
            stashLen:  save.backpack.stash.length,
            persisted: JSON.parse(localStorage.getItem(NeonSave.KEY)).backpack.placed.length,
        }));
        ok('item moved from stash to placed',          result.placed.length === 1 && result.stashLen === 0);
        ok('placement landed at the dragged-to cell',
           result.placed[0].x === 2 && result.placed[0].y === 2);
        ok('placement persisted to localStorage',      result.persisted === 1);
        ok('no JS errors during drag',                 errs.length === 0);
        await ctx.close();
    }

    // ── Scenario 2 — drag a placed item to a different empty cell ───────
    {
        const { page, ctx } = await freshMobilePage();
        await page.evaluate(() => {
            const s = NeonSave.load();
            s.backpack = { w: 5, h: 5, placed: [{ id: 'plasma_cell', x: 0, y: 0, rot: 0 }], stash: [], luckBoost: 0 };
            NeonSave.write(s); location.reload();
        });
        await page.waitForTimeout(700);
        await page.evaluate(() => navigateToBackpack());
        await page.waitForTimeout(250);

        const drag = await dispatchPointerDrag(page,
            '#bp-grid .bp-cell.filled[data-placed-idx="0"]',
            2, 2);
        ok('placed-item drag completed',   drag && drag.ok === true);
        ok('placed-item drag ghost-ok',    drag && drag.ghosted && drag.ghosted.ok === true);
        await page.waitForTimeout(100);

        const moved = await page.evaluate(() => save.backpack.placed[0]);
        ok('placed item dragged to new cell', moved && moved.x === 2 && moved.y === 2);
        await ctx.close();
    }

    // ── Scenario 3 — bottom-attach for a 1×3 column item ───────────────
    // bounty_module is shape [[1],[1],[1]] (1 wide × 3 tall). Putting
    // the bottom of the item at the finger should place it so the
    // BOTTOM cell is in row 3 (i.e. top-left lands at row 1). If the
    // attach point was wrong (e.g. top-of-item at finger), the item
    // would land at top-left row 3 — off the bottom of a 5-tall grid
    // — and never be placed.
    {
        const { page, ctx } = await freshMobilePage();
        await page.evaluate(() => {
            const s = NeonSave.load();
            s.backpack = { w: 5, h: 5, placed: [], stash: ['bounty_module'], luckBoost: 0 };
            NeonSave.write(s); location.reload();
        });
        await page.waitForTimeout(700);
        await page.evaluate(() => navigateToBackpack());
        await page.waitForTimeout(250);

        const result = await page.evaluate(async () => {
            const chip = document.querySelector('#bp-stash .bp-chip[data-stash-idx="0"]');
            const r = chip.getBoundingClientRect();
            const POINTER_ID = 21;
            const fire = (target, type, x, y) => target.dispatchEvent(new PointerEvent(type, {
                bubbles: true, cancelable: true,
                pointerId: POINTER_ID, pointerType: 'touch',
                isPrimary: true, button: 0, buttons: type === 'pointerup' ? 0 : 1,
                clientX: x, clientY: y, screenX: x, screenY: y,
            }));
            fire(chip, 'pointerdown', r.left + r.width/2, r.top + r.height/2);
            await new Promise(r => setTimeout(r, 20));
            fire(document.body, 'pointermove', r.left + r.width/2 + 30, r.top + r.height/2 + 30);
            await new Promise(r => setTimeout(r, 40));
            // Aim the finger at the BOTTOM of where the item should land:
            // column 2, row 3 (the bottom cell of the 1×3 column). The
            // top of the item should end up at row 1.
            const bp = save.backpack;
            const cells = document.querySelectorAll('#bp-grid .bp-cell');
            const bottomCell = cells[3 * bp.w + 2];
            const t = bottomCell.getBoundingClientRect();
            const fingerX = t.left + t.width / 2;
            const fingerY = t.bottom - 1;
            fire(document.body, 'pointermove', fingerX, fingerY);
            await new Promise(r => setTimeout(r, 30));
            // Read the ghost cells while still mid-drag so we can
            // confirm the entire column is highlighted, not just one
            // cell at the finger.
            const ghostKeys = Array.from(document.querySelectorAll('#bp-grid .bp-cell.ghost-ok'))
                .map(el => {
                    const idx = Array.prototype.indexOf.call(el.parentElement.children, el);
                    return [idx % bp.w, Math.floor(idx / bp.w)];
                });
            fire(document.body, 'pointerup', fingerX, fingerY);
            await new Promise(r => setTimeout(r, 80));
            return { placed: save.backpack.placed.slice(), ghostKeys };
        });
        ok('1×3 item placed at top-left (2, 1)',
           result.placed.length === 1 && result.placed[0].x === 2 && result.placed[0].y === 1);
        // The ghost-ok class should be on all 3 cells of the column
        // mid-drag (col 2, rows 1–3). Sort for stable comparison.
        const keys = result.ghostKeys.map(([x, y]) => `${x},${y}`).sort().join('|');
        ok('full 3-cell column highlighted mid-drag',
           keys === '2,1|2,2|2,3');
        await ctx.close();
    }

    // ── Scenario 4 — dragging off-grid keeps the ghost at the
    // closest in-grid cell, so the chosen item is always visible
    // while held. Moving back onto a free cell re-targets normally.
    {
        const { page, ctx } = await freshMobilePage();
        await page.evaluate(() => {
            const s = NeonSave.load();
            s.backpack = { w: 5, h: 5, placed: [], stash: ['plasma_cell'], luckBoost: 0 };
            NeonSave.write(s); location.reload();
        });
        await page.waitForTimeout(700);
        await page.evaluate(() => navigateToBackpack());
        await page.waitForTimeout(250);

        const result = await page.evaluate(async () => {
            const chip = document.querySelector('#bp-stash .bp-chip[data-stash-idx="0"]');
            const r = chip.getBoundingClientRect();
            const POINTER_ID = 31;
            const fire = (target, type, x, y) => target.dispatchEvent(new PointerEvent(type, {
                bubbles: true, cancelable: true,
                pointerId: POINTER_ID, pointerType: 'touch',
                isPrimary: true, button: 0, buttons: type === 'pointerup' ? 0 : 1,
                clientX: x, clientY: y, screenX: x, screenY: y,
            }));
            fire(chip, 'pointerdown', r.left + r.width/2, r.top + r.height/2);
            await new Promise(r => setTimeout(r, 20));
            fire(document.body, 'pointermove', r.left + r.width/2 + 30, r.top + r.height/2 + 30);
            await new Promise(r => setTimeout(r, 40));

            // Move WAY off the grid — top-left corner of viewport.
            fire(document.body, 'pointermove', 5, 5);
            await new Promise(r => setTimeout(r, 30));
            const offGrid = {
                gridGhostCells: document.querySelectorAll('#bp-grid .bp-cell.ghost-ok, #bp-grid .bp-cell.ghost-bad').length,
            };

            // Move BACK onto a valid grid cell.
            const cells = document.querySelectorAll('#bp-grid .bp-cell');
            const t = cells[2 * save.backpack.w + 2].getBoundingClientRect();
            fire(document.body, 'pointermove', t.left + t.width/2, t.bottom - 1);
            await new Promise(r => setTimeout(r, 30));
            const valid = {
                ghostOk: !!document.querySelector('#bp-grid .bp-cell.ghost-ok'),
            };

            fire(document.body, 'pointerup', t.left + t.width/2, t.bottom - 1);
            await new Promise(r => setTimeout(r, 60));
            const afterRelease = {
                ghostCells: document.querySelectorAll('#bp-grid .bp-cell.ghost-ok, #bp-grid .bp-cell.ghost-bad').length,
            };
            return { offGrid, valid, afterRelease };
        });
        ok('off-grid still shows ghost (clamped to nearest cell)', result.offGrid.gridGhostCells > 0);
        ok('grid highlight returns when back on a free cell', result.valid.ghostOk === true);
        ok('grid highlight cleared after successful release', result.afterRelease.ghostCells === 0);
        await ctx.close();
    }

    // ── Scenario 5 — invalid placement (overlap) → red ghost, no drop ──
    {
        const { page, ctx } = await freshMobilePage();
        await page.evaluate(() => {
            const s = NeonSave.load();
            // Pre-place an item at (2, 2) so dragging another onto it
            // is an overlap conflict.
            s.backpack = { w: 5, h: 5,
                placed: [{ id: 'plasma_cell', x: 2, y: 2, rot: 0 }],
                stash: ['plasma_cell'], luckBoost: 0 };
            NeonSave.write(s); location.reload();
        });
        await page.waitForTimeout(700);
        await page.evaluate(() => navigateToBackpack());
        await page.waitForTimeout(250);

        const result = await page.evaluate(async () => {
            const chip = document.querySelector('#bp-stash .bp-chip[data-stash-idx="0"]');
            const r = chip.getBoundingClientRect();
            const POINTER_ID = 32;
            const fire = (target, type, x, y) => target.dispatchEvent(new PointerEvent(type, {
                bubbles: true, cancelable: true,
                pointerId: POINTER_ID, pointerType: 'touch',
                isPrimary: true, button: 0, buttons: type === 'pointerup' ? 0 : 1,
                clientX: x, clientY: y, screenX: x, screenY: y,
            }));
            fire(chip, 'pointerdown', r.left + r.width/2, r.top + r.height/2);
            await new Promise(r => setTimeout(r, 20));
            fire(document.body, 'pointermove', r.left + r.width/2 + 30, r.top + r.height/2 + 30);
            await new Promise(r => setTimeout(r, 40));

            // Aim at the already-occupied cell (2, 2).
            const cells = document.querySelectorAll('#bp-grid .bp-cell');
            const t = cells[2 * save.backpack.w + 2].getBoundingClientRect();
            fire(document.body, 'pointermove', t.left + t.width/2, t.bottom - 1);
            await new Promise(r => setTimeout(r, 30));
            const midDrag = {
                ghostBad: !!document.querySelector('#bp-grid .bp-cell.ghost-bad'),
            };
            fire(document.body, 'pointerup', t.left + t.width/2, t.bottom - 1);
            await new Promise(r => setTimeout(r, 60));
            return {
                midDrag,
                placedLen: save.backpack.placed.length,
                stashLen: save.backpack.stash.length,
                held: !!bpHeld,
            };
        });
        ok('underlying cell shows ghost-bad',           result.midDrag.ghostBad === true);
        // Invalid drop: the pre-existing item is unchanged, the dragged
        // item is in held-limbo (not placed, not back in stash) so the
        // user can tap to retry or send back via the STASH button.
        ok('invalid drop did NOT add to placed',        result.placedLen === 1);
        ok('item is still held after invalid drop',     result.held === true);
        ok('dragged item not stashed after invalid drop', result.stashLen === 0);
        await ctx.close();
    }

    // ── Scenario 6 — drag an already-placed item to a new cell ─────────
    // The user asked to confirm picking-up + moving works on mobile.
    {
        const { page, ctx } = await freshMobilePage();
        await page.evaluate(() => {
            const s = NeonSave.load();
            s.backpack = { w: 5, h: 5,
                placed: [{ id: 'plasma_cell', x: 0, y: 0, rot: 0 }],
                stash: [], luckBoost: 0 };
            NeonSave.write(s); location.reload();
        });
        await page.waitForTimeout(700);
        await page.evaluate(() => navigateToBackpack());
        await page.waitForTimeout(250);

        const result = await page.evaluate(async () => {
            const src = document.querySelector('#bp-grid .bp-cell.filled[data-placed-idx="0"]');
            const r = src.getBoundingClientRect();
            const POINTER_ID = 33;
            const fire = (target, type, x, y) => target.dispatchEvent(new PointerEvent(type, {
                bubbles: true, cancelable: true,
                pointerId: POINTER_ID, pointerType: 'touch',
                isPrimary: true, button: 0, buttons: type === 'pointerup' ? 0 : 1,
                clientX: x, clientY: y, screenX: x, screenY: y,
            }));
            // Pick up the placed item.
            fire(src, 'pointerdown', r.left + r.width/2, r.top + r.height/2);
            await new Promise(r => setTimeout(r, 20));
            fire(document.body, 'pointermove', r.left + r.width/2 + 30, r.top + r.height/2 + 30);
            await new Promise(r => setTimeout(r, 40));
            const afterPickup = {
                held: !!bpHeld,
                placed: save.backpack.placed.length,
            };
            // Drop at (3, 3).
            const cells = document.querySelectorAll('#bp-grid .bp-cell');
            const t = cells[3 * save.backpack.w + 3].getBoundingClientRect();
            fire(document.body, 'pointermove', t.left + t.width/2, t.bottom - 1);
            await new Promise(r => setTimeout(r, 30));
            fire(document.body, 'pointerup', t.left + t.width/2, t.bottom - 1);
            await new Promise(r => setTimeout(r, 80));
            return {
                afterPickup,
                placed: save.backpack.placed.slice(),
            };
        });
        ok('placed item picked up mid-drag (held = true)', result.afterPickup.held === true);
        ok('placed item moved to new cell',
           result.placed.length === 1 && result.placed[0].x === 3 && result.placed[0].y === 3);
        await ctx.close();
    }

    // ── Scenario 7 — floating ghost element is gone from the DOM ────
    // After the floating preview was removed, the element should not
    // exist at all and no .bp-drag-ghost-cell children should ever be
    // created.
    {
        const { page, ctx } = await freshMobilePage();
        await page.evaluate(() => {
            const s = NeonSave.load();
            s.backpack = { w: 5, h: 5, placed: [], stash: ['plasma_cell'], luckBoost: 0 };
            NeonSave.write(s); location.reload();
        });
        await page.waitForTimeout(700);
        await page.evaluate(() => navigateToBackpack());
        await page.waitForTimeout(250);

        const result = await page.evaluate(async () => {
            const before = {
                el: !!document.getElementById('bp-drag-ghost'),
                cells: document.querySelectorAll('.bp-drag-ghost-cell').length,
            };
            const chip = document.querySelector('#bp-stash .bp-chip[data-stash-idx="0"]');
            const r = chip.getBoundingClientRect();
            const POINTER_ID = 41;
            const fire = (target, type, x, y) => target.dispatchEvent(new PointerEvent(type, {
                bubbles: true, cancelable: true,
                pointerId: POINTER_ID, pointerType: 'touch',
                isPrimary: true, button: 0, buttons: type === 'pointerup' ? 0 : 1,
                clientX: x, clientY: y, screenX: x, screenY: y,
            }));
            fire(chip, 'pointerdown', r.left + r.width/2, r.top + r.height/2);
            await new Promise(r => setTimeout(r, 20));
            fire(document.body, 'pointermove', r.left + r.width/2 + 30, r.top + r.height/2 + 30);
            await new Promise(r => setTimeout(r, 40));
            const cells = document.querySelectorAll('#bp-grid .bp-cell');
            const t = cells[2 * save.backpack.w + 2].getBoundingClientRect();
            fire(document.body, 'pointermove', t.left + t.width/2, t.bottom - 1);
            await new Promise(r => setTimeout(r, 30));
            const midDrag = {
                el: !!document.getElementById('bp-drag-ghost'),
                cells: document.querySelectorAll('.bp-drag-ghost-cell').length,
            };
            fire(document.body, 'pointerup', t.left + t.width/2, t.bottom - 1);
            await new Promise(r => setTimeout(r, 60));
            return { before, midDrag };
        });
        ok('no #bp-drag-ghost element in DOM (initial)', result.before.el === false);
        ok('no .bp-drag-ghost-cell children (initial)',   result.before.cells === 0);
        ok('no #bp-drag-ghost element appears mid-drag',  result.midDrag.el === false);
        ok('no .bp-drag-ghost-cell children mid-drag',    result.midDrag.cells === 0);
        await ctx.close();
    }

    // ── Scenario 8 — re-entry after off-grid: highlight returns to the
    // right cells, with no stale ghost classes left over from earlier
    // positions.
    {
        const { page, ctx } = await freshMobilePage();
        await page.evaluate(() => {
            const s = NeonSave.load();
            s.backpack = { w: 5, h: 5, placed: [], stash: ['plasma_cell'], luckBoost: 0 };
            NeonSave.write(s); location.reload();
        });
        await page.waitForTimeout(700);
        await page.evaluate(() => navigateToBackpack());
        await page.waitForTimeout(250);

        const result = await page.evaluate(async () => {
            const chip = document.querySelector('#bp-stash .bp-chip[data-stash-idx="0"]');
            const r = chip.getBoundingClientRect();
            const POINTER_ID = 51;
            const fire = (target, type, x, y) => target.dispatchEvent(new PointerEvent(type, {
                bubbles: true, cancelable: true,
                pointerId: POINTER_ID, pointerType: 'touch',
                isPrimary: true, button: 0, buttons: type === 'pointerup' ? 0 : 1,
                clientX: x, clientY: y, screenX: x, screenY: y,
            }));
            fire(chip, 'pointerdown', r.left + r.width/2, r.top + r.height/2);
            await new Promise(r => setTimeout(r, 20));
            fire(document.body, 'pointermove', r.left + r.width/2 + 30, r.top + r.height/2 + 30);
            await new Promise(r => setTimeout(r, 40));
            // First hover cell A
            const bp = save.backpack;
            const cells = document.querySelectorAll('#bp-grid .bp-cell');
            const cellA = cells[1 * bp.w + 1].getBoundingClientRect();
            fire(document.body, 'pointermove', cellA.left + cellA.width/2, cellA.bottom - 1);
            await new Promise(r => setTimeout(r, 30));
            const atA = Array.from(document.querySelectorAll('#bp-grid .bp-cell.ghost-ok'))
                .map(el => Array.prototype.indexOf.call(el.parentElement.children, el));
            // Go off-grid
            fire(document.body, 'pointermove', 5, 5);
            await new Promise(r => setTimeout(r, 30));
            const offGridCount = document.querySelectorAll('#bp-grid .bp-cell.ghost-ok, #bp-grid .bp-cell.ghost-bad').length;
            // Hover cell B
            const cellB = cells[3 * bp.w + 4].getBoundingClientRect();
            fire(document.body, 'pointermove', cellB.left + cellB.width/2, cellB.bottom - 1);
            await new Promise(r => setTimeout(r, 30));
            const atB = Array.from(document.querySelectorAll('#bp-grid .bp-cell.ghost-ok'))
                .map(el => Array.prototype.indexOf.call(el.parentElement.children, el));
            fire(document.body, 'pointerup', cellB.left + cellB.width/2, cellB.bottom - 1);
            await new Promise(r => setTimeout(r, 60));
            return { atA, offGridCount, atB, bpW: bp.w };
        });
        ok('highlight at first cell (single cell for 1×1 item)',
           result.atA.length === 1 && result.atA[0] === 1 * result.bpW + 1);
        ok('off-grid keeps ghost visible (clamped to nearest cell)',
           result.offGridCount > 0);
        ok('highlight moves cleanly to second cell with no stale cells',
           result.atB.length === 1 && result.atB[0] === 3 * result.bpW + 4);
        await ctx.close();
    }

    await browser.close();
    server.kill();

    console.log(`\nBACKPACK POINTER DRAG: ${pass} pass, ${fail} fail`);
    process.exit(fail === 0 ? 0 : 1);
})().catch(e => { console.error(e); process.exit(1); });
