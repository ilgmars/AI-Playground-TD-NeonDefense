const { chromium } = require('playwright');
const { spawn } = require('child_process');
const path = require('path');

async function main() {
    const server = spawn('python3', ['-m', 'http.server', '8765'], {
        cwd: path.join('/home/claude/AI-Playground-TD-NeonDefense'),
        stdio: 'ignore',
    });
    await new Promise(r => setTimeout(r, 500));

    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto('http://localhost:8765');
    await page.waitForTimeout(500);

    // Start the game (click START RUN then INITIALIZE)
    await page.click('#menu-start-btn');
    await page.waitForTimeout(200);
    await page.click('#start-btn');
    await page.waitForTimeout(500);

    // Verify game started
    const wave = await page.$eval('#wave-display', el => el.textContent);
    console.log('Wave:', wave);

    // Inject JS to test defense mechanic
    const result = await page.evaluate(() => {
        // Test that takeDamage applies defense correctly
        const enemy = new Enemy(game.map.path, 'tank', 1);
        const initialHp = enemy.hp;
        const defense = enemy.defense;

        const dmg = 100;
        const dealt = enemy.takeDamage(dmg);
        const expected = Math.max(1, dmg * (1 - defense));

        return {
            type: 'tank',
            defense,
            initialHp,
            afterHp: enemy.hp,
            dealt,
            expected,
            correct: Math.abs(dealt - expected) < 0.01
        };
    });
    console.log('Defense test:', JSON.stringify(result, null, 2));

    const result2 = await page.evaluate(() => {
        const enemy = new Enemy(game.map.path, 'normal', 1);
        const dealt = enemy.takeDamage(100);
        return { type: 'normal', defense: enemy.defense, dealt };
    });
    console.log('Normal enemy test:', JSON.stringify(result2));

    await page.screenshot({ path: '/tmp/game-defense-test.png' });
    await browser.close();
    server.kill();
}

main().catch(e => { console.error(e); process.exit(1); });
