# Autopilot Improvement Log

Iterative manual improvements to `src/ai/autopilot.js` and `AUTOPILOT_CONFIG`
in `src/config/config.js`. Each iteration is a single committed change with a
clear hypothesis and (where possible) before/after rationale. Commit policy
mirrors the auto-tune harness: push on improvement; if no improvement, push
every 10th iteration anyway so progress (or lack of it) is recorded.

Companion to `tools/auto-tune/` (the headless multi-worker tuner). This log
covers human-driven changes; the harness's auto-commits land separately under
`Auto-tune:`-prefixed subjects.

## Baseline

Pre-iteration state of the autopilot's known limitations:

- **Throughput**: at most one build OR upgrade per tick (~0.5 s @ 60 fps),
  bottlenecking late-game spend even when income is plentiful.
- **Variant blindness**: scoring uses base-type stats; e.g. `electric` and
  `electric_plasma` get identical placement weights despite different ranges/
  effects.
- **Hover-rocket awareness**: silo placement scoring doesn't penalize multiple
  silos in the same tile cluster (overlapping orbit ranges are wasted spend).
- **Static `wantedCount` curves**: hand-tuned, no awareness of which towers
  are currently overperforming on this seed.
- **No retargeting** of placed towers — `targetMode` set at build time stays
  fixed for the life of the run.

## Iterations

### Iteration 1 — Multi-action per tick

**Hypothesis**: The autopilot's hard cap of 1 build + 1 upgrade per tick
(~0.5 s @ 60 fps default) bottlenecked late-game spend. Auto-tune harness
ceiling at A6 wave 9 is consistent with this — by ~wave 30 income easily
exceeds what one tower or upgrade per half-second can absorb.

**Change**:
- `Autopilot.run()` now loops up to `maxActionsPerTick` (default 4) build/
  upgrade decisions per tick, re-analyzing state each loop.
- Stops early when nothing is actionable or the loop made no spend.
- `_tryUpgrade` now returns `true`/`false` so the loop can detect progress.
- `_tryBuyPotion` only fires on the first pass per tick (HP-driven, not
  spend-driven, so re-evaluating mid-loop adds no value).

**Config**: `AUTOPILOT_CONFIG.maxActionsPerTick = 4`.

**Risk**: Cascading bad decisions if `_analyzeState` produces correlated
picks across loop iterations. Mitigations: state is recomputed each pass
(fresh tower counts, fresh deficit math), and the early-out on zero spend
prevents pathological infinite loops.

**Expected impact**: Most visible past wave 25 where income/sec exceeds
1 tower/sec. No change to early-game pacing — early-game tick spends
~1 action anyway because money is the binding constraint.

### Iteration 2 — Income economy (build earlier, denser, upgrade harder)

**Hypothesis**: Relays compound — each one funds future builds and upgrades
on every wave that follows. The current curve underbuilds them: 1 Relay by
wave 12, ~3 by wave 36. With base 20¢/wave + 5¢/wave per other Relay
(Network upgrade), each Relay pays its 200¢ cost back in ~10 waves and
becomes pure profit thereafter — a strong argument for front-loading them.

**Change**:
- `wantedCount.income`: `w >= 7 ? min(12, max(1, floor(w/12))) : 0`
  → `w >= 5 ? min(14, max(1, floor(w/7))) : 0`.
  First Relay at wave 5 (was 7); 2 Relays at wave 14 (was 24);
  4 Relays at wave 28 (was 48); cap raised 12 → 14.
- `upgradeValue.income`: 2 → 6. Relay upgrades (Efficiency / Overcharge /
  Network) are multiplicatively valuable across the rest of the run, so
  they should compete with mid-tier combat upgrades instead of being last
  priority.

**Risk**: Over-investing in income at the cost of early defense. Bounded
by the existing `buildOrder` (income is last) and the build-deficit
selection — Relays only get picked when other deficits are satisfied or
when the autopilot can afford to.

**Expected impact**: Faster snowball after wave ~10. Slightly tighter
early-game money pre-wave-5 (no change there).

### Iteration 3 — Weighted upgrade comparator (maxing > spreading)

**Hypothesis**: Pure spread (lower-total-level first) is right early but
wastes credits late, when a L4 silo upgrade kills wave HP per second
that 8 L0 basic upgrades can't match.

**Change**: replace the `aTotal === bTotal ? value tiebreak : level spread`
two-stage comparator with a single weighted score:
`score = upgradeValue * 2 - totalLevel`. Silo (10) at L4 = 16 still beats
Basic (3) at L0 = 6 — but Silo at L18 (6 dmg upgrades, 6 splash, etc.) =
2 falls below Basic L0, restoring the spread when one tower runs away.

**Risk**: Air-imminent flak/laser priority preserved (returns early before
the score calc). Per-tower-type concentration might leave some types
under-built — bounded by `wantedCount` driving build phase independently.


