# Multiplayer — design notes

> Status: **design, not yet implemented**. This folder captures the
> plan for adding "play together" support to Neon Defense without
> standing up any server infrastructure. The game ships off GitHub
> Pages (static files only), so anything that requires us to operate
> a backend is off the table.

The goal here is small: figure out what "multiplayer" even means for a
single-canvas tower defence, pick the cheapest serverless transport
that can carry it, and write down the boring details so the eventual
implementation isn't blocked on guesswork.

## Table of contents

| File | What's in it |
|---|---|
| [README.md](README.md) (this file) | Overview, game modes, recommended stack, roadmap |
| [signalling.md](signalling.md) | How peers find each other without a server — options compared |
| [sync.md](sync.md) | Deterministic lockstep over the existing seeded PRNG |
| [anti-cheat.md](anti-cheat.md) | How Aegis interacts with peer-supplied state |
| [game-modes.md](game-modes.md) | Race / Co-op / Versus — rules and divergence |

## Constraints

1. **No backend.** The site lives on GitHub Pages. We can't host a
   relay, signalling server, matchmaker, or database. Anything that
   needs always-on infra is disqualified.
2. **No new heavyweight dependencies.** The whole codebase is
   ~5K lines of vanilla JS, no bundler, no framework, served as-is.
   Any transport library has to drop in as a single `<script>` tag and
   keep its own footprint small.
3. **Determinism is already there.** The map / boon roll / loot roll
   paths all consume a seeded `mulberry32` PRNG (re-seeded globally by
   the auto-tune harness). Lockstep simulation is therefore *cheap* —
   each peer runs the same game from the same seed and only the
   player's inputs need to cross the wire.
4. **Aegis stays intact.** Any state mutation that arrives from a peer
   must look like a legitimate local input to the anti-tamper layer
   (otherwise the cheater flag fires the moment a remote build pushes
   `game.money` past the threshold). See [anti-cheat.md](anti-cheat.md).
5. **A red CI badge gates this too.** Whatever ships goes through the
   same test gate as everything else.

## Recommended stack (TL;DR)

| Layer | Choice | Why |
|---|---|---|
| **Transport** | WebRTC `RTCDataChannel` (ordered + reliable) | Browser-native, P2P, no relays needed once connected. |
| **Signalling** | [Trystero](https://github.com/dmotz/trystero) over BitTorrent trackers (default) with a Nostr-relays fallback | Public free infra, no account, no API key, no server we operate. ~10KB gzipped. |
| **Sync model** | Deterministic lockstep — exchange inputs, not state | Reuses the existing seeded PRNG. Bandwidth tiny (a few bytes per tower placement). |
| **Identity** | Ephemeral nicknames + a 6-character room code | No accounts. The room code seeds both the lobby (Trystero) and the world generator. |

The detailed comparison of signalling options lives in
[signalling.md](signalling.md); the simulation contract in
[sync.md](sync.md).

## Game modes

Three modes are designed in order of implementation difficulty.
Full details + the open balance questions are in
[game-modes.md](game-modes.md).

### 1. Race mode (MVP)

Two or more players join a room with a code; the code seeds the map
and the PRNG, so each peer plays an **identical run** in parallel.
The only thing crossing the wire is "I'm on wave N, HP M". A small
leaderboard hangs over the play area showing how every other peer is
doing. No state has to merge — each player owns their own world.

- 🟢 **No state sync required.** The peer connection is basically a
  shared chat for `{wave, hp}` pings.
- 🟢 **Aegis stays naive.** Remote scores arrive only as display
  data — they never touch the local Game.
- 🔴 **Players don't really interact** beyond competing.

### 2. Co-op mode

Two players share the **same** map. Each owns half of the build pool
(or alternating waves of build budget). Inputs are exchanged over the
data channel; both peers run lockstep simulation.

- 🟢 **Genuinely "playing together"** — the same enemies, the same
  towers, you can rescue each other's mistakes.
- 🟡 **Lockstep needs deterministic inputs.** The boon picker and
  loot RNG also have to come from the shared seed.
- 🔴 **Aegis needs a multiplayer-friendly mode** that accepts a
  remote-build delta as legitimate (signed-by-peer) input rather
  than a console assignment. See [anti-cheat.md](anti-cheat.md).

### 3. Versus mode

Each player has their own grid. Kills on your map push a counter
that, when it crosses thresholds, **sends an enemy spike** to the
opponent. First to die loses.

- 🟢 **Asymmetric tension** — investing in damage hurts the
  opponent; investing in economy buys time.
- 🔴 **Hardest to balance.** Wave spikes have to scale with both
  players' progress to avoid runaway leaders.
- 🔴 **Needs a desync protocol.** Each side simulates its own world
  but inputs about "send spike" cross the wire.

## Roadmap

| Phase | Deliverable | Estimate | Status |
|---|---|---|---|
| **0** | This folder (design + signalling notes). | ✓ | done |
| **1** | Protocol + actions + guard + mock transport + 80 logic tests. | ~ half a day | done |
| **2** | Race mode: lobby UI, Trystero adapter (lazy-loaded), room code → seed, leaderboard overlay, reconnect / stale-peer handling. | ~ 1 day | done |
| **3a** | Co-op controllers: lockstep input exchange + seeded PRNG. Fully tested in isolation; not yet wired into Game.update(). | ~ 1 day | done |
| **3b** | Co-op integration: shared HP/money pool, dual cursor, Aegis dev-mode pre-boot toggle, gameSpeed pinning. | ~ 2 days | pending |
| **4a** | Versus protocol: spike meter + queue + wave-boundary drain, comeback mechanic, sudden-death. Fully tested. | ~ 1 day | done |
| **4b** | Versus integration: per-side seeds (roomCode+A / +B), opponent HUD inset, wave-clear spike consumption, balance pass. | ~ 1-2 days | pending |

Each phase is independently shippable.

## What this is **not**

- Not a chat client. We're sending a few kilobytes of input deltas
  per minute; if voice chat ever lands it'll go through a separate
  WebRTC track and the player will manage it manually.
- Not an MMO. Two-to-four-peer rooms are the target. Trystero rooms
  scale further but the design assumes small rooms.
- Not infrastructure-free in the absolute sense — Trystero rides on
  public BitTorrent trackers and Nostr relays. Those are operated by
  third parties; this project doesn't run any of them. If every
  public tracker disappeared at once the clipboard-signalling fallback
  takes over (see [signalling.md](signalling.md#clipboard-fallback)).

## How to contribute

Open an issue, then talk to the AI. The repo's
[AI-only contribution rule](../README.md#about-this-project) applies
here too: route every change through your AI of choice. The CI gate
treats multiplayer commits like anything else.
