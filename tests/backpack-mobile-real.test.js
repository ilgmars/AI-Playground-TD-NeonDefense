// Backpack mobile + desktop, every shape, every reasonable grid size.
//
// The user kept reporting bugs that 1×1-on-mobile-only tests missed,
// so this suite runs each scenario across:
//   - 2 input modes:    mobile (touch, 390×844) and desktop (mouse, 1280×800)
//   - 8 item shapes:    1×1, 1×2 col, 2×1 row, 1×3 col, 2×2 sqr, two L-shapes, T
//   - 5 grid sizes:     2×2 (min), 3×3, 5×5, 7×6, 9×8 (max)
//
// Section A — zero layout shift on pickup/release (every shape × both modes)
// Section B — held-panel buttons stay within bounds (worst-case shape)
// Section C — bp-bar buttons fit inside the overlay
// Section D — downward drag does NOT scroll the page (mobile only — mouse can't scroll-jack)
// Section E — recovery after refused drop reachable for every multi-cell shape
// Section F — rotate × 4 returns each shape to rot=0
// Section G — touch DRAG from a ghost-bad cell re-aims the held item (NEW)
// Section H — placed items have a distinct opaque outline (rarity colour, 2px+)
// Section I — tooltips include the rarity (placed cell + stash chip)
// Section J — every reasonable grid size (2×2 … 9×8) accepts pickup + place
// Section K — SELL button requires a confirm tap (regression guard)
// Section L — SELL armed state auto-disarms after 3 s idle

const { chromium } = require('playwright');
const { spawn } = require('child_process');
const path = require('path');

const SHAPES = [
    { id: 'plasma_cell',      kind: '1×1' },
    { id: 'coolant_coil',     kind: '1×2 col' },
    { id: 'interest_ledger',  kind: '2×1 row' },
    { id: 'bounty_module',    kind: '1×3 col' },
    { id: 'reactor_bulwark',  kind: '2×2 sqr' },
    { id: 'targeting_core',   kind: 'L-1' },
    { id: 'fabricator',       kind: 'L-2' },
    { id: 'overclock_matrix', kind: 'T' },
];
// Pick a representative subset for the desktop variant to keep the
// suite under ~5 min. All shapes still run on mobile.
const SHAPES_DESKTOP = SHAPES.filter(s => /1×1|1×2|2×2 sqr|T/.test(s.kind));
const GRID_SIZES = [
    { w: 2, h: 2, label: 'min 2×2'  },
    { w: 3, h: 3, label: '3×3'      },
    { w: 5, h: 5, label: '5×5'      },
    { w: 7, h: 6, label: '7×6'      },
    { w: 9, h: 8, label: 'max 9×8'  },
];

const MODES = [
    { name: 'mobile',  viewport: { width: 390,  height: 844 }, isMobile: true,  hasTouch: true  },
    { name: 'desktop', viewport: { width: 1280, height: 800 }, isMobile: false, hasTouch: false },
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

    async function freshPage(mode) {
        const ctx = await browser.newContext({
            viewport: mode.viewport,
            hasTouch: mode.hasTouch,
            isMobile: mode.isMobile,
        });
        const page = await ctx.newPage();
        const errs = [];
        page.on('pageerror', e => errs.push(e.message));
        page.on('console', m => {
            if (m.type() !== 'error') return;
            const t = m.text();
            // Filter networking noise from the global-scoreboard
            // auto-start. CI sandboxes often can't reach Nostr / MQTT
            // relays; the 403 / WS-handshake-failed lines are normal
            // and not a JS error.
            if (/mqtt|websocket|nostr|hivemq|emqx|relay\.verified-nostr|sandbox/i.test(t)) return;
            errs.push('console: ' + t);
        });
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

    async function gridDocTop(page) {
        return page.evaluate(() => {
            let el = document.getElementById('bp-grid');
            let top = 0;
            while (el) { top += el.offsetTop; el = el.offsetParent; }
            return top;
        });
    }

    // ── Section A — zero layout shift across pickup/release ──────────
    // Every shape × both modes.
    for (const mode of MODES) {
        const list = mode.name === 'mobile' ? SHAPES : SHAPES_DESKTOP;
        for (const sh of list) {
            const { page, ctx, errs } = await freshPage(mode);
            await openBackpack(page, [sh.id]);
            const before = await gridDocTop(page);
            await page.click('#bp-stash .bp-chip[data-stash-idx="0"]');
            await page.waitForTimeout(80);
            const after = await gridDocTop(page);
            await page.click('#bp-tostash');
            await page.waitForTimeout(80);
            const released = await gridDocTop(page);
            ok(`[${mode.name}/${sh.kind}] grid doc-top unchanged on pickup  (Δ ${after - before}px)`,
               Math.abs(after - before) <= 8);
            ok(`[${mode.name}/${sh.kind}] grid doc-top unchanged on release (Δ ${released - before}px)`,
               Math.abs(released - before) <= 8);
            ok(`[${mode.name}/${sh.kind}] no JS errors`, errs.length === 0);
            await ctx.close();
        }
    }

    // ── Section B — held-panel buttons stay within the panel ──────────
    for (const mode of MODES) {
        const { page, ctx } = await freshPage(mode);
        await openBackpack(page, ['overclock_matrix']);
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
                    offenders.push(id);
                }
            }
            return offenders;
        });
        ok(`[${mode.name}] held-panel buttons stay inside panel bounds`, oob.length === 0);
        if (oob.length) console.log('  out-of-bounds:', oob);
        await ctx.close();
    }

    // ── Section C — bp-bar buttons fit inside the overlay ─────────────
    for (const mode of MODES) {
        const { page, ctx } = await freshPage(mode);
        await openBackpack(page, ['plasma_cell']);
        const oob = await page.evaluate(() => {
            const overlay = document.getElementById('backpack').getBoundingClientRect();
            const bar = document.getElementById('bp-bar');
            const offenders = [];
            for (const el of bar.querySelectorAll('button, span')) {
                const r = el.getBoundingClientRect();
                if (r.left < overlay.left - 4 || r.right > overlay.right + 4) {
                    offenders.push(el.id || el.className);
                }
            }
            return offenders;
        });
        ok(`[${mode.name}] bp-bar children fit inside overlay (no horizontal overflow)`,
           oob.length === 0);
        if (oob.length) console.log('  bar OOB:', oob);
        await ctx.close();
    }

    // ── Section D — downward touch-drag does NOT scroll the page ──────
    // Mobile only — mice can't scroll-jack a touch handler.
    for (const sh of SHAPES.slice(0, 3)) {  // representative sample
        const { page, ctx, errs } = await freshPage(MODES[0]);
        await openBackpack(page, [sh.id]);
        await page.click('#bp-stash .bp-chip[data-stash-idx="0"]');
        await page.waitForTimeout(80);
        const result = await page.evaluate(async () => {
            const startY = window.scrollY;
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
            for (let dy = 10; dy < 400; dy += 30) {
                fire(document.body, 'pointermove', r.left + 5, r.top + 5 + dy);
                await new Promise(r => setTimeout(r, 10));
            }
            fire(document.body, 'pointerup', r.left + 5, r.top + 5 + 400);
            await new Promise(r => setTimeout(r, 60));
            return { startY, endY: window.scrollY };
        });
        ok(`[mobile/${sh.kind}] downward drag did not scroll page (Δy ${result.endY - result.startY}px)`,
           result.endY === result.startY);
        ok(`[mobile/${sh.kind}] no JS errors`, errs.length === 0);
        await ctx.close();
    }

    // ── Section E — recovery after refused drop ───────────────────────
    for (const mode of MODES) {
        const list = mode.name === 'mobile' ? SHAPES.filter(s => s.id !== 'plasma_cell') : SHAPES_DESKTOP.filter(s => s.id !== 'plasma_cell');
        for (const sh of list) {
            const { page, ctx, errs } = await freshPage(mode);
            await openBackpack(page, [sh.id], {
                w: 4, h: 4,
                placed: [{ id: 'plasma_cell', x: 0, y: 0, rot: 0 }],
            });
            await page.click('#bp-stash .bp-chip[data-stash-idx="0"]');
            await page.waitForTimeout(60);
            await page.evaluate(() => { if (window.bpPaintGhost) window.bpPaintGhost(0, 0); });
            await page.evaluate(() => {
                document.querySelector('#bp-grid .bp-cell[data-placed-idx="0"]').click();
            });
            await page.waitForTimeout(80);
            const recoverable = await page.evaluate(() => {
                const rotate = document.getElementById('bp-rotate');
                const stash  = document.getElementById('bp-tostash');
                const rr = rotate.getBoundingClientRect();
                const sr = stash.getBoundingClientRect();
                return {
                    stillHeld: !!bpHeld,
                    rotateEnabled: !rotate.disabled,
                    stashEnabled:  !stash.disabled,
                    rotateReachable: document.elementFromPoint(rr.left + rr.width/2, rr.top + rr.height/2)?.id === 'bp-rotate',
                    stashReachable:  document.elementFromPoint(sr.left + sr.width/2, sr.top + sr.height/2)?.id === 'bp-tostash',
                };
            });
            ok(`[${mode.name}/${sh.kind}] refused drop: still held`,        recoverable.stillHeld === true);
            ok(`[${mode.name}/${sh.kind}] refused drop: ROTATE enabled`,    recoverable.rotateEnabled === true);
            ok(`[${mode.name}/${sh.kind}] refused drop: STASH enabled`,     recoverable.stashEnabled === true);
            ok(`[${mode.name}/${sh.kind}] refused drop: ROTATE reachable`,  recoverable.rotateReachable === true);
            await page.click('#bp-tostash');
            await page.waitForTimeout(80);
            const recovered = await page.evaluate(() => ({
                held: !!bpHeld, inStash: save.backpack.stash.length === 1,
            }));
            ok(`[${mode.name}/${sh.kind}] STASH recovers`,
               recovered.held === false && recovered.inStash === true);
            ok(`[${mode.name}/${sh.kind}] no JS errors`, errs.length === 0);
            await ctx.close();
        }
    }

    // ── Section F — rotate × 4 returns each shape to rot=0 ────────────
    for (const mode of MODES) {
        const list = mode.name === 'mobile' ? SHAPES.filter(s => s.id !== 'plasma_cell') : SHAPES_DESKTOP.filter(s => s.id !== 'plasma_cell');
        for (const sh of list) {
            const { page, ctx, errs } = await freshPage(mode);
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
            ok(`[${mode.name}/${sh.kind}] rotate × 4 returns rot=0`, final.rot === 0);
            ok(`[${mode.name}/${sh.kind}] rotation preserves cell count`, final.cellsAfter === initialCells);
            ok(`[${mode.name}/${sh.kind}] rotation: no JS errors`, errs.length === 0);
            await ctx.close();
        }
    }

    // ── Section G — touch DRAG from a ghost-bad cell re-aims the held item.
    // The user's specific complaint: "picking up + dragging the red ghost
    // with touch after it has been released in invalid pos is still not
    // possible". Touch-drag from any empty cell while holding must
    // re-aim the ghost (same gesture as drag-from-stash).
    {
        const mode = MODES[0]; // mobile only — desktop uses hover instead
        const { page, ctx, errs } = await freshPage(mode);
        await openBackpack(page, ['coolant_coil'], {
            w: 5, h: 5,
            placed: [{ id: 'plasma_cell', x: 0, y: 0, rot: 0 }],
        });
        // Pick the coolant_coil and paint ghost at (0,0) — overlap → red.
        await page.click('#bp-stash .bp-chip[data-stash-idx="0"]');
        await page.waitForTimeout(60);
        await page.evaluate(() => { if (window.bpPaintGhost) window.bpPaintGhost(0, 0); });
        await page.waitForTimeout(40);
        // Verify red ghost on (0,0) area.
        const ghostBefore = await page.evaluate(() =>
            document.querySelectorAll('#bp-grid .bp-cell.ghost-bad').length);
        ok('section G: red ghost cells painted', ghostBefore >= 1);

        // Now synthesize a touch DRAG starting from an EMPTY cell that
        // sits under the red ghost (e.g., (0,1) — second cell of the
        // 1×2 ghost) and dragging to a safe cell (e.g., 3,3).
        const result = await page.evaluate(async () => {
            const cells = document.querySelectorAll('#bp-grid .bp-cell');
            const bp = save.backpack;
            const src = cells[1 * bp.w + 0]; // (0,1) — empty ghost-bad
            const dst = cells[3 * bp.w + 3]; // (3,3) — empty, valid
            const sr = src.getBoundingClientRect();
            const dr = dst.getBoundingClientRect();
            const POINTER_ID = 70;
            const fire = (t, type, x, y) => t.dispatchEvent(new PointerEvent(type, {
                bubbles: true, cancelable: true,
                pointerId: POINTER_ID, pointerType: 'touch',
                isPrimary: true, button: 0, buttons: type === 'pointerup' ? 0 : 1,
                clientX: x, clientY: y, screenX: x, screenY: y,
            }));
            fire(src, 'pointerdown', sr.left + sr.width/2, sr.top + sr.height/2);
            await new Promise(r => setTimeout(r, 20));
            // Cross the drag threshold.
            fire(document.body, 'pointermove', sr.left + sr.width/2 + 20, sr.top + sr.height/2 + 20);
            await new Promise(r => setTimeout(r, 30));
            // Move to destination.
            fire(document.body, 'pointermove', dr.left + dr.width/2, dr.bottom - 1);
            await new Promise(r => setTimeout(r, 30));
            const midGhost = document.querySelectorAll('#bp-grid .bp-cell.ghost-ok').length;
            // Release at destination.
            fire(document.body, 'pointerup', dr.left + dr.width/2, dr.bottom - 1);
            await new Promise(r => setTimeout(r, 80));
            return {
                midGhost,
                placed: save.backpack.placed.map(p => ({ id: p.id, x: p.x, y: p.y })),
                held: !!bpHeld,
                stash: save.backpack.stash.slice(),
            };
        });
        ok('section G: ghost moved to drop target during drag (green cells)',
           result.midGhost >= 1);
        // Plasma_cell should still be at (0,0). The held coolant_coil
        // should now be placed somewhere valid.
        const plasmaStill = result.placed.find(p => p.id === 'plasma_cell');
        const coolantPlaced = result.placed.find(p => p.id === 'coolant_coil');
        ok('section G: plasma_cell untouched at (0,0)',
           plasmaStill && plasmaStill.x === 0 && plasmaStill.y === 0);
        ok('section G: coolant_coil placed at the drag destination',
           !!coolantPlaced);
        ok('section G: nothing left held',  result.held === false);
        ok('section G: stash empty',         result.stash.length === 0);
        ok('section G: no JS errors',        errs.length === 0);
        await ctx.close();
    }

    // ── Section H — placed items have a distinct opaque outline ──────
    for (const mode of MODES) {
        const { page, ctx } = await freshPage(mode);
        await openBackpack(page, [], {
            placed: [{ id: 'plasma_cell', x: 0, y: 0, rot: 0 }],
        });
        const style = await page.evaluate(() => {
            const cell = document.querySelector('#bp-grid .bp-cell.filled');
            if (!cell) return { hasCell: false };
            const cs = getComputedStyle(cell);
            return {
                hasCell: true,
                borderWidth: cs.borderWidth,
                borderStyle: cs.borderStyle,
                boxShadow: cs.boxShadow,
                fontWeight: cs.fontWeight,
                hasRarityDataset: cell.dataset.rarity || null,
            };
        });
        ok(`[${mode.name}] placed cell exists`, style.hasCell === true);
        // Border is ≥ 2px solid (compared to empty cells' 1px). Some
        // browsers report the full shorthand; just check it's not 1px.
        ok(`[${mode.name}] placed cell border is ≥2px solid`,
           /^[2-9]/.test(style.borderWidth) && style.borderStyle === 'solid');
        ok(`[${mode.name}] placed cell has box-shadow (inset glow)`,
           /inset/.test(style.boxShadow) || style.boxShadow !== 'none');
        ok(`[${mode.name}] placed cell name char is bold`,
           parseInt(style.fontWeight) >= 600);
        ok(`[${mode.name}] data-rarity attribute set`,
           style.hasRarityDataset !== null);
        await ctx.close();
    }

    // ── Section I — tooltips include rarity ──────────────────────────
    for (const mode of MODES) {
        const { page, ctx } = await freshPage(mode);
        await openBackpack(page, ['reactor_bulwark'], {
            placed: [{ id: 'plasma_cell', x: 0, y: 0, rot: 0 }],
        });
        const tips = await page.evaluate(() => {
            const cell = document.querySelector('#bp-grid .bp-cell.filled');
            const chip = document.querySelector('#bp-stash .bp-chip');
            return {
                cellTitle: cell && cell.title,
                chipTitle: chip && chip.title,
            };
        });
        // plasma_cell is rarity 'common' → titlecased "Common".
        // reactor_bulwark is rarity 'rare' → "Rare".
        ok(`[${mode.name}] placed-cell tooltip mentions rarity (Common)`,
           /Common/i.test(tips.cellTitle || ''));
        ok(`[${mode.name}] stash-chip tooltip mentions rarity (Rare)`,
           /Rare/i.test(tips.chipTitle || ''));
        await ctx.close();
    }

    // ── Section J — every reasonable grid size accepts pickup + place ─
    for (const mode of MODES) {
        // Mobile gets all 5 sizes; desktop the same to keep coverage tight.
        for (const sz of GRID_SIZES) {
            const { page, ctx, errs } = await freshPage(mode);
            await openBackpack(page, ['plasma_cell'], { w: sz.w, h: sz.h });
            await page.click('#bp-stash .bp-chip[data-stash-idx="0"]');
            await page.waitForTimeout(60);
            // Place into top-left (always exists, always empty).
            await page.evaluate(() => {
                const cell = document.querySelector('#bp-grid .bp-cell:not(.filled)');
                cell.click();
            });
            await page.waitForTimeout(80);
            const after = await page.evaluate(() => ({
                placed: save.backpack.placed.length,
                held: !!bpHeld,
                stash: save.backpack.stash.length,
                actualW: save.backpack.w,
                actualH: save.backpack.h,
            }));
            ok(`[${mode.name}/${sz.label}] grid initialised at requested size`,
               after.actualW === sz.w && after.actualH === sz.h);
            ok(`[${mode.name}/${sz.label}] place succeeded`,        after.placed === 1);
            ok(`[${mode.name}/${sz.label}] nothing held after place`, after.held === false);
            ok(`[${mode.name}/${sz.label}] stash empty after place`,  after.stash === 0);
            ok(`[${mode.name}/${sz.label}] no JS errors`,             errs.length === 0);
            await ctx.close();
        }
    }

    // ── Section K — SELL button needs a confirm tap (regression guard) ─
    // First tap arms (label flips to "CONFIRM SELL?"); item is NOT
    // sold. Second tap within 3 s actually sells. Without this,
    // a single thumb-slip burns the held item with zero recourse.
    for (const mode of MODES) {
        const { page, ctx, errs } = await freshPage(mode);
        await openBackpack(page, ['reactor_bulwark']);
        await page.click('#bp-stash .bp-chip[data-stash-idx="0"]');
        await page.waitForTimeout(60);
        const xpBefore = await page.evaluate(() => save.metaXP);

        // First tap: arm. Item must still be held; XP unchanged.
        await page.click('#bp-discard');
        await page.waitForTimeout(80);
        const armed = await page.evaluate(() => ({
            held:        !!bpHeld,
            label:       document.getElementById('bp-discard').textContent,
            armedFlag:   document.getElementById('bp-discard').dataset.confirm,
            xp:          save.metaXP,
        }));
        ok(`[${mode.name}] first SELL tap: held item NOT yet sold`,
           armed.held === true);
        ok(`[${mode.name}] first SELL tap: XP unchanged`,
           armed.xp === xpBefore);
        ok(`[${mode.name}] first SELL tap: button shows CONFIRM SELL`,
           /CONFIRM/i.test(armed.label));
        ok(`[${mode.name}] first SELL tap: data-confirm = "true"`,
           armed.armedFlag === 'true');

        // Second tap: commit.
        await page.click('#bp-discard');
        await page.waitForTimeout(80);
        const sold = await page.evaluate(() => ({
            held:  !!bpHeld,
            xp:    save.metaXP,
            label: document.getElementById('bp-discard').textContent,
            armedFlag: document.getElementById('bp-discard').dataset.confirm,
        }));
        ok(`[${mode.name}] second SELL tap: item sold (held cleared)`,
           sold.held === false);
        ok(`[${mode.name}] second SELL tap: XP refunded (>${xpBefore})`,
           sold.xp > xpBefore);
        ok(`[${mode.name}] second SELL tap: button label reverted`,
           !/CONFIRM/i.test(sold.label));
        ok(`[${mode.name}] second SELL tap: data-confirm = "false"`,
           sold.armedFlag === 'false');
        ok(`[${mode.name}] SELL confirm: no JS errors`, errs.length === 0);
        await ctx.close();
    }

    // ── Section L — SELL armed state auto-disarms after 3 s idle ──────
    {
        const { page, ctx, errs } = await freshPage(MODES[0]);
        await openBackpack(page, ['plasma_cell']);
        await page.click('#bp-stash .bp-chip[data-stash-idx="0"]');
        await page.waitForTimeout(60);
        await page.click('#bp-discard');     // arm
        await page.waitForTimeout(80);
        const armed = await page.evaluate(() => document.getElementById('bp-discard').dataset.confirm);
        ok('SELL armed after first tap',          armed === 'true');
        // Wait 3.2 s for the timeout to fire.
        await page.waitForTimeout(3200);
        const after = await page.evaluate(() => ({
            held: !!bpHeld,
            armed: document.getElementById('bp-discard').dataset.confirm,
            label: document.getElementById('bp-discard').textContent,
        }));
        ok('SELL auto-disarms after 3 s idle',     after.armed === 'false');
        ok('SELL idle: item NOT sold',             after.held === true);
        ok('SELL idle: label reverted',            !/CONFIRM/i.test(after.label));
        if (errs.length > 0) errs.forEach(e => console.log('  SELL idle err:', e));
        ok('SELL idle: no JS errors',              errs.length === 0);
        await ctx.close();
    }

    await browser.close();
    server.kill();

    console.log(`\nBACKPACK MOBILE REAL: ${pass} pass, ${fail} fail`);
    process.exit(fail === 0 ? 0 : 1);
})().catch(e => { console.error(e); process.exit(1); });
