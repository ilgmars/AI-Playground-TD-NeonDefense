// Iteration 2 browser test: OVERCLOCK item drop, end-of-run loot banner,
// bag expansion (UI + persistence), empty backpack still a no-op.
const { chromium } = require('playwright');
const { spawn } = require('child_process');
const fs = require('fs');
fs.mkdirSync('/tmp/shots', { recursive: true });

(async () => {
  const server = spawn('python3', ['-m','http.server','8797'], { cwd:'/home/claude/AI-Playground-TD-NeonDefense', stdio:'ignore' });
  await new Promise(r => setTimeout(r, 600));
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  const errs = [];
  page.on('pageerror', e => errs.push(e.message));
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('http://localhost:8797/index.html');
  await page.waitForTimeout(700);

  const emptyNoop = await page.evaluate(() => window.game ? window.game.boonDamageMult : null);

  // Launch a run (so window.game exists for the minigame/run-end paths).
  await page.click('#menu-start-btn'); await page.waitForTimeout(250);
  await page.click('#start-btn');      await page.waitForTimeout(500);

  // ---- OVERCLOCK must NOT drop items any more ----
  // (Drops are end-of-run only after the rebalance.)
  let ocNoDrop = null;
  for (let attempt = 0; attempt < 8 && ocNoDrop === null; attempt++) {
    await page.evaluate(() => { if (window.NeonMinigame.isActive()) window.NeonMinigame.close(); });
    await page.waitForTimeout(120);
    const before = await page.evaluate(() => {
      window.game.autopilot = false;
      window.NeonMinigame.open();
      return save.backpack.stash.length;
    });
    await page.waitForSelector('#minigame:not(.hidden)');
    let safe = 0, busted = false;
    for (let i = 0; i < 6 && safe < 2 && !busted; i++) {
      await page.locator(`#mg-board .mg-cell[data-idx="${i}"]`).click();
      await page.waitForTimeout(80);
      const cls = await page.locator(`#mg-board .mg-cell[data-idx="${i}"]`).getAttribute('class');
      if (cls.includes('surge')) busted = true;
      else if (cls.includes('safe')) safe++;
    }
    if (busted || safe < 1) { await page.waitForTimeout(2000); continue; }
    await page.click('#mg-bank');
    await page.waitForTimeout(2200);  // let auto-close fire
    const after = await page.evaluate(() => ({
      stash: save.backpack.stash.length,
      status: document.getElementById('mg-status').textContent,
    }));
    ocNoDrop = { before, after };
  }
  console.log('OVERCLOCK no-drop check:', ocNoDrop ? JSON.stringify(ocNoDrop) : 'NOT OBSERVED');

  // ---- End-of-run loot: gated (wave≥20), max 1, probabilistic ----
  // Wave 18 — under the gate ⇒ no roll, no banner.
  const tooEarly = await page.evaluate(() => {
    const before = save.backpack.stash.length;
    window.onRunEnded({ wave: 18, tier: 0, retired: false });
    return {
      grew: save.backpack.stash.length - before,
      banner: !!document.querySelector('.xp-breakdown-unlock.loot-banner'),
    };
  });
  console.log('wave 18 (gated):', JSON.stringify(tooEarly));

  // Wave 40 with Math.random=0 → roll hits ⇒ exactly 1 item granted.
  const runHit = await page.evaluate(() => {
    document.querySelectorAll('.xp-breakdown-unlock.loot-banner').forEach(el => el.remove());
    const before = save.backpack.stash.length;
    window.__r = Math.random; Math.random = () => 0;
    window.onRunEnded({ wave: 40, tier: 1, retired: false });
    Math.random = window.__r;
    const banner = document.querySelector('.xp-breakdown-unlock.loot-banner');
    return {
      grew: save.backpack.stash.length - before,
      persisted: JSON.parse(localStorage.getItem(NeonSave.KEY)).backpack.stash.length,
      banner: banner ? banner.textContent : null,
      isMiss: banner ? banner.classList.contains('loot-banner-miss') : null,
    };
  });
  console.log('wave 40 hit (rng=0):', JSON.stringify(runHit));

  // Wave 40 with Math.random=0.999 → roll misses ⇒ banner shows the % miss.
  const runMiss = await page.evaluate(() => {
    document.querySelectorAll('.xp-breakdown-unlock.loot-banner').forEach(el => el.remove());
    const before = save.backpack.stash.length;
    window.__r = Math.random; Math.random = () => 0.999;
    window.onRunEnded({ wave: 40, tier: 1, retired: false });
    Math.random = window.__r;
    const banner = document.querySelector('.xp-breakdown-unlock.loot-banner');
    return {
      grew: save.backpack.stash.length - before,
      banner: banner ? banner.textContent : null,
      isMiss: banner ? banner.classList.contains('loot-banner-miss') : null,
    };
  });
  console.log('wave 40 miss (rng=0.999):', JSON.stringify(runMiss));

  // ---- Bag expansion (UI) ----
  await page.evaluate(() => { save.metaXP = 100000; NeonSave.write(save); navigateToMainMenu(); });
  await page.click('#menu-backpack-btn');
  await page.waitForSelector('#backpack:not(.hidden)');
  const expand = await page.evaluate(() => ({ w: save.backpack.w, cells: document.querySelectorAll('#bp-grid .bp-cell').length, xp: save.metaXP }));
  await page.click('#bp-expand-w');
  await page.waitForTimeout(150);
  const expanded = await page.evaluate(() => ({
    w: save.backpack.w,
    cells: document.querySelectorAll('#bp-grid .bp-cell').length,
    xp: save.metaXP,
    persistedW: JSON.parse(localStorage.getItem(NeonSave.KEY)).backpack.w,
  }));
  console.log('expand before:', JSON.stringify(expand), 'after:', JSON.stringify(expanded));
  await page.screenshot({ path:'/tmp/shots/backpack2-desktop.png' });

  await browser.close();

  // ---- Device screenshots (expanded grid + stash) ----
  const b2 = await chromium.launch({ headless: true });
  for (const d of [{t:'mobile',w:390,h:844},{t:'narrow',w:360,h:640}]) {
    const ctx = await b2.newContext({ viewport:{width:d.w,height:d.h}, hasTouch:true, isMobile:true });
    const p = await ctx.newPage();
    await p.goto('http://localhost:8797/index.html'); await p.waitForTimeout(700);
    await p.evaluate(() => {
      const s = NeonSave.load();
      s.metaXP = 100000;
      s.backpack = { w:7, h:5, placed:[{id:'reactor_bulwark',x:0,y:0,rot:0},{id:'overclock_matrix',x:3,y:0,rot:0}],
        stash:['plasma_cell','coolant_coil','bounty_module','targeting_core','fabricator'] };
      NeonSave.write(s); location.reload();
    });
    await p.waitForTimeout(800);
    await p.evaluate(() => { navigateToBackpack(); const o=document.getElementById('backpack'); o.style.backdropFilter='none'; o.style.background='#0f172a'; });
    await p.waitForTimeout(500);
    await p.screenshot({ path:`/tmp/shots/backpack2-${d.t}.png` });
    await ctx.close();
  }
  await b2.close();
  server.kill();

  const okEmpty  = emptyNoop === 1;
  const okNoOcDrop = ocNoDrop && ocNoDrop.after.stash === ocNoDrop.before && !/backpack/.test(ocNoDrop.after.status);
  const okGate   = tooEarly.grew === 0 && tooEarly.banner === false;
  const okHit    = runHit.grew === 1 && runHit.isMiss === false && /SALVAGE \(/.test(runHit.banner || '');
  const okMiss   = runMiss.grew === 0 && runMiss.isMiss === true && /no drop/.test(runMiss.banner || '');
  const okExpand = expanded.w === expand.w + 1 && expanded.cells > expand.cells &&
                   expanded.xp < expand.xp && expanded.persistedW === expanded.w &&
                   // First expand now costs 1500 (was 600) — confirm the new curve.
                   (expand.xp - expanded.xp) === 1500;
  console.log('errors:', errs.length ? errs : 'none');
  const allOk = okEmpty && okNoOcDrop && okGate && okHit && okMiss && okExpand && errs.length === 0;
  console.log(allOk ? 'BACKPACK ITER2 OK'
    : `FAIL (empty=${okEmpty} noOcDrop=${okNoOcDrop} gate=${okGate} hit=${okHit} miss=${okMiss} expand=${okExpand})`);
  process.exit(allOk ? 0 : 1);
})().catch(e => { console.error(e); process.exit(1); });
