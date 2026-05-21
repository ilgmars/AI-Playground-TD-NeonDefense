const { chromium } = require('playwright');
const { spawn } = require('child_process');

const args = Object.fromEntries(process.argv.slice(2).map(arg => {
    const [key, value = 'true'] = arg.replace(/^--/, '').split('=');
    return [key, value];
}));

const SNAPSHOT_WAVES = (args.snapshots || process.env.SNAPSHOTS || '2,3,4,5,6,7,8,9,10,15,20,30,50,75,100')
    .split(',')
    .map(n => parseInt(n.trim()))
    .filter(n => Number.isFinite(n) && n > 0);
const MAX_WAIT_MS = 300000;
const PORT = parseInt(args.port || process.env.PORT || '8765');
const GAME_SPEED = parseInt(args.speed || process.env.SPEED || '5000');
const SEED = args.seed || process.env.SEED || '';
const ASCENSION = Math.max(0, Math.min(parseInt(args.ascension || process.env.ASCENSION || '6'), 10));
const USE_VARIANTS = args.variants === 'true' || process.env.VARIANTS === '1';

async function main() {
    const server = spawn(process.execPath, ['tools/test-http-server.js', String(PORT)], {
        cwd: __dirname, stdio: 'ignore'
    });
    await new Promise(r => setTimeout(r, 600));

    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    await page.setViewportSize({ width: 1280, height: 800 });

    const jsErrors = [];
    page.on('pageerror', e => jsErrors.push(e.message));

    const seedHash = SEED ? `#${SEED}` : '';
    await page.goto(`http://localhost:${PORT}/${seedHash}`);
    await page.waitForTimeout(500);

    // Navigate to game directly — expose game to window
    await page.evaluate(() => {
        // Patch init so it sets window._game after construction
        const origAddListener = document.addEventListener.bind(document);
        document.addEventListener = function(type, fn, ...args) {
            if (type === 'DOMContentLoaded') {
                origAddListener(type, function(...cbArgs) {
                    fn(...cbArgs);
                    // After init runs, expose game on window
                    if (typeof game !== 'undefined') window._g = game;
                }, ...args);
            } else {
                origAddListener(type, fn, ...args);
            }
        };
    });

    await page.click('#menu-start-btn');
    await page.waitForTimeout(200);
    if (ASCENSION > 0) {
        await page.evaluate((tier) => {
            eval(`selectedTier = ${tier}`);
            if (typeof updateModeDisplay === 'function') updateModeDisplay(tier);
        }, ASCENSION);
    }
    if (USE_VARIANTS) {
        await page.evaluate(() => {
            for (const baseType of NeonSave.TOWER_TYPES) {
                if (!save.towerMastery[baseType]) save.towerMastery[baseType] = { xp: 10000, milestones: { m1: true, m2: true } };
                save.towerMastery[baseType].xp = Math.max(save.towerMastery[baseType].xp || 0, 10000);
                save.towerMastery[baseType].milestones = { m1: true, m2: true };
            }
            NeonSave.write(save);
            eval('selectedTowerLoadout = { ...TOWER_VARIANTS }');
        });
    }
    await page.click('#start-btn');
    await page.waitForTimeout(800);

    // Try to get game reference from the let variable directly
    const probe = await page.evaluate(() => {
        try {
            // 'game' is a let at top level of main.js — accessible in same script scope
            const g = eval('game');
            if (!g) return { found: false };
            return { found: true, state: g.state, wave: g.wave, ascension: g.ascensionTier };
        } catch(e) {
            return { found: false, err: e.message };
        }
    });
    console.log('Game probe:', JSON.stringify(probe));

    if (!probe.found) {
        console.error('Cannot access game instance — check main.js global scope');
        await browser.close(); server.kill(); return;
    }

    // Enable autopilot first, then set speed
    await page.click('#autopilot-btn');
    await page.evaluate((speed) => { eval(`gameSpeed = ${speed}`); }, GAME_SPEED);

    const started = Date.now();
    let nextSnap = 0;
    let lastWave = 0;
    const log = [];

    const getState = () => page.evaluate(() => {
        try {
            const g = eval('game');
            if (!g) return null;
            if (g.state === 'gameover' || g.state === 'victory') {
                return { done: true, reason: g.state, wave: g.wave, health: g.health };
            }
            const counts = {};
            const typeCounts = {};
            for (const t of g.towers) {
                const b = t.type === 'income_research' ? 'income'
                        : t.type.includes('_') ? t.type.split('_')[0] : t.type;
                counts[b] = (counts[b] || 0) + 1;
                typeCounts[t.type] = (typeCounts[t.type] || 0) + 1;
            }
            let pathFree = 0, totalFree = 0;
            for (let r = 0; r < ROWS; r++) {
                for (let c = 0; c < COLS; c++) {
                    if (!g.map.isBuildable(c, r)) continue;
                    if (g.towers.find(t => t.c === c && t.r === r)) continue;
                    totalFree++;
                    const nb = [[0,1],[1,0],[0,-1],[-1,0],[1,1],[-1,-1],[1,-1],[-1,1]];
                    for (const [dc,dr] of nb) {
                        const nc=c+dc, nr=r+dr;
                        if (nc<0||nc>=COLS||nr<0||nr>=ROWS) continue;
                        const cell=g.map.grid[nr][nc];
                        if (cell===1||cell===2||cell===3){pathFree++;break;}
                    }
                }
            }
            return {
                done: false, wave: g.wave, health: g.health, money: g.money,
                towers: g.towers.length, towerCounts: counts, typeCounts,
                pathFree, totalFree, autopilot: g.autopilot,
                enemiesAlive: g.enemies.filter(e=>e.active).length,
            };
        } catch(e) { return { err: e.message }; }
    });

    while (Date.now() - started < MAX_WAIT_MS) {
        const state = await getState();
        if (!state || state.err) { await new Promise(r => setTimeout(r, 100)); continue; }

        if (state.done) {
            log.push({ event: state.reason, wave: state.wave, health: state.health });
            console.log(`\n=== ${state.reason.toUpperCase()} at wave ${state.wave} ===`);
            break;
        }

        if (state.wave >= SNAPSHOT_WAVES[nextSnap] && state.wave !== lastWave) {
            lastWave = state.wave;
            log.push({ ...state });
            await page.screenshot({ path: `/tmp/ap-w${SNAPSHOT_WAVES[nextSnap]}-p${PORT}.png` });
            console.log(`Wave ${state.wave}: HP=${state.health} $=${state.money} towers=${state.towers} pathFree=${state.pathFree}/${state.totalFree} auto=${state.autopilot}`);
            console.log(`  Composition: ${JSON.stringify(state.towerCounts)}`);
            if (USE_VARIANTS) console.log(`  Types: ${JSON.stringify(state.typeCounts)}`);
            while (nextSnap < SNAPSHOT_WAVES.length && state.wave >= SNAPSHOT_WAVES[nextSnap]) nextSnap++;
            if (nextSnap >= SNAPSHOT_WAVES.length) break;
        }
        await new Promise(r => setTimeout(r, 100));
    }

    if (jsErrors.length > 0) console.error('\nJS errors:', jsErrors);
    console.log('\n--- SUMMARY ---');
    for (const e of log) console.log(JSON.stringify(e));

    await browser.close();
    server.kill();
}

main().catch(e => { console.error(e); process.exit(1); });
