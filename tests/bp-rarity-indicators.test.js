// Regression: every backpack item — both in the stash and on the
// placed grid — surfaces a CONSISTENT rarity + tag indication.
//
// Stash chips: name + rarity pill (UPPERCASE letter colour) + one
// tag pill per tag (icon + label). Both pills attached to every
// chip even for plain commons.
//
// Placed grid anchor cell: name letter + rarity-letter badge (C/U/R/
// E/L) + a row of tag-icon glyphs. The earlier UI showed only the
// first letter and a coloured background, which was inconsistent
// between rarities (especially indistinguishable at small sizes).
const { chromium } = require('playwright');
const { spawn } = require('child_process');
const path = require('path');

(async () => {
    const PORT = 8786;
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

    // ── Set up a deterministic stash + placed grid ────────────────────
    // Common (plasma_cell, power) + Uncommon (interest_ledger, econ) +
    // Rare (reactor_bulwark, core 2×2). Stash holds another mix.
    await page.evaluate(() => {
        save.metaXP = 5000;
        save.backpack.w = 6; save.backpack.h = 6;
        save.backpack.placed = [
            { id: 'plasma_cell',     x: 0, y: 0, rot: 0 },
            { id: 'interest_ledger', x: 2, y: 0, rot: 0 },
            { id: 'reactor_bulwark', x: 4, y: 0, rot: 0 },
        ];
        save.backpack.stash = ['credit_chip', 'targeting_core', 'overclock_matrix'];
        NeonSave.write(save);
    });
    await page.click('#menu-backpack-btn');
    await page.waitForSelector('#backpack:not(.hidden)');

    // ── Stash chips ───────────────────────────────────────────────────
    const stashView = await page.evaluate(() => {
        return Array.from(document.querySelectorAll('#bp-stash .bp-chip')).map(chip => ({
            rarityAttr: chip.dataset.rarity || null,
            rarityPill: !!chip.querySelector('.bp-pill-rarity'),
            rarityPillText: (chip.querySelector('.bp-pill-rarity') || {}).textContent || null,
            tagPills:  chip.querySelectorAll('.bp-pill-tag').length,
            tagClasses: Array.from(chip.querySelectorAll('.bp-pill-tag'))
                .map(p => Array.from(p.classList).find(c => c.startsWith('bp-tag-'))),
        }));
    });
    ok('all 3 stash chips render',                stashView.length === 3);
    ok('every chip has rarity attribute',         stashView.every(c => !!c.rarityAttr));
    ok('every chip has a RARITY pill',            stashView.every(c => c.rarityPill === true));
    ok('rarity pills carry uppercase rarity text',
        stashView.every(c => /^(COMMON|UNCOMMON|RARE|EPIC|LEGENDARY)$/.test(c.rarityPillText || '')));
    ok('every chip has at least one TAG pill',    stashView.every(c => c.tagPills >= 1));
    ok('tag pills carry a known tag class',
        stashView.every(c => c.tagClasses.every(cls =>
            ['bp-tag-power','bp-tag-tech','bp-tag-econ','bp-tag-core'].includes(cls))));

    // Specific check: targeting_core has tag 'power' → tag-icon class.
    const targeting = stashView[1];
    ok('targeting_core stash chip carries power tag',
        targeting.tagClasses.includes('bp-tag-power'));

    // ── Placed-grid anchor cells ──────────────────────────────────────
    const anchors = await page.evaluate(() => {
        return Array.from(document.querySelectorAll('#bp-grid .bp-cell.bp-anchor')).map(cell => ({
            rarityAttr: cell.dataset.rarity || null,
            hasRarityBadge: !!cell.querySelector('.bp-rarity-badge'),
            rarityBadgeText: (cell.querySelector('.bp-rarity-badge') || {}).textContent || null,
            tagIconCount: cell.querySelectorAll('.bp-tag-icon').length,
            nameLetter: (cell.querySelector('.bp-name-letter') || {}).textContent || null,
        }));
    });
    ok('all 3 placed items have an anchor cell',  anchors.length === 3);
    ok('every anchor has rarity attribute',       anchors.every(a => !!a.rarityAttr));
    ok('every anchor has a rarity-letter badge',  anchors.every(a => a.hasRarityBadge === true));
    ok('every rarity letter is one of C/U/R/E/L',
        anchors.every(a => ['C','U','R','E','L'].includes(a.rarityBadgeText)));
    ok('every anchor has at least one tag icon',  anchors.every(a => a.tagIconCount >= 1));
    ok('every anchor has a name-letter span',     anchors.every(a => !!a.nameLetter));

    // ── Specific items render the expected rarity letter ──────────────
    // plasma_cell → C, interest_ledger → U, reactor_bulwark → R.
    const byRarity = anchors.map(a => a.rarityBadgeText).sort();
    ok('rarity letters cover C + U + R',
        byRarity.length === 3 && byRarity.includes('C') && byRarity.includes('U') && byRarity.includes('R'));

    // ── Stash + placed consistency ────────────────────────────────────
    // No item in either surface is missing a rarity or tag indicator.
    const allFlagged = await page.evaluate(() => {
        const chips = Array.from(document.querySelectorAll('#bp-stash .bp-chip'));
        const anchors = Array.from(document.querySelectorAll('#bp-grid .bp-cell.bp-anchor'));
        const missing = [];
        for (const c of chips) {
            if (!c.querySelector('.bp-pill-rarity')) missing.push('chip-rarity');
            if (!c.querySelector('.bp-pill-tag'))    missing.push('chip-tag');
        }
        for (const a of anchors) {
            if (!a.querySelector('.bp-rarity-badge')) missing.push('anchor-rarity');
            if (!a.querySelector('.bp-tag-icon'))     missing.push('anchor-tag');
        }
        return missing;
    });
    ok('no chip or anchor is missing rarity / tag indicator',
        allFlagged.length === 0, allFlagged.join(', '));

    ok('no JS errors', errs.length === 0, errs.join(' / '));

    await browser.close();
    server.kill();
    console.log(`\nBP RARITY INDICATORS: ${pass} pass, ${fail} fail`);
    process.exit(fail === 0 ? 0 : 1);
})().catch(e => { console.error(e); process.exit(1); });
