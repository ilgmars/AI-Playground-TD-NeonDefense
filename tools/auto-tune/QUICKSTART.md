# Auto-tune Harness — Quick Start

## Run

```bash
node tools/auto-tune/main.js
```

This spawns 6 Playwright browsers in parallel, each running the game headless at 2048× speed with different `AUTOPILOT_CONFIG` parameter sets. Workers run indefinitely, automatically committing improvements.

## Output

- **Iteration logs**: stdout shows each iteration's results and winner.
- **best-params.json**: Current best param set (updated after each iteration).
- **state.json**: Iteration counter and last-commit tracking (for commit policy: improve=commit, else every 5th).

## How it works

1. **Workers (6 parallel)**
   - Each on port 8765+N (8765–8770)
   - Receive unique param sets via worker_threads message passing
   - Run game at `gameSpeed = 2048` (headless)
   - On reaching wave 300: reload with `ascensionTier += 1` (same params, same seed)
   - On game-over: return `{xpPerSec, ascension, finalWave, params}`

2. **Winner selection**
   - Primary: highest ascension reached
   - Tiebreak: highest XP/sec

3. **Mutation**
   - Winner → 1 control (exact copy) + 5 variants with Gaussian perturbations
   - Perturbed knobs: laserSynergyScore, mustBuildMinTowers, saveBuffer*, upgradeValue weights, wantedCountCapMult

4. **Commit policy**
   - Improvement (new best) → commit + push *immediately*
   - No improvement → commit + push every 5th iteration anyway (to track progress/stagnation)

## Debugging

Check logs if a worker crashes:
- Port 8765+N server may fail to start (port in use?)
- Playwright timeout (game didn't reach game-over in 10 min)
- Ascension UI selectors may differ (check index.html/main.js)

## Tuning parameters

Edit `tools/auto-tune/main.js`:
- `DEFAULT_PARAMS`: starting point
- `WORKER_COUNT`: # of parallel browsers
- `GAME_SPEED`: headless game speed (2048 = 256× hidden tier × 8)
- `MAX_WALL_TIME`: timeout per run (600s = 10 min)

Edit `tools/auto-tune/mutate.js`:
- `stddev` in `mutate()`: how much to perturb (0.1 = 10% Gaussian)
- Which knobs get mutated (currently: laser, flak, potion, save, upgrade, wanted)
