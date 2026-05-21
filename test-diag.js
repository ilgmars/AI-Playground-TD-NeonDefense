const { chromium } = require('playwright');
const { spawn } = require('child_process');

const PORT = 8770;
const SPEED = 512;
const SEED = '42000';

async function main() {
    const server = spawn('node', ['tools/test-http-server.js', String(PORT)], {
        cwd: '/home/claude/AI-Playground-TD-NeonDefense', stdio: 'ignore'
    });
    await new Promise(r => setTimeout(r, 600));

    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    await page.setViewportSize({ width: 1280, height: 800 });
    page.on('pageerror', e => console.error('JS ERR:', e.message));

    await page.goto(`http://localhost:${PORT}/#${SEED}`);
    await page.waitForTimeout(500);
    await page.click('#menu-start-btn');
    await page.waitForTimeout(200);
    await page.click('#start-btn');
    await page.waitForTimeout(800);

    await page.click('#autopilot-btn');
    await page.evaluate((speed) => { eval(`gameSpeed = ${speed}`); }, SPEED);

    let lastWave = 0;
    const started = Date.now();

    while (Date.now() - started < 180000) {
        const state = await page.evaluate(() => {
            try {
                const g = eval('game');
                if (!g) return null;
                if (g.state === 'gameover') return { done: true, reason: 'gameover', wave: g.wave, health: g.health };
                const counts = {};
                for (const t of g.towers) {
                    const b = t.type === 'income_research' ? 'income' : t.type.includes('_') ? t.type.split('_')[0] : t.type;
                    counts[b] = (counts[b] || 0) + 1;
                }
                return { done: false, wave: g.wave, health: g.health, money: g.money, towers: g.towers.length, counts };
            } catch(e) { return { err: e.message }; }
        });

        if (!state || state.err) { await new Promise(r => setTimeout(r, 50)); continue; }
        if (state.done) {
            console.log(`=== GAMEOVER at wave ${state.wave} health=${state.health} ===`);
            break;
        }
        if (state.wave !== lastWave && state.wave >= 1) {
            lastWave = state.wave;
            console.log(`w${state.wave}: HP=${state.health} $=${state.money} T=${state.towers} ${JSON.stringify(state.counts)}`);
        }
        await new Promise(r => setTimeout(r, 30));
    }

    await browser.close();
    server.kill();
}
main().catch(e => { console.error(e); process.exit(1); });
