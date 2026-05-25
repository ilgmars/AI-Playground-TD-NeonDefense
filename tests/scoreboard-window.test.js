// Regression: scoreboard surfaces are reachable from the main menu
// and the run-setup screen, AND the +/-3 view actually centres the
// player's row when their best rank is in the middle of the list.
const { chromium } = require('playwright');
const { spawn } = require('child_process');
const path = require('path');

(async () => {
    const PORT = 8778;
    const server = spawn(process.execPath, ['tests/helpers/http-server.js', String(PORT)],
        { cwd: path.join(__dirname, '..'), stdio: 'ignore' });
    await new Promise(r => setTimeout(r, 600));
    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    await page.setViewportSize({ width: 1280, height: 800 });
    const errs = [];
    page.on('pageerror', e => errs.push(e.message));
    await page.goto(`http://127.0.0.1:${PORT}/index.html`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(600);
    await page.evaluate(() => { localStorage.setItem('neonPlayerName', 'ME'); });

    let pass = 0, fail = 0;
    function ok(name, cond, extra) {
        if (cond) { console.log('ok', name); pass++; }
        else      { console.log('FAIL', name, extra || ''); fail++; }
    }

    // ── 1) Main-menu SCOREBOARD button exists and opens overlay ─────
    const menuBtnExists = await page.locator('#menu-scores-btn').count();
    ok('main-menu SCOREBOARD button exists', menuBtnExists === 1);

    // Click via DOM (Playwright's clickability heuristic can fail in
    // headless layouts when a sibling button is at z-index 0).
    await page.evaluate(() => document.getElementById('menu-scores-btn').click());
    await page.waitForTimeout(200);
    const sbVisible = await page.evaluate(() =>
        !document.getElementById('scoreboard-screen').classList.contains('hidden'));
    ok('SCOREBOARD overlay opens from main menu', sbVisible === true);

    // ── 2) Empty state when no scores ───────────────────────────────
    const emptyTxt = await page.locator('#sb-list').innerText();
    ok('empty state rendered', /NO RUNS|NO DATA|SYNCING/.test(emptyTxt));

    await page.evaluate(() => document.getElementById('sb-back-btn').click());
    await page.waitForTimeout(150);
    const sbHidden = await page.evaluate(() =>
        document.getElementById('scoreboard-screen').classList.contains('hidden'));
    ok('BACK closes the overlay', sbHidden === true);

    // ── 3) Setup-screen SCORES button works ─────────────────────────
    await page.evaluate(() => document.getElementById('menu-start-btn').click());
    await page.waitForTimeout(250);
    const setupBtnExists = await page.locator('#setup-scores-btn').count();
    ok('setup-screen SCOREBOARD button exists', setupBtnExists === 1);
    await page.evaluate(() => document.getElementById('setup-scores-btn').click());
    await page.waitForTimeout(200);
    const sb2Visible = await page.evaluate(() =>
        !document.getElementById('scoreboard-screen').classList.contains('hidden'));
    ok('SCOREBOARD opens from run setup', sb2Visible === true);
    await page.evaluate(() => document.getElementById('sb-back-btn').click());
    await page.waitForTimeout(150);

    // ── 4) Seed 10 entries; ME at rank 5 → window shows 3 above + me + 3 below
    await page.evaluate(() => {
        const tier = 0;
        const entries = [];
        // High wave first, so ME (wave 50) lands somewhere middle.
        for (let i = 0; i < 4; i++)  entries.push({ name: 'TOP' + i, wave: 100 - i, retired: false });
        entries.push({ name: 'ME', wave: 50, retired: false });
        for (let i = 0; i < 5; i++)  entries.push({ name: 'LOW' + i, wave: 40 - i, retired: false });
        save.highScores['a' + tier] = entries;
        NeonSave.write(save);
    });
    // Go back to main-menu, then open the scoreboard.
    await page.evaluate(() => navigateToMainMenu());
    await page.waitForTimeout(200);
    await page.evaluate(() => document.getElementById('menu-scores-btn').click());
    await page.waitForTimeout(200);

    const sbView = await page.evaluate(() => {
        const rows = Array.from(document.querySelectorAll('#sb-list .sb-row'));
        const meRow = rows.find(r => r.classList.contains('is-me'));
        const meIdx = rows.indexOf(meRow);
        return {
            count: rows.length,
            meIdxInVisible: meIdx,
            names: rows.map(r => r.querySelector('.sb-name').textContent.trim()),
            myRankText: meRow ? meRow.querySelector('.sb-rank').textContent : null,
        };
    });
    ok('window shows 7 rows around ME',           sbView.count === 7);
    ok('ME row is highlighted',                   sbView.meIdxInVisible >= 0);
    ok('ME row shows correct global rank',        sbView.myRankText === '#5');
    ok('window includes 3 above and 3 below ME',
       sbView.meIdxInVisible === 3,
       `me at index ${sbView.meIdxInVisible} of ${sbView.count}`);

    // ── 5) Autopilot tag renders ────────────────────────────────────
    await page.evaluate(() => {
        save.highScores['a0'] = [{ name: 'BOT', wave: 999, retired: false, autopilot: true }];
        NeonSave.write(save);
        // Re-render via the public hook.
        if (typeof window.openScoreboard === 'function') window.openScoreboard();
    });
    await page.waitForTimeout(150);
    const hasAutoTag = await page.locator('#sb-list .score-autopilot-tag').count();
    ok('autopilot-tagged entry shows AUTO chip', hasAutoTag >= 1);

    ok('no JS errors', errs.length === 0, errs.join(' / '));

    await browser.close();
    server.kill();
    console.log(`\nSCOREBOARD WINDOW: ${pass} pass, ${fail} fail`);
    process.exit(fail === 0 ? 0 : 1);
})().catch(e => { console.error(e); process.exit(1); });
