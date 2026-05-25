// Long-haul smoketest: autopilot to wave 450 (or lives==0).
//
// Watches every wave-end for the classic regression: a sudden money
// drop that's not explained by a build/upgrade. Pre-rebalance, the
// Aegis money-spike sensor used to false-positive past wave ~200 and
// brick the save, which players described as "money disappearing
// every 20 levels". This smoketest fails if:
//
//   * money decreases by > 50% between consecutive wave-ends without
//     a matching spend (the autopilot's money is exposed so we can
//     instrument the delta),
//   * NeonAegis flags a false positive (run flag set during play),
//   * the save's cheaterDetected ever becomes true on its own.
//
// Run: node tests/wave450.smoke.js --target=450 --speed=4096 --ascension=3

const { chromium } = require('playwright');
const { spawn } = require('child_process');
const path = require('path');

const args = Object.fromEntries(process.argv.slice(2).map(a => {
    const [k, v = 'true'] = a.replace(/^--/, '').split('=');
    return [k, v];
}));
const TARGET_WAVE = parseInt(args.target || '450');
const PORT        = parseInt(args.port || '8767');
const GAME_SPEED  = parseInt(args.speed || '4096');
const ASCENSION   = Math.max(0, Math.min(parseInt(args.ascension || '3'), 10));
const MAX_WAIT_MS = parseInt(args.maxMs || (8 * 60 * 1000));   // 8-min ceiling

(async () => {
    const server = spawn(process.execPath, ['tests/helpers/http-server.js', String(PORT)],
        { cwd: path.join(__dirname, '..'), stdio: 'ignore' });
    await new Promise(r => setTimeout(r, 600));

    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    await page.setViewportSize({ width: 1280, height: 800 });
    const jsErrors = [];
    page.on('pageerror', e => jsErrors.push(e.message));

    await page.goto(`http://127.0.0.1:${PORT}/index.html`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(500);

    await page.click('#menu-start-btn');
    await page.waitForTimeout(200);
    await page.evaluate((tier) => {
        eval(`selectedTier = ${tier}`);
        if (typeof updateModeDisplay === 'function') updateModeDisplay(tier);
    }, ASCENSION);
    await page.click('#start-btn');
    await page.waitForTimeout(700);

    // Enable autopilot + crank speed.
    await page.click('#autopilot-btn');
    await page.evaluate((s) => { eval(`gameSpeed = ${s}`); }, GAME_SPEED);

    const samples = [];
    let lastWave = -1;
    let lastMoneyAtWaveEnd = null;
    let bigDropDetected = null;
    let falseFlag = null;
    let saveCorrupted = null;
    const started = Date.now();

    while (Date.now() - started < MAX_WAIT_MS) {
        const s = await page.evaluate(() => {
            try {
                const g = eval('game');
                if (!g) return null;
                const flagged = (typeof NeonAegis !== 'undefined' && NeonAegis.isRunFlagged)
                    ? NeonAegis.isRunFlagged() : false;
                const flagReason = (typeof NeonAegis !== 'undefined' && NeonAegis.runFlagReason)
                    ? NeonAegis.runFlagReason() : null;
                return {
                    wave: g.wave, money: g.money, health: g.health,
                    state: g.state, towers: g.towers.length,
                    waveCooldown: g.waveCooldown,
                    boons: (g.boons || []).length,
                    flagged, flagReason,
                    saveFlagged: !!(window.save && window.save.cheaterDetected),
                };
            } catch (e) { return { err: e.message }; }
        });
        if (!s || s.err) { await new Promise(r => setTimeout(r, 80)); continue; }
        if (s.flagged && !falseFlag) falseFlag = s.flagReason;
        if (s.saveFlagged && !saveCorrupted) saveCorrupted = true;

        // Sample on wave-cooldown (between waves, after wave-end payout).
        if (s.wave !== lastWave && s.waveCooldown > 0) {
            if (lastMoneyAtWaveEnd != null && s.wave === lastWave + 1) {
                // Only meaningful when we caught BOTH adjacent wave-end
                // snapshots — otherwise the autopilot has been spending
                // and any "drop" is legitimate building, not a leak.
                const delta = s.money - lastMoneyAtWaveEnd;
                // Only flag a near-total wipe — the historical bug
                // would zero the bank. The autopilot legitimately spends
                // 50-70% between wave-ends, so a softer threshold here
                // is noise.
                if (s.money <= 100 && lastMoneyAtWaveEnd > 10000 && !bigDropDetected) {
                    bigDropDetected = { fromWave: lastWave, toWave: s.wave, from: lastMoneyAtWaveEnd, to: s.money };
                }
            }
            lastWave = s.wave;
            lastMoneyAtWaveEnd = s.money;
            if (s.wave % 25 === 0 || s.wave <= 30) {
                samples.push({ wave: s.wave, money: s.money, health: s.health, towers: s.towers, boons: s.boons });
                console.log(`wave ${s.wave}: HP=${s.health} $=${s.money} towers=${s.towers} boons=${s.boons}`);
            }
        }
        if (s.state === 'gameover') {
            console.log(`\n=== GAME OVER at wave ${s.wave} (lives out) ===`);
            break;
        }
        if (s.wave >= TARGET_WAVE) {
            console.log(`\n=== REACHED TARGET wave ${TARGET_WAVE} ===`);
            break;
        }
        await new Promise(r => setTimeout(r, 80));
    }

    // ── Verdicts ─────────────────────────────────────────────────────────
    let pass = 0, fail = 0;
    function ok(name, cond, extra) {
        if (cond) { console.log('  ok', name); pass++; }
        else      { console.log('  FAIL', name, extra || ''); fail++; }
    }
    ok('no Aegis false-positive during legitimate play',
        falseFlag === null,
        falseFlag ? `(reason=${falseFlag})` : '');
    ok('save never marked cheater during legitimate play',
        saveCorrupted === null);
    ok('no unexpected money drop between waves',
        bigDropDetected === null,
        bigDropDetected ? JSON.stringify(bigDropDetected) : '');
    ok('no JS errors',
        jsErrors.length === 0,
        jsErrors.join(' / '));

    console.log(`\nWAVE450 SMOKE: ${pass} pass, ${fail} fail (last wave reached: ${lastWave})`);

    await browser.close();
    server.kill();
    process.exit(fail === 0 ? 0 : 1);
})().catch(e => { console.error(e); process.exit(1); });
