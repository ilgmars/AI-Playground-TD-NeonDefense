// Regression: dragging an item used to drop mid-gesture because
// bpPickStash → renderBackpack destroys the source chip via
// innerHTML = ''. The first fix (touch-action:none + per-move
// preventDefault) handled scroll-claim but not detachment. The second
// fix (bind touchmove/touchend directly to the chip) handled spec-
// compliant Chrome but iOS Safari and some Android stacks fire
// touchcancel when the touch target is removed, ending the gesture.
//
// The current implementation uses Pointer Events with
// setPointerCapture on document.body. document.body is never removed
// from the DOM, so the captured pointer keeps dispatching there for
// the full gesture regardless of what renderBackpack does to the chip.
//
// This test verifies:
//   1. EVERY pointermove (incl. pre-threshold) has its default
//      prevented, so no scroll-pan claim can sneak in.
//   2. The source chip is genuinely detached mid-drag (precondition).
//   3. The ghost preview keeps painting across a 6-step path from the
//      chip into the grid AFTER the chip is detached.
//   4. The final placement lands at the cell under the finger
//      (ghost at finger position — no offset).
//   5. CSS touch-action:none is applied to the source chip.
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

        // CSS check — cheapest signal first.
        const touchAction = await page.evaluate(() => {
            const chip = document.querySelector('#bp-stash .bp-chip');
            return getComputedStyle(chip).touchAction;
        });
        ok('CSS touch-action:none on chip', touchAction === 'none');

        const result = await page.evaluate(async () => {
            const chip = document.querySelector('#bp-stash .bp-chip[data-stash-idx="0"]');
            const r = chip.getBoundingClientRect();
            const fromX = r.left + r.width / 2;
            const fromY = r.top  + r.height / 2;
            const POINTER_ID = 11;
            const paintsByStep = [];
            let preventedCount = 0;
            let dispatchedCount = 0;

            const fire = (target, type, x, y) => {
                const ev = new PointerEvent(type, {
                    bubbles: true, cancelable: true,
                    pointerId: POINTER_ID, pointerType: 'touch',
                    isPrimary: true, button: 0, buttons: type === 'pointerup' ? 0 : 1,
                    clientX: x, clientY: y, screenX: x, screenY: y,
                });
                target.dispatchEvent(ev);
                if (type === 'pointermove') {
                    dispatchedCount++;
                    if (ev.defaultPrevented) preventedCount++;
                }
            };

            fire(chip, 'pointerdown', fromX, fromY);
            await new Promise(r => setTimeout(r, 20));

            // Step 1 — tiny pre-threshold move. Default MUST be prevented
            // even before the threshold is crossed.
            fire(document.body, 'pointermove', fromX + 3, fromY + 4);
            await new Promise(r => setTimeout(r, 10));

            // Precondition record: chip is still in the tree before pickup.
            const detachedDuringDrag = { before: chip.isConnected, after: null };

            // Step 2 — cross the threshold → bpPickStash → renderBackpack
            // detaches the chip. The setPointerCapture(document.body) on
            // pointerdown ensures subsequent events keep flowing to
            // document.body regardless.
            fire(document.body, 'pointermove', fromX + 30, fromY + 30);
            await new Promise(r => setTimeout(r, 40));
            detachedDuringDrag.after = chip.isConnected;

            // Trace a 6-step path from the chip's original position to
            // the grid. Bottom-attach: finger Y lands at the BOTTOM edge
            // of the target cell (for a 1×1 item, that's where the
            // bottom of the item sits, with the ghost half a cell up).
            const bp = save.backpack;
            const cells = document.querySelectorAll('#bp-grid .bp-cell');
            const targetCell = cells[2 * bp.w + 2];
            const t = targetCell.getBoundingClientRect();
            const endX = t.left + t.width / 2;
            const endY = t.bottom - 1;

            for (let i = 1; i <= 6; i++) {
                const x = fromX + (endX - fromX) * (i / 6);
                const y = fromY + (endY - fromY) * (i / 6);
                fire(document.body, 'pointermove', x, y);
                await new Promise(r => setTimeout(r, 15));
                const painted = !!document.querySelector('#bp-grid .bp-cell.ghost-ok, #bp-grid .bp-cell.ghost-bad');
                paintsByStep.push(painted);
            }

            fire(document.body, 'pointerup', endX, endY);
            await new Promise(r => setTimeout(r, 80));

            return {
                placed: save.backpack.placed.slice(),
                stashLen: save.backpack.stash.length,
                paintsByStep, dispatchedCount, preventedCount,
                detachedDuringDrag,
            };
        });

        ok('preventDefault on every pointermove (incl. pre-threshold)',
           result.preventedCount === result.dispatchedCount && result.dispatchedCount >= 8);
        // Steps closer to the target should paint — the last several
        // certainly within the grid. Tolerate the first 1–2 still over
        // the stash area.
        const paintedSteps = result.paintsByStep.filter(Boolean).length;
        ok('ghost paints during continuous drag (≥3 of 6 steps)', paintedSteps >= 3);
        ok('placement landed at the dragged-to cell',
           result.placed.length === 1 && result.placed[0].x === 2 && result.placed[0].y === 2);
        ok('chip removed from stash',  result.stashLen === 0);
        // Demonstrates the gesture stream survived DOM detachment —
        // the captured pointer kept flowing to document.body.
        ok('chip detached mid-drag (precondition)',
           result.detachedDuringDrag.before === true && result.detachedDuringDrag.after === false);
        await ctx.close();
    }

    await browser.close();
    server.kill();

    console.log(`\nBACKPACK POINTER CONTINUITY: ${pass} pass, ${fail} fail`);
    process.exit(fail === 0 ? 0 : 1);
})().catch(e => { console.error(e); process.exit(1); });
