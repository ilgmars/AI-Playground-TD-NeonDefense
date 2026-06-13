// Feature e2e: the combined UPGRADES menu + the perk rework.
//
//   1. ONE main-menu entry (UPGRADES) — the separate MASTERY LAB
//      button is gone; the overlay carries TECH TREE / MASTERY tabs
//      that switch IN PLACE; BACK exits to the main menu no matter
//      how many tab flips happened.
//   2. Bounty perk: kills attributed to a tower type (via
//      Enemy.takeDamage source tagging) pay extra credits,
//      diminishing to +40%; disabled under MP fair-play.
//   3. Migration: shooters' legacy Efficiency ranks become Bounty
//      ranks 1:1; income keeps Efficiency.
const { chromium } = require('playwright');
const { spawn } = require('child_process');
const path = require('path');

(async () => {
    const PORT = 9560 + Math.floor(Math.random() * 60);
    const server = spawn(process.execPath, ['tests/helpers/http-server.js', String(PORT)],
        { cwd: path.join(__dirname, '..'), stdio: 'ignore' });
    await new Promise(r => setTimeout(r, 600));
    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    const errs = [];
    page.on('pageerror', e => errs.push(e.message));

    let pass = 0, fail = 0;
    function ok(name, cond, extra) {
        if (cond) { console.log('ok', name); pass++; }
        else      { console.log('FAIL', name, extra || ''); fail++; }
    }

    await page.goto(`http://127.0.0.1:${PORT}/index.html`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(700);
    await page.evaluate(() => localStorage.setItem('neonPlayerName', 'UPG'));

    // ── 1) One menu entry, tabbed overlay, clean back ───────────────
    const menu = await page.evaluate(() => ({
        upgradesBtn: !!document.getElementById('menu-tree-btn'),
        masteryBtn: !!document.getElementById('menu-mastery-btn'),
        label: (document.getElementById('menu-tree-btn') || {}).textContent || '',
    }));
    ok('single UPGRADES menu entry (mastery button removed)',
        menu.upgradesBtn && !menu.masteryBtn && /UPGRADES/.test(menu.label),
        JSON.stringify(menu));

    await page.click('#menu-tree-btn');
    await page.waitForTimeout(200);
    const opened = await page.evaluate(() => ({
        masteryVisible: !document.getElementById('tower-mastery').classList.contains('hidden'),
        tabs: document.querySelectorAll('#tower-mastery .upg-tabs .upg-tab').length,
        rows: document.querySelectorAll('#mastery-grid .mastery-row').length,
    }));
    ok('UPGRADES opens on the MASTERY tab (default) with a 2-tab strip',
        opened.masteryVisible && opened.tabs === 2 && opened.rows > 0,
        JSON.stringify(opened));

    await page.click('#tower-mastery .upg-tab[data-upg-tab="tree"]');
    await page.waitForTimeout(200);
    const onTree = await page.evaluate(() => ({
        treeVisible: !document.getElementById('tech-tree').classList.contains('hidden'),
        masteryHidden: document.getElementById('tower-mastery').classList.contains('hidden'),
    }));
    ok('TECH TREE tab switches in place',
        onTree.treeVisible && onTree.masteryHidden, JSON.stringify(onTree));

    // Flip back and forth, then BACK must land on the main menu.
    await page.click('#tech-tree .upg-tab[data-upg-tab="mastery"]');
    await page.waitForTimeout(150);
    await page.click('#tower-mastery .upg-tab[data-upg-tab="tree"]');
    await page.waitForTimeout(150);
    await page.click('#tech-tree .upg-tab[data-upg-tab="mastery"]');
    await page.waitForTimeout(150);
    await page.click('#mastery-back-btn');
    await page.waitForTimeout(200);
    const backHome = await page.evaluate(() =>
        !document.getElementById('main-menu').classList.contains('hidden'));
    ok('BACK exits to main menu after tab flips (no stacked history)', backHome === true);

    // ── 2) Bounty payout ────────────────────────────────────────────
    await page.click('#menu-start-btn'); await page.waitForTimeout(200);
    await page.click('#start-btn');     await page.waitForTimeout(700);
    const bounty = await page.evaluate(() => {
        const g = window.game;
        g.state = 'paused';
        g.enemies.length = 0; g.projectiles.length = 0; g.particles.length = 0;
        save.towerMastery.basic.perks.bounty = 50;     // ≈ +31%
        const mult = 1 + 0.4 * (1 - Math.pow(0.97, 50));
        function killOne(tag, fairPlay) {
            window.__neonMPFairPlay = fairPlay;
            const e = new Enemy(g.map.path, 'normal', 1);
            e.hp = 0; e.active = false;
            if (tag) e._lastHitBy = tag;
            g.enemies.push(e);
            const before = g.money;
            g.state = 'playing'; g.update(); g.state = 'paused';
            window.__neonMPFairPlay = false;
            return g.money - before;
        }
        const plain   = killOne(null, false);          // unattributed kill
        const tagged  = killOne('basic', false);       // bounty applies
        const variant = killOne('basic_cryo', false);  // credits base type
        const fair    = killOne('basic', true);        // MP fair-play: off
        save.towerMastery.basic.perks.bounty = 0;
        return { plain, tagged, variant, fair, expect: Math.floor(plain * mult) };
    });
    ok('attributed kill pays the bounty bonus',
        bounty.tagged === bounty.expect && bounty.tagged > bounty.plain,
        JSON.stringify(bounty));
    ok('variant kills credit the BASE type\'s bounty',
        bounty.variant === bounty.expect, JSON.stringify(bounty));
    ok('unattributed kills pay base reward', bounty.plain > 0);
    ok('MP fair-play disables the bounty', bounty.fair === bounty.plain,
        JSON.stringify(bounty));

    // ── 3) Migration: shooter efficiency → bounty; income keeps it ──
    const migrated = await page.evaluate(() => {
        save.towerMastery.sniper.perks = { damage: 2, fireRate: 1, efficiency: 3, bounty: 0 };
        save.towerMastery.income.perks = { damage: 0, fireRate: 0, efficiency: 4, bounty: 0 };
        NeonSave.write(save);
        const re = NeonSave.load();
        return {
            sniper: re.towerMastery.sniper.perks,
            income: re.towerMastery.income.perks,
        };
    });
    ok('shooter legacy efficiency ranks migrate to bounty 1:1',
        migrated.sniper.bounty === 3 && migrated.sniper.efficiency === 0 &&
        migrated.sniper.damage === 2 && migrated.sniper.fireRate === 1,
        JSON.stringify(migrated.sniper));
    ok('income keeps its efficiency ranks',
        migrated.income.efficiency === 4 && migrated.income.bounty === 0,
        JSON.stringify(migrated.income));

    ok('no JS errors', errs.length === 0, errs.join(' / '));

    await browser.close();
    server.kill();
    console.log(`\nUPGRADES MENU: ${pass} pass, ${fail} fail`);
    process.exit(fail === 0 ? 0 : 1);
})().catch(e => { console.error(e); process.exit(1); });
