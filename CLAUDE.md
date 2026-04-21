# Neon Defense — Project Notes

Vanilla-JS browser tower defense. No framework, no build step. Open [index.html](index.html) in a browser to play. Deployed at <https://ilgmars.github.io/AI-Playground-TD-NeonDefense/>.

## File map

```
index.html                       UI shell: top bar, canvas, build menu, overlays
style.css                        Neon theme, panels, tower icons, responsive layout
README.md, CLAUDE.md             Docs (this file)

src/
  config/
    config.js                    Single source of truth for balance:
                                 TOWERS, ENEMIES, WAVE_CONFIG, POTION_CONFIG,
                                 AUTOPILOT_CONFIG, TOWER_UPGRADES
  audio/
    audio.js                     Web Audio — chiptune BGM + procedural SFX
  render/
    assets.js                    Procedural canvas draw helpers
  engine/
    map.js                       GameMap + mulberry32 PRNG (20×15 grid, random-walk path)
    game.js                      Game class — wave/economy/spawn, draw orchestration, UI sync
    main.js                      Bootstrap, RAF loop, input, DOM wiring, localStorage scoreboard
  entities/
    entities.js                  Tower, Enemy, Projectile, Explosion, TrailParticle, LightningBolt
  ai/
    autopilot.js                 Autopilot class — rule-based tower/upgrade/potion decisions

docs/
  ai/                            Historical AI prompts / build logs (not runtime)
```

**Load order matters** — there's no module system. `config.js` must load before `entities.js` (Tower/Enemy read `TOWERS`/`ENEMIES`), and `autopilot.js` must load before `game.js` (Game lazily instantiates `Autopilot`). See the `<script>` block in [index.html](index.html).

## Game architecture

- **Global state, not modules.** Key globals: `game` (Game instance), `gameSpeed`, `selectedTowerType`, `mousePos`, `TILE_SIZE`/`ROWS`/`COLS`, plus every config object (`TOWERS`, `ENEMIES`, `AUTOPILOT_CONFIG`, etc.). Event handlers are attached as `window.selectTower`, `window.buyPotion`, etc.
- **Game state machine** (`game.state`): `start` → `playing` ↔ `paused` → `gameover`.
- **Main loop** in [src/engine/main.js](src/engine/main.js): `requestAnimationFrame` throttled to ~60 FPS, then runs `game.update()` N times where N = `gameSpeed` (1/2/4/8/16, plus hidden 256× unlocked by 15 rapid clicks on the speed button).
- **DPI-aware canvas** scales by `window.devicePixelRatio` inside `Game.draw()`.
- **Coupling is tight.** Autopilot reads game state directly and calls `game.buildTower()`. UI refreshes via `updateUI()` after state changes.

## Gameplay mechanics

- **9 towers** (cost / role): Blaster 50 (baseline), Sniper 100 (piercing, long range), Shotgun 150 (5 pellets, pierce ×2), Laser 200 (continuous + 20% slow), Rocket 250 (splash, homing), Flak 150 (AA, 4× vs air), Tesla 300 (chain ×3), Silo 400 (rocket swarm), Relay 200 (passive income). All stats in [src/config/config.js](src/config/config.js) under `TOWERS`. Plus **Repair** potion at `baseCost + uses × costPerUse` (`POTION_CONFIG`).
- **4 enemy archetypes** (`ENEMIES` in config): normal / fast / tank / air. Air units: 80% fly straight, 20% follow path (`WAVE_CONFIG.airPathFollowChance`).
- **Waves**: hand-tuned for waves 1–10 in `Game.waveData`, then procedural scaling in `startWave()`. Air waves every 5th wave (cooldown bumped `normalCooldown` → `airWaveCooldown` from `WAVE_CONFIG` before air).
- **Difficulty formula** in `Game.startWave()` factors in tower investment (HP scales by `spending / 2000`) and a logarithmic late-game curve. Recent commits (`ai lvl 4 fix`, `spike at 28 fix`) show this has been iteratively tuned — balance changes here are load-bearing.
- **Targeting modes**: first / closest / max-HP / min-HP (see `Tower.update()` in entities.js). Defaults per tower come from `TOWERS[type].defaultTargetMode` in config.
- **Upgrades**: 3 per tower, cost grows by `baseCost × costMult^level`. Some towers have special upgrades (Ricochet for sniper, Cryo Beam for laser, Capacity for silo, Network Bonus for relay). See `TOWER_UPGRADES` in config.

## Autopilot

Rule-based heuristic (no ML), lives in [src/ai/autopilot.js](src/ai/autopilot.js). Three phases per tick:

1. **`_tryBuild`** — compute per-type deficits vs `AUTOPILOT_CONFIG.wantedCount`, pick target type (flak urgency first, then biggest deficit), fall back to affordable alternatives, score candidate tiles by path coverage + type-specific shape heuristics + laser synergy bonus, place at best spot.
2. **`_tryUpgrade`** — sort all affordable upgrades (flak/laser first during air-imminent windows, then spread by lowest total level, tie-break by `AUTOPILOT_CONFIG.upgradeValue`), buy top option. Skipped while saving for a critical tower.
3. **`_tryBuyPotion`** — auto-heal if HP ≤ `potionHealthThreshold`, unless it would raid the tower-saving fund.

Autopilot strategy knobs live in `AUTOPILOT_CONFIG`; the class only implements the rules. Autopilot tuning is coupled to wave difficulty — changing one usually means re-testing the other.

## Persistence

- **Seed** (map.js) stored in `location.hash`, copyable via the SEED button. Reproducible runs.
- **Scoreboard** in `localStorage['neonDefenseScores']` — top 5, 3-char names ([main.js:219-249](main.js#L219-L249)).
- **No save/resume** mid-run.

## Known shape / gotchas

- **Air spawn rate** (`35 - floor(wave/8)`) and the wave difficulty piecewise formula still live in `Game.startWave()` — centralize if you start tuning them heavily.
- **DOM lookups in hot paths**: `document.getElementById` called 50+ times across files instead of cached once.
- **Shadow/glow on every draw call** — fine at 60 FPS for now, will bite at higher entity counts.
- **No module system, no bundler, no tests.** Balance changes are validated by playing.
- **Mobile viewport disables zoom** (`user-scalable=no`) but touch drag exists — not obviously discoverable.

## Working conventions

- Edit JS files directly; reload the browser to test. No install/build command.
- When changing balance, play at least through wave 28+ (that's where recent regressions have landed — see commit history).
- **Balance changes go in [src/config/config.js](src/config/config.js) first.** Tower stats, enemy stats, wave timing, autopilot strategy, and upgrade trees all live there as single-source-of-truth objects. Only touch `entities.js` / `game.js` / `autopilot.js` if the change is logic, not numbers.
- Keep seed compatibility in mind: any change to `GameMap.generateMap()` RNG call order invalidates every shared seed.
