#!/usr/bin/env node
// Render benchmark — measures Game.draw() frame cost across entity
// loads and zoom levels in headless Chromium (deviceScaleFactor 2 to
// exercise the High-DPI path).
//
//   node tools/render-bench.js --label=baseline
//   node tools/render-bench.js --label=after
//
// Writes tools/bench/<label>.json and prints a table. Compare runs on
// the SAME machine only — headless rasterization is software (Skia/
// SwiftShader), so absolute numbers are pessimistic but relative
// deltas are meaningful.
//
// Methodology: towers/enemies are constructed directly (real Tower/
// Enemy instances spread over buildable tiles / path positions), the
// game is paused (no update() noise), and draw() runs in a single
// synchronous loop per scenario — RAF can't interleave, so the timing
// is pure render cost.
const { chromium } = require('playwright');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const LABEL = (process.argv.find(a => a.startsWith('--label=')) || '--label=run').split('=')[1];
const FRAMES = parseInt((process.argv.find(a => a.startsWith('--frames=')) || '--frames=240').split('=')[1], 10);

// towers, enemies, zoom (1 = base view, 2.5 = pinch-zoomed in)
const MATRIX = [
    { towers: 20,  enemies: 50,   zoom: 1   },
    { towers: 60,  enemies: 200,  zoom: 1   },
    { towers: 120, enemies: 500,  zoom: 1   },
    { towers: 200, enemies: 1000, zoom: 1   },
    { towers: 60,  enemies: 200,  zoom: 2.5 },
    { towers: 120, enemies: 500,  zoom: 2.5 },
];

(async () => {
    const PORT = 8801;
    const root = path.join(__dirname, '..');
    const server = spawn(process.execPath, ['tests/helpers/http-server.js', String(PORT)],
        { cwd: root, stdio: 'ignore' });
    await new Promise(r => setTimeout(r, 600));
    const browser = await chromium.launch();
    const ctx = await browser.newContext({
        viewport: { width: 1280, height: 800 },
        deviceScaleFactor: 2,
    });
    const page = await ctx.newPage();
    await page.goto(`http://127.0.0.1:${PORT}/index.html#42424242`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(600);
    await page.evaluate(() => { localStorage.setItem('neonPlayerName', 'BNC'); });
    await page.click('#menu-start-btn'); await page.waitForTimeout(250);
    await page.click('#start-btn');     await page.waitForTimeout(800);

    const results = [];
    for (const sc of MATRIX) {
        const r = await page.evaluate(({ towers, enemies, zoom, frames }) => {
            const g = window.game;
            g.state = 'paused';
            g.towers.length = 0; g.enemies.length = 0;
            g.projectiles.length = 0; g.particles.length = 0;
            if (Array.isArray(g.explosions)) g.explosions.length = 0;

            // Towers round-robin over types, spread across buildable
            // tiles. TOWERS is a top-level `const` (lexical global,
            // not a window property) — reference it bare.
            const types = Object.keys(TOWERS);
            const free = [];
            for (let r2 = 0; r2 < window.ROWS; r2++) {
                for (let c = 0; c < window.COLS; c++) {
                    if (g.map.grid[r2][c] === 0) free.push([c, r2]);
                }
            }
            const stride = Math.max(1, Math.floor(free.length / towers));
            for (let i = 0; i < towers && i * stride < free.length; i++) {
                const [c, r2] = free[i * stride];
                const t = new Tower(c, r2, types[i % types.length]);
                t.level = 1 + (i % 3);
                g.towers.push(t);
            }

            // Enemies spread along the path.
            const etypes = ['normal', 'fast', 'tank', 'air'];
            const P = g.map.path;
            for (let i = 0; i < enemies; i++) {
                const e = new Enemy(P, etypes[i % etypes.length], 2);
                const pi = i % (P.length - 1);
                e.pathIndex = pi;
                e.x = P[pi].x * window.TILE_SIZE;
                e.y = P[pi].y * window.TILE_SIZE;
                g.enemies.push(e);
            }

            // Zoom state — consumed by the render transform (after) or
            // ignored by draw (baseline CSS-transform model).
            const Z = window.__neonZoom;
            if (Z) { Z.scale = zoom; Z.tx = zoom > 1 ? -240 : 0; Z.ty = zoom > 1 ? -160 : 0; }

            g.draw(); g.draw();           // warm caches outside timing
            const t0 = [];
            for (let k = 0; k < frames; k++) {
                const a = performance.now();
                g.draw();
                t0.push(performance.now() - a);
            }
            if (Z) { Z.scale = 1; Z.tx = 0; Z.ty = 0; }
            t0.sort((x, y) => x - y);
            const sum = t0.reduce((s, v) => s + v, 0);
            return {
                mean: sum / t0.length,
                p50: t0[Math.floor(t0.length * 0.5)],
                p95: t0[Math.floor(t0.length * 0.95)],
                canvas: g.canvas.width + 'x' + g.canvas.height,
            };
        }, { ...sc, frames: FRAMES });
        results.push({ ...sc, ...r });
        console.log(`towers=${String(sc.towers).padStart(3)} enemies=${String(sc.enemies).padStart(4)} zoom=${sc.zoom}  mean=${r.mean.toFixed(2)}ms  p50=${r.p50.toFixed(2)}ms  p95=${r.p95.toFixed(2)}ms  (${r.canvas})`);
    }

    const outDir = path.join(__dirname, 'bench');
    fs.mkdirSync(outDir, { recursive: true });
    const out = path.join(outDir, LABEL + '.json');
    fs.writeFileSync(out, JSON.stringify({ label: LABEL, frames: FRAMES, ts: new Date().toISOString(), results }, null, 2));
    console.log('\nwrote', out);

    await browser.close();
    server.kill();
})().catch(e => { console.error(e); process.exit(1); });
