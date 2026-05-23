// Retire bonus is gated on a flawless run — no enemy ever reaches the
// base. Covers both branches (flawless gets the +50% bonus; took damage
// gets 0), the Game-side hpEverLost tracker, and the retire-confirm
// modal status line that surfaces eligibility before the player commits.
const { chromium } = require('playwright');
const { spawn } = require('child_process');
const path = require('path');

(async () => {
    const server = spawn(process.execPath, ['tests/helpers/http-server.js', '8867'],
        { cwd: path.join(__dirname, '..'), stdio: 'ignore' });
    await new Promise(r => setTimeout(r, 600));
    const browser = await chromium.launch({ headless: true });
    let pass = 0, fail = 0;
    function ok(name, cond) { if (cond) { console.log('ok', name); pass++; } else { console.log('FAIL', name); fail++; } }

    async function fresh() {
        const ctx = await browser.newContext();
        const page = await ctx.newPage();
        await page.goto('http://127.0.0.1:8867/index.html', { waitUntil: 'domcontentloaded' });
        await page.waitForTimeout(500);
        return { page, ctx };
    }

    // ── Scenario 1 — delta between flawless and damaged retire = +50% kicker ─
    // onRunEnded folds in mastery / loot / boon XP on top of the base run
    // XP, so we can't assert an absolute number. Comparing two otherwise-
    // identical run-end calls isolates the retire-bonus contribution.
    {
        const { page, ctx } = await fresh();
        const delta = await page.evaluate(() => {
            const before = save.metaXP;
            // First call — damaged.
            window.onRunEnded({ wave: 30, tier: 1, retired: true, hpEverLost: true });
            const afterDamaged = save.metaXP;
            // Reset everything mutable that onRunEnded touches so the
            // second call sees the same starting state.
            save.metaXP = before;
            save.ascensionCleared = 0;
            save.totalXPEarned = 0;
            // Second call — flawless.
            window.onRunEnded({ wave: 30, tier: 1, retired: true, hpEverLost: false });
            const afterFlawless = save.metaXP;
            return {
                damagedGain:  afterDamaged - before,
                flawlessGain: afterFlawless - before,
            };
        });
        // The damaged-run gain equals the internal xp.total that the
        // retire bonus is computed from, so the bonus is exactly
        // floor(damagedGain * 0.5). This survives any firstClear / loot
        // side-effects that change the absolute number.
        const expectedBonus = Math.floor(delta.damagedGain * 0.5);
        ok('flawless gain > damaged gain',     delta.flawlessGain > delta.damagedGain);
        ok('delta equals +50% of damaged run XP',
           delta.flawlessGain - delta.damagedGain === expectedBonus);
        ok('damaged-run gain is positive',     delta.damagedGain > 0);
        await ctx.close();
    }

    // ── Scenario 2 — Game.hpEverLost flips when an enemy reaches the base ──
    {
        const { page, ctx } = await fresh();
        const flag = await page.evaluate(async () => {
            // Bootstrap a real game without going through the run-setup
            // screen by flipping the skipRunSetup pref + lastLoadout.
            save.settings = save.settings || {};
            save.settings.skipRunSetup = true;
            save.lastLoadout = { heroId: null, kitId: null, abilityId: null, towerLoadout: null };
            NeonSave.write(save);
            document.getElementById('menu-start-btn').click();
            await new Promise(r => setTimeout(r, 200));
            // Synthesise an enemy that has already reached the end and
            // tick once. Provide the minimal shape Game.update reads.
            const startHP = game.health;
            const beforeFlag = game.hpEverLost;
            game.enemies.push({
                reachedEnd: true, active: true, update() {}, reward: 0,
            });
            game.update();
            return {
                beforeFlag,
                afterFlag: game.hpEverLost,
                hpDropped: game.health < startHP,
            };
        });
        ok('hpEverLost starts false',                flag.beforeFlag === false);
        ok('hpEverLost set when enemy reaches base', flag.afterFlag === true);
        ok('health actually dropped',                flag.hpDropped === true);
        await ctx.close();
    }

    // ── Scenario 3 — retire-confirm modal status line reflects state ────
    {
        const { page, ctx } = await fresh();
        const text = await page.evaluate(async () => {
            save.settings = save.settings || {};
            save.settings.skipRunSetup = true;
            save.lastLoadout = { heroId: null, kitId: null, abilityId: null, towerLoadout: null };
            NeonSave.write(save);
            document.getElementById('menu-start-btn').click();
            await new Promise(r => setTimeout(r, 200));

            // Force wave ≥ 30 + SYS button into retire mode.
            game.wave = 31;
            document.getElementById('restart-btn').dataset.action = 'retire';

            // First — damaged.
            game.hpEverLost = true;
            document.getElementById('restart-btn').click();
            await new Promise(r => setTimeout(r, 30));
            const damaged = document.getElementById('retire-flawless-status').textContent;
            document.getElementById('retire-confirm-no').click();
            await new Promise(r => setTimeout(r, 20));

            // Second — flawless.
            game.hpEverLost = false;
            document.getElementById('restart-btn').click();
            await new Promise(r => setTimeout(r, 30));
            const flawless = document.getElementById('retire-flawless-status').textContent;
            return { damaged, flawless };
        });
        ok('modal warns when bonus forfeited',  /forfeit/i.test(text.damaged));
        ok('modal confirms when bonus available',
           /flawless/i.test(text.flawless) && /available/i.test(text.flawless));
        await ctx.close();
    }

    await browser.close();
    server.kill();

    console.log(`\nRETIRE FLAWLESS: ${pass} pass, ${fail} fail`);
    process.exit(fail === 0 ? 0 : 1);
})().catch(e => { console.error(e); process.exit(1); });
