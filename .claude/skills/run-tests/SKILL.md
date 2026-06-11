---
name: run-tests
description: Run and triage the Neon Defense test suite — suite layout, fail-fast runner, smoke tests, multiplayer skips, and CI parity. Use before any commit and when debugging a failing suite.
---

# Running the test suite

`npm test` runs [tests/run.js](../../../tests/run.js): ~55 suites, **sequential and fail-fast** — the first failure stops the run and echoes that suite's stdout/stderr. Fast pure-logic suites run first, Playwright browser flows after. A full green run takes several minutes.

## Commands

| Command | What it runs |
| --- | --- |
| `npm test` | Full suite (no smokes) — same as CI's gate |
| `npm run test:logic` | Just aegis + backpack logic (seconds, no browser) |
| `npm run test:smoke` | Full suite + autopilot smoke + wave450 long-haul (~10 min) |
| `npm run test:perf` | Perf suite, writes [perf-history.json](../../../perf-history.json) |
| `node tests/<name>.test.js` | One suite directly — fastest triage loop |

## Prerequisites

- `npm ci` then `npx playwright install chromium` (CI adds `--with-deps`).
- `src/multiplayer/turn-config.js` must exist or index.html 404s and browser suites break. It's gitignored; `./tools/install-turn-config.sh` writes an empty (STUN-only) bundle when `NEON_TURN_CONFIG` is unset — fine for tests.

## Triage notes

- Browser suites serve the repo via [tests/helpers/http-server.js](../../../tests/helpers/http-server.js) and drive headless Chromium. Failure screenshots land in `/tmp/shots/`.
- `mp-connectivity` and `mp-lobby-act` use **real** Trystero/MQTT signalling and self-skip when the network can't reach brokers. `NEON_MP_FORCE=1` promotes those skips to failures — use before a release, don't be surprised by silent skips otherwise.
- To bisect a slow full run, run the failing suite file directly; each suite is a standalone node script with no shared state beyond the repo files.
- CI ([.github/workflows/test.yml](../../../.github/workflows/test.yml)) runs `npm test` on push/PR and the autopilot smoke in a parallel non-blocking job. Pages deploy and APK build are both gated on `npm test` passing.

## Adding a suite

Create `tests/<name>.test.js` (standalone node script, exit non-zero on failure) and register it in the `SUITES` array in `tests/run.js` — logic tests near the top, browser flows after. Unregistered test files never run in CI.
