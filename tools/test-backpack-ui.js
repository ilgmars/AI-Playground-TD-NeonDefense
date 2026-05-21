// Browser test: salvage → place via UI → persist → effect applied at run
// start; empty backpack is a no-op. Plus device screenshots.
const { chromium } = require('playwright');
const { spawn } = require('child_process');
const fs = require('fs');
fs.mkdirSync('/tmp/shots', { recursive: true });

(async () => {
  const server = spawn(process.execPath, ['tools/test-http-server.js', '8790'], { cwd:'/home/claude/AI-Playground-TD-NeonDefense', stdio:'ignore' });
  await new Promise(r => setTimeout(r, 600));
  const browser = await chromium.launch({ headless: true });
  const errs = [];

  // ---- Functional (desktop) ----
  const page = await browser.newPage();
  page.on('pageerror', e => errs.push(e.message));
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('http://localhost:8790/index.html');
  await page.waitForTimeout(700);

  // Empty backpack must be a strict no-op at run start.
  const emptyMult = await page.evaluate(() => {
    const g = window.game; return g ? g.boonDamageMult : null;
  });
  console.log('empty backpack boonDamageMult (want 1):', emptyMult);

  // Grant XP and open the Backpack screen.
  // Ensure the grid is large enough for any salvage roll to fit somewhere
  // (the default 2×2 can reject a 3-cell column / T-shape).
  await page.evaluate(() => {
    save.metaXP = 50000;
    save.backpack.w = 5; save.backpack.h = 4;
    NeonSave.write(save);
  });
  await page.click('#menu-backpack-btn');
  await page.waitForSelector('#backpack:not(.hidden)');

  // Salvage twice (UI button), then place the first stash item via the grid.
  await page.click('#bp-salvage');
  await page.click('#bp-salvage');
  await page.waitForTimeout(150);
  const stashCount = await page.locator('#bp-stash .bp-chip').count();
  await page.locator('#bp-stash .bp-chip').first().click();   // pick up
  await page.waitForSelector('#bp-held:not(.hidden)');
  await page.click('#bp-rotate');                              // rotate held
  await page.locator('#bp-grid .bp-cell').first().click();     // place at (0,0)
  await page.waitForTimeout(150);

  const afterPlace = await page.evaluate(() => ({
    placed: save.backpack.placed.length,
    stash: save.backpack.stash.length,
    persisted: JSON.parse(localStorage.getItem(NeonSave.KEY)).backpack.placed.length,
  }));
  console.log('after UI place:', JSON.stringify(afterPlace));

  // Deterministic effect check: force a known item and start a run.
  const effect = await page.evaluate(() => {
    save.backpack = { w:5, h:4, placed:[{ id:'plasma_cell', x:0, y:0, rot:0 }], stash:[] };
    NeonSave.write(save);
    document.getElementById('backpack-back-btn').click();
    document.getElementById('menu-start-btn').click();
    document.getElementById('start-btn').click();
    const g = window.game;
    g.money = 99999;
    let built = null;
    for (let c=0;c<20 && !built;c++) for (let r=0;r<15 && !built;r++)
      if (g.map.isBuildable(c,r) && g.buildTower(c,r,'basic')) built = g.towers[g.towers.length-1];
    return { boonDamageMult: g.boonDamageMult, towerDmg: built ? built.damage : null, baseDmg: TOWERS.basic.damage };
  });
  console.log('with plasma_cell:', JSON.stringify(effect));

  await browser.close();

  // ---- Device screenshots ----
  const devices = [
    { t:'desktop',   w:1280, h:800, m:false },
    { t:'mobile',    w:390,  h:844, m:true  },
    { t:'narrow',    w:360,  h:640, m:true  },
    { t:'landscape', w:740,  h:360, m:true  },
  ];
  const b2 = await chromium.launch({ headless: true });
  for (const d of devices) {
    const ctx = await b2.newContext({ viewport:{width:d.w,height:d.h}, hasTouch:d.m, isMobile:d.m });
    const p = await ctx.newPage();
    await p.goto('http://localhost:8790/index.html'); await p.waitForTimeout(700);
    await p.evaluate(() => {
      const s = NeonSave.load();
      s.metaXP = 50000;
      s.backpack = { w:5, h:4, placed:[
        { id:'reactor_bulwark', x:0, y:0, rot:0 },
        { id:'overclock_matrix', x:2, y:0, rot:0 },
        { id:'plasma_cell', x:0, y:2, rot:0 },
      ], stash:['coolant_coil','bounty_module','targeting_core'] };
      NeonSave.write(s);
      location.reload();
    });
    await p.waitForTimeout(800);
    await p.waitForSelector('#main-menu:not(.hidden)');
    // Capture the main menu too (verifies the BACKPACK button is reachable
    // and the menu fits on this device).
    await p.screenshot({ path:`/tmp/shots/menu-${d.t}.png` });
    // Navigate via the real handler (robust on tiny landscape viewports
    // where Playwright's click-point can land under the fixed top bar).
    await p.evaluate(() => navigateToBackpack());
    await p.waitForSelector('#backpack:not(.hidden)');
    try { await p.locator('#bp-stash .bp-chip').first().click({ timeout: 3000 }); } catch (_) {}
    await p.evaluate(() => { const el = document.getElementById('backpack'); if (el) el.scrollTop = 0; });
    await p.waitForTimeout(600);
    await p.screenshot({ path:`/tmp/shots/backpack-${d.t}.png` });
    await ctx.close();
  }
  await b2.close();
  server.kill();

  const okEffect = Math.abs(effect.boonDamageMult - 1.06) < 1e-6 &&
                   effect.towerDmg !== null && effect.towerDmg > effect.baseDmg;
  const okPlace = afterPlace.placed === 1 && afterPlace.persisted === 1;
  const okEmpty = emptyMult === 1;
  console.log('errors:', errs.length ? errs : 'none');
  const allOk = okEffect && okPlace && okEmpty && errs.length === 0;
  console.log(allOk ? 'BACKPACK UI OK' : `BACKPACK UI FAIL (effect=${okEffect} place=${okPlace} empty=${okEmpty})`);
  process.exit(allOk ? 0 : 1);
})().catch(e => { console.error(e); process.exit(1); });
