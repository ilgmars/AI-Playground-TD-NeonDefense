// Verifies the roguelike boon picker: appears, pauses, applies, resumes.
const { chromium } = require('playwright');
const { spawn } = require('child_process');
const path = require('path');

(async () => {
  const server = spawn('node', ['tools/test-http-server.js', '8768'], { cwd: path.join(__dirname, '..'), stdio: 'ignore' });
  await new Promise(r => setTimeout(r, 600));
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  await page.setViewportSize({ width: 1280, height: 800 });
  const errs = [];
  page.on('pageerror', e => errs.push(e.message));
  await page.goto('http://localhost:8768/index.html');
  await page.waitForTimeout(700);

  // Launch a run.
  await page.click('#menu-start-btn');
  await page.waitForTimeout(300);
  await page.click('#start-btn');
  await page.waitForTimeout(600);

  // Place a tower so the damage boon has something to scale, then trigger.
  const setup = await page.evaluate(() => {
    const g = window.game;
    g.money = 99999;
    g.buildTower(2, g.map.path[2] ? g.map.path[2].r : 5, 'basic');
    const t = g.towers[0];
    const dmgBefore = t ? t.damage : null;
    g.autopilot = false;
    g.pendingBoon = true;
    return { dmgBefore, state: g.state, towers: g.towers.length };
  });

  // Wait for the loop to drain pendingBoon and show the chooser.
  await page.waitForSelector('#boon-overlay:not(.hidden)', { timeout: 4000 });
  const cards = await page.locator('.boon-card').count();
  const paused = await page.evaluate(() => window.game.state);
  await page.screenshot({ path: '/tmp/shots/boon-desktop.png' });

  // Pick the Overdrive (damage) boon specifically if offered, else first.
  const ids = await page.evaluate(() => window.game.getBoonChoices ? null : null);
  await page.locator('.boon-card').first().click();
  await page.waitForTimeout(300);

  const after = await page.evaluate(() => {
    const g = window.game;
    return {
      hidden: document.getElementById('boon-overlay').classList.contains('hidden'),
      state: g.state,
      boons: g.boons.slice(),
      dmgMult: g.boonDamageMult,
      payMult: g.boonPayoutMult,
      killMult: g.boonKillMult,
      maxHP: g.maxHealth,
      towerDmg: g.towers[0] ? g.towers[0].damage : null,
    };
  });

  console.log('setup:', JSON.stringify(setup));
  console.log('cards shown:', cards, '| state while open:', paused);
  console.log('after pick:', JSON.stringify(after));
  console.log('page errors:', errs.length ? errs : 'none');

  const ok =
    cards === 3 &&
    paused === 'paused' &&
    after.hidden === true &&
    after.state === 'playing' &&
    after.boons.length === 1 &&
    errs.length === 0;
  console.log(ok ? 'BOON FLOW OK' : 'BOON FLOW FAIL');

  await browser.close();
  server.kill();
  process.exit(ok ? 0 : 1);
})().catch(e => { console.error(e); process.exit(1); });
