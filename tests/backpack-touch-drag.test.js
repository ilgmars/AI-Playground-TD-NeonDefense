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
            // Ghost sits AT the finger position (no offset).
            const fingerX = t.left + t.width / 2;
            const fingerY = t.top  + t.height / 2;

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

    await browser.close();
    server.kill();

    console.log(`\nBACKPACK POINTER DRAG: ${pass} pass, ${fail} fail`);
    process.exit(fail === 0 ? 0 : 1);
})().catch(e => { console.error(e); process.exit(1); });
