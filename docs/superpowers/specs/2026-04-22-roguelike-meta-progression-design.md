# Roguelike Meta-Progression & Difficulty Levels — Design

- **Date:** 2026-04-22
- **Status:** Design approved — ready for implementation planning
- **Related:** [docs/superpowers/research/2026-04-22-td-roguelike-patterns.md](../research/2026-04-22-td-roguelike-patterns.md)

## Problem

The current game's difficulty curve flattens after ~wave 60: wave-based HP growth drops to logarithmic forever, and the investment-factor scaling has aggressive soft caps (`sqrt` at wave 21, `log` at wave 56+) that prevent enemy HP from keeping pace with player power. Recent tuning commits ("AI survived until wave 437", "200+ a bit too easy") confirm the trend. The game becomes trivial in late-game, and every run is mechanically identical.

### Relation to existing `DIFFICULTY` code (commit 645ce59)

While this design was being drafted, commit `645ce59` landed a simpler Easy/Normal/Hard preset system (`DIFFICULTY` object in `config.js`, constructor arg on `Game`, pre-run picker UI, multipliers on HP/count/payout). This design **supersedes** that system:

- Ascension 0 subsumes Easy (1.0× baseline).
- Ascensions 1–10 provide a finer-grained, roguelike ladder in place of 3 presets.
- Milestone 1's first work item is replacing the 3-preset picker with the Ascension selector. `DIFFICULTY` becomes `ASCENSION_TIERS` (or the stat modifiers move inline into tier definitions).
- The shipped code in 645ce59 is a useful reference implementation for how multipliers plug into `Game.startWave()` — we inherit the mechanism and change the shape.

## Goals

1. **Scalable challenge** — provide difficulty levels that can be climbed over time, where the hardest tiers remain interesting for hundreds of hours.
2. **Meaningful between-run progression** — players "advance and become better" via persistent unlocks that reward play.
3. **Replayability** — runs feel different from each other via player-chosen loadouts.
4. **No regression for returning players** — existing content remains available immediately; new systems are additive.

## Non-goals (v1)

- Fourth-tier "premium" tower upgrades (deferred to Large scope).
- Purist mode (CHIMPS-equivalent) / daily-seed leaderboard (deferred to Large scope).
- Vertical permanent stat boosts (e.g., "+10% damage forever"). Explicitly rejected to preserve balance.
- Save-resume mid-run.
- Multi-stage runs (sequence of maps per run).

## Design decisions (with rationale)

| Decision | Choice | Rationale |
|---------|--------|-----------|
| Run shape | Endless with milestones | Matches existing game shape; wave 30 becomes a "clear" marker without removing endless play. |
| Progression flavor | Horizontal (new options) + Ascension (stacked difficulty) + Tech tree | Research: unlocks should expand the sandbox, difficulty should tighten constraints. Horizontal-only avoids grind-trivialization. |
| Starting state | All current towers and upgrades available on fresh save | Returning players must not be nerfed. Tree is pure expansion. |
| Difficulty model | Stacking Ascension (Slay the Spire), 10 tiers | Simplest UI (a single number), each tier adds one hand-tuned modifier, research-validated pattern. |
| Tech tree | ~15 nodes in 3 tiers, 2 nodes of each tier required to open the next | Small enough to design + balance, big enough to matter. |
| Tower progression | Per-tower mastery tracks (separate from meta-XP) | Each tower earns its own XP by damage dealt; mastery unlocks variants + cosmetics per-tower. Research pattern #4. |

## Persistent save schema

Single `localStorage['neonDefense.save']` JSON blob:

```
{
  version: 1,
  metaXP: number,                     // current spendable XP
  totalXPEarned: number,              // lifetime, for stats
  ascensionCleared: 0..10,            // highest tier where wave 30 was reached
  unlockedNodes: ["hero.pioneer", "variant.cryo_blaster", ...],
  towerMastery: {
    basic:  { xp: number, milestones: { m1: bool, m2: bool } },
    sniper: { xp, milestones },
    rapid:  { xp, milestones },
    laser:  { xp, milestones },
    rocket: { xp, milestones },
    flak:   { xp, milestones },
    electric: { xp, milestones },
    silo:   { xp, milestones },
    income: { xp, milestones }
  },
  highScores: { a0: wave, a1: wave, ..., a10: wave },
  settings:   { skipRunSetup: bool }
}
```

### Migration

On first load after the upgrade:

1. If `neonDefense.save` is absent:
   - Create a fresh schema-v1 save.
   - If legacy `neonDefenseScores` exists, copy it to `save.highScores.a0` and grant **200 welcome XP** (~2 Tier-1 nodes). Show a one-time welcome popup explaining the new systems.
   - Pre-unlock the default starter nodes (Pioneer hero, Standard Kit).
2. If `neonDefense.save` is present and `version < current`, run the appropriate migration; bump version.

## Run loop

```
[Main Menu] → [Run Setup] → [Game] → [Run Result] → back to Menu / Setup
```

### Run Setup Screen (new)

Shown before every run unless `settings.skipRunSetup === true`. Form fields:

1. **Ascension tier** — dropdown `0` to `ascensionCleared + 1`. Displays the stacked modifiers active at that tier.
2. **Hero** — dropdown over unlocked heroes (default: Pioneer).
3. **Starter Kit** — dropdown over unlocked kits (default: Standard).
4. **Active Ability** — dropdown over unlocked abilities (includes "None").
5. **Tower Loadout** — grid of 9 tower cards; each allows base-or-variant selection when the variant is unlocked for that tower.
6. Buttons: **[Randomize]** (helper) and **[Start Run]**.

### Run Result Screen (new)

Replaces the bare game-over overlay.

- Wave reached + Ascension tier + seed (copyable).
- Meta-XP earned, broken down by component.
- Per-tower Mastery XP gained, with progress bars toward next milestone; fire-off callouts for any newly-hit milestone.
- Newly-unlocked Ascension tier surfaced if wave ≥ 30 on the current highest tier.
- Buttons: **[Play Again (same setup)]**, **[New Setup]**, **[Tech Tree]**, **[Main Menu]**.

## Meta-XP economy

```
waveXP          = min(wave, 30) + max(0, wave - 30) * 0.5     // diminishing past wave 30
tierMult        = 1 + ascensionTier * 0.5                      // A10 = 6.0×
clearBonus      = (wave >= 30) ? 50 : 0
firstClearBonus = (cleared a NEW ascension tier this run) ? 100 : 0

runXP = (waveXP * tierMult) + clearBonus + firstClearBonus
```

### Example yields

| Wave reached | Ascension | XP earned | Note |
|-------------:|:---------:|----------:|------|
| 10 | 0 | 10 | Bad run, still rewarded |
| 30 | 0 | 80 | First clear: +100 → 180 |
| 30 | 5 | 155 | First clear at A5: +100 → 255 |
| 100 | 10 | 440 | Endless bonus kicks in |

**Mastery XP** is separate: each in-run tower accrues mastery XP equal to damage dealt; tallied at game-over and added to `towerMastery[type].xp`. Milestones fire at 1,000 and 10,000 XP.

## Ascension system

10 tiers. Each tier adds one fixed modifier **cumulatively** — A5 includes all of A1–A5's modifiers. A new tier unlocks when the player reaches **wave 30** on the current highest tier (skill-gated, not grind-gated).

Ordering principle: all stat-only modifiers first (A1–A7), all new-enemy modifiers last (A8–A10). This lets Milestone 1 ship a contiguous A0–A7 ladder without any enemy-type engineering, and Milestone 3 adds the top-end new-enemy tiers.

| Tier | Modifier | Kind | Rationale |
|------|----------|------|-----------|
| A1 | +15% enemy HP | stat | Gentle baseline bump. |
| A2 | −25% starting money | stat | First economic pressure. |
| A3 | Air waves every 4 waves instead of 5 | stat | AA pressure. |
| A4 | +15% enemy count per wave | stat | Crowd pressure compounds with A1. |
| A5 | −40% wave payout | stat | Serious economy squeeze. |
| A6 | Investment-factor soft caps removed | stat | Addresses current "too easy late" root cause directly. |
| A7 | Potions cost 2× and heal 1 HP | stat | Caps late-game safety net. |
| A8 | New enemy: **Shielded** (ignores first hit of every projectile) | enemy | Forces multi-shot towers into loadout. |
| A9 | New enemy: **Splitter** (ground/air; splits into 2 weaker copies on death) | enemy | Changes splash calculus. |
| A10 | **Boss** every 10 waves (high HP, big reward if killed) | enemy | Loadout-defining endgame. |

### New enemy behaviors (A3, A7, A8)

- **Shielded** — the first projectile to hit this enemy deals zero damage and is consumed; subsequent hits behave normally. Applies per pellet for Shotgun-style multi-projectile volleys (each pellet is a projectile, so a single Shotgun blast can break the shield *and* damage the enemy). Visual: shield ring that fades on first hit.
- **Splitter** — on death, spawns 2 scaled-down copies (50% HP, 75% speed) that themselves do NOT split further. Both ground and air variants.
- **Boss** — unique enemy, 20× normal HP, 0.5× speed, 10× reward. Only spawns at wave 10/20/30/etc. One at a time.

## Tech Tree

**Structure:** 3 tiers × ~5 nodes each, 15 total. Must own 2 nodes in the previous tier to open the next.

**Costs:** Tier 1 = 50 XP · Tier 2 = 200 XP · Tier 3 = 500 XP.

**Pre-unlocks on fresh save:** Pioneer hero + Standard Kit (2 Tier-1 nodes; opens the gate to Tier 2 partially by default).

**Ascension-gated free unlocks:** clearing specific Ascensions auto-unlocks nodes without XP spend:
- Clear A1 → free Tier-1 node (currently Economist Kit)
- Clear A3 → free Tier-2 node (currently Enemy HP bars)
- Clear A5 → free Tier-3 node (currently Daily Seed — deferred content; use as placeholder)
- Clear A7 → free Tier-3 node (currently Skip Setup)
- Clear A10 → cosmetic banner

### Tier 1 — Starters (50 XP)

| Node ID | Name | Effect |
|---------|------|--------|
| `hero.pioneer` | **Pioneer** *(pre)* | +25% starting money ($125 → $156) |
| `kit.standard` | **Standard Kit** *(pre)* | Default loadout (no-op node for completeness) |
| `hero.engineer` | **Engineer** | −10% tower cost, −5% upgrade cost |
| `ability.scan` | **Scan** | Ability: reveal the next 3 waves' composition — enemy type + count per wave (not HP values). 1 charge/run. |
| `kit.economist` | **Economist Kit** | $75 start, but pre-placed free Relay |

### Tier 2 — Core (200 XP)

| Node ID | Name | Effect |
|---------|------|--------|
| `hero.warden` | **Warden** | +5 max HP; potions heal +1 |
| `ability.airstrike` | **Airstrike** | Click-target AoE, 200 dmg / 80 px radius, 3 charges/run |
| `kit.medic` | **Medic Kit** | +2 starting potions; potions cost 1.5× |
| `qol.hpbars` | **Enemy HP bars** | Toggle showing HP over each enemy |
| `qol.fastai` | **Fast Autopilot** | Autopilot tick interval 15f (from 30f) |

### Tier 3 — Advanced (500 XP)

| Node ID | Name | Effect |
|---------|------|--------|
| `ability.freeze` | **Freeze Wave** | Stop all enemies 3s (1 charge/run) |
| `kit.strategist` | **Strategist Kit** | See all future wave compositions (type + count, not HP) for the entire run; −20% starting money |
| `qol.dailyseed` | **Daily Seed** | Unlocks a daily-seed run option on the Main Menu (fixed per-date seed for shared-challenge runs). The local leaderboard UI for daily scores is deferred to v2 — v1 just enables the deterministic seed. |
| `qol.skipsetup` | **Skip Setup** | Reveals the `settings.skipRunSetup` toggle; when enabled, launching a new run reuses the last loadout and skips the Run Setup screen. |
| `qol.ascpreview` | **Ascension +1 preview** | Preview next tier's modifier before unlocking |

## Tower Mastery

**XP source:** per in-run tower, damage dealt is summed and added to `towerMastery[type].xp` at game-over — regardless of run outcome. Encourages trying each tower on lower Ascension tiers.

**Milestones per tower:**

| Milestone | XP threshold | Reward |
|-----------|--------------|--------|
| M1 | 1,000 | Unlocks the tower's **variant** (selectable in loadout) |
| M2 | 10,000 | Unlocks the tower's **cosmetic skin** (visual only) |

### The 9 tower variants

Each variant replaces the base in the loadout slot when selected. Designed to change identity, not raw power.

| Base Tower | Variant | Identity shift |
|-----------|---------|----------------|
| Blaster | **Cryo Blaster** | −50% damage, applies 0.3 slow for 1s |
| Sniper | **Scatter Sniper** | 2 shots per volley, −40% range, no pierce |
| Shotgun | **Flamethrower** | Short cone, DoT burn, no pellets/pierce |
| Laser | **Pulse Laser** | 1 Hz pulsed high-damage shots, no slow |
| Rocket | **Cluster Rocket** | Splits into 4 mini-rockets on impact, smaller per-splash |
| Flak | **EMP Flak** | Low damage, stuns air units 1s |
| Tesla | **Plasma Coil** | Continuous AoE, no chain |
| Silo | **Orbital Strike** | Massive strike every 8s, 3× damage, long charge |
| Relay | **Research Node** | No income; +2% damage to all towers within 3 tiles |

Variant definitions live in `TOWERS[variantType]` alongside base towers in `src/config/config.js`, with a `baseType` backref.

## Hero catalog

| ID | Hero | Passive effect |
|----|------|----------------|
| `hero.pioneer` | **Pioneer** *(pre-unlocked)* | +25% starting money |
| `hero.engineer` | **Engineer** | −10% tower cost, −5% upgrade cost |
| `hero.warden` | **Warden** | +5 max HP; potions heal +1 |

## Starter Kit catalog

| ID | Kit | Effect |
|----|-----|--------|
| `kit.standard` | **Standard** *(pre-unlocked)* | $125 start, 0 potions, no preplace |
| `kit.economist` | **Economist** | $75 start + pre-placed free Relay |
| `kit.medic` | **Medic** | +2 potions; potions cost 1.5× during run |
| `kit.strategist` | **Strategist** | See all wave compositions; −20% starting money |

## Active Ability catalog

| ID | Ability | Effect |
|----|---------|--------|
| `ability.scan` | **Scan** | Reveal next 3 waves' composition, 1 charge/run |
| `ability.airstrike` | **Airstrike** | Click-target AoE, 200 dmg / 80 px, 3 charges/run |
| `ability.freeze` | **Freeze Wave** | Freeze all enemies 3s, 1 charge/run |

## UI surfaces (summary)

All new screens are HTML panels overlaid on the canvas, toggled via a `.hidden` CSS class. No routing lib.

- **Main Menu** — expanded landing: Start / Tech Tree / Mastery / Scoreboard / Settings.
- **Run Setup Screen** — loadout form (Ascension, Hero, Kit, Ability, Tower Loadout).
- **In-run HUD additions** — Ascension tier shown next to wave counter; ability button with charges.
- **Run Result Screen** — XP breakdown + mastery gains + unlocks.
- **Tech Tree Screen** — 3-column grid of 15 nodes with states (owned / affordable / locked / pre-unlocked).
- **Tower Mastery Screen** — 9 tower rows with XP bars and milestone dots (can be a tab in Tech Tree).

Scope estimate: ~300–500 lines of HTML + ~200–400 lines of CSS.

## Autopilot integration

**Relationship:** autopilot respects the player's loadout (heroes, kits, variants, ability), but the player picks the loadout.

- Reads hero discount to adjust buy/upgrade budgets.
- Reads kit starting state (e.g., Economist's pre-placed Relay) and skips re-building it.
- Treats variants as equivalent to base for build decisions; per-variant scoring weights live in `TOWERS[variantType]`.
- Uses abilities by heuristic:
  - **Airstrike** when ≥ 8 enemies within any 80 px circle.
  - **Freeze Wave** when HP ≤ 3.
  - **Scan** never (info-only; autopilot ignores).
- `AUTOPILOT_CONFIG.tickInterval` halved to 15 when `qol.fastai` node is owned.

Per-tier tuning of autopilot is out of scope for v1 — autopilot performance on each Ascension tier is observed, not hand-tuned.

## Implementation phasing (3 milestones)

Each milestone is playable and shippable on its own.

### Milestone 1 — Skeleton (~4–5 days)
- **Retire the 645ce59 Easy/Normal/Hard picker** — replace with Ascension selector; port the multiplier-application mechanism into the new system.
- Save schema + migration from legacy scoreboard (include a note that any old `difficulty` field is dropped; default new saves to Ascension 0).
- Run Setup + Run Result screens (minimal versions).
- Meta-XP earn/spend system (XP accumulates; not yet spendable).
- Ascensions A0–A7 (all stat-only tiers, no new enemy types yet).
- **Ships as:** difficulty levels via Ascensions 0–7; XP visible but unspendable.

### Milestone 2 — Tech Tree + Content (~5–6 days)
- Tech Tree UI + node purchase flow.
- All 3 Heroes, 3 Abilities, 4 Kits, 5 QoL nodes — effects plumbed into Game.
- Main Menu expanded; Tech Tree reachable.
- **Ships as:** full horizontal progression, complete 15-node tree.

### Milestone 3 — Mastery + Variants + Hard Ascensions (~4–5 days)
- Per-tower mastery tracking + Tower Mastery UI.
- 9 tower variants defined in config; selectable in loadout.
- Ascensions A8–A10 — new enemy types (Shielded, Splitter, Boss).
- Autopilot awareness of variants and abilities.
- **Ships as:** complete Medium scope.

Stopping at M1 or M2 still yields a strictly-better game than today.

## Risks / open knobs

1. **Balance combinatorics.** 10 Ascensions × base/variant × 3 heroes × 4 kits × 3 abilities is a large surface. Approach: balance A0 default loadout, A5 midpoint, A10 max; interpolate; patch outliers from play data.
2. **Autopilot tuning for new surface.** Current `AUTOPILOT_CONFIG` is tuned for default loadout; will need incremental retuning as variants/heroes/kits land. Treat autopilot wave-30-clear rate per Ascension as the balance signal.
3. **Debug fast-forward cheat.** Recommended: add a URL param (e.g., `?startWave=20&money=5000`) gated on a localStorage dev flag, to speed balance iteration without full playthroughs.
4. **Save-data backwards compat.** `save.version` present from day one; future schema changes migrate.
5. **UI responsive behavior.** New screens must use the same flex-column-center pattern as existing overlays; verify on mobile viewport.
6. **New enemy code footprint.** Shielded, Splitter, Boss require new code in `entities.js` and render paths in `assets.js`. Splitter's spawn-on-death is the non-trivial one. Budget ~30% of M3's effort for these.

## Deferred (out of scope for v1)

- T4 premium upgrades per tower (Large scope).
- Purist / CHIMPS-equivalent mode with separate leaderboard (Large scope).
- Daily seed leaderboard *beyond* unlocking the feature node — the actual leaderboard UI is deferred (Large scope).
- Heroic / Iron Challenge modes.
- AI-level system for autopilot as second progression axis.
- Multi-map / multi-stage runs.
- Heat-style composable modifiers on top of Ascension.

## Research appendix

Full patterns doc at [docs/superpowers/research/2026-04-22-td-roguelike-patterns.md](../research/2026-04-22-td-roguelike-patterns.md). Key patterns pulled:

- **Rogue Tower** — half the tech tree pre-unlocked for first-run fairness.
- **Slay the Spire** — Ascension as skill-gated stacking modifiers.
- **Hades** — per-weapon independent progression tracks.
- **BTD6 CHIMPS** — hardest mode disables meta (deferred to v2).
- **Kingdom Rush: Vengeance** — progression currency separated from challenge content.
