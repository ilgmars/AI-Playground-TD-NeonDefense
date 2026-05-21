// Extra coverage suite — fills gaps surfaced by the audit:
//
//   • Save backfill copes with a minimal v1 save missing every M2+ field.
//   • A high-tier Game (tier=50) constructs cleanly and starts.
//   • Boon application actually mutates Game state.
//   • Aegis flags negative money spikes and Math.imul overrides.
//   • History Back stays sane across multiple presses.
//   • Save-code modal participates in history (Back dismisses it).
//   • Bag expansion preserves placed items.
const assert = require('assert');
let pass = 0, fail = 0;
function ok(name, cond) {
    if (cond) { console.log('ok', name); pass++; }
    else      { console.log('FAIL', name); fail++; }
}

// ─────────────────────────────────────────────────────────────────────
// Node logic — save backfill + ascension integration
// ─────────────────────────────────────────────────────────────────────
global.window = {};
const { NeonAegis } = require('../src/security/aegis.js');
global.NeonAegis = NeonAegis;
global.localStorage = {
    _d: {},
    getItem(k) { return this._d[k] ?? null; },
    setItem(k, v) { this._d[k] = v; },
    removeItem(k) { delete this._d[k]; },
    clear() { this._d = {}; },
};
const { NeonSave } = require('../src/progression/save.js');

// ── Backfill a minimal (pre-M2) save ─────────────────────────────────
localStorage.clear();
const minimal = { version: NeonSave.SCHEMA_VERSION, metaXP: 42 };
localStorage.setItem(NeonSave.KEY, JSON.stringify(minimal));
const loaded = NeonSave.load();
ok('backfill preserves metaXP',                 loaded.metaXP === 42);
ok('backfill populates highScores buckets a0..a10',
    Array.isArray(loaded.highScores.a0) && Array.isArray(loaded.highScores.a10));
ok('backfill populates towerMastery for every base type',
    NeonSave.TOWER_TYPES.every(t => loaded.towerMastery[t] && loaded.towerMastery[t].perks));
ok('backfill populates backpack with tiny default grid',
    loaded.backpack && loaded.backpack.w >= 1 && loaded.backpack.h >= 1 &&
    Array.isArray(loaded.backpack.placed) && Array.isArray(loaded.backpack.stash));
ok('backfill populates lastLoadout with safe defaults',
    loaded.lastLoadout && loaded.lastLoadout.heroId && loaded.lastLoadout.kitId);
ok('backfill defaults maxWaveReached to 0',     loaded.maxWaveReached === 0);
ok('backfill defaults cheaterDetected false',   loaded.cheaterDetected === false);
ok('backfill defaults backpack.luckBoost 0',    loaded.backpack.luckBoost === 0);
ok('backfill writes a fresh signature',         typeof localStorage.getItem(NeonSave.KEY + '.sig') === 'string');

// ─────────────────────────────────────────────────────────────────────
// Browser — boons, history, aegis edge cases, expansion preservation
// ─────────────────────────────────────────────────────────────────────
const { chromium } = require('playwright');
const { spawn } = require('child_process');
const path = require('path');

(async () => {
    const server = spawn(process.execPath, ['tests/helpers/http-server.js', '8850'],
        { cwd: path.join(__dirname, '..'), stdio: 'ignore' });
    await new Promise(r => setTimeout(r, 600));
    const browser = await chromium.launch({ headless: true });
    let bPass = 0, bFail = 0;
    function bok(name, cond) {
        if (cond) { console.log('  ok', name); bPass++; }
        else      { console.log('  FAIL', name); bFail++; }
    }

    async function fresh(opts) {
        const ctx = await browser.newContext({
            viewport: opts && opts.mobile ? { width: 390, height: 844 } : { width: 1280, height: 800 },
            hasTouch: !!(opts && opts.mobile), isMobile: !!(opts && opts.mobile),
        });
        const page = await ctx.newPage();
        const errs = [];
        page.on('pageerror', e => errs.push(e.message));
        await page.goto('http://127.0.0.1:8850/index.html', { waitUntil: 'domcontentloaded' });
        await page.waitForTimeout(700);
        page._ctx = ctx; page._errs = errs;
        return page;
    }
    async function startRun(page) {
        await page.click('#menu-start-btn'); await page.waitForTimeout(200);
        await page.click('#start-btn');      await page.waitForTimeout(500);
    }

    // ── 1) High-tier Game (tier=50) starts and produces sensible state ──
    console.log('\nbrowser: high-tier (A50) Game constructs and runs');
    {
        const page = await fresh();
        const state = await page.evaluate(() => {
            const canvas = document.getElementById('game-canvas');
            const g = new Game(canvas, 12345, 50, { heroId:'hero.pioneer', kitId:'kit.standard', abilityId:'ability.none' });
            window.game = g; if (typeof NeonAegis !== 'undefined') NeonAegis.protectGame(g);
            g.start();
            return {
                tier: g.ascensionTier,
                state: g.state,
                hpMult: g.ascension.hpMult,
                payoutMult: g.ascension.payoutMult,
                isFiniteHp: Number.isFinite(g.ascension.hpMult),
                isFinitePayout: Number.isFinite(g.ascension.payoutMult),
            };
        });
        bok('A50 game constructs with tier 50',   state.tier === 50);
        bok('A50 hp mult is finite',              state.isFiniteHp);
        bok('A50 payout mult is finite',          state.isFinitePayout);
        // A50 = A10 (hpMult 1.15 from A1) × 40 endless steps (×1.05 each).
        // Expected ≈ 1.15 × 7.04 ≈ 8.1. Test for "well above baseline".
        bok('A50 hp mult is large (>5×)',         state.hpMult > 5);
        bok('A50 payout mult is heavily reduced', state.payoutMult < 0.4);
        bok('A50 game enters playing state',      state.state === 'playing');
        bok('no JS errors at A50',                page._errs.length === 0);
        await page._ctx.close();
    }

    // ── 2) Boon application mutates Game state ──────────────────────────
    console.log('\nbrowser: boon chooseBoon applies its effect to towers');
    {
        const page = await fresh();
        await startRun(page);
        const before = await page.evaluate(() => {
            window.game.money = 99999;
            // Build a basic tower
            for (let c = 0; c < 20; c++) for (let r = 0; r < 15; r++)
                if (window.game.map.isBuildable(c, r) && window.game.buildTower(c, r, 'basic')) return {
                    dmg: window.game.towers[0].damage,
                    boonMult: window.game.boonDamageMult,
                };
            return null;
        });
        bok('built a basic tower for the boon test', before && before.dmg > 0);
        const after = await page.evaluate(() => {
            window.game.chooseBoon('overdrive');
            return {
                dmg: window.game.towers[0].damage,
                boonMult: window.game.boonDamageMult,
                boonsTaken: window.game.boons.length,
            };
        });
        bok('chooseBoon increments boons list',                 after.boonsTaken === 1);
        bok('chooseBoon raises boonDamageMult past 1',          after.boonMult > 1.17 && after.boonMult < 1.19);
        bok('chooseBoon retroactively scales placed tower dmg', Math.abs(after.dmg - before.dmg * 1.18) < 1e-6);
        await page._ctx.close();
    }

    // ── 3) Aegis: Math.imul override is flagged ─────────────────────────
    console.log('\nbrowser: Math.imul override is flagged');
    {
        const page = await fresh();
        await startRun(page);
        await page.evaluate(() => { Math.imul = function () { return 0; }; });
        await page.waitForTimeout(1700);    // > sentinel tick
        const r = await page.evaluate(() => ({
            flagged: !!save.cheaterDetected, reason: save.cheaterReason,
        }));
        bok('Math.imul override flags', r.flagged === true);
        bok('reason is imul-override',  r.reason === 'imul-override');
        await page._ctx.close();
    }

    // ── 4) Aegis: negative money spike is flagged ───────────────────────
    console.log('\nbrowser: negative money spike is flagged');
    {
        const page = await fresh();
        await startRun(page);
        await page.evaluate(() => { window.game.money = -1e9; });
        await page.waitForTimeout(150);
        const r = await page.evaluate(() => ({
            flagged: !!save.cheaterDetected, reason: save.cheaterReason,
        }));
        bok('money=-1e9 flags', r.flagged === true);
        bok('reason mentions money', /money/.test(r.reason || ''));
        await page._ctx.close();
    }

    // ── 5) History: repeated open/back cycles stay sane ─────────────────
    // We cycle open → Back twice. Re-opening after a Back relies on the
    // in-UI BACK going through history.back() so the stack doesn't leak
    // stale entries.
    console.log('\nbrowser: repeated open/back cycles stay sane');
    {
        const page = await fresh({ mobile: true });
        for (let i = 0; i < 2; i++) {
            await page.evaluate(() => navigateToBackpack());
            await page.waitForTimeout(120);
            const opened = await page.evaluate(() => !document.getElementById('backpack').classList.contains('hidden'));
            bok(`cycle ${i+1}: backpack opens`, opened === true);
            // Click the in-UI BACK (which calls uiGoBack → history.back).
            await page.locator('#backpack-back-btn').click();
            await page.waitForTimeout(200);
            const closed = await page.evaluate(() => ({
                backpackHidden: document.getElementById('backpack').classList.contains('hidden'),
                mainVisible:    !document.getElementById('main-menu').classList.contains('hidden'),
                subFlag:        window._subScreenOpen === undefined ? null : window._subScreenOpen,
            }));
            bok(`cycle ${i+1}: backpack hidden after BACK`, closed.backpackHidden === true);
            bok(`cycle ${i+1}: main menu visible after BACK`, closed.mainVisible === true);
        }
        await page._ctx.close();
    }

    // ── 6) save-code modal participates in history ──────────────────────
    console.log('\nbrowser: save-code modal dismissed by system Back');
    {
        const page = await fresh({ mobile: true });
        await page.click('#menu-savecode-btn');
        await page.waitForTimeout(150);
        const opened = await page.evaluate(() => !document.getElementById('save-code-modal').classList.contains('hidden'));
        bok('save-code modal opens', opened === true);
        await page.goBack();
        await page.waitForTimeout(200);
        const closed = await page.evaluate(() => ({
            modalHidden: document.getElementById('save-code-modal').classList.contains('hidden'),
            mainVisible: !document.getElementById('main-menu').classList.contains('hidden'),
        }));
        bok('system Back hides save-code modal',  closed.modalHidden === true);
        bok('system Back shows main menu again',  closed.mainVisible === true);
        await page._ctx.close();
    }

    // ── 7) Bag expansion preserves placed items ─────────────────────────
    console.log('\nbrowser: bag expansion keeps placed items intact');
    {
        const page = await fresh();
        await page.evaluate(() => {
            const s = NeonSave.load();
            s.metaXP = 100000;
            s.backpack = { w: 3, h: 3, placed: [{ id: 'reactor_bulwark', x: 1, y: 1, rot: 0 }], stash: [], luckBoost: 0 };
            NeonSave.write(s); location.reload();
        });
        await page.waitForTimeout(800);
        await page.evaluate(() => navigateToBackpack());
        await page.waitForTimeout(200);
        const before = await page.evaluate(() => ({
            w: save.backpack.w, h: save.backpack.h, placed: save.backpack.placed.slice(),
        }));
        await page.click('#bp-expand-w');
        await page.waitForTimeout(150);
        await page.click('#bp-expand-h');
        await page.waitForTimeout(150);
        const after = await page.evaluate(() => ({
            w: save.backpack.w, h: save.backpack.h, placed: save.backpack.placed.slice(),
            persistedPlaced: JSON.parse(localStorage.getItem(NeonSave.KEY)).backpack.placed.length,
        }));
        bok('expand grew the grid (w++ and h++)', after.w === before.w + 1 && after.h === before.h + 1);
        bok('placed item still present',          after.placed.length === before.placed.length);
        bok('placed item position unchanged',
            after.placed[0].x === before.placed[0].x && after.placed[0].y === before.placed[0].y);
        bok('placed item persisted in localStorage', after.persistedPlaced === before.placed.length);
        await page._ctx.close();
    }

    await browser.close();
    server.kill();

    console.log(`\nBROWSER EXTRA: ${bPass} pass, ${bFail} fail`);
    const totalFail = fail + bFail;
    console.log(`\nEXTRA TOTAL: ${pass + bPass} pass, ${totalFail} fail`);
    process.exit(totalFail === 0 ? 0 : 1);
})().catch(e => { console.error(e); process.exit(1); });
