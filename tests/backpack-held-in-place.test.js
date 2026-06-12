// Feature e2e: held-in-place stash picks. Picking an item from the
// stash list does NOT remove it — the chip stays listed, marked green
// (.bp-chip-held); it leaves the list only when actually PLACED on
// the grid (or sold). TO STASH simply releases the hold.
const { chromium } = require('playwright');
const { spawn } = require('child_process');
const path = require('path');

(async () => {
    const PORT = 9530 + Math.floor(Math.random() * 60);
    const server = spawn(process.execPath, ['tests/helpers/http-server.js', String(PORT)],
        { cwd: path.join(__dirname, '..'), stdio: 'ignore' });
    await new Promise(r => setTimeout(r, 600));
    const browser = await chromium.launch({ headless: true });
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const page = await ctx.newPage();
    const errs = [];
    page.on('pageerror', e => errs.push(e.message));

    let pass = 0, fail = 0;
    function ok(name, cond, extra) {
        if (cond) { console.log('ok', name); pass++; }
        else      { console.log('FAIL', name, extra || ''); fail++; }
    }

    await page.goto(`http://127.0.0.1:${PORT}/index.html`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(700);
    await page.evaluate(() => {
        localStorage.setItem('neonPlayerName', 'HIP');
        save.backpack.stash = ['plasma_cell', 'credit_chip'];
        save.backpack.placed = [];
        NeonSave.write(save);
        document.getElementById('menu-backpack-btn').click();
    });
    await page.waitForTimeout(300);

    // 1) Pick → chip stays, marked green.
    await page.click('#bp-stash .bp-chip[data-stash-idx="0"]');
    await page.waitForTimeout(100);
    const picked = await page.evaluate(() => ({
        stash: save.backpack.stash.slice(),
        chips: document.querySelectorAll('#bp-stash .bp-chip').length,
        heldChip: !!document.querySelector('#bp-stash .bp-chip.bp-chip-held'),
        heldChipIdx: (document.querySelector('#bp-stash .bp-chip.bp-chip-held') || {}).dataset?.stashIdx,
        heldId: bpHeld && bpHeld.id,
    }));
    ok('picked item STAYS in the stash list', picked.stash.length === 2 && picked.chips === 2,
        JSON.stringify(picked));
    ok('picked chip is marked green (.bp-chip-held)', picked.heldChip === true);
    ok('the marked chip is the picked one', picked.heldChipIdx === '0' && picked.heldId === 'plasma_cell');

    // 2) TO STASH → marker cleared, list unchanged.
    await page.click('#bp-tostash');
    await page.waitForTimeout(100);
    const released = await page.evaluate(() => ({
        stash: save.backpack.stash.length,
        marked: !!document.querySelector('#bp-stash .bp-chip.bp-chip-held'),
        held: !!bpHeld,
    }));
    ok('TO STASH releases the hold without duplicating',
        released.stash === 2 && released.marked === false && released.held === false,
        JSON.stringify(released));

    // 3) Place → NOW it leaves the list.
    await page.click('#bp-stash .bp-chip[data-stash-idx="0"]');
    await page.waitForTimeout(80);
    await page.evaluate(() => { bpPlaceAt(0, 0); });
    await page.waitForTimeout(120);
    const placed = await page.evaluate(() => ({
        stash: save.backpack.stash.slice(),
        placed: save.backpack.placed.length,
        chips: document.querySelectorAll('#bp-stash .bp-chip').length,
        marked: !!document.querySelector('#bp-stash .bp-chip.bp-chip-held'),
    }));
    ok('placing removes the item from the stash list',
        placed.stash.length === 1 && placed.chips === 1 && placed.placed === 1,
        JSON.stringify(placed));
    ok('no stale green marker after placing', placed.marked === false);

    // 4) Sell while held → also removed from the list.
    await page.click('#bp-stash .bp-chip[data-stash-idx="0"]');
    await page.waitForTimeout(80);
    await page.click('#bp-discard');        // arm
    await page.waitForTimeout(50);
    await page.click('#bp-discard');        // confirm
    await page.waitForTimeout(120);
    const sold = await page.evaluate(() => ({
        stash: save.backpack.stash.length,
        held: !!bpHeld,
    }));
    ok('selling a held stash item removes it from the list',
        sold.stash === 0 && sold.held === false, JSON.stringify(sold));

    ok('no JS errors', errs.length === 0, errs.join(' / '));

    await browser.close();
    server.kill();
    console.log(`\nBACKPACK HELD-IN-PLACE: ${pass} pass, ${fail} fail`);
    process.exit(fail === 0 ? 0 : 1);
})().catch(e => { console.error(e); process.exit(1); });
