# Sync model — deterministic lockstep

The cheapest network model for a peer-to-peer real-time game is
**lockstep**: both peers run the entire simulation; only the inputs
that drive that simulation cross the wire. As long as the simulation
is deterministic, the two worlds stay byte-identical.

Neon Defense is *already most of the way there.* The map generator,
the boon picker, the OVERCLOCK surge layout, and the end-of-run loot
roll all consume a seeded `mulberry32` PRNG (see
[`src/engine/map.js`](../src/engine/map.js)). The auto-tune harness
replaces `Math.random` globally with that seeded generator so its
runs are reproducible. We can lean on the same mechanism.

This document describes how to make the rest of the engine
deterministic enough to share, what crosses the wire, and how
desyncs are detected.

## What needs to be deterministic

A simulation is deterministic iff the same inputs in the same order
produce the same outputs across runs. For us that requires:

| Source | Status | Notes |
|---|---|---|
| Map generation | ✓ already seeded | `map.js` seeds mulberry32 from the URL hash today |
| Boon roll (every 10 waves) | ✓ uses `Math.random` | seeded under harness; will be under multiplayer too |
| OVERCLOCK surge placement | ✓ uses `Math.random` | same |
| End-of-run loot roll | ✓ uses `Math.random` | same |
| Enemy spawn order / type | ✓ `WAVE_CONFIG` is deterministic | hand-coded waves 1–10, formula afterwards |
| Tower target selection | ⚠ currently iterates `game.enemies`, picks first/closest/max-HP/min-HP | order is insertion-order; if both peers spawn enemies in the same order this is deterministic |
| Projectile homing tie-breaks | ⚠ same as above |
| `performance.now` / `Date.now` references | ⚠ to check | Aegis already snapshots `Date.now`; the simulation should not branch on wall-clock |
| Player input | × non-deterministic by definition — that's what we send across the wire |

The yellow rows are the *audit work*. They're almost certainly
already deterministic because nothing in the gameplay code calls
`Math.random` outside the sites listed above (`grep -rn 'Math.random'
src/` has been a clean list for many iterations now), but every site
that consumes `Date.now()` or `performance.now()` needs to be
verified to be a *display-only* call (UI animation, status bars) and
not a simulation input.

If any wall-clock branch leaks into the simulation, the fix is to
replace it with `game.frameCount` (we already tick frames in a fixed
order).

## Frame model

The Game's `update()` runs N times per RAF frame, where N = the
gameSpeed multiplier. That outer loop is the lockstep boundary:

```
locally:           input events buffered ──► commitFrame(F)
                                              │
                                              ▼
                   peers exchange inputs ──► applyFrameInputs(F)
                                              │
                                              ▼
                   game.update() x speed   ──► commit world to frame F+1
```

Every `commitFrame(F)` waits until **all peers' input bundles for
frame F have arrived** before stepping. If a peer is slow the room
buffers the rest of the world — same as the way real RTSes have
worked since 1996.

For low-input games like ours (a click here and there), this is
nearly free. Frame F's input bundle is usually empty for everyone;
empty bundles are coalesced into "no-op" heartbeats sent every
N frames (say 30, so twice per second).

## Wire format

A frame input is a tiny JSON object:

```jsonc
{
  "v": 1,                  // protocol version
  "p": "ALICE",            // peer nick / seat
  "f": 4287,               // frame number
  "i": [                   // inputs at this frame (often empty)
    { "k": "build",   "c": 12, "r": 6, "t": "basic_cryo" },
    { "k": "upgrade", "tower": 3, "slot": 0 },
    { "k": "boon",    "id": "overdrive" }
  ]
}
```

A second-per-second heartbeat is just `{v:1, p:'ALICE', f:N, i:[]}`.
Bandwidth budget: with two peers and ~10 inputs per minute, each
peer sends maybe 5 KB total over a 30-minute run.

## Desync detection

Every K frames (say every 600 ≈ 10 sec at 60fps) each peer hashes a
small snapshot of the deterministic world and includes it with its
heartbeat:

```jsonc
{ "v":1, "p":"ALICE", "f":N, "i":[], "hash": "fnv1a-base36" }
```

Snapshot fields covered by the hash:

- `game.wave`, `game.health`, `game.money` (floored)
- `game.towers.length` and a sorted list of `{c,r,type,damageDealt}` per tower
- `game.enemies.filter(e=>e.active).length`
- `save.maxWaveReached` (so we detect remote-driven save edits, if any)

If two peers' hashes disagree at the same frame, the game freezes,
shows a "🔌 Desync detected at frame N" dialog, and offers to resync
by re-seeding and replaying inputs from a recent checkpoint. The
checkpoint is just the input log; storage cost is negligible.

Why hash instead of full snapshot? Lockstep snapshots can grow to
hundreds of KB late-game. A 32-bit hash is plenty for desync
detection — false positives are astronomically unlikely, and a
false negative (collision) is harmless because real-time gameplay
will diverge visibly in a few more seconds anyway.

## Resync strategy

When a peer joins mid-game (rejoin after disconnect), the room
sends them:

1. The full **input log** since frame 0 (or since the last
   checkpoint — see below).
2. The current frame number F.

The newcomer runs `Game.fast-forward(seed, inputs)` — same code path
as a normal run but with `gameSpeed = Infinity` until F is reached.
With a small input log this takes < 1 second on a desktop.

If runs grow long enough that the input log balloons, we cut a
**checkpoint** every 10 minutes: serialise `{game, save}`, broadcast
the serialised blob plus its hash, and trim the input log to "since
last checkpoint". Checkpoints are the same JSON Aegis already signs
in `NeonSave.write` — we get integrity for free.

## What does NOT cross the wire

- Mouse positions / hover state. The ghost cell on tower placement
  is purely local visual feedback; the network only sees the final
  click.
- Animation state (projectile sprites, particles, screen shake).
- Audio cues — each peer plays them locally based on game events.
- DOM / overlay state (which menu is open, which dropdown is
  hovered). The game state machine drives gameplay; UI is a view.
- Anything in `save` *except* progress events that should be
  shared (e.g. "Alice cleared wave 30" → Bob's high-score board
  shows it). Stats are echoed via a sideband chat-like message;
  the local save is only updated by local code.

## Interaction with Aegis

Aegis' state audit (see [anti-cheat.md](anti-cheat.md)) treats large
deltas to `game.money` / `game.health` as cheating because no
legitimate input path produces them. In multiplayer that's still
true — a remote peer's BUILD event consumes credits via the same
`buildTower(...)` code path, which deducts cost normally. No money
ever materialises from "the network".

The only adapter we need is letting the input dispatcher *mark
itself* as the legitimate source while applying remote inputs, so
that even if a peer sent garbage data the receiver still hits the
normal validation gates (cost check, buildable cell check, etc.).
The network is an untrusted input device, not a privileged caller.

## Open questions

- **Tower targeting tie-breaks under fast spawn rates.** Need to
  verify that two iterators starting on the same enemy array land
  on the same target every time. (Likely OK because enemy insertion
  is deterministic.)
- **Variable speed.** If one peer plays at 1×, the other at 4×, the
  lockstep model breaks — they can't agree on which frame is which.
  Solution: in multiplayer, pin `gameSpeed` to a room-wide value.
  PAUSE for everyone or nobody.
- **Replay file format.** Save the input log as `.ndr` (Neon Defense
  Replay) — same JSON envelope, just persisted. Nice to have for
  highlights, not required for v1.
