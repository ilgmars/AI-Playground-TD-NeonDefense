---
name: tune-balance
description: Workflow for gameplay balance changes (tower/enemy stats, wave difficulty, autopilot strategy, upgrades) — where numbers live, seed-compatibility rules, and how to validate without hand-playing.
---

# Balance tuning workflow

## Where numbers live

**All balance goes in [src/config/config.js](../../../src/config/config.js) first** — `TOWERS`, `ENEMIES`, `WAVE_CONFIG`, `POTION_CONFIG`, `AUTOPILOT_CONFIG`, `TOWER_UPGRADES`. Only touch `entities.js` / `game.js` / `autopilot.js` when the change is logic, not numbers.

Exceptions still hard-coded in `Game.startWave()` ([src/engine/game.js](../../../src/engine/game.js)): air spawn rate (`35 - floor(wave/8)`) and the piecewise wave-difficulty formula (scales with tower spending and a logarithmic late-game curve). These have been iteratively tuned — treat them as load-bearing.

## Invariants

- **Seed compatibility:** any change to the RNG call order in `GameMap.generateMap()` ([src/engine/map.js](../../../src/engine/map.js)) invalidates every shared seed — and in multiplayer, both co-op and race assume both peers generate identical worlds from the room seed. Don't reorder `Math.random`/mulberry32 calls in map generation or per-frame simulation.
- **Autopilot coupling:** wave difficulty and `AUTOPILOT_CONFIG` are tuned against each other. Changing one means re-validating the other.
- **Determinism:** simulation code must draw randomness through the seeded PRNG paths; tests and lockstep multiplayer depend on it.

## Validating (no hand-playing required)

1. `npm test` — fast regression net (see the run-tests skill).
2. **Autopilot smoke** — headless run to wave 30 at high speed (~2 min):
   `node tests/autopilot.smoke.js --snapshots=10,30 --speed=2048 --ascension=3`
   Recent regressions have historically landed around **wave 28+**, which this covers.
3. **Long-haul smoke** for late-game/economy changes (~5–8 min):
   `node tests/wave450.smoke.js --target=450 --speed=8192 --ascension=0`
4. `npm run test:perf` if the change adds entities or per-frame work; compare against [perf-history.json](../../../perf-history.json).

## Auto-tune harness

[tools/auto-tune/](../../../tools/auto-tune/) mutates `AUTOPILOT_CONFIG` knobs across 6 parallel headless browsers and auto-commits winners (commit subject `Auto-tune: Best bot found. …`). Use it for autopilot strategy search, not for hand-targeted balance edits. Scoring: highest ascension reached, tie-break XP/sec.
