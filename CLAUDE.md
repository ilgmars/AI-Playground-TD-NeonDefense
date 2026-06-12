# Neon Defense — Project Notes

Vanilla-JS browser tower defense. No framework, no build step. Open [index.html](index.html) in a browser to play. Deployed at <https://ilgmars.github.io/AI-Playground-TD-NeonDefense/>.

## File map

```
index.html                       UI shell: top bar, canvas, build menu, overlays
style.css                        Neon theme, panels, tower icons, responsive layout
README.md, CLAUDE.md             Docs (this file)
ANDROID.md                       APK build guide (WebView wrapper); the shipped APK
                                 is the Games release asset, not tracked in git

src/
  config/
    config.js                    Single source of truth for balance:
                                 TOWERS, ENEMIES, WAVE_CONFIG, POTION_CONFIG,
                                 AUTOPILOT_CONFIG, TOWER_UPGRADES
  security/
    aegis.js                     Anti-tamper: signed saves, native-fn sensors, state audit
  audio/
    audio.js                     Web Audio — chiptune BGM + procedural SFX
  render/
    assets.js                    Procedural canvas draw helpers
  engine/
    map.js                       GameMap + mulberry32 PRNG (20×15 grid, random-walk path)
    game.js                      Game class — wave/economy/spawn, draw orchestration, UI sync
    main.js                      Bootstrap, RAF loop, input, DOM wiring, all panel rendering
  entities/
    entities.js                  Tower, Enemy, Projectile, Explosion, TrailParticle, LightningBolt
  ai/
    autopilot.js                 Autopilot class — rule-based tower/upgrade/potion decisions
  progression/
    save.js                      NeonSave — persistent meta save (XP, mastery, signed via aegis)
    tree.js                      Tech-tree purchase / eligibility / auto-unlock
    abilities.js                 In-run ability instances + charges
    backpack.js                  Spatial-grid inventory — pure logic, node-requireable
    boons.js                     Roguelike boon picker at milestone waves
  multiplayer/
    protocol.js, transport.js,   Wire format, transport abstraction, Trystero/WebRTC and
    transport-trystero.js,       MQTT-direct backends, per-peer anti-cheat gate (guard.js),
    mqtt-direct.js, guard.js     room-seeded PRNG (prng.js)
    coop.js, lockstep.js         Co-op: shared deterministic sim, input streaming
    race.js                      Race: own world per peer, display heartbeats only
    global.js                    Global leaderboard over a public MQTT room
    lobby.js, connectivity.js    Lobby flow, broker reachability probing
    turn-config.js               GITIGNORED — TURN creds; tools/install-turn-config.sh writes it

multiplayer/                     Design docs: sync, signalling, anti-cheat, game modes
tests/                           ~55 standalone node suites + tests/run.js runner (see skills)
tools/                           bump-cache.sh, install-hooks.sh, install-turn-config.sh,
                                 auto-tune/ (parallel autopilot strategy search)
.github/workflows/               test.yml, pages.yml (Pages deploy), build-apk.yml — all gate on npm test
docs/
  ai/                            Historical AI prompts / build logs (not runtime)
```

**Load order matters** — there's no module system. See the `<script>` block in [index.html](index.html): config → aegis → audio/render/map/entities/autopilot → progression (save, tree, abilities, backpack) → game.js → boons → multiplayer stack → main.js last. `config.js` must precede `entities.js` (Tower/Enemy read `TOWERS`/`ENEMIES`); `aegis.js` must load right after config (it snapshots pristine natives before anything else can patch them); `main.js` wires everything and must stay last.

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
- **Meta save** in `localStorage['neonDefense.save']` via `NeonSave` ([src/progression/save.js](src/progression/save.js)) — meta-XP, tech tree, mastery, backpack, scoreboards. Every write is **signed by Aegis**; hand-editing localStorage flags the save as cheated. Legacy `neonDefenseScores*` keys are migrated on load.
- **Global scoreboard** syncs over a public MQTT room ([src/multiplayer/global.js](src/multiplayer/global.js)), cached locally.
- **No save/resume** mid-run (multiplayer JOIN auto-resume after an APK reload exists, but the run itself restarts).

## Known shape / gotchas

- **Air spawn rate** (`35 - floor(wave/8)`) and the wave difficulty piecewise formula still live in `Game.startWave()` — centralize if you start tuning them heavily.
- **DOM lookups in hot paths**: `document.getElementById` called 50+ times across files instead of cached once.
- **Rendering is vector + render-transform zoom.** Pinch zoom lives in `window.__neonZoom` and is applied inside `Game.draw()`'s context transform (NOT as a CSS transform on the canvas — that stretches the bitmap and blurs). Every input path (`getCanvasPos`, touch drag-place, cursor broadcast) must invert it explicitly. The static map layer is cached to an offscreen canvas (`Game._drawMapLayer`), re-rasterized only on resize/zoom change; during an active pinch (`window.__neonZoomGesture`) the stale raster is warp-blitted for smoothness. Benchmark with `node tools/render-bench.js --label=<x>` (results in tools/bench/).
- **Shadow/glow on every entity draw call** — map glow is now cached, but tower/enemy glow still rasterizes per frame; will bite at extreme entity counts.
- **No module system, no bundler.** Tests DO exist now (~55 suites, `npm test`) — balance changes are validated headlessly via the autopilot/wave450 smokes, not by hand-playing.
- **main.js is 4800+ lines** — it has absorbed all panel/menu/overlay rendering (tech tree, backpack UI, lobby, scoreboards) on top of bootstrap and input. Largest refactor target in the codebase.
- The committed `android/app/src/main/assets/www/` mirror is usually stale; CI re-syncs it at APK build time, so it only matters for local Gradle builds.
- **Mobile viewport disables zoom** (`user-scalable=no`) but touch drag exists — not obviously discoverable.

## Cache busting (GitHub Pages deploys)

GitHub Pages serves `index.html` with `Cache-Control: max-age=600` and
asset files with `max-age=3600`. After a deploy, visitors whose browser
still has the old HTML reference the previous JS/CSS — that's the "I see
broken state until I hard-refresh" failure mode.

Every `<script>` and `<link>` in `index.html` carries `?v=<utc-timestamp>`.
A pre-commit hook (installed by [tools/install-hooks.sh](tools/install-hooks.sh))
runs [tools/bump-cache.sh](tools/bump-cache.sh) whenever a commit touches
`src/`, `style.css`, or `index.html`, so the bump lands in the same
commit as the source change. After a fresh clone, run
`tools/install-hooks.sh` once. The token is a UTC timestamp rather than
a git SHA so amending a commit doesn't shift the SHA out from under
itself (which would otherwise force a re-bump-and-amend loop).

The 10-minute HTML revalidation window is unavoidable on Pages, but with
the bump in place every visitor whose browser revalidates after a deploy
gets the new JS/CSS automatically — no save data is touched, since
localStorage is independent of HTTP cache.

## Working conventions

- Edit JS files directly; reload the browser to test. No build step. One-time setup after a fresh clone: `npm ci`, `npx playwright install chromium`, `./tools/install-hooks.sh`, `./tools/install-turn-config.sh`.
- **Run `npm test` before committing** — it's the gate for Pages deploy and APK build in CI. See the `run-tests`, `tune-balance`, and `release` skills in [.claude/skills/](.claude/skills/) for the full workflows.
- When changing balance, validate through wave 28+ via the autopilot smoke (`node tests/autopilot.smoke.js --snapshots=10,30 --speed=2048 --ascension=3`) — that's where recent regressions have landed.
- **Balance changes go in [src/config/config.js](src/config/config.js) first.** Tower stats, enemy stats, wave timing, autopilot strategy, and upgrade trees all live there as single-source-of-truth objects. Only touch `entities.js` / `game.js` / `autopilot.js` if the change is logic, not numbers.
- Keep seed compatibility in mind: any change to `GameMap.generateMap()` RNG call order invalidates every shared seed.

## UX bindings (controls)

- **Hotkeys 1–9** select build types in dock order: Blaster, Sniper, Shotgun,
  Laser, Rocket, Flak, Tesla, Silo, Relay. Same keys 1–3 buy upgrade slots
  when a placed tower is selected.
- **Hotkeys fire while paused** so users can pre-select the next build during
  a tactical pause. Numeric input fields skip the hotkey handler.
- **Shift+click on the canvas** keeps the chosen tower selected after a
  successful placement → chain-build a row without re-selecting.
- **Bulk select** (double-click a placed tower) selects all towers of that
  type. The upgrade panel shows the **min cost** across the selection so it
  doesn't appear locked when only the cheapest member is affordable.
- **Per-tower AUTO ⏶ toggle** (in the upgrade menu) buys the cheapest
  affordable upgrade for that tower roughly twice a second. Independent of
  the global Autopilot.
- **SYS button** doubles as the run-end button: shows "RST" early-game,
  flips to "RETIRE" at wave ≥ 30 (same gate as the +50% retire XP bonus).
- **EXIT (⌂)** in the overflow popover quits to the main menu, dropping the
  current run.
- The mobile overflow popover proxies (SPEED / AUTO) are hidden on desktop
  via `.stat-box.overflow-*-proxy { display: none }` — bumping specificity
  past `.stat-box { display: flex }` so they don't double up.

## Original prompts (verbatim — /tasks runs)

### Round 1: feature/QoL pass

> implement autopilot findings, refactor and compact the project, write the prompts in claude md.
> fixes that are needed.
> on the large screen auto and speed buttons are doubled
> when double clicking, upgrading system kind of breaks if you do not have enough money,
> it always needs to show the lowest upgrade so that it is always possible to upgrade if you have money for some towers.
> add buttor for auto upgrade for individual tower and upgrade.
>
> findings from other people:
> 1. Hotkey lai Relay uztaisītu nestrādā
> 2. Hotkey nestrādā kamer spele ir nopauzēta
>    need a button to exit to menu.
>    retire and rst can be combined. retire option appears after vawe 50 or whatever is required to ascend to next level
>    Pievienot iespēju ātrāk uzlikt tornīšus. (Shift+click vai hotkeys lai izvēlētos ko būvēt)
>
> test change and git push each point

Each bullet became a single commit on `main`. The retire-unlock threshold
landed on wave 30 (matches the existing first-clear / XP-bonus logic) rather
than the suggested 50 — stayed consistent with what the rest of the codebase
already treats as "cleared".

## Auto-tune iterative testing harness

Lives under [tools/auto-tune/](tools/auto-tune/). Runs the game headless in 6 parallel Playwright browsers, mutates `AUTOPILOT_CONFIG` knobs each iteration, and auto-commits winners.

### Original prompt (verbatim, LV)

> Tu esi spēļu AI un MLOps inženieris. Tavs uzdevums ir papildināt mūsu Tower Defense deterministisko testēšanas vidi ar automātisku labākās stratēģijas saglabāšanu un publicēšanu (git push).
>
> **Galvenās arhitektūras prasības:**
> - **Deterministiskā vide un Paralēlisms:** 6 Node.js `worker_threads` darbojas headless režīmā (×2000 ātrums). Visiem workeriem nodod identisku PRNG sēklu (`const SEED = fiksēts_skaitlis`). Pilnībā aizstāj `Math.random()`.
> - **Dinamiskā grūtība un Mērķis:** 'Retire' bonuss ir aizliegts. Bots cīnās līdz galam. Ja bots sasniedz noteiktu robežu (piem., Wave 300), Workeris nekavējoties pārstartē simulāciju šai pašai stratēģijai ar nākamo grūtības pakāpi (`ascensionLevel + 1`).
> - **Stratēģiju vērtēšana:** Katrs no 6 workeriem izmanto atšķirīgus `autopilot.js` parametrus. Pēc visu workera sesiju pabeigšanas Main pavediens izvēlas to, kuram ir augstākais $XP/sec$ pie augstākā $Ascension$ līmeņa.
> - **Automātiskais Git Commit:** Kad labākais bots ir noteikts, Main pavediens saglabā uzvarētāja parametrus, izveido detalizētu commit ziņojumu (`Auto-tune: Best bot found. Ascension: {A}, Wave: {W}, XP/sec: {E}, Params: {P}.`), un izpilda `git add . && git commit && git push` caur `child_process.execSync`.
>
> **Iteratīvais cikls (papildinājums):**
> - Labākā bota kods kļūst par bāzi nākamās iterācijas variantiem (1 kontrole + 5 mutācijas), ko laist paralēli.
> - Katrā iterācijā, kur redzams uzlabojums → `commit + push`.
> - Ja uzlabojuma nav → `commit + push` katru piekto iterāciju.
> - Neprasi confirmation darbībām — automātiski akceptē.

### Invariants

- **PRNG:** every `Math.random()` call site (entities.js, autopilot.js, game.js, audio.js, map.js) must read from the same seeded mulberry32. Seed is constant across workers and across iterations.
- **No retire:** the harness disables the retire path entirely; runs end only at game-over.
- **Speed:** workers force `gameSpeed = 2048` (256× hidden tier × 8).
- **Ascension escalation:** on reaching wave 300, worker reloads the page with the same params and `ascensionTier += 1`.
- **Scoring:** primary key = highest ascension reached; tie-break = highest `XP/sec`.

### Commit policy

- Improvement (winner score > stored best) → commit + push *that iteration*.
- No improvement → commit + push every 5th iteration anyway, so progress (or lack thereof) is recorded.
- All harness commits use the literal subject `Auto-tune: Best bot found. Ascension: {A}, Wave: {W}, XP/sec: {E}, Params: {P}` (P is the param diff, not the full set).
