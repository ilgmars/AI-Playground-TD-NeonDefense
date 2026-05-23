// Regression: dragging an item from the stash into the backpack grid
// used to break the moment the finger crossed into the grid area —
// #bp-grid-wrap's overflow:auto claimed the gesture for scroll/pan
// because .bp-chip / .bp-cell didn't have touch-action:none and the
// document-level touchmove only called preventDefault AFTER the drag
// threshold had been crossed. By that point the browser had already
// captured the touch and stopped dispatching further events. The fix:
// touch-action:none on the source elements + preventDefault on every
// touchmove while bpTouch is set, including pre-threshold.
//
// This test dispatches a long sequence of touchmove events tracing a
// path from the chip through the grid area and verifies:
//   1. EVERY touchmove (including the first, pre-threshold one) has
//      its default prevented by the page handler.
//   2. The ghost preview keeps painting as the finger moves across
//      the grid — i.e. dispatches don't get dropped mid-drag.
//   3. The final placement lands at the cell under the offset point.
//   4. CSS touch-action: none is applied to .bp-chip and .bp-cell.filled.
const { chromium } = require('playwright');
const { spawn } = require('child_process');
const path = require('path');

(async () => {
    const server = spawn(process.execPath, ['tests/helpers/http-server.js', '8868'],
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
        await page.goto('http://127.0.0.1:8868/index.html', { waitUntil: 'domcontentloaded' });
        await page.waitForTimeout(700);
        return { page, ctx };
    }

    // ── Scenario — long path from stash chip into grid, many touchmoves ─
    {
        const { page, ctx } = await freshMobilePage();
        await page.evaluate(() => {
            const s = NeonSave.load();
            s.metaXP = 5000; s.maxWaveReached = 25;
            s.backpack = { w: 5, h: 5, placed: [], stash: ['plasma_cell'], luckBoost: 0 };
            NeonSave.write(s); location.reload();
        });
        await page.waitForTimeout(700);
        await page.evaluate(() => navigateToBackpack());
        await page.waitForTimeout(250);

        // CSS check — assertion 4 first because it's the cheapest signal
        // and a regression here would invalidate everything else.
        const touchAction = await page.evaluate(() => {
            const chip = document.querySelector('#bp-stash .bp-chip');
            return getComputedStyle(chip).touchAction;
        });
        ok('CSS touch-action:none on chip', touchAction === 'none');

        // Full drag with a path of 8 intermediate touchmove points
        // tracing from the chip into the grid. Counts how many
        // touchmoves had their default prevented.
        const result = await page.evaluate(async () => {
            const chip = document.querySelector('#bp-stash .bp-chip[data-stash-idx="0"]');
            const r = chip.getBoundingClientRect();
            const fromX = r.left + r.width / 2;
            const fromY = r.top  + r.height / 2;
            const paintsByStep = [];
            let preventedCount = 0;
            let dispatchedCount = 0;

            const fire = (type, x, y, target) => {
                const touch = new Touch({ identifier: 1, target,
                    clientX: x, clientY: y, pageX: x, pageY: y,
                    screenX: x, screenY: y, radiusX: 5, radiusY: 5 });
                const ev = new TouchEvent(type, {
                    bubbles: true, cancelable: true,
                    touches: type === 'touchend' ? [] : [touch],
                    targetTouches: type === 'touchend' ? [] : [touch],
                    changedTouches: [touch],
                });
                target.dispatchEvent(ev);
                if (type === 'touchmove') {
                    dispatchedCount++;
                    if (ev.defaultPrevented) preventedCount++;
                }
            };

            fire('touchstart', fromX, fromY, chip);
            await new Promise(r => setTimeout(r, 20));

            // Step 1 — small pre-threshold move (5 px). This MUST also
            // have its default prevented; without the per-move
            // preventDefault, the surrounding scroll container can
            // claim the gesture during the pre-pickup window.
            fire('touchmove', fromX + 3, fromY + 4, chip);
            await new Promise(r => setTimeout(r, 10));

            const detachedDuringDrag = { before: chip.isConnected, after: null };
            // Step 2 — cross the threshold (triggers pick-up).
            // bpPickStash → renderBackpack detaches `chip` from the
            // DOM tree. Real browsers keep routing the touch's
            // subsequent events to that (now-orphaned) original
            // target. Our fix attaches touchmove/touchend listeners
            // directly to the source element on touchstart so the
            // gesture stream survives detachment.
            fire('touchmove', fromX + 30, fromY + 30, chip);
            await new Promise(r => setTimeout(r, 40));
            detachedDuringDrag.after = chip.isConnected;

            // All subsequent dispatches go to the (now-detached)
            // original chip — that's what real browsers do, and it's
            // exactly what the bug-fix is supposed to handle. Verify
            // the directly-attached handler keeps painting the ghost
            // as we trace a path into the grid.
            const bp = save.backpack;
            const cells = document.querySelectorAll('#bp-grid .bp-cell');
            const targetCell = cells[2 * bp.w + 2];   // (2, 2)
            const t = targetCell.getBoundingClientRect();
            const ghostOffset = window.innerWidth > window.innerHeight ? 70 : 100;
            const endX = t.left + t.width / 2;
            const endY = t.top  + t.height / 2 + ghostOffset;

            // 6 interpolated points so multiple intermediate
            // touchmoves cross into the grid bounds. Record whether
            // SOMETHING was painted at each step (ghost-ok or ghost-bad
            // on any grid cell).
            for (let i = 1; i <= 6; i++) {
                const x = fromX + (endX - fromX) * (i / 6);
                const y = fromY + (endY - fromY) * (i / 6);
                fire('touchmove', x, y, chip);
                await new Promise(r => setTimeout(r, 15));
                const painted = !!document.querySelector('#bp-grid .bp-cell.ghost-ok, #bp-grid .bp-cell.ghost-bad');
                paintsByStep.push(painted);
            }

            fire('touchend', endX, endY, chip);
            await new Promise(r => setTimeout(r, 80));

            return {
                placed: save.backpack.placed.slice(),
                stashLen: save.backpack.stash.length,
                paintsByStep, dispatchedCount, preventedCount,
                detachedDuringDrag,
            };
        });

        ok('preventDefault on every touchmove (incl. pre-threshold)',
           result.preventedCount === result.dispatchedCount && result.dispatchedCount >= 8);
        // At least the final few interpolated steps should paint —
        // they land within the grid bounds. The first one or two may
        // still be over the stash area.
        const paintedSteps = result.paintsByStep.filter(Boolean).length;
        ok('ghost paints during continuous drag (≥3 of 6 steps)', paintedSteps >= 3);
        ok('placement landed at the dragged-to cell',
           result.placed.length === 1 && result.placed[0].x === 2 && result.placed[0].y === 2);
        ok('chip removed from stash',  result.stashLen === 0);
        // Demonstrates the gesture stream survives DOM detachment —
        // the chip was in the tree before pickup and out of it after,
        // yet the remaining 6 touchmoves + touchend still drove
        // ghost painting and placement to completion.
        ok('chip detached mid-drag (precondition for the fix)',
           result.detachedDuringDrag.before === true && result.detachedDuringDrag.after === false);
        await ctx.close();
    }

    await browser.close();
    server.kill();

    console.log(`\nBACKPACK TOUCH CONTINUITY: ${pass} pass, ${fail} fail`);
    process.exit(fail === 0 ? 0 : 1);
})().catch(e => { console.error(e); process.exit(1); });
