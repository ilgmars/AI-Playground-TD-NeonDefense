// Backpack drag-to-place (touch). Mirrors the tower-dock drag pattern —
// the player drags a stash chip with a finger; the ghost preview is
// offset above the touch point so the target cell stays visible. On
// release the item is placed at the ghost cell.
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

    // ── Helpers ───────────────────────────────────────────────────────────
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

    // Synthesise a touch sequence on the page. Mirrors how a real finger
    // would generate touchstart → touchmove (past the drag threshold) →
    // touchmove (final position) → touchend. Each event's clientX/Y are
    // taken at face value by the page handler.
    // Performs a synthesised touch drag from `sourceSel` (chip or
    // filled cell) to the grid cell at (targetX, targetY). The helper
    // re-queries the target cell's screen position AFTER the first
    // touchmove triggers the pick-up — picking up makes the "Holding"
    // panel visible, which shifts the grid downward, so coordinates
    // captured before pickup would miss. The finger Y is then placed
    // ghostOffset px BELOW the (re-queried) target cell so the
    // handler's offset-up subtraction lands on the target.
    async function dispatchTouchDrag(page, sourceSel, targetX, targetY) {
        return await page.evaluate(async ({ sourceSel, targetX, targetY }) => {
            const src = document.querySelector(sourceSel);
            if (!src) return { error: 'no source: ' + sourceSel };
            const r = src.getBoundingClientRect();
            const fromX = r.left + r.width / 2;
            const fromY = r.top  + r.height / 2;

            const fire = (type, x, y, target) => {
                const touch = new Touch({ identifier: 1, target,
                    clientX: x, clientY: y, pageX: x, pageY: y,
                    screenX: x, screenY: y, radiusX: 5, radiusY: 5 });
                target.dispatchEvent(new TouchEvent(type, {
                    bubbles: true, cancelable: true,
                    touches: type === 'touchend' ? [] : [touch],
                    targetTouches: type === 'touchend' ? [] : [touch],
                    changedTouches: [touch],
                }));
            };

            // Per W3C: in-progress touches keep firing on the ORIGINAL
            // target — even after it's been detached from the DOM. Keep
            // the chip ref and dispatch all subsequent events on it.
            fire('touchstart', fromX, fromY, src);
            await new Promise(r => setTimeout(r, 20));
            // Cross the drag threshold (triggers pick-up + render → src detaches).
            fire('touchmove', fromX + 30, fromY + 30, src);
            await new Promise(r => setTimeout(r, 40));

            // Re-query target geometry AFTER the held panel appears and
            // pushes the grid downward.
            const bp = save.backpack;
            const cells = document.querySelectorAll('#bp-grid .bp-cell');
            const targetCell = cells[targetY * bp.w + targetX];
            if (!targetCell) return { error: 'no target cell' };
            const t = targetCell.getBoundingClientRect();
            const ghostOffset = window.innerWidth > window.innerHeight ? 70 : 100;
            const fingerX = t.left + t.width / 2;
            const fingerY = t.top  + t.height / 2 + ghostOffset;

            fire('touchmove', fingerX, fingerY, src);
            await new Promise(r => setTimeout(r, 30));
            const ghosted = {
                ok:  targetCell.classList.contains('ghost-ok'),
                bad: targetCell.classList.contains('ghost-bad'),
            };
            fire('touchend',  fingerX, fingerY, src);
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

        // Drag the stash item to the cell at grid (2, 2). The helper
        // re-queries the live target cell rect post-pickup so the
        // offset-ghost lands exactly there.
        const drag = await dispatchTouchDrag(page,
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

        // Target (2, 2). Deeper rows on a 5×5 grid land behind the build
        // dock on a 390-wide viewport — elementFromPoint can't reach them.
        const drag = await dispatchTouchDrag(page,
            '#bp-grid .bp-cell.filled[data-placed-idx="0"]',
            2, 2);
        ok('placed-item drag completed',   drag && drag.ok === true);
        ok('placed-item drag ghost-ok',    drag && drag.ghosted && drag.ghosted.ok === true);
        await page.waitForTimeout(100);

        const moved = await page.evaluate(() => save.backpack.placed[0]);
        ok('placed item dragged to new cell', moved && moved.x === 2 && moved.y === 2);
        await ctx.close();
    }

    await browser.close();
    server.kill();

    console.log(`\nBACKPACK TOUCH DRAG: ${pass} pass, ${fail} fail`);
    process.exit(fail === 0 ? 0 : 1);
})().catch(e => { console.error(e); process.exit(1); });
