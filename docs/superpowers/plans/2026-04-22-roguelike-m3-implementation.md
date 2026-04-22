# Roguelike Meta-Progression Milestone 3 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close out the Medium-scope roguelike design: per-tower mastery XP earned by damage dealt (with 2 milestones per tower unlocking the tower's variant at 1k XP and a cosmetic skin at 10k XP), 9 tower variants selectable per-run once unlocked, Ascensions A8–A10 activated with new enemy types (Shielded, Splitter, Boss), and autopilot taught to use abilities + score variants.

**Architecture:** Damage attribution threads `sourceTower` through existing projectile/laser code so Tower instances accumulate a `damageDealt` counter in-run. At `window.onRunEnded`, a new `NeonSave.tallyMastery(save, towers)` sums per-type damage and updates milestones. Tower variants live as additional entries in `TOWERS` (`basic_cryo`, `sniper_scatter`, …) — picked at Run Setup via a per-tower-type selector, stored in `save.lastLoadout.towerLoadout`, consumed by `Game.applyLoadout`. A8–A10 add new enemy subtypes (`Enemy.shielded`, `Enemy.splitter`, `Enemy.boss`) selected at spawn time when the Ascension tier enables them; Splitter's death spawn and Boss's every-10-waves pacing are wave-def aware. Autopilot reads `game.towerLoadout` to map its `wantedCount` entries to variants, and uses two new heuristics to trigger ability activation.

**Tech Stack:** Vanilla JS, no build, no tests (manual browser verification). localStorage for persistence.

**Reference spec:** [docs/superpowers/specs/2026-04-22-roguelike-meta-progression-design.md](../specs/2026-04-22-roguelike-meta-progression-design.md)
**Predecessors (shipped to main):** M1 plan [2026-04-22-roguelike-m1-implementation.md](./2026-04-22-roguelike-m1-implementation.md), M2 plan [2026-04-22-roguelike-m2-implementation.md](./2026-04-22-roguelike-m2-implementation.md)

---

## File structure

| File | Kind | Responsibility |
|------|------|----------------|
| `src/entities/entities.js` | MODIFY | `Tower`: new `damageDealt` counter + `sourceTower` threading on every projectile creation. `Enemy`: new subtype fields (`shielded`, `splitterGeneration`, `isBoss`) + split-on-death behavior. Per-variant tower logic (cone burns, aura bonus, pulsed laser, etc.) colocated with base-tower class. |
| `src/progression/save.js` | MODIFY | Add `tallyMastery(save, towers)`. Extend `createFreshSave` + backfill to include `lastLoadout.towerLoadout` default. |
| `src/config/config.js` | MODIFY | Add 9 variant entries to `TOWERS` (`basic_cryo`, `sniper_scatter`, ..., `income_research`). Add `TOWER_VARIANTS` mapping base type → variant id. Activate `ASCENSION_TIERS` entries 8–10 (set `modifier: { spawnShielded: true }` etc.). Extend autopilot config with ability heuristics. |
| `src/engine/game.js` | MODIFY | `applyLoadout` reads `loadout.towerLoadout` and stores on `this.towerLoadout` for autopilot + build path. `startWave` / `update` spawn subtype enemies based on Ascension flags. Boss tally every 10 waves. New method `getDisplayTypeFor(baseType)` returns variant-or-base type string. Research Node aura applied in wave-payout loop. |
| `src/engine/main.js` | MODIFY | Tower Mastery screen + Main Menu button + tree-aware loadout rendering. `window.onRunEnded` calls `NeonSave.tallyMastery`. Run Setup adds a tower-loadout block with 9 base/variant toggles (only visible when any variant is unlocked). |
| `src/ai/autopilot.js` | MODIFY | Read `game.towerLoadout` when building — use variant type string instead of base when present. Trigger Airstrike + Freeze via heuristics when owned. |
| `index.html` | MODIFY | `#tower-mastery` overlay, Main Menu button, Run Setup tower-loadout row. |
| `style.css` | MODIFY | Styles for mastery screen, mastery progress bars, tower-loadout toggles, boss / shielded / splitter visual markers. |
| `src/render/assets.js` | MODIFY | `drawEnemy` branches for new subtypes (shielded ring, boss glow, splitter geometry). Per-variant tower drawing is minimal — variants reuse base-type visual with a subtle tint. |

**Load order in `index.html`:** unchanged from M2.

**Save schema:** stays at v1. `lastLoadout.towerLoadout` is a new optional field handled by the existing `backfillV1Fields` pattern — no schema bump.

---

## Verification approach

Per CLAUDE.md: no test framework. Each task ends with manual browser verification using specific interactions + DevTools console checks. Reload after each commit.

---

## Phase A — Mastery tracking + UI (Tasks 1–3)

After Phase A, the game accumulates per-tower XP and shows a Mastery screen. Variants can't be selected yet (Phase B), but XP is earned and milestones fire correctly.

---

## Task 1: Damage attribution — `sourceTower` on projectiles, `damageDealt` on towers

**Files:** `src/entities/entities.js`

- [ ] **Step 1: Add `damageDealt` to `Tower` constructor**

In `src/entities/entities.js`, find the end of `Tower`'s constructor (the line `this.totalSpent = this.baseCost;` at around line 168). Immediately after it, add:

```javascript
        // M3: Mastery XP attribution — incremented by every projectile hit
        // and every frame of laser damage sourced from this tower.
        this.damageDealt = 0;
```

- [ ] **Step 2: Thread `sourceTower` through `Projectile` creation**

In the same file, find the `Projectile` constructor signature. It currently looks like (the exact signature varies — find it by `class Projectile {` and its `constructor`):

```javascript
class Projectile {
    constructor(x, y, target, damage, pierce, splash, type, tower /* may or may not exist */) {
        ...
    }
}
```

If `tower` is not a constructor parameter, add it as the LAST parameter. Then inside the constructor body, store:

```javascript
        this.sourceTower = tower || null;
```

If the projectile is created via multiple call sites (`Tower.update`, chain lightning, silo rockets, etc.), each needs to pass `this` (the tower instance) as the new `tower` argument.

**Find every `new Projectile(...)` call site in entities.js** and append `this` as the final argument. Expected number of sites: 4-6 (blaster, sniper, shotgun pellet, rocket, silo rocket, electric/tesla chain). Example edits:

```javascript
// Before: this.projectiles.push(new Projectile(this.x+16, this.y+16, target, this.damage, this.pierce, 0, 'bullet'));
// After:  this.projectiles.push(new Projectile(this.x+16, this.y+16, target, this.damage, this.pierce, 0, 'bullet', this));
```

If in doubt, run `grep -n "new Projectile" src/entities/entities.js` to enumerate all call sites — there should be NO remaining `new Projectile(...)` without `this` as the last argument.

- [ ] **Step 3: Attribute damage on projectile hits**

Find every place inside `Projectile.update` (or related methods) where `target.hp -= dmg` or `e.hp -= dmg` is executed. Immediately after each of those `hp -= dmg` / damage lines, add the attribution:

```javascript
if (this.sourceTower) this.sourceTower.damageDealt += dmg;
```

Use the local variable name that matches the damage amount at that site (it might be `dmg`, `this.damage`, etc.). There will be roughly 6-8 such sites. If a damage line caps the effective damage at `target.hp` (i.e., over-kill reduction), use `Math.min(dmg, target.hp + dmg)` — but for simplicity, track the intended damage (not the capped amount). Overestimate is fine for XP purposes.

- [ ] **Step 4: Attribute damage for Laser (continuous beam)**

Laser does NOT use Projectile — it applies damage directly in `Tower.update` (search for `'laser'` and look for the direct `target.hp -= dmg` applied within the tower's own update method).

At the same site where the laser applies damage, add:

```javascript
this.damageDealt += dmg;
```

(`this` is the Tower in Tower.update, so `this.damageDealt` is self-attribution — no `sourceTower` needed.)

- [ ] **Step 5: Attribute damage for Tesla chain**

Find where Tesla/`electric` tower chains damage. It may be inside a chain-specific loop inside `Tower.update` or in a separate helper. Each chained hit increments `currentTarget.hp -= dmg` (or similar). Add:

```javascript
this.damageDealt += dmg;
```

at each site where `this` is the electric tower.

- [ ] **Step 6: Manual verification**

Reload. Start a run, build one Blaster. Let it shoot a few enemies. In console:

```javascript
console.log(game.towers[0].damageDealt);
```

Expected: a positive number that grows as the tower shoots. If zero, damage attribution is not wired. If tower is `income`, `damageDealt` stays at 0 (correct — relays don't damage).

Test laser: build a laser, let it damage a wave, check `damageDealt` on the laser tower.

- [ ] **Step 7: Commit**

```bash
git add src/entities/entities.js
git commit -m "$(cat <<'EOF'
M3: Damage attribution for per-tower Mastery XP

Tower.damageDealt counter incremented by every projectile hit + every
tick of laser/tesla direct damage. Projectile constructor threads
sourceTower; all Projectile call sites in entities.js pass `this` as
the final arg. Attribution uses the intended damage (pre-overkill cap);
ok for XP since the goal is relative play-time weighting.
EOF
)"
```

---

## Task 2: Tally mastery + milestones at game-over

**Files:**
- `src/progression/save.js`
- `src/engine/main.js`

- [ ] **Step 1: Add `tallyMastery(save, towers)` to save.js**

In `src/progression/save.js`, find the `function recordRun(save, result)` definition. Immediately BEFORE it, add:

```javascript
    // M3: Sum damageDealt across all alive towers, bucketed by base tower type
    // (variants like 'basic_cryo' roll up to 'basic'). Increments
    // save.towerMastery[type].xp and sets milestones m1 at 1000 / m2 at 10000.
    // Returns an array of { type, xpGained, newMilestones: ['m1'|'m2'] } for UI.
    function tallyMastery(save, towers) {
        const perType = {};
        for (const t of towers) {
            const base = (t.type || '').split('_')[0];
            if (!TOWER_TYPES.includes(base)) continue;
            const dmg = t.damageDealt || 0;
            if (dmg <= 0) continue;
            perType[base] = (perType[base] || 0) + dmg;
        }

        const results = [];
        for (const type of Object.keys(perType)) {
            const xpGained = Math.floor(perType[type]);
            if (xpGained <= 0) continue;
            if (!save.towerMastery[type]) save.towerMastery[type] = { xp: 0, milestones: { m1: false, m2: false } };
            save.towerMastery[type].xp += xpGained;

            const newMilestones = [];
            const milestones = save.towerMastery[type].milestones;
            if (!milestones.m1 && save.towerMastery[type].xp >= 1000) { milestones.m1 = true; newMilestones.push('m1'); }
            if (!milestones.m2 && save.towerMastery[type].xp >= 10000) { milestones.m2 = true; newMilestones.push('m2'); }

            results.push({ type, xpGained, newMilestones, newXP: save.towerMastery[type].xp });
        }
        write(save);
        return results;
    }

```

- [ ] **Step 2: Export `tallyMastery`**

Find the return block of the IIFE:

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

Replace with:

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
        recordRun,
        tallyMastery
    };
```

- [ ] **Step 3: Call `tallyMastery` from `window.onRunEnded`**

In `src/engine/main.js`, find the existing `window.onRunEnded` handler (from M2). Inside it, after the XP calculation / auto-unlock / NeonSave.write block, and BEFORE the `renderRunResultXP` call, add:

```javascript
        // M3: Mastery XP from damage dealt this run.
        const masteryResults = NeonSave.tallyMastery(save, game.towers);
```

Then extend the `renderRunResultXP` call to pass `masteryResults`. Find:

```javascript
        if (typeof renderRunResultXP === 'function') {
            renderRunResultXP({ wave, tier, xp, firstClear, autoUnlockedNodeId });
        }
```

Replace with:

```javascript
        if (typeof renderRunResultXP === 'function') {
            renderRunResultXP({ wave, tier, xp, firstClear, autoUnlockedNodeId, masteryResults });
        }
```

- [ ] **Step 4: Surface new-milestone notifications in `renderRunResultXP`**

Find the `renderRunResultXP` function signature:

```javascript
function renderRunResultXP({ wave, tier, xp, firstClear, autoUnlockedNodeId }) {
```

Replace with:

```javascript
function renderRunResultXP({ wave, tier, xp, firstClear, autoUnlockedNodeId, masteryResults }) {
```

Then find the existing `unlock` banner block (final block in the function):

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

Immediately BEFORE the closing `}`, add:

```javascript

    // M3: Mastery milestone banner — only appended if at least one milestone fired.
    if (masteryResults && masteryResults.length > 0) {
        const milestoneHits = masteryResults.filter(r => r.newMilestones && r.newMilestones.length > 0);
        if (milestoneHits.length > 0) {
            const lines = milestoneHits.map(r => {
                const names = r.newMilestones.map(m => m === 'm1' ? 'VARIANT' : 'SKIN').join(' + ');
                return `${TOWERS[r.type]?.displayName || r.type}: ${names}`;
            });
            const wrap = document.createElement('div');
            wrap.className = 'xp-breakdown-unlock';
            wrap.textContent = 'MASTERY: ' + lines.join(' · ');
            const unlockEl = document.getElementById('xp-unlock');
            unlockEl.parentNode.insertBefore(wrap, unlockEl.nextSibling);
        }
    }
}
```

Note: this appends a second unlock-style banner next to the existing one. The `xp-breakdown-unlock` CSS class was defined in M2 and is already visible.

- [ ] **Step 5: Remove stale mastery banners between runs**

The previous step appends a new element every run. To prevent accumulation, at the TOP of `renderRunResultXP`, immediately after the function signature, add:

```javascript
    // M3: Clear any stale mastery banners from prior runs.
    document.querySelectorAll('.xp-breakdown-unlock.mastery-banner').forEach(el => el.remove());
```

And update the append in Step 4 to add the marker class:

```javascript
            const wrap = document.createElement('div');
            wrap.className = 'xp-breakdown-unlock mastery-banner';  // marker for cleanup next run
            wrap.textContent = 'MASTERY: ' + lines.join(' · ');
```

- [ ] **Step 6: Manual verification**

Reload. Clear save. Pick A0, Pioneer, Standard, None. Start a run. Build 1 Blaster. Let it kill a bunch of enemies so `game.towers[0].damageDealt` exceeds 1000 (check in console). Let the core die.

Game-over overlay should show:
- Existing XP breakdown (from M2)
- New line "MASTERY: Blaster: VARIANT" (the m1 milestone)

In console:
```javascript
const s = JSON.parse(localStorage.getItem('neonDefense.save'));
console.log(s.towerMastery.basic);  // { xp: >=1000, milestones: { m1: true, m2: false } }
```

Play another run with the same tower. Verify the `MASTERY` line doesn't duplicate (the cleanup in Step 5 removes the previous one).

- [ ] **Step 7: Commit**

```bash
git add src/progression/save.js src/engine/main.js
git commit -m "$(cat <<'EOF'
M3: Tally mastery XP at game-over + surface milestones in Run Result

NeonSave.tallyMastery(save, towers) sums damageDealt per base tower type
(variants roll up to base), awards XP, checks m1@1000 + m2@10000 milestone
gates. main.js wires it into window.onRunEnded and surfaces a
"MASTERY: Blaster: VARIANT" style banner when new milestones fire.
Stale banners are cleaned up between runs.
EOF
)"
```

---

## Task 3: Tower Mastery overlay + Main Menu button

**Files:**
- `index.html`
- `style.css`
- `src/engine/main.js`

- [ ] **Step 1: Add Main Menu button**

In `index.html`, find the `#main-menu` overlay (added in M2). Find the `.menu-buttons` block:

```html
                    <div class="menu-buttons">
                        <button id="menu-start-btn" class="menu-primary">START RUN</button>
                        <button id="menu-tree-btn">TECH TREE <span class="menu-balance" id="menu-xp-balance">0 XP</span></button>
                        <button id="menu-dailyseed-btn" class="hidden">DAILY CHALLENGE</button>
                        <button id="menu-reset-btn" class="danger small">RESET SAVE</button>
                    </div>
```

Insert a new Mastery button immediately after `menu-tree-btn`:

```html
                    <div class="menu-buttons">
                        <button id="menu-start-btn" class="menu-primary">START RUN</button>
                        <button id="menu-tree-btn">TECH TREE <span class="menu-balance" id="menu-xp-balance">0 XP</span></button>
                        <button id="menu-mastery-btn">TOWER MASTERY</button>
                        <button id="menu-dailyseed-btn" class="hidden">DAILY CHALLENGE</button>
                        <button id="menu-reset-btn" class="danger small">RESET SAVE</button>
                    </div>
```

- [ ] **Step 2: Add `#tower-mastery` overlay**

Still in `index.html`, find the `#tech-tree` overlay (added in M2). Immediately AFTER its closing `</div>`, insert:

```html
                <div id="tower-mastery" class="overlay hidden">
                    <h2>TOWER MASTERY</h2>
                    <p style="font-size: 0.8rem; color: var(--text-muted); letter-spacing: 1px;">
                        Damage dealt by each tower unlocks variants (1,000 XP) and cosmetic skins (10,000 XP).
                    </p>
                    <div class="mastery-grid" id="mastery-grid">
                        <!-- Populated by renderTowerMastery -->
                    </div>
                    <button id="mastery-back-btn" class="secondary">BACK</button>
                </div>
```

- [ ] **Step 3: Append CSS to `style.css`**

```css
/* M3: Tower Mastery overlay */
#tower-mastery {
    padding: 24px;
    overflow-y: auto;
}
#tower-mastery h2 {
    margin-bottom: 6px;
}
.mastery-grid {
    display: flex;
    flex-direction: column;
    gap: 8px;
    max-width: 560px;
    margin: 14px auto;
}
.mastery-row {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 10px 14px;
    border: 1px solid rgba(56, 189, 248, 0.25);
    border-radius: 6px;
    background: rgba(0, 0, 0, 0.25);
}
.mastery-row.maxed {
    border-color: #a3e635;
    background: rgba(163, 230, 53, 0.08);
}
.mastery-icon {
    width: 32px;
    height: 32px;
    flex: 0 0 32px;
    border-radius: 4px;
    background: rgba(56, 189, 248, 0.15);
    border: 1px solid rgba(56, 189, 248, 0.35);
}
.mastery-body {
    flex: 1;
}
.mastery-name-row {
    display: flex;
    justify-content: space-between;
    font-size: 0.85rem;
    color: var(--text-main);
    font-weight: 700;
}
.mastery-xp-text {
    font-family: monospace;
    color: var(--text-muted);
    font-size: 0.75rem;
}
.mastery-bar {
    height: 4px;
    margin-top: 4px;
    background: rgba(255, 255, 255, 0.08);
    border-radius: 2px;
    position: relative;
    overflow: hidden;
}
.mastery-bar-fill {
    height: 100%;
    background: var(--accent);
    border-radius: 2px;
    transition: width 0.2s ease;
}
.mastery-bar-fill.maxed {
    background: #a3e635;
}
.mastery-milestones {
    display: flex;
    gap: 8px;
    margin-top: 4px;
    font-size: 0.65rem;
    letter-spacing: 1px;
    color: var(--text-muted);
}
.mastery-milestone-dot {
    opacity: 0.45;
}
.mastery-milestone-dot.hit {
    opacity: 1;
    color: #a3e635;
}
```

- [ ] **Step 4: Add `navigateToTowerMastery` + `renderTowerMastery` to `main.js`**

In `src/engine/main.js`, at file scope, add immediately AFTER `navigateToTechTree` (and its helpers `renderTechTree`, `buildTreeNodeEl`):

```javascript

// M3: Tower Mastery screen. Shows 9 tower rows with XP progress bars
// and milestone dots. Reads save.towerMastery; no purchase flow.
function navigateToTowerMastery() {
    hideScreen('main-menu');
    hideScreen('start-screen');
    hideScreen('game-over');
    hideScreen('tech-tree');
    showScreen('tower-mastery');
    renderTowerMastery();
}

function renderTowerMastery() {
    const grid = document.getElementById('mastery-grid');
    if (!grid) return;
    grid.innerHTML = '';

    for (const type of NeonSave.TOWER_TYPES) {
        const mast = save.towerMastery[type] || { xp: 0, milestones: { m1: false, m2: false } };
        const towerDef = TOWERS[type];

        const row = document.createElement('div');
        row.className = 'mastery-row';
        if (mast.milestones.m1 && mast.milestones.m2) row.classList.add('maxed');

        const icon = document.createElement('div');
        icon.className = 'mastery-icon';

        const body = document.createElement('div');
        body.className = 'mastery-body';

        const nameRow = document.createElement('div');
        nameRow.className = 'mastery-name-row';
        const label = document.createElement('span');
        label.textContent = towerDef ? towerDef.displayName : type;
        const xpText = document.createElement('span');
        xpText.className = 'mastery-xp-text';
        const capXP = mast.milestones.m2 ? 10000 : mast.milestones.m1 ? 10000 : 1000;
        xpText.textContent = `${mast.xp} / ${capXP} XP`;
        nameRow.appendChild(label);
        nameRow.appendChild(xpText);

        const bar = document.createElement('div');
        bar.className = 'mastery-bar';
        const fill = document.createElement('div');
        fill.className = 'mastery-bar-fill';
        const progress = Math.min(1, mast.xp / capXP);
        fill.style.width = (progress * 100) + '%';
        if (mast.milestones.m2) fill.classList.add('maxed');
        bar.appendChild(fill);

        const milestones = document.createElement('div');
        milestones.className = 'mastery-milestones';
        const dot1 = document.createElement('span');
        dot1.className = 'mastery-milestone-dot' + (mast.milestones.m1 ? ' hit' : '');
        dot1.textContent = (mast.milestones.m1 ? '● ' : '○ ') + 'VARIANT @ 1K';
        const dot2 = document.createElement('span');
        dot2.className = 'mastery-milestone-dot' + (mast.milestones.m2 ? ' hit' : '');
        dot2.textContent = (mast.milestones.m2 ? '● ' : '○ ') + 'SKIN @ 10K';
        milestones.appendChild(dot1);
        milestones.appendChild(dot2);

        body.appendChild(nameRow);
        body.appendChild(bar);
        body.appendChild(milestones);

        row.appendChild(icon);
        row.appendChild(body);
        grid.appendChild(row);
    }
}
```

- [ ] **Step 5: Wire Main Menu button + BACK button in `init()`**

In `src/engine/main.js`, inside `init()`, add alongside the other Main Menu button handlers (near `menu-tree-btn`):

```javascript
    document.getElementById('menu-mastery-btn').addEventListener('click', () => {
        navigateToTowerMastery();
    });
    document.getElementById('mastery-back-btn').addEventListener('click', () => {
        navigateToMainMenu();
    });
```

Also extend `navigateToMainMenu` to hide the mastery screen. Find:

```javascript
function navigateToMainMenu() {
    hideScreen('start-screen');
    hideScreen('game-over');
    hideScreen('restart-confirm');
    hideScreen('tech-tree');
    showScreen('main-menu');
    updateMainMenuState();
}
```

Replace with:

```javascript
function navigateToMainMenu() {
    hideScreen('start-screen');
    hideScreen('game-over');
    hideScreen('restart-confirm');
    hideScreen('tech-tree');
    hideScreen('tower-mastery');
    showScreen('main-menu');
    updateMainMenuState();
}
```

- [ ] **Step 6: Manual verification**

Reload. Main Menu now has "TOWER MASTERY" button. Click it — overlay opens showing 9 rows for all towers with 0 / 1000 XP bars. Play a run, kill enemies with a Blaster, die. Reopen TOWER MASTERY — Blaster row shows positive XP. If you hit 1000 XP, dot 1 lights green.

- [ ] **Step 7: Commit**

```bash
git add index.html style.css src/engine/main.js
git commit -m "$(cat <<'EOF'
M3: Tower Mastery overlay + Main Menu button

#tower-mastery overlay shows 9 tower rows with XP progress bars, cap
labels (/1000 to hit m1, /10000 to hit m2), and milestone dots. Reads
from save.towerMastery (populated by tallyMastery). Reachable from new
TOWER MASTERY Main Menu button. No purchase flow — pure XP-earned display.
EOF
)"
```

---

**🛑 PHASE A COMPLETE.** XP earn + Mastery screen shipped. Safe stop point. Variants unlocked by m1 are defined in Phase B.

---

## Phase B — Tower variants (Tasks 4–10)

After Phase B, players who hit 1k XP on a tower can select that tower's variant in Run Setup, and the variant's unique mechanics apply in-run.

---

## Task 4: Variant catalog in `config.js` + `TOWER_VARIANTS` map

**Files:** `src/config/config.js`

- [ ] **Step 1: Append variant entries to `TOWERS`**

Open `src/config/config.js`. Find the closing `}` of the `TOWERS` object. Immediately BEFORE the closing `}` (still inside the object), append these 9 variant entries. Preserve the comma style of the file (each entry gets a trailing comma except the last):

```javascript
    ,
    basic_cryo:     { cost: 50,  range: 100, damage: 5,   fireRate: 40,
                      displayName: 'Cryo Blaster',   defaultTargetMode: 'first',
                      baseType: 'basic', slowEffect: 0.3, slowDuration: 60 },
    sniper_scatter: { cost: 100, range: 150, damage: 35,  fireRate: 100,
                      displayName: 'Scatter Sniper', defaultTargetMode: 'mostHp',
                      baseType: 'sniper', multiShot: 2, pierce: 1 },
    rapid_flame:    { cost: 150, range: 70,  damage: 3,   fireRate: 8,
                      displayName: 'Flamethrower',   defaultTargetMode: 'first',
                      baseType: 'rapid', burnDamage: 2, burnDuration: 120,
                      coneAngle: 0.6 },
    laser_pulse:    { cost: 200, range: 150, damage: 30,  fireRate: 60,
                      displayName: 'Pulse Laser',    defaultTargetMode: 'mostHp',
                      baseType: 'laser', pulsed: true },
    rocket_cluster: { cost: 250, range: 200, damage: 18,  fireRate: 90,
                      displayName: 'Cluster Rocket', defaultTargetMode: 'mostHp',
                      baseType: 'rocket', splash: 45, clusterCount: 4 },
    flak_emp:       { cost: 150, range: 250, damage: 8,   fireRate: 40,
                      displayName: 'EMP Flak',       defaultTargetMode: 'first',
                      baseType: 'flak', splash: 40, stunDuration: 60 },
    electric_plasma:{ cost: 300, range: 100, damage: 2,   fireRate: 1,
                      displayName: 'Plasma Coil',    defaultTargetMode: 'first',
                      baseType: 'electric', continuousAoE: true },
    silo_orbital:   { cost: 400, range: 120, damage: 360, fireRate: 480,
                      displayName: 'Orbital Strike', defaultTargetMode: 'mostHp',
                      baseType: 'silo', maxHover: 1, splash: 90, orbital: true },
    income_research:{ cost: 200, range: 0,   damage: 0,   fireRate: 0,
                      displayName: 'Research Node',  defaultTargetMode: 'closest',
                      baseType: 'income', incomePerWave: 0, auraBonus: 0.02, auraRange: 3 }
```

Double-check: the preceding `income` entry (last base tower) must end with `}` (no trailing comma) — add a comma there if needed so the whole `TOWERS` object stays valid after the `,` is inserted before the variant block.

- [ ] **Step 2: Add `TOWER_VARIANTS` mapping**

Immediately AFTER the `TOWERS` object's closing `};`, add:

```javascript

// M3: Map from base tower type → variant type id. Used by Run Setup to show
// base/variant toggles, and by Game to resolve loadout choices at build time.
const TOWER_VARIANTS = {
    basic:    'basic_cryo',
    sniper:   'sniper_scatter',
    rapid:    'rapid_flame',
    laser:    'laser_pulse',
    rocket:   'rocket_cluster',
    flak:     'flak_emp',
    electric: 'electric_plasma',
    silo:     'silo_orbital',
    income:   'income_research'
};
```

- [ ] **Step 3: Manual verification**

Reload. In console:
```javascript
console.log(TOWERS.basic_cryo);   // has displayName 'Cryo Blaster', slowEffect 0.3
console.log(TOWER_VARIANTS.basic); // 'basic_cryo'
```

No runtime changes yet — variants are data only.

- [ ] **Step 4: Commit**

```bash
git add src/config/config.js
git commit -m "$(cat <<'EOF'
M3: Add 9 tower variant definitions + TOWER_VARIANTS map

Each variant carries baseType + unique fields (slowEffect, multiShot,
burnDamage, pulsed, clusterCount, stunDuration, continuousAoE, orbital,
auraBonus). TOWER_VARIANTS maps base type → variant id for loadout
resolution. No behavior change until Task 6 wires them in.
EOF
)"
```

---

## Task 5: Run Setup — tower-loadout block with 9 base/variant toggles

**Files:**
- `index.html`
- `style.css`
- `src/engine/main.js`
- `src/progression/save.js` (backfill `towerLoadout`)

- [ ] **Step 1: Extend `save` with `lastLoadout.towerLoadout`**

In `src/progression/save.js`, find `createFreshSave`:

```javascript
            lastLoadout: null,                                 // M2: remembered for qol.skipsetup
```

Replace with:

```javascript
            lastLoadout: {
                heroId: 'hero.pioneer',
                kitId: 'kit.standard',
                abilityId: 'ability.none',
                towerLoadout: null  // M3: null → all base types. Filled per-type when user selects a variant.
            },
```

Find `backfillV1Fields`:

```javascript
        if (typeof save.lastLoadout === 'undefined') save.lastLoadout = null;
```

Replace with:

```javascript
        if (save.lastLoadout === undefined || save.lastLoadout === null) {
            save.lastLoadout = { heroId: 'hero.pioneer', kitId: 'kit.standard', abilityId: 'ability.none', towerLoadout: null };
        }
        if (typeof save.lastLoadout !== 'object' || save.lastLoadout === null) {
            save.lastLoadout = { heroId: 'hero.pioneer', kitId: 'kit.standard', abilityId: 'ability.none', towerLoadout: null };
        }
        if (typeof save.lastLoadout.towerLoadout === 'undefined') save.lastLoadout.towerLoadout = null;
```

- [ ] **Step 2: Add tower-loadout block to Run Setup HTML**

In `index.html`, inside `#start-screen` (the Run Setup overlay). Find the existing ability dropdown block:

```html
                    <div class="loadout-row">
                        <span class="loadout-label">ABILITY</span>
                        <select id="run-ability-select" class="loadout-select"></select>
                    </div>
```

Immediately AFTER this `.loadout-row` block, insert the new tower-loadout row:

```html
                    <div class="loadout-row hidden" id="tower-loadout-row">
                        <span class="loadout-label">TOWER VARIANTS</span>
                        <div class="tower-variant-grid" id="tower-variant-grid">
                            <!-- Populated by renderTowerVariantGrid -->
                        </div>
                    </div>
```

- [ ] **Step 3: Append CSS**

```css
/* M3: Run Setup tower-variant grid */
.tower-variant-grid {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 6px;
    max-width: 340px;
}
.tower-variant-row {
    display: flex;
    flex-direction: column;
    gap: 2px;
    padding: 4px;
    background: rgba(0, 0, 0, 0.2);
    border: 1px solid rgba(56, 189, 248, 0.15);
    border-radius: 3px;
}
.tower-variant-row .variant-base {
    font-size: 0.65rem;
    color: var(--text-muted);
    letter-spacing: 1px;
}
.tower-variant-row select {
    font-size: 0.72rem;
    padding: 2px 4px;
    background: rgba(0, 0, 0, 0.5);
    color: var(--text-main);
    border: 1px solid var(--accent);
    border-radius: 2px;
    font-family: inherit;
    cursor: pointer;
}
.tower-variant-row select:disabled {
    opacity: 0.5;
    cursor: not-allowed;
}
```

- [ ] **Step 4: Add `renderTowerVariantGrid` + state in `main.js`**

At file scope in `src/engine/main.js`, add a global tracking the current tower loadout, initialized from save:

Find the existing M2 globals (near `selectedHero`):

```javascript
let selectedHero    = ...
let selectedKit     = ...
let selectedAbility = ...
```

Add immediately after:

```javascript
// M3: Per-base-type variant selection. Map of baseType → effective tower id.
// Example: { basic: 'basic_cryo', sniper: 'sniper', ... } — 'sniper' means base form.
// Initialized from save.lastLoadout.towerLoadout if present.
let selectedTowerLoadout = (save.lastLoadout && save.lastLoadout.towerLoadout)
    ? { ...save.lastLoadout.towerLoadout }
    : {};
```

Then add a new file-scope function alongside `renderLoadoutDropdowns`:

```javascript

// M3: Populate the tower-variant grid. One row per base tower type;
// row is visible only if the player has unlocked that tower's variant
// (towerMastery[type].milestones.m1). If no variants are unlocked, the
// entire row is hidden.
function renderTowerVariantGrid() {
    const row = document.getElementById('tower-loadout-row');
    const grid = document.getElementById('tower-variant-grid');
    if (!row || !grid) return;
    grid.innerHTML = '';

    let anyUnlocked = false;
    for (const baseType of NeonSave.TOWER_TYPES) {
        const variantId = TOWER_VARIANTS[baseType];
        const variantUnlocked = save.towerMastery[baseType]?.milestones?.m1;
        if (!variantUnlocked) continue;
        anyUnlocked = true;

        const cell = document.createElement('div');
        cell.className = 'tower-variant-row';

        const label = document.createElement('span');
        label.className = 'variant-base';
        label.textContent = TOWERS[baseType].displayName;

        const sel = document.createElement('select');
        sel.innerHTML = `
            <option value="${baseType}">${TOWERS[baseType].displayName}</option>
            <option value="${variantId}">${TOWERS[variantId].displayName}</option>
        `;
        const current = selectedTowerLoadout[baseType] || baseType;
        sel.value = current;
        sel.addEventListener('change', e => {
            selectedTowerLoadout[baseType] = e.target.value;
        });

        cell.appendChild(label);
        cell.appendChild(sel);
        grid.appendChild(cell);
    }

    if (anyUnlocked) row.classList.remove('hidden');
    else row.classList.add('hidden');
}
```

- [ ] **Step 5: Call `renderTowerVariantGrid` in `renderLoadoutDropdowns`**

Find:

```javascript
function renderLoadoutDropdowns() {
    renderOneLoadoutSelect('run-hero-select', 'selectedHero', 'hero.pioneer', HEROES);
    renderOneLoadoutSelect('run-kit-select',  'selectedKit',  'kit.standard', STARTER_KITS);
    renderOneAbilitySelect();
    if (typeof refreshSkipsetupRow === 'function') refreshSkipsetupRow();
}
```

Replace with:

```javascript
function renderLoadoutDropdowns() {
    renderOneLoadoutSelect('run-hero-select', 'selectedHero', 'hero.pioneer', HEROES);
    renderOneLoadoutSelect('run-kit-select',  'selectedKit',  'kit.standard', STARTER_KITS);
    renderOneAbilitySelect();
    renderTowerVariantGrid();
    if (typeof refreshSkipsetupRow === 'function') refreshSkipsetupRow();
}
```

- [ ] **Step 6: Persist + pass `towerLoadout` in start-btn handler**

Find the existing `start-btn` click handler:

```javascript
    document.getElementById('start-btn').addEventListener('click', () => {
        // M2: Persist chosen loadout for next run.
        save.lastLoadout = { heroId: selectedHero, kitId: selectedKit, abilityId: selectedAbility };
        NeonSave.write(save);
        ...
    });
```

Replace the `save.lastLoadout = ...` line with:

```javascript
        save.lastLoadout = {
            heroId: selectedHero,
            kitId: selectedKit,
            abilityId: selectedAbility,
            towerLoadout: { ...selectedTowerLoadout }
        };
```

Then find `restartGame`'s `new Game(canvas, useSeed, selectedTier, {...})` call:

```javascript
        game = new Game(canvas, useSeed, selectedTier, {
            heroId: selectedHero,
            kitId: selectedKit,
            abilityId: selectedAbility
        });
```

Replace with:

```javascript
        game = new Game(canvas, useSeed, selectedTier, {
            heroId: selectedHero,
            kitId: selectedKit,
            abilityId: selectedAbility,
            towerLoadout: { ...selectedTowerLoadout }
        });
```

Also update the initial-preview `new Game(...)` in `init()` and the Daily Seed handler's `new Game(...)` the same way — add `towerLoadout: { ...selectedTowerLoadout }` to the loadout object.

- [ ] **Step 7: Manual verification**

Reload. Main Menu → Start Run. The TOWER VARIANTS row should be hidden (no variants unlocked yet).

Grant mastery via console:
```javascript
save.towerMastery.basic.xp = 1500;
save.towerMastery.basic.milestones.m1 = true;
NeonSave.write(save);
location.reload();
```

Main Menu → Start Run. TOWER VARIANTS row appears with 1 cell: Blaster dropdown showing "Blaster" and "Cryo Blaster". Select Cryo Blaster. Reload. Verify via console:
```javascript
JSON.parse(localStorage.getItem('neonDefense.save')).lastLoadout.towerLoadout.basic
// 'basic_cryo'
```

- [ ] **Step 8: Commit**

```bash
git add src/config/config.js src/progression/save.js src/engine/main.js index.html style.css
git commit -m "$(cat <<'EOF'
M3: Run Setup tower-variant loadout grid + persistence

TOWER VARIANTS row in Run Setup shows a per-base-type base/variant
dropdown for each tower whose m1 mastery milestone is hit. Row is
hidden when no variants are unlocked. Selection persists to
save.lastLoadout.towerLoadout and is passed via Game loadout.
EOF
)"
```

---

## Task 6: Game plumbing — `applyLoadout` stores tower loadout; build path resolves base→variant

**Files:** `src/engine/game.js`

- [ ] **Step 1: Extend `applyLoadout` to store `towerLoadout`**

Find `applyLoadout`:

```javascript
    applyLoadout() {
        const heroKey = this.loadout.heroId ? this.loadout.heroId.replace(/^hero\./, '') : null;
        const kitKey  = this.loadout.kitId  ? this.loadout.kitId.replace(/^kit\./, '')  : null;
        if (heroKey && HEROES[heroKey] && HEROES[heroKey].apply) HEROES[heroKey].apply(this);
        if (kitKey  && STARTER_KITS[kitKey]  && STARTER_KITS[kitKey].apply)  STARTER_KITS[kitKey].apply(this);
        this.ability = NeonAbilities.createInstance(this.loadout.abilityId);
        this.abilityTargetMode = false;
        this.freezeTimer = 0;
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
        this.abilityTargetMode = false;
        this.freezeTimer = 0;
        // M3: Tower loadout (base → variant) drives buildTower resolution.
        this.towerLoadout = this.loadout.towerLoadout || {};
    }

    // M3: Given a base tower type (e.g. 'basic'), return the effective type
    // to build — either the base or its variant — based on this.towerLoadout.
    // Also handles pass-through of variant ids directly.
    getEffectiveTowerType(requestedType) {
        // If caller already passed a variant id, use it.
        if (requestedType && requestedType.includes('_')) return requestedType;
        const chosen = this.towerLoadout[requestedType];
        if (chosen && TOWERS[chosen]) return chosen;
        return requestedType;
    }
```

- [ ] **Step 2: Route `buildTower` and `canAfford` through `getEffectiveTowerType`**

Find `buildTower`:

```javascript
    buildTower(c, r, type) {
        if (!this.map.isBuildable(c, r)) return false;

        for (let t of this.towers) {
            if (t.c === c && t.r === r) return false;
        }

        let cost = Math.floor(TOWERS[type].cost * this.towerCostMult);
```

Replace with:

```javascript
    buildTower(c, r, type) {
        if (!this.map.isBuildable(c, r)) return false;

        for (let t of this.towers) {
            if (t.c === c && t.r === r) return false;
        }

        const effType = this.getEffectiveTowerType(type);
        let cost = Math.floor(TOWERS[effType].cost * this.towerCostMult);
```

Also find within the same method:

```javascript
        if (this.money >= cost) {
            this.money -= cost;
            this.towers.push(new Tower(c, r, type));
            this.uiDirty = true;
            SoundFX.build();
            return true;
        }
```

Replace with:

```javascript
        if (this.money >= cost) {
            this.money -= cost;
            this.towers.push(new Tower(c, r, effType));
            this.uiDirty = true;
            SoundFX.build();
            return true;
        }
```

Find `canAfford`:

```javascript
    canAfford(type) {
        return this.money >= Math.floor(TOWERS[type].cost * this.towerCostMult);
    }
```

Replace with:

```javascript
    canAfford(type) {
        const effType = this.getEffectiveTowerType(type);
        return this.money >= Math.floor(TOWERS[effType].cost * this.towerCostMult);
    }
```

- [ ] **Step 3: Manual verification**

Grant m1 on basic + select Cryo via Run Setup (as in Task 5). Start run. Build a Blaster (hit key `1` or click). A Cryo Blaster is placed instead. Confirm in console:

```javascript
game.towers.find(t => t.type === 'basic_cryo')  // exists
game.towers.find(t => t.type === 'basic')       // undefined (loadout replaced base)
```

Variant has `slowEffect: 0.3` — but the actual slow-on-hit behavior isn't implemented yet (Task 7). For now, Cryo Blaster just looks like Blaster with reduced damage (5 instead of 10).

- [ ] **Step 4: Commit**

```bash
git add src/engine/game.js
git commit -m "$(cat <<'EOF'
M3: Game resolves base → variant tower type at build time

applyLoadout stores this.towerLoadout from loadout.towerLoadout.
getEffectiveTowerType(baseType) returns the player-selected variant
for that base if one exists. buildTower + canAfford consult it so
hitting '1' builds the variant when selected, without changing the
build-menu keybindings.
EOF
)"
```

---

## Task 7: Implement 5 simple variants (Cryo, Scatter, EMP, Cluster, Orbital)

**Files:** `src/entities/entities.js`

These 5 variants reuse existing mechanics and only need small additions. Implemented together since they share patterns.

- [ ] **Step 1: Cryo Blaster — apply slow on hit**

`basic_cryo` has `slowEffect: 0.3, slowDuration: 60`. The projectile's hit site needs to apply slow to the target.

In `src/entities/entities.js`, find the `Projectile` class. In its hit-application method (where `target.hp -= dmg` runs for basic/bullet projectiles), add:

```javascript
        // M3: Cryo Blaster slow effect — only if sourceTower has slowEffect set.
        if (this.sourceTower && this.sourceTower.slowEffect && target.currentSlow) {
            const newSlow = 1 - this.sourceTower.slowEffect;
            target.currentSlow = Math.min(target.currentSlow, newSlow);
            target.slowExpireFrame = this.sourceTower.slowDuration || 60;
        }
```

Then in `Enemy.update`, find where the existing slow-recovery runs (`this.currentSlow` approaches 1 over time). Above or near that recovery, add a tick-down for the cryo-specific duration:

```javascript
        // M3: Cryo slow decays to 1 after slowExpireFrame frames
        if (this.slowExpireFrame && this.slowExpireFrame > 0) {
            this.slowExpireFrame--;
            if (this.slowExpireFrame === 0) this.currentSlow = 1;
        }
```

- [ ] **Step 2: Scatter Sniper — `multiShot: 2`**

`sniper_scatter` has `multiShot: 2`. Towers already support `multiShot` (rocket uses it via 'Multi-Shot' upgrade). Verify the firing logic in `Tower.update` (search for `multiShot` or `this.multiShot`) already loops the projectile creation `this.multiShot` times. If not, wrap the projectile-creation block inside `for (let i = 0; i < (this.multiShot || 1); i++) { ... }`.

- [ ] **Step 3: EMP Flak — stun air for `stunDuration` frames**

`flak_emp` has `stunDuration: 60`. In the Flak tower's firing or splash-damage logic, after applying splash damage to an air target, add:

```javascript
        // M3: EMP Flak stun effect.
        if (this.sourceTower && this.sourceTower.stunDuration && target.isAir) {
            target.stunned = true;
            target.stunFrames = this.sourceTower.stunDuration;
        }
```

In `Enemy.update`, at the very top (after the existing freeze check added in M2), add:

```javascript
        // M3: Stun effect — halts this enemy for stunFrames frames.
        if (this.stunned && this.stunFrames > 0) {
            this.stunFrames--;
            if (this.stunFrames === 0) this.stunned = false;
            return;
        }
```

- [ ] **Step 4: Cluster Rocket — split into `clusterCount` mini-rockets on impact**

`rocket_cluster` has `splash: 45, clusterCount: 4`. In the rocket Projectile's impact logic (where the splash damage is applied), the `Projectile.update` method receives `enemies`, `particles`, and `projectiles` as parameters — use those local arrays rather than a global `game` reference. After the splash loop runs, add:

```javascript
        // M3: Cluster Rocket — spawn sub-rockets at impact site. Uses the
        // `enemies` and `projectiles` arrays already passed to Projectile.update
        // so this code has no global dependencies.
        if (this.sourceTower && this.sourceTower.clusterCount && !this.isClusterChild) {
            const subRadius = (this.sourceTower.splash || 45) * 0.6;
            const subDamage = (this.sourceTower.damage || 18) * 0.5;
            for (let i = 0; i < this.sourceTower.clusterCount; i++) {
                const angle = (Math.PI * 2 / this.sourceTower.clusterCount) * i;
                const sx = this.x + Math.cos(angle) * subRadius * 0.3;
                const sy = this.y + Math.sin(angle) * subRadius * 0.3;
                let nearest = null;
                let bestD = Infinity;
                for (const en of enemies) {
                    if (!en.active) continue;
                    const dx = en.x - sx, dy = en.y - sy;
                    const d2 = dx*dx + dy*dy;
                    if (d2 < bestD) { bestD = d2; nearest = en; }
                }
                if (nearest) {
                    const sub = new Projectile(sx, sy, nearest, subDamage, 1, subRadius, 'rocket', this.sourceTower);
                    sub.isClusterChild = true;
                    projectiles.push(sub);
                }
            }
        }
```

Note: if the rocket impact code is inside a method that doesn't directly see `enemies`/`projectiles` parameters, adjust the method signature or thread them through. Projectile's `update(enemies, particles, projectiles)` is the pattern used throughout `entities.js`.

- [ ] **Step 5: Orbital Strike — already covered by fireRate/damage/splash config**

`silo_orbital` has `fireRate: 480, damage: 360, splash: 90, maxHover: 1`. Silo's existing logic (hover rockets, auto-fire) reads these fields. Verify by grepping `src/entities/entities.js` for `maxHover` / `this.fireRate` in Silo's tower behavior — existing code should handle this variant via the same code path.

No new code needed for Orbital. (If the silo's hover-rocket logic is stuck on a hardcoded 3 or 4, adjust it to `this.maxHover`.)

- [ ] **Step 6: Manual verification**

Grant all 5 variants:
```javascript
for (const t of ['basic', 'sniper', 'rocket', 'flak', 'silo']) {
    save.towerMastery[t].xp = 1500;
    save.towerMastery[t].milestones.m1 = true;
}
NeonSave.write(save);
location.reload();
```

Run Setup → select all 5 variants. Start run. Each should behave per-spec:
- Cryo Blaster: enemies visibly slow on hit
- Scatter Sniper: two projectiles per shot
- Cluster Rocket: explosion creates 4 mini-rockets
- EMP Flak: air enemies briefly halt on hit
- Orbital Strike: very slow fire rate but massive single hit

- [ ] **Step 7: Commit**

```bash
git add src/entities/entities.js
git commit -m "$(cat <<'EOF'
M3: Implement 5 simple variants — Cryo, Scatter, EMP, Cluster, Orbital

Cryo Blaster applies slowEffect/slowDuration on hit. Scatter Sniper
reuses existing multiShot loop. EMP Flak stuns air targets via a new
Enemy.stunFrames path. Cluster Rocket spawns sub-rockets at impact.
Orbital Strike is pure-config (longer fireRate, bigger damage/splash,
reduced maxHover to 1).
EOF
)"
```

---

## Task 8: Implement Flamethrower (cone + burn DoT)

**Files:** `src/entities/entities.js`, `src/render/assets.js`

`rapid_flame` is the most visually distinct variant — uses a cone hitbox instead of projectiles + applies a burn damage-over-time.

- [ ] **Step 1: Flamethrower fires no projectiles — damages enemies in cone per-frame**

In `src/entities/entities.js`, find the Shotgun (`rapid`) tower's firing logic in `Tower.update`. For the variant, replace projectile emission with direct cone damage.

A practical approach: branch on `this.type === 'rapid_flame'` in Tower.update's firing code. When the fire-timer ticks, iterate enemies within the cone and apply damage + start burn.

Locate the Tower.update code that handles the Shotgun's shot. Replace or augment that block so that when `this.type === 'rapid_flame'`:

```javascript
        if (this.type === 'rapid_flame' && this.cooldown <= 0) {
            const coneAngle = this.coneAngle || 0.6;
            const aimAngle = this.angle; // existing: angle to target
            for (const e of game.enemies) {
                if (!e.active) continue;
                const dx = e.x - (this.x + TILE_SIZE / 2);
                const dy = e.y - (this.y + TILE_SIZE / 2);
                const d = Math.hypot(dx, dy);
                if (d > this.range) continue;
                const enemyAngle = Math.atan2(dy, dx);
                let diff = enemyAngle - aimAngle;
                while (diff > Math.PI) diff -= Math.PI * 2;
                while (diff < -Math.PI) diff += Math.PI * 2;
                if (Math.abs(diff) <= coneAngle / 2) {
                    e.hp -= this.damage;
                    this.damageDealt += this.damage;
                    if (e.hp <= 0) e.active = false;
                    // Apply burn DoT
                    e.burnFrames = Math.max(e.burnFrames || 0, this.burnDuration);
                    e.burnDamage = this.burnDamage;
                    e.burnSource = this;
                }
            }
            this.cooldown = this.fireRate;
        }
```

- [ ] **Step 2: Burn DoT tick in `Enemy.update`**

Still in `src/entities/entities.js`, find `Enemy.update`. After the existing stun / freeze / slow handlers (near the top), add:

```javascript
        // M3: Flamethrower burn DoT
        if (this.burnFrames && this.burnFrames > 0) {
            this.burnFrames--;
            if (this.burnFrames % 10 === 0) { // tick every 10 frames
                const d = this.burnDamage || 1;
                this.hp -= d;
                if (this.burnSource) this.burnSource.damageDealt += d;
                if (this.hp <= 0) this.active = false;
            }
        }
```

- [ ] **Step 3: Render burn overlay + cone preview**

In `src/render/assets.js`, find `drawEnemy`. Add a small burn aura when `enemy.burnFrames > 0`. (If `drawEnemy` takes no enemy reference, plumb the enemy or use the existing `slow` flag pattern — it accepts a boolean flag. Add a similar optional `onFire` boolean parameter.)

Simplest: extend `drawEnemy` to accept a trailing `burning` boolean. In `Enemy.draw`, pass `this.burnFrames > 0`. Then in `drawEnemy` body, if `burning`, overlay an orange translucent glow:

```javascript
// Inside drawEnemy, after primary draw:
if (burning) {
    ctx.save();
    ctx.globalAlpha = 0.5;
    ctx.fillStyle = 'rgba(251, 146, 60, 0.6)';
    ctx.beginPath();
    ctx.arc(x, y, radius + 2, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
}
```

For the cone render on the Flamethrower tower itself: in `Tower.draw`, branch on `this.type === 'rapid_flame'` and draw a filled semi-transparent cone in the tower's facing direction. (Simpler visual: a short orange arc.)

- [ ] **Step 4: Manual verification**

Grant m1 on rapid, select Flamethrower. Start run. Build Flamethrower near path. Enemies within its cone should take fast damage + continue burning after leaving the cone. Burn glows orange.

- [ ] **Step 5: Commit**

```bash
git add src/entities/entities.js src/render/assets.js
git commit -m "$(cat <<'EOF'
M3: Flamethrower variant — cone damage + burn DoT

rapid_flame tower applies damage every 'fire' frame to enemies inside
its facing cone (coneAngle in radians). Enemies track burnFrames +
burnDamage; burn ticks every 10 frames and attributes damage back to
the source tower. Orange glow renders while burning.
EOF
)"
```

---

## Task 9: Implement Pulse Laser + Plasma Coil

**Files:** `src/entities/entities.js`

`laser_pulse` fires high-damage projectiles at a fixed cadence instead of continuous beam. `electric_plasma` does continuous AoE damage instead of chain.

- [ ] **Step 1: Pulse Laser — branch on `this.pulsed` in laser tower logic**

In `src/entities/entities.js`, find the Laser tower's `update` logic (probably the block checking `this.type === 'laser'` and applying continuous damage to `this.laserTarget`).

Branch the behavior on `this.pulsed`:

```javascript
        if (this.type === 'laser' || this.type === 'laser_pulse') {
            if (this.pulsed) {
                // Pulse Laser: behave like a standard projectile tower.
                if (this.cooldown <= 0) {
                    const target = this.findBestTarget(enemies);
                    if (target) {
                        const proj = new Projectile(this.x + TILE_SIZE/2, this.y + TILE_SIZE/2, target,
                            this.damage, this.pierce || 1, 0, 'laser-pulse', this);
                        projectiles.push(proj);
                        this.cooldown = this.fireRate;
                    }
                }
            } else {
                // existing continuous-beam code, unchanged
            }
        }
```

You may need to adjust the exact structure to fit the existing laser code — the intent is that `pulsed: true` causes the laser to emit projectiles at cadence `fireRate` rather than beaming continuously. The continuous-beam code path stays intact for the base Laser.

Also ensure `this.laserTarget` handling doesn't run for the pulsed variant (visual beam to current target).

- [ ] **Step 2: Plasma Coil — branch on `continuousAoE` in Tesla logic**

Find the Tesla/electric tower's chain logic. When `this.type === 'electric_plasma'`, replace the chain behavior with per-frame AoE:

```javascript
        if (this.type === 'electric_plasma' && this.cooldown <= 0) {
            // Plasma Coil applies `damage` per tick to all enemies in range.
            for (const e of enemies) {
                if (!e.active) continue;
                const dx = e.x - (this.x + TILE_SIZE / 2);
                const dy = e.y - (this.y + TILE_SIZE / 2);
                if (dx*dx + dy*dy > this.range * this.range) continue;
                e.hp -= this.damage;
                this.damageDealt += this.damage;
                if (e.hp <= 0) e.active = false;
            }
            this.cooldown = 1; // effectively every frame (fireRate=1)
        }
```

Visual: optionally draw a faint purple circle at the tower's range when `continuousAoE` is true.

- [ ] **Step 3: Manual verification**

Grant m1 on laser + electric. Select Pulse Laser + Plasma Coil. Start run. Pulse Laser should fire periodic purple-ish projectiles instead of a continuous beam; Plasma Coil should zap all nearby enemies every frame.

- [ ] **Step 4: Commit**

```bash
git add src/entities/entities.js
git commit -m "$(cat <<'EOF'
M3: Pulse Laser + Plasma Coil variants

Pulse Laser branches on `pulsed: true` — emits laser-pulse projectiles
at fireRate cadence instead of the continuous beam. Plasma Coil branches
on `continuousAoE: true` — damages all in-range enemies every frame
instead of chaining to limited targets.
EOF
)"
```

---

## Task 10: Implement Research Node (aura) + autopilot variant awareness

**Files:** `src/engine/game.js`, `src/ai/autopilot.js`

- [ ] **Step 1: Research Node aura — applied in wave-payout / per-frame**

Research Node (`income_research`) gives `auraBonus: 0.02` per adjacent tower (within `auraRange: 3` tiles). Unlike Relay (which generates income), Research Node boosts damage of neighbors.

Simplest implementation: at wave start, compute aura bonuses on each tower's damage and store as `this.auraDamageBonus`. Reset each wave. No income is generated.

In `src/engine/game.js`, find `startWave`. At the top of that method, before any damage calculations, add:

```javascript
        // M3: Research Node aura — computes damage-mult bonus on each tower
        // based on nearby Research Nodes. Reset every wave.
        for (const t of this.towers) t.auraDamageBonus = 0;
        const researchNodes = this.towers.filter(t => t.type === 'income_research');
        for (const rn of researchNodes) {
            for (const t of this.towers) {
                if (t === rn) continue;
                const dc = t.c - rn.c, dr = t.r - rn.r;
                const dist = Math.sqrt(dc*dc + dr*dr);
                if (dist <= (rn.auraRange || 3)) {
                    t.auraDamageBonus = (t.auraDamageBonus || 0) + (rn.auraBonus || 0.02);
                }
            }
        }
```

Then in every damage-application site inside `Tower` / `Projectile` logic in entities.js, multiply the outgoing damage by `(1 + (tower.auraDamageBonus || 0))`. Rather than patching every site, do it once inside `Tower.update`'s fire-time `damage` read:

In `src/entities/entities.js`, find where `Tower.update` computes the damage value passed to a new Projectile. At the point of use, compute the effective damage:

```javascript
        const effectiveDamage = this.damage * (1 + (this.auraDamageBonus || 0));
        // Then use effectiveDamage in place of this.damage when constructing projectiles or applying direct damage.
```

Apply this pattern to all tower-behavior branches. For Laser / Plasma / Flamethrower direct damage, multiply `this.damage` by `(1 + (this.auraDamageBonus || 0))` at the direct-damage site.

Research Node's own `incomePerWave` is 0 (per the config entry) so the existing income loop won't pay it anything — no additional change needed.

- [ ] **Step 2: Remove Research Node from income loop**

In `src/engine/game.js`, find the income-tower payout block:

```javascript
                    let incomeTowers = this.towers.filter(t => t.type === 'income');
                    let relayCount = incomeTowers.length;
                    for (let t of incomeTowers) {
                        let bonus = t.incomePerWave + (t.networkBonus || 0) * 5 * (relayCount - 1);
                        this.money += bonus;
                    }
```

Research Node's `type` is `income_research`, NOT `income`, so the existing filter already excludes it. No change needed.

- [ ] **Step 3: Autopilot variant awareness**

In `src/ai/autopilot.js`, find where the autopilot builds towers via `game.buildTower`. The autopilot currently iterates over `AUTOPILOT_CONFIG.buildOrder` (`['basic', 'flak', ...]`) and calls `game.buildTower(c, r, type)` with base types.

Since Task 6 routed `buildTower` through `getEffectiveTowerType`, the autopilot's build calls automatically produce variants when the player has selected them. No code change needed for variant building.

However, the autopilot's scoring logic (Laser synergy, flak urgency) might reference `t.type === 'laser'`. Extend those checks to include variants where relevant:

```javascript
// Example (find and update as applicable):
// Old: const laserCount = game.towers.filter(t => t.type === 'laser').length;
// New: const laserCount = game.towers.filter(t => t.type === 'laser' || t.type === 'laser_pulse').length;
```

Grep autopilot.js for `.type === '` and update each comparison to also match the corresponding variant where it makes sense.

- [ ] **Step 4: Manual verification**

Grant m1 on income, select Research Node. Build 1 Research Node + 2 Blasters within 3 tiles. The Blasters' damage should be visibly higher (each Research Node adds +2% mult per adjacent tower). Verify by inspecting `game.towers[i].auraDamageBonus` in console after a wave starts.

- [ ] **Step 5: Commit**

```bash
git add src/engine/game.js src/entities/entities.js src/ai/autopilot.js
git commit -m "$(cat <<'EOF'
M3: Research Node aura + autopilot variant awareness

Research Node (income_research) forfeits income for a +2% damage aura
on all towers within 3 tiles. Aura recomputes at startWave; each tower
reads its auraDamageBonus during damage application. Autopilot inherits
variant selection via Game.getEffectiveTowerType; its tower-counting
heuristics extended to match variants alongside bases.
EOF
)"
```

---

**🛑 PHASE B COMPLETE.** 9 variants selectable + functional. Safe stop point before enemies.

---

## Phase C — A8–A10 enemies + autopilot abilities (Tasks 11–14)

---

## Task 11: A8 Shielded enemy

**Files:**
- `src/config/config.js` (activate A8 modifier)
- `src/engine/game.js` (spawn subtype)
- `src/entities/entities.js` (shield mechanic)
- `src/render/assets.js` (shield ring)

- [ ] **Step 1: Activate A8 modifier in `ASCENSION_TIERS`**

Find in `src/config/config.js`:

```javascript
    { tier: 8, label: 'A8',  name: 'Shielded (M3)', modifier: null,                                          kind: 'enemy-m3' },
```

Replace with:

```javascript
    { tier: 8, label: 'A8',  name: 'Shielded enemy', modifier: { spawnShielded: true },                      kind: 'enemy-m3' },
```

Also update `getAscensionEffects` to merge `spawnShielded`. Find the default effect map:

```javascript
    const effects = {
        hpMult: 1,
        startMoneyMult: 1,
        airWaveInterval: 5,
        countMult: 1,
        payoutMult: 1,
        disableInvestCap: false,
        potionCostMult: 1,
        potionHeal: null
    };
```

Replace with:

```javascript
    const effects = {
        hpMult: 1,
        startMoneyMult: 1,
        airWaveInterval: 5,
        countMult: 1,
        payoutMult: 1,
        disableInvestCap: false,
        potionCostMult: 1,
        potionHeal: null,
        spawnShielded: false,
        spawnSplitter: false,
        spawnBoss: false
    };
```

In the same function, change the tier clamp from `ASCENSION_MAX_TIER_M1` to `ASCENSION_MAX_TIER`:

```javascript
    const safeTier = Math.max(0, Math.min(tier || 0, ASCENSION_MAX_TIER_M1));
```

Replace with:

```javascript
    const safeTier = Math.max(0, Math.min(tier || 0, ASCENSION_MAX_TIER));
```

Also inside the modifier-merging loop, the special-case keys need to include the booleans:

```javascript
            if (key === 'disableInvestCap') {
                effects[key] = mod[key];
            } else if (key === 'airWaveInterval' || key === 'potionHeal') {
                effects[key] = mod[key];
            } else {
                effects[key] *= mod[key];
            }
```

Replace with:

```javascript
            if (key === 'disableInvestCap' || key === 'spawnShielded' || key === 'spawnSplitter' || key === 'spawnBoss') {
                effects[key] = mod[key];
            } else if (key === 'airWaveInterval' || key === 'potionHeal') {
                effects[key] = mod[key];
            } else {
                effects[key] *= mod[key];
            }
```

Raise M1 cap. Find `ASCENSION_MAX_TIER_M1 = 7` — **keep it 7** to not break M2's UI cap (M2 limited selector to `ASCENSION_MAX_TIER_M1`). For M3, Run Setup needs to be allowed up to 10.

Find in `src/engine/main.js` every occurrence of `ASCENSION_MAX_TIER_M1` that bounds the Ascension selector or related UI — the ones in `setTier`, `renderAscensionSelector`, `renderScoreTabs`, the clamp on `selectedTier`, etc. Replace `ASCENSION_MAX_TIER_M1` with `ASCENSION_MAX_TIER` in all those sites so A8–A10 become selectable.

In `Game`'s constructor, also change the clamp:

```javascript
        this.ascensionTier = Math.max(0, Math.min((ascensionTier | 0), ASCENSION_MAX_TIER_M1));
```

Replace with:

```javascript
        this.ascensionTier = Math.max(0, Math.min((ascensionTier | 0), ASCENSION_MAX_TIER));
```

- [ ] **Step 2: Spawn Shielded enemies when A8 flag is set**

In `src/engine/game.js`, find the enemy-spawn block in `update`:

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

Replace with:

```javascript
                } else {
                    const newEnemy = new Enemy(this.map.path, this.currentWaveDef.type, this.currentWaveDef.hpMult);
                    if (this.freezeTimer > 0) {
                        newEnemy.frozen = true;
                        newEnemy.frozenFrames = this.freezeTimer;
                    }
                    // M3: A8 Shielded — 40% of enemies get a shield
                    if (this.ascension.spawnShielded && Math.random() < 0.4) {
                        newEnemy.shielded = true;
                        newEnemy.shieldBroken = false;
                    }
                    this.enemies.push(newEnemy);
                    this.enemiesSpawned++;
                    this.spawnTimer = this.currentWaveDef.spawnRate;
                }
```

- [ ] **Step 3: Shield absorbs first projectile hit**

In `src/entities/entities.js`, find every projectile-hit site (the ones we added `if (this.sourceTower) this.sourceTower.damageDealt += dmg;` after in Task 1). Before the `hp -= dmg` line at each site, gate on shield:

```javascript
        // M3: Shielded enemy absorbs first projectile hit.
        if (target.shielded && !target.shieldBroken) {
            target.shieldBroken = true;
            // Consume the hit — no damage, no XP, projectile is still consumed.
        } else {
            target.hp -= dmg;
            if (this.sourceTower) this.sourceTower.damageDealt += dmg;
            if (target.hp <= 0) target.active = false;
        }
```

Apply the same pattern to **every** damage site in entities.js (sniper, shotgun pellet, rocket direct hit, rocket splash, tesla chain, silo rocket, laser direct, plasma AoE, flamethrower cone, burn tick). For splash-radius damage where multiple enemies are hit per shot, apply the shield check per enemy (each enemy's own first-hit is absorbed).

For burn DoT: burn ticks are separate events, each can be gated on shield — but that feels wrong (shield should break on first hit, not first tick). Keep burn ticks NOT-gated (a shielded enemy with a burn still takes DoT damage — shield prevents initial burn application indirectly). Actually: fix the burn APPLICATION in Task 8 (when burn is first set on a shielded enemy, treat it as the absorbed hit) — OR simply don't apply burn to shielded enemies.

Decision for this task: make projectile direct hit and splash damage respect shield; let burn/stun/slow effects apply through shield (otherwise Cryo Blaster becomes useless vs shielded enemies).

- [ ] **Step 4: Visual shield ring**

In `src/render/assets.js`, extend `drawEnemy`. Currently takes optional `slow` and (from Task 8) `burning`. Add `shielded` and draw a cyan ring when `shielded && !shieldBroken`:

```javascript
if (shielded) {
    ctx.save();
    ctx.globalAlpha = 0.7;
    ctx.strokeStyle = '#60e5ff';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(x, y, radius + 4, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
}
```

In `Enemy.draw`, pass `this.shielded && !this.shieldBroken`.

- [ ] **Step 5: Manual verification**

Clear A7 (wave 30 on A7) first to unlock A8 (via existing first-clear flow). Or fast-path grant:

```javascript
save.ascensionCleared = 8; NeonSave.write(save); location.reload();
```

Select A8, start a run. About 40% of enemies should render with cyan shield rings. Hit them once — ring disappears, enemy takes damage on next hit.

- [ ] **Step 6: Commit**

```bash
git add src/config/config.js src/engine/main.js src/engine/game.js src/entities/entities.js src/render/assets.js
git commit -m "$(cat <<'EOF'
M3: A8 Shielded enemy — absorbs first projectile hit

40% of enemies spawned on A8 get shielded. Every damage site in
entities.js respects the shieldBroken flag (first hit breaks shield,
deals zero damage). Burn/slow/stun effects pass through shield (so
Cryo + Flamethrower stay useful). Cyan ring draws while shield intact.
Selector caps extended from ASCENSION_MAX_TIER_M1 to ASCENSION_MAX_TIER.
EOF
)"
```

---

## Task 12: A9 Splitter enemy

**Files:**
- `src/config/config.js` (A9 modifier)
- `src/engine/game.js` (handle split-on-death)
- `src/entities/entities.js` (Splitter fields)
- `src/render/assets.js` (splitter geometry)

- [ ] **Step 1: Activate A9 modifier**

In `src/config/config.js`, find:

```javascript
    { tier: 9, label: 'A9',  name: 'Splitter (M3)', modifier: null,                                          kind: 'enemy-m3' },
```

Replace with:

```javascript
    { tier: 9, label: 'A9',  name: 'Splitter enemy', modifier: { spawnSplitter: true },                     kind: 'enemy-m3' },
```

- [ ] **Step 2: Mark spawned enemies as splitters**

In `src/engine/game.js`, find the spawn block (same place as shielded logic from Task 11). Add alongside the shielded check:

```javascript
                    if (this.ascension.spawnSplitter && Math.random() < 0.3) {
                        newEnemy.splitterGeneration = 1;
                    }
```

- [ ] **Step 3: Spawn child enemies on parent death**

In `src/engine/game.js`, find the enemy-death handling in `update` — where `e.hp <= 0` or `!e.active` leads to reward + `enemies.splice`. Find this block (around the "Base reward with late-game scaling" comment):

```javascript
            } else if (!e.active) {
                // Base reward with late-game scaling
                let reward = e.reward;
                ...
                this.money += reward;
                this.enemies.splice(i, 1);
                this.uiDirty = true;
            }
```

Immediately BEFORE the `this.enemies.splice(i, 1);` line, insert:

```javascript
                // M3: Splitter — spawn 2 half-HP children at death site (generation 1 only).
                if (e.splitterGeneration === 1) {
                    for (let s = 0; s < 2; s++) {
                        const child = new Enemy(this.map.path, e.type, 1);
                        child.x = e.x + (s === 0 ? -8 : 8);
                        child.y = e.y;
                        child.hp = e.maxHp * 0.5;
                        child.maxHp = e.maxHp * 0.5;
                        child.speed *= 0.75;
                        child.splitterGeneration = 2; // children don't split again
                        child.pathIndex = e.pathIndex;
                        this.enemies.push(child);
                    }
                }
```

Note: `e.pathIndex` is the parent's current path index, so children continue from where the parent died rather than restarting from the beginning.

- [ ] **Step 4: Visual — splitter marker**

In `src/render/assets.js`, `drawEnemy` gets a new optional `splitter` param. When true, draw a small orange inner dot:

```javascript
if (splitter) {
    ctx.save();
    ctx.fillStyle = '#f97316';
    ctx.beginPath();
    ctx.arc(x, y, radius * 0.3, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
}
```

In `Enemy.draw`, pass `this.splitterGeneration === 1`.

- [ ] **Step 5: Manual verification**

```javascript
save.ascensionCleared = 9; NeonSave.write(save); location.reload();
```

Select A9, start. About 30% of enemies should have an orange dot. Killing one spawns 2 smaller copies that continue from the death point.

- [ ] **Step 6: Commit**

```bash
git add src/config/config.js src/engine/game.js src/entities/entities.js src/render/assets.js
git commit -m "$(cat <<'EOF'
M3: A9 Splitter enemy — spawns 2 half-HP children on death

30% of enemies on A9 are splitters (generation 1). At death, they spawn
two half-HP, 0.75x-speed children at the death site; children inherit
parent's pathIndex to continue from where the parent fell. Children do
not split again (generation 2 no-op). Orange inner dot marks splitters.
EOF
)"
```

---

## Task 13: A10 Boss enemy

**Files:**
- `src/config/config.js` (A10 modifier)
- `src/engine/game.js` (boss wave pacing)
- `src/entities/entities.js` (boss fields)
- `src/render/assets.js` (boss glow)

- [ ] **Step 1: Activate A10 modifier**

In `src/config/config.js`:

```javascript
    { tier: 10, label: 'A10', name: 'Boss (M3)',    modifier: null,                                          kind: 'enemy-m3' }
```

Replace with:

```javascript
    { tier: 10, label: 'A10', name: 'Boss enemy',    modifier: { spawnBoss: true },                          kind: 'enemy-m3' }
```

- [ ] **Step 2: Spawn a boss every 10 waves when `spawnBoss` is set**

In `src/engine/game.js`, find `startWave`. Immediately after the `this.wave` is incremented / referenced (near the top of the method), add boss wave detection:

```javascript
        // M3: A10 — every 10th wave is a boss wave.
        this.isBossWave = this.ascension.spawnBoss && this.wave > 0 && this.wave % 10 === 0;
```

Place it early, before the investmentFactor calculation.

Then in the enemy-spawn block (same as Task 11/12), add handling so a single boss is spawned on boss waves:

```javascript
                } else if (this.isBossWave && this.enemiesSpawned === 0) {
                    // Spawn one boss and skip the rest of the wave's normal spawns
                    const boss = new Enemy(this.map.path, 'tank', this.currentWaveDef.hpMult);
                    boss.hp *= 20;
                    boss.maxHp *= 20;
                    boss.speed *= 0.5;
                    boss.reward = Math.floor((boss.reward || 0) * 10);
                    boss.radius = Math.max(boss.radius, 20);
                    boss.isBoss = true;
                    this.enemies.push(boss);
                    this.enemiesSpawned = this.currentWaveDef.count; // short-circuit further spawns
                } else {
                    const newEnemy = new Enemy(this.map.path, this.currentWaveDef.type, this.currentWaveDef.hpMult);
                    ...
                }
```

(Merge into the existing else-if chain — this boss-only branch takes priority when `isBossWave` is true.)

- [ ] **Step 3: Boss visual — cyan glow ring**

In `src/render/assets.js`, `drawEnemy` gets an `isBoss` param. When true, draw a larger outer glow:

```javascript
if (isBoss) {
    ctx.save();
    ctx.globalAlpha = 0.6;
    ctx.shadowColor = '#a855f7';
    ctx.shadowBlur = 14;
    ctx.strokeStyle = '#a855f7';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(x, y, radius + 6, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
}
```

In `Enemy.draw`, pass `this.isBoss`.

- [ ] **Step 4: Manual verification**

```javascript
save.ascensionCleared = 10; NeonSave.write(save); location.reload();
```

Select A10. Play to wave 10. A single purple-glowing boss enemy spawns instead of the normal wave. It's enormous HP and slow; killing it awards 10× reward.

- [ ] **Step 5: Commit**

```bash
git add src/config/config.js src/engine/game.js src/entities/entities.js src/render/assets.js
git commit -m "$(cat <<'EOF'
M3: A10 Boss enemy — spawns every 10 waves

On A10, every 10th wave replaces the usual spawn queue with a single
boss: 20x HP, 0.5x speed, 10x reward. Boss uses the 'tank' base type.
Purple glow ring marks it visually. Boss attribution counts through
normal damageDealt paths, so mastery XP scales with boss kills.
EOF
)"
```

---

## Task 14: Autopilot uses Airstrike + Freeze

**Files:** `src/ai/autopilot.js`

- [ ] **Step 1: Airstrike heuristic — trigger when 8+ enemies within 80px of any cluster**

In `src/ai/autopilot.js`, add a new method or block to the autopilot class. Find the `run()` (or equivalent per-tick) method. At its top (or near the start, before tower building logic), add:

```javascript
        this._tryUseAbilities();
```

Then define the method:

```javascript
    _tryUseAbilities() {
        if (!this.game.ability || !this.game.ability.isUsable()) return;
        if (this.game.state !== 'playing') return;

        const kind = this.game.ability.kind;
        if (kind === 'target') {
            // Airstrike — find densest cluster of enemies, strike if >= 8
            let best = null;
            let bestCount = 0;
            for (const e of this.game.enemies) {
                if (!e.active) continue;
                let count = 0;
                for (const o of this.game.enemies) {
                    if (!o.active) continue;
                    const dx = o.x - e.x, dy = o.y - e.y;
                    if (dx*dx + dy*dy <= 80*80) count++;
                }
                if (count > bestCount) { bestCount = count; best = e; }
            }
            if (bestCount >= 8 && best) {
                this.game.ability.tryUse();
                this.game.airstrike(best.x, best.y);
            }
        } else if (kind === 'instant') {
            // Freeze — trigger when HP <= 3 (emergency save)
            if (this.game.health <= 3) {
                this.game.ability.tryUse();
                this.game.freezeAllEnemies(180);
            }
        }
        // kind === 'reveal' (Scan): autopilot ignores info-only abilities.
    }
```

- [ ] **Step 2: Manual verification**

Run a run with AUTO on, Airstrike equipped, at a difficulty where wave count pushes 8+ enemies into cluster (A4+). Autopilot should deploy Airstrike on dense clusters. Similarly test Freeze: let HP drop to 3 and autopilot should freeze the wave.

- [ ] **Step 3: Commit**

```bash
git add src/ai/autopilot.js
git commit -m "$(cat <<'EOF'
M3: Autopilot uses Airstrike (dense cluster) + Freeze (low HP) abilities

Autopilot's per-tick run() now tries abilities first. Airstrike target
is the enemy with the most neighbors inside 80px, triggered at >= 8.
Freeze triggers when game.health <= 3 as an emergency save. Scan is
ignored (pure-info ability).
EOF
)"
```

---

## Task 15: Final smoke test

- [ ] **Step 1: Fresh-save flow**

```javascript
localStorage.clear(); location.reload();
```

Main Menu → Start Run → Pioneer/Standard/None. A0 game. Die. XP + mastery earned.

- [ ] **Step 2: Variant unlock flow**

Grant m1 on `basic`. Reload. Run Setup shows TOWER VARIANTS row with Blaster/Cryo toggle. Select Cryo, launch. Hitting '1' builds Cryo Blaster. Enemies hit visibly slow.

- [ ] **Step 3: Mastery screen**

Main Menu → TOWER MASTERY. 9 rows with XP bars. M1 milestone dots light green for towers with m1.

- [ ] **Step 4: A8/A9/A10 ladder**

Force-unlock to A10:
```javascript
save.ascensionCleared = 10; NeonSave.write(save); location.reload();
```

A8 run: ~40% enemies shielded. A9 run: ~30% enemies split on death. A10 run: boss every 10 waves.

- [ ] **Step 5: Autopilot abilities**

AUTO on with Airstrike / Freeze selected. At A5+ difficulty, autopilot uses abilities at appropriate times.

- [ ] **Step 6: Regression sweep**

```
grep -rn 'TODO\|FIXME\|HACK\|XXX' src/
```
Zero relevant hits.

- [ ] **Step 7: Final commit (if cleanup needed)**

Otherwise: done.

---

## Spec coverage map

| Spec item | Covered by |
|-----------|-----------|
| Damage attribution → mastery XP | Task 1 |
| Mastery tally at game-over + milestones | Task 2 |
| Tower Mastery UI | Task 3 |
| 9 tower variants (data) | Task 4 |
| Run Setup tower loadout | Task 5 |
| Game variant build resolution | Task 6 |
| Cryo, Scatter, EMP, Cluster, Orbital | Task 7 |
| Flamethrower | Task 8 |
| Pulse Laser, Plasma Coil | Task 9 |
| Research Node + autopilot variant awareness | Task 10 |
| A8 Shielded | Task 11 |
| A9 Splitter | Task 12 |
| A10 Boss | Task 13 |
| Autopilot Airstrike/Freeze | Task 14 |
| Smoke test | Task 15 |

---

## Deferred (explicitly out of scope for M3)

- T4 per-tower upgrades (Large scope, not M3).
- Purist (CHIMPS-equivalent) mode.
- Daily-seed leaderboard UI.
- Heat-style composable modifiers.
- Cosmetic skins at m2 milestone are recorded in save but no visual swap — cosmetic implementations deferred unless user asks.

---

## Execution handoff

Plan complete. Two execution options:

**1. Subagent-Driven (recommended)** — 15 tasks, fresh subagent each.
**2. Inline Execution** — executing-plans.

Phase boundaries (after Task 3, Task 10, Task 14) are natural pause points if scope needs to be split.
