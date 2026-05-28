// Regression: coop fair-play mode strips save-driven advantages
// (mastery perks + backpack stats) so a veteran and a newbie place
// IDENTICAL towers with the same money / damage / fire rate.
//
// User report: "the players have different amounts of money,
// different strength towers". Root cause: tower constructor read
// save.towerMastery directly, applyBackpack added per-player stats
// from save.backpack, tower-cost discount read mastery rank. All
// three now check window.__neonMPFairPlay and bail in MP.
//
// End-to-end via Playwright: open a page with a HEAVY mastery
// profile + a stocked backpack, start a single-player run → tower
// damage is boosted. Then flip __neonMPFairPlay via the test hook
// and restart → same loadout produces the BASELINE tower stats.
const { chromium } = require('playwright');
const { spawn } = require('child_process');
const path = require('path');

(async () => {
    const PORT = 9100 + Math.floor(Math.random() * 90);
    const server = spawn(process.execPath, ['tests/helpers/http-server.js', String(PORT)],
        { cwd: path.join(__dirname, '..'), stdio: 'ignore' });
    await new Promise(r => setTimeout(r, 600));
    const browser = await chromium.launch({ headless: true });
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    // dev-mode flag so the __neonMPSetMode test hook is honoured.
    await ctx.addInitScript(() => { window.__neonAegisDev = true; });
    const page = await ctx.newPage();
    const errs = [];
    page.on('pageerror', e => errs.push(e.message));
    page.on('console', m => {
        if (m.type() !== 'error') return;
        const t = m.text();
        if (/mqtt|websocket|nostr|hivemq|emqx|relay\.verified-nostr/i.test(t)) return;
        errs.push('console: ' + t);
    });
    await page.goto(`http://127.0.0.1:${PORT}/index.html`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(700);
    await page.evaluate(() => { localStorage.setItem('neonPlayerName', 'FP'); });

    let pass = 0, fail = 0;
    function ok(name, cond, extra) {
        if (cond) { console.log('ok', name); pass++; }
        else      { console.log('FAIL', name, extra || ''); fail++; }
    }

    // Seed a heavy mastery profile + stocked backpack (lots of damage +items).
    await page.evaluate(() => {
        save.metaXP = 1e6;
        // High damage-rank mastery on the 'basic' tower.
        save.towerMastery = save.towerMastery || {};
        save.towerMastery.basic = {
            xp: 99999, totalXP: 99999,
            milestones: { m1: true, m2: true },
            perks: { damage: 30, fireRate: 5, efficiency: 0 },   // big damage rank
        };
        // Stuff the backpack with damage-boosting items.
        save.backpack.w = 4; save.backpack.h = 4;
        save.backpack.placed = [
            { id: 'plasma_cell', x: 0, y: 0, rot: 0 },   // +6% damage
            { id: 'plasma_cell', x: 1, y: 0, rot: 0 },   // (allow duplicates here for test purposes)
        ];
        NeonSave.write(save);
    });

    // ── 1) Single-player baseline — mastery + backpack APPLY ─────────
    await page.click('#menu-start-btn'); await page.waitForTimeout(200);
    await page.click('#start-btn');     await page.waitForTimeout(700);
    const spStats = await page.evaluate(() => {
        const g = window.game;
        g.money = 99999;
        for (let c = 0; c < 20; c++) for (let r = 0; r < 15; r++) {
            if (g.map.isBuildable(c, r) && g.buildTower(c, r, 'basic')) {
                const t = g.towers[g.towers.length - 1];
                return { damage: t.damage, mult: g.boonDamageMult };
            }
        }
        return null;
    });
    ok('SP: tower placed', !!spStats);
    ok('SP: mastery + backpack RAISED boonDamageMult above 1',
        spStats && spStats.mult > 1);

    // Capture base damage from TOWERS config for comparison.
    const baseDmg = await page.evaluate(() => TOWERS.basic.damage);
    ok('SP: tower damage > baseline (mastery perks AND backpack apply)',
        spStats && spStats.damage > baseDmg);

    // ── 2) Switch to MP via test hook, restart — fair-play should kick
    // Go to main menu FIRST (this also tears down any prior MP). Then
    // open the run-setup. Then set MP mode RIGHT BEFORE start-btn so
    // the restartGame call reads _activeMode='coop'.
    await page.evaluate(() => navigateToMainMenu());
    await page.waitForTimeout(200);
    await page.click('#menu-start-btn'); await page.waitForTimeout(200);
    await page.evaluate(() => { window.__neonMPSetMode('coop'); });
    await page.click('#start-btn');     await page.waitForTimeout(700);

    const mpFlag = await page.evaluate(() => window.__neonMPFairPlay);
    ok('__neonMPFairPlay set true when MP run starts', mpFlag === true);

    const mpStats = await page.evaluate(() => {
        const g = window.game;
        g.money = 99999;
        for (let c = 0; c < 20; c++) for (let r = 0; r < 15; r++) {
            if (g.map.isBuildable(c, r) && g.buildTower(c, r, 'basic')) {
                const t = g.towers[g.towers.length - 1];
                return { damage: t.damage, mult: g.boonDamageMult, perks: t.masteryPerks };
            }
        }
        return null;
    });
    ok('MP: tower placed', !!mpStats);
    ok('MP: boonDamageMult is 1.0 (backpack skipped)',
        mpStats && Math.abs(mpStats.mult - 1) < 1e-6);
    ok('MP: tower damage == baseline (mastery perks skipped)',
        mpStats && Math.abs(mpStats.damage - baseDmg) < 1e-6);
    ok('MP: tower.masteryPerks all zero',
        mpStats && mpStats.perks &&
        mpStats.perks.damage === 0 && mpStats.perks.fireRate === 0);

    // ── 3) Leaving MP clears the flag, SP run gets bonuses back ─────
    // navigateToMainMenu itself calls __neonLeaveMP which clears
    // _activeMode AND __neonMPFairPlay. Reset the test hook too.
    await page.evaluate(() => { window.__neonMPSetMode(null); });
    await page.evaluate(() => navigateToMainMenu());
    await page.waitForTimeout(200);
    await page.click('#menu-start-btn'); await page.waitForTimeout(200);
    await page.click('#start-btn');     await page.waitForTimeout(700);
    const flagAfter = await page.evaluate(() => window.__neonMPFairPlay);
    ok('__neonMPFairPlay cleared after leaving MP',  flagAfter === false);

    const spAgainStats = await page.evaluate(() => {
        const g = window.game;
        g.money = 99999;
        for (let c = 0; c < 20; c++) for (let r = 0; r < 15; r++) {
            if (g.map.isBuildable(c, r) && g.buildTower(c, r, 'basic')) {
                const t = g.towers[g.towers.length - 1];
                return { damage: t.damage };
            }
        }
        return null;
    });
    ok('SP after MP: mastery damage is back',
        spAgainStats && spAgainStats.damage > baseDmg);

    ok('no JS errors', errs.length === 0, errs.join(' / '));

    await browser.close();
    server.kill();
    console.log(`\nCOOP FAIRPLAY STATS: ${pass} pass, ${fail} fail`);
    process.exit(fail === 0 ? 0 : 1);
})().catch(e => { console.error(e); process.exit(1); });
