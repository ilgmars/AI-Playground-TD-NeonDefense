---
name: release
description: How Neon Defense ships — GitHub Pages deploy, cache-bust pre-commit hook, and the Android APK pipeline. Use when committing/pushing, debugging stale-asset reports, or touching the APK.
---

# Shipping a change

There is no build step. Pushing to `main` triggers three workflows, all gated on `npm test`:

- **[pages.yml](../../../.github/workflows/pages.yml)** — deploys the repo root to <https://ilgmars.github.io/AI-Playground-TD-NeonDefense/>.
- **[build-apk.yml](../../../.github/workflows/build-apk.yml)** — builds, signs, audits, and releases the APK (fires when `src/**`, `index.html`, `style.css`, or `android/**` change).
- **[test.yml](../../../.github/workflows/test.yml)** — the suite plus a parallel non-blocking autopilot smoke.

## Before committing

- After a fresh clone, run `./tools/install-hooks.sh` once. The pre-commit hook runs [tools/bump-cache.sh](../../../tools/bump-cache.sh), which rewrites every `?v=<timestamp>` token in index.html whenever a commit touches `src/`, `style.css`, or `index.html`. **Without the hook, deploys ship stale-cached JS/CSS to returning visitors** (Pages serves HTML with `max-age=600`, assets with `max-age=3600`). If the hook isn't installed, run the script manually and include the index.html bump in the same commit.
- `src/multiplayer/turn-config.js` is **gitignored** (TURN credentials). Never commit it; CI materialises it from the `NEON_TURN_CONFIG` secret via `tools/install-turn-config.sh`.

## Android APK

- The APK is a WebView wrapper ([ANDROID.md](../../../ANDROID.md)). CI **re-syncs** `android/app/src/main/assets/www/` from the repo root at build time, so the committed mirror being stale does not affect released APKs.
- Manual `assets/www` syncing is only needed for **local** Gradle builds (see ANDROID.md, including the JDK 17 requirement).
- The repo-root [NeonDefense.apk](../../../NeonDefense.apk) is the canonical distribution copy; CI uploads each build's APK + SHA-256 as artifacts/release assets.

## Verifying a deploy

Pages HTML revalidates within ~10 minutes. To confirm a deploy landed, fetch the live index.html and check the `?v=` token matches the latest commit's. For multiplayer-affecting releases, run the connectivity suites with skips promoted to failures: `NEON_MP_FORCE=1 node tests/mp-connectivity.test.js && NEON_MP_FORCE=1 node tests/mp-lobby-act.test.js`.
