# Codex Handoff - 2026-05-09

## Current User Requests

- Continue AI autopilot tests.
- Fix bug: autopilot is not using prestige tower variants.
- Commit and push every improvement.
- Keep this handoff updated so work can continue later.

## Repository

- Active repo: `/home/claude/AI-Playground-TD-NeonDefense`
- Branch: `main`
- Remote: `origin https://github.com/ilgmars/AI-Playground-TD-NeonDefense.git`
- GitHub CLI login was completed as `ilgmars`.
- Latest pushed commit before current work: `8ee8962 Improve autopilot builder strategy`

## Completed This Turn

- Installed Playwright Chromium with `npx playwright install chromium` because the local autopilot harness could not launch Chromium.
- Started a bounded A6 auto-tune sweep:
  - `WORKERS=12 ITERATIONS=4 ASCENSION=6 GAME_SPEED=5000 AUTOTUNE_COMMIT=0 node tools/auto-tune/main.js`
  - Initial attempt failed only because Playwright browser binaries were missing.
  - Sweep was paused when the user redirected to the prestige tower variant bug.
- Patched `src/ai/autopilot.js` so autopilot decisions resolve the effective tower type through `game.getEffectiveTowerType()`:
  - saving thresholds now use effective variant costs
  - affordability checks use `game.canAfford()`
  - fallback build candidates are limited to base build-order entries and then resolved to variants by `Game.buildTower()`
  - placement scoring uses effective variant range, while shape heuristics still use the base tower role
  - upgrade priority now scores variants by `baseOf(t.type)` so variants inherit base priority weights
- Added `--variants` / `VARIANTS=1` support to `test-autopilot.js`:
  - sets `selectedTowerLoadout = { ...TOWER_VARIANTS }` before run start
  - prints raw `typeCounts` so verification can prove actual variant tower IDs were built

## Current Uncommitted Files

- `src/ai/autopilot.js`
- `test-autopilot.js`
- `docs/ai/codex.md`

## Verification Completed

Focused variant run:

```bash
node test-autopilot.js --variants --port=8921 --ascension=0 --speed=5000 --seed=42069 --snapshots=2,3,4,5,6,7,8,9,10
```

Result: passed. Autopilot built actual prestige variant IDs:

- wave 6: `basic_cryo`, `flak_emp`, `sniper_scatter`
- wave 25: `basic_cryo`, `flak_emp`, `sniper_scatter`, `laser_pulse`, `rocket_cluster`, `rapid_flame`

## Next Commit

After verification, commit and push:

```bash
git add src/ai/autopilot.js test-autopilot.js docs/ai/codex.md
git commit -m "Make autopilot respect tower variants"
git push origin main
```

## Notes

- `Game.buildTower(c, r, type)` already resolves base tower types to the selected variant through `getEffectiveTowerType()`.
- The bug was in autopilot pre-build decisions reading `TOWERS[base]` directly, so it could save/score/upgrade as if the base tower would be built.
- If the user expects unlocked variants to be chosen automatically without selecting them in Run Setup, that is a separate UX/loadout default change. Current patch respects the selected loadout correctly.
