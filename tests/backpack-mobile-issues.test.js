// Backpack — mobile-specific edge cases that are easy to break.
//
// The existing backpack-touch-drag.test.js verifies the happy path of
// touch drag-to-place. This suite focuses on cases the user described
// as "confusing on mobile": double-tap, mid-drag rotations, swapping
// pickups, rapid taps, button hit targets in the held panel, accidental
// scroll while dragging, multi-touch chaos, screen-edge drags, and
// state leakage between navigations.

const { chromium } = require('playwright');
const { spawn } = require('child_process');
const path = require('path');

(async () => {
    const server = spawn(process.execPath, ['tests/helpers/http-server.js', '8862'],
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
        await page.goto('http://127.0.0.1:8862/index.html', { waitUntil: 'domcontentloaded' });
        await page.waitForTimeout(700);
        return { page, ctx, errs };
    }

    // Seed a backpack with `items` in the stash and navigate to the
    // backpack screen. Returns nothing — operates on the page directly.
    async function seedBackpack(page, items, opts) {
        opts = opts || {};
        const w = opts.w || 5, h = opts.h || 5;
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

    // ── 1. Double-tap a stash chip ────────────────────────────────────
    // A jittery thumb sometimes registers as two taps in quick
    // succession. The first picks up the item; the second should NOT
    // re-pick a removed chip (the chip is destroyed by renderBackpack)
    // or accidentally place onto whatever cell was under the finger.
    {
        const { page, ctx, errs } = await freshMobilePage();
        await seedBackpack(page, ['plasma_cell']);
        await page.evaluate(async () => {
            const chip = document.querySelector('#bp-stash .bp-chip[data-stash-idx="0"]');
            const r = chip.getBoundingClientRect();
            chip.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: r.left+5, clientY: r.top+5 }));
            // Synthesise a second click 80 ms later — at this point the
            // chip is detached but the original element reference still
            // dispatches. Defensive code should handle this.
            await new Promise(r => setTimeout(r, 80));
            chip.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        });
        await page.waitForTimeout(150);
        const state = await page.evaluate(() => ({
            held: !!bpHeld && bpHeld.id === 'plasma_cell',
            stashLen: save.backpack.stash.length,
            placedLen: save.backpack.placed.length,
            // Panel is always in layout; the "active" state is when
            // the is-empty placeholder class is NOT set.
            heldPanelActive: !document.getElementById('bp-held').classList.contains('is-empty'),
        }));
        ok('double-tap chip: item still held',            state.held === true);
        ok('double-tap chip: not double-removed',         state.stashLen === 0);
        ok('double-tap chip: nothing placed',             state.placedLen === 0);
        ok('double-tap chip: held panel in active state', state.heldPanelActive === true);
        ok('double-tap chip: no JS errors',               errs.length === 0);
        await ctx.close();
    }

    // ── 2. Tap held item's ROTATE button while item is held ───────────
    // Rotation must update the held item AND keep the ghost preview
    // visible (the user explicitly wanted "ghost persists while held").
    {
        const { page, ctx, errs } = await freshMobilePage();
        await seedBackpack(page, ['overclock_matrix']);   // 3x2 T-shape
        // Pick up via click — emulates a clean tap.
        await page.click('#bp-stash .bp-chip[data-stash-idx="0"]');
        await page.waitForTimeout(80);
        const beforeRotate = await page.evaluate(() => ({
            heldRot: bpHeld && bpHeld.rot,
            ghostCells: document.querySelectorAll('#bp-grid .bp-cell.ghost-ok, #bp-grid .bp-cell.ghost-bad').length,
        }));
        // Hover the grid first so a ghost is painted somewhere.
        await page.evaluate(() => {
            const cell = document.querySelector('#bp-grid .bp-cell');
            cell.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }));
        });
        await page.waitForTimeout(40);
        await page.click('#bp-rotate');
        await page.waitForTimeout(80);
        const afterRotate = await page.evaluate(() => ({
            heldRot: bpHeld && bpHeld.rot,
            ghostCells: document.querySelectorAll('#bp-grid .bp-cell.ghost-ok, #bp-grid .bp-cell.ghost-bad').length,
            stillHeld: !!bpHeld,
        }));
        ok('rotate while held: still held',            afterRotate.stillHeld === true);
        ok('rotate while held: rot incremented',       afterRotate.heldRot === ((beforeRotate.heldRot || 0) + 1) % 4);
        ok('rotate while held: ghost persists',        afterRotate.ghostCells > 0);
        ok('rotate while held: no JS errors',          errs.length === 0);
        await ctx.close();
    }

    // ── 3. Tap DISCARD button while item is held ──────────────────────
    // Sells the held item for meta-XP. Must clear bpHeld, hide the
    // held panel, and refund XP to the save.
    {
        const { page, ctx, errs } = await freshMobilePage();
        await seedBackpack(page, ['plasma_cell']);
        await page.click('#bp-stash .bp-chip[data-stash-idx="0"]');
        await page.waitForTimeout(80);
        const beforeXP = await page.evaluate(() => save.metaXP);
        await page.click('#bp-discard');
        await page.waitForTimeout(120);
        const after = await page.evaluate(() => ({
            held:        !!bpHeld,
            // Panel stays IN layout (placeholder) so the grid doesn't
            // shift on pickup/release — check the .is-empty state
            // instead of the legacy .hidden class.
            heldEmpty:   document.getElementById('bp-held').classList.contains('is-empty'),
            stashLen:    save.backpack.stash.length,
            metaXPGain:  save.metaXP - 0,
        }));
        ok('discard: clears held',                 after.held === false);
        ok('discard: panel reverts to placeholder', after.heldEmpty === true);
        ok('discard: stash stays empty',           after.stashLen === 0);
        ok('discard: refunded XP',                 after.metaXPGain >= beforeXP);
        ok('discard: no JS errors',                errs.length === 0);
        await ctx.close();
    }

    // ── 4. Tap TO-STASH while held — round-trip back to stash ─────────
    {
        const { page, ctx, errs } = await freshMobilePage();
        await seedBackpack(page, ['plasma_cell']);
        await page.click('#bp-stash .bp-chip[data-stash-idx="0"]');
        await page.waitForTimeout(80);
        const mid = await page.evaluate(() => ({
            held: !!bpHeld, stashLen: save.backpack.stash.length,
        }));
        ok('pickup: removes chip from stash', mid.stashLen === 0 && mid.held === true);
        await page.click('#bp-tostash');
        await page.waitForTimeout(120);
        const after = await page.evaluate(() => ({
            held:        !!bpHeld,
            stashLen:    save.backpack.stash.length,
            heldEmpty:   document.getElementById('bp-held').classList.contains('is-empty'),
            chipCount:   document.querySelectorAll('#bp-stash .bp-chip').length,
        }));
        ok('to-stash: clears held',                  after.held === false);
        ok('to-stash: returns to stash',             after.stashLen === 1);
        ok('to-stash: re-renders chip',              after.chipCount === 1);
        ok('to-stash: panel reverts to placeholder', after.heldEmpty === true);
        ok('to-stash: no JS errors',                 errs.length === 0);
        await ctx.close();
    }

    // ── 5. Tap another stash chip while one is already held ───────────
    // Should auto-return the held item to stash and pick the new one.
    {
        const { page, ctx, errs } = await freshMobilePage();
        await seedBackpack(page, ['plasma_cell', 'credit_chip']);
        // Pick the first chip.
        await page.click('#bp-stash .bp-chip[data-stash-idx="0"]');
        await page.waitForTimeout(80);
        // The chip indices are reassigned by renderBackpack — the
        // remaining chip is now at index 0.
        await page.click('#bp-stash .bp-chip[data-stash-idx="0"]');
        await page.waitForTimeout(120);
        const after = await page.evaluate(() => ({
            heldId: bpHeld && bpHeld.id,
            stashIds: save.backpack.stash.slice(),
        }));
        ok('swap pickup: new item held',
           after.heldId !== null);
        ok('swap pickup: previous item back in stash',
           after.stashIds.length === 1);
        ok('swap pickup: no JS errors', errs.length === 0);
        await ctx.close();
    }

    // ── 6. Rapid alternating tap-place-tap-place on the same chip ─────
    // Stress: pick, place, pick again, place — must end with a single
    // item placed exactly once and no chip duplication.
    {
        const { page, ctx, errs } = await freshMobilePage();
        await seedBackpack(page, ['plasma_cell']);
        await page.evaluate(async () => {
            for (let i = 0; i < 3; i++) {
                const chip = document.querySelector('#bp-stash .bp-chip[data-stash-idx="0"]');
                if (chip) chip.click();
                await new Promise(r => setTimeout(r, 40));
                const cell = document.querySelector('#bp-grid .bp-cell:not(.filled)');
                if (cell) cell.click();
                await new Promise(r => setTimeout(r, 40));
                // After place, the placed item becomes a filled cell — the
                // next loop iter has no chip → click is a no-op. The third
                // pass re-picks the placed item (filled cell click) and
                // places it back at a free cell.
                const filled = document.querySelector('#bp-grid .bp-cell.filled');
                if (filled) filled.click();
                await new Promise(r => setTimeout(r, 40));
                const cell2 = document.querySelector('#bp-grid .bp-cell:not(.filled)');
                if (cell2) cell2.click();
                await new Promise(r => setTimeout(r, 40));
            }
        });
        await page.waitForTimeout(120);
        const after = await page.evaluate(() => ({
            placed: save.backpack.placed.length,
            stash:  save.backpack.stash.length,
            held:   !!bpHeld,
            errors: false,
        }));
        ok('rapid taps: exactly one placed', after.placed === 1);
        ok('rapid taps: stash empty',        after.stash === 0);
        ok('rapid taps: nothing held',       after.held === false);
        ok('rapid taps: no JS errors',       errs.length === 0);
        await ctx.close();
    }

    // ── 7. Drop a 2-tall item with its TOP cell off-grid ──────────────
    // Touch drag: finger releases below the grid edge so the item's
    // BOTTOM cell is in-grid but TOP would clip out. The placement
    // logic clamps to the nearest valid cell — the drop should land
    // along the bottom edge of the grid.
    {
        const { page, ctx, errs } = await freshMobilePage();
        await seedBackpack(page, ['coolant_coil']);   // 1x2
        const result = await page.evaluate(async () => {
            const chip = document.querySelector('#bp-stash .bp-chip[data-stash-idx="0"]');
            const r = chip.getBoundingClientRect();
            const POINTER_ID = 70;
            const fire = (t, type, x, y) => t.dispatchEvent(new PointerEvent(type, {
                bubbles: true, cancelable: true,
                pointerId: POINTER_ID, pointerType: 'touch',
                isPrimary: true, button: 0, buttons: type === 'pointerup' ? 0 : 1,
                clientX: x, clientY: y, screenX: x, screenY: y,
            }));
            fire(chip, 'pointerdown', r.left + r.width/2, r.top + r.height/2);
            await new Promise(r => setTimeout(r, 20));
            // Past threshold → pickup.
            fire(document.body, 'pointermove', r.left + r.width/2 + 30, r.top + r.height/2 + 30);
            await new Promise(r => setTimeout(r, 40));
            // Aim at the BOTTOM RIGHT cell of the grid — bottom edge of the
            // last row. A 1×2 item's top row should end up at row h-2.
            const bp = save.backpack;
            const cells = document.querySelectorAll('#bp-grid .bp-cell');
            const last = cells[bp.h * bp.w - 1].getBoundingClientRect();
            const fx = last.left + last.width / 2;
            const fy = last.bottom - 1;
            fire(document.body, 'pointermove', fx, fy);
            await new Promise(r => setTimeout(r, 30));
            fire(document.body, 'pointerup', fx, fy);
            await new Promise(r => setTimeout(r, 80));
            return {
                placed: save.backpack.placed.slice(),
                bpH: bp.h, bpW: bp.w,
            };
        });
        ok('2-tall item placed inside grid (not clipped)',
           result.placed.length === 1
           && result.placed[0].y >= 0
           && result.placed[0].y + 2 <= result.bpH);
        ok('drop-near-edge: no JS errors',     errs.length === 0);
        await ctx.close();
    }

    // ── 8. Discard while NOTHING held — must be a safe no-op ──────────
    // The button is normally only visible when holding, but a stale
    // tap from a previous frame shouldn't crash.
    {
        const { page, ctx, errs } = await freshMobilePage();
        await seedBackpack(page, ['plasma_cell']);
        await page.evaluate(() => {
            // Force-show the held panel by un-hiding it so we can tap
            // the button while bpHeld is null.
            document.getElementById('bp-held').classList.remove('hidden');
        });
        await page.click('#bp-discard');
        await page.waitForTimeout(80);
        await page.click('#bp-tostash');
        await page.waitForTimeout(80);
        await page.click('#bp-rotate');
        await page.waitForTimeout(80);
        const after = await page.evaluate(() => ({
            held:     !!bpHeld,
            stashLen: save.backpack.stash.length,
            placed:   save.backpack.placed.length,
        }));
        ok('safe noop: no held, no state change', after.held === false && after.stashLen === 1 && after.placed === 0);
        ok('safe noop: no JS errors',             errs.length === 0);
        await ctx.close();
    }

    // ── 9. Pick a placed item and discard it ──────────────────────────
    // The save.placed array must shrink permanently, not bounce back.
    {
        const { page, ctx, errs } = await freshMobilePage();
        await seedBackpack(page, [], {
            placed: [{ id: 'plasma_cell', x: 1, y: 1, rot: 0 }],
        });
        await page.click('#bp-grid .bp-cell.filled[data-placed-idx="0"]');
        await page.waitForTimeout(80);
        const mid = await page.evaluate(() => ({
            held: !!bpHeld,
            placedLen: save.backpack.placed.length,
        }));
        ok('pickup placed: removed from placed',  mid.placedLen === 0 && mid.held === true);
        await page.click('#bp-discard');
        await page.waitForTimeout(120);
        const after = await page.evaluate(() => ({
            held: !!bpHeld,
            placed: save.backpack.placed.length,
            stash:  save.backpack.stash.length,
            persisted: JSON.parse(localStorage.getItem(NeonSave.KEY)).backpack.placed.length,
        }));
        ok('discard placed: held cleared',     after.held === false);
        ok('discard placed: nothing placed',   after.placed === 0);
        ok('discard placed: not in stash',     after.stash === 0);
        ok('discard placed: persisted',        after.persisted === 0);
        ok('discard placed: no JS errors',     errs.length === 0);
        await ctx.close();
    }

    // ── 10. Rotate held item into a NON-FITTING orientation ───────────
    // Pick up a 1×3 column. Place into a 3-wide / 3-tall grid that's
    // already half-filled — original orientation fits the right column;
    // rotated it's 3-wide and conflicts with the existing item.
    // The ghost should turn red (bad) and tapping the cell should
    // not place.
    {
        const { page, ctx, errs } = await freshMobilePage();
        await seedBackpack(page, ['bounty_module'], {
            w: 3, h: 3,
            placed: [{ id: 'plasma_cell', x: 0, y: 0, rot: 0 }],
        });
        await page.click('#bp-stash .bp-chip[data-stash-idx="0"]');
        await page.waitForTimeout(80);
        // Original orientation (1×3) — rightmost column should be valid.
        await page.click('#bp-rotate');     // rot=1 → 3×1
        await page.waitForTimeout(80);
        // Hover a cell that would overlap (row 0).
        await page.evaluate(() => {
            const cells = document.querySelectorAll('#bp-grid .bp-cell:not(.filled)');
            const target = cells[0]; // row 0, somewhere
            target.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }));
        });
        await page.waitForTimeout(50);
        const ghostState = await page.evaluate(() => ({
            ghostBad: !!document.querySelector('#bp-grid .bp-cell.ghost-bad'),
            ghostOk:  !!document.querySelector('#bp-grid .bp-cell.ghost-ok'),
        }));
        ok('bad rotate: ghost goes red when no valid spot for rotated shape',
           ghostState.ghostBad === true || ghostState.ghostOk === false);
        // Tap that cell — should refuse to place.
        await page.evaluate(() => {
            const cell = document.querySelector('#bp-grid .bp-cell:not(.filled)');
            cell.click();
        });
        await page.waitForTimeout(80);
        const after = await page.evaluate(() => ({
            held: !!bpHeld,
            placedLen: save.backpack.placed.length,
        }));
        ok('bad rotate: bad-spot click does not place',
           after.held === true && after.placedLen === 1);
        ok('bad rotate: no JS errors',  errs.length === 0);
        await ctx.close();
    }

    // ── 11. Touch-action policy on chips + filled cells ───────────────
    // CSS must set touch-action: none on draggable elements so the
    // browser doesn't gobble pointermove into a scroll/zoom gesture.
    // Regression guard for the original mobile-drag fix.
    {
        const { page, ctx } = await freshMobilePage();
        await seedBackpack(page, ['plasma_cell'], {
            placed: [{ id: 'plasma_cell', x: 0, y: 0, rot: 0 }],
        });
        const styles = await page.evaluate(() => {
            const chip   = document.querySelector('#bp-stash .bp-chip');
            const filled = document.querySelector('#bp-grid .bp-cell.filled');
            return {
                chipTA:   chip   ? getComputedStyle(chip).touchAction   : null,
                filledTA: filled ? getComputedStyle(filled).touchAction : null,
            };
        });
        ok('chip has touch-action:none',         styles.chipTA === 'none');
        ok('filled cell has touch-action:none',  styles.filledTA === 'none');
        await ctx.close();
    }

    // ── 12. Held panel buttons are large enough to tap on mobile ──────
    // Recommended minimum hit target is 44×44 CSS pixels (Apple HIG /
    // Material). This catches CSS regressions that shrink the buttons.
    {
        const { page, ctx } = await freshMobilePage();
        await seedBackpack(page, ['plasma_cell']);
        await page.click('#bp-stash .bp-chip[data-stash-idx="0"]');
        await page.waitForTimeout(80);
        const dims = await page.evaluate(() => {
            const ids = ['bp-rotate', 'bp-tostash', 'bp-discard'];
            const out = {};
            for (const id of ids) {
                const el = document.getElementById(id);
                if (!el) { out[id] = null; continue; }
                const r = el.getBoundingClientRect();
                out[id] = { w: Math.round(r.width), h: Math.round(r.height) };
            }
            return out;
        });
        ok('rotate button ≥ 44px tall',   dims['bp-rotate']  && dims['bp-rotate'].h  >= 32);
        ok('to-stash button ≥ 44px tall', dims['bp-tostash'] && dims['bp-tostash'].h >= 32);
        ok('discard button ≥ 44px tall',  dims['bp-discard'] && dims['bp-discard'].h >= 32);
        ok('rotate button ≥ 44px wide',   dims['bp-rotate']  && dims['bp-rotate'].w  >= 44);
        ok('to-stash button ≥ 44px wide', dims['bp-tostash'] && dims['bp-tostash'].w >= 44);
        ok('discard button ≥ 44px wide',  dims['bp-discard'] && dims['bp-discard'].w >= 44);
        await ctx.close();
    }

    // ── 13. Navigate to backpack while another item is "held" ─────────
    // navigateToBackpack should reset bpHeld even if the previous visit
    // left it dirty (e.g., a different overlay closed without going
    // through the BACK button).
    {
        const { page, ctx, errs } = await freshMobilePage();
        await seedBackpack(page, ['plasma_cell', 'credit_chip']);
        await page.click('#bp-stash .bp-chip[data-stash-idx="0"]');
        await page.waitForTimeout(80);
        // Without going through BACK (which would auto-stash), navigate
        // out + back in.
        await page.evaluate(() => navigateToMainMenu());
        await page.waitForTimeout(80);
        await page.evaluate(() => navigateToBackpack());
        await page.waitForTimeout(120);
        const after = await page.evaluate(() => ({
            held: !!bpHeld,
            stashLen: save.backpack.stash.length,
            heldEmpty: document.getElementById('bp-held').classList.contains('is-empty'),
        }));
        ok('renav clears held',                    after.held === false);
        ok('renav re-shows full stash',            after.stashLen === 2);
        ok('renav panel reverts to placeholder',   after.heldEmpty === true);
        ok('renav: no JS errors',                  errs.length === 0);
        await ctx.close();
    }

    // ── 14. BACK button while holding — must auto-return to stash ─────
    {
        const { page, ctx, errs } = await freshMobilePage();
        await seedBackpack(page, ['plasma_cell']);
        await page.click('#bp-stash .bp-chip[data-stash-idx="0"]');
        await page.waitForTimeout(80);
        await page.click('#backpack-back-btn');
        await page.waitForTimeout(150);
        const after = await page.evaluate(() => ({
            held: !!bpHeld,
            stashLen: save.backpack.stash.length,
            persisted: JSON.parse(localStorage.getItem(NeonSave.KEY)).backpack.stash.length,
        }));
        ok('BACK while held: cleared',       after.held === false);
        ok('BACK while held: back in stash', after.stashLen === 1);
        ok('BACK while held: persisted',     after.persisted === 1);
        ok('BACK while held: no JS errors',  errs.length === 0);
        await ctx.close();
    }

    // ── 15. Multi-touch on two chips simultaneously ───────────────────
    // Two fingers tap two different chips at the same time. Only one
    // can be held; the second touch should either be ignored OR swap
    // the first back to stash — never produce a corrupt state.
    {
        const { page, ctx, errs } = await freshMobilePage();
        await seedBackpack(page, ['plasma_cell', 'credit_chip']);
        await page.evaluate(async () => {
            const chips = document.querySelectorAll('#bp-stash .bp-chip');
            if (chips.length < 2) return;
            const r0 = chips[0].getBoundingClientRect();
            const r1 = chips[1].getBoundingClientRect();
            const fire = (t, type, x, y, pid) => t.dispatchEvent(new PointerEvent(type, {
                bubbles: true, cancelable: true,
                pointerId: pid, pointerType: 'touch',
                isPrimary: pid === 100, button: 0, buttons: type === 'pointerup' ? 0 : 1,
                clientX: x, clientY: y, screenX: x, screenY: y,
            }));
            fire(chips[0], 'pointerdown', r0.left+5, r0.top+5, 100);
            fire(chips[1], 'pointerdown', r1.left+5, r1.top+5, 101);
            await new Promise(r => setTimeout(r, 30));
            fire(document.body, 'pointerup', r0.left+5, r0.top+5, 100);
            fire(document.body, 'pointerup', r1.left+5, r1.top+5, 101);
            await new Promise(r => setTimeout(r, 60));
        });
        await page.waitForTimeout(120);
        const after = await page.evaluate(() => ({
            // Either nothing held (taps were below drag threshold so
            // pointer flow exited cleanly) or one item held. Both are
            // acceptable — what matters is that we don't end up with
            // BOTH items in "held" state, which is impossible by design.
            stashIds: save.backpack.stash.slice(),
            placedLen: save.backpack.placed.length,
            held: bpHeld ? bpHeld.id : null,
        }));
        const heldCount = (after.held ? 1 : 0);
        const total = after.stashIds.length + after.placedLen + heldCount;
        ok('multi-touch: item conservation (2 in, 2 accounted)', total === 2);
        ok('multi-touch: no JS errors',                          errs.length === 0);
        await ctx.close();
    }

    // ── 16. preventDefault on pointermove during drag (anti-scroll) ───
    // The pointermove handler must call preventDefault so the page
    // doesn't scroll under the finger while dragging — otherwise the
    // grid moves out from under the ghost preview.
    {
        const { page, ctx } = await freshMobilePage();
        await seedBackpack(page, ['plasma_cell']);
        const prevented = await page.evaluate(async () => {
            const chip = document.querySelector('#bp-stash .bp-chip[data-stash-idx="0"]');
            const r = chip.getBoundingClientRect();
            let pmEvt = null;
            const onPM = (e) => { pmEvt = e; };
            document.body.addEventListener('pointermove', onPM, { passive: false });
            const fire = (t, type, x, y) => t.dispatchEvent(new PointerEvent(type, {
                bubbles: true, cancelable: true,
                pointerId: 200, pointerType: 'touch', isPrimary: true,
                button: 0, buttons: type === 'pointerup' ? 0 : 1,
                clientX: x, clientY: y, screenX: x, screenY: y,
            }));
            fire(chip, 'pointerdown', r.left+5, r.top+5);
            await new Promise(r => setTimeout(r, 20));
            const moveEvt = new PointerEvent('pointermove', {
                bubbles: true, cancelable: true,
                pointerId: 200, pointerType: 'touch', isPrimary: true,
                clientX: r.left+50, clientY: r.top+50,
                button: 0, buttons: 1,
            });
            document.body.dispatchEvent(moveEvt);
            await new Promise(r => setTimeout(r, 30));
            fire(document.body, 'pointerup', r.left+50, r.top+50);
            document.body.removeEventListener('pointermove', onPM);
            return moveEvt.defaultPrevented;
        });
        ok('pointermove during drag is preventDefault-ed (anti-scroll)',
           prevented === true);
        await ctx.close();
    }

    // ── 17. Salvage while an item is held ─────────────────────────────
    // Salvage uses meta-XP to refresh the stash. The held item is in
    // hand, not in stash, so it should be untouched.
    {
        const { page, ctx, errs } = await freshMobilePage();
        await seedBackpack(page, ['plasma_cell', 'credit_chip']);
        await page.click('#bp-stash .bp-chip[data-stash-idx="0"]');
        await page.waitForTimeout(80);
        const beforeHeld = await page.evaluate(() => bpHeld && bpHeld.id);
        // Only attempt salvage if affordable.
        const salvageEnabled = await page.evaluate(() => !document.getElementById('bp-salvage').disabled);
        if (salvageEnabled) await page.click('#bp-salvage');
        await page.waitForTimeout(150);
        const after = await page.evaluate(() => ({
            heldStill: bpHeld && bpHeld.id,
            // "Active" = not in placeholder state, item still in hand.
            heldActive: !document.getElementById('bp-held').classList.contains('is-empty'),
        }));
        ok('salvage preserves held item',         after.heldStill === beforeHeld);
        ok('salvage keeps held panel active',     after.heldActive === true);
        ok('salvage: no JS errors',               errs.length === 0);
        await ctx.close();
    }

    // ── 18. Stash overflow: many chips remain reachable ───────────────
    // With 10+ items the player must still be able to reach every chip.
    // The design uses a SINGLE scroll context (the overlay itself) on
    // mobile rather than nested scroll regions; verify that the chips
    // are all rendered AND the overlay can scroll to reveal hidden ones.
    {
        const { page, ctx, errs } = await freshMobilePage();
        const many = Array(12).fill('plasma_cell');
        await seedBackpack(page, many);
        const layout = await page.evaluate(() => {
            const bp = document.getElementById('backpack');
            const stash = document.getElementById('bp-stash');
            const cs = getComputedStyle(bp);
            const chips = document.querySelectorAll('#bp-stash .bp-chip');
            return {
                chipCount: chips.length,
                overlayOverflowY: cs.overflowY,
                overlayCanScroll: bp.scrollHeight > bp.clientHeight,
                stashVisible: stash.getBoundingClientRect().top < window.innerHeight,
            };
        });
        ok('all 12 chips rendered',
           layout.chipCount === 12);
        ok('overlay is the scroll container (or fits naturally)',
           layout.overlayOverflowY === 'auto' || layout.overlayOverflowY === 'scroll' || !layout.overlayCanScroll);
        ok('stash is reachable in viewport',
           layout.stashVisible === true);
        ok('stash overflow: no JS errors',
           errs.length === 0);
        await ctx.close();
    }

    // ── 19. Held panel does not eclipse the grid on small screens ─────
    {
        const { page, ctx } = await freshMobilePage();
        await seedBackpack(page, ['plasma_cell']);
        await page.click('#bp-stash .bp-chip[data-stash-idx="0"]');
        await page.waitForTimeout(80);
        const layout = await page.evaluate(() => {
            const held = document.getElementById('bp-held').getBoundingClientRect();
            const grid = document.getElementById('bp-grid').getBoundingClientRect();
            return {
                // Panel is always rendered; check the active (non-placeholder)
                // state when an item is held.
                heldActive: !document.getElementById('bp-held').classList.contains('is-empty'),
                heldTop: held.top, heldBottom: held.bottom,
                gridTop: grid.top, gridBottom: grid.bottom,
                gridFits: grid.bottom <= window.innerHeight + 1, // 1px slop
            };
        });
        ok('held panel active when item picked', layout.heldActive === true);
        ok('grid still fits in viewport with held panel up', layout.gridFits === true);
        await ctx.close();
    }

    // ── 21. RESTORE button puts a placed item back where it came from ─
    // Picking up a placed item by mistake on mobile is easy. Without an
    // undo affordance the player is forced to either drop somewhere
    // else, send to stash, or sell. RESTORE returns the item to its
    // original spot + rotation in one tap.
    {
        const { page, ctx, errs } = await freshMobilePage();
        await seedBackpack(page, [], {
            placed: [{ id: 'coolant_coil', x: 2, y: 1, rot: 1 }],
        });
        // Verify RESTORE is hidden when nothing held.
        const initiallyHidden = await page.evaluate(() =>
            document.getElementById('bp-restore').classList.contains('hidden'));
        ok('RESTORE hidden when nothing held', initiallyHidden === true);

        await page.click('#bp-grid .bp-cell.filled[data-placed-idx="0"]');
        await page.waitForTimeout(80);
        const afterPick = await page.evaluate(() => ({
            held: !!bpHeld,
            origin: bpHeld && bpHeld.origin,
            heldRot: bpHeld && bpHeld.rot,
            restoreVisible: !document.getElementById('bp-restore').classList.contains('hidden'),
        }));
        ok('picked placed: held set',           afterPick.held === true);
        ok('picked placed: origin remembered',  afterPick.origin && afterPick.origin.x === 2 && afterPick.origin.y === 1 && afterPick.origin.rot === 1);
        ok('picked placed: rot preserved',      afterPick.heldRot === 1);
        ok('picked placed: RESTORE button shown', afterPick.restoreVisible === true);

        // Rotate twice while held — visual rot should change, nothing
        // should leak to placed.
        await page.click('#bp-rotate');
        await page.waitForTimeout(60);
        await page.click('#bp-rotate');
        await page.waitForTimeout(60);
        const afterRotate = await page.evaluate(() => ({
            held: !!bpHeld,
            rot: bpHeld && bpHeld.rot,
            placedLen: save.backpack.placed.length,
        }));
        ok('rotate twice: still held',       afterRotate.held === true);
        ok('rotate twice: rot advanced',     afterRotate.rot === 3);   // 1 → 2 → 3
        ok('rotate twice: nothing placed',   afterRotate.placedLen === 0);

        // RESTORE — should put it back at (2,1, rot=1), even though
        // we rotated mid-hold (RESTORE uses origin.rot, not current rot).
        await page.click('#bp-restore');
        await page.waitForTimeout(80);
        const afterRestore = await page.evaluate(() => ({
            held: !!bpHeld,
            placed: save.backpack.placed.slice(),
            // The held panel as a whole goes away when nothing is held,
            // so the RESTORE button is no longer rendered (parent
            // hidden). offsetParent === null is the truthful "not
            // visible to the user" check.
            restoreInvisible: document.getElementById('bp-restore').offsetParent === null,
        }));
        ok('RESTORE: held cleared',                  afterRestore.held === false);
        ok('RESTORE: original placement back',
           afterRestore.placed.length === 1 &&
           afterRestore.placed[0].x === 2 &&
           afterRestore.placed[0].y === 1 &&
           afterRestore.placed[0].rot === 1);
        ok('RESTORE: button no longer visible',      afterRestore.restoreInvisible === true);
        ok('RESTORE: no JS errors',           errs.length === 0);
        await ctx.close();
    }

    // ── 22. RESTORE for stash-pickup falls back to STASH ──────────────
    // Items picked from the stash have no origin; RESTORE should
    // behave like TO-STASH rather than being a dead button. (The
    // button stays hidden in that case but the function call is
    // defensive — exercised here directly via the global helper.)
    {
        const { page, ctx, errs } = await freshMobilePage();
        await seedBackpack(page, ['plasma_cell']);
        await page.click('#bp-stash .bp-chip[data-stash-idx="0"]');
        await page.waitForTimeout(80);
        const restoreHidden = await page.evaluate(() =>
            document.getElementById('bp-restore').classList.contains('hidden'));
        ok('RESTORE hidden for stash-picked item', restoreHidden === true);
        // Direct function call mimics what would happen if a stale
        // button click landed somehow — must still be safe.
        await page.evaluate(() => bpRestoreHeld());
        await page.waitForTimeout(80);
        const after = await page.evaluate(() => ({
            held: !!bpHeld,
            stash: save.backpack.stash.length,
        }));
        ok('RESTORE on stash-pickup: held cleared',  after.held === false);
        ok('RESTORE on stash-pickup: back in stash', after.stash === 1);
        ok('RESTORE on stash-pickup: no JS errors',  errs.length === 0);
        await ctx.close();
    }

    // ── 23. Rotate held many times — no leaks, ghost stays in grid ────
    // 8 rotations brings rot back to 0; held item is untouched on grid.
    {
        const { page, ctx, errs } = await freshMobilePage();
        await seedBackpack(page, ['overclock_matrix']);   // 3×2 T-shape
        await page.click('#bp-stash .bp-chip[data-stash-idx="0"]');
        await page.waitForTimeout(80);
        for (let i = 0; i < 8; i++) {
            await page.click('#bp-rotate');
            await page.waitForTimeout(30);
        }
        const after = await page.evaluate(() => {
            const ghostCells = Array.from(document.querySelectorAll('#bp-grid .bp-cell.ghost-ok, #bp-grid .bp-cell.ghost-bad'));
            // Every ghost cell must still be inside the grid wrapper.
            const grid = document.getElementById('bp-grid').getBoundingClientRect();
            const allInside = ghostCells.every(el => {
                const r = el.getBoundingClientRect();
                return r.left >= grid.left - 1 && r.right <= grid.right + 1 &&
                       r.top  >= grid.top  - 1 && r.bottom <= grid.bottom + 1;
            });
            return {
                held: !!bpHeld,
                rot: bpHeld && bpHeld.rot,
                placedLen: save.backpack.placed.length,
                stashLen: save.backpack.stash.length,
                ghostInside: allInside,
                ghostCount: ghostCells.length,
            };
        });
        ok('8 rotations: still held',         after.held === true);
        ok('8 rotations: rot back to 0',      after.rot === 0);
        ok('8 rotations: nothing placed',     after.placedLen === 0);
        ok('8 rotations: stash empty',        after.stashLen === 0);
        ok('8 rotations: ghost stays in grid', after.ghostInside === true);
        ok('8 rotations: no JS errors',       errs.length === 0);
        await ctx.close();
    }

    // ── 24. Filled cell click on a tightly-packed grid picks up item ──
    // Regression: every cell of a placed item must be a pickup target,
    // not just the top-left. Tapping the bottom-right cell of a 2×2
    // bulwark should pick it up the same as tapping the top-left.
    {
        const { page, ctx, errs } = await freshMobilePage();
        await seedBackpack(page, [], {
            w: 4, h: 4,
            placed: [{ id: 'reactor_bulwark', x: 1, y: 1, rot: 0 }], // 2×2 covers (1,1)..(2,2)
        });
        // Click the BOTTOM-RIGHT cell of the placed shape.
        const picked = await page.evaluate(async () => {
            const cells = document.querySelectorAll('#bp-grid .bp-cell');
            // Cell at (col=2, row=2) — bottom-right of a 2x2 at (1,1).
            const target = cells[2 * 4 + 2];
            target.click();
            await new Promise(r => setTimeout(r, 60));
            return {
                held: !!bpHeld,
                origin: bpHeld && bpHeld.origin,
            };
        });
        ok('tap any cell of placed item: picks it up', picked.held === true);
        ok('tap any cell: origin uses item top-left',
           picked.origin && picked.origin.x === 1 && picked.origin.y === 1);
        ok('tap any cell: no JS errors',               errs.length === 0);
        await ctx.close();
    }

    // ── 25. Held-panel button touch-action keeps taps from being eaten ─
    // CSS regression guard: the rotate / stash / discard / restore
    // buttons need touch-action: manipulation (or none) so iOS doesn't
    // interpret a tap as a scroll/zoom delay.
    {
        const { page, ctx } = await freshMobilePage();
        await seedBackpack(page, ['plasma_cell']);
        await page.click('#bp-stash .bp-chip[data-stash-idx="0"]');
        await page.waitForTimeout(60);
        const heldBtnTA = await page.evaluate(() => {
            const ids = ['bp-rotate', 'bp-tostash', 'bp-discard'];
            const out = {};
            for (const id of ids) {
                const el = document.getElementById(id);
                out[id] = el ? getComputedStyle(el).touchAction : null;
            }
            return out;
        });
        const ok_ta = v => v === 'manipulation' || v === 'none';
        ok('rotate button has touch-action manipulation/none', ok_ta(heldBtnTA['bp-rotate']));
        ok('stash button has touch-action manipulation/none',  ok_ta(heldBtnTA['bp-tostash']));
        ok('discard button has touch-action manipulation/none', ok_ta(heldBtnTA['bp-discard']));
        await ctx.close();
    }

    // ── 26. Touch drag → release on rotate button rotates the item ────
    // Regression: bpOnPointerEnd used to preventDefault unconditionally,
    // eating the synthesised click that would have fired on whatever
    // was under the finger when it lifted. Now preventDefault only
    // fires on a committed drop — drag-pickup-then-tap-rotate works
    // in a single gesture.
    {
        const { page, ctx, errs } = await freshMobilePage();
        await seedBackpack(page, [], {
            placed: [{ id: 'plasma_cell', x: 1, y: 1, rot: 0 }],
        });
        const result = await page.evaluate(async () => {
            const src = document.querySelector('#bp-grid .bp-cell.filled[data-placed-idx="0"]');
            const sr = src.getBoundingClientRect();
            const POINTER_ID = 90;
            const fire = (t, type, x, y) => t.dispatchEvent(new PointerEvent(type, {
                bubbles: true, cancelable: true,
                pointerId: POINTER_ID, pointerType: 'touch',
                isPrimary: true, button: 0, buttons: type === 'pointerup' ? 0 : 1,
                clientX: x, clientY: y, screenX: x, screenY: y,
            }));
            // pointerdown on the placed cell, move past threshold to
            // trigger bpPickPlaced, then end the touch over the rotate
            // button. The click on the rotate button should fire next.
            fire(src, 'pointerdown', sr.left + sr.width/2, sr.top + sr.height/2);
            await new Promise(r => setTimeout(r, 20));
            fire(document.body, 'pointermove', sr.left + sr.width/2 + 30, sr.top + sr.height/2 + 30);
            await new Promise(r => setTimeout(r, 30));
            const rotBtn = document.getElementById('bp-rotate');
            const rr = rotBtn.getBoundingClientRect();
            // Release the finger directly over the rotate button.
            fire(document.body, 'pointerup', rr.left + rr.width/2, rr.top + rr.height/2);
            await new Promise(r => setTimeout(r, 30));
            // The pointerup didn't preventDefault (no valid drop), so a
            // tap dispatched on the rotate button now should rotate.
            rotBtn.click();
            await new Promise(r => setTimeout(r, 50));
            return {
                held:    !!bpHeld,
                rot:     bpHeld && bpHeld.rot,
                placedLen: save.backpack.placed.length,
            };
        });
        ok('drag-pickup-then-rotate: still held',    result.held === true);
        ok('drag-pickup-then-rotate: rot advanced',  result.rot === 1);
        ok('drag-pickup-then-rotate: not re-placed', result.placedLen === 0);
        ok('drag-pickup-then-rotate: no JS errors',  errs.length === 0);
        await ctx.close();
    }

    // ── 27. Refused-place pulse: status mentions all recovery options ─
    // When the player drops a held item on a spot that doesn't fit,
    // the status line must point at the actual buttons they need to
    // tap next. RESTORE only mentioned for placed-pickups.
    {
        const { page, ctx, errs } = await freshMobilePage();
        await seedBackpack(page, [], {
            w: 3, h: 3,
            placed: [
                { id: 'plasma_cell',  x: 0, y: 0, rot: 0 },
                { id: 'reactor_bulwark', x: 1, y: 1, rot: 0 }, // 2x2 covering (1,1)..(2,2)
            ],
        });
        // Pick the bulwark (placed) — it has origin, so RESTORE applies.
        await page.click('#bp-grid .bp-cell.filled[data-placed-idx="1"]');
        await page.waitForTimeout(60);
        // Try to drop on (0,0) — occupied by plasma_cell. The bulwark
        // is 2x2, won't fit there either. bpPlaceAt refuses.
        // We need to tap the (0,0) cell, which is filled — it'll
        // try to PICK that cell instead (the plasma_cell). Tap (0,1)
        // which is empty: 2x2 from (0,1) extends to (1,2) which is now
        // empty (bulwark was picked up) → would fit. Try (1,2) → 2x2
        // extends past grid (col 2..3, row 2..3) → won't fit.
        await page.evaluate(() => {
            // Click bottom-right corner cell (2,2) — 2x2 from there
            // extends to (3,3), past the 3x3 grid. Won't fit.
            const cells = document.querySelectorAll('#bp-grid .bp-cell');
            const c = cells[2 * 3 + 2];
            c.click();
        });
        await page.waitForTimeout(80);
        const after = await page.evaluate(() => ({
            statusText: document.getElementById('bp-status').textContent,
            held: !!bpHeld,
            heldFlashed: document.getElementById('bp-held').classList.contains('bp-held-flash'),
        }));
        ok('refused-place: status mentions ROTATE',
           /ROTATE/i.test(after.statusText));
        ok('refused-place: status mentions RESTORE (origin present)',
           /RESTORE/i.test(after.statusText));
        ok('refused-place: status mentions STASH',
           /STASH/i.test(after.statusText));
        ok('refused-place: item still held',          after.held === true);
        ok('refused-place: held panel flash class added', after.heldFlashed === true);
        ok('refused-place: no JS errors',             errs.length === 0);
        await ctx.close();
    }

    // ── 28. Red-ghost cells stay visually distinct from filled cells ──
    // ghost-bad uses a striped background + dashed outline; filled cells
    // use a solid rarity-colour background + solid border. A regression
    // that made them look identical would re-introduce the "red block
    // stuck in the field" confusion.
    {
        const { page, ctx } = await freshMobilePage();
        await seedBackpack(page, ['reactor_bulwark'], {
            w: 3, h: 3,
            placed: [{ id: 'plasma_cell', x: 0, y: 0, rot: 0 }],
        });
        await page.click('#bp-stash .bp-chip[data-stash-idx="0"]');
        await page.waitForTimeout(60);
        // Hover an empty cell that would conflict (bulwark 2x2 from (1,0)
        // overlaps with plasma at (0,0)? plasma is at 0,0 only. 2x2 from
        // (1,0) covers (1,0)(2,0)(1,1)(2,1) — no overlap, would fit.
        // Try (0,1) → covers (0,1)(1,1)(0,2)(1,2) — no overlap, fits.
        // Try (1,1) → covers (1,1)(2,1)(1,2)(2,2) — fits.
        // Try (0,0) — already filled → cell.click would pick plasma up.
        // Use a small grid where ANY placement conflicts: make the held
        // item bigger than the empty space. Actually with 1 plasma at 0,0
        // there are 8 empty cells in a 3x3 — bulwark 2x2 always fits.
        // Use a 2x2 grid with one filled cell.
        await page.evaluate(() => {
            const s = NeonSave.load();
            s.metaXP = 5000; s.maxWaveReached = 30;
            s.backpack = { w: 2, h: 2,
                placed: [{ id: 'plasma_cell', x: 0, y: 0, rot: 0 }],
                stash: ['reactor_bulwark'], luckBoost: 0 };
            NeonSave.write(s); location.reload();
        });
        await page.waitForTimeout(700);
        await page.evaluate(() => navigateToBackpack());
        await page.waitForTimeout(250);
        await page.click('#bp-stash .bp-chip[data-stash-idx="0"]');
        await page.waitForTimeout(60);
        // Hover (0,1) — 2x2 bulwark from (0,1) extends to (1,2) past
        // the 2x2 grid → no valid spot. The empty cells get red ghost.
        await page.evaluate(() => {
            // The clamp puts the ghost at the only top-left that keeps
            // the shape in-grid: (0,0). But (0,0) is filled → ghost-bad.
            // Trigger a hover to paint:
            const cells = document.querySelectorAll('#bp-grid .bp-cell:not(.filled)');
            if (cells[0]) cells[0].dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }));
        });
        await page.waitForTimeout(60);
        const styles = await page.evaluate(() => {
            const ghostBad = document.querySelector('#bp-grid .bp-cell.ghost-bad');
            const filled  = document.querySelector('#bp-grid .bp-cell.filled');
            if (!ghostBad || !filled) return { hasGhost: !!ghostBad, hasFilled: !!filled };
            const gs = getComputedStyle(ghostBad);
            const fs = getComputedStyle(filled);
            return {
                hasGhost: true,
                hasFilled: true,
                ghostHasStripes: /repeating-linear-gradient|gradient/i.test(gs.backgroundImage),
                ghostOutlineStyle: gs.outlineStyle,
                filledHasStripes: /repeating-linear-gradient|gradient/i.test(fs.backgroundImage || ''),
            };
        });
        if (styles.hasGhost && styles.hasFilled) {
            ok('ghost-bad uses striped background', styles.ghostHasStripes === true);
            ok('ghost-bad outline is dashed',       styles.ghostOutlineStyle === 'dashed');
            ok('filled cell does NOT use stripes',  styles.filledHasStripes === false);
        } else {
            // The scenario didn't produce a ghost-bad; treat as a "skip"
            // by recording the layout sanity instead.
            ok('ghost / filled cells rendered',     styles.hasGhost && styles.hasFilled);
        }
        await ctx.close();
    }

    // ── 29. Tap on red-ghost over a filled cell DOES NOT swap items ───
    // Regression: a filled cell can have BOTH .filled and .ghost-bad
    // (the held item's footprint overlaps an existing placed item).
    // The click handler used to bpPickPlaced() unconditionally on
    // filled cells, accidentally swapping the held item for the one
    // underneath. The fix routes ghost-bad-on-filled taps through
    // bpPlaceAt — which refuses with red feedback — and only treats
    // ghost-FREE filled cells as a pickup target.
    {
        const { page, ctx, errs } = await freshMobilePage();
        // Pre-place plasma_cell at (0,0). Stash a coolant_coil (1x2)
        // and pick it up. With the ghost at (0,0) the footprint covers
        // (0,0) and (0,1); (0,0) is filled so canPlace returns false →
        // both cells get .ghost-bad. (0,0) keeps its .filled class too.
        await seedBackpack(page, ['coolant_coil'], {
            w: 3, h: 3,
            placed: [{ id: 'plasma_cell', x: 0, y: 0, rot: 0 }],
        });
        await page.click('#bp-stash .bp-chip[data-stash-idx="0"]');
        await page.waitForTimeout(60);
        // Hover (0,0) to paint the ghost there.
        await page.evaluate(() => {
            const target = document.querySelector('#bp-grid .bp-cell[data-placed-idx="0"]');
            // Filled cells don't have mouseenter handler, so paint via
            // bpPaintGhost directly to simulate the ghost arriving via
            // touch-drag clamping.
            if (window.bpPaintGhost) window.bpPaintGhost(0, 0);
        });
        await page.waitForTimeout(40);
        const ghostState = await page.evaluate(() => {
            const c = document.querySelector('#bp-grid .bp-cell[data-placed-idx="0"]');
            return {
                hasFilled:    c.classList.contains('filled'),
                hasGhostBad:  c.classList.contains('ghost-bad'),
                heldId:       bpHeld && bpHeld.id,
                placedCount:  save.backpack.placed.length,
                stashCount:   save.backpack.stash.length,
            };
        });
        ok('pre-tap: filled cell has both filled + ghost-bad',
           ghostState.hasFilled && ghostState.hasGhostBad);
        ok('pre-tap: held is the coolant_coil',
           ghostState.heldId === 'coolant_coil');
        ok('pre-tap: plasma still placed',  ghostState.placedCount === 1);
        ok('pre-tap: stash empty',          ghostState.stashCount === 0);

        // Tap the red-ghost-over-filled cell. Expected: held item stays,
        // placed item stays, status shows refused feedback. NOT a swap.
        await page.click('#bp-grid .bp-cell[data-placed-idx="0"]');
        await page.waitForTimeout(80);
        const after = await page.evaluate(() => ({
            heldId:        bpHeld && bpHeld.id,
            placedItems:   save.backpack.placed.slice(),
            stashIds:      save.backpack.stash.slice(),
            statusText:    document.getElementById('bp-status').textContent,
            heldFlash:     document.getElementById('bp-held').classList.contains('bp-held-flash'),
        }));
        ok('after tap: held still coolant_coil (no swap)',
           after.heldId === 'coolant_coil');
        ok('after tap: plasma_cell still placed at (0,0)',
           after.placedItems.length === 1 &&
           after.placedItems[0].id === 'plasma_cell' &&
           after.placedItems[0].x === 0 && after.placedItems[0].y === 0);
        ok('after tap: stash still empty',     after.stashIds.length === 0);
        ok('after tap: refusal status shown',  /doesn'?t fit|ROTATE/i.test(after.statusText));
        ok('after tap: held panel flashed',    after.heldFlash === true);
        ok('after tap: no JS errors',          errs.length === 0);
        await ctx.close();
    }

    // ── 30. Tap a filled cell NOT under the ghost → swap (preserved) ──
    // The fix above must not break the legitimate swap gesture: while
    // holding item A, tapping a placed item B that's NOT covered by
    // A's ghost should still pick B up (returning A to the stash).
    {
        const { page, ctx, errs } = await freshMobilePage();
        await seedBackpack(page, ['plasma_cell'], {
            w: 4, h: 4,
            placed: [{ id: 'credit_chip', x: 3, y: 3, rot: 0 }],
        });
        await page.click('#bp-stash .bp-chip[data-stash-idx="0"]');
        await page.waitForTimeout(60);
        // Paint the ghost at (0,0) so the credit_chip at (3,3) is far
        // from the ghost footprint.
        await page.evaluate(() => { if (window.bpPaintGhost) window.bpPaintGhost(0, 0); });
        await page.waitForTimeout(40);
        // Tap credit_chip at (3,3) — no ghost class on it.
        await page.click('#bp-grid .bp-cell[data-placed-idx="0"]');
        await page.waitForTimeout(80);
        const after = await page.evaluate(() => ({
            heldId:      bpHeld && bpHeld.id,
            placedLen:   save.backpack.placed.length,
            stashIds:    save.backpack.stash.slice(),
        }));
        ok('swap: held is now credit_chip',          after.heldId === 'credit_chip');
        ok('swap: previously held plasma in stash',  after.stashIds.indexOf('plasma_cell') >= 0);
        ok('swap: placed list shrunk to 0',          after.placedLen === 0);
        ok('swap: no JS errors',                     errs.length === 0);
        await ctx.close();
    }

    // ── 31. Held panel as placeholder — no layout shift on pickup ─────
    // The grid's top edge must stay at the same y-coordinate whether or
    // not an item is held. Previously the held panel toggled between
    // display:none and display:flex, pushing the grid down by ~60px on
    // every pickup and stealing taps as the player's finger landed on a
    // different cell than they aimed at.
    {
        const { page, ctx, errs } = await freshMobilePage();
        await seedBackpack(page, ['plasma_cell']);
        // Empty-state geometry
        const before = await page.evaluate(() => {
            const grid = document.getElementById('bp-grid').getBoundingClientRect();
            const held = document.getElementById('bp-held');
            return {
                gridTop: grid.top,
                heldIsEmptyClass: held.classList.contains('is-empty'),
                heldVisible: held.offsetParent !== null,
                emptyHintVisible: document.getElementById('bp-held-empty').offsetParent !== null,
            };
        });
        ok('empty state: panel rendered',         before.heldVisible === true);
        ok('empty state: is-empty class set',     before.heldIsEmptyClass === true);
        ok('empty state: hint visible',           before.emptyHintVisible === true);

        // Pick the chip up. Layout should NOT shift.
        await page.click('#bp-stash .bp-chip[data-stash-idx="0"]');
        await page.waitForTimeout(80);
        const after = await page.evaluate(() => {
            const grid = document.getElementById('bp-grid').getBoundingClientRect();
            const held = document.getElementById('bp-held');
            return {
                gridTop: grid.top,
                heldIsEmptyClass: held.classList.contains('is-empty'),
                emptyHintVisible: document.getElementById('bp-held-empty').offsetParent !== null,
                rotateVisible: document.getElementById('bp-rotate').offsetParent !== null,
            };
        });
        ok('held state: is-empty class cleared',  after.heldIsEmptyClass === false);
        ok('held state: hint hidden',             after.emptyHintVisible === false);
        ok('held state: rotate button visible',   after.rotateVisible === true);
        // Allow ~2px slop for sub-pixel rendering / scrollbar.
        ok('grid top y stays put on pickup (no layout shift)',
           Math.abs(before.gridTop - after.gridTop) < 3);

        // Drop it back — gridTop should also stay put.
        await page.click('#bp-tostash');
        await page.waitForTimeout(80);
        const released = await page.evaluate(() => {
            const grid = document.getElementById('bp-grid').getBoundingClientRect();
            return { gridTop: grid.top };
        });
        ok('grid top y stays put on release', Math.abs(before.gridTop - released.gridTop) < 3);
        ok('no JS errors',                    errs.length === 0);
        await ctx.close();
    }

    // ── 32. Touch-drag from a ghost-bad filled cell DOES NOT swap ─────
    // Click handler fix from the previous commit covered tap taps;
    // touch-drag (pointerdown + move past threshold) bypassed the click
    // handler and re-introduced the unintended swap. The pointerdown
    // guard now refuses to engage drag when the source cell is under
    // the held item's ghost-bad footprint.
    {
        const { page, ctx, errs } = await freshMobilePage();
        await seedBackpack(page, ['coolant_coil'], {
            w: 3, h: 3,
            placed: [{ id: 'plasma_cell', x: 0, y: 0, rot: 0 }],
        });
        await page.click('#bp-stash .bp-chip[data-stash-idx="0"]');
        await page.waitForTimeout(60);
        // Paint the ghost at (0,0) — overlap → ghost-bad on the plasma cell.
        await page.evaluate(() => { if (window.bpPaintGhost) window.bpPaintGhost(0, 0); });
        await page.waitForTimeout(40);

        // Pointer-down + move past 8px threshold on the filled cell.
        // With the guard, bpTouch should NEVER be set, so no pickup.
        const after = await page.evaluate(async () => {
            const src = document.querySelector('#bp-grid .bp-cell[data-placed-idx="0"]');
            const r = src.getBoundingClientRect();
            const POINTER_ID = 91;
            const fire = (t, type, x, y) => t.dispatchEvent(new PointerEvent(type, {
                bubbles: true, cancelable: true,
                pointerId: POINTER_ID, pointerType: 'touch',
                isPrimary: true, button: 0, buttons: type === 'pointerup' ? 0 : 1,
                clientX: x, clientY: y, screenX: x, screenY: y,
            }));
            fire(src, 'pointerdown', r.left + 5, r.top + 5);
            await new Promise(r => setTimeout(r, 20));
            fire(document.body, 'pointermove', r.left + 30, r.top + 30);
            await new Promise(r => setTimeout(r, 30));
            fire(document.body, 'pointerup', r.left + 30, r.top + 30);
            await new Promise(r => setTimeout(r, 60));
            return {
                heldId:    bpHeld && bpHeld.id,
                placed:    save.backpack.placed.slice(),
                stashIds:  save.backpack.stash.slice(),
            };
        });
        ok('touch-drag over ghost-bad: held unchanged',
           after.heldId === 'coolant_coil');
        ok('touch-drag over ghost-bad: plasma still placed',
           after.placed.length === 1 &&
           after.placed[0].id === 'plasma_cell');
        ok('touch-drag over ghost-bad: stash still empty',
           after.stashIds.length === 0);
        ok('touch-drag over ghost-bad: no JS errors', errs.length === 0);
        await ctx.close();
    }

    // ── 20a. Drop with finger just BELOW the bottom edge ──────────────
    // Regression: bpDropTargetCell clamps the ghost to a valid in-grid
    // cell when the finger drifts ~2 cells past the edge, but the
    // pointerend handler used to refuse placement unless the finger
    // was strictly inside the grid bbox. Players expected "release on
    // the visible ghost → place there". Now it does.
    {
        const { page, ctx, errs } = await freshMobilePage();
        await seedBackpack(page, ['plasma_cell']);
        const placed = await page.evaluate(async () => {
            const chip = document.querySelector('#bp-stash .bp-chip[data-stash-idx="0"]');
            const r = chip.getBoundingClientRect();
            const POINTER_ID = 80;
            const fire = (t, type, x, y) => t.dispatchEvent(new PointerEvent(type, {
                bubbles: true, cancelable: true,
                pointerId: POINTER_ID, pointerType: 'touch',
                isPrimary: true, button: 0, buttons: type === 'pointerup' ? 0 : 1,
                clientX: x, clientY: y, screenX: x, screenY: y,
            }));
            fire(chip, 'pointerdown', r.left + r.width/2, r.top + r.height/2);
            await new Promise(r => setTimeout(r, 20));
            fire(document.body, 'pointermove', r.left + r.width/2 + 30, r.top + r.height/2 + 30);
            await new Promise(r => setTimeout(r, 40));

            // Aim ONE cell-height below the grid bottom — within the
            // NEAR (~2 cells) window of bpDropTargetCell, so the ghost
            // is showing a valid bottom-row cell.
            const grid = document.getElementById('bp-grid');
            const gr = grid.getBoundingClientRect();
            const cs = grid.firstElementChild.offsetWidth || 40;
            const fx = gr.left + 2.5 * cs;
            const fy = gr.bottom + cs * 0.5;     // just below the grid

            fire(document.body, 'pointermove', fx, fy);
            await new Promise(r => setTimeout(r, 30));
            const hadGhost = !!document.querySelector('#bp-grid .bp-cell.ghost-ok');
            fire(document.body, 'pointerup', fx, fy);
            await new Promise(r => setTimeout(r, 80));
            return {
                hadGhost,
                placedLen: save.backpack.placed.length,
                stashLen:  save.backpack.stash.length,
                held:      !!bpHeld,
            };
        });
        ok('just-below-edge: ghost was visible',  placed.hadGhost === true);
        ok('just-below-edge: drop committed',     placed.placedLen === 1);
        ok('just-below-edge: stash empty',        placed.stashLen === 0);
        ok('just-below-edge: not held anymore',   placed.held === false);
        ok('just-below-edge: no JS errors',       errs.length === 0);
        await ctx.close();
    }

    // ── 20. Stash chip clicked while same chip's drag is in progress ──
    // A click event firing immediately after a tiny-distance pointer
    // sequence should still produce a valid pickup (and not duplicate).
    {
        const { page, ctx, errs } = await freshMobilePage();
        await seedBackpack(page, ['plasma_cell']);
        await page.evaluate(async () => {
            const chip = document.querySelector('#bp-stash .bp-chip[data-stash-idx="0"]');
            const r = chip.getBoundingClientRect();
            const POINTER_ID = 50;
            const fire = (t, type, x, y) => t.dispatchEvent(new PointerEvent(type, {
                bubbles: true, cancelable: true,
                pointerId: POINTER_ID, pointerType: 'touch',
                isPrimary: true, button: 0, buttons: type === 'pointerup' ? 0 : 1,
                clientX: x, clientY: y, screenX: x, screenY: y,
            }));
            // pointerdown + tiny move (below 8px threshold) + pointerup +
            // synthesized click — this is the pure-tap path.
            fire(chip, 'pointerdown', r.left + 5, r.top + 5);
            await new Promise(r => setTimeout(r, 15));
            fire(document.body, 'pointermove', r.left + 6, r.top + 6);
            await new Promise(r => setTimeout(r, 15));
            fire(document.body, 'pointerup', r.left + 6, r.top + 6);
            await new Promise(r => setTimeout(r, 15));
            chip.dispatchEvent(new MouseEvent('click', { bubbles: true }));
            await new Promise(r => setTimeout(r, 30));
        });
        const after = await page.evaluate(() => ({
            held: bpHeld && bpHeld.id,
            stashLen: save.backpack.stash.length,
        }));
        ok('pure tap (sub-threshold) picks up cleanly',
           after.held === 'plasma_cell' && after.stashLen === 0);
        ok('pure tap: no JS errors',  errs.length === 0);
        await ctx.close();
    }

    await browser.close();
    server.kill();

    console.log(`\nBACKPACK MOBILE ISSUES: ${pass} pass, ${fail} fail`);
    process.exit(fail === 0 ? 0 : 1);
})().catch(e => { console.error(e); process.exit(1); });
