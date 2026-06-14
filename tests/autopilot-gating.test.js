// Regression: the autopilot only builds towers the PLAYER has unlocked, and
// its repertoire covers every tower (including the tree-unlocked ones).
//
//   • With only the starter towers unlocked (Blaster/Sniper/Flak), the
//     autopilot's wanted-count for every gated type is 0 — so its build
//     selection (which keys entirely off wanted) never targets a locked
//     tower. _isBuildable('laser') is false.
//   • Once everything is unlocked, the wanted-count for the gated towers —
//     INCLUDING the new ones (Mortar/Railgun/Disruptor/Beacon) — is > 0, so
//     the autopilot can and will build them.
const { chromium } = require('playwright');
const { spawn } = require('child_process');
const path = require('path');

(async () => {
    const PORT = 9630 + Math.floor(Math.random() * 30);
    const server = spawn(process.execPath, ['tests/helpers/http-server.js', String(PORT)],
        { cwd: path.join(__dirname, '..'), stdio: 'ignore' });
    await new Promise(r => setTimeout(r, 600));
    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    const errs = [];
    page.on('pageerror', e => errs.push(e.message));
    await page.goto(`http://127.0.0.1:${PORT}/index.html`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(600);

    let pass = 0, fail = 0;
    const ok = (name, cond, extra) => {
        if (cond) { console.log('ok', name); pass++; }
        else      { console.log('FAIL', name, extra || ''); fail++; }
    };

    // _wantedCounts / _isBuildable need only the global save + isTowerUnlocked,
    // so we can probe the gate without starting a run.
    const res = await page.evaluate(() => {
        const ap = new Autopilot({});
        const GATED = TREE_GATED_TOWERS.slice();

        // 1) Starter loadout: strip every tower unlock.
        save.unlockedNodes = (save.unlockedNodes || []).filter(n => !/^tower\./.test(n));
        NeonSave.write(save);
        const locked = ap._wantedCounts(20);
        const laserLockedBuildable = ap._isBuildable('laser');

        // 2) Unlock everything.
        for (const t of GATED) {
            const id = 'tower.' + t;
            if (!save.unlockedNodes.includes(id)) save.unlockedNodes.push(id);
        }
        NeonSave.write(save);
        const unlocked = ap._wantedCounts(20);
        const laserUnlockedBuildable = ap._isBuildable('laser');

        return { GATED, locked, unlocked, laserLockedBuildable, laserUnlockedBuildable };
    });

    // Starter towers always wanted; gated ones zeroed while locked.
    ok('starter towers wanted at start (Blaster/Sniper/Flak)',
        res.locked.basic > 0 && res.locked.sniper > 0 && res.locked.flak > 0, JSON.stringify(res.locked));
    ok('every gated tower has wanted=0 while locked',
        res.GATED.every(t => (res.locked[t] || 0) === 0), JSON.stringify(res.locked));
    ok('_isBuildable("laser") is false while locked', res.laserLockedBuildable === false);

    // After unlocking, gated towers (incl. the new ones) are wanted > 0.
    ok('core gated towers wanted once unlocked (Laser/Rocket/Silo/Tesla/Shotgun/Relay)',
        ['laser', 'rocket', 'silo', 'electric', 'rapid', 'income'].every(t => res.unlocked[t] > 0),
        JSON.stringify(res.unlocked));
    ok('NEW towers wanted once unlocked (Mortar/Railgun/Disruptor/Beacon)',
        ['mortar', 'railgun', 'disruptor', 'beacon'].every(t => res.unlocked[t] > 0),
        JSON.stringify(res.unlocked));
    ok('_isBuildable("laser") is true once unlocked', res.laserUnlockedBuildable === true);

    ok('no JS errors', errs.length === 0, errs.join(' / '));

    await browser.close();
    server.kill();
    console.log(`\nAUTOPILOT GATING: ${pass} pass, ${fail} fail`);
    process.exit(fail === 0 ? 0 : 1);
})().catch(e => { console.error(e); process.exit(1); });
