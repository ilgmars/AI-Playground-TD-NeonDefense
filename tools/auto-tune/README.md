# Auto-tune harness

Iterative parameter search for `AUTOPILOT_CONFIG`.

- 6 parallel workers, each running the game headless via Playwright at 2048× speed.
- Identical PRNG seed across all workers (deterministic runs).
- No Retire bonus — bot fights to game-over.
- On reaching wave 300, the worker restarts the run with `ascensionLevel + 1` (same params).
- Winner per iteration: highest `XP/sec` at the highest reached `Ascension`.
- Winner params seed the next iteration; 5 mutated variants run alongside the control.

See `main.js`, `worker.js`, `best-params.json`.
