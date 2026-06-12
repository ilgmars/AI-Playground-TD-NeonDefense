#!/usr/bin/env node
// Long-game lag profiler — Trello: "apk seems laggy after long games
// 300+ waves". Drives the autopilot at high speed to a target wave,
// pausing at milestones to measure REAL per-frame cost (update+draw at
// 1× pacing) plus everything that could be accumulating: entity array
// lengths, sprite-cache size, JS heap, DOM node count, save size.
//
//   node tools/longgame-profile.js --target=300
//
// A healthy game shows flat frame cost and bounded arrays; a leak shows
// monotonic growth in one of the columns.
const { chromium } = require('playwright');
const { spawn } = require('child_process');
const path = require('path');

const args = Object.fromEntries(process.argv.slice(2).map(a => {
    const [k, v = 'true'] = a.replace(/^--/, '').split('=');
    return [k, v];
}));
const TARGET = parseInt(args.target || '300', 10);
const MILESTONES = [20, 60, 100, 150, 200, 250, 300, 350, 400].filter(m => m <= TARGET);

(async () => {
    const PORT = 8807;
    const server = spawn(process.execPath, ['tests/helpers/http-server.js', String(PORT)],
        { cwd: path.join(__dirname, '..'), stdio: 'ignore' });
    await new Promise(r => setTimeout(r, 600));
    const browser = await chromium.launch({
        headless: true,
        args: ['--js-flags=--expose-gc'],
    });
    const page = await browser.newPage();
    await page.setViewportSize({ width: 1280, height: 800 });
    const errs = [];
    page.on('pageerror', e => errs.push(e.message));
    await page.goto(`http://127.0.0.1:${PORT}/index.html#99887766`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(600);
    await page.evaluate(() => { localStorage.setItem('neonPlayerName', 'PRF'); });
    await page.click('#menu-start-btn'); await page.waitForTimeout(250);
    await page.click('#start-btn');     await page.waitForTimeout(800);

    await page.evaluate(() => {
        window.game.autopilot = true;
        window.gameSpeed = 1;            // we drive updates manually
        window.game.state = 'paused';    // RAF loop idles; we own the sim
    });

    console.log('wave | frame(ms) p95   | enemies proj parts fx | sprites | heapMB | DOM | save(KB)');
    const rows = [];
    for (const m of MILESTONES) {
        // Advance the sim to wave m as fast as the CPU allows.
        const reached = await page.evaluate(async (targetWave) => {
            const g = window.game;
            g.state = 'playing';
            let guard = 0;
            while (g.wave < targetWave && g.state === 'playing' && guard < 4e6) {
                g.update();
                guard++;
                if (guard % 50000 === 0) await new Promise(r => setTimeout(r, 0));
            }
            const alive = g.state === 'playing';
            g.state = 'paused';
            return { wave: g.wave, alive };
        }, m);
        if (!reached.alive) {
            console.log(`run ended (game over) at wave ${reached.wave}`);
            break;
        }
        // Measure realistic frame cost: update+draw pairs at 1×.
        const s = await page.evaluate((frames) => {
            const g = window.game;
            g.state = 'playing';
            const t = [];
            for (let i = 0; i < frames; i++) {
                const a = performance.now();
                g.update();
                g.draw();
                t.push(performance.now() - a);
            }
            g.state = 'paused';
            t.sort((x, y) => x - y);
            let heapMB = null;
            if (performance.memory) heapMB = (performance.memory.usedJSHeapSize / 1048576).toFixed(1);
            let saveKB = 0;
            try { saveKB = ((localStorage.getItem('neonDefense.save') || '').length / 1024).toFixed(1); } catch (_) {}
            return {
                wave: g.wave,
                mean: t.reduce((q, v) => q + v, 0) / t.length,
                p95: t[Math.floor(t.length * 0.95)],
                enemies: g.enemies.length,
                proj: g.projectiles.length,
                parts: g.particles.length,
                fx: (g.upgradeEffects || []).length + ((g.explosions || []).length || 0),
                sprites: window.__neonSpriteCacheSize ? window.__neonSpriteCacheSize() : -1,
                heapMB,
                dom: document.getElementsByTagName('*').length,
                saveKB,
            };
        }, 240);
        rows.push(s);
        console.log(
            String(s.wave).padStart(4) + ' | ' +
            s.mean.toFixed(2).padStart(6) + ' ' + s.p95.toFixed(2).padStart(6) + ' | ' +
            String(s.enemies).padStart(7) + ' ' + String(s.proj).padStart(4) + ' ' +
            String(s.parts).padStart(5) + ' ' + String(s.fx).padStart(3) + ' | ' +
            String(s.sprites).padStart(7) + ' | ' + String(s.heapMB).padStart(6) + ' | ' +
            String(s.dom).padStart(4) + ' | ' + String(s.saveKB).padStart(7));
    }

    if (errs.length) console.log('\nJS errors:', errs.slice(0, 5).join(' | '));
    const fs = require('fs');
    fs.mkdirSync(path.join(__dirname, 'bench'), { recursive: true });
    fs.writeFileSync(path.join(__dirname, 'bench', 'longgame-profile.json'),
        JSON.stringify({ ts: new Date().toISOString(), rows }, null, 2));
    console.log('\nwrote tools/bench/longgame-profile.json');
    await browser.close();
    server.kill();
})().catch(e => { console.error(e); process.exit(1); });
