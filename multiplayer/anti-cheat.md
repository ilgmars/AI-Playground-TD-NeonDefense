# Aegis × multiplayer

The current anti-tamper layer (see [`src/security/aegis.js`](../src/security/aegis.js)
and the README's Aegis section) is built on three pillars:

1. **Signed saves.** Every `localStorage` write is signed with a
   three-pass FNV-1a hash; tampering with the JSON without resigning
   trips a flag on next load.
2. **Behaviour sensors.** `Math.random`, `Date.now`, and `Math.imul`
   are snapshotted at boot. If any of them gets replaced, the next
   sentinel tick detects the swap and flags the save.
3. **State audit.** `game.money` and `game.health` are accessor
   properties. A single-write delta over `MAX_MONEY_DELTA` (500 K)
   or an HP value above `maxHealth + 5` is treated as console
   tampering.

Multiplayer interacts with all three. This document walks through
each pillar and the surgical accommodation needed for peer inputs.

## Pillar 1 — signed saves: unchanged

Multiplayer never mutates the local save outside the existing
end-of-run path. Peers exchange **inputs**, not save objects. The
local `NeonSave.write()` continues to sign every write; the sig
keeps protecting against hand-edited localStorage exactly as today.

**No change required.**

## Pillar 2 — behaviour sensors: unchanged for normal play

The multiplayer code does **not** override `Math.random`. The
existing seeded `mulberry32` lives in
[`src/engine/map.js`](../src/engine/map.js) as a *local* `rng`
function inside `generateMap()`. The boon roll, OVERCLOCK surge
placement and loot roll currently use the global `Math.random` —
which the auto-tune harness re-routes via `addInitScript` to a
seeded version *before* the page boots.

For multiplayer we'll do the same trick: a tiny init script run in
the player's own page (not injected from outside) replaces
`Math.random` with a room-seeded mulberry32 **for the duration of
the run**. Aegis' RNG sensor would normally catch that and flag…

**Accommodation needed.** Aegis grants a "host-controlled dev mode"
when `window.__neonAegisDev === true` is set at IIFE eval (see
`src/security/aegis.js` line ~50). The same hatch will be used for
multiplayer: the client sets that flag *before* `aegis.js` runs (via
a small inline `<script>` in `index.html` that reads `?mp=…` from the
URL, or via a settings checkbox that persists in `localStorage` and
is read pre-aegis-boot).

This is a deliberate widening of the trust model: when you're in a
multiplayer room you've consented to a deterministic PRNG, and the
RNG-override sensor would only false-positive. The flag does **not**
disable the save signature check or the money/HP audit — those keep
working.

## Pillar 3 — state audit: the interesting part

This is where multiplayer actually touches gameplay. A remote
peer's `BUILD` input arrives at the local machine, is dispatched
through `game.buildTower(c, r, type)`, which spends credits from
`game.money`. The money setter fires on every `-=` operation, but
legitimate deductions are always small (tower cost ≤ 400) so they
stay well under the `MAX_MONEY_DELTA` upward-spike threshold and
the new `< -1` negative-money check from the audit fix earlier this
session.

So the **happy path is free**: peer inputs hit the same code paths
as local clicks, the audit sees the same small deltas, no flag
fires.

The interesting cases:

### "Peer sent garbage"

A malicious / buggy peer could send `{kind: 'build', c: 99, r: 99,
type: 'mythic_destroyer'}`. The receiving side dispatches that
through the regular `buildTower(c, r, type)` which already validates:

- `map.isBuildable(c, r)` — out-of-range cells fail here.
- `TOWERS[type]` lookup — unknown types fall through (`getEffectiveTowerType`
  returns the raw string and `new Tower(...)` reads from `TOWERS[type]`).
  → we'd hit `undefined` and a runtime error.

**Hardening needed.** Each remote input is validated against an
allow-list:

```js
const ALLOW_BUILD_TYPES = new Set([
    ...Object.keys(TOWERS),
    ...Object.keys(TOWER_VARIANTS).map(b => TOWER_VARIANTS[b]),
]);
const ALLOW_INPUT_KINDS = new Set(['build','upgrade','sell','potion','boon','ability']);
```

Anything outside these sets is discarded with a one-line console
warning. No flag fires (the peer was likely on a different version
or had a bug, not a cheater) — the input just drops.

### "Peer state diverged"

If a determinism bug causes the two simulations to diverge, one
peer's `game.money` will eventually be a different number from the
other's. The state audit doesn't care about that (it's not a spike,
just legitimate gameplay), but the desync hash described in
[sync.md](sync.md#desync-detection) catches it within ~10 seconds.

### "Peer simulating the wrong game"

The room's room-code seeds the world. A bad-faith peer could play
a tampered local copy (different difficulty, different boon
weights, …) and feed real inputs back through the wire to a stock
client. The receiving client doesn't care — it just runs the
inputs against ITS world; its world is the real one.

This means **co-op trust is one-way**: I trust *my* simulation more
than yours. If your client cheats and tells me you killed a boss,
my simulation is what decides whether the boss was actually killed.

## Summary of changes

| Aegis layer | Multiplayer impact | Action |
|---|---|---|
| Signed saves | None | None |
| RNG / time / imul sensor | Multiplayer needs seeded `Math.random` | Set `__neonAegisDev=true` pre-IIFE when joining a room |
| Money / HP audit | None — peer inputs hit the same code paths | None |
| Cheater flag | None | None |
| Save code (ND2) tamper | None | None |

## Multiplayer-specific anti-abuse

A new failure mode that didn't exist before: **a peer DoS-ing the
room by sending a million inputs**. Mitigation:

- Throttle inbound inputs per peer (e.g. max 30 inputs/sec — humans
  click at most a few per second, anything above is suspicious).
- Discard duplicate inputs (same `{frame, kind, args}` from the
  same peer).
- If a peer floods past the throttle, the host kicks them from the
  room. This is enforced locally — every peer is its own host of
  its own world.

Throttle limits live alongside `ALLOW_INPUT_KINDS` for easy tuning.

## Implementation: `PeerGuard` (src/multiplayer/guard.js)

Every inbound frame passes through a `PeerGuard` before reaching the
action dispatcher. The guard is local-only (no cross-peer
coordination) and stacks four cheat-resistance checks on top of the
schema validation already in `protocol.validateFrame`:

| Layer | What it catches |
|---|---|
| **Schema allow-list** (`protocol.validateInput`) | Unknown input kinds, unknown tower types, out-of-range coordinates, oversize id strings. |
| **Per-frame kind caps** (`DEFAULT_PER_FRAME_CAPS`) | A single tick claiming 200 boon picks or 50 builds — a human can't produce more than ~4 gestures per tick. |
| **Monotonic frame numbers + dedupe** (per peer) | Replay attacks: rebroadcasting an old `build` frame to spam towers; re-sending the same frame twice. A small `reorderWindow` (default 30) lets legitimately late frames through. |
| **Token-bucket throttle** (per peer, default 30/sec) | DoS — a peer flooding inputs. Each input in a frame consumes one token so flooders can't pack thousands into one envelope. |
| **HMAC over frame body** (optional) | A stranger who lands in the same Trystero room cannot impersonate a peer that joined with the room code. Secret is `fnv1a('mp:' + roomCode)`. The MAC is FNV-based — not cryptographic-grade, but the room code is only ~30 bits of entropy anyway, and the threat model is opportunistic interlopers, not state-level adversaries. |

These layers are independent. The schema allow-list and money/HP
audit (Pillar 3) remain the load-bearing checks. The guard is the
ring around them.

What the guard explicitly does NOT do:
- It does not arbitrate truth between simulations. If peer A's hash
  diverges from peer B's, that's a desync event handled in
  [sync.md](sync.md#desync-detection), not a cheating event.
- It does not block large-but-legitimate input bursts (e.g. a
  shift-click chain across an empty row). Those stay under the
  per-frame cap and the throttle.

## Replay attestation (future)

Once `.ndr` replay files exist (input log + initial seed), a peer
can publish a replay along with their high score. Anyone else can
re-run the simulation against the same seed + inputs and verify the
score. That gives high-score leaderboards a tamper-evident floor
without needing a server.

Not in scope for v1, but the design here supports it cleanly:
- The replay is just the input log we already broadcast.
- Replaying is the same `fast-forward(seed, inputs)` we use for
  mid-game rejoins.
- The Aegis signature on the embedded save is the integrity
  guarantee.

That's the eventual "honor-system anti-tamper across rooms".
