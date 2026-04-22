# Roguelike Meta-Progression Milestone 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the 645ce59 Easy/Normal/Hard preset system with an 8-tier Ascension ladder (A0–A7, stat-only modifiers), add a `neonDefense.save` localStorage schema with migration from legacy scoreboards, and begin accumulating Meta-XP per run (spending comes in M2). Ships as a strictly-better game with finer-grained difficulty and persistent progression state, forward-compatible with M2/M3.

**Architecture:** Introduces a single `NeonSave` namespace in `src/progression/save.js` for all save I/O, XP calculation, and legacy migration. Adds `ASCENSION_TIERS` and `getAscensionEffects(tier)` to `src/config/config.js`. `Game` constructor swaps `difficulty` param for `ascensionTier`; all Ascension multipliers are resolved to an `effects` object and applied at existing 645ce59 touchpoints. The three current difficulty-selector UIs (start-screen, game-over, restart-confirm) become Ascension selectors, gated to `[0, save.ascensionCleared + 1]`. Scoreboard tabs become per-Ascension.

**Tech Stack:** Vanilla JS (no modules, no bundler, no tests), HTML, CSS. localStorage for persistence. Manual browser verification per task.

**Reference spec:** [docs/superpowers/specs/2026-04-22-roguelike-meta-progression-design.md](../specs/2026-04-22-roguelike-meta-progression-design.md)

---

## File structure

| File | Kind | Responsibility |
|------|------|----------------|
| `src/progression/save.js` | CREATE | `NeonSave` namespace: schema, load/write, migrate legacy scoreboards, calculate Meta-XP, record run result |
| `src/config/config.js` | MODIFY | Remove `DIFFICULTY` / `DEFAULT_DIFFICULTY`; add `ASCENSION_TIERS`, `ASCENSION_MODIFIERS`, `getAscensionEffects(tier)` |
| `src/engine/game.js` | MODIFY | Constructor takes `ascensionTier`; compute and store `this.ascension = getAscensionEffects(tier)`; apply `hpMult`, `countMult`, `payoutMult`, `startMoneyMult`, `airWaveInterval`, `disableInvestCap`, `potionCostMult`, `potionHeal` at existing 645ce59 touchpoints plus two new ones (air interval, investment cap, potion cost/heal) |
| `src/engine/main.js` | MODIFY | On init: load save (migrate if needed), default tier = `save.ascensionCleared`. Replace `selectedDifficulty`/`setDifficulty`/`scoreKey`/score-tab handlers with Ascension equivalents. Wire `Game.gameOver()` to call `NeonSave.recordRun()` |
| `index.html` | MODIFY | Remove three `.difficulty-row` blocks, remove three `.score-tab` difficulty tabs. Add three Ascension selector blocks (start-screen, game-over, restart-confirm). Add Meta-XP breakdown block in game-over overlay. Add `<script src="src/progression/save.js">` before `main.js` |
| `style.css` | MODIFY | Remove `.difficulty-btn.easy/.normal/.hard` color overrides and `.score-tab.easy/.normal/.hard` overrides. Add `.ascension-selector`, `.ascension-btn`, `.ascension-modifiers-preview`, `.xp-breakdown` styles |

**Load order in `index.html`** (existing → new line inserted):
```
src/config/config.js
src/audio/audio.js
src/render/assets.js
src/engine/map.js
src/entities/entities.js
src/ai/autopilot.js
src/progression/save.js   ← NEW, inserted before game.js
src/engine/game.js
src/engine/main.js
```

## Note on verification

This codebase has no automated tests (`CLAUDE.md` explicitly: "no tests"). Each task therefore replaces "Write failing test / Run test / Implement" with **"Implement / Manual verification in browser"**. Verification steps are concrete: what URL to open, what to click, what to see in DOM/console. If a step involves localStorage state, it tells you exactly what to paste into the console to set up the scenario.

Open the game by double-clicking `index.html` or running any static file server in the project root; throughout this plan "reload" = hit `F5` in the browser.

---

## Task 1: Create `src/progression/save.js` — schema, load/write, legacy migration, XP math

**Files:**
- Create: `src/progression/save.js`
- Modify: `index.html` (add `<script>` tag)

- [ ] **Step 1: Create the `src/progression` directory and the save module**

Create file `src/progression/save.js` with exact content:

```javascript
// Persistent save for Neon Defense (Milestone 1 schema, version 1).
// Exposes a `NeonSave` namespace used by main.js and game.js.
// Schema is forward-compatible with Milestones 2-3: tree-buyable fields
// (unlockedNodes, towerMastery) are present but unused in M1.

const NeonSave = (function () {
    const KEY = 'neonDefense.save';
    const SCHEMA_VERSION = 1;

    // Tower types used by the current game. Kept in sync with TOWERS keys in config.js.
    const TOWER_TYPES = ['basic', 'sniper', 'rapid', 'laser', 'rocket', 'flak', 'electric', 'silo', 'income'];

    function createFreshSave() {
        const mastery = {};
        for (const t of TOWER_TYPES) {
            mastery[t] = { xp: 0, milestones: { m1: false, m2: false } };
        }
        const highScores = {};
        for (let i = 0; i <= 10; i++) highScores['a' + i] = [];

        return {
            version: SCHEMA_VERSION,
            metaXP: 0,
            totalXPEarned: 0,
            ascensionCleared: 0,          // highest tier where wave 30 was reached
            unlockedNodes: [],            // filled in M2
            towerMastery: mastery,        // filled in M3
            highScores: highScores,       // per-Ascension top-5 lists of { name, wave }
            settings: { skipRunSetup: false }
        };
    }

    // Pull any legacy data into the fresh save and grant welcome XP.
    // Legacy sources handled (in priority order):
    //   neonDefenseScores_easy | _normal | _hard  (645ce59 format)
    //   neonDefenseScores                          (pre-645ce59 format)
    function migrateLegacy(save) {
        let legacyFound = false;

        // 645ce59 per-difficulty scoreboards → a0/a2/a4 respectively.
        // Mapping rationale (from spec): Easy≈A0, Normal≈A2, Hard≈A4.
        const legacyMap = [
            { key: 'neonDefenseScores_easy',   tier: 'a0' },
            { key: 'neonDefenseScores_normal', tier: 'a2' },
            { key: 'neonDefenseScores_hard',   tier: 'a4' }
        ];
        for (const { key, tier } of legacyMap) {
            const raw = localStorage.getItem(key);
            if (raw !== null) {
                try {
                    const scores = JSON.parse(raw);
                    if (Array.isArray(scores)) {
                        save.highScores[tier] = scores;
                        legacyFound = true;
                    }
                } catch (_) { /* ignore bad JSON */ }
            }
        }

        // Pre-645ce59 flat scoreboard (only if no _easy key yet).
        if (!legacyFound && localStorage.getItem('neonDefenseScores') !== null) {
            try {
                const scores = JSON.parse(localStorage.getItem('neonDefenseScores'));
                if (Array.isArray(scores)) {
                    save.highScores.a0 = scores;
                    legacyFound = true;
                }
            } catch (_) { /* ignore */ }
        }

        if (legacyFound) {
            save.metaXP = 200;          // welcome grant ~ 2 Tier-1 nodes' worth
            save.totalXPEarned = 200;
        }

        return legacyFound;
    }

    function load() {
        const raw = localStorage.getItem(KEY);
        if (raw !== null) {
            try {
                const parsed = JSON.parse(raw);
                if (parsed && typeof parsed === 'object' && parsed.version === SCHEMA_VERSION) {
                    return parsed;
                }
            } catch (_) { /* fall through to fresh */ }
        }
        const fresh = createFreshSave();
        migrateLegacy(fresh);
        write(fresh);
        return fresh;
    }

    function write(save) {
        localStorage.setItem(KEY, JSON.stringify(save));
    }

    // Spec formula:
    //   waveXP          = min(wave,30) + max(0, wave-30) * 0.5
    //   tierMult        = 1 + tier * 0.5
    //   clearBonus      = (wave >= 30) ? 50 : 0
    //   firstClearBonus = (firstClear) ? 100 : 0
    //   runXP           = waveXP * tierMult + clearBonus + firstClearBonus
    function calculateRunXP(wave, tier, firstClear) {
        const baseWave = Math.min(wave, 30) + Math.max(0, wave - 30) * 0.5;
        const tierMult = 1 + tier * 0.5;
        const clearBonus = wave >= 30 ? 50 : 0;
        const firstBonus = firstClear ? 100 : 0;
        const total = Math.floor(baseWave * tierMult + clearBonus + firstBonus);
        return {
            waveXP:     Math.floor(baseWave * tierMult),
            clearBonus: clearBonus,
            firstBonus: firstBonus,
            total:      total
        };
    }

    // Updates save in place for a completed run and persists it.
    // Returns the breakdown object (incl. `firstClear` boolean for UI).
    function recordRun(save, result) {
        const { wave, tier, name } = result;
        const firstClear = wave >= 30 && tier > save.ascensionCleared;

        const xp = calculateRunXP(wave, tier, firstClear);
        save.metaXP        += xp.total;
        save.totalXPEarned += xp.total;

        if (firstClear) {
            save.ascensionCleared = tier;
        }

        // High-score entry (top 5 by wave, descending). Only recorded if name provided.
        if (name && typeof name === 'string' && name.length > 0) {
            const key = 'a' + tier;
            const list = save.highScores[key] || [];
            list.push({ name: name.toUpperCase().slice(0, 3), wave: wave });
            list.sort((a, b) => b.wave - a.wave);
            save.highScores[key] = list.slice(0, 5);
        }

        write(save);
        return { ...xp, firstClear };
    }

    return {
        KEY,
        SCHEMA_VERSION,
        TOWER_TYPES,
        createFreshSave,
        migrateLegacy,
        load,
        write,
        calculateRunXP,
        recordRun
    };
})();
```

- [ ] **Step 2: Add the script tag to `index.html`**

Modify `index.html`. Find the block starting at line ~243:

```html
    <script src="src/config/config.js"></script>
    <script src="src/audio/audio.js"></script>
    <script src="src/render/assets.js"></script>
    <script src="src/engine/map.js"></script>
    <script src="src/entities/entities.js"></script>
    <script src="src/ai/autopilot.js"></script>
    <script src="src/engine/game.js"></script>
    <script src="src/engine/main.js"></script>
```

Insert `save.js` between `autopilot.js` and `game.js` so `Game` can reference it from its constructor in later tasks:

```html
    <script src="src/config/config.js"></script>
    <script src="src/audio/audio.js"></script>
    <script src="src/render/assets.js"></script>
    <script src="src/engine/map.js"></script>
    <script src="src/entities/entities.js"></script>
    <script src="src/ai/autopilot.js"></script>
    <script src="src/progression/save.js"></script>
    <script src="src/engine/game.js"></script>
    <script src="src/engine/main.js"></script>
```

- [ ] **Step 3: Manual verification — fresh-save shape**

1. Open a private/incognito window and navigate to `index.html`.
2. Open DevTools console. Paste:
   ```javascript
   localStorage.clear();
   location.reload();
   ```
3. After reload, paste:
   ```javascript
   JSON.parse(localStorage.getItem('neonDefense.save'))
   ```
   Expected output (order of keys may differ):
   ```
   {
     version: 1,
     metaXP: 0,
     totalXPEarned: 0,
     ascensionCleared: 0,
     unlockedNodes: [],
     towerMastery: { basic: {...}, sniper: {...}, ... income: {...} },  // 9 entries
     highScores: { a0: [], a1: [], ..., a10: [] },                       // 11 entries
     settings: { skipRunSetup: false }
   }
   ```
4. Confirm no errors in the console.

- [ ] **Step 4: Manual verification — legacy migration**

1. In DevTools console, paste:
   ```javascript
   localStorage.clear();
   localStorage.setItem('neonDefenseScores_easy',   JSON.stringify([{name:'AAA', wave: 15}]));
   localStorage.setItem('neonDefenseScores_normal', JSON.stringify([{name:'BBB', wave: 8}]));
   localStorage.setItem('neonDefenseScores_hard',   JSON.stringify([{name:'CCC', wave: 3}]));
   location.reload();
   ```
2. After reload, paste:
   ```javascript
   const s = JSON.parse(localStorage.getItem('neonDefense.save'));
   console.log('a0:', s.highScores.a0, 'a2:', s.highScores.a2, 'a4:', s.highScores.a4, 'metaXP:', s.metaXP);
   ```
   Expected:
   - `a0: [{name:'AAA', wave:15}]`
   - `a2: [{name:'BBB', wave:8}]`
   - `a4: [{name:'CCC', wave:3}]`
   - `metaXP: 200` (welcome grant)

- [ ] **Step 5: Manual verification — XP math**

In DevTools console:
```javascript
console.log(NeonSave.calculateRunXP(10, 0, false));  // { waveXP: 10, clearBonus: 0, firstBonus: 0, total: 10 }
console.log(NeonSave.calculateRunXP(30, 0, true));   // { waveXP: 30, clearBonus: 50, firstBonus: 100, total: 180 }
console.log(NeonSave.calculateRunXP(30, 5, true));   // { waveXP: 105, clearBonus: 50, firstBonus: 100, total: 255 }
console.log(NeonSave.calculateRunXP(100, 10, false));// { waveXP: 390, clearBonus: 50, firstBonus: 0, total: 440 }
```

Each `total` must match the 4th value in the corresponding row of the spec's XP examples table.

- [ ] **Step 6: Commit**

```bash
git add src/progression/save.js index.html
git commit -m "$(cat <<'EOF'
Add NeonSave persistence module (M1 save schema + legacy migration)

Introduces neonDefense.save v1 schema with metaXP, ascensionCleared,
highScores, and M2/M3-ready unlockedNodes/towerMastery placeholders.
Migrates legacy neonDefenseScores_easy|normal|hard into a0/a2/a4 with
a 200-XP welcome grant on first run-after-upgrade.
EOF
)"
```

---

## Task 2: Add `ASCENSION_TIERS` config and `getAscensionEffects(tier)` to `config.js`

**Files:**
- Modify: `src/config/config.js` (lines 5-18, the DIFFICULTY block)

- [ ] **Step 1: Replace the `DIFFICULTY` block with `ASCENSION_TIERS` + `getAscensionEffects`**

Find these lines at the top of `src/config/config.js`:

```javascript
// -------------------------------------------------------------------------
// Difficulty modes. Multipliers applied on top of the existing scaling.
// Easy is bit-identical to the historical curve (all 1.0).
// hpMult     -> enemy HP per spawn
// countMult  -> enemies per wave (ground + air)
// payoutMult -> wave-completion bonus + per-enemy rewards (relays unaffected)
// -------------------------------------------------------------------------
const DIFFICULTY = {
    easy:   { hpMult: 1.0,  countMult: 1.0,  payoutMult: 1.0,  label: 'EASY',   letter: 'E', color: '#4ade80' },
    normal: { hpMult: 1.25, countMult: 1.15, payoutMult: 0.9,  label: 'NORMAL', letter: 'N', color: '#fbbf24' },
    hard:   { hpMult: 1.6,  countMult: 1.35, payoutMult: 0.75, label: 'HARD',   letter: 'H', color: '#ef4444' }
};
const DEFAULT_DIFFICULTY = 'normal';
```

Replace the entire block (including the comment header) with:

```javascript
// -------------------------------------------------------------------------
// Ascension tiers (Milestone 1: A0-A7 stat-only; A8-A10 reserved for M3
// new-enemy tiers). Each tier ADDS its modifier to the previous tier's
// stack — A5 has A1..A5 all active. Resolve a tier's full effect map via
// `getAscensionEffects(tier)`.
//
// Effect keys:
//   hpMult            -> multiplicative on per-spawn enemy HP
//   startMoneyMult    -> multiplicative on Game's initial money
//   airWaveInterval   -> "air wave every N waves" (default 5)
//   countMult         -> multiplicative on per-wave enemy count
//   payoutMult        -> multiplicative on wave-completion bonus + per-kill rewards
//   disableInvestCap  -> if true, investment-factor soft caps in startWave() are skipped
//   potionCostMult    -> multiplicative on POTION_CONFIG.baseCost + costPerUse
//   potionHeal        -> overrides POTION_CONFIG.healAmount
// -------------------------------------------------------------------------
const ASCENSION_MAX_TIER = 10;
const ASCENSION_MAX_TIER_M1 = 7; // tiers above this are reserved for Milestone 3

const ASCENSION_TIERS = [
    // tier 0 is always the baseline (no modifiers).
    { tier: 0, label: 'A0',  name: 'Baseline',      modifier: null,                                          kind: 'baseline' },
    { tier: 1, label: 'A1',  name: '+15% enemy HP', modifier: { hpMult: 1.15 },                              kind: 'stat' },
    { tier: 2, label: 'A2',  name: '-25% start $',  modifier: { startMoneyMult: 0.75 },                      kind: 'stat' },
    { tier: 3, label: 'A3',  name: 'Air every 4',   modifier: { airWaveInterval: 4 },                        kind: 'stat' },
    { tier: 4, label: 'A4',  name: '+15% count',    modifier: { countMult: 1.15 },                           kind: 'stat' },
    { tier: 5, label: 'A5',  name: '-40% payout',   modifier: { payoutMult: 0.60 },                          kind: 'stat' },
    { tier: 6, label: 'A6',  name: 'No invest cap', modifier: { disableInvestCap: true },                    kind: 'stat' },
    { tier: 7, label: 'A7',  name: 'Harsh potions', modifier: { potionCostMult: 2, potionHeal: 1 },          kind: 'stat' },
    // A8-A10 are declared for UI completeness but NOT playable until M3 adds
    // the Shielded / Splitter / Boss enemy types. Run Setup must lock these.
    { tier: 8, label: 'A8',  name: 'Shielded (M3)', modifier: null,                                          kind: 'enemy-m3' },
    { tier: 9, label: 'A9',  name: 'Splitter (M3)', modifier: null,                                          kind: 'enemy-m3' },
    { tier: 10, label: 'A10', name: 'Boss (M3)',    modifier: null,                                          kind: 'enemy-m3' }
];

// Returns the cumulative effect map for a tier (0 <= tier <= 7 in M1).
// Out-of-range tiers clamp to baseline. All multipliers start at 1.0 and
// are composed by multiplication across all modifiers up to and including `tier`.
function getAscensionEffects(tier) {
    const effects = {
        hpMult: 1,
        startMoneyMult: 1,
        airWaveInterval: 5,
        countMult: 1,
        payoutMult: 1,
        disableInvestCap: false,
        potionCostMult: 1,
        potionHeal: null  // null = use POTION_CONFIG.healAmount
    };

    const safeTier = Math.max(0, Math.min(tier || 0, ASCENSION_MAX_TIER_M1));

    for (let i = 1; i <= safeTier; i++) {
        const mod = ASCENSION_TIERS[i] && ASCENSION_TIERS[i].modifier;
        if (!mod) continue;
        for (const key of Object.keys(mod)) {
            if (key === 'disableInvestCap') {
                effects[key] = mod[key];
            } else if (key === 'airWaveInterval' || key === 'potionHeal') {
                effects[key] = mod[key];  // overwrite (not multiplicative)
            } else {
                effects[key] *= mod[key]; // multiply multipliers
            }
        }
    }
    return effects;
}
```

- [ ] **Step 2: Manual verification — effect resolution**

Reload `index.html`, open DevTools console, paste:

```javascript
console.log('A0:', getAscensionEffects(0));
console.log('A1:', getAscensionEffects(1));
console.log('A5:', getAscensionEffects(5));
console.log('A7:', getAscensionEffects(7));
console.log('A8 clamps:', getAscensionEffects(8));  // should match A7
```

Expected values:
- `A0`: `hpMult: 1, startMoneyMult: 1, airWaveInterval: 5, countMult: 1, payoutMult: 1, disableInvestCap: false, potionCostMult: 1, potionHeal: null`
- `A1`: same as A0 but `hpMult: 1.15`
- `A5`: `hpMult: 1.15, startMoneyMult: 0.75, airWaveInterval: 4, countMult: 1.15, payoutMult: 0.6, ...`
- `A7`: A5 values plus `disableInvestCap: true, potionCostMult: 2, potionHeal: 1`
- `A8`: identical to A7 (clamped to M1 max)

Note: the page will throw errors related to `DIFFICULTY` being undefined — that's expected; Task 3 fixes it.

- [ ] **Step 3: Commit**

```bash
git add src/config/config.js
git commit -m "$(cat <<'EOF'
Replace DIFFICULTY with ASCENSION_TIERS + getAscensionEffects

Defines the 10-tier Ascension ladder (A0-A7 active in M1, A8-A10 reserved
for M3 new-enemy tiers). getAscensionEffects(tier) resolves the cumulative
modifier stack to a flat effect map consumed by Game.
EOF
)"
```

---

## Task 3: Update `Game` to use `ascensionTier` and apply all A1–A7 modifiers

**Files:**
- Modify: `src/engine/game.js`

This task replaces every use of `this.difficulty` / `this.diffMult` with the ascension effect map and adds three new modifier application sites (air wave interval, investment cap, potion).

- [ ] **Step 1: Update the constructor (lines 2-42 area)**

Find:

```javascript
class Game {
    constructor(canvas, seed, difficulty) {
        this.canvas = canvas;
        this.ctx = canvas.getContext('2d');

        this.difficulty = (difficulty && DIFFICULTY[difficulty]) ? difficulty : DEFAULT_DIFFICULTY;
        this.diffMult = DIFFICULTY[this.difficulty];

        this.map = new GameMap(seed);
```

Replace with:

```javascript
class Game {
    constructor(canvas, seed, ascensionTier) {
        this.canvas = canvas;
        this.ctx = canvas.getContext('2d');

        this.ascensionTier = Math.max(0, Math.min((ascensionTier | 0), ASCENSION_MAX_TIER_M1));
        this.ascension = getAscensionEffects(this.ascensionTier);

        this.map = new GameMap(seed);
```

Then find, still in the constructor:

```javascript
        this.money = 125;  // Better starting money for early game
```

Replace with:

```javascript
        this.money = Math.floor(125 * this.ascension.startMoneyMult);
```

- [ ] **Step 2: Update `startWave()` — HP, count, and air-wave interval**

Within `startWave()`, find the block applying A-tier HP (added by 645ce59):

```javascript
        // Difficulty mode HP multiplier (Easy=1.0, Normal=1.25, Hard=1.6)
        finalHpMult *= this.diffMult.hpMult;
```

Replace with:

```javascript
        // Ascension HP multiplier (cumulative from A1 +15% upward)
        finalHpMult *= this.ascension.hpMult;
```

Still in `startWave()`, find the air-wave gate (was `this.wave % 5 === 0`):

```javascript
        if (this.wave > 0 && this.wave % 5 === 0) {
```

Replace with:

```javascript
        if (this.wave > 0 && this.wave % this.ascension.airWaveInterval === 0) {
```

The air-wave interval also drives four other sites elsewhere in `Game`. Swap each one:

In `update()` (around line 296), find:
```javascript
                    this.waveCooldown = ((this.wave + 1) % 5 === 0) ? WAVE_CONFIG.airWaveCooldown : WAVE_CONFIG.normalCooldown;
```
Replace with:
```javascript
                    this.waveCooldown = ((this.wave + 1) % this.ascension.airWaveInterval === 0) ? WAVE_CONFIG.airWaveCooldown : WAVE_CONFIG.normalCooldown;
```

In `update()` (around line 345), find:
```javascript
                    if ((this.wave + 1) % 5 === 0) {
                        SoundFX.siren();
                    }
```
Replace with:
```javascript
                    if ((this.wave + 1) % this.ascension.airWaveInterval === 0) {
                        SoundFX.siren();
                    }
```

In `update()` (around line 353), find:
```javascript
                if ((this.wave + 1) % 5 === 0) {
                    this.airWarning = true;
                } else {
                    this.airWarning = false;
                }
```
Replace with:
```javascript
                if ((this.wave + 1) % this.ascension.airWaveInterval === 0) {
                    this.airWarning = true;
                } else {
                    this.airWarning = false;
                }
```

In `updateUI()` (around line 658), find:
```javascript
        let nextAir = 5 - (this.wave % 5);
        let airEl = document.getElementById('air-countdown');
        if (nextAir === 5 && this.wave > 0) {
```
Replace with:
```javascript
        const airInterval = this.ascension.airWaveInterval;
        let nextAir = airInterval - (this.wave % airInterval);
        let airEl = document.getElementById('air-countdown');
        if (nextAir === airInterval && this.wave > 0) {
```

In the air-wave branch:

```javascript
            this.currentWaveDef = {
                count: Math.floor(airCount * this.diffMult.countMult),
                type: 'air',
                spawnRate: Math.max(20, 50 - Math.floor(this.wave / 8)),
                hpMult: finalHpMult * 0.98 // Slightly weaker than ground
            };
```

Replace with:

```javascript
            this.currentWaveDef = {
                count: Math.floor(airCount * this.ascension.countMult),
                type: 'air',
                spawnRate: Math.max(20, 50 - Math.floor(this.wave / 8)),
                hpMult: finalHpMult * 0.98 // Slightly weaker than ground
            };
```

In the ground-wave branch (near the end of `startWave()`):

```javascript
        this.currentWaveDef = {
            count: Math.floor(def.count * countMult * this.diffMult.countMult),
            type: def.type,
            spawnRate: Math.max(12, def.spawnRate - loops * 2),
            hpMult: def.hpMult * finalHpMult // HP scales with wave + investment
        };
```

Replace with:

```javascript
        this.currentWaveDef = {
            count: Math.floor(def.count * countMult * this.ascension.countMult),
            type: def.type,
            spawnRate: Math.max(12, def.spawnRate - loops * 2),
            hpMult: def.hpMult * finalHpMult // HP scales with wave + investment
        };
```

- [ ] **Step 3: Apply A6 `disableInvestCap`**

Still in `startWave()`, find the investment-factor block (lines 60-84):

```javascript
        let investmentFactor;
        if (this.wave <= 20) {
            // Waves 1-20: Very gentle investment scaling (every 5000¢ = +1.0x)
            investmentFactor = 1 + (totalTowerValue / 5000);
        } else if (this.wave <= 35) {
            ...
        } else {
            // Waves 101+: Investment very heavily capped for extreme endgame
            let baseInvestment = 1 + (totalTowerValue / 5000);
            let excess = Math.max(0, baseInvestment - 10); // Cap starts at 10x
            investmentFactor = 10 + Math.log(1 + excess) * 0.5; // Strong logarithmic cap
        }
```

Wrap it in a ternary so A6 short-circuits the soft-cap logic:

```javascript
        let investmentFactor;
        if (this.ascension.disableInvestCap) {
            // A6: soft caps removed — enemy HP scales 1:1 with investment forever.
            investmentFactor = 1 + (totalTowerValue / 5000);
        } else if (this.wave <= 20) {
            // Waves 1-20: Very gentle investment scaling (every 5000¢ = +1.0x)
            investmentFactor = 1 + (totalTowerValue / 5000);
        } else if (this.wave <= 35) {
            // Waves 21-35: Investment with gentle cap
            let baseInvestment = 1 + (totalTowerValue / 5000);
            let excess = Math.max(0, baseInvestment - 4); // Cap starts at 4x
            investmentFactor = 4 + Math.sqrt(excess) * 1.0; // Moderate soft cap
        } else if (this.wave <= 55) {
            // Waves 36-55: Investment capped but still relevant
            let baseInvestment = 1 + (totalTowerValue / 5000);
            let excess = Math.max(0, baseInvestment - 6); // Cap starts at 6x
            investmentFactor = 6 + Math.sqrt(excess) * 0.8; // Stronger soft cap
        } else if (this.wave <= 100) {
            // Waves 56-100: Investment heavily capped
            let baseInvestment = 1 + (totalTowerValue / 5000);
            let excess = Math.max(0, baseInvestment - 8); // Cap starts at 8x
            investmentFactor = 8 + Math.log(1 + excess) * 0.7; // Logarithmic cap
        } else {
            // Waves 101+: Investment very heavily capped for extreme endgame
            let baseInvestment = 1 + (totalTowerValue / 5000);
            let excess = Math.max(0, baseInvestment - 10); // Cap starts at 10x
            investmentFactor = 10 + Math.log(1 + excess) * 0.5; // Strong logarithmic cap
        }
```

(Only the first branch is new; the remaining cases are kept verbatim for clarity.)

- [ ] **Step 4: Apply A5 payout multiplier at the two existing touchpoints**

In `update()` (around line 333), find:

```javascript
                    // Difficulty payout multiplier (Easy=1.0, Normal=0.9, Hard=0.75)
                    waveBonus = Math.floor(waveBonus * this.diffMult.payoutMult);
```

Replace with:

```javascript
                    // Ascension payout multiplier (A5 = 0.60)
                    waveBonus = Math.floor(waveBonus * this.ascension.payoutMult);
```

In `update()` (around line 385), find:

```javascript
                reward = Math.max(1, Math.floor(reward * this.diffMult.payoutMult));
```

Replace with:

```javascript
                reward = Math.max(1, Math.floor(reward * this.ascension.payoutMult));
```

- [ ] **Step 5: Apply A7 potion cost and heal overrides**

Find `getPotionCost()` (around line 477):

```javascript
    getPotionCost() {
        return POTION_CONFIG.baseCost + this.potionCount * POTION_CONFIG.costPerUse;
    }
```

Replace with:

```javascript
    getPotionCost() {
        const base = POTION_CONFIG.baseCost + this.potionCount * POTION_CONFIG.costPerUse;
        return Math.floor(base * this.ascension.potionCostMult);
    }
```

Find `buyPotion()` (around line 481):

```javascript
    buyPotion() {
        let cost = this.getPotionCost();
        if (this.money < cost) { SoundFX.error(); return false; }
        if (this.health >= this.maxHealth) { SoundFX.error(); return false; }
        this.money -= cost;
        this.health = Math.min(this.maxHealth, this.health + POTION_CONFIG.healAmount);
        this.potionCount++;
        this.uiDirty = true;
        SoundFX.upgrade();
        return true;
    }
```

Replace with:

```javascript
    buyPotion() {
        let cost = this.getPotionCost();
        if (this.money < cost) { SoundFX.error(); return false; }
        if (this.health >= this.maxHealth) { SoundFX.error(); return false; }
        this.money -= cost;
        const heal = (this.ascension.potionHeal !== null)
            ? this.ascension.potionHeal
            : POTION_CONFIG.healAmount;
        this.health = Math.min(this.maxHealth, this.health + heal);
        this.potionCount++;
        this.uiDirty = true;
        SoundFX.upgrade();
        return true;
    }
```

- [ ] **Step 6: Manual verification — per-tier runtime behavior**

**Note:** after this task, the page's top-level JS will still error on load (main.js references the now-deleted `DIFFICULTY`/`selectedDifficulty`) — that is fixed in Task 5. For this task's verification, the errors block the *normal* page init, but you can still construct a Game instance manually via DevTools to check behavior.

1. Reload. In DevTools console, paste:
   ```javascript
   const c = document.getElementById('game-canvas');
   window._g = new Game(c, 12345, 2);    // A2: -25% starting money
   console.log('A2 money:', window._g.money, '(expected 93)');

   window._g = new Game(c, 12345, 3);    // A3: air every 4 waves
   console.log('A3 airInterval:', window._g.ascension.airWaveInterval, '(expected 4)');

   window._g = new Game(c, 12345, 7);    // A7: potion changes
   window._g.potionCount = 0;
   console.log('A7 potionCost:', window._g.getPotionCost(), '(expected', Math.floor(150 * 2), ')');
   console.log('A7 potionHeal override:', window._g.ascension.potionHeal, '(expected 1)');
   ```
2. Confirm every `(expected …)` matches.

- [ ] **Step 7: Commit**

```bash
git add src/engine/game.js
git commit -m "$(cat <<'EOF'
Plumb ASCENSION effects through Game (replaces 645ce59 DIFFICULTY plumbing)

Game(canvas, seed, ascensionTier) replaces the old difficulty string.
Applies all A1-A7 modifiers: HP mult, start-money mult, count mult,
payout mult (wave bonus + per-kill reward), air-wave interval, investment-
factor cap bypass (A6), potion cost and heal overrides (A7).
EOF
)"
```

---

## Task 4: Replace the three difficulty selectors with Ascension selectors

**Files:**
- Modify: `index.html`
- Modify: `style.css`

All three existing `.difficulty-row` blocks (start-screen, game-over, restart-confirm) become Ascension selectors. Reusing the existing layout minimises CSS churn.

- [ ] **Step 1: Replace `.difficulty-row` in `#start-screen`**

Find in `index.html` (around line 145):

```html
                    <div class="difficulty-row">
                        <span class="difficulty-label">DIFFICULTY</span>
                        <div class="difficulty-buttons">
                            <button class="difficulty-btn easy" data-difficulty="easy">EASY</button>
                            <button class="difficulty-btn normal" data-difficulty="normal">NORMAL</button>
                            <button class="difficulty-btn hard" data-difficulty="hard">HARD</button>
                        </div>
                    </div>
```

Replace with:

```html
                    <div class="ascension-row">
                        <span class="ascension-label">ASCENSION</span>
                        <div class="ascension-buttons" data-context="start">
                            <!-- Buttons populated by main.js renderAscensionSelector('start') -->
                        </div>
                        <div class="ascension-modifiers-preview" data-context="start">—</div>
                    </div>
```

- [ ] **Step 2: Replace `.difficulty-row` in `#game-over`**

Find (around line 108):

```html
                    <div class="difficulty-row" style="margin-top: 20px;">
                        <span class="difficulty-label">DIFFICULTY</span>
                        <div class="difficulty-buttons">
                            <button class="difficulty-btn easy" data-difficulty="easy">EASY</button>
                            <button class="difficulty-btn normal" data-difficulty="normal">NORMAL</button>
                            <button class="difficulty-btn hard" data-difficulty="hard">HARD</button>
                        </div>
                    </div>
```

Replace with:

```html
                    <div class="ascension-row" style="margin-top: 20px;">
                        <span class="ascension-label">ASCENSION</span>
                        <div class="ascension-buttons" data-context="gameover"></div>
                        <div class="ascension-modifiers-preview" data-context="gameover">—</div>
                    </div>
```

- [ ] **Step 3: Replace `.difficulty-row` in `#restart-confirm`**

Find (around line 125):

```html
                    <div class="difficulty-row">
                        <span class="difficulty-label">DIFFICULTY</span>
                        <div class="difficulty-buttons">
                            <button class="difficulty-btn easy" data-difficulty="easy">EASY</button>
                            <button class="difficulty-btn normal" data-difficulty="normal">NORMAL</button>
                            <button class="difficulty-btn hard" data-difficulty="hard">HARD</button>
                        </div>
                    </div>
```

Replace with:

```html
                    <div class="ascension-row">
                        <span class="ascension-label">ASCENSION</span>
                        <div class="ascension-buttons" data-context="restart"></div>
                        <div class="ascension-modifiers-preview" data-context="restart">—</div>
                    </div>
```

- [ ] **Step 4: Replace scoreboard difficulty tabs**

Find (around line 100):

```html
                        <div class="score-tabs">
                            <button class="score-tab easy" data-difficulty="easy">EASY</button>
                            <button class="score-tab normal" data-difficulty="normal">NORMAL</button>
                            <button class="score-tab hard" data-difficulty="hard">HARD</button>
                        </div>
```

Replace with:

```html
                        <div class="score-tabs" id="score-tabs">
                            <!-- Tabs populated by main.js renderScoreTabs() -->
                        </div>
```

- [ ] **Step 5: Replace CSS for `.difficulty-*` and `.score-tab.*` with Ascension equivalents**

Open `style.css`. Find the block starting at line 517 (the comment `/* Difficulty selector on start screen */`) and ending at line 582 (the last `.score-tab.hard...` line). Replace the **entire block** (lines 517–582) with:

```css
/* Ascension selector (replaces 645ce59 difficulty selector) */
.ascension-row {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 8px;
    margin-bottom: 16px;
}

.ascension-label {
    font-size: 0.75rem;
    color: var(--text-muted);
    letter-spacing: 3px;
    font-weight: 600;
}

.ascension-buttons {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    justify-content: center;
    max-width: 360px;
}

.ascension-btn {
    padding: 6px 10px;
    font-size: 0.8rem;
    letter-spacing: 1px;
    border: 2px solid var(--text-muted);
    color: var(--text-muted);
    background: transparent;
    border-radius: 4px;
    min-width: 40px;
    box-shadow: none;
    opacity: 0.7;
    cursor: pointer;
    font-family: inherit;
    font-weight: 600;
}

.ascension-btn:hover:not(.locked) {
    opacity: 1;
    border-color: var(--accent);
    color: var(--accent);
}

.ascension-btn.selected {
    background: var(--accent);
    color: #0f172a;
    border-color: var(--accent);
    opacity: 1;
    box-shadow: 0 0 14px rgba(56, 189, 248, 0.55);
}

.ascension-btn.locked {
    opacity: 0.25;
    cursor: not-allowed;
    border-style: dashed;
}

.ascension-modifiers-preview {
    font-size: 0.7rem;
    color: var(--text-muted);
    letter-spacing: 1px;
    text-align: center;
    max-width: 320px;
    min-height: 1.2em;
    line-height: 1.4;
}

/* Scoreboard tabs — one per Ascension tier */
.score-tabs {
    display: flex;
    flex-wrap: wrap;
    gap: 3px;
    margin-bottom: 10px;
    justify-content: center;
}

.score-tab {
    padding: 3px 7px;
    font-size: 0.65rem;
    letter-spacing: 1px;
    border: 1px solid var(--text-muted);
    color: var(--text-muted);
    background: transparent;
    border-radius: 3px;
    min-width: 28px;
    box-shadow: none;
    opacity: 0.55;
    cursor: pointer;
    font-family: inherit;
    font-weight: 600;
}

.score-tab:hover {
    opacity: 0.9;
}

.score-tab.selected {
    background: rgba(56, 189, 248, 0.18);
    color: var(--accent);
    border-color: var(--accent);
    opacity: 1;
    box-shadow: 0 0 10px rgba(56, 189, 248, 0.35) inset;
}
```

- [ ] **Step 6: Manual verification — markup only**

Reload the page. The start screen should render with an empty `ASCENSION` label, empty button area, and `—` preview line. The page will throw JS errors (main.js still references `DIFFICULTY`) — expected; fixed in Task 5.

- [ ] **Step 7: Commit**

```bash
git add index.html style.css
git commit -m "$(cat <<'EOF'
Swap difficulty selector markup+CSS for Ascension selector

Three .difficulty-row blocks (start-screen, game-over, restart-confirm)
replaced with .ascension-row placeholders. Scoreboard tabs container
emptied for dynamic population in a later task. 645ce59 .difficulty-btn/
.score-tab CSS removed; .ascension-btn + .score-tab generic styles added.
EOF
)"
```

---

## Task 5: Wire `main.js` to load save, render Ascension selector, and use tier instead of difficulty

**Files:**
- Modify: `src/engine/main.js`

This task is the biggest diff — it rewrites the initialization, selector rendering, restart flow, and scoreboard rendering. Break into focused sub-steps.

- [ ] **Step 1: Replace the file-scope difficulty globals with save + tier**

At the top of `src/engine/main.js`, find lines 1-17:

```javascript
let game;
let selectedTowerType = null;
let mousePos = { x: 0, y: 0 };
let gameSpeed = 1;
let selectedDifficulty = (function() {
    let stored = localStorage.getItem('neonDefenseDifficulty');
    return (stored && DIFFICULTY[stored]) ? stored : DEFAULT_DIFFICULTY;
})();

// One-time migration: prior runs were on what is now the easy curve.
(function migrateScoreboard() {
    if (localStorage.getItem('neonDefenseScores') !== null
        && localStorage.getItem('neonDefenseScores_easy') === null) {
        localStorage.setItem('neonDefenseScores_easy', localStorage.getItem('neonDefenseScores'));
        localStorage.removeItem('neonDefenseScores');
    }
})();

function scoreKey(diff) { return 'neonDefenseScores_' + diff; }
```

Replace with:

```javascript
let game;
let selectedTowerType = null;
let mousePos = { x: 0, y: 0 };
let gameSpeed = 1;

// Load or create persistent save. NeonSave.load handles legacy migration
// (neonDefenseScores_easy|normal|hard → a0/a2/a4, 200 XP welcome grant).
const save = NeonSave.load();

// Default tier = highest cleared. First-time players start on A0.
let selectedTier = save.ascensionCleared;

// Visible Ascension tier in the scoreboard view (independent from run tier).
let visibleScoreTier = selectedTier;
```

- [ ] **Step 2: Replace `setDifficulty`, `updateModeDisplay`, and their helpers**

Still near the top, find lines 21-41:

```javascript
function setDifficulty(diff) {
    if (!DIFFICULTY[diff]) return;
    selectedDifficulty = diff;
    localStorage.setItem('neonDefenseDifficulty', diff);
    document.querySelectorAll('.difficulty-btn').forEach(b => {
        b.classList.toggle('selected', b.dataset.difficulty === diff);
    });
    // Repaint the top-bar MODE preview immediately, even before the game restarts.
    updateModeDisplay(diff);
}

function updateModeDisplay(diff) {
    let el = document.getElementById('mode-display');
    if (!el) return;
    let key = diff || (game && game.difficulty) || selectedDifficulty;
    let d = DIFFICULTY[key];
    if (!d) return;
    el.textContent = d.letter;
    el.style.color = d.color;
    el.style.textShadow = '0 0 10px ' + d.color + '66';
}
```

Replace with:

```javascript
function setTier(tier) {
    const unlockedMax = Math.min(save.ascensionCleared + 1, ASCENSION_MAX_TIER_M1);
    if (tier < 0 || tier > unlockedMax) return;
    selectedTier = tier;

    // Re-render all three selector contexts with new selection.
    renderAscensionSelector('start');
    renderAscensionSelector('gameover');
    renderAscensionSelector('restart');

    updateModeDisplay(tier);
}

function updateModeDisplay(tier) {
    const el = document.getElementById('mode-display');
    if (!el) return;
    const t = (typeof tier === 'number') ? tier : (game ? game.ascensionTier : selectedTier);
    el.textContent = 'A' + t;
    el.style.color = 'var(--accent)';
    el.style.textShadow = '0 0 10px rgba(56, 189, 248, 0.45)';
}

// Renders one of the three .ascension-buttons containers. Shows A0-A7,
// greys/locks tiers above save.ascensionCleared + 1. Also populates the
// corresponding .ascension-modifiers-preview line with cumulative modifiers.
function renderAscensionSelector(context) {
    const container = document.querySelector(`.ascension-buttons[data-context="${context}"]`);
    if (!container) return;
    container.innerHTML = '';

    const unlockedMax = Math.min(save.ascensionCleared + 1, ASCENSION_MAX_TIER_M1);

    for (let t = 0; t <= ASCENSION_MAX_TIER_M1; t++) {
        const spec = ASCENSION_TIERS[t];
        const btn = document.createElement('button');
        btn.className = 'ascension-btn';
        btn.textContent = spec.label; // "A0", "A1", ...
        btn.title = spec.name;
        if (t === selectedTier) btn.classList.add('selected');
        if (t > unlockedMax) {
            btn.classList.add('locked');
            btn.disabled = true;
            btn.title = spec.name + ' (locked — clear A' + (t - 1) + ' to unlock)';
        } else {
            btn.addEventListener('click', () => setTier(t));
        }
        container.appendChild(btn);
    }

    const preview = document.querySelector(`.ascension-modifiers-preview[data-context="${context}"]`);
    if (preview) {
        if (selectedTier === 0) {
            preview.textContent = 'Baseline — no modifiers';
        } else {
            const names = [];
            for (let i = 1; i <= selectedTier; i++) names.push(ASCENSION_TIERS[i].name);
            preview.textContent = names.join(' · ');
        }
    }
}
```

- [ ] **Step 3: Update `init()` — call `Game` with tier, render selectors, wire buttons**

Find inside `init()`, around lines 102-113:

```javascript
    game = new Game(canvas, urlSeed, selectedDifficulty);

    game.draw();
    game.updateUI();
    updateSeedDisplay();
    updateModeDisplay();

    // Restore selected difficulty button state
    document.querySelectorAll('.difficulty-btn').forEach(b => {
        b.classList.toggle('selected', b.dataset.difficulty === selectedDifficulty);
        b.addEventListener('click', () => setDifficulty(b.dataset.difficulty));
    });
```

Replace with:

```javascript
    game = new Game(canvas, urlSeed, selectedTier);

    game.draw();
    game.updateUI();
    updateSeedDisplay();
    updateModeDisplay();

    // Populate all three Ascension selectors.
    renderAscensionSelector('start');
    renderAscensionSelector('gameover');
    renderAscensionSelector('restart');
```

- [ ] **Step 4: Update the start button handler**

Find inside `init()`, around lines 115-127:

```javascript
    document.getElementById('start-btn').addEventListener('click', () => {
        const seedVal = document.getElementById('start-seed-input').value.trim();
        const parsedSeed = seedVal !== '' ? parseInt(seedVal) : null;
        if (parsedSeed !== null && !isNaN(parsedSeed)) {
            restartGame(parsedSeed);
        } else if (game.difficulty !== selectedDifficulty) {
            // Difficulty changed since the preview Game was created — rebuild on the same map.
            restartGame(game.seed);
        } else {
            document.getElementById('start-screen').classList.add('hidden');
            game.start();
        }
    });
```

Replace with:

```javascript
    document.getElementById('start-btn').addEventListener('click', () => {
        const seedVal = document.getElementById('start-seed-input').value.trim();
        const parsedSeed = seedVal !== '' ? parseInt(seedVal) : null;
        if (parsedSeed !== null && !isNaN(parsedSeed)) {
            restartGame(parsedSeed);
        } else if (game.ascensionTier !== selectedTier) {
            // Tier changed since the preview Game was created — rebuild on the same map.
            restartGame(game.seed);
        } else {
            document.getElementById('start-screen').classList.add('hidden');
            game.start();
        }
    });
```

- [ ] **Step 5: Update `restartGame`**

Find (around lines 229-254):

```javascript
    function restartGame(seed) {
        document.getElementById('restart-confirm').classList.add('hidden');
        document.getElementById('game-over').classList.add('hidden');
        document.getElementById('start-screen').classList.add('hidden');
        document.getElementById('upgrade-menu').classList.add('hidden');

        // Remove targeting-mode element so it gets recreated fresh for new game
        let tm = document.getElementById('targeting-mode');
        if (tm) tm.remove();

        const canvas = document.getElementById('game-canvas');
        resizeCanvas();

        let useSeed = (typeof seed === 'number') ? seed : null;
        game = new Game(canvas, useSeed, selectedDifficulty);
        game.start();
        updateSeedDisplay();
        updateModeDisplay();

        gameSpeed = 1;
        document.getElementById('speed-display').textContent = '1X';

        const autoEl = document.getElementById('autopilot-display');
        autoEl.textContent = 'OFF';
        autoEl.classList.remove('on');
    }
```

Replace (only one line changes — the `new Game(...)` call):

```javascript
    function restartGame(seed) {
        document.getElementById('restart-confirm').classList.add('hidden');
        document.getElementById('game-over').classList.add('hidden');
        document.getElementById('start-screen').classList.add('hidden');
        document.getElementById('upgrade-menu').classList.add('hidden');

        // Remove targeting-mode element so it gets recreated fresh for new game
        let tm = document.getElementById('targeting-mode');
        if (tm) tm.remove();

        const canvas = document.getElementById('game-canvas');
        resizeCanvas();

        let useSeed = (typeof seed === 'number') ? seed : null;
        game = new Game(canvas, useSeed, selectedTier);
        game.start();
        updateSeedDisplay();
        updateModeDisplay();

        gameSpeed = 1;
        document.getElementById('speed-display').textContent = '1X';

        const autoEl = document.getElementById('autopilot-display');
        autoEl.textContent = 'OFF';
        autoEl.classList.remove('on');
    }
```

- [ ] **Step 6: Rewrite the scoreboard rendering to use Ascension tiers**

Find (around lines 267-318 — the scoreboard block starting with `const scoresList = ...`):

```javascript
    const scoresList = document.getElementById('scores-list');
    const playerNameInput = document.getElementById('player-name');
    const submitScoreBtn = document.getElementById('submit-score');
    let visibleScoreTab = selectedDifficulty;

    function renderScores(diff) {
        let scores = JSON.parse(localStorage.getItem(scoreKey(diff)) || '[]');
        scores.sort((a, b) => b.wave - a.wave);
        scoresList.innerHTML = '';
        if (scores.length === 0) {
            scoresList.innerHTML = '<div style="text-align:center; color:#64748b; font-size:0.9rem;">NO DATA YET</div>';
            return;
        }
        scores.slice(0, 5).forEach((s, i) => {
            let div = document.createElement('div');
            div.style.display = 'flex';
            div.style.justifyContent = 'space-between';
            div.style.padding = '4px 0';
            div.style.borderBottom = '1px solid rgba(255,255,255,0.1)';
            div.innerHTML = `<span style="color:#fff;">#${i+1} ${s.name}</span> <span style="color:#a3e635;">WAVE ${s.wave}</span>`;
            scoresList.appendChild(div);
        });
    }

    function setScoreTab(diff) {
        visibleScoreTab = diff;
        document.querySelectorAll('.score-tab').forEach(b => {
            b.classList.toggle('selected', b.dataset.difficulty === diff);
        });
        renderScores(diff);
    }

    document.querySelectorAll('.score-tab').forEach(b => {
        b.addEventListener('click', () => setScoreTab(b.dataset.difficulty));
    });

    window.loadScores = function() {
        // Default the visible tab to the current run's mode on each game-over.
        setScoreTab(game ? game.difficulty : selectedDifficulty);
    };

    submitScoreBtn.addEventListener('click', () => {
        let name = playerNameInput.value.toUpperCase().replace(/[^A-Z0-9]/g, '');
        if (name.length > 0 && name.length <= 3 && game.state === 'gameover') {
            let key = scoreKey(game.difficulty);
            let scores = JSON.parse(localStorage.getItem(key) || '[]');
            scores.push({ name: name, wave: game.wave });
            localStorage.setItem(key, JSON.stringify(scores));
            document.getElementById('score-entry').style.display = 'none';
            setScoreTab(game.difficulty);
        }
    });
```

Replace with:

```javascript
    const scoresList = document.getElementById('scores-list');
    const playerNameInput = document.getElementById('player-name');
    const submitScoreBtn = document.getElementById('submit-score');

    // Populate the score-tabs container with one tab per Ascension tier (0..M1 max).
    function renderScoreTabs() {
        const tabs = document.getElementById('score-tabs');
        if (!tabs) return;
        tabs.innerHTML = '';
        for (let t = 0; t <= ASCENSION_MAX_TIER_M1; t++) {
            const btn = document.createElement('button');
            btn.className = 'score-tab';
            btn.textContent = 'A' + t;
            btn.dataset.tier = String(t);
            if (t === visibleScoreTier) btn.classList.add('selected');
            btn.addEventListener('click', () => setScoreTab(t));
            tabs.appendChild(btn);
        }
    }

    function renderScores(tier) {
        const scores = (save.highScores['a' + tier] || []).slice().sort((a, b) => b.wave - a.wave);
        scoresList.innerHTML = '';
        if (scores.length === 0) {
            scoresList.innerHTML = '<div style="text-align:center; color:#64748b; font-size:0.9rem;">NO DATA YET</div>';
            return;
        }
        scores.slice(0, 5).forEach((s, i) => {
            const div = document.createElement('div');
            div.style.display = 'flex';
            div.style.justifyContent = 'space-between';
            div.style.padding = '4px 0';
            div.style.borderBottom = '1px solid rgba(255,255,255,0.1)';
            div.innerHTML = `<span style="color:#fff;">#${i+1} ${s.name}</span> <span style="color:#a3e635;">WAVE ${s.wave}</span>`;
            scoresList.appendChild(div);
        });
    }

    function setScoreTab(tier) {
        visibleScoreTier = tier;
        document.querySelectorAll('.score-tab').forEach(b => {
            b.classList.toggle('selected', parseInt(b.dataset.tier) === tier);
        });
        renderScores(tier);
    }

    renderScoreTabs();

    window.loadScores = function() {
        // Default the visible tab to the current run's tier on each game-over.
        setScoreTab(game ? game.ascensionTier : selectedTier);
    };

    submitScoreBtn.addEventListener('click', () => {
        const name = playerNameInput.value.toUpperCase().replace(/[^A-Z0-9]/g, '');
        if (name.length > 0 && name.length <= 3 && game.state === 'gameover') {
            NeonSave.recordRun(save, { wave: game.wave, tier: game.ascensionTier, name: name });
            document.getElementById('score-entry').style.display = 'none';
            renderScoreTabs();
            setScoreTab(game.ascensionTier);
        }
    });
```

Note: the old `submitScoreBtn` handler called `NeonSave.recordRun` but also ran the XP math — in Task 6 we'll split XP application away from score submission so XP is awarded on every run, whether or not a name is entered. For this task, `NeonSave.recordRun` DOES award XP whenever it's called; we accept the minor double-count risk in Task 5 since Task 6 will fix it.

- [ ] **Step 7: Manual verification**

1. Reload. Console should be error-free.
2. Start screen shows 8 Ascension buttons (A0–A7). A1 is locked on a fresh save (`save.ascensionCleared + 1 = 1` unlocked, but A1 is the LAST unlocked, which means A2 onward is dashed). Clicking A0 works; clicking A1 works; clicking A2 should do nothing (locked).
3. Select A2, click INITIALIZE. Top bar MODE shows `A2`. Game starts with $93.
4. Die. On game-over, tabs show A0–A7; the tab for A2 is selected by default. Submit a score "TST" — it should land in `save.highScores.a2`.
5. Verify in console: `JSON.parse(localStorage.getItem('neonDefense.save')).highScores.a2`.

- [ ] **Step 8: Commit**

```bash
git add src/engine/main.js
git commit -m "$(cat <<'EOF'
Wire main.js to the Ascension selector + save system

Replaces selectedDifficulty/setDifficulty/scoreKey with selectedTier/setTier
and renderAscensionSelector. Scoreboard now renders one tab per Ascension
tier and reads/writes to save.highScores[a0..a7]. Game construction always
passes the current tier. High-score submission calls NeonSave.recordRun,
which persists to localStorage.
EOF
)"
```

---

## Task 6: Wire Meta-XP and first-clear bonus into the game-over flow

**Files:**
- Modify: `src/engine/game.js` (add `gameOver` signal)
- Modify: `src/engine/main.js` (XP awarding on death, NOT on name submit)

In Task 5 the name-submit handler triggers `recordRun`, which also awards XP — this means XP is only awarded if the player types a name. Here we split the flow: XP is always awarded the instant the game ends; name submission only appends to the high-score list.

- [ ] **Step 1: Expose a callback hook from `Game.gameOver`**

In `src/engine/game.js`, find (around line 689):

```javascript
    gameOver() {
        this.state = 'gameover';
        document.getElementById('game-over').classList.remove('hidden');
        document.getElementById('final-wave').textContent = this.wave;
        document.getElementById('score-entry').style.display = 'flex';
        document.getElementById('player-name').value = '';
        if (window.loadScores) window.loadScores();
    }
```

Replace with:

```javascript
    gameOver() {
        this.state = 'gameover';
        document.getElementById('game-over').classList.remove('hidden');
        document.getElementById('final-wave').textContent = this.wave;
        document.getElementById('score-entry').style.display = 'flex';
        document.getElementById('player-name').value = '';
        if (window.onRunEnded) window.onRunEnded({ wave: this.wave, tier: this.ascensionTier });
        if (window.loadScores) window.loadScores();
    }
```

- [ ] **Step 2: Split XP awarding from score submission in `main.js`**

In `src/engine/main.js`, find the `submitScoreBtn` handler (last thing in Task 5 Step 6):

```javascript
    submitScoreBtn.addEventListener('click', () => {
        const name = playerNameInput.value.toUpperCase().replace(/[^A-Z0-9]/g, '');
        if (name.length > 0 && name.length <= 3 && game.state === 'gameover') {
            NeonSave.recordRun(save, { wave: game.wave, tier: game.ascensionTier, name: name });
            document.getElementById('score-entry').style.display = 'none';
            renderScoreTabs();
            setScoreTab(game.ascensionTier);
        }
    });
```

Replace with:

```javascript
    // Name submission — appends to per-tier high-score list. Does NOT
    // re-award XP; that happens in onRunEnded immediately after death.
    submitScoreBtn.addEventListener('click', () => {
        const name = playerNameInput.value.toUpperCase().replace(/[^A-Z0-9]/g, '');
        if (name.length > 0 && name.length <= 3 && game.state === 'gameover') {
            const tier = game.ascensionTier;
            const list = save.highScores['a' + tier] || [];
            list.push({ name: name.slice(0, 3), wave: game.wave });
            list.sort((a, b) => b.wave - a.wave);
            save.highScores['a' + tier] = list.slice(0, 5);
            NeonSave.write(save);
            document.getElementById('score-entry').style.display = 'none';
            renderScoreTabs();
            setScoreTab(tier);
        }
    });

    // Called by Game.gameOver() the instant a run ends. Always awards XP
    // (whether or not the player submits a name) and updates ascensionCleared.
    // Exposes the XP breakdown to renderRunResultXP for the overlay.
    window.onRunEnded = function (result) {
        const { wave, tier } = result;
        const firstClear = wave >= 30 && tier > save.ascensionCleared;

        const xp = NeonSave.calculateRunXP(wave, tier, firstClear);
        save.metaXP        += xp.total;
        save.totalXPEarned += xp.total;
        if (firstClear) save.ascensionCleared = tier;
        NeonSave.write(save);

        // If a new tier unlocked, refresh selectors so the next button becomes active.
        if (firstClear) {
            renderAscensionSelector('start');
            renderAscensionSelector('gameover');
            renderAscensionSelector('restart');
        }

        // renderRunResultXP is defined in Task 7. Guard so Task 6 tests in
        // isolation don't ReferenceError when the overlay DOM and function
        // don't exist yet.
        if (typeof renderRunResultXP === 'function') {
            renderRunResultXP({ wave, tier, xp, firstClear });
        }
    };
```

- [ ] **Step 3: Manual verification — XP awarded on death**

1. Reload, clear save: `localStorage.clear(); location.reload();`.
2. Pick A0, start, lose immediately (don't build anything — wait until enemies breach the core).
3. Open console, paste `JSON.parse(localStorage.getItem('neonDefense.save'))`.
4. `metaXP` should equal the wave-1 XP: `Math.floor(1 * 1) = 1` (since `calculateRunXP(1, 0, false) = { total: 1 }`). If you survived more waves, it's the appropriate value from the formula.
5. `ascensionCleared` should still be 0 (wave < 30).
6. Do NOT submit a score. Reload. Confirm `metaXP` persisted.
7. Repeat with A1 selected — verify XP = `Math.floor(wave * 1.5)`.

- [ ] **Step 4: Commit**

```bash
git add src/engine/game.js src/engine/main.js
git commit -m "$(cat <<'EOF'
Award Meta-XP on game over (independent of name submission)

Game.gameOver now calls window.onRunEnded({wave, tier}); main.js handler
always awards XP per the spec formula, persists, and bumps ascensionCleared
on first clear (wave >= 30 on a new tier). Score submission handler
downgraded to list-append only; no double-count.
EOF
)"
```

---

## Task 7: Add XP breakdown display to the game-over (Run Result) overlay

**Files:**
- Modify: `index.html` (add `#xp-breakdown` block inside `#game-over`)
- Modify: `style.css` (add `.xp-breakdown`)
- Modify: `src/engine/main.js` (add `renderRunResultXP`)

- [ ] **Step 1: Insert the XP breakdown block into `#game-over`**

Find in `index.html` inside `#game-over` (around line 86):

```html
                <div id="game-over" class="hidden overlay">
                    <h2>GAME OVER</h2>
                    <p>Waves Survived: <span id="final-wave"></span></p>

                    <div id="score-entry"
```

Insert the XP block between the `<p>` and the `<div id="score-entry">`:

```html
                <div id="game-over" class="hidden overlay">
                    <h2>GAME OVER</h2>
                    <p>Waves Survived: <span id="final-wave"></span></p>

                    <div class="xp-breakdown" id="xp-breakdown">
                        <div class="xp-breakdown-title">META-XP EARNED</div>
                        <div class="xp-breakdown-row">
                            <span>Wave XP</span><span id="xp-wave">0</span>
                        </div>
                        <div class="xp-breakdown-row" id="xp-clear-row">
                            <span>Clear Bonus</span><span id="xp-clear">0</span>
                        </div>
                        <div class="xp-breakdown-row" id="xp-first-row">
                            <span>First-Clear Bonus</span><span id="xp-first">0</span>
                        </div>
                        <div class="xp-breakdown-total">
                            <span>Total</span><span id="xp-total">0</span>
                        </div>
                        <div class="xp-breakdown-balance">
                            Balance: <span id="xp-balance">0</span>
                        </div>
                        <div class="xp-breakdown-unlock hidden" id="xp-unlock">
                            <!-- filled in when firstClear -->
                        </div>
                    </div>

                    <div id="score-entry"
```

- [ ] **Step 2: Add CSS styles**

Append to the end of `style.css`:

```css
/* Run Result XP breakdown (M1 minimal) */
.xp-breakdown {
    width: 260px;
    margin: 14px auto 10px;
    padding: 10px 14px;
    background: rgba(0, 0, 0, 0.35);
    border: 1px solid rgba(56, 189, 248, 0.35);
    border-radius: 8px;
    font-family: monospace;
    color: var(--text-main);
}
.xp-breakdown-title {
    text-align: center;
    color: var(--accent);
    font-size: 0.8rem;
    letter-spacing: 3px;
    margin-bottom: 6px;
    font-weight: 700;
    font-family: inherit;
}
.xp-breakdown-row {
    display: flex;
    justify-content: space-between;
    font-size: 0.9rem;
    padding: 2px 0;
    color: var(--text-muted);
}
.xp-breakdown-row.hidden { display: none; }
.xp-breakdown-total {
    display: flex;
    justify-content: space-between;
    font-size: 1.05rem;
    padding: 6px 0 2px;
    margin-top: 4px;
    border-top: 1px solid rgba(255, 255, 255, 0.15);
    color: #a3e635;
    font-weight: 700;
}
.xp-breakdown-balance {
    text-align: center;
    font-size: 0.75rem;
    color: var(--text-muted);
    letter-spacing: 1px;
    margin-top: 4px;
}
.xp-breakdown-unlock {
    margin-top: 8px;
    padding: 6px 8px;
    background: rgba(163, 230, 53, 0.12);
    border: 1px solid rgba(163, 230, 53, 0.4);
    border-radius: 4px;
    text-align: center;
    font-size: 0.8rem;
    color: #a3e635;
    letter-spacing: 1px;
    font-family: inherit;
}
.xp-breakdown-unlock.hidden { display: none; }
```

- [ ] **Step 3: Add `renderRunResultXP` in `main.js`**

In `src/engine/main.js`, add the following function **before** `init()` (near the top-level helpers). Place it directly after the `renderAscensionSelector` definition:

```javascript
// Renders the XP breakdown in the game-over overlay. Called by
// window.onRunEnded after XP has been applied to the save.
function renderRunResultXP({ wave, tier, xp, firstClear }) {
    document.getElementById('xp-wave').textContent     = xp.waveXP;
    document.getElementById('xp-clear').textContent    = xp.clearBonus;
    document.getElementById('xp-first').textContent    = xp.firstBonus;
    document.getElementById('xp-total').textContent    = xp.total;
    document.getElementById('xp-balance').textContent  = save.metaXP;

    // Hide the clear-bonus row when no clear, first-bonus row when no first clear.
    document.getElementById('xp-clear-row').classList.toggle('hidden', xp.clearBonus === 0);
    document.getElementById('xp-first-row').classList.toggle('hidden', xp.firstBonus === 0);

    const unlock = document.getElementById('xp-unlock');
    if (firstClear) {
        const nextTier = Math.min(tier + 1, ASCENSION_MAX_TIER_M1);
        const nextSpec = ASCENSION_TIERS[nextTier];
        unlock.textContent = nextTier > tier
            ? `UNLOCKED: ${nextSpec.label} — ${nextSpec.name}`
            : `MAXED for M1`;
        unlock.classList.remove('hidden');
    } else {
        unlock.classList.add('hidden');
    }
}
```

- [ ] **Step 4: Manual verification — full flow**

1. Reload, clear save.
2. Pick A0, start, lose at wave 1. Game-over overlay should show:
   - Wave XP: 1
   - Clear Bonus row hidden
   - First-Clear row hidden
   - Total: 1
   - Balance: 1
   - No UNLOCKED banner.
3. Restart, pick A1, *survive to wave 30* (use autopilot + fast-forward x16 to speed up — this is a time investment but necessary for the firstClear path; alternative: temporarily tweak `this.wave = 30` via devtools before losing).
4. Expected: after death at wave ≥ 30:
   - Wave XP: ≥ 45 (`Math.floor(30 * 1.5) = 45`)
   - Clear Bonus: 50
   - First-Clear Bonus: 100
   - Total: ≥ 195
   - Balance: total + any prior XP
   - UNLOCKED banner showing `UNLOCKED: A2 — -25% start $`.
5. Console: `JSON.parse(localStorage.getItem('neonDefense.save')).ascensionCleared` should now equal `1`.
6. Reload. Ascension selector should now show A2 unlocked (not dashed).

Quick-path alternative to actually surviving: in console run `game.wave = 30; game.health = 0; game.update();`. The update loop will call `gameOver()` naturally on next tick (may require setting `game.enemies.forEach(e => e.reachedEnd = true);` then one update to push health to 0). Use whichever path is fastest.

- [ ] **Step 5: Commit**

```bash
git add index.html style.css src/engine/main.js
git commit -m "$(cat <<'EOF'
Add XP breakdown + unlock banner to Run Result overlay

Game-over overlay now shows wave XP / clear bonus / first-clear bonus /
total, plus current Meta-XP balance and a highlighted UNLOCKED banner
when a new Ascension tier just opened.
EOF
)"
```

---

## Task 8: Final smoke test + residual cleanup

**Files:**
- Modify: (verification only, no code changes expected)

- [ ] **Step 1: Residual dead-code check**

In the project root, check for remaining references to the old `DIFFICULTY` system. If the Grep tool is unavailable in your environment, open an editor search over the project for these strings — there should be zero matches:

- `DIFFICULTY`
- `DEFAULT_DIFFICULTY`
- `selectedDifficulty`
- `setDifficulty`
- `difficulty-btn`
- `difficulty-row`
- `difficulty-label`
- `difficulty-buttons`
- `scoreKey`
- `neonDefenseDifficulty`
- `neonDefenseScores_easy`, `neonDefenseScores_normal`, `neonDefenseScores_hard`
- `this.diffMult`
- `game.difficulty`
- `.diffMult`

Comments mentioning legacy names in `NeonSave.migrateLegacy` are fine (they document the migration). If any non-comment references remain, delete or rewrite them until the search is clean.

- [ ] **Step 2: End-to-end smoke test**

1. `localStorage.clear()`; reload.
2. Observe start screen: 8 Ascension buttons, A0 selected, A1 unlocked (not dashed), A2-A7 dashed.
3. Select A0, click INITIALIZE. Top bar MODE shows `A0`. Money starts at 125. Play a few waves, verify air wave at wave 5 (A0 default).
4. Die. Run Result shows XP earned. Submit name "SMK". Reload. `save.highScores.a0` should contain the entry.
5. Reload. Select A1. INITIALIZE. Money 125. Wave 1 enemies should be 15% beefier (visually, they take slightly longer to kill).
6. Force-win to wave 30 (as in Task 7 Step 4). Run Result shows UNLOCKED: A2. Reload; A2 is now selectable.
7. Select A2. INITIALIZE. Money starts at **93** (125 × 0.75 floored).
8. Restart mid-run using the SYS/RST button. Confirm the restart-confirm overlay shows Ascension buttons identical to start-screen.
9. Click the MODE display in the top bar — confirm it reads `A2`.
10. No console errors throughout.

- [ ] **Step 3: Legacy-save smoke test**

1. `localStorage.clear()`.
2. Paste:
   ```javascript
   localStorage.setItem('neonDefenseScores', JSON.stringify([{name: 'OLD', wave: 20}]));
   location.reload();
   ```
3. Verify `JSON.parse(localStorage.getItem('neonDefense.save')).highScores.a0` contains the `OLD` entry.
4. Verify `metaXP === 200` (welcome grant).
5. Verify `localStorage.getItem('neonDefenseScores')` still exists (we didn't delete it; migration is non-destructive — this is intentional so a rollback to 645ce59 still has data).

- [ ] **Step 4: Autopilot smoke test**

1. Clear save, select A0, start, turn on AUTO, set speed to 16x.
2. Watch for 2 minutes. Confirm autopilot plays normally — no crashes, towers get built, waves progress. (Autopilot is untouched by M1 code; this verifies nothing was broken.)

- [ ] **Step 5: Final commit (if any residual cleanup was required)**

If Step 1 flagged dead references or Step 2-4 exposed bugs needing fixes, apply them and commit:

```bash
git add -A
git commit -m "Final M1 cleanup: remove residual DIFFICULTY references"
```

Otherwise, skip this step. The milestone is complete.

---

## Spec coverage map

Every spec section for M1 maps to a task here:

| Spec section | Covered by |
|-------------|-----------|
| Persistent save schema | Task 1 |
| Legacy `neonDefenseScores`/`_easy`/`_normal`/`_hard` migration | Task 1 |
| Welcome-grant (200 XP) | Task 1 |
| `ASCENSION_TIERS` + `getAscensionEffects` | Task 2 |
| Retire 645ce59 DIFFICULTY + picker | Tasks 2, 3, 4, 5 |
| Apply A1 +15% HP | Task 3 Step 2 |
| Apply A2 −25% starting money | Task 3 Step 1 |
| Apply A3 air every 4 waves | Task 3 Step 2 |
| Apply A4 +15% count | Task 3 Step 2 |
| Apply A5 −40% payout | Task 3 Step 4 |
| Apply A6 disable invest-cap | Task 3 Step 3 |
| Apply A7 harsh potions | Task 3 Step 5 |
| Run Setup (minimal — Ascension picker) | Tasks 4, 5 |
| Run Result (minimal — XP breakdown) | Task 7 |
| Scoreboard per Ascension | Tasks 4 (markup), 5 (logic) |
| Meta-XP earn formula | Task 1 (math), Task 6 (award) |
| First-clear bonus + `ascensionCleared` tracking | Task 6 |
| Gate selector to `save.ascensionCleared + 1` | Task 5 Step 2 (`setTier`, `renderAscensionSelector`) |
| MODE display shows Ascension | Task 5 Step 2 (`updateModeDisplay`) |
| Out-of-scope for M1 (Tech Tree, Heroes, Kits, Abilities, Mastery, Variants, A8-A10, Purist/Daily) | Deferred to M2/M3 per spec |

---

## Execution handoff

Plan complete and saved to `docs/superpowers/plans/2026-04-22-roguelike-m1-implementation.md`.

Two execution options:

**1. Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration. Best when tasks are well-isolated (which M1 tasks are — each ends in a commit and a clean state).

**2. Inline Execution** — Execute tasks in this session using executing-plans, batch execution with checkpoints for review.

Which approach?
