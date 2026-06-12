// Regression: Mastery Lab must hide perks that have no effect for
// specific tower types.
//
// The bug: every tower row rendered all three perks (damage / fireRate
// / efficiency). XP spent on fireRate for Laser did nothing because
// Laser's fireRate is already 1 (engine min — see entities.js where
// `Math.max(1, …)` floors it). XP spent on damage AND fireRate for
// Relay / Research Node did nothing because those towers don't shoot.
//
// The fix: a per-tower allowlist in renderTowerMastery().
//   - laser            → damage + efficiency
//   - income           → damage (yield) + efficiency
//   - income_research  → damage (aura)  + efficiency
//   - everything else  → all three
//
// We assert it twice:
//   1. logic-level via window.__neonPerksForTower exposed by the render
//      module.
//   2. DOM-level: count the .mastery-perk-row cells under each row and
//      check no `Fire Rate` label exists on the Laser / Relay rows.

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
    const page = await ctx.newPage();
    const errs = [];
    page.on('pageerror', e => errs.push(e.message));
    await page.goto(`http://127.0.0.1:${PORT}/index.html`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(700);

    let pass = 0, fail = 0;
    function ok(name, cond, extra) {
        if (cond) { console.log('ok', name); pass++; }
        else      { console.log('FAIL', name, extra || ''); fail++; }
    }

    // ── 1) Logic helper exposed for tests ────────────────────────────
    // The render call below installs the helper on window. Open the
    // Lab once so renderTowerMastery runs.
    // Mastery Lab lives inside the combined UPGRADES menu now:
    // open UPGRADES (tree tab), then switch to the MASTERY tab.
    await page.click('#menu-tree-btn');
    await page.waitForTimeout(150);
    await page.click('.upg-tab[data-upg-tab="mastery"]');
    await page.waitForTimeout(300);

    const helper = await page.evaluate(() => {
        const f = window.__neonPerksForTower;
        if (typeof f !== 'function') return null;
        return {
            laser:           f('laser'),
            income:          f('income'),
            income_research: f('income_research'),
            basic:           f('basic'),
            sniper:          f('sniper'),
            silo:            f('silo'),
            laser_pulse:     f('laser_pulse'),
        };
    });
    ok('window.__neonPerksForTower exposed', !!helper);
    ok('laser: no fireRate perk',
        helper && !helper.laser.includes('fireRate'));
    ok('laser: has damage + bounty (perk rework)',
        helper && helper.laser.includes('damage') && helper.laser.includes('bounty'));
    ok('income: no fireRate perk',
        helper && !helper.income.includes('fireRate'));
    ok('income: keeps efficiency (its meaningful perk), no bounty (no kills)',
        helper && helper.income.includes('efficiency') && !helper.income.includes('bounty'));
    ok('income_research: no fireRate perk',
        helper && !helper.income_research.includes('fireRate'));
    ok('basic (Blaster): damage + fireRate + bounty (no efficiency — reworked)',
        helper && helper.basic.length === 3 && helper.basic.includes('fireRate') &&
        helper.basic.includes('bounty') && !helper.basic.includes('efficiency'));
    ok('sniper: all three perks',
        helper && helper.sniper.length === 3);
    ok('silo: all three perks (silo fires)',
        helper && helper.silo.includes('fireRate'));
    ok('laser_pulse (variant): keeps fireRate (base fireRate=60, not at cap)',
        helper && helper.laser_pulse.includes('fireRate'));

    // ── 2) DOM check on a couple of rendered rows ────────────────────
    // The Lab renders one row per TOWER_TYPES entry. Find each row by
    // the displayName text in its name cell.
    const rowLabelsHaveFireRate = await page.evaluate(() => {
        const rows = Array.from(document.querySelectorAll('#mastery-grid .mastery-row'));
        const report = {};
        for (const row of rows) {
            const name = (row.querySelector('.mastery-name-row span') || {}).textContent || '?';
            const titles = Array.from(row.querySelectorAll('.mastery-perk-title'))
                .map(t => t.textContent.trim());
            report[name] = titles;
        }
        return report;
    });
    ok('Laser row exists', !!rowLabelsHaveFireRate['Laser']);
    ok('Laser row has NO "Fire Rate" title',
        rowLabelsHaveFireRate['Laser'] &&
        !rowLabelsHaveFireRate['Laser'].includes('Fire Rate'),
        JSON.stringify(rowLabelsHaveFireRate['Laser']));
    ok('Relay row exists', !!rowLabelsHaveFireRate['Relay']);
    ok('Relay row has NO "Fire Rate" title',
        rowLabelsHaveFireRate['Relay'] &&
        !rowLabelsHaveFireRate['Relay'].includes('Fire Rate'),
        JSON.stringify(rowLabelsHaveFireRate['Relay']));
    // Sniper is a normal tower → should keep all three.
    ok('Sniper row keeps Fire Rate',
        rowLabelsHaveFireRate['Sniper'] &&
        rowLabelsHaveFireRate['Sniper'].includes('Fire Rate'),
        JSON.stringify(rowLabelsHaveFireRate['Sniper']));

    ok('no JS errors', errs.length === 0, errs.join(' / '));

    await browser.close();
    server.kill();
    console.log(`\nMASTERY PERK ALLOWLIST: ${pass} pass, ${fail} fail`);
    process.exit(fail === 0 ? 0 : 1);
})().catch(e => { console.error(e); process.exit(1); });
