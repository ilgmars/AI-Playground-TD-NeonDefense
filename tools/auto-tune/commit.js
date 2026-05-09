// Auto-commit logic: saves winner and commits to git if improvement detected.
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const BEST_PARAMS_FILE = path.join(__dirname, 'best-params.json');
const STATE_FILE = path.join(__dirname, 'state.json');
const NON_IMPROVEMENT_COMMIT_INTERVAL = 10;
const COMMIT_PATHS = [
    'src/ai/autopilot.js',
    'src/config/config.js',
    'tools/auto-tune',
    'docs/autopilot-test-results.md',
    'docs/ai/claude-prompts.md'
];

function loadBestParams() {
    if (fs.existsSync(BEST_PARAMS_FILE)) {
        return JSON.parse(fs.readFileSync(BEST_PARAMS_FILE, 'utf8'));
    }
    return null;
}

function saveBestParams(winner) {
    fs.writeFileSync(BEST_PARAMS_FILE, JSON.stringify(winner, null, 2));
}

function loadState() {
    if (fs.existsSync(STATE_FILE)) {
        return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
    }
    return { iteration: 0, lastCommit: -1, maxAscensionReached: 0 };
}

function saveState(state) {
    fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
}

function updateMaxAscension(ascension, state) {
    state.maxAscensionReached = Math.max(state.maxAscensionReached || 0, ascension);
    saveState(state);
}

function scoreKey(result) {
    // Primary: ascension (higher is better)
    // Secondary: xpPerSec (higher is better)
    return [result.ascension, result.xpPerSec];
}

function isImprovement(newScore, oldScore) {
    if (!oldScore) return true;
    if (newScore[0] > oldScore[0]) return true; // higher ascension
    if (newScore[0] === oldScore[0] && newScore[1] > oldScore[1]) return true; // same ascension, higher xps
    return false;
}

function commitAndPush(result, isImprovement) {
    const cwd = '/home/claude/AI-Playground-TD-NeonDefense';

    try {
        execSync(`git add ${COMMIT_PATHS.map(p => JSON.stringify(p)).join(' ')}`, { cwd, stdio: 'pipe' });

        // Build commit message
        const paramStr = JSON.stringify(result.params).slice(0, 100);
        const message = `Auto-tune: Best bot found. Ascension: ${result.ascension}, Wave: ${result.finalWave}, XP/sec: ${result.xpPerSec.toFixed(2)}, Params: ${paramStr}

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>`;

        // Commit
        execSync(`git commit -m "${message.replace(/"/g, '\\"')}"`, { cwd, stdio: 'pipe' });

        // Push
        execSync('git pull --rebase origin main 2>/dev/null ; git push origin main', { cwd, stdio: 'pipe' });

        return true;
    } catch (error) {
        console.error('Commit/push failed:', error.message);
        return false;
    }
}

function handleWinner(result) {
    if (process.env.AUTOTUNE_COMMIT === '0') {
        saveBestParams(result);
        const state = loadState();
        state.iteration++;
        saveState(state);
        console.log(`\n[ITER ${state.iteration}] AUTOTUNE_COMMIT=0, saved winner without committing.`);
        return { improved: false, committed: false, iteration: state.iteration };
    }

    const best = loadBestParams();
    const state = loadState();
    const newScore = scoreKey(result);
    const oldScore = best ? scoreKey(best) : null;
    const improved = isImprovement(newScore, oldScore);

    // Always save the new best params
    saveBestParams(result);
    state.iteration++;

    let committed = false;

    if (improved) {
        // Improvement: commit immediately
        console.log(`\n[ITER ${state.iteration}] IMPROVEMENT! Ascension: ${result.ascension}, XP/sec: ${result.xpPerSec.toFixed(2)}`);
        committed = commitAndPush(result, true);
        if (committed) state.lastCommit = state.iteration;
    } else if (state.iteration - state.lastCommit >= NON_IMPROVEMENT_COMMIT_INTERVAL) {
        console.log(`\n[ITER ${state.iteration}] No improvement, but commit every ${NON_IMPROVEMENT_COMMIT_INTERVAL}th iter. (Last commit: iter ${state.lastCommit})`);
        committed = commitAndPush(result, false);
        if (committed) state.lastCommit = state.iteration;
    } else {
        console.log(`\n[ITER ${state.iteration}] No improvement (will commit on iter ${state.lastCommit + NON_IMPROVEMENT_COMMIT_INTERVAL})`);
    }

    saveState(state);
    return { improved, committed, iteration: state.iteration };
}

module.exports = { handleWinner, loadBestParams, saveBestParams, loadState, saveState, updateMaxAscension };
