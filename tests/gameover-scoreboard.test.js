// Regression: the GAME-OVER scoreboard is global-only with the same
// hide-autopilot + hide-cheated filters the dedicated scoreboard
// overlay uses. The old LOCAL / GLOBAL toggle and "show cheated"
// checkbox are gone.
const { chromium } = require('playwright');
const { spawn } = require('child_process');
const path = require('path');

(async () => {
    const PORT = 8802;
    const server = spawn(process.execPath, ['tests/helpers/http-server.js', String(PORT)],
        { cwd: path.join(__dirname, '..'), stdio: 'ignore' });
    await new Promise(r => setTimeout(r, 600));
    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    await page.setViewportSize({ width: 1280, height: 800 });
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
    await page.evaluate(() => { localStorage.setItem('neonPlayerName', 'GOTEST'); });

    let pass = 0, fail = 0;
    function ok(name, cond, extra) {
        if (cond) { console.log('ok', name); pass++; }
        else      { console.log('FAIL', name, extra || ''); fail++; }
    }

    // ── 1) Old LOCAL/GLOBAL toggle and Show-Cheats checkbox are gone
    const gone = await page.evaluate(() => ({
        local:  !!document.getElementById('score-source-local'),
        global: !!document.getElementById('score-source-global'),
        showCheats: !!document.getElementById('score-show-cheats'),
    }));
    ok('LOCAL toggle removed',          gone.local === false);
    ok('GLOBAL toggle removed',         gone.global === false);
    ok('Show-Cheats toggle removed',    gone.showCheats === false);

    // ── 2) New filter checkboxes present in the game-over scoreboard
    const filters = await page.evaluate(() => ({
        goHideAuto:  !!document.getElementById('go-hide-autopilot'),
        goHideCheat: !!document.getElementById('go-hide-cheated'),
        cheatChecked: document.getElementById('go-hide-cheated').checked,
        autoChecked:  document.getElementById('go-hide-autopilot').checked,
    }));
    ok('Hide-Autopilot filter exists',  filters.goHideAuto === true);
    ok('Hide-Cheated filter exists',    filters.goHideCheat === true);
    ok('Hide-Cheated is checked by default',  filters.cheatChecked === true);
    ok('Hide-Autopilot is unchecked by default', filters.autoChecked === false);

    // ── 3) Game-over render: globalish merge + filter behaviour
    await page.evaluate(() => {
        save.highScores['a0'] = [
            { name: 'HUMAN', wave: 50, tier: 0 },
            { name: 'BOT',   wave: 99, tier: 0, autopilot: true },
            { name: 'HACK',  wave: 9999, tier: 0, cheated: true },
        ];
        NeonSave.write(save);
        // Manually trigger the game-over scoreboard render. The
        // production path renders on game-over; we just call the
        // exposed loadScores hook.
        if (typeof window.loadScores === 'function') window.loadScores();
        else if (typeof renderScores === 'function') renderScores(0);
    });
    await page.waitForTimeout(120);
    const initial = await page.evaluate(() =>
        Array.from(document.querySelectorAll('#scores-list > div'))
            .map(el => el.textContent.trim()));
    // Default: hide cheated, show autopilot. So HUMAN + BOT visible,
    // HACK hidden.
    ok('default: HUMAN row visible',  initial.some(t => /HUMAN/.test(t)));
    ok('default: BOT row visible',    initial.some(t => /BOT/.test(t)));
    ok('default: HACK row HIDDEN',    !initial.some(t => /HACK/.test(t)));

    // ── 4) Tick "Hide Autopilot" → BOT vanishes
    await page.evaluate(() => {
        const cb = document.getElementById('go-hide-autopilot');
        cb.checked = true; cb.dispatchEvent(new Event('change'));
    });
    await page.waitForTimeout(80);
    const afterHideAuto = await page.evaluate(() =>
        Array.from(document.querySelectorAll('#scores-list > div'))
            .map(el => el.textContent.trim()));
    ok('Hide Autopilot: BOT row gone',
        !afterHideAuto.some(t => /BOT/.test(t)));
    ok('Hide Autopilot: HUMAN row still visible',
        afterHideAuto.some(t => /HUMAN/.test(t)));

    // ── 5) Untick "Hide Cheated" → HACK appears
    await page.evaluate(() => {
        const cb = document.getElementById('go-hide-cheated');
        cb.checked = false; cb.dispatchEvent(new Event('change'));
    });
    await page.waitForTimeout(80);
    const afterShowCheats = await page.evaluate(() =>
        Array.from(document.querySelectorAll('#scores-list > div'))
            .map(el => el.textContent.trim()));
    ok('Show Cheated: HACK row now visible',
        afterShowCheats.some(t => /HACK/.test(t)));

    // ── 6) Preferences persisted under the SAME localStorage keys the
    //      dedicated scoreboard overlay uses (so they stay aligned).
    const persisted = await page.evaluate(() => ({
        auto:  localStorage.getItem('neonSbHideAuto'),
        cheat: localStorage.getItem('neonSbHideCheated'),
    }));
    ok('autopilot pref persisted as "1" (hidden)',  persisted.auto === '1');
    ok('cheated pref persisted as "0" (shown)',     persisted.cheat === '0');

    ok('no JS errors', errs.length === 0, errs.join(' / '));

    await browser.close();
    server.kill();
    console.log(`\nGAMEOVER SCOREBOARD: ${pass} pass, ${fail} fail`);
    process.exit(fail === 0 ? 0 : 1);
})().catch(e => { console.error(e); process.exit(1); });
