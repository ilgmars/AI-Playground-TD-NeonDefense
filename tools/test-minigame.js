// Verifies the OVERCLOCK press-your-luck minigame: opens, pauses, pays
// the pot on bank, busts on surge, resumes the run, no JS errors.
const { chromium } = require('playwright');
const { spawn } = require('child_process');

(async () => {
  const server = spawn('python3', ['-m', 'http.server', '8780'], { cwd: '/home/claude/AI-Playground-TD-NeonDefense', stdio: 'ignore' });
  await new Promise(r => setTimeout(r, 600));
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  const errs = [];
  page.on('pageerror', e => errs.push(e.message));
  await page.goto('http://localhost:8780/index.html');
  await page.waitForTimeout(700);
  await page.click('#menu-start-btn'); await page.waitForTimeout(300);
  await page.click('#start-btn');      await page.waitForTimeout(600);

  let banked = false, busted = false;

  for (let attempt = 0; attempt < 12 && !(banked && busted); attempt++) {
    const before = await page.evaluate(() => {
      window.game.money = 1000;
      window.NeonMinigame.open();
      return { money: window.game.money, state: window.game.state };
    });
    await page.waitForSelector('#minigame:not(.hidden)', { timeout: 3000 });
    const cellCount = await page.locator('#mg-board .mg-cell').count();
    if (cellCount !== 6) { console.log('FAIL: expected 6 cells, got', cellCount); process.exit(1); }
    if (before.state !== 'paused') { console.log('FAIL: game not paused while open'); process.exit(1); }

    // Even attempts: bank on the first safe cell (tests payout).
    // Odd attempts: keep revealing and never bank — with only 4 safe of 6
    // a surge is unavoidable, guaranteeing the bust path is exercised.
    const greedy = attempt % 2 === 1;
    let outcome = null;
    for (let i = 0; i < 6; i++) {
      await page.locator(`#mg-board .mg-cell[data-idx="${i}"]`).click();
      await page.waitForTimeout(120);
      const cls = await page.locator(`#mg-board .mg-cell[data-idx="${i}"]`).getAttribute('class');
      if (cls.includes('surge')) { outcome = 'bust'; break; }
      if (cls.includes('safe') && !greedy) {
        await page.locator('#mg-bank').click();
        outcome = 'bank';
        break;
      }
    }
    await page.waitForTimeout(2000); // allow auto-close (1.7s)
    const after = await page.evaluate(() => ({
      money: window.game.money,
      state: window.game.state,
      hidden: document.getElementById('minigame').classList.contains('hidden'),
    }));

    if (after.state !== 'playing') { console.log('FAIL: run not resumed after close'); process.exit(1); }
    if (!after.hidden) { console.log('FAIL: overlay did not close'); process.exit(1); }

    if (outcome === 'bank') {
      if (after.money <= before.money) { console.log('FAIL: bank did not pay out', before.money, after.money); process.exit(1); }
      banked = true;
      console.log(`bank OK: ${before.money} -> ${after.money} (+${after.money - before.money})`);
    } else if (outcome === 'bust') {
      if (after.money !== before.money) { console.log('FAIL: bust changed money', before.money, after.money); process.exit(1); }
      busted = true;
      console.log(`bust OK: money unchanged at ${after.money}`);
    }
  }

  await page.screenshot({ path: '/tmp/shots/minigame-desktop.png' });
  console.log('page errors:', errs.length ? errs : 'none');
  const ok = banked && busted && errs.length === 0;
  console.log(ok ? 'MINIGAME OK' : 'MINIGAME INCOMPLETE (banked=' + banked + ' busted=' + busted + ')');
  await browser.close();
  server.kill();
  process.exit(ok ? 0 : 1);
})().catch(e => { console.error(e); process.exit(1); });
