# Autopilot Test Results & Findings

_Session: 2026-05-08 — token budget exhausted, picking up next session_

## Seeds Used
- `42000` — hard map, good regression test (baseline: gameover wave 117)
- `77777` — medium map, survived wave 300 consistently
- `12345` — medium-hard map, survived wave 300 (low HP ~6-7)

## Test Setup
```
SEED=<seed> PORT=<port> SPEED=2048 node test-autopilot.js
# 6 runs at 2048x speed, 3 seeds × 2 runs
```

## Key Findings

### Wave Difficulty Spikes (game.js — do NOT change)
The investment factor formula has hard minimum jumps at wave boundaries:
- Waves 1–35: investmentFactor floor = 4×
- Waves 36–55: investmentFactor floor = 6× ← **+50% spike at wave 36!**
- Waves 56–100: investmentFactor floor = 8× ← **+33% spike at wave 56!**

These floors apply REGARDLESS of how much (or little) the player has invested.
Normal enemy HP at wave 38 = 20 (base) × 2.5 (hpMult) × 4.07 (baseExpFactor) × 6 (investFactor) ≈ **1220 HP**.

These spikes are intended game design and should NOT be modified.

### Seed 42000 Regression Root Cause
Before this session's changes: died wave 117.
Mid-session regression: died wave 57–67.

Root causes identified (all fixed):
1. **Laser underconstruction**: sniper ($100) cheaper than laser ($200), so sniper always won affordable-fallback slot. Result: 12 snipers vs 5 lasers at wave 37 (wanted: 13 vs 10). Fixed by inverting: laser `ceil(w/3)` > sniper `ceil(w/5)`.
2. **Potion never purchased**: autopilot spent every $50–100 on towers before accumulating $150 for a potion. After wave-36 spike (HP drops 20→12), money never reached $150 in subsequent waves because towers consumed every payout. Fixed by: raising threshold to 12, moving `_tryBuyPotion` to run FIRST (before build/upgrade), adding `savingForPotion` state that blocks both builds and upgrades.
3. **Silo misplacement**: `_typeShapeBonus` gave silos a PENALTY for path-adjacency (designed for rockets). Silo range = 100px = 2.5 tiles — it **must** be near path. Fixed by separating silo from rocket in shape bonus.

### Autopilot Changes Made This Session

#### `src/config/config.js`
- `wantedCount.laser`: `ceil(w/4)` → `ceil(w/3)` (up from 18 cap to 30)
- `wantedCount.sniper`: `ceil(w/3)` → `ceil(w/5)` (down from 60 cap to 40)
- `wantedCount.rocket`: `ceil(w/3.5)` → `ceil(w/4)` (down from 60 cap to 45)
- `wantedCount.basic`: floor raised from 4 to 5
- `wantedCount.rapid`: `ceil(w/6)` → `ceil(w/7)`
- `wantedCount.silo`: `ceil(w/4.5)` → `ceil(w/5)` (cap 35→25)
- `potionHealthThreshold`: 5 → **12** (buy potion before critical)
- `upgradeAlongsideBuild: 200` (new) — upgrade even after building if money exceeds threshold
- `buildOrder`: `['flak','laser','sniper','rocket','silo','electric','basic','rapid','income']`

#### `src/ai/autopilot.js`
- `run()`: `_tryBuyPotion` now runs FIRST (before build/upgrade), then `savingForPotion` state set
- `_tryBuild()`: returns false immediately if `savingForPotion`
- `_tryUpgrade()`: returns immediately if `savingForPotion`
- `_tryBuyPotion()`: removed tower-savings guard (survival > saving)
- `_findBuildableSpots()`: adjacent-first fallback (when adjacent exhausted, return all buildable)
- `_tryBuild()`: clears `savingForTower` when map is full or no valid placement
- `_scorePlacement()`: `-9999` sentinel for non-adjacent combat towers with no path coverage
- `_typeShapeBonus()`: silo now prefers path-adjacency (`orthoNeighbors * 3 + pathCoverage * 0.5`)

## Pending Improvements (next session)

### Priority 1: More parallel test coverage
- Run 6+ seeds simultaneously to find other problem seeds
- Minimum viable seeds: 42000, 77777, 12345, plus 3 new random seeds

### Priority 2: Money accumulation in late game
- At wave 150–300 with map full, money piles up ($200–400 idle)
- `upgradeAlongsideBuild: 200` helps but not enough — need better upgrade spending
- Consider: more aggressive upgrade priority, or raise upgrade value weights

### Priority 3: Electric tower underutilization
- Electric (Tesla, $300): 25 dmg × 3 chains = huge DPS, very underbuilt
- At wave 37: 3 electric (wanted 7) — big deficit
- Fix: raise electric wantedCount or move it earlier in buildOrder

### Priority 4: Late-game composition at map saturation
- At wave 200+: basic count grows (33 basics, only 15 rapid)
- Basic is weakest tower — at map full, should upgrade existing towers rather than fill with basics
- Fix: once map is 80%+ full, stop building basics/rapids and focus on upgrades

### Priority 5: Upgrade strategy
- Upgrade comparator currently spreads upgrades (lowest-total-level first)
- Consider: concentrate upgrades on highest-damage towers (laser, electric, silo)
- `upgradeValue: { silo: 10, rocket: 9, electric: 8, sniper: 7, laser: 6, ... }` — may need rebalancing

## Test Baseline (before this session)
| Seed  | Outcome       | Notes |
|-------|---------------|-------|
| 42000 | Wave 117 GAMEOVER | Hard map |
| 77777 | Wave 300+ survive | Easy map |
| 12345 | (not tested) | |

## Test Results (end of this session)
Final run (2048x speed, 3 seeds × 2 parallel) — all fixes applied:
| Seed  | Run 1         | Run 2         | Notes |
|-------|---------------|---------------|-------|
| 42000 | Wave 300 HP=15 ✓ | Wave 300 HP=13 ✓ | FIXED — was dying wave 58 |
| 77777 | Wave 300 HP=15 ✓ | Wave 300 HP=14 ✓ | ✓ Stable |
| 12345 | Wave 300 HP=14 ✓ | Wave 300+ HP=13 ✓ | ✓ Fixed inconsistency |

Wave 38 on seed=42000: HP=20 (was HP=18 before fix, then 17→4 earlier).
Wave 50 on seed=42000: HP=20 (was HP=9 before fix).

**All seeds survive to wave 300 with 13–15 HP. Regression fully resolved.**
