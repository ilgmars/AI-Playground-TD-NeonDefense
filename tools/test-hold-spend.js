// Verifies hold-to-spend buys multiple ranks and accelerates.
const { chromium } = require('playwright');
const { spawn } = require('child_process');
const path = require('path');

(async () => {
  const server = spawn(process.execPath, ['tools/test-http-server.js', '8767'], { cwd: path.join(__dirname, '..'), stdio: 'ignore' });
  await new Promise(r => setTimeout(r, 600));
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  await page.goto('http://localhost:8767/index.html');
  await page.waitForTimeout(700);
  // Heaps of XP so a long hold can buy many ranks (damage limit = 10).
  await page.evaluate(() => {
    const s = NeonSave.load();
    for (const t of NeonSave.TOWER_TYPES) {
      s.towerMastery[t] = { xp: 999999, totalXP: 999999, milestones: { m1: true, m2: true }, perks: { damage: 0, fireRate: 0, efficiency: 0 } };
    }
    NeonSave.write(s);
    location.reload();
  });
  await page.waitForTimeout(700);
  await page.click('#menu-mastery-btn');
  await page.waitForTimeout(400);

  const btn = page.locator('.mastery-perk-buy').first();
  const box = await btn.boundingBox();
  const cx = box.x + box.width / 2, cy = box.y + box.height / 2;

  // Tap test: one quick click should buy exactly 1.
  await page.mouse.click(cx, cy);
  await page.waitForTimeout(150);
  let r1 = await page.evaluate(() => NeonSave.load().towerMastery.basic.perks.damage);
  console.log('after single tap, damage rank =', r1, r1 === 1 ? 'OK' : 'FAIL');

  // Hold test: press and hold ~2s, expect it to climb toward the limit (10)
  // and clearly exceed a non-accelerating count.
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  await page.waitForTimeout(2000);
  await page.mouse.up();
  await page.waitForTimeout(200);
  const r2 = await page.evaluate(() => NeonSave.load().towerMastery.basic.perks.damage);
  console.log('after 2s hold, damage rank =', r2, '(endless perk — no cap)');
  console.log(r2 >= 8 ? 'HOLD ACCELERATION OK' : 'HOLD TOO SLOW (FAIL)');

  await browser.close();
  server.kill();
  process.exit(r1 === 1 && r2 >= 8 ? 0 : 1);
})().catch(e => { console.error(e); process.exit(1); });
