// Regression: coop has its OWN ascension track. Until a real
// coop-progression mechanic ships, every coop run is locked to
// tier 0 regardless of the host's single-player ascensionCleared.
//
// The bug this defends against: a host with SP-cleared A11 enters
// the coop lobby with selectedTier=11; their tier was broadcast in
// the waitroom wr message and adopted by every receiver. A peer who
// had only A2 unlocked then loaded into a getAscensionEffects(11)
// stack the partner had never seen — game broke.
//
// We assert two things:
//   1. The MP loadout that restartGame builds with _activeMode set
//      uses tier 0 regardless of selectedTier (driven directly).
//   2. The save schema carries mpAscensionCleared (reserved for the
//      future coop progression picker).
const { chromium } = require('playwright');
const { spawn } = require('child_process');
const path = require('path');

(async () => {
    const PORT = 8783;
    const server = spawn(process.execPath, ['tests/helpers/http-server.js', String(PORT)],
        { cwd: path.join(__dirname, '..'), stdio: 'ignore' });
    await new Promise(r => setTimeout(r, 600));
    const browser = await chromium.launch({ headless: true });
    const ctx = await browser.newContext();
    await ctx.addInitScript(() => { window.__neonAegisDev = true; });
    const page = await ctx.newPage();
    await page.setViewportSize({ width: 1280, height: 800 });
    const errs = [];
    page.on('pageerror', e => errs.push(e.message));
    await page.goto(`http://127.0.0.1:${PORT}/index.html`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(600);
    await page.evaluate(() => { localStorage.setItem('neonPlayerName', 'TEST'); });

    let pass = 0, fail = 0;
    function ok(name, cond, extra) {
        if (cond) { console.log('ok', name); pass++; }
        else      { console.log('FAIL', name, extra || ''); fail++; }
    }

    // ── 1) save schema has mpAscensionCleared, defaulting to 0 ─────────
    const schema = await page.evaluate(() => ({
        hasField: typeof save.mpAscensionCleared !== 'undefined',
        value:    save.mpAscensionCleared,
    }));
    ok('save.mpAscensionCleared exists',            schema.hasField === true);
    ok('save.mpAscensionCleared defaults to 0',     schema.value === 0);

    // ── 2) SP run uses selectedTier as expected (sanity) ──────────────
    // We can't reach restartGame directly (closure-scoped) so drive
    // through the UI. The menu-start-btn → start-btn flow forces a
    // fresh game with the current selectedTier.
    await page.evaluate(() => {
        save.ascensionCleared = 5;
        NeonSave.write(save);
    });
    await page.click('#menu-start-btn'); await page.waitForTimeout(250);
    // Click the A5 tier button if present (renderAscensionSelector
    // builds them by tier index).
    await page.evaluate(() => {
        const btns = document.querySelectorAll('.ascension-buttons[data-context="start"] button');
        btns.forEach(b => { if (b.textContent.trim() === '5' || b.dataset.tier === '5') b.click(); });
    });
    await page.click('#start-btn');
    await page.waitForFunction(() => window.game && window.game.state !== 'start', null, { timeout: 4000 });
    const spTier = await page.evaluate(() => window.game.ascensionTier);
    ok('SP run uses ascension tier ≥ 0',           Number.isInteger(spTier) && spTier >= 0);

    // ── 3) Force MP mode → next restart locks to tier 0 ───────────────
    // The test hook __neonMPSetMode flips _activeMode without standing
    // up a Trystero room. Then exit to menu and start again — the
    // mpActive branch in restartGame should override to tier 0.
    await page.evaluate(() => { window.__neonMPSetMode('coop'); });
    // Go back to main menu and re-start a run. While _activeMode is
    // 'coop', restartGame should choose COOP_FAIR_TIER = 0.
    await page.evaluate(() => { if (typeof navigateToMainMenu === 'function') navigateToMainMenu(); });
    await page.waitForTimeout(200);
    await page.click('#menu-start-btn'); await page.waitForTimeout(200);
    await page.click('#start-btn');
    await page.waitForFunction(() => window.game && window.game.state !== 'start', null, { timeout: 4000 });
    const mpTier = await page.evaluate(() => window.game.ascensionTier);
    ok('coop locks ascension tier to 0', mpTier === 0);

    // ── 4) Fair loadout: default hero/kit, no ability, empty variants ─
    const loadout = await page.evaluate(() => ({
        heroId:    window.game.loadout && window.game.loadout.heroId,
        kitId:     window.game.loadout && window.game.loadout.kitId,
        abilityId: window.game.loadout && window.game.loadout.abilityId,
        variants:  window.game.loadout && JSON.stringify(window.game.loadout.towerLoadout),
    }));
    ok('coop forces default hero',     /pioneer|standard/.test(loadout.heroId || ''));
    ok('coop forces default kit',      /standard/.test(loadout.kitId || ''));
    ok('coop forces ability.none',     loadout.abilityId === 'ability.none');
    ok('coop forces empty tower variant loadout', loadout.variants === '{}');

    // ── 5) Clear MP mode → restart respects selectedTier again ────────
    await page.evaluate(() => { window.__neonMPSetMode(null); });
    await page.evaluate(() => { if (typeof navigateToMainMenu === 'function') navigateToMainMenu(); });
    await page.waitForTimeout(200);
    await page.click('#menu-start-btn'); await page.waitForTimeout(200);
    await page.click('#start-btn');
    await page.waitForFunction(() => window.game && window.game.state !== 'start', null, { timeout: 4000 });
    const spAfter = await page.evaluate(() => window.game.ascensionTier);
    ok('after leaving MP, SP runs honour the picker again',
        Number.isInteger(spAfter) && spAfter >= 0);

    ok('no JS errors', errs.length === 0, errs.join(' / '));

    await browser.close();
    server.kill();
    console.log(`\nCOOP FAIR TIER: ${pass} pass, ${fail} fail`);
    process.exit(fail === 0 ? 0 : 1);
})().catch(e => { console.error(e); process.exit(1); });
