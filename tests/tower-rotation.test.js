// Tower turrets ROTATE toward their target instead of snapping to the aim
// angle (which looked cheap). The DISPLAY angle (this.angle) eases toward the
// true aim at a capped rate per tick and converges; the true aim (targetAngle)
// is set immediately so firing accuracy is unchanged.
const { chromium } = require('playwright');
const { spawn } = require('child_process');
const path = require('path');

(async () => {
    const PORT = 9670 + Math.floor(Math.random() * 40);
    const server = spawn(process.execPath, ['tests/helpers/http-server.js', String(PORT)],
        { cwd: path.join(__dirname, '..'), stdio: 'ignore' });
    await new Promise(r => setTimeout(r, 600));
    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    const errs = [];
    page.on('pageerror', e => errs.push(e.message));
    let pass = 0, fail = 0;
    const ok = (n, c, x) => { if (c) { console.log('ok', n); pass++; } else { console.log('FAIL', n, x || ''); fail++; } };

    await page.goto(`http://127.0.0.1:${PORT}/index.html`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(600);

    const r = await page.evaluate(() => {
        const T = window.TILE_SIZE;
        const turn = TOWER_TURN_SPEED;                  // global const from entities.js
        const tower = new Tower(0, 0, 'sniper');
        tower.angle = 0; tower.targetAngle = 0;
        // An enemy directly BEHIND the tower → true aim ≈ π (a 180° swing).
        const e = new Enemy([{ c: 0, r: 0 }, { c: 0, r: 0 }], 'normal', 1);
        e.x = tower.x + T / 2 - 150; e.y = tower.y + T / 2; e.isAir = false;
        const enemies = [e], projectiles = [], particles = [];
        const norm = a => ((a % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
        let prev = tower.angle, maxStep = 0, convergeAt = -1, angleAfter1 = null;
        for (let i = 0; i < 60; i++) {
            e.active = true; e.hp = e.maxHp = 1e9;       // un-killable + always targetable
            tower.update(enemies, projectiles, particles);
            if (i === 0) angleAfter1 = tower.angle;
            let d = tower.angle - prev; while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI;
            maxStep = Math.max(maxStep, Math.abs(d));
            if (convergeAt < 0 && Math.abs(norm(tower.angle) - norm(tower.targetAngle)) < 0.1) convergeAt = i;
            prev = tower.angle;
        }
        return { turn, targetAngle: tower.targetAngle, angleAfter1, maxStep, convergeAt,
            converged: Math.abs(norm(tower.angle) - norm(tower.targetAngle)) < 0.05 };
    });

    ok('true aim (targetAngle) is set immediately (firing stays accurate)', Math.abs(Math.abs(r.targetAngle) - Math.PI) < 0.01, JSON.stringify(r));
    ok('turret does NOT snap to the target (still mid-rotation early on)', Math.abs(r.angleAfter1) < Math.PI - 1, JSON.stringify(r));
    ok('rotation is capped at TOWER_TURN_SPEED per tick', r.maxStep <= r.turn + 1e-6, JSON.stringify(r));
    ok('turret rotates GRADUALLY (takes many ticks, not instant)', r.convergeAt >= 8, JSON.stringify(r));
    ok('turret converges to the target angle', r.converged && r.convergeAt > 0, JSON.stringify(r));

    ok('no JS errors', errs.length === 0, errs.join(' / '));
    await browser.close();
    server.kill();
    console.log(`\nTOWER ROTATION: ${pass} pass, ${fail} fail`);
    process.exit(fail === 0 ? 0 : 1);
})().catch(e => { console.error(e); process.exit(1); });
