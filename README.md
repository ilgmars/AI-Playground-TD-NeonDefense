# Neon Defense

[![Tests](https://github.com/ilgmars/AI-Playground-TD-NeonDefense/actions/workflows/test.yml/badge.svg)](https://github.com/ilgmars/AI-Playground-TD-NeonDefense/actions/workflows/test.yml)
[![Build APK](https://github.com/ilgmars/AI-Playground-TD-NeonDefense/actions/workflows/build-apk.yml/badge.svg)](https://github.com/ilgmars/AI-Playground-TD-NeonDefense/actions/workflows/build-apk.yml)
[![Built by AI only](https://img.shields.io/badge/built%20by-AI%20only-c084fc?style=flat&labelColor=0f172a)](#about-this-project)
[![License: Apache 2.0](https://img.shields.io/badge/license-Apache%202.0-38bdf8?style=flat&labelColor=0f172a)](LICENSE)

> A neon-themed browser tower-defence game with an endless roguelike loop,
> a Backpack-Hero-style spatial inventory, and an honor-system anti-tamper
> layer.

**Web:** <https://ilgmars.github.io/AI-Playground-TD-NeonDefense/>

**Android APK:** <https://github.com/ilgmars/AI-Playground-TD-NeonDefense/releases>

---

## About this project

> ⚠️ **This project is intentionally built _only_ with AI tools.**
>
> Every line of code, every test, every commit message, every README
> revision is produced by an AI assistant under human direction. **No
> manual code interference is allowed** — the human contributor's role
> is limited to:
>
> - asking for features, fixes, balance changes;
> - reading the AI's diffs, screenshots and test results;
> - approving or rejecting what the AI produces.
>
> If something is wrong or unclear, the workflow is to ask the AI to fix
> it — not to open the editor and patch it by hand. This is the
> experiment: how far can a real, playable, tested game ship when the
> human stays strictly off the keyboard?

If you fork or contribute, the same rule applies in spirit: route
changes through your AI of choice. The CI gate (see below) treats every
push the same way regardless of who or what wrote it.

---

## Running locally

```sh
# Open in a browser — no build step.
python3 -m http.server 8000
# then visit http://localhost:8000
```

There is no bundler, no transpiler, and no framework. Everything is
vanilla JS, one canvas, and a couple of CSS files. See
[CLAUDE.md](CLAUDE.md) for the architectural notes.

## Tests

The test suite runs **before** every APK build via GitHub Actions —
[`build-apk.yml`](.github/workflows/build-apk.yml) declares
`needs: test`, so the APK only ships if every suite is green. Pull
requests and pushes to `main` also run a standalone test job
([`test.yml`](.github/workflows/test.yml)).

```sh
npm install
npx playwright install chromium    # one-time, for browser flows
npm test                           # runs all 8 suites (~90s)
npm run test:logic                 # node-only fast subset (<1s)
npm run test:smoke                 # adds the autopilot smoke (~3 min)
```

The runner ([`tools/run-tests.js`](tools/run-tests.js)) is sequential
and fail-fast — the first broken suite stops the run and dumps its
stdout / stderr so the CI logs explain what regressed.

## Anti-tamper (Aegis)

The source is public, so the anti-cheat is honor-system armour rather
than cryptography. Three independent layers — signed saves, behaviour
sensors, and live state audits — make the obvious cheats visible and
consequential. The full design notes are at the top of
[`src/security/aegis.js`](src/security/aegis.js). If you're reading
this on GitHub to defeat it: hello — start at `sign()`. The cipher is
friendly; beating the behavioural sensors is the puzzle.

## License

Apache License 2.0 — see [`LICENSE`](LICENSE).
