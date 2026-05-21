// Iteration 2 browser test: OVERCLOCK item drop, end-of-run loot banner,
// bag expansion (UI + persistence), empty backpack still a no-op.
const { chromium } = require('playwright');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
fs.mkdirSync('/tmp/shots', { recursive: true });

(async () => {
  const server = spawn(process.execPath, ['tests/helpers/http-server.js', '8797'], { cwd: path.join(__dirname, '..'), stdio:'ignore' });
  await new Promise(r => setTimeout(r, 600));
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  const errs = [];
  page.on('pageerror', e => errs.push(e.message));
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('http://127.0.0.1:8797/index.html', { waitUntil: 'domcontentloaded' });
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

  // ---- Salvage Luck XP sink (UI + run integration) ----
  const luckFlow = await page.evaluate(async () => {
    // Fresh save (no deep run yet) → LUCK button locked.
    save.metaXP = 100000;
    save.maxWaveReached = 0;
    save.backpack.luckBoost = 0;
    NeonSave.write(save);
    navigateToBackpack();
    const lockedDisabled = document.getElementById('bp-luck').disabled;
    const lockedLabel = document.getElementById('bp-luck-cost').textContent;
    // Mark wave 20 reached → unlocks.
    save.maxWaveReached = 20;
    NeonSave.write(save);
    renderBackpack();
    const unlockedDisabled = document.getElementById('bp-luck').disabled;
    return { lockedDisabled, lockedLabel, unlockedDisabled };
  });
  console.log('luck gate:', JSON.stringify(luckFlow));

  const beforeXP = await page.evaluate(() => save.metaXP);
  await page.locator('#bp-luck').click();
  await page.waitForTimeout(120);
  const afterBuy = await page.evaluate(() => ({
    rank: save.backpack.luckBoost,
    xp: save.metaXP,
    persistedRank: JSON.parse(localStorage.getItem(NeonSave.KEY)).backpack.luckBoost,
    statLabel: document.getElementById('bp-luck-stat').textContent,
  }));
  console.log('luck after 1 buy:', JSON.stringify(afterBuy), 'cost paid =', beforeXP - afterBuy.xp);

  // End-of-run with 5 ranks of luck applied → banner mentions the +5% bonus.
  const luckRun = await page.evaluate(() => {
    save.backpack.luckBoost = 5;
    NeonSave.write(save);
    document.querySelectorAll('.xp-breakdown-unlock.loot-banner').forEach(el => el.remove());
    window.__r = Math.random; Math.random = () => 0;
    window.onRunEnded({ wave: 40, tier: 1, retired: false });
    Math.random = window.__r;
    const banner = document.querySelector('.xp-breakdown-unlock.loot-banner');
    return { text: banner ? banner.textContent : null };
  });
  console.log('luck-run banner:', JSON.stringify(luckRun));

  // Return to the Backpack screen so the device screenshots below have it open.
  await page.evaluate(() => navigateToBackpack());
  await page.waitForTimeout(150);

  // ---- Sell flow + "NEED N XP MORE" relabel ----
  // Set up: one rare item in stash, very low meta-XP so SALVAGE flips
  // to the "need more" label.
  await page.evaluate(() => {
    save.metaXP = 50;                       // way under any cost
    save.backpack = { w:3, h:3, placed:[], stash:['reactor_bulwark'], luckBoost: 0 };
    save.maxWaveReached = 25;
    NeonSave.write(save);
    renderBackpack();
  });
  const labels = await page.evaluate(() => ({
    salvage: document.getElementById('bp-salvage-cost').textContent,
    expand:  document.querySelector('.bp-exp-cost').textContent,
    luck:    document.getElementById('bp-luck-cost').textContent,
  }));
  console.log('labels when poor:', JSON.stringify(labels));

  const sellBefore = await page.evaluate(() => ({
    xp: save.metaXP, stash: save.backpack.stash.length,
  }));
  // Pick up the stash item, then click SELL.
  await page.locator('#bp-stash .bp-chip').first().click();
  await page.waitForSelector('#bp-held:not(.hidden)');
  const sellLabel = await page.locator('#bp-sell-val').textContent();
  await page.locator('#bp-discard').click();
  await page.waitForTimeout(150);
  const sellAfter = await page.evaluate(() => ({
    xp: save.metaXP, stash: save.backpack.stash.length,
    persistedXp: JSON.parse(localStorage.getItem(NeonSave.KEY)).metaXP,
  }));
  console.log('sell:', JSON.stringify({ sellBefore, sellLabel, sellAfter }));
  // Reset to fresh 2×2 so the expand cost assertion is deterministic.
  await page.evaluate(() => {
    save.metaXP = 100000;
    save.backpack = { w:2, h:2, placed:[], stash:[], luckBoost: 0 };
    NeonSave.write(save);
    navigateToMainMenu();
  });
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
    await p.goto('http://127.0.0.1:8797/index.html'); await p.waitForTimeout(700);
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
  const okLuckGate = luckFlow.lockedDisabled === true && /LOCKED/.test(luckFlow.lockedLabel) &&
                     luckFlow.unlockedDisabled === false;
  const okLuckBuy  = afterBuy.rank === 1 && afterBuy.persistedRank === 1 &&
                     (beforeXP - afterBuy.xp) === 500 && /\+1%/.test(afterBuy.statLabel);
  const okLuckBanner = /· \+5% luck/.test(luckRun.text || '');
  const okNeedLabels  = /NEED .* XP MORE/.test(labels.salvage) &&
                        /NEED .* XP MORE/.test(labels.expand)  &&
                        /NEED .* XP MORE/.test(labels.luck);
  const okSellAmount  = /\+500/.test(sellLabel || '');           // rare = +500
  const okSellApplied = sellAfter.xp - sellBefore.xp === 500 &&
                        sellAfter.stash === sellBefore.stash - 1 &&
                        sellAfter.persistedXp === sellAfter.xp;
  console.log('errors:', errs.length ? errs : 'none');
  const allOk = okEmpty && okNoOcDrop && okGate && okHit && okMiss && okExpand &&
                okLuckGate && okLuckBuy && okLuckBanner &&
                okNeedLabels && okSellAmount && okSellApplied &&
                errs.length === 0;
  console.log(allOk ? 'BACKPACK ITER2 OK'
    : `FAIL (empty=${okEmpty} noOcDrop=${okNoOcDrop} gate=${okGate} hit=${okHit} miss=${okMiss} expand=${okExpand} luckGate=${okLuckGate} luckBuy=${okLuckBuy} luckBanner=${okLuckBanner} need=${okNeedLabels} sellAmt=${okSellAmount} sellApply=${okSellApplied})`);
  process.exit(allOk ? 0 : 1);
})().catch(e => { console.error(e); process.exit(1); });
