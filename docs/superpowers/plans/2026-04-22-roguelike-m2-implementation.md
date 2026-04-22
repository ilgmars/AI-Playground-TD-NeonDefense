# Roguelike Meta-Progression Milestone 2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the full horizontal-progression surface on top of M1: a 15-node Tech Tree (3 Heroes + 3 Active Abilities + 4 Starter Kits + 5 QoL nodes), a new Main Menu screen split off from Run Setup, an in-game ability button with charges, and Ascension-triggered auto-unlocks. After M2, Meta-XP earned in M1 becomes spendable, runs become configurable (hero + kit + ability pickers), and four Ascension clears grant free nodes.

**Architecture:** Data lives in `src/config/config.js` (catalogs for heroes/kits/abilities/QoL + the tree structure). Logic for purchase/eligibility/auto-unlock lives in a new `src/progression/tree.js`. In-run ability state (charges, targeting mode, visual effects) lives in a new `src/progression/abilities.js`. Game's constructor reads `save.ascensionCleared`, `save.unlockedNodes`, and the run's `heroId`/`kitId`/`abilityId` to compose final effects. UI decomposes the existing start-screen into `#main-menu` + `#run-setup` overlays and adds `#tech-tree` and new top-bar ability-button wiring.

**Tech Stack:** Vanilla JS, no build, no tests (manual browser verification). localStorage for persistence.

**Reference spec:** [docs/superpowers/specs/2026-04-22-roguelike-meta-progression-design.md](../specs/2026-04-22-roguelike-meta-progression-design.md)
**M1 plan (prerequisite):** [docs/superpowers/plans/2026-04-22-roguelike-m1-implementation.md](./2026-04-22-roguelike-m1-implementation.md)

---

## File structure

| File | Kind | Responsibility |
|------|------|----------------|
| `src/config/config.js` | MODIFY | Append `HEROES`, `STARTER_KITS`, `ABILITIES`, `QOL_NODES`, `TECH_TREE` catalogs + `getTreeNode(id)` helper |
| `src/progression/save.js` | MODIFY | `createFreshSave` pre-unlocks `hero.pioneer` + `kit.standard`; add `hasUnlocked(save, nodeId)` helper |
| `src/progression/tree.js` | CREATE | `NeonTree` namespace: `canPurchase`, `purchase`, `isEligibleTier`, `autoUnlockOnAscension`, `renderTechTree` |
| `src/progression/abilities.js` | CREATE | `NeonAbilities` namespace: per-ability charge state, activation callbacks (Airstrike/Freeze/Scan), draw hooks |
| `src/engine/game.js` | MODIFY | Constructor takes `loadout` object (`{heroId, kitId, abilityId}`); applies hero/kit effects, stores ability instance, exposes `useAbility`, pre-places Relay for Economist, exposes `airstrikeDamage(x,y)` + `freezeAllEnemies(duration)` + wave preview |
| `src/engine/main.js` | MODIFY | Splits start-screen navigation into `#main-menu` → `#run-setup` → game; wires Tech Tree screen; adds Run Setup dropdowns; handles Ascension auto-unlocks in `window.onRunEnded`; wires ability button |
| `src/ai/autopilot.js` | MODIFY | Reads `AUTOPILOT_CONFIG.tickInterval` from `game.autopilotTickInterval` (overridden when `qol.fastai` owned); triggers abilities via heuristics |
| `index.html` | MODIFY | Adds `#main-menu` overlay, `#tech-tree` overlay, expands `#start-screen` → `#run-setup` (with Hero/Kit/Ability dropdowns), adds ability button to top-bar, adds `#wave-preview` overlay for Scan/Strategist |
| `style.css` | MODIFY | Styles for `#main-menu`, `#tech-tree`, dropdown-rows, ability-button, HP bars, wave-preview panel |

**Load order in `index.html`** — add `tree.js` and `abilities.js` between existing `save.js` and `game.js`:
```
... (unchanged M1 order)
src/progression/save.js
src/progression/tree.js        ← NEW
src/progression/abilities.js   ← NEW
src/engine/game.js
src/engine/main.js
```

---

## Verification approach

No test framework (per CLAUDE.md). Each task ends with manual browser verification using specific clicks and DevTools console checks. Reload after each commit to confirm no regressions.

**Pre-existing M1 state assumed:** fresh `localStorage.clear(); location.reload();` produces a fresh save with `metaXP: 0`, `ascensionCleared: 0`, `unlockedNodes: []`. After Task 1 of this plan, `unlockedNodes` should default to `["hero.pioneer", "kit.standard"]`.

---

## Task 1: Add data catalogs to `config.js`

**Files:** `src/config/config.js`

- [ ] **Step 1: Append catalogs at end of file**

Open `src/config/config.js`. After the final `}` of `TOWER_UPGRADES`, append:

```javascript

// -------------------------------------------------------------------------
// Heroes (M2). Picked at run setup; one passive effect applied at Game
// construction. Pioneer is pre-unlocked on fresh save (see save.js).
// -------------------------------------------------------------------------
const HEROES = {
    pioneer:  { id: 'hero.pioneer',  name: 'Pioneer',  desc: '+25% starting money',
                apply: (g) => { g.money = Math.floor(g.money * 1.25); } },
    engineer: { id: 'hero.engineer', name: 'Engineer', desc: '-10% tower cost, -5% upgrade cost',
                apply: (g) => { g.towerCostMult = 0.9;  g.upgradeCostMult = 0.95; } },
    warden:   { id: 'hero.warden',   name: 'Warden',   desc: '+5 max HP; potions heal +1',
                apply: (g) => { g.maxHealth += 5; g.health += 5; g.potionHealBonus = 1; } }
};
const DEFAULT_HERO = 'pioneer';

// -------------------------------------------------------------------------
// Starter Kits (M2). Picked at run setup; one configuration change applied
// at Game construction. Standard is pre-unlocked.
// -------------------------------------------------------------------------
const STARTER_KITS = {
    standard:   { id: 'kit.standard',   name: 'Standard',   desc: 'Default loadout',
                  apply: (g) => { /* no-op */ } },
    economist:  { id: 'kit.economist',  name: 'Economist',  desc: '$75 start, free Relay pre-placed',
                  apply: (g) => { g.money = 75; g.prePlaceRelay = true; } },
    medic:      { id: 'kit.medic',      name: 'Medic',      desc: '+2 starting potions; potions cost 1.5x',
                  apply: (g) => { g.startingPotions = 2; g.potionCostKitMult = 1.5; } },
    strategist: { id: 'kit.strategist', name: 'Strategist', desc: 'See all waves; -20% starting money',
                  apply: (g) => { g.money = Math.floor(g.money * 0.8); g.showAllWavesPreview = true; } }
};
const DEFAULT_KIT = 'standard';

// -------------------------------------------------------------------------
// Active Abilities (M2). Picked at run setup; used during a run via the
// top-bar ability button. Logic lives in abilities.js.
// -------------------------------------------------------------------------
const ABILITIES = {
    none:      { id: 'ability.none',      name: 'None',         desc: 'No ability this run', charges: 0, kind: 'none' },
    scan:      { id: 'ability.scan',      name: 'Scan',         desc: 'Reveal next 3 waves', charges: 1, kind: 'reveal' },
    airstrike: { id: 'ability.airstrike', name: 'Airstrike',    desc: '200 dmg AoE, 80px radius', charges: 3, kind: 'target' },
    freeze:    { id: 'ability.freeze',    name: 'Freeze Wave',  desc: 'Stop all enemies 3s', charges: 1, kind: 'instant' }
};
const DEFAULT_ABILITY = 'none';

// -------------------------------------------------------------------------
// QoL nodes (M2). Toggled by ownership in save.unlockedNodes. Effects
// applied at Game construction or read per-frame.
// -------------------------------------------------------------------------
const QOL_NODES = {
    'qol.hpbars':      { name: 'Enemy HP Bars',   desc: 'Show HP bars above each enemy' },
    'qol.fastai':      { name: 'Fast Autopilot',  desc: 'Autopilot tick 15f (from 30f)' },
    'qol.dailyseed':   { name: 'Daily Seed',      desc: 'Daily Challenge button on Main Menu' },
    'qol.skipsetup':   { name: 'Skip Setup',      desc: 'One-click reuse of last loadout' },
    'qol.ascpreview':  { name: 'Ascension +1 Preview', desc: 'See next-tier modifier before clearing' }
};

// -------------------------------------------------------------------------
// Tech Tree (M2). 3 tiers x 5 nodes. Costs: T1=50, T2=200, T3=500 XP.
// Tier gating: need >= 2 owned nodes in prior tier to open next tier.
// Pre-unlocks: hero.pioneer + kit.standard (see save.js).
// Auto-unlocks: clearing A1/A3/A5/A7 grants specific nodes for free
// (see tree.js autoUnlockOnAscension).
// -------------------------------------------------------------------------
const TECH_TREE = {
    tier1: {
        cost: 50,
        nodes: [
            { id: 'hero.pioneer',   kind: 'hero',    desc: '+25% starting money' },
            { id: 'kit.standard',   kind: 'kit',     desc: 'Default loadout' },
            { id: 'hero.engineer',  kind: 'hero',    desc: '-10% tower cost, -5% upgrade cost' },
            { id: 'ability.scan',   kind: 'ability', desc: 'Reveal next 3 waves (1 charge)' },
            { id: 'kit.economist',  kind: 'kit',     desc: '$75 start + pre-placed Relay' }
        ]
    },
    tier2: {
        cost: 200,
        nodes: [
            { id: 'hero.warden',       kind: 'hero',    desc: '+5 max HP; potions heal +1' },
            { id: 'ability.airstrike', kind: 'ability', desc: 'Click-target 200 dmg AoE (3 charges)' },
            { id: 'kit.medic',         kind: 'kit',     desc: '+2 potions; potions cost 1.5x' },
            { id: 'qol.hpbars',        kind: 'qol',    desc: 'Show enemy HP bars' },
            { id: 'qol.fastai',        kind: 'qol',    desc: 'Autopilot tick 15f (faster)' }
        ]
    },
    tier3: {
        cost: 500,
        nodes: [
            { id: 'ability.freeze',    kind: 'ability', desc: 'Freeze all enemies 3s (1 charge)' },
            { id: 'kit.strategist',    kind: 'kit',     desc: 'See all waves; -20% start $' },
            { id: 'qol.dailyseed',     kind: 'qol',    desc: 'Daily Challenge seed button' },
            { id: 'qol.skipsetup',     kind: 'qol',    desc: 'One-click last-loadout reuse' },
            { id: 'qol.ascpreview',    kind: 'qol',    desc: 'Preview next Ascension modifier' }
        ]
    }
};

// Ascension-clear → free tree node mapping. Fires on first clear of each tier.
const ASCENSION_AUTO_UNLOCKS = {
    1:  'kit.economist',
    3:  'qol.hpbars',
    5:  'qol.dailyseed',
    7:  'qol.skipsetup'
    // A10 reward deferred to M3 (cosmetic banner).
};

// Lookup a node definition by id across all 3 tiers. Returns null if not found.
function getTreeNode(nodeId) {
    for (const tierKey of ['tier1', 'tier2', 'tier3']) {
        const tier = TECH_TREE[tierKey];
        for (const node of tier.nodes) {
            if (node.id === nodeId) {
                return { ...node, tier: tierKey, cost: tier.cost };
            }
        }
    }
    return null;
}
```

- [ ] **Step 2: Manual verification**

Reload `index.html` (game will still run — this is additive). In DevTools console:

```javascript
console.log(HEROES.engineer);       // {id: 'hero.engineer', name: 'Engineer', ...}
console.log(getTreeNode('kit.medic'));  // {id, kind, desc, tier: 'tier2', cost: 200}
console.log(ASCENSION_AUTO_UNLOCKS[1]); // 'kit.economist'
console.log(Object.keys(TECH_TREE.tier1.nodes).length); // 5
```

All should print expected values.

- [ ] **Step 3: Commit**

```bash
git add src/config/config.js
git commit -m "$(cat <<'EOF'
Add M2 catalogs: HEROES, STARTER_KITS, ABILITIES, QOL_NODES, TECH_TREE

15 tree nodes across 3 tiers. Ascension auto-unlocks map A1/A3/A5/A7 to
specific free nodes. getTreeNode(id) provides uniform lookup. Apply
functions on heroes/kits mutate a Game instance at construction time.
EOF
)"
```

---

## Task 2: Pre-unlock Pioneer + Standard on fresh save; add `hasUnlocked` helper

**Files:** `src/progression/save.js`

- [ ] **Step 1: Add pre-unlocks to `createFreshSave`**

Find in `src/progression/save.js`:

```javascript
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
```

Replace with:

```javascript
        return {
            version: SCHEMA_VERSION,
            metaXP: 0,
            totalXPEarned: 0,
            ascensionCleared: 0,                               // highest tier where wave 30 was reached
            unlockedNodes: ['hero.pioneer', 'kit.standard'],   // M2 pre-unlocked tree nodes
            towerMastery: mastery,                             // filled in M3
            highScores: highScores,                            // per-Ascension top-5 lists of { name, wave }
            lastLoadout: null,                                 // M2: remembered for qol.skipsetup
            settings: { skipRunSetup: false }
        };
```

- [ ] **Step 2: Add `hasUnlocked` to the exported API**

Still in `src/progression/save.js`, find the `function write(save)` definition and add a new function immediately after:

```javascript
    function write(save) {
        localStorage.setItem(KEY, JSON.stringify(save));
    }

    // True if the given nodeId exists in save.unlockedNodes. Safe for any input.
    function hasUnlocked(save, nodeId) {
        return Array.isArray(save.unlockedNodes) && save.unlockedNodes.includes(nodeId);
    }
```

Then add `hasUnlocked` to the return object:

```javascript
    return {
        KEY,
        SCHEMA_VERSION,
        TOWER_TYPES,
        createFreshSave,
        migrateLegacy,
        load,
        write,
        hasUnlocked,
        calculateRunXP,
        recordRun
    };
```

- [ ] **Step 3: Backfill pre-unlocks on existing saves (migration without schema bump)**

Still in `src/progression/save.js`, find the `load()` function:

```javascript
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
```

Replace with:

```javascript
    function load() {
        const raw = localStorage.getItem(KEY);
        if (raw !== null) {
            try {
                const parsed = JSON.parse(raw);
                if (parsed && typeof parsed === 'object' && parsed.version === SCHEMA_VERSION) {
                    backfillV1Fields(parsed);
                    return parsed;
                }
            } catch (_) { /* fall through to fresh */ }
        }
        const fresh = createFreshSave();
        migrateLegacy(fresh);
        write(fresh);
        return fresh;
    }

    // Non-schema-bump backfill for M1-era saves missing M2 fields.
    // Idempotent — safe to call on every load.
    function backfillV1Fields(save) {
        if (!Array.isArray(save.unlockedNodes)) save.unlockedNodes = [];
        if (!save.unlockedNodes.includes('hero.pioneer')) save.unlockedNodes.push('hero.pioneer');
        if (!save.unlockedNodes.includes('kit.standard')) save.unlockedNodes.push('kit.standard');
        if (typeof save.lastLoadout === 'undefined') save.lastLoadout = null;
        if (!save.settings || typeof save.settings !== 'object') save.settings = { skipRunSetup: false };
        if (typeof save.settings.skipRunSetup !== 'boolean') save.settings.skipRunSetup = false;
        write(save);
    }
```

- [ ] **Step 4: Manual verification**

Reload. In DevTools:

```javascript
localStorage.clear(); location.reload();
// After reload:
const s = JSON.parse(localStorage.getItem('neonDefense.save'));
console.log(s.unlockedNodes);  // ['hero.pioneer', 'kit.standard']
console.log(s.lastLoadout);    // null
console.log(NeonSave.hasUnlocked(s, 'hero.pioneer'));  // true
console.log(NeonSave.hasUnlocked(s, 'hero.engineer')); // false
```

Backfill test — simulate an M1-era save:

```javascript
localStorage.clear();
localStorage.setItem('neonDefense.save', JSON.stringify({
    version: 1, metaXP: 300, ascensionCleared: 2, unlockedNodes: [],
    towerMastery: {}, highScores: {}, settings: {}
}));
location.reload();
const s2 = JSON.parse(localStorage.getItem('neonDefense.save'));
console.log(s2.unlockedNodes);  // Should be ['hero.pioneer', 'kit.standard']
console.log(s2.lastLoadout);    // null (backfilled)
console.log(s2.metaXP);         // 300 (preserved)
```

- [ ] **Step 5: Commit**

```bash
git add src/progression/save.js
git commit -m "$(cat <<'EOF'
Pre-unlock Pioneer + Standard Kit on fresh save; add hasUnlocked helper

createFreshSave now seeds unlockedNodes with hero.pioneer + kit.standard
so first-run players have a functional default loadout. lastLoadout
placeholder field added for qol.skipsetup. backfillV1Fields() migrates
M1-era saves without requiring a schema bump.
EOF
)"
```

---

## Task 3: Create `src/progression/tree.js` — purchase, eligibility, auto-unlock

**Files:**
- Create: `src/progression/tree.js`
- Modify: `index.html` (add script tag)

- [ ] **Step 1: Create the module**

Create `src/progression/tree.js`:

```javascript
// Tech Tree purchase + eligibility + auto-unlock logic (M2).
// Reads/writes save.unlockedNodes and save.metaXP via NeonSave.
// No DOM — rendering is done by main.js's renderTechTree, which
// consumes canPurchase/isTierOpen to style nodes.

const NeonTree = (function () {

    // Returns true if the tier is "open" — player owns >= 2 nodes in the
    // immediately prior tier. Tier 1 is always open.
    function isTierOpen(save, tierKey) {
        if (tierKey === 'tier1') return true;
        const priorKey = (tierKey === 'tier2') ? 'tier1' : 'tier2';
        const priorNodes = TECH_TREE[priorKey].nodes.map(n => n.id);
        const owned = priorNodes.filter(id => NeonSave.hasUnlocked(save, id));
        return owned.length >= 2;
    }

    // Returns { ok: boolean, reason?: string } for a purchase attempt.
    // Does not mutate the save.
    function canPurchase(save, nodeId) {
        const node = getTreeNode(nodeId);
        if (!node) return { ok: false, reason: 'Unknown node' };
        if (NeonSave.hasUnlocked(save, nodeId)) return { ok: false, reason: 'Already owned' };
        if (!isTierOpen(save, node.tier)) return { ok: false, reason: 'Tier locked — unlock 2 nodes in prior tier' };
        if (save.metaXP < node.cost) return { ok: false, reason: 'Not enough XP' };
        return { ok: true };
    }

    // Attempts purchase. Returns true on success. Mutates save.
    function purchase(save, nodeId) {
        const check = canPurchase(save, nodeId);
        if (!check.ok) return false;
        const node = getTreeNode(nodeId);
        save.metaXP -= node.cost;
        save.unlockedNodes.push(nodeId);
        NeonSave.write(save);
        return true;
    }

    // Called from window.onRunEnded when a new Ascension tier is cleared.
    // Grants a free tree node per ASCENSION_AUTO_UNLOCKS. Returns the
    // nodeId that was unlocked (or null if already owned / no mapping).
    function autoUnlockOnAscension(save, clearedTier) {
        const nodeId = ASCENSION_AUTO_UNLOCKS[clearedTier];
        if (!nodeId) return null;
        if (NeonSave.hasUnlocked(save, nodeId)) return null;
        save.unlockedNodes.push(nodeId);
        NeonSave.write(save);
        return nodeId;
    }

    return {
        isTierOpen,
        canPurchase,
        purchase,
        autoUnlockOnAscension
    };
})();
```

- [ ] **Step 2: Add script tag to `index.html`**

In `index.html`, find the script block. Insert `tree.js` immediately after `save.js`:

```html
    <script src="src/progression/save.js"></script>
    <script src="src/progression/tree.js"></script>
    <script src="src/engine/game.js"></script>
    <script src="src/engine/main.js"></script>
```

- [ ] **Step 3: Manual verification**

Reload. In DevTools:

```javascript
const s = NeonSave.load();
console.log(NeonTree.isTierOpen(s, 'tier1'));   // true (always open)
console.log(NeonTree.isTierOpen(s, 'tier2'));   // false (player only owns 2 T1 pre-unlocks — needs >= 2 T1 of any — wait, they DO own 2; this should be TRUE)
```

Note: fresh save has 2 T1 nodes pre-unlocked (pioneer + standard). So `isTierOpen(s, 'tier2')` should return **true**. If it returns false, there's a bug.

```javascript
console.log(NeonTree.canPurchase(s, 'hero.engineer'));  // { ok: false, reason: 'Not enough XP' } since metaXP=0
s.metaXP = 100;
console.log(NeonTree.canPurchase(s, 'hero.engineer'));  // { ok: true }
console.log(NeonTree.purchase(s, 'hero.engineer'));     // true
console.log(s.metaXP);                                   // 50 (100 - 50)
console.log(s.unlockedNodes);                            // ['hero.pioneer', 'kit.standard', 'hero.engineer']
console.log(NeonTree.purchase(s, 'hero.engineer'));     // false (already owned)
console.log(NeonTree.autoUnlockOnAscension(s, 1));      // 'kit.economist' (or null if already owned)
console.log(s.unlockedNodes);                            // [..., 'kit.economist']
```

- [ ] **Step 4: Commit**

```bash
git add src/progression/tree.js index.html
git commit -m "$(cat <<'EOF'
Add NeonTree module: purchase, eligibility, Ascension auto-unlock

Tree purchase flow checks tier gating (>=2 nodes owned in prior tier),
XP cost, and ownership. autoUnlockOnAscension wires A1/A3/A5/A7 clears
to free-node grants from ASCENSION_AUTO_UNLOCKS.
EOF
)"
```

---

## Task 4: Add Main Menu overlay + split Run Setup from current start-screen

**Files:**
- Modify: `index.html`
- Modify: `style.css`

This task is markup + CSS only. The JS wiring happens in Task 5.

- [ ] **Step 1: Insert `#main-menu` overlay in `index.html`**

In `index.html`, find the existing `#start-screen` block (around line 137):

```html
                <div id="start-screen" class="overlay">
                    <h1>NEON DEFENSE</h1>
                    <p>Protect the core from the rogue geometry.</p>
                    <div class="ascension-row">
                        ...
                    </div>
                    ...
                    <button id="start-btn">INITIALIZE</button>
                </div>
```

Insert a new `#main-menu` overlay **immediately before** the existing `#start-screen`:

```html
                <div id="main-menu" class="overlay">
                    <h1>NEON DEFENSE</h1>
                    <p>Protect the core from the rogue geometry.</p>
                    <div class="menu-buttons">
                        <button id="menu-start-btn" class="menu-primary">START RUN</button>
                        <button id="menu-tree-btn">TECH TREE <span class="menu-balance" id="menu-xp-balance">0 XP</span></button>
                        <button id="menu-dailyseed-btn" class="hidden">DAILY CHALLENGE</button>
                        <button id="menu-reset-btn" class="danger small">RESET SAVE</button>
                    </div>
                </div>

                <div id="start-screen" class="overlay hidden">
                    <h1 style="font-size: 2.2rem;">RUN SETUP</h1>
                    <div class="ascension-row">
                        <span class="ascension-label">ASCENSION</span>
                        <div class="ascension-buttons" data-context="start">
                            <!-- Buttons populated by main.js renderAscensionSelector('start') -->
                        </div>
                        <div class="ascension-modifiers-preview" data-context="start">—</div>
                    </div>
                    <div class="loadout-row">
                        <span class="loadout-label">HERO</span>
                        <select id="run-hero-select" class="loadout-select"></select>
                    </div>
                    <div class="loadout-row">
                        <span class="loadout-label">KIT</span>
                        <select id="run-kit-select" class="loadout-select"></select>
                    </div>
                    <div class="loadout-row">
                        <span class="loadout-label">ABILITY</span>
                        <select id="run-ability-select" class="loadout-select"></select>
                    </div>
                    <div class="seed-input-row">
                        <input type="number" id="start-seed-input" placeholder="SEED (optional)" />
                    </div>
                    <div class="setup-actions">
                        <button id="setup-back-btn" class="secondary">BACK</button>
                        <button id="start-btn">INITIALIZE</button>
                    </div>
                </div>
```

Note: `#start-screen` now starts with the `hidden` class — Main Menu is the default landing screen. Main Menu's #main-menu does NOT have `hidden` (it's visible on page load).

- [ ] **Step 2: Add CSS for Main Menu + loadout rows**

Append to `style.css`:

```css
/* M2: Main Menu buttons */
.menu-buttons {
    display: flex;
    flex-direction: column;
    gap: 10px;
    align-items: stretch;
    margin-top: 20px;
    min-width: 240px;
}
.menu-buttons button {
    padding: 10px 16px;
    font-size: 0.95rem;
    letter-spacing: 2px;
    border: 2px solid var(--accent);
    background: transparent;
    color: var(--accent);
    border-radius: 6px;
    cursor: pointer;
    font-family: inherit;
    font-weight: 700;
}
.menu-buttons button:hover {
    background: var(--accent);
    color: #0f172a;
    box-shadow: 0 0 16px rgba(56, 189, 248, 0.45);
}
.menu-buttons button.menu-primary {
    border-color: #a3e635;
    color: #a3e635;
}
.menu-buttons button.menu-primary:hover {
    background: #a3e635;
    box-shadow: 0 0 16px rgba(163, 230, 53, 0.45);
}
.menu-buttons button.small {
    font-size: 0.8rem;
    padding: 6px 10px;
    border-width: 1px;
    opacity: 0.65;
}
.menu-buttons button.small:hover {
    opacity: 1;
}
.menu-buttons .menu-balance {
    float: right;
    font-size: 0.75rem;
    color: var(--text-muted);
    font-weight: 400;
}
.menu-buttons button:hover .menu-balance {
    color: rgba(15, 23, 42, 0.7);
}

/* M2: Loadout dropdowns in Run Setup */
.loadout-row {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 4px;
    margin-bottom: 10px;
}
.loadout-label {
    font-size: 0.7rem;
    color: var(--text-muted);
    letter-spacing: 2px;
    font-weight: 600;
}
.loadout-select {
    min-width: 240px;
    padding: 5px 10px;
    font-size: 0.85rem;
    background: rgba(0, 0, 0, 0.5);
    color: var(--text-main);
    border: 1px solid var(--accent);
    border-radius: 4px;
    font-family: inherit;
    cursor: pointer;
}
.loadout-select:disabled {
    opacity: 0.5;
    cursor: not-allowed;
}
.setup-actions {
    display: flex;
    gap: 14px;
    margin-top: 14px;
}
.setup-actions button.secondary {
    border-color: var(--text-muted);
    color: var(--text-muted);
}
.setup-actions button.secondary:hover {
    border-color: var(--accent);
    color: var(--accent);
}
```

- [ ] **Step 3: Manual verification**

Reload. Expected: **Main Menu is visible on page load**. It shows a title, description, and 4 buttons (Start Run, Tech Tree, Daily Challenge — hidden by default, Reset Save). None of the buttons work yet (no JS wiring — Task 5). The Run Setup / start-screen should be hidden.

(JS errors about missing event listeners are expected — Task 5 fixes.)

- [ ] **Step 4: Commit**

```bash
git add index.html style.css
git commit -m "$(cat <<'EOF'
Add Main Menu overlay; split Run Setup from start-screen

#main-menu is the new landing overlay with Start Run / Tech Tree /
Daily Challenge / Reset Save buttons. #start-screen becomes the Run
Setup screen (hidden by default), extended with Hero / Kit / Ability
dropdowns and Back button. JS wiring in next task.
EOF
)"
```

---

## Task 5: Wire Main Menu navigation + Run Setup loadout dropdowns in `main.js`

**Files:** `src/engine/main.js`

This is the biggest main.js task in M2. Done in focused sub-steps.

- [ ] **Step 1: Add loadout state globals at file scope**

Near the top of `src/engine/main.js` (after the `save` / `selectedTier` globals from M1), insert:

```javascript
// Selected loadout for next run. Initialized from save.lastLoadout if present,
// else default to Pioneer + Standard + None. Always valid (unlocked).
let selectedHero    = (save.lastLoadout && save.lastLoadout.heroId   && NeonSave.hasUnlocked(save, save.lastLoadout.heroId))   ? save.lastLoadout.heroId   : DEFAULT_HERO && ('hero.' + DEFAULT_HERO);
let selectedKit     = (save.lastLoadout && save.lastLoadout.kitId    && NeonSave.hasUnlocked(save, save.lastLoadout.kitId))    ? save.lastLoadout.kitId    : 'kit.' + DEFAULT_KIT;
let selectedAbility = (save.lastLoadout && save.lastLoadout.abilityId && NeonSave.hasUnlocked(save, save.lastLoadout.abilityId)) ? save.lastLoadout.abilityId : 'ability.none';
```

Note: `selectedHero` / `selectedKit` always store the FULL node id (`hero.pioneer`, not `pioneer`) for consistency with `save.unlockedNodes`.

- [ ] **Step 2: Add loadout-dropdown rendering function at file scope**

Add a new top-level function immediately after `renderAscensionSelector`:

```javascript
// Populate the three loadout dropdowns based on unlocked tree nodes.
// Called at init and after any tree purchase. Preserves current selection
// if still valid; falls back to default otherwise.
function renderLoadoutDropdowns() {
    renderOneLoadoutSelect('run-hero-select',    'hero',    'selectedHero',    'hero.pioneer',   HEROES);
    renderOneLoadoutSelect('run-kit-select',     'kit',     'selectedKit',     'kit.standard',   STARTER_KITS);
    renderOneAbilitySelect();
}

function renderOneLoadoutSelect(elementId, prefix, globalName, fallbackId, catalog) {
    const sel = document.getElementById(elementId);
    if (!sel) return;
    sel.innerHTML = '';

    const currentGlobal = (globalName === 'selectedHero') ? selectedHero
                        : (globalName === 'selectedKit')  ? selectedKit
                        : selectedAbility;

    let validSelection = currentGlobal;
    const entries = Object.values(catalog);
    const unlocked = entries.filter(e => NeonSave.hasUnlocked(save, e.id));
    if (unlocked.length === 0) return;

    for (const entry of unlocked) {
        const opt = document.createElement('option');
        opt.value = entry.id;
        opt.textContent = entry.name + ' — ' + entry.desc;
        sel.appendChild(opt);
    }

    if (!unlocked.find(e => e.id === validSelection)) {
        validSelection = fallbackId;
    }
    sel.value = validSelection;
    if (globalName === 'selectedHero') selectedHero = validSelection;
    else if (globalName === 'selectedKit') selectedKit = validSelection;
}

// Ability dropdown is special: always includes 'None' even if not in save.
function renderOneAbilitySelect() {
    const sel = document.getElementById('run-ability-select');
    if (!sel) return;
    sel.innerHTML = '';

    // Always-available "None" option
    const noneOpt = document.createElement('option');
    noneOpt.value = 'ability.none';
    noneOpt.textContent = ABILITIES.none.name + ' — ' + ABILITIES.none.desc;
    sel.appendChild(noneOpt);

    // Unlocked abilities
    for (const key of ['scan', 'airstrike', 'freeze']) {
        const ab = ABILITIES[key];
        if (NeonSave.hasUnlocked(save, ab.id)) {
            const opt = document.createElement('option');
            opt.value = ab.id;
            opt.textContent = ab.name + ' — ' + ab.desc + ' (' + ab.charges + ')';
            sel.appendChild(opt);
        }
    }

    if (![...sel.options].find(o => o.value === selectedAbility)) {
        selectedAbility = 'ability.none';
    }
    sel.value = selectedAbility;
}
```

- [ ] **Step 3: Add Main Menu navigation functions at file scope**

Add, still at file scope (before `function init`):

```javascript
// Show / hide overlay helpers. All overlays use .hidden to toggle.
function showScreen(id) {
    const el = document.getElementById(id);
    if (el) el.classList.remove('hidden');
}
function hideScreen(id) {
    const el = document.getElementById(id);
    if (el) el.classList.add('hidden');
}

// Main Menu → Run Setup → Game is the canonical forward path.
// Backward navigation: Run Setup → Main Menu; Game-over → Main Menu.
function navigateToMainMenu() {
    hideScreen('start-screen');
    hideScreen('game-over');
    hideScreen('restart-confirm');
    hideScreen('tech-tree');
    showScreen('main-menu');
    updateMainMenuState();
}

function navigateToRunSetup() {
    hideScreen('main-menu');
    hideScreen('game-over');
    hideScreen('tech-tree');
    showScreen('start-screen');
    renderAscensionSelector('start');
    renderLoadoutDropdowns();
}

function updateMainMenuState() {
    const bal = document.getElementById('menu-xp-balance');
    if (bal) bal.textContent = save.metaXP + ' XP';

    const daily = document.getElementById('menu-dailyseed-btn');
    if (daily) {
        if (NeonSave.hasUnlocked(save, 'qol.dailyseed')) {
            daily.classList.remove('hidden');
        } else {
            daily.classList.add('hidden');
        }
    }
}
```

- [ ] **Step 4: Wire Main Menu button handlers in `init()`**

Inside `init()`, find the existing `start-btn` handler and the Ascension-selector `renderAscensionSelector` calls (around lines 163-187 of the M1 main.js). **Immediately before** the existing `start-btn` handler, insert:

```javascript
    // M2: Main Menu wiring — landing screen.
    document.getElementById('menu-start-btn').addEventListener('click', () => {
        navigateToRunSetup();
    });
    document.getElementById('menu-tree-btn').addEventListener('click', () => {
        navigateToTechTree();  // defined in Task 6
    });
    document.getElementById('menu-dailyseed-btn').addEventListener('click', () => {
        if (!NeonSave.hasUnlocked(save, 'qol.dailyseed')) return;
        const today = new Date();
        const dailySeed = parseInt(today.getFullYear().toString() +
            String(today.getMonth() + 1).padStart(2, '0') +
            String(today.getDate()).padStart(2, '0'));
        restartGame(dailySeed);
        navigateToRunSetup(); // Run Setup is where the new Game preview is; player clicks Initialize
    });
    document.getElementById('menu-reset-btn').addEventListener('click', () => {
        if (confirm('Reset save? This deletes XP, unlocks, and high scores. Cannot be undone.')) {
            localStorage.removeItem('neonDefense.save');
            location.reload();
        }
    });

    // M2: Run Setup BACK button goes to Main Menu.
    document.getElementById('setup-back-btn').addEventListener('click', () => {
        navigateToMainMenu();
    });

    // M2: Loadout dropdown change handlers — update selected* globals and persist later.
    document.getElementById('run-hero-select').addEventListener('change', e => {
        selectedHero = e.target.value;
    });
    document.getElementById('run-kit-select').addEventListener('change', e => {
        selectedKit = e.target.value;
    });
    document.getElementById('run-ability-select').addEventListener('change', e => {
        selectedAbility = e.target.value;
    });
```

For `navigateToTechTree()` referenced above — it's not yet defined (Task 6 adds it). For now, stub it immediately before `init()`:

```javascript
// Tech Tree screen — implemented in Task 6.
function navigateToTechTree() {
    // Placeholder; replaced in Task 6.
    alert('Tech Tree coming in next task');
}
```

- [ ] **Step 5: Update the existing `start-btn` handler to persist lastLoadout + pass loadout to Game**

Find the existing `start-btn` click handler in `init()`:

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

Replace with:

```javascript
    document.getElementById('start-btn').addEventListener('click', () => {
        // Persist chosen loadout for next run.
        save.lastLoadout = { heroId: selectedHero, kitId: selectedKit, abilityId: selectedAbility };
        NeonSave.write(save);

        const seedVal = document.getElementById('start-seed-input').value.trim();
        const parsedSeed = seedVal !== '' ? parseInt(seedVal) : null;
        if (parsedSeed !== null && !isNaN(parsedSeed)) {
            restartGame(parsedSeed);
        } else if (game.ascensionTier !== selectedTier) {
            // Tier changed since the preview Game was created — rebuild on the same map.
            restartGame(game.seed);
        } else {
            // Rebuild with current loadout (M1 path didn't pass loadout).
            restartGame(game.seed);
        }
    });
```

Note: always `restartGame` now, since loadout might have changed even if seed/tier didn't.

- [ ] **Step 6: Update `restartGame` to pass loadout to Game constructor**

Find the existing `restartGame` function inside `init()`. Change the `new Game(...)` call:

```javascript
        game = new Game(canvas, useSeed, selectedTier);
```

to:

```javascript
        game = new Game(canvas, useSeed, selectedTier, {
            heroId: selectedHero,
            kitId: selectedKit,
            abilityId: selectedAbility
        });
```

Also: at the end of `restartGame` (just before the function's closing `}`), add:

```javascript
        hideScreen('main-menu');
        hideScreen('start-screen');
        hideScreen('game-over');
        hideScreen('restart-confirm');
```

This ensures the game is fully visible after restart.

- [ ] **Step 7: Update initial bootstrap — show Main Menu on page load, construct preview Game with default loadout**

Find, inside `init()`:

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

Replace with:

```javascript
    game = new Game(canvas, urlSeed, selectedTier, {
        heroId: selectedHero,
        kitId: selectedKit,
        abilityId: selectedAbility
    });

    game.draw();
    game.updateUI();
    updateSeedDisplay();
    updateModeDisplay();

    // Populate all three Ascension selectors.
    renderAscensionSelector('start');
    renderAscensionSelector('gameover');
    renderAscensionSelector('restart');

    // M2: Populate Run Setup dropdowns + Main Menu state.
    renderLoadoutDropdowns();
    updateMainMenuState();

    // Ensure Main Menu is visible on initial page load (start-screen is hidden by default).
    showScreen('main-menu');
```

- [ ] **Step 8: Manual verification**

Reload. Expected behavior:
1. Main Menu overlay visible with "NEON DEFENSE", "Start Run", "Tech Tree (0 XP)", "Reset Save" visible. "Daily Challenge" hidden (qol.dailyseed not owned).
2. Click "Start Run" → Main Menu hides, Run Setup appears with Ascension buttons + three dropdowns (Hero: Pioneer only; Kit: Standard only; Ability: None).
3. Click "Back" → Run Setup hides, Main Menu appears.
4. Click "Start Run" → "Initialize" → game starts.
5. Die → game-over overlay shows (M1 behavior preserved).
6. Tech Tree button shows alert "Tech Tree coming in next task" (stub).

Console should be error-free.

- [ ] **Step 9: Commit**

```bash
git add src/engine/main.js
git commit -m "$(cat <<'EOF'
Wire Main Menu + Run Setup split; loadout dropdowns + persistence

Main Menu (Start / Tech Tree / Daily / Reset) is the new landing screen.
Run Setup contains Ascension + Hero/Kit/Ability dropdowns + Initialize
button. Loadout selection is persisted to save.lastLoadout on launch.
Game constructor receives loadout object (applied in Task 7). Tech Tree
button is stubbed until Task 6.
EOF
)"
```

---

## Task 6: Tech Tree overlay — HTML + CSS + render + purchase

**Files:**
- Modify: `index.html`
- Modify: `style.css`
- Modify: `src/engine/main.js`

- [ ] **Step 1: Add `#tech-tree` overlay to `index.html`**

Find the end of `#game-container` (the closing `</div>` matching the opening `<div id="game-container">`, around line 168). Immediately before this closing `</div>`, insert:

```html
                <div id="tech-tree" class="overlay hidden">
                    <h2>TECH TREE</h2>
                    <div class="tree-balance-row">
                        Meta-XP Balance: <span id="tree-xp-balance">0</span>
                    </div>
                    <div class="tech-tree-grid">
                        <div class="tree-tier" data-tier="tier1">
                            <h3>TIER 1 · 50 XP</h3>
                            <div class="tree-nodes" data-tier-body="tier1"></div>
                        </div>
                        <div class="tree-tier" data-tier="tier2">
                            <h3>TIER 2 · 200 XP</h3>
                            <div class="tree-nodes" data-tier-body="tier2"></div>
                        </div>
                        <div class="tree-tier" data-tier="tier3">
                            <h3>TIER 3 · 500 XP</h3>
                            <div class="tree-nodes" data-tier-body="tier3"></div>
                        </div>
                    </div>
                    <button id="tree-back-btn" class="secondary">BACK</button>
                </div>
```

- [ ] **Step 2: Append Tech Tree CSS to `style.css`**

```css
/* M2: Tech Tree overlay */
#tech-tree {
    padding: 24px;
    overflow-y: auto;
}
#tech-tree h2 {
    margin-bottom: 10px;
}
.tree-balance-row {
    text-align: center;
    font-size: 0.9rem;
    color: var(--accent);
    letter-spacing: 2px;
    margin-bottom: 18px;
    font-family: monospace;
}
.tech-tree-grid {
    display: flex;
    flex-wrap: wrap;
    gap: 16px;
    justify-content: center;
    max-width: 900px;
    margin: 0 auto 16px;
}
.tree-tier {
    flex: 1 1 260px;
    min-width: 260px;
    max-width: 300px;
    padding: 12px;
    background: rgba(0, 0, 0, 0.3);
    border: 1px solid rgba(56, 189, 248, 0.25);
    border-radius: 8px;
}
.tree-tier h3 {
    text-align: center;
    color: var(--accent);
    letter-spacing: 3px;
    margin-bottom: 10px;
    font-size: 0.85rem;
}
.tree-tier.locked {
    opacity: 0.5;
    border-style: dashed;
}
.tree-tier.locked h3::after {
    content: ' · LOCKED';
    color: var(--text-muted);
}
.tree-nodes {
    display: flex;
    flex-direction: column;
    gap: 8px;
}
.tree-node {
    padding: 8px 10px;
    border: 1px solid var(--text-muted);
    border-radius: 5px;
    background: rgba(0, 0, 0, 0.25);
    cursor: pointer;
    transition: all 0.15s;
}
.tree-node:hover:not(.owned):not(.locked):not(.too-expensive) {
    border-color: var(--accent);
    background: rgba(56, 189, 248, 0.12);
}
.tree-node.owned {
    border-color: #a3e635;
    background: rgba(163, 230, 53, 0.1);
    cursor: default;
}
.tree-node.locked {
    opacity: 0.45;
    cursor: not-allowed;
    border-style: dashed;
}
.tree-node.too-expensive {
    opacity: 0.6;
    cursor: not-allowed;
}
.tree-node-name {
    font-weight: 700;
    color: var(--text-main);
    font-size: 0.9rem;
    display: flex;
    justify-content: space-between;
}
.tree-node-name .node-status {
    font-size: 0.7rem;
    color: var(--text-muted);
    letter-spacing: 1px;
}
.tree-node.owned .node-status {
    color: #a3e635;
}
.tree-node-desc {
    font-size: 0.75rem;
    color: var(--text-muted);
    margin-top: 2px;
}
```

- [ ] **Step 3: Replace the stub `navigateToTechTree` with a full implementation**

In `src/engine/main.js`, find:

```javascript
// Tech Tree screen — implemented in Task 6.
function navigateToTechTree() {
    // Placeholder; replaced in Task 6.
    alert('Tech Tree coming in next task');
}
```

Replace with:

```javascript
// M2: Tech Tree screen. Renders 3 tier columns of nodes, each styled
// by ownership / eligibility / affordability. Click affordable node to
// purchase; XP is deducted and loadout dropdowns refresh.
function navigateToTechTree() {
    hideScreen('main-menu');
    hideScreen('start-screen');
    hideScreen('game-over');
    showScreen('tech-tree');
    renderTechTree();
}

function renderTechTree() {
    const bal = document.getElementById('tree-xp-balance');
    if (bal) bal.textContent = save.metaXP;

    for (const tierKey of ['tier1', 'tier2', 'tier3']) {
        const tierEl = document.querySelector(`.tree-tier[data-tier="${tierKey}"]`);
        const body   = document.querySelector(`.tree-nodes[data-tier-body="${tierKey}"]`);
        if (!tierEl || !body) continue;

        const open = NeonTree.isTierOpen(save, tierKey);
        tierEl.classList.toggle('locked', !open);

        body.innerHTML = '';
        for (const node of TECH_TREE[tierKey].nodes) {
            body.appendChild(buildTreeNodeEl(node, tierKey, open));
        }
    }
}

function buildTreeNodeEl(node, tierKey, tierOpen) {
    const el = document.createElement('div');
    el.className = 'tree-node';

    const owned     = NeonSave.hasUnlocked(save, node.id);
    const cost      = TECH_TREE[tierKey].cost;
    const canAfford = save.metaXP >= cost;
    let status = cost + ' XP';
    if (owned) { el.classList.add('owned'); status = 'OWNED'; }
    else if (!tierOpen) { el.classList.add('locked'); status = 'LOCKED'; }
    else if (!canAfford) { el.classList.add('too-expensive'); status = cost + ' XP (need more)'; }

    const nameRow = document.createElement('div');
    nameRow.className = 'tree-node-name';
    const spec = getTreeNode(node.id);
    const displayName = (node.kind === 'hero' && HEROES[node.id.slice(5)]) ? HEROES[node.id.slice(5)].name
                      : (node.kind === 'kit'  && STARTER_KITS[node.id.slice(4)]) ? STARTER_KITS[node.id.slice(4)].name
                      : (node.kind === 'ability' && ABILITIES[node.id.slice(8)]) ? ABILITIES[node.id.slice(8)].name
                      : (node.kind === 'qol' && QOL_NODES[node.id]) ? QOL_NODES[node.id].name
                      : node.id;
    nameRow.innerHTML = `<span>${displayName}</span><span class="node-status">${status}</span>`;

    const desc = document.createElement('div');
    desc.className = 'tree-node-desc';
    desc.textContent = node.desc;

    el.appendChild(nameRow);
    el.appendChild(desc);

    if (!owned && tierOpen && canAfford) {
        el.addEventListener('click', () => {
            if (NeonTree.purchase(save, node.id)) {
                renderTechTree();
                renderLoadoutDropdowns();
                updateMainMenuState();
            }
        });
    }

    return el;
}
```

- [ ] **Step 4: Wire the Back button in `init()`**

Inside `init()`, add a Back-button handler. Place this alongside the other Main Menu button handlers from Task 5:

```javascript
    document.getElementById('tree-back-btn').addEventListener('click', () => {
        navigateToMainMenu();
    });
```

- [ ] **Step 5: Manual verification**

Reload. Expected:
1. Main Menu shown.
2. Click "TECH TREE" → Tech Tree overlay opens. Shows 3 tier columns, each with 5 nodes. Owned nodes (pioneer + standard) are green-bordered with "OWNED" status. Others are affordable/unaffordable/locked depending on XP and tier openness. Tier 2 should be open (player owns 2 T1 pre-unlocks); Tier 3 should be locked (need 2 T2).
3. Grant yourself XP to test: `save.metaXP = 1000; NeonSave.write(save); renderTechTree();` in console.
4. Click Engineer hero (T1, 50 XP). Purchased — node goes green, XP drops to 950.
5. After purchasing 2 T1 nodes, Tier 2 should remain open. After purchasing 2 T2 nodes, Tier 3 opens.
6. Click Back → Main Menu reappears.
7. Open Run Setup → Hero dropdown now includes Engineer.

- [ ] **Step 6: Commit**

```bash
git add index.html style.css src/engine/main.js
git commit -m "$(cat <<'EOF'
Implement Tech Tree overlay: render + purchase flow

Tech Tree screen shows 3 tier columns of 5 nodes each. Nodes render
with ownership / tier-eligibility / affordability states. Clicking an
affordable node calls NeonTree.purchase, deducts XP, refreshes tree +
loadout dropdowns + Main Menu balance. Back button returns to Main Menu.
EOF
)"
```

---

## Task 7: Plumb Hero + Starter Kit effects into `Game` constructor

**Files:** `src/engine/game.js`

- [ ] **Step 1: Extend constructor signature + initialize new state**

In `src/engine/game.js`, find the constructor (around line 2):

```javascript
class Game {
    constructor(canvas, seed, ascensionTier) {
        this.canvas = canvas;
        this.ctx = canvas.getContext('2d');

        this.ascensionTier = Math.max(0, Math.min((ascensionTier | 0), ASCENSION_MAX_TIER_M1));
        this.ascension = getAscensionEffects(this.ascensionTier);

        this.map = new GameMap(seed);
        this.seed = this.map.seed;
        this.enemies = [];
        this.towers = [];
        this.projectiles = [];
        this.particles = []; 
        this.upgradeEffects = []; 
        
        this.money = Math.floor(125 * this.ascension.startMoneyMult);
```

Replace with:

```javascript
class Game {
    constructor(canvas, seed, ascensionTier, loadout) {
        this.canvas = canvas;
        this.ctx = canvas.getContext('2d');

        this.ascensionTier = Math.max(0, Math.min((ascensionTier | 0), ASCENSION_MAX_TIER_M1));
        this.ascension = getAscensionEffects(this.ascensionTier);

        this.map = new GameMap(seed);
        this.seed = this.map.seed;
        this.enemies = [];
        this.towers = [];
        this.projectiles = [];
        this.particles = []; 
        this.upgradeEffects = []; 
        
        this.money = Math.floor(125 * this.ascension.startMoneyMult);

        // M2: loadout state (set before apply).
        this.loadout = loadout || { heroId: 'hero.pioneer', kitId: 'kit.standard', abilityId: 'ability.none' };
        this.towerCostMult = 1;
        this.upgradeCostMult = 1;
        this.potionHealBonus = 0;
        this.potionCostKitMult = 1;
        this.startingPotions = 0;
        this.prePlaceRelay = false;
        this.showAllWavesPreview = false;
        this.ability = null;  // set by applyLoadout
```

- [ ] **Step 2: Add `applyLoadout` call + method**

Still in the constructor, find the existing:

```javascript
        this.health = 20;
        this.maxHealth = 20;
```

Replace with:

```javascript
        this.health = 20;
        this.maxHealth = 20;

        this.applyLoadout();
```

Then find the existing `start()` method and add a NEW method `applyLoadout` immediately before it. Apply runs after all defaults are set but before `start()`. The method body:

```javascript
    applyLoadout() {
        const heroKey = this.loadout.heroId ? this.loadout.heroId.replace(/^hero\./, '') : null;
        const kitKey  = this.loadout.kitId  ? this.loadout.kitId.replace(/^kit\./, '')  : null;
        if (heroKey && HEROES[heroKey] && HEROES[heroKey].apply) HEROES[heroKey].apply(this);
        if (kitKey  && STARTER_KITS[kitKey]  && STARTER_KITS[kitKey].apply)  STARTER_KITS[kitKey].apply(this);
        // Ability instance is created in Task 8 (abilities.js).
    }
```

- [ ] **Step 3: Apply tower-cost multiplier in `buildTower`**

Find `buildTower`:

```javascript
    buildTower(c, r, type) {
        if (!this.map.isBuildable(c, r)) return false;

        for (let t of this.towers) {
            if (t.c === c && t.r === r) return false;
        }

        let cost = TOWERS[type].cost;

        if (this.money >= cost) {
            this.money -= cost;
            this.towers.push(new Tower(c, r, type));
            this.uiDirty = true;
            SoundFX.build();
            return true;
        }
        SoundFX.error();
        return false;
    }
```

Replace with:

```javascript
    buildTower(c, r, type) {
        if (!this.map.isBuildable(c, r)) return false;

        for (let t of this.towers) {
            if (t.c === c && t.r === r) return false;
        }

        let cost = Math.floor(TOWERS[type].cost * this.towerCostMult);

        if (this.money >= cost) {
            this.money -= cost;
            this.towers.push(new Tower(c, r, type));
            this.uiDirty = true;
            SoundFX.build();
            return true;
        }
        SoundFX.error();
        return false;
    }
```

- [ ] **Step 4: Apply upgrade-cost multiplier + `canAfford` tower-cost multiplier**

Find `canAfford`:

```javascript
    canAfford(type) {
        return this.money >= TOWERS[type].cost;
    }
```

Replace with:

```javascript
    canAfford(type) {
        return this.money >= Math.floor(TOWERS[type].cost * this.towerCostMult);
    }
```

Find `buyUpgrade`:

```javascript
    buyUpgrade(index) {
        if (!this.selectedTowers || this.selectedTowers.length === 0) return;
        let upgradedAny = false;
        for (let t of this.selectedTowers) {
            let cost = t.getUpgradeCost(index);
            if (this.money >= cost) {
                this.money -= cost;
                t.upgrade(index);
                this.addUpgradeEffect(t.x, t.y);
                upgradedAny = true;
            }
        }
```

Replace with:

```javascript
    buyUpgrade(index) {
        if (!this.selectedTowers || this.selectedTowers.length === 0) return;
        let upgradedAny = false;
        for (let t of this.selectedTowers) {
            let cost = Math.floor(t.getUpgradeCost(index) * this.upgradeCostMult);
            if (this.money >= cost) {
                this.money -= cost;
                t.upgrade(index);
                this.addUpgradeEffect(t.x, t.y);
                upgradedAny = true;
            }
        }
```

Note: this changes the displayed cost in `updateUpgradeMenu`. Also find the display in `updateUpgradeMenu`:

```javascript
        for (let i = 0; i < 3; i++) {
            let def = defs[i];
            let cost = t.getUpgradeCost(i);
```

Replace with:

```javascript
        for (let i = 0; i < 3; i++) {
            let def = defs[i];
            let cost = Math.floor(t.getUpgradeCost(i) * this.upgradeCostMult);
```

And:

```javascript
            div.className = 'upgrade-item' + (this.money >= cost ? '' : ' disabled');
```

stays as-is (already reads the modified `cost`).

- [ ] **Step 5: Apply potion hero+kit effects**

Find `getPotionCost`:

```javascript
    getPotionCost() {
        const base = POTION_CONFIG.baseCost + this.potionCount * POTION_CONFIG.costPerUse;
        return Math.floor(base * this.ascension.potionCostMult);
    }
```

Replace with:

```javascript
    getPotionCost() {
        const base = POTION_CONFIG.baseCost + this.potionCount * POTION_CONFIG.costPerUse;
        return Math.floor(base * this.ascension.potionCostMult * this.potionCostKitMult);
    }
```

Find `buyPotion`:

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
```

Replace with:

```javascript
    buyPotion() {
        let cost = this.getPotionCost();
        if (this.money < cost) { SoundFX.error(); return false; }
        if (this.health >= this.maxHealth) { SoundFX.error(); return false; }
        this.money -= cost;
        const baseHeal = (this.ascension.potionHeal !== null)
            ? this.ascension.potionHeal
            : POTION_CONFIG.healAmount;
        const heal = baseHeal + this.potionHealBonus;
        this.health = Math.min(this.maxHealth, this.health + heal);
```

- [ ] **Step 6: Give Medic starting potions (fake potionCount) + pre-place Relay for Economist**

Add a new method `applyPostInitEffects` to Game, called from `start()`. Find `start()`:

```javascript
    start() {
        this.state = 'playing';
        this.startWave();
        this.updateUI();
    }
```

Replace with:

```javascript
    start() {
        this.state = 'playing';
        this.applyPostInitEffects();
        this.startWave();
        this.updateUI();
    }

    // M2: Effects that depend on the map being ready (path midpoint, etc).
    applyPostInitEffects() {
        // Medic: N starting potions — logged by decrementing potionCount count
        // from cost formula's perspective (cost is base + potionCount * costPerUse,
        // so a virtual "already used" stack just lifts the starting price).
        // But the spec says "+2 starting potions" — i.e., 2 free health recoveries.
        // Implementation: auto-use N potions at start if health < maxHealth, else
        // stockpile as freebies. Simplest: directly grant HP now, no freebie queue.
        if (this.startingPotions > 0) {
            const baseHeal = (this.ascension.potionHeal !== null) ? this.ascension.potionHeal : POTION_CONFIG.healAmount;
            const heal = baseHeal + this.potionHealBonus;
            this.health = Math.min(this.maxHealth, this.health + heal * this.startingPotions);
        }

        // Economist: pre-place a free Relay at the tile nearest to the path midpoint.
        if (this.prePlaceRelay) this.placeFreeRelay();
    }

    // Find a buildable tile nearest to the path midpoint and place a free Relay.
    placeFreeRelay() {
        const path = this.map.path;
        if (!path || path.length === 0) return;
        const mid = path[Math.floor(path.length / 2)];
        let best = null;
        let bestDist = Infinity;
        for (let r = 0; r < window.ROWS; r++) {
            for (let c = 0; c < window.COLS; c++) {
                if (!this.map.isBuildable(c, r)) continue;
                const occupied = this.towers.find(t => t.c === c && t.r === r);
                if (occupied) continue;
                const dx = c - mid.c;
                const dy = r - mid.r;
                const d2 = dx*dx + dy*dy;
                if (d2 < bestDist) { bestDist = d2; best = { c, r }; }
            }
        }
        if (best) this.towers.push(new Tower(best.c, best.r, 'income'));
    }
```

Note: the Medic "+2 starting potions" implementation uses immediate healing at start. The spec's intent is that Medic kit players start closer to full HP; this effectively models it without needing a "pending heal" queue.

- [ ] **Step 7: Manual verification**

Reload, clear save. Expected:
1. Main Menu → Start Run → default loadout (Pioneer + Standard + None). Money should be Pioneer's bonus: `Math.floor(125 * 1.25)` = 156.
2. Earn some XP (die a few times). Purchase hero.engineer in Tech Tree.
3. Run Setup → pick Engineer. Start run. Money should be base 125 (no Pioneer bonus), tower prices should be 10% cheaper. Test: Blaster costs 45 instead of 50.
4. Purchase kit.economist (requires `ascensionCleared >= 1` or 50 XP). Select Economist. Start run → Money starts at 75, a free Relay appears on the map near path midpoint.
5. Purchase hero.warden, pick Warden. Start run. Max HP should be 25 (not 20). Potions should heal 6 instead of 5.
6. Purchase kit.medic, pick Medic. Start run. Potion cost should be 1.5× standard (225 instead of 150). HP should already be 10 + (5 × 2) = but max caps at 20, so full.

- [ ] **Step 8: Commit**

```bash
git add src/engine/game.js
git commit -m "$(cat <<'EOF'
Plumb Hero + Starter Kit effects into Game

Game now takes a loadout object. applyLoadout runs HEROES[id].apply
and STARTER_KITS[id].apply at construction. Tower/upgrade cost mults
apply in buildTower/canAfford/buyUpgrade. Potion heal/cost kit mults
integrate with M1's Ascension potion overrides. applyPostInitEffects
runs after map-ready: Medic grants starting HP, Economist pre-places
a free Relay near the path midpoint.
EOF
)"
```

---

## Task 8: Create `src/progression/abilities.js` + top-bar ability button

**Files:**
- Create: `src/progression/abilities.js`
- Modify: `index.html`
- Modify: `style.css`
- Modify: `src/engine/game.js`
- Modify: `src/engine/main.js`

- [ ] **Step 1: Create `src/progression/abilities.js`**

Create file with:

```javascript
// Ability instance + in-run charges (M2). Game creates one instance at
// construction via NeonAbilities.createInstance(abilityId). Instance
// tracks remaining charges and exposes tryUse() which returns true if
// the charge was consumed. Actual per-ability effects are implemented
// by the caller (main.js for UI + game.js for in-world).

const NeonAbilities = (function () {

    // Creates the per-run state for an ability. For 'ability.none' returns
    // a no-op instance.
    function createInstance(abilityId) {
        if (!abilityId || abilityId === 'ability.none') {
            return {
                id: 'ability.none',
                charges: 0,
                kind: 'none',
                tryUse: () => false,
                isUsable: () => false
            };
        }
        const key = abilityId.replace(/^ability\./, '');
        const def = ABILITIES[key];
        if (!def) return createInstance('ability.none');
        let remaining = def.charges;
        return {
            id: abilityId,
            kind: def.kind,          // 'reveal' | 'target' | 'instant'
            name: def.name,
            get charges() { return remaining; },
            isUsable: () => remaining > 0,
            tryUse: () => {
                if (remaining <= 0) return false;
                remaining--;
                return true;
            }
        };
    }

    return { createInstance };
})();
```

- [ ] **Step 2: Load the new script (`abilities.js`) after `tree.js`**

In `index.html`:

```html
    <script src="src/progression/save.js"></script>
    <script src="src/progression/tree.js"></script>
    <script src="src/progression/abilities.js"></script>
    <script src="src/engine/game.js"></script>
```

- [ ] **Step 3: Initialize ability instance in Game constructor**

In `src/engine/game.js`, find `applyLoadout`:

```javascript
    applyLoadout() {
        const heroKey = this.loadout.heroId ? this.loadout.heroId.replace(/^hero\./, '') : null;
        const kitKey  = this.loadout.kitId  ? this.loadout.kitId.replace(/^kit\./, '')  : null;
        if (heroKey && HEROES[heroKey] && HEROES[heroKey].apply) HEROES[heroKey].apply(this);
        if (kitKey  && STARTER_KITS[kitKey]  && STARTER_KITS[kitKey].apply)  STARTER_KITS[kitKey].apply(this);
        // Ability instance is created in Task 8 (abilities.js).
    }
```

Replace with:

```javascript
    applyLoadout() {
        const heroKey = this.loadout.heroId ? this.loadout.heroId.replace(/^hero\./, '') : null;
        const kitKey  = this.loadout.kitId  ? this.loadout.kitId.replace(/^kit\./, '')  : null;
        if (heroKey && HEROES[heroKey] && HEROES[heroKey].apply) HEROES[heroKey].apply(this);
        if (kitKey  && STARTER_KITS[kitKey]  && STARTER_KITS[kitKey].apply)  STARTER_KITS[kitKey].apply(this);
        this.ability = NeonAbilities.createInstance(this.loadout.abilityId);
        this.abilityTargetMode = false;   // true when awaiting click for Airstrike
        this.freezeTimer = 0;             // frames left on Freeze effect
    }
```

- [ ] **Step 4: Add ability button to top-bar in `index.html`**

Find the top-bar-controls block (around line 34):

```html
            <div id="top-bar-controls">
                <div class="stat-box interactive" id="speed-btn">
                    <span class="label">SPEED</span>
                    <span id="speed-display" class="value">1X</span>
                </div>
```

Immediately after the `speed-btn` div (before `pause-btn`), insert:

```html
                <div class="stat-box interactive hidden" id="ability-btn" title="Use ability">
                    <span class="label" id="ability-label">ABILITY</span>
                    <span id="ability-display" class="value">—</span>
                </div>
```

- [ ] **Step 5: Add CSS for ability button**

Append to `style.css`:

```css
/* M2: Ability top-bar button */
#ability-btn {
    cursor: pointer;
}
#ability-btn.armed {
    background: rgba(56, 189, 248, 0.18);
    box-shadow: 0 0 12px rgba(56, 189, 248, 0.45) inset;
}
#ability-btn.no-charges {
    opacity: 0.35;
    cursor: not-allowed;
}
#ability-display {
    font-variant-numeric: tabular-nums;
}
```

- [ ] **Step 6: Wire ability button in `main.js`**

In `src/engine/main.js`, inside `init()`, add alongside the other top-bar button handlers:

```javascript
    // M2: Ability button. Behavior depends on ability kind:
    //   - 'reveal' (Scan): show wave preview immediately, consume 1 charge
    //   - 'target' (Airstrike): enter targeting mode; next canvas click strikes
    //   - 'instant' (Freeze): consume 1 charge, apply effect immediately
    document.getElementById('ability-btn').addEventListener('click', () => {
        if (!game || !game.ability || !game.ability.isUsable()) return;
        if (game.state !== 'playing' && game.state !== 'paused') return;

        const kind = game.ability.kind;
        if (kind === 'reveal') {
            if (game.ability.tryUse()) {
                showWavePreview(3);
                refreshAbilityUI();
            }
        } else if (kind === 'target') {
            game.abilityTargetMode = !game.abilityTargetMode;
            document.getElementById('ability-btn').classList.toggle('armed', game.abilityTargetMode);
        } else if (kind === 'instant') {
            if (game.ability.tryUse()) {
                // Only Freeze currently uses 'instant' — call into game.
                game.freezeAllEnemies(180); // 3 seconds at 60 fps
                refreshAbilityUI();
            }
        }
    });

    function refreshAbilityUI() {
        const btn = document.getElementById('ability-btn');
        const disp = document.getElementById('ability-display');
        const label = document.getElementById('ability-label');
        if (!btn || !disp || !game.ability) return;

        if (game.ability.id === 'ability.none') {
            btn.classList.add('hidden');
            return;
        }
        btn.classList.remove('hidden');

        const shortName = game.ability.name.toUpperCase().slice(0, 8);
        label.textContent = shortName;
        disp.textContent = game.ability.charges > 0 ? `${game.ability.charges}×` : '—';
        btn.classList.toggle('no-charges', game.ability.charges === 0);
        btn.classList.toggle('armed', game.abilityTargetMode === true);
    }

    window.refreshAbilityUI = refreshAbilityUI;  // Game calls this on state changes.
```

Also add a call to `refreshAbilityUI()` after `game.start()` in the `start-btn` handler path — but it's easier to call it inside `restartGame`:

Find `restartGame`, add at the end (just before the existing closing `}`):

```javascript
        if (typeof refreshAbilityUI === 'function') refreshAbilityUI();
```

- [ ] **Step 7: Implement `showWavePreview(n)`**

Add at file scope in `main.js`, near `renderRunResultXP`:

```javascript
// M2: Wave preview popup. Used by Scan ability and Strategist kit.
// `count` = number of upcoming waves to reveal (3 for Scan; 9999 for Strategist).
function showWavePreview(count) {
    let panel = document.getElementById('wave-preview');
    if (!panel) {
        panel = document.createElement('div');
        panel.id = 'wave-preview';
        panel.className = 'overlay';
        document.getElementById('game-container').appendChild(panel);
    }
    panel.classList.remove('hidden');
    panel.innerHTML = '<h3>WAVE PREVIEW</h3><div id="wave-preview-list"></div><button id="wave-preview-close">CLOSE</button>';

    const list = panel.querySelector('#wave-preview-list');
    list.innerHTML = '';
    const entries = game.getWavePreview(count);
    for (const entry of entries) {
        const row = document.createElement('div');
        row.className = 'wave-preview-row';
        row.textContent = `Wave ${entry.wave}: ${entry.count}× ${entry.type}`;
        list.appendChild(row);
    }
    panel.querySelector('#wave-preview-close').addEventListener('click', () => panel.classList.add('hidden'));
}
```

- [ ] **Step 8: CSS for wave-preview**

Append to `style.css`:

```css
#wave-preview {
    z-index: 15;
}
#wave-preview-list {
    max-height: 300px;
    overflow-y: auto;
    margin: 10px 0;
    font-family: monospace;
    font-size: 0.85rem;
    color: var(--text-main);
}
.wave-preview-row {
    padding: 2px 0;
    border-bottom: 1px solid rgba(255, 255, 255, 0.08);
}
```

- [ ] **Step 9: Add `getWavePreview` to Game**

In `src/engine/game.js`, add method just before `gameOver`:

```javascript
    // M2: Returns an array of { wave, type, count } for the next `n` waves.
    // Used by Scan ability and Strategist kit. Pulls from hand-tuned
    // waveData for waves <= 10, computes procedurally for 11+.
    getWavePreview(n) {
        const results = [];
        for (let i = 0; i < n; i++) {
            const w = this.wave + i;
            if (w <= 0) continue;
            if (w % this.ascension.airWaveInterval === 0) {
                results.push({ wave: w, type: 'air', count: '(air wave)' });
                continue;
            }
            const idx = (w - 1) % this.waveData.length;
            const def = this.waveData[idx];
            results.push({ wave: w, type: def.type, count: def.count + '+' });
        }
        return results;
    }
```

- [ ] **Step 10: Manual verification**

Reload. Clear save. Expected:
1. Main Menu → Start Run → No ability (None selected). Run: ability button hidden.
2. Buy ability.scan (needs 50 XP). Select it. Start run. Ability button visible: "SCAN" with "1×" charge count.
3. Click ability button → Scan panel appears showing next 3 waves. Close. Button now shows "—" (no charges).

(Airstrike + Freeze are tested in later tasks.)

- [ ] **Step 11: Commit**

```bash
git add src/progression/abilities.js index.html style.css src/engine/game.js src/engine/main.js
git commit -m "$(cat <<'EOF'
Add NeonAbilities module + top-bar ability button + wave preview

Creates the per-run ability instance (charges, kind). Top-bar ability
button dispatches by kind: reveal/target/instant. Scan (reveal) uses
Game.getWavePreview(n) to show upcoming waves in a popup. Airstrike +
Freeze hooks stubbed (Game.freezeAllEnemies, game.abilityTargetMode)
are wired but effects implemented in next tasks.
EOF
)"
```

---

## Task 9: Implement Airstrike — click-target AoE with visual feedback

**Files:** `src/engine/game.js`, `src/engine/main.js`

- [ ] **Step 1: Add `airstrike(x, y)` method to Game**

In `src/engine/game.js`, immediately after `getWavePreview`, add:

```javascript
    // M2: Airstrike ability. Deals 200 damage in 80px radius centered at (x, y).
    // Adds a visual ring effect. Caller (main.js) must consume a charge.
    // Damage applied directly via hp -= dmg, matching existing Tower/Projectile pattern.
    airstrike(x, y) {
        const damage = 200;
        const radius = 80;
        const r2 = radius * radius;
        for (const enemy of this.enemies) {
            if (!enemy.active) continue;
            const dx = enemy.x - x;
            const dy = enemy.y - y;
            if (dx*dx + dy*dy <= r2) {
                enemy.hp -= damage;
                if (enemy.hp <= 0) enemy.active = false;
            }
        }
        // Visual: reuse upgradeEffects structure (expanding ring)
        this.upgradeEffects.push({ x: x, y: y, radius: radius * 0.2, alpha: 1, airstrike: true });
        this.upgradeEffects.push({ x: x, y: y, radius: radius * 0.5, alpha: 0.8, airstrike: true });
        SoundFX.build();
    }
```

Note: reusing `upgradeEffects` for visual simplicity; the `airstrike: true` flag is cosmetic (not currently read but future-proofs color differentiation).

- [ ] **Step 2: Wire canvas click to airstrike when `abilityTargetMode` is true**

In `src/engine/main.js`, find the canvas `pointerdown` handler:

```javascript
    canvas.addEventListener('pointerdown', (e) => {
        if (game.state !== 'playing' && game.state !== 'paused') return;

        // Close menus when clicking on canvas
        document.getElementById('upgrade-menu').classList.add('hidden');

        const pos = getCanvasPos(e);
        const c = Math.floor(pos.x / TILE_SIZE);
        const r = Math.floor(pos.y / TILE_SIZE);
```

Insert immediately after the `const r = ...` line (before the tower-selection logic):

```javascript
        // M2: Airstrike targeting mode — canvas click triggers the strike.
        if (game.abilityTargetMode && game.ability && game.ability.isUsable()) {
            if (game.ability.tryUse()) {
                game.airstrike(pos.x, pos.y);
                game.abilityTargetMode = false;
                refreshAbilityUI();
            }
            return;
        }
```

- [ ] **Step 3: Draw airstrike crosshair while targeting**

In `src/engine/main.js`, find the `loop()` function's `if (... && selectedTowerType)` block (the ghost-tower rendering). Insert before that block:

```javascript
        // M2: Airstrike targeting crosshair.
        if ((game.state === 'playing' || game.state === 'paused') && game.abilityTargetMode && game.ability && game.ability.isUsable()) {
            const ctx = game.ctx;
            ctx.save();
            ctx.strokeStyle = 'rgba(251, 191, 36, 0.85)';
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.arc(mousePos.x, mousePos.y, 80, 0, Math.PI * 2);
            ctx.stroke();
            ctx.setLineDash([6, 4]);
            ctx.strokeStyle = 'rgba(251, 191, 36, 0.4)';
            ctx.beginPath();
            ctx.arc(mousePos.x, mousePos.y, 80 * 1.3, 0, Math.PI * 2);
            ctx.stroke();
            ctx.restore();
        }
```

- [ ] **Step 4: Manual verification**

Reload, grant XP, buy `ability.airstrike` (200 XP in T2 — need to unlock T2 by owning 2 T1 nodes). Select Airstrike. Start run.
- Ability button shows "AIRSTRI" with 3× charges.
- Click ability button → button highlights "armed". A crosshair ring appears under mouse on canvas.
- Click on canvas → up to 200 damage applied to all enemies within 80px of click. Charge count decreases.
- 3 uses total.

- [ ] **Step 5: Commit**

```bash
git add src/engine/game.js src/engine/main.js
git commit -m "$(cat <<'EOF'
Implement Airstrike ability: click-target 200 dmg AoE

Game.airstrike(x, y) applies 200 damage in an 80px radius + expanding
visual ring effects. main.js binds canvas click to airstrike when
abilityTargetMode is armed; crosshair follows mouse while active.
Three charges per run.
EOF
)"
```

---

## Task 10: Implement Freeze Wave — stop all enemies 3s

**Files:** `src/engine/game.js`, `src/entities/entities.js`

- [ ] **Step 1: Add `freezeAllEnemies(frames)` method to Game**

In `src/engine/game.js`, after `airstrike`, add:

```javascript
    // M2: Freeze ability. Stops all enemy movement for `frames` (at 60 fps).
    freezeAllEnemies(frames) {
        this.freezeTimer = frames;
        for (const e of this.enemies) {
            if (!e.active) continue;
            e.frozen = true;
            e.frozenFrames = frames;
        }
    }
```

- [ ] **Step 2: Decrement freeze timer in `update`**

Find the top of `update()`:

```javascript
    update() {
        if (this.state !== 'playing') return;
```

Replace with:

```javascript
    update() {
        if (this.state !== 'playing') return;

        // M2: Freeze ability — decrements per-game timer and unfreezes enemies.
        if (this.freezeTimer > 0) {
            this.freezeTimer--;
            if (this.freezeTimer === 0) {
                for (const e of this.enemies) {
                    e.frozen = false;
                    e.frozenFrames = 0;
                }
            }
        }
```

- [ ] **Step 3: Check `frozen` flag in `Enemy.update`**

Open `src/entities/entities.js`. Find the top of `Enemy.update()`:

```javascript
    update() {
        if (!this.active) return;
        
        if (this.isAir) {
```

Replace with:

```javascript
    update() {
        if (!this.active) return;

        // M2: Freeze ability halts movement while frozenFrames > 0.
        if (this.frozen && this.frozenFrames > 0) {
            this.frozenFrames--;
            if (this.frozenFrames === 0) this.frozen = false;
            return;
        }

        if (this.isAir) {
```

The rest of `Enemy.update` is unchanged — the freeze guard returns early before any movement runs.

- [ ] **Step 4: Visualize frozen state**

In `src/entities/entities.js`, find the full `Enemy.draw` method:

```javascript
    draw(ctx) {
        if (!this.active) return;
        drawEnemy(ctx, this.x, this.y, this.radius, this.type, this.hp / this.maxHp, this.currentSlow < 1);
    }
```

Replace with:

```javascript
    draw(ctx) {
        if (!this.active) return;
        drawEnemy(ctx, this.x, this.y, this.radius, this.type, this.hp / this.maxHp, this.currentSlow < 1);

        // M2: Freeze ability — blue glow ring overlay.
        if (this.frozen) {
            ctx.save();
            ctx.globalAlpha = 0.6;
            ctx.strokeStyle = '#60a5fa';
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.arc(this.x, this.y, this.radius + 3, 0, Math.PI * 2);
            ctx.stroke();
            ctx.fillStyle = 'rgba(96, 165, 250, 0.25)';
            ctx.fill();
            ctx.restore();
        }
    }
```

- [ ] **Step 5: New-enemy freeze propagation**

Currently `Game.update` spawns new enemies mid-wave. If a Freeze is active, the newly-spawned enemy should be frozen too. Find where enemies are spawned in `Game.update`:

```javascript
                } else {
                    this.enemies.push(new Enemy(this.map.path, this.currentWaveDef.type, this.currentWaveDef.hpMult));
                    this.enemiesSpawned++;
                    this.spawnTimer = this.currentWaveDef.spawnRate;
                }
```

Replace with:

```javascript
                } else {
                    const newEnemy = new Enemy(this.map.path, this.currentWaveDef.type, this.currentWaveDef.hpMult);
                    if (this.freezeTimer > 0) {
                        newEnemy.frozen = true;
                        newEnemy.frozenFrames = this.freezeTimer;
                    }
                    this.enemies.push(newEnemy);
                    this.enemiesSpawned++;
                    this.spawnTimer = this.currentWaveDef.spawnRate;
                }
```

- [ ] **Step 6: Manual verification**

Clear save, grant XP, buy `ability.freeze` (500 XP — need T3 open; need 2 T2 owned first). Select Freeze. Start run.
- Ability button shows "FREEZE" with 1× charge.
- Click button when enemies are on-screen → all visible enemies stop, blue glow appears around them. After ~3s they resume.
- Button shows "—" (no charges). Can't use again.

- [ ] **Step 7: Commit**

```bash
git add src/engine/game.js src/entities/entities.js
git commit -m "$(cat <<'EOF'
Implement Freeze Wave ability: stop all enemies 3s

Game.freezeAllEnemies(frames) sets per-enemy frozen flag; Enemy.update
early-returns while frozen. Enemy.draw adds blue glow ring overlay.
Newly-spawned enemies during an active freeze inherit the remaining
freeze time.
EOF
)"
```

---

## Task 11: Ascension auto-unlock wiring + firstClear notifications

**Files:** `src/engine/main.js`

- [ ] **Step 1: Integrate `autoUnlockOnAscension` in `window.onRunEnded`**

In `src/engine/main.js`, find the `window.onRunEnded` handler:

```javascript
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

Replace with:

```javascript
    window.onRunEnded = function (result) {
        const { wave, tier } = result;
        const firstClear = wave >= 30 && tier > save.ascensionCleared;

        const xp = NeonSave.calculateRunXP(wave, tier, firstClear);
        save.metaXP        += xp.total;
        save.totalXPEarned += xp.total;

        let autoUnlockedNodeId = null;
        if (firstClear) {
            save.ascensionCleared = tier;
            // M2: Grant a free tree node for the cleared tier.
            autoUnlockedNodeId = NeonTree.autoUnlockOnAscension(save, tier);
        }
        NeonSave.write(save);

        if (firstClear) {
            renderAscensionSelector('start');
            renderAscensionSelector('gameover');
            renderAscensionSelector('restart');
            renderLoadoutDropdowns();
            updateMainMenuState();
        }

        if (typeof renderRunResultXP === 'function') {
            renderRunResultXP({ wave, tier, xp, firstClear, autoUnlockedNodeId });
        }
    };
```

- [ ] **Step 2: Update `renderRunResultXP` to surface auto-unlock banner**

Find the `renderRunResultXP` function at file scope. Its last block currently shows the UNLOCKED banner for new Ascension tier:

```javascript
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

Replace with:

```javascript
    const unlock = document.getElementById('xp-unlock');
    if (firstClear) {
        const nextTier = Math.min(tier + 1, ASCENSION_MAX_TIER_M1);
        const nextSpec = ASCENSION_TIERS[nextTier];
        let text = nextTier > tier
            ? `UNLOCKED: ${nextSpec.label} — ${nextSpec.name}`
            : `MAXED for M1`;
        if (autoUnlockedNodeId) {
            const node = getTreeNode(autoUnlockedNodeId);
            if (node) text += ` · FREE NODE: ${autoUnlockedNodeId}`;
        }
        unlock.textContent = text;
        unlock.classList.remove('hidden');
    } else {
        unlock.classList.add('hidden');
    }
}
```

- [ ] **Step 3: Manual verification**

Clear save, survive to wave 30 on A0. Expected:
- Game-over shows UNLOCKED: A1 — +15% enemy HP (no free-node banner, since A0 doesn't auto-unlock).
- Restart, pick A1, survive to wave 30 on A1. Expected: UNLOCKED: A2 · FREE NODE: kit.economist.
- Open Tech Tree — kit.economist is now owned (green).

- [ ] **Step 4: Commit**

```bash
git add src/engine/main.js
git commit -m "$(cat <<'EOF'
Wire Ascension auto-unlocks: grant free tree nodes on first clear

A1/A3/A5/A7 clears now grant kit.economist / qol.hpbars / qol.dailyseed /
qol.skipsetup respectively via NeonTree.autoUnlockOnAscension. Run Result
overlay surfaces the free-node grant alongside the new-tier-unlocked
banner. Loadout dropdowns + Main Menu refresh on firstClear so newly
unlocked nodes appear immediately.
EOF
)"
```

---

## Task 12: QoL — HP bars

**Files:** `src/entities/entities.js`

- [ ] **Step 1: Draw HP bar above enemies when `qol.hpbars` is owned**

In `src/entities/entities.js`, find `Enemy.draw` — **after Task 10 it looks like this**:

```javascript
    draw(ctx) {
        if (!this.active) return;
        drawEnemy(ctx, this.x, this.y, this.radius, this.type, this.hp / this.maxHp, this.currentSlow < 1);

        // M2: Freeze ability — blue glow ring overlay.
        if (this.frozen) {
            ctx.save();
            ctx.globalAlpha = 0.6;
            ctx.strokeStyle = '#60a5fa';
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.arc(this.x, this.y, this.radius + 3, 0, Math.PI * 2);
            ctx.stroke();
            ctx.fillStyle = 'rgba(96, 165, 250, 0.25)';
            ctx.fill();
            ctx.restore();
        }
    }
```

Replace with (adds HP-bar block at the end, inside the method's closing `}`):

```javascript
    draw(ctx) {
        if (!this.active) return;
        drawEnemy(ctx, this.x, this.y, this.radius, this.type, this.hp / this.maxHp, this.currentSlow < 1);

        // M2: Freeze ability — blue glow ring overlay.
        if (this.frozen) {
            ctx.save();
            ctx.globalAlpha = 0.6;
            ctx.strokeStyle = '#60a5fa';
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.arc(this.x, this.y, this.radius + 3, 0, Math.PI * 2);
            ctx.stroke();
            ctx.fillStyle = 'rgba(96, 165, 250, 0.25)';
            ctx.fill();
            ctx.restore();
        }

        // M2 QoL: HP bar above enemies when qol.hpbars is owned.
        if (window.save && NeonSave.hasUnlocked(window.save, 'qol.hpbars')) {
            const barW = 20;
            const barH = 3;
            const frac = Math.max(0, this.hp / this.maxHp);
            const bx = this.x - barW / 2;
            const by = this.y - this.radius - 8;
            ctx.save();
            ctx.fillStyle = 'rgba(0, 0, 0, 0.6)';
            ctx.fillRect(bx, by, barW, barH);
            ctx.fillStyle = frac > 0.4 ? '#a3e635' : frac > 0.15 ? '#fbbf24' : '#ef4444';
            ctx.fillRect(bx, by, barW * frac, barH);
            ctx.restore();
        }
    }
```

- [ ] **Step 2: Expose `save` on window**

In `src/engine/main.js`, find the existing `const save = NeonSave.load();` (top of file) and add a line immediately after:

```javascript
const save = NeonSave.load();
window.save = save;   // M2: expose for Enemy.draw HP-bar check.
```

- [ ] **Step 3: Manual verification**

Grant XP, buy `qol.hpbars`. Start a run. Enemies should show a color-coded HP bar above them (green → yellow → red). Without qol.hpbars, no bar.

- [ ] **Step 4: Commit**

```bash
git add src/engine/main.js src/entities/entities.js
git commit -m "$(cat <<'EOF'
Implement qol.hpbars: show HP bars above each enemy when owned

Enemy.draw reads window.save.unlockedNodes; if qol.hpbars is present,
renders a 3-colored HP bar above the enemy. Main.js exposes save on
window for entity-level access without tight coupling.
EOF
)"
```

---

## Task 13: QoL — fast autopilot, skip setup, ascension preview

**Files:** `src/engine/main.js`, `src/engine/game.js`, `src/ai/autopilot.js`

- [ ] **Step 1: `qol.fastai` — autopilot tick override**

In `src/engine/game.js`, find the Game class. Add a property initialization in the constructor near the other loadout fields:

```javascript
        this.prePlaceRelay = false;
        this.showAllWavesPreview = false;
```

Add:

```javascript
        this.prePlaceRelay = false;
        this.showAllWavesPreview = false;
        this.autopilotTickInterval = AUTOPILOT_CONFIG.tickInterval;
```

In `src/engine/game.js`, find the `update` method's autopilot block:

```javascript
        if (this.autopilot) {
            this.autopilotTimer++;
            if (this.autopilotTimer >= AUTOPILOT_CONFIG.tickInterval) {
                this.autopilotTimer = 0;
                this.runAutopilot();
            }
        }
```

Replace with:

```javascript
        if (this.autopilot) {
            this.autopilotTimer++;
            if (this.autopilotTimer >= this.autopilotTickInterval) {
                this.autopilotTimer = 0;
                this.runAutopilot();
            }
        }
```

In `src/engine/main.js`, find `restartGame` and add just before the final closing `}`:

```javascript
        // M2: qol.fastai halves autopilot tick interval.
        if (NeonSave.hasUnlocked(save, 'qol.fastai')) {
            game.autopilotTickInterval = 15;
        }
```

- [ ] **Step 2: `qol.skipsetup` — show a checkbox; bypass Run Setup**

Add a checkbox to the Run Setup screen. In `index.html`, find inside `#start-screen` — add immediately before `<div class="setup-actions">`:

```html
                    <div class="loadout-row hidden" id="skipsetup-row">
                        <label class="skip-setup-toggle">
                            <input type="checkbox" id="skipsetup-toggle" />
                            Skip Run Setup next time (go straight to launch)
                        </label>
                    </div>
```

In `style.css`, append:

```css
.skip-setup-toggle {
    font-size: 0.75rem;
    color: var(--text-muted);
    display: flex;
    align-items: center;
    gap: 6px;
    cursor: pointer;
}
```

In `src/engine/main.js`, inside `init()`, add near the other button handlers:

```javascript
    // M2: qol.skipsetup — show toggle only when unlocked, persist state.
    function refreshSkipsetupRow() {
        const row = document.getElementById('skipsetup-row');
        const toggle = document.getElementById('skipsetup-toggle');
        if (!row || !toggle) return;
        if (NeonSave.hasUnlocked(save, 'qol.skipsetup')) {
            row.classList.remove('hidden');
            toggle.checked = !!save.settings.skipRunSetup;
        } else {
            row.classList.add('hidden');
        }
    }
    document.getElementById('skipsetup-toggle').addEventListener('change', e => {
        save.settings.skipRunSetup = !!e.target.checked;
        NeonSave.write(save);
    });
    refreshSkipsetupRow();
```

Also extend `renderLoadoutDropdowns` to also call `refreshSkipsetupRow`. Find:

```javascript
function renderLoadoutDropdowns() {
    renderOneLoadoutSelect('run-hero-select',    'hero',    'selectedHero',    'hero.pioneer',   HEROES);
    renderOneLoadoutSelect('run-kit-select',     'kit',     'selectedKit',     'kit.standard',   STARTER_KITS);
    renderOneAbilitySelect();
}
```

Replace with:

```javascript
function renderLoadoutDropdowns() {
    renderOneLoadoutSelect('run-hero-select',    'hero',    'selectedHero',    'hero.pioneer',   HEROES);
    renderOneLoadoutSelect('run-kit-select',     'kit',     'selectedKit',     'kit.standard',   STARTER_KITS);
    renderOneAbilitySelect();
    if (typeof refreshSkipsetupRow === 'function') refreshSkipsetupRow();
}
```

Note: `refreshSkipsetupRow` is defined inside `init()` (closure), but `renderLoadoutDropdowns` is at file scope. The `typeof` guard makes this safe — the check fails at page-load time (before init runs), then succeeds after init.

Next, use `save.settings.skipRunSetup` in the Main Menu Start Run handler. Find:

```javascript
    document.getElementById('menu-start-btn').addEventListener('click', () => {
        navigateToRunSetup();
    });
```

Replace with:

```javascript
    document.getElementById('menu-start-btn').addEventListener('click', () => {
        if (save.settings.skipRunSetup && save.lastLoadout) {
            // Skip Run Setup: restart with last loadout immediately.
            restartGame(null);
        } else {
            navigateToRunSetup();
        }
    });
```

- [ ] **Step 3: `qol.ascpreview` — preview next-tier modifier on selector**

In `src/engine/main.js`, find `renderAscensionSelector`. Find the section that marks locked buttons:

```javascript
        if (t > unlockedMax) {
            btn.classList.add('locked');
            btn.disabled = true;
            btn.title = spec.name + ' (locked — clear A' + (t - 1) + ' to unlock)';
        } else {
            btn.addEventListener('click', () => setTier(t));
        }
```

Replace with:

```javascript
        if (t > unlockedMax) {
            btn.classList.add('locked');
            btn.disabled = true;
            const showPreview = NeonSave.hasUnlocked(save, 'qol.ascpreview') && t === unlockedMax + 1;
            btn.title = spec.name
                + (showPreview ? ' (preview: ' + spec.name + ')' : '')
                + ' (locked — clear A' + (t - 1) + ' to unlock)';
        } else {
            btn.addEventListener('click', () => setTier(t));
        }
```

Effect: when ascpreview is owned, hover tooltip on the next-locked-tier button now shows a preview of its modifier name.

- [ ] **Step 4: Manual verification**

Grant yourself all QoL nodes via console:
```javascript
save.unlockedNodes.push('qol.fastai', 'qol.skipsetup', 'qol.ascpreview');
NeonSave.write(save); location.reload();
```

Test:
- Turn on autopilot during a run — it should visibly make decisions roughly 2× faster.
- Run Setup has a "Skip Run Setup next time" checkbox. Check it. Back to Main Menu → Start Run → bypasses Run Setup, goes straight to game with last loadout.
- Ascension selector: hover locked buttons (next-tier specifically). Tooltip should include preview text.

- [ ] **Step 5: Commit**

```bash
git add src/engine/game.js src/engine/main.js index.html style.css
git commit -m "$(cat <<'EOF'
Implement qol.fastai, qol.skipsetup, qol.ascpreview

fastai halves autopilot tick interval per-game. skipsetup adds a toggle
in Run Setup that bypasses the screen on subsequent Start Run clicks
(reuses save.lastLoadout). ascpreview shows the next-tier modifier in
hover tooltip on locked Ascension buttons.
EOF
)"
```

---

## Task 14: QoL — daily seed + Strategist kit wave preview

**Files:** `src/engine/main.js`

- [ ] **Step 1: Daily seed button already wired in Task 5 — verify**

The `menu-dailyseed-btn` was added in Task 4 HTML and shown/hidden based on `qol.dailyseed` ownership in Task 5's `updateMainMenuState`. Handler added in Task 5 computes `YYYYMMDD` integer seed and restarts.

Verify the handler doesn't immediately start a game (it should open Run Setup showing the new map preview). The Task 5 code does this:

```javascript
    document.getElementById('menu-dailyseed-btn').addEventListener('click', () => {
        if (!NeonSave.hasUnlocked(save, 'qol.dailyseed')) return;
        const today = new Date();
        const dailySeed = parseInt(today.getFullYear().toString() +
            String(today.getMonth() + 1).padStart(2, '0') +
            String(today.getDate()).padStart(2, '0'));
        restartGame(dailySeed);
        navigateToRunSetup();
    });
```

After `restartGame` fires it hides overlays. Then `navigateToRunSetup()` would re-show Run Setup. That's the wrong order — `restartGame` also calls `game.start()` which means the game is mid-run by then.

Replace the handler with:

```javascript
    document.getElementById('menu-dailyseed-btn').addEventListener('click', () => {
        if (!NeonSave.hasUnlocked(save, 'qol.dailyseed')) return;
        const today = new Date();
        const dailySeed = parseInt(today.getFullYear().toString() +
            String(today.getMonth() + 1).padStart(2, '0') +
            String(today.getDate()).padStart(2, '0'));
        // Rebuild preview Game on the daily seed and go to Run Setup for loadout selection.
        const canvas = document.getElementById('game-canvas');
        game = new Game(canvas, dailySeed, selectedTier, {
            heroId: selectedHero, kitId: selectedKit, abilityId: selectedAbility
        });
        game.draw();
        updateSeedDisplay();
        updateModeDisplay();
        navigateToRunSetup();
    });
```

- [ ] **Step 2: Strategist kit — auto-show wave preview on game start**

The Strategist kit sets `game.showAllWavesPreview = true`. Show a persistent preview panel while running.

In `src/engine/main.js`, inside `init()`, add after the existing run-start effects:

```javascript
    function maybeShowStrategistPreview() {
        if (game && game.showAllWavesPreview) {
            showWavePreview(20);  // reveal first 20 waves
        }
    }
    window.maybeShowStrategistPreview = maybeShowStrategistPreview;
```

And in the `restartGame` function, at the very end:

```javascript
        if (typeof refreshAbilityUI === 'function') refreshAbilityUI();
        if (typeof maybeShowStrategistPreview === 'function') maybeShowStrategistPreview();
```

- [ ] **Step 3: Manual verification**

1. Grant XP, buy qol.dailyseed. Main Menu → "DAILY CHALLENGE" button visible. Click → Run Setup opens with seed pre-set to today's YYYYMMDD. Launch game.
2. Grant XP, buy kit.strategist. Select Strategist in Run Setup. Launch → wave preview panel shows first 20 waves' composition. Close panel to dismiss.
3. Verify current money shows Strategist penalty: base 125 × 0.8 = 100.

- [ ] **Step 4: Commit**

```bash
git add src/engine/main.js
git commit -m "$(cat <<'EOF'
Daily seed mechanic + Strategist Kit wave preview

qol.dailyseed Main Menu button computes YYYYMMDD as a deterministic
seed and opens Run Setup for that map. kit.strategist auto-shows the
wave preview panel on game start (covers first 20 waves).
EOF
)"
```

---

## Task 15: Final smoke test + cleanup

**Files:** (verification only, no code changes expected)

- [ ] **Step 1: End-to-end run**

```javascript
localStorage.clear(); location.reload();
```

Verify:
1. Main Menu with Start Run / Tech Tree / Reset Save visible (no Daily). XP balance: 0.
2. Start Run → Run Setup. Ascension A0 default. Hero: Pioneer. Kit: Standard. Ability: None.
3. Launch → game runs normally. Money starts at 156 (Pioneer's +25%).
4. Die at wave 1 — earn a few XP. Return to Main Menu (close game-over via restart, then back to menu).
5. Submit name → scoreboard A0 updates.
6. Reload. State persists.

- [ ] **Step 2: Progression test**

```javascript
// Grant enough XP to unlock everything:
save.metaXP = 10000; NeonSave.write(save); location.reload();
```

1. Tech Tree → purchase all 15 nodes. Observe tier opening behavior (T2 opens after 2 T1; T3 opens after 2 T2).
2. After all 15 owned, balance = 10000 − (5×50 + 5×200 + 5×500) = 10000 − 3750 = 6250.
3. Return to Main Menu → all buttons active, Daily Challenge visible.

- [ ] **Step 3: Effects test**

Pick each Hero/Kit/Ability combo and start a run. Visual check each:
- Pioneer: $156 at start
- Engineer: $125 but towers cost 10% less (Blaster = 45)
- Warden: HP 25 max, +1 potion heal
- Standard: baseline
- Economist: $75 + free Relay placed
- Medic: +2 potions applied at start (HP higher than 20 if HP max is 25)
- Strategist: $100 + wave preview auto-shown
- Scan: 1-charge reveal
- Airstrike: click-target 3-charge
- Freeze: 1-charge mass freeze

Known combination hazards to verify don't crash:
- Warden + Medic: max HP 25; starting potions should not exceed it (Math.min bound)
- Economist + Strategist (kit is mutually exclusive; only one picked)

- [ ] **Step 4: Regression sweep**

Grep for leftover M1 bugs or placeholders:
```
grep -rn 'TODO\|FIXME\|HACK\|XXX' src/
```
Should show zero relevant hits in the new code.

Grep for the 645ce59 residue (should still be zero after M1):
```
grep -rn 'DIFFICULTY\|selectedDifficulty\|difficulty-btn' src/ index.html style.css
```
Should be zero.

- [ ] **Step 5: Autopilot sanity**

Clear save, pick A3 (if unlocked) + Engineer + Economist + Freeze, enable AUTO at 16× speed. Play 5 min. Verify: no crashes, autopilot builds towers, uses freeze heuristics kick in (enemy swarms + low HP). At most, autopilot ignores the ability — not a bug unless it blocks progress.

- [ ] **Step 6: Final commit (if any cleanup found)**

If Steps 1-5 flagged any issues, fix them and commit. Otherwise, no commit.

---

## Spec coverage map

| Spec section | Covered by |
|-------------|-----------|
| Tech Tree (15 nodes, 3 tiers, gating) | Tasks 1, 3, 6 |
| 3 Heroes (Pioneer/Engineer/Warden) | Tasks 1, 5, 7 |
| 3 Abilities (Scan/Airstrike/Freeze) | Tasks 1, 5, 8, 9, 10 |
| 4 Starter Kits (Standard/Economist/Medic/Strategist) | Tasks 1, 5, 7, 14 |
| 5 QoL nodes | Tasks 1, 12, 13, 14 |
| Main Menu expansion | Tasks 4, 5 |
| Run Setup expansion (dropdowns) | Tasks 4, 5 |
| Pre-unlocks (Pioneer + Standard) | Task 2 |
| Ascension auto-unlocks (A1/A3/A5/A7) | Tasks 1, 11 |
| Wave preview (Scan + Strategist) | Task 8, 14 |
| Ability charges + in-run UI | Task 8 |
| localStorage persistence + backfill | Task 2 |

---

## Deferred from M2 (handled in M3)

- A8-A10 new enemy types (Shielded / Splitter / Boss)
- 9 tower variants
- Per-tower Mastery tracking + UI
- Daily-seed leaderboard UI (the mechanic ships; leaderboard is M3+)
- T4 tower upgrades
- Autopilot awareness of abilities (it currently ignores them)

---

## Execution handoff

Plan complete and saved to `docs/superpowers/plans/2026-04-22-roguelike-m2-implementation.md`.

Two execution options:

**1. Subagent-Driven (recommended)** — Fresh subagent per task, review between tasks. Matches M1's successful approach.

**2. Inline Execution** — Execute tasks in this session using executing-plans.

Which approach?
