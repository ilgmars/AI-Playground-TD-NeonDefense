// Dev-only: capture all menu screens at desktop + mobile viewports.
// node tools/menu-shots.js  → writes /tmp/shots/*.png
const { chromium } = require('playwright');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

const OUT = '/tmp/shots';
fs.mkdirSync(OUT, { recursive: true });

const SCREENS = [
  { name: 'main-menu',  setup: async (p) => {} },
  { name: 'tech-tree',  setup: async (p) => p.click('#menu-tree-btn') },
  { name: 'mastery',    setup: async (p) => p.click('#menu-mastery-btn') },
  { name: 'run-setup',  setup: async (p) => p.click('#menu-start-btn') },
];

const VIEWPORTS = [
  { tag: 'desktop', width: 1280, height: 800,  touch: false },
  { tag: 'mobile',  width: 390,  height: 844,  touch: true  },
];

async function shoot(browser, vp) {
  for (const screen of SCREENS) {
    const ctx = await browser.newContext({
      viewport: { width: vp.width, height: vp.height },
      hasTouch: vp.touch, isMobile: vp.touch,
    });
    const page = await ctx.newPage();
    await page.goto('http://localhost:8765/index.html');
    await page.waitForTimeout(700);
    // Force a fresh save with seeded mastery XP so the lab has content to lay out.
    await page.evaluate(() => {
      const s = NeonSave.load();
      s.metaXP = 5000;
      for (const t of NeonSave.TOWER_TYPES) {
        s.towerMastery[t] = { xp: 4200, totalXP: 12000, milestones: { m1: true, m2: true }, perks: { damage: 3, fireRate: 2, efficiency: 1 } };
      }
      NeonSave.write(s);
      location.reload();
    });
    await page.waitForTimeout(800);
    try { await screen.setup(page); } catch (e) { console.log('setup err', screen.name, e.message); }
    await page.waitForTimeout(500);
    const file = path.join(OUT, `${screen.name}-${vp.tag}.png`);
    await page.screenshot({ path: file, fullPage: false });
    console.log('saved', file);
    await ctx.close();
  }
}

(async () => {
  const server = spawn('python3', ['-m', 'http.server', '8765'], { cwd: path.join(__dirname, '..'), stdio: 'ignore' });
  await new Promise(r => setTimeout(r, 600));
  const browser = await chromium.launch({ headless: true });
  try {
    for (const vp of VIEWPORTS) await shoot(browser, vp);
  } finally {
    await browser.close();
    server.kill();
  }
})().catch(e => { console.error(e); process.exit(1); });
