// Variant mastery — logic + browser UI.
// Verifies:
//   - tallyMastery attributes XP to the EXACT type (no roll-up to base).
//   - getMasteryPerkCost / purchaseMasteryPerk accept variant keys
//     and lazy-create their entry.
//   - The Lab default selection follows save.lastLoadout.towerLoadout
//     when the variant is unlocked.
//   - The Lab variant button is disabled when locked.
//   - Toggling a row switches which entry the perk row reads/buys.
const assert = require('assert');
let pass = 0;
function ok(name, c) { assert.ok(c, name); console.log('ok', name); pass++; }

// ── Logic (node) ─────────────────────────────────────────────────────────
global.localStorage = { _d:{}, getItem(k){return this._d[k] ?? null;}, setItem(k,v){this._d[k]=v;} };
const { NeonSave: S } = require('../src/progression/save.js');

let s = S.createFreshSave();
S.tallyMastery(s, [{ type:'basic', damageDealt:1500 }, { type:'basic_cryo', damageDealt:300 }]);
ok('base entry gets only base XP',     s.towerMastery.basic.totalXP === 1500);
ok('variant entry separate from base', s.towerMastery.basic_cryo.totalXP === 300);
ok('base m1 unlocked at 1K',           s.towerMastery.basic.milestones.m1 === true);
ok('variant m1 not auto-unlocked',     s.towerMastery.basic_cryo.milestones.m1 === false);

s = S.createFreshSave();
ok('variant cost reachable before entry exists',
   Number.isFinite(S.getMasteryPerkCost(s, 'basic_cryo', 'damage')));
s.metaXP = 0;
s = S.createFreshSave();
S.ensureMasteryEntry(s, 'sniper_scatter');
s.towerMastery.sniper_scatter.xp = 5000;
ok('purchase on variant key works',
   S.purchaseMasteryPerk(s, 'sniper_scatter', 'damage') === true &&
   s.towerMastery.sniper_scatter.perks.damage === 1);

// ── Browser (Mastery Lab UI) ─────────────────────────────────────────────
const { chromium } = require('playwright');
const { spawn } = require('child_process');
const path = require('path');
(async () => {
  const server = spawn(process.execPath, ['tests/helpers/http-server.js', '8801'], { cwd: path.join(__dirname, '..'), stdio:'ignore' });
  await new Promise(r => setTimeout(r, 600));
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  const errs = [];
  page.on('pageerror', e => errs.push(e.message));
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('http://127.0.0.1:8801/index.html', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(700);

  // Set up: basic has lifetime > 1K (variant unlocked), sniper still locked.
  // Loadout picks basic_cryo → that row should default to VARIANT.
  await page.evaluate(() => {
    const s = NeonSave.load();
    NeonSave.ensureMasteryEntry(s, 'basic');
    s.towerMastery.basic.totalXP = 1500;
    s.towerMastery.basic.xp = 100;
    s.towerMastery.basic.milestones.m1 = true;
    NeonSave.ensureMasteryEntry(s, 'basic_cryo');
    s.towerMastery.basic_cryo.totalXP = 200;
    s.towerMastery.basic_cryo.xp = 2000;
    s.lastLoadout = s.lastLoadout || {};
    s.lastLoadout.towerLoadout = { basic: 'basic_cryo' };
    NeonSave.write(s); location.reload();
  });
  await page.waitForTimeout(800);
  await page.click('#menu-mastery-btn');
  await page.waitForSelector('#tower-mastery:not(.hidden)');

  // The 1st row (basic) should default to VARIANT (Cryo Blaster).
  const rowState = await page.evaluate(() => {
    const row = document.querySelectorAll('#mastery-grid .mastery-row')[0];
    const btns = row.querySelectorAll('.mastery-variant-toggle .mvb');
    return {
      name: row.querySelector('.mastery-name-row span').textContent,
      activeIdx: Array.from(btns).findIndex(b => b.classList.contains('active')),
      labels: Array.from(btns).map(b => b.textContent),
      spendable: row.querySelector('.mastery-spendable').textContent,
    };
  });
  console.log('row 0 default:', JSON.stringify(rowState));
  ok('row 0 defaults to variant (Cryo Blaster)', rowState.activeIdx === 1);
  ok('spendable reads variant entry (2000 XP)', /Spendable\s+2000\s+XP/.test(rowState.spendable));

  // Switch row 0 back to BASE → spendable should reflect base entry (100).
  await page.evaluate(() => {
    const row = document.querySelectorAll('#mastery-grid .mastery-row')[0];
    row.querySelectorAll('.mastery-variant-toggle .mvb')[0].click();
  });
  await page.waitForTimeout(150);
  const afterBase = await page.evaluate(() => {
    const row = document.querySelectorAll('#mastery-grid .mastery-row')[0];
    return row.querySelector('.mastery-spendable').textContent;
  });
  ok('switch to BASE shows base XP (100)', /Spendable\s+100\s+XP/.test(afterBase));

  // Row 1 (sniper) has no lifetime XP → variant must be LOCKED & disabled.
  const sniperRow = await page.evaluate(() => {
    const rows = document.querySelectorAll('#mastery-grid .mastery-row');
    const r = rows[1];
    const btns = r.querySelectorAll('.mastery-variant-toggle .mvb');
    return {
      varBtnLocked: btns[1].classList.contains('locked') && btns[1].disabled,
      activeIsBase: btns[0].classList.contains('active'),
    };
  });
  ok('locked variant button is disabled + .locked',
     sniperRow.varBtnLocked && sniperRow.activeIsBase);

  // Purchase a perk on the variant (row 0, switch to variant first).
  await page.evaluate(() => {
    const row = document.querySelectorAll('#mastery-grid .mastery-row')[0];
    row.querySelectorAll('.mastery-variant-toggle .mvb')[1].click(); // variant
  });
  await page.waitForTimeout(150);
  const before = await page.evaluate(() => save.towerMastery.basic_cryo.perks.damage);
  // Use a real mouse interaction — hold-to-spend listens for pointer events,
  // not the DOM `.click()` method.
  await page.locator('#mastery-grid .mastery-row').first().locator('.mastery-perk-buy').first().click();
  await page.waitForTimeout(200);
  const after = await page.evaluate(() => ({
    variant: save.towerMastery.basic_cryo.perks.damage,
    base:    save.towerMastery.basic.perks.damage,
  }));
  console.log('purchase before / after:', before, after);
  ok('purchase increments VARIANT rank (not base)',
     after.variant === before + 1 && after.base === 0);

  await page.screenshot({ path:'/tmp/shots/mastery-variant-desktop.png' });
  await browser.close(); server.kill();
  console.log('errors:', errs.length ? errs : 'none');
  console.log(`\nVARIANT MASTERY: ${pass} checks ${errs.length === 0 ? 'PASS' : 'FAIL'}`);
  process.exit(errs.length === 0 ? 0 : 1);
})().catch(e => { console.error(e); process.exit(1); });
