// Worker: runs a single Playwright headless browser with given params.
// Receives workerData { seed, params, workerId }.
// Returns { xpPerSec, ascension, finalWave, params, runTime }.

const { parentPort } = require('worker_threads');
const { chromium } = require('playwright');
const { startServer, stopServer } = require('./server-utils');
const { injectSetup } = require('./inject-utils');

const SEED = 42069; // fixed seed for reproducibility
const PORT_BASE = 8765;
const MAX_WALL_TIME = 600000; // 10 min per run (safeguard)
const GAME_SPEED = 4000;

async function runGame(params, workerId, ascensionTier = 0) {
    const port = PORT_BASE + workerId;
    const server = await startServer(port);

    try {
        const browser = await chromium.launch({ headless: true });
        const page = await browser.newPage();
        await page.setViewportSize({ width: 1280, height: 800 });

        // Inject deterministic PRNG and no-retire
        await injectSetup(page, SEED);

        // Apply params to AUTOPILOT_CONFIG
        const paramJson = JSON.stringify(params);
        await page.goto(`http://localhost:${port}/`, { waitUntil: 'domcontentloaded' });

        // Inject params into the page (only numeric params, functions stay in game)
        await page.evaluate((paramsStr) => {
            const newParams = JSON.parse(paramsStr);
            if (typeof AUTOPILOT_CONFIG !== 'undefined') {
                // Apply only scalar values; skip functions like buildChance
                for (const [key, val] of Object.entries(newParams)) {
                    if (typeof val !== 'function') {
                        AUTOPILOT_CONFIG[key] = val;
                    }
                }
            }
        }, paramJson);

        // Set ascension tier and start game
        await page.click('#menu-start-btn');
        await page.waitForTimeout(800);

        // Set ascension tier directly via JS — bypasses locked UI buttons
        if (ascensionTier > 0) {
            await page.evaluate((tier) => {
                if (typeof setTier === 'function') setTier(tier);
                else if (typeof selectedTier !== 'undefined') {
                    selectedTier = tier;
                }
            }, ascensionTier);
            await page.waitForTimeout(300);
        }

        await page.waitForSelector('#start-btn', { timeout: 5000 });
        await page.click('#start-btn');
        await page.waitForTimeout(1000);

        // Enable autopilot
        await page.click('#autopilot-btn');

        // Wait for game to be initialized, then set speed
        await page.waitForTimeout(500);
        await page.evaluate((speed) => {
            eval(`gameSpeed = ${speed}`);
        }, GAME_SPEED);

        const runStart = Date.now();
        let maxWaveReached = 0;
        let totalRunTime = 0;
        let currentAscension = ascensionTier;
        let lastLoggedWave = 0;

        // Poll game state until game-over or wave 300 (restart logic)
        while (true) {
            const state = await page.evaluate(() => {
                try {
                    if (typeof game === 'undefined') return { ready: false };
                    if (game.state === 'gameover' || game.state === 'victory') {
                        return {
                            done: true,
                            wave: game.wave,
                            health: game.health,
                            totalXP: game.totalXP || 0,
                            elapsedMS: game.elapsedMS || 0
                        };
                    }
                    return {
                        ready: true,
                        wave: game.wave,
                        health: game.health,
                        money: game.money,
                        towers: game.towers.length,
                        state: game.state
                    };
                } catch (e) {
                    return { error: e.message };
                }
            });

            // Log progress every 10 waves
            if (state.ready && state.wave % 10 === 0 && state.wave !== lastLoggedWave) {
                lastLoggedWave = state.wave;
                const elapsed = Math.round((Date.now() - runStart) / 1000);
                console.log(`[Worker ${workerId}] Asc=${currentAscension}, Wave ${state.wave}, HP=${state.health}, $=${state.money}, Time=${elapsed}s`);
            }

            if (state.done) {
                totalRunTime = Date.now() - runStart;
                maxWaveReached = state.wave;
                const elapsed = Math.round(totalRunTime / 1000);
                console.log(`[Worker ${workerId}] GAMEOVER at Asc=${currentAscension}, Wave ${state.wave}, Time=${elapsed}s`);
                break;
            }

            if (state.ready && state.wave >= 100) {
                // Wave 100 reached: end this iteration, don't continue
                totalRunTime = Date.now() - runStart;
                maxWaveReached = 100;
                const elapsed = Math.round(totalRunTime / 1000);
                console.log(`[Worker ${workerId}] Wave 100 reached! Iteration complete at Asc=${currentAscension}, Time=${elapsed}s`);
                break;
            }

            if (Date.now() - runStart > MAX_WALL_TIME) {
                console.log(`Worker ${workerId}: timeout at wave ${state.wave}`);
                break;
            }

            await page.waitForTimeout(100);
        }

        // Calculate XP/sec (use wave as proxy for XP)
        const elapsedSec = (totalRunTime || (Date.now() - runStart)) / 1000;
        const finalState = await page.evaluate(() => {
            if (typeof game === 'undefined') return { totalXP: 0, finalWave: 0 };
            // Try to get totalXP, fallback to wave * 100 as proxy
            const xp = game.totalXP || (game.wave || 0) * 100;
            return { totalXP: xp, finalWave: game.wave || 0 };
        });

        const xpPerSec = Math.max(finalState.totalXP, maxWaveReached * 100) / Math.max(elapsedSec, 1);

        await browser.close();

        return {
            xpPerSec,
            ascension: currentAscension,
            finalWave: maxWaveReached,
            params,
            runTime: totalRunTime || (Date.now() - runStart),
            totalXP: finalState.totalXP
        };
    } finally {
        stopServer(server);
    }
}

// Entry point: receive params from parent thread
if (parentPort) {
    parentPort.on('message', async (msg) => {
        try {
            const result = await runGame(msg.params, msg.workerId, msg.ascensionTier || 0);
            parentPort.postMessage({ success: true, result });
        } catch (error) {
            parentPort.postMessage({ success: false, error: error.message });
        }
    });
}

module.exports = { runGame };
