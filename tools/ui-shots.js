// Dev-only: capture key screens (desktop + mobile) for a UI/UX review.
//   node tools/ui-shots.js  → writes /tmp/uishots/*.png
const { chromium } = require('playwright');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

const OUT = '/tmp/uishots';
fs.mkdirSync(OUT, { recursive: true });

const SCREENS = [
    { name: 'main-menu', setup: async () => {} },
    { name: 'upgrades',  setup: async (p) => { await p.click('#menu-tree-btn'); } },
    { name: 'tech-tree', setup: async (p) => { await p.click('#menu-tree-btn'); await p.waitForTimeout(150); await p.click('.upg-tab[data-upg-tab="tree"]'); } },
    { name: 'run-setup', setup: async (p) => { await p.click('#menu-start-btn'); } },
    { name: 'scoreboard', setup: async (p) => { await p.click('#menu-scores-btn'); } },
    { name: 'backpack',  setup: async (p) => { await p.evaluate(() => { save.backpack.stash = ['plasma_cell','credit_chip','coolant_coil']; NeonSave.write(save); }); await p.click('#menu-backpack-btn'); } },
    { name: 'in-game',   setup: async (p) => { await p.click('#menu-start-btn'); await p.waitForTimeout(200); await p.click('#start-btn'); await p.waitForTimeout(1200); } },
];

const VIEWPORTS = [
    { tag: 'desktop', width: 1280, height: 800, touch: false },
    { tag: 'mobile',  width: 390,  height: 844, touch: true },
];

(async () => {
    const PORT = 8765;
    const server = spawn(process.execPath, ['tests/helpers/http-server.js', String(PORT)],
        { cwd: path.join(__dirname, '..'), stdio: 'ignore' });
    await new Promise(r => setTimeout(r, 600));
    const browser = await chromium.launch();
    for (const vp of VIEWPORTS) {
        for (const screen of SCREENS) {
            const ctx = await browser.newContext({
                viewport: { width: vp.width, height: vp.height },
                hasTouch: vp.touch, isMobile: vp.touch, deviceScaleFactor: 2,
            });
            const page = await ctx.newPage();
            await page.goto(`http://localhost:${PORT}/index.html`, { waitUntil: 'domcontentloaded' });
            await page.waitForTimeout(600);
            await page.evaluate(() => localStorage.setItem('neonPlayerName', 'YOU'));
            try { await screen.setup(page); } catch (e) { console.log('setup err', screen.name, e.message); }
            await page.waitForTimeout(500);
            const file = path.join(OUT, `${screen.name}-${vp.tag}.png`);
            await page.screenshot({ path: file });
            console.log('wrote', file);
            await ctx.close();
        }
    }
    await browser.close();
    server.kill();
})().catch(e => { console.error(e); process.exit(1); });
