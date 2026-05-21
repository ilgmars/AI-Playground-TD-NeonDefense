const { chromium } = require('playwright');
const { spawn } = require('child_process');
const path = require('path');

async function main() {
    const server = spawn('node', ['tools/test-http-server.js', '8765'], {
        cwd: path.join('/home/claude/AI-Playground-TD-NeonDefense'),
        stdio: 'ignore',
    });
    await new Promise(r => setTimeout(r, 500));

    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    await page.setViewportSize({ width: 1280, height: 800 });

    const errors = [];
    page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
    page.on('pageerror', e => errors.push(e.message));

    await page.goto('http://localhost:8765');
    await page.waitForTimeout(500);

    await page.click('#menu-start-btn');
    await page.waitForTimeout(200);
    await page.click('#start-btn');
    await page.waitForTimeout(500);

    // Force wave to 10
    await page.evaluate(() => { game.wave = 10; game.updateUI(); });
    await page.waitForTimeout(200);

    const retireBtnHidden = await page.$eval('#retire-btn', el => el.classList.contains('hidden'));
    console.log('Retire btn hidden at wave 10:', retireBtnHidden, '(should be false)');

    // Click retire directly (bypass overflow panel which is CSS-hidden on desktop)
    await page.evaluate(() => document.getElementById('retire-btn').click());
    await page.waitForTimeout(300);
    await page.screenshot({ path: '/tmp/retire-confirm.png' });

    const confirmVisible = await page.$eval('#retire-confirm', el => !el.classList.contains('hidden'));
    console.log('Retire confirm visible:', confirmVisible, '(should be true)');

    await page.click('#retire-confirm-yes');
    await page.waitForTimeout(500);
    await page.screenshot({ path: '/tmp/victory-screen.png' });

    const victoryVisible = await page.$eval('#victory', el => !el.classList.contains('hidden'));
    console.log('Victory screen visible:', victoryVisible, '(should be true)');

    const gameState = await page.evaluate(() => game.state);
    console.log('Game state:', gameState, '(should be "victory")');

    if (errors.length > 0) {
        console.error('JS errors:', errors);
        process.exitCode = 1;
    } else {
        console.log('No JS errors.');
    }

    await browser.close();
    server.kill();
}

main().catch(e => { console.error(e); process.exit(1); });
