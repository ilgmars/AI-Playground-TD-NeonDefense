#!/usr/bin/env node

// Main orchestrator: spawns workers in parallel, picks winner, mutates, repeats.

const { Worker } = require('worker_threads');
const path = require('path');
const { generateNextParamSets, paramsOnly } = require('./mutate');
const { handleWinner, loadBestParams, saveBestParams, loadState, updateMaxAscension } = require('./commit');

const WORKER_COUNT = Math.max(1, parseInt(process.env.WORKERS || '6'));
const ITERATIONS = Math.max(1, parseInt(process.env.ITERATIONS || '1000'));
const WORKER_FILE = path.join(__dirname, 'worker.js');

// Default AUTOPILOT_CONFIG numeric params (functions are baked into the game)
const DEFAULT_PARAMS = {
    tickInterval: 30,
    laserSynergyRange: 3,
    laserSynergyScore: 40,
    saveBufferFlakUrgent: 100,
    saveBufferFlakNeeded: 50,
    saveDeficitSevere: 2,
    saveDeficitModerate: 1,
    saveEarlyTowerTotal: 8,
    saveCommitFraction: 0.75,
    mustBuildMinTowers: 7,
    mustBuildWantedFraction: 0.68,
    upgradeAlongsideBuild: 200,
    potionHealthThreshold: 12,
    airImminentWindow: 2,
    wantedCountCapMult: {
        basic: 1.0,
        flak: 1.0,
        rapid: 1.0,
        laser: 1.2,
        sniper: 1.0,
        rocket: 1.0,
        electric: 1.0,
        silo: 1.0,
        income: 1.0
    },
    // Upgrade value weights
    upgradeValue: { silo: 10, rocket: 9, electric: 8, sniper: 7, laser: 6, flak: 5, rapid: 4, basic: 3, income: 2 }
};

// Run one iteration: spawn 6 workers, wait for all, pick winner
async function runIteration(paramSets, ascensionTier = 0) {
    console.log(`\nStarting iteration Asc=${ascensionTier} with ${paramSets.length} param variants...`);

    const workers = paramSets.map((params, idx) => {
        return new Promise((resolve, reject) => {
            const worker = new Worker(WORKER_FILE);
            worker.on('message', (msg) => {
                worker.terminate();
                if (msg.success) {
                    resolve(msg.result);
                } else {
                    reject(new Error(msg.error));
                }
            });
            worker.on('error', reject);
            worker.on('exit', (code) => {
                if (code !== 0) {
                    reject(new Error(`Worker ${idx} exited with code ${code}`));
                }
            });

            // Send params and ascension tier to worker
            worker.postMessage({ params, workerId: idx, ascensionTier });
        });
    });

    try {
        const results = await Promise.all(workers);

        // Log all results
        console.log('\nResults:');
        results.forEach((r, i) => {
            console.log(`  Worker ${i}: Asc=${r.ascension}, Wave=${r.finalWave}, XP/sec=${r.xpPerSec.toFixed(2)}`);
        });

        // Pick winner: highest ascension, then highest wave, then highest xps
        let winner = results[0];
        for (let i = 1; i < results.length; i++) {
            const r = results[i];
            const w = results[i === 0 ? 0 : i];

            if (r.ascension > winner.ascension ||
                (r.ascension === winner.ascension && r.finalWave > winner.finalWave) ||
                (r.ascension === winner.ascension && r.finalWave === winner.finalWave && r.xpPerSec > winner.xpPerSec)) {
                winner = r;
            }
        }

        console.log(`\n[WINNER] Asc=${winner.ascension}, Wave=${winner.finalWave}, XP/sec=${winner.xpPerSec.toFixed(2)}, RunTime=${winner.runTime}ms`);

        // Handle commit/push logic
        const { improved, committed, iteration } = handleWinner(winner);

        return winner;
    } catch (error) {
        console.error('Iteration failed:', error.message);
        throw error;
    }
}

// Main loop
async function main() {
    console.log('=== Auto-tune Tower Defense Harness ===');
    console.log(`Workers: ${WORKER_COUNT}`);
    console.log(`Iterations: ${ITERATIONS}`);

    let best = { ...DEFAULT_PARAMS, ...paramsOnly(loadBestParams()) };
    let paramSets = generateNextParamSets(best, WORKER_COUNT);
    let state = loadState();
    let ascensionTier = Number.isFinite(Number(process.env.ASCENSION))
        ? Math.max(0, Math.min(Number(process.env.ASCENSION), 10))
        : (state.maxAscensionReached || 0);

    console.log(`Starting from Ascension ${ascensionTier} (max reached: ${state.maxAscensionReached})`);

    // Run indefinitely, escalating ascension when benchmarking is solid
    for (let iter = 0; iter < ITERATIONS; iter++) {
        try {
            const winner = await runIteration(paramSets, ascensionTier);
            best = winner.params;
            paramSets = generateNextParamSets(best, WORKER_COUNT);

            // Track max ascension reached
            updateMaxAscension(winner.ascension, state);

            // Escalate difficulty only when a bot actually reaches wave 100
            if (winner.finalWave >= 100 && ascensionTier < 10) {
                ascensionTier++;
                updateMaxAscension(ascensionTier, state);
                console.log(`\n*** Wave 100 reached — escalating to Ascension ${ascensionTier} ***\n`);
            }
        } catch (error) {
            console.error(`Iteration ${iter} failed:`, error.message);
            // Continue to next iteration
            await new Promise(r => setTimeout(r, 5000));
        }
    }
}

main().catch(e => {
    console.error('Fatal error:', e);
    process.exit(1);
});
