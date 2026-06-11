// Regression: co-op wave sync is HOST-AUTHORITATIVE.
//
// The host broadcasts every wave start as {kind:'wave', w, hp} where
// hp is ITS finalHpMult for the wave. The non-host:
//   * never self-advances waves (game._mpHoldWaves pins the sim at
//     waveCooldown 0 until the host's broadcast arrives) — this is
//     what stops a faster device racing ahead, the #1 source of the
//     "co-op acts like race" desync;
//   * snaps to the host's wave in BOTH directions (the old
//     forward-only rule let an already-drifted client stay ahead
//     forever);
//   * spawns with the host's hp multiplier, not its own (enemy HP
//     scales with local tower spending, which can differ);
//   * applies the host's periodic enemy digest ('es') — HP snaps,
//     host-dead enemies die locally without loot credit.
const { chromium } = require('playwright');
const { spawn } = require('child_process');
const path = require('path');

(async () => {
    const PORT = 8780;
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

    await page.click('#menu-start-btn'); await page.waitForTimeout(200);
    await page.click('#start-btn');     await page.waitForTimeout(700);

    const hooksExist = await page.evaluate(() =>
        typeof window.__neonMPApplyWave === 'function' &&
        typeof window.__neonMPApplyEnemyState === 'function');
    ok('__neonMPApplyWave + __neonMPApplyEnemyState exposed', hooksExist === true);

    // 1) Apply a host wave that is AHEAD of ours.
    await page.evaluate(() => window.__neonMPApplyWave(7));
    await page.waitForTimeout(100);
    const wAfter = await page.evaluate(() => window.game.wave);
    ok('wave snaps forward to host value', wAfter === 7);

    // 2) Apply a host wave that is BEHIND — the host is authoritative
    // in BOTH directions now (the client can't legitimately be ahead
    // since _mpHoldWaves stops self-advance; if state disagrees, the
    // host's view wins).
    await page.evaluate(() => window.__neonMPApplyWave(3));
    await page.waitForTimeout(80);
    const wBack = await page.evaluate(() => window.game.wave);
    ok('wave snaps BACKWARD to host value too (host-authoritative)', wBack === 3);

    // 3) Invalid input is ignored.
    await page.evaluate(() => {
        window.__neonMPApplyWave(0);
        window.__neonMPApplyWave(-5);
        window.__neonMPApplyWave('foo');
        window.__neonMPApplyWave(null);
    });
    const wStable = await page.evaluate(() => window.game.wave);
    ok('invalid wave inputs ignored', wStable === 3);

    // 4) Wave snap clears leftover enemies/projectiles and honours the
    // host's hp multiplier.
    const hpForced = await page.evaluate(() => {
        window.game.enemies.push({ active: true, hp: 99 });   // fake leftover
        window.game.projectiles.push({ active: true });
        window.__neonMPApplyWave(10, 5.5);
        return window.game.lastHpMult;
    });
    const wAdv = await page.evaluate(() => window.game.wave);
    ok('wave advanced to 10 with leftover state cleared', wAdv === 10);
    ok('host hp multiplier forced into startWave (lastHpMult = 5.5)',
        hpForced === 5.5, hpForced);

    // 5) _mpHoldWaves pins the sim: cooldown reaches 0 but the wave
    // does NOT advance while held; releasing the hold lets it advance.
    const holdRes = await page.evaluate(() => {
        const g = window.game;
        g.state = 'playing';
        g._mpHoldWaves = true;
        g.currentWaveDef = null;
        g.enemies.length = 0;
        g.waveCooldown = 2;
        const before = g.wave;
        for (let i = 0; i < 10; i++) g.update();
        const heldWave = g.wave;
        const heldCooldown = g.waveCooldown;
        g._mpHoldWaves = false;
        g.waveCooldown = 1;
        g.update();
        return { before, heldWave, heldCooldown, releasedWave: g.wave };
    });
    ok('held client does NOT self-advance at cooldown 0',
        holdRes.heldWave === holdRes.before && holdRes.heldCooldown === 0,
        JSON.stringify(holdRes));
    ok('releasing the hold lets the wave advance again',
        holdRes.releasedWave === holdRes.before + 1, JSON.stringify(holdRes));

    // 6) Enemy digest: HP snaps by _spawnIdx; host-dead enemies die
    // locally without loot credit; stale-wave digests are ignored.
    const digest = await page.evaluate(() => {
        const g = window.game;
        g.enemies.length = 0;
        g.enemies.push(
            { active: true, _spawnIdx: 0, hp: 100, maxHp: 100 },
            { active: true, _spawnIdx: 1, hp: 100, maxHp: 100 },
            { active: true, hp: 50, maxHp: 50 }   // splitter child — no idx, untouched
        );
        g.enemiesSpawned = 2;
        // Stale digest (wrong wave) must be a no-op.
        window.__neonMPApplyEnemyState({ w: g.wave + 5, n: 2, e: [[0, 10]] });
        const staleHp = g.enemies[0].hp;
        // Live digest: idx0 at ~half HP on the host, idx1 dead on host.
        window.__neonMPApplyEnemyState({ w: g.wave, n: 2, e: [[0, 128]] });
        return {
            staleHp,
            snappedHp: g.enemies[0].hp,
            deadActive: g.enemies[1].active,
            deadNoCredit: g.enemies[1]._noLocalCredit === true,
            childHp: g.enemies[2].hp,
        };
    });
    ok('stale-wave digest ignored', digest.staleHp === 100, JSON.stringify(digest));
    ok('digest snaps HP by spawn index', digest.snappedHp === Math.round(100 * 128 / 255), digest.snappedHp);
    ok('host-dead enemy killed locally without loot credit',
        digest.deadActive === false && digest.deadNoCredit === true, JSON.stringify(digest));
    ok('idx-less enemies (splitter children) untouched', digest.childHp === 50);

    ok('no JS errors', errs.length === 0, errs.join(' / '));

    await browser.close();
    server.kill();
    console.log(`\nCOOP WAVE SYNC: ${pass} pass, ${fail} fail`);
    process.exit(fail === 0 ? 0 : 1);
})().catch(e => { console.error(e); process.exit(1); });
