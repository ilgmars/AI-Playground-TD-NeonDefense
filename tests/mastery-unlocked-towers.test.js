// Regression: the Mastery Lab lists ONLY unlocked towers and INCLUDES the
// tech-tree towers (which used to be missing entirely — they weren't in
// NeonSave.TOWER_TYPES, so they never got a row and never accrued XP).
//
//   • A fresh save shows the always-available core towers and hides the
//     tree-gated ones (Relay + the new tree towers), with a "🔒 N more …"
//     note so the short list doesn't read as a bug.
//   • Unlocking a tree tower (its 'tower.X' grant in save.unlockedNodes)
//     makes its Mastery row appear and drops the locked count.
const { chromium } = require('playwright');
const { spawn } = require('child_process');
const path = require('path');

(async () => {
    const PORT = 9680 + Math.floor(Math.random() * 30);
    const server = spawn(process.execPath, ['tests/helpers/http-server.js', String(PORT)],
        { cwd: path.join(__dirname, '..'), stdio: 'ignore' });
    await new Promise(r => setTimeout(r, 600));
    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    const errs = [];
    page.on('pageerror', e => errs.push(e.message));

    let pass = 0, fail = 0;
    const ok = (name, cond, extra) => {
        if (cond) { console.log('ok', name); pass++; }
        else      { console.log('FAIL', name, extra || ''); fail++; }
    };

    await page.goto(`http://127.0.0.1:${PORT}/index.html`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(600);

    // ── 1) Fresh save: core towers shown, tree-gated ones hidden ──────────
    const fresh = await page.evaluate(() => {
        // Mutate the LIVE module save (renderTowerMastery reads it directly),
        // not a fresh load() copy.
        save.metaXP = 100000;
        save.maxWaveReached = 40;
        save.unlockedNodes = (save.unlockedNodes || []).filter(n => !/^tower\./.test(n)); // ensure none unlocked
        NeonSave.write(save);
        navigateToTowerMastery();
        const rows = [...document.querySelectorAll('#mastery-grid .mastery-row')];
        const names = rows.map(r => r.querySelector('.mastery-name-row span').textContent.trim());
        const note = document.querySelector('.mastery-locked-note');
        return {
            names,
            hasMortar: names.some(n => /Mortar/i.test(n)),
            hasRelay: names.some(n => /Relay/i.test(n)),
            hasBlaster: names.some(n => /Blaster/i.test(n)),
            hasSniper: names.some(n => /Sniper/i.test(n)),
            noteText: note ? note.textContent : null,
        };
    });
    ok('core towers (Blaster, Sniper) are shown', fresh.hasBlaster && fresh.hasSniper, JSON.stringify(fresh.names));
    ok('tree-gated Mortar hidden until unlocked', fresh.hasMortar === false);
    ok('tree-gated Relay hidden until unlocked', fresh.hasRelay === false);
    // Only Blaster + Sniper + Flak are free, so 10 towers are gated.
    ok('locked-towers note names the count', !!fresh.noteText && /\b10\b/.test(fresh.noteText) && /Tech Tree/i.test(fresh.noteText),
        JSON.stringify({ note: fresh.noteText }));

    // ── 2) Unlock Mortar → its row appears, locked count drops ────────────
    const unlocked = await page.evaluate(() => {
        save.unlockedNodes = (save.unlockedNodes || []).concat(['tower.mortar']);
        NeonSave.write(save);
        navigateToMainMenu();
        navigateToTowerMastery();
        const rows = [...document.querySelectorAll('#mastery-grid .mastery-row')];
        const names = rows.map(r => r.querySelector('.mastery-name-row span').textContent.trim());
        const note = document.querySelector('.mastery-locked-note');
        return { hasMortar: names.some(n => /Mortar/i.test(n)), noteText: note ? note.textContent : null };
    });
    ok('unlocked Mortar now appears in the Mastery Lab', unlocked.hasMortar === true);
    ok('locked count drops to 9 after unlocking one', !!unlocked.noteText && /\b9\b/.test(unlocked.noteText),
        JSON.stringify({ note: unlocked.noteText }));

    // ── 3) Tree towers are registered in the mastery roster ───────────────
    const roster = await page.evaluate(() => NeonSave.TOWER_TYPES.slice());
    ok('mastery roster includes the tree towers',
        ['mortar', 'disruptor', 'railgun', 'beacon'].every(t => roster.includes(t)), JSON.stringify(roster));

    // ── 4) Build menu gating: only Blaster + Sniper + Flak free ───────────
    const buildMenu = await page.evaluate(() => {
        save.unlockedNodes = (save.unlockedNodes || []).filter(n => !/^tower\./.test(n)); // clean slate
        NeonSave.write(save);
        updateBuildMenuForLoadout({});
        const vis = (t) => {
            const el = document.querySelector(`.tower-option[data-type="${t}"]`);
            return !!el && !el.classList.contains('tt-tower-locked');
        };
        return {
            basic: vis('basic'), sniper: vis('sniper'), flak: vis('flak'),
            rapid: vis('rapid'), laser: vis('laser'), rocket: vis('rocket'),
            electric: vis('electric'), silo: vis('silo'), income: vis('income'),
        };
    });
    ok('free at start: Blaster + Sniper + Flak buildable',
        buildMenu.basic && buildMenu.sniper && buildMenu.flak, JSON.stringify(buildMenu));
    ok('gated until unlocked: Shotgun/Laser/Rocket/Tesla/Silo/Relay hidden',
        !buildMenu.rapid && !buildMenu.laser && !buildMenu.rocket &&
        !buildMenu.electric && !buildMenu.silo && !buildMenu.income, JSON.stringify(buildMenu));

    ok('no JS errors', errs.length === 0, errs.join(' / '));

    await browser.close();
    server.kill();
    console.log(`\nMASTERY UNLOCKED TOWERS: ${pass} pass, ${fail} fail`);
    process.exit(fail === 0 ? 0 : 1);
})().catch(e => { console.error(e); process.exit(1); });
