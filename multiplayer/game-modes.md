# Game modes

Three modes are designed in order of implementation difficulty.
The MVP target is **Race**; Co-op and Versus build on the same
networking foundation and add gameplay rules.

## Race

> "Same seed, same map, race the leaderboard."

| Aspect | Spec |
|---|---|
| Player count | 2–8 |
| Sync model | None — each peer plays independently |
| Data exchanged | `{wave, hp, money, score}` heartbeat once per second |
| Win condition | Highest wave reached when last peer dies / retires |
| Failure when peer disconnects | Drop them from the leaderboard, game continues |

### Rules

1. Room code → world seed (FNV-1a hash). Every peer's map, boon
   pool, and OVERCLOCK surge layout is identical.
2. Run setup (hero / kit / ability / tower variants) is **private**.
   Players can build differently; only the *world* is shared.
3. While in-room, a small overlay pinned to the top-right of the
   canvas shows everyone's current wave + HP. Updated once per
   second via the data channel.
4. Game over for one peer doesn't end the room. Their slot turns
   into a final score; others keep playing.

### UI surface

```
┌──── Top-right overlay ────────────────┐
│  ROOM NEON42                          │
│  ▮▮▮▮▮▮▮ ALICE   w14   ▓▓▓▓▓▓ 18/20  │
│  ▮▮▮▮▮ BOB      w12   ▓▓▓▓░░  9/20   │
│  ▮▮▮▮▮▮ CARL    w13   ▓░░░░░  4/20   │
│  ▮▮ DAVE        ☠      w 9     final  │
└───────────────────────────────────────┘
```

### Why this is the MVP

- **No state has to merge.** Each peer owns its own `Game`. The
  network sees ~30 bytes/sec of leaderboard data.
- **Aegis is naive.** Other peers' scores are display strings; they
  never touch local state.
- **The lobby code is the whole engineering investment.** Once a
  room is joinable, Race is "just" UI.

## Co-op

> "Two players, one map, shared economy."

| Aspect | Spec |
|---|---|
| Player count | 2 (could extend to 3-4 with grid expansion) |
| Sync model | Deterministic lockstep — see [sync.md](sync.md) |
| Data exchanged | Frame input bundles (`build/upgrade/sell/boon/ability`) |
| Win condition | Same as single-player — survive to wave 30+ |
| Shared resources | Money pool, HP pool, tower mastery (read-only — no XP grant in co-op) |
| Failure when peer disconnects | Pause, offer "wait for them" / "convert to solo + take over their input" |

### Rules

1. Both players see the same canvas. Each player has a coloured
   mouse pointer (Alice = cyan, Bob = magenta).
2. Money and HP are **shared**. Either player can build / upgrade /
   sell on any cell. The credit deduction is the same global pool.
3. **Tower ownership** is recorded for stat-tracking but doesn't
   gate any action. Anyone can sell anyone's tower.
4. Boon picks are **majority vote**: both players see the same three
   choices, each click their pick. If they disagree, the game picks
   the option clicked first (the room's frame number breaks ties).
5. **Run setup** is host-only. The joiner sees the host's loadout
   and can opt out before launch.
6. Mastery XP / Backpack drops go **only to the host's save**. The
   joiner gets a "co-op clear" badge but no per-tower XP, to keep
   the meta-progression honest.

### Open balance questions

- Should HP be doubled in co-op to compensate for "two players, same
  enemy curve"? Probably yes (`maxHealth × 2` at construction, scales
  with `maxHP` boon picks the same way).
- Should waveBonus also double? Probably no — two players coordinate
  builds, so the economy already gets more efficient.
- Tower mastery progress for the host: should the variant XP scale
  by `0.5` because two brains played one tower? Open.

### Why this is hard

- Every input path needs an "applied via network" affordance: same
  validation, but skip the input-source's local feedback (we don't
  want Bob's screen to play the *build* sound at the moment Alice's
  packet arrives — actually we do, but it should sound subtly
  different so each player can tell whose action just happened).
- The pause-vs-disconnect UX matters: in single-player a paused game
  is fine forever; in co-op a paused game with someone offline is
  frustrating.

## Versus

> "Two grids, two players, kills push waves at the opponent."

| Aspect | Spec |
|---|---|
| Player count | 2 |
| Sync model | Independent worlds + a "spike" message protocol |
| Data exchanged | `{kind:'spike', amount:N, kind:'fast'/'tank'/'air'}` from the killer's queue |
| Win condition | Last alive wins. Or higher wave at sudden-death timer. |
| Shared resources | None — separate economies, separate HP |
| Failure when peer disconnects | Disconnect = forfeit |

### Rules

1. Each player has their own map (different seeds — `roomCode + 'A'`
   and `roomCode + 'B'`). They never see each other's grid.
2. Killing enemies on your own map fills a **spike meter**. When the
   meter crosses a threshold, an extra spike of enemies spawns on
   the opponent's next wave.
3. The spike's composition is determined by which enemies the killer
   killed (e.g. lots of `fast` kills → spike contains a `fast` rush).
4. Sudden-death triggers at wave 30 or after a 10-minute timer:
   spike intervals shorten dramatically.

### Networking

Each peer runs its OWN simulation. The data channel only carries
`spike` messages and the periodic `{wave, hp}` heartbeat (so the UI
can show your opponent's progress in a small inset window).

Spikes are **applied at wave boundaries** — when the receiver's
wave-clear logic runs, it consumes any queued spikes and adds them
to the next spawn pool. This avoids mid-wave injection that would
desync rendering.

### Why this is the most complex

- Two simulations diverge by design. Determinism only matters within
  each player's own simulation (so OVERCLOCK and boon picks still
  give the same outcomes for the same inputs).
- Balance is sensitive: too-easy spikes mean both players collapse
  in 5 minutes; too-hard mean leaders never lose.
- The catch-up mechanic problem: a player who falls behind on
  economy can't kill enough enemies to spike back; they need a
  "comeback" hook (e.g. spike meter fills 2× faster when HP < 5).

This mode is **not in the roadmap for the first multiplayer
release**. It's documented here for completeness and to make sure
the networking layer (data channel + room identity) is shaped in a
way that extends to it later.

## Modes we ruled out

- **Tower-trading shop.** Players send items / tower-upgrade tokens
  to each other. Fun but conflicts with the meta-progression rules
  (a high-mastery player could carry a fresh save through hard
  content by handing over upgraded variants). Skip.
- **Drop-in spectator.** One player streams their game state to N
  viewers. Bandwidth heavy and uninteresting — viewers can already
  watch via screen-share / Discord stream.
- **Round-robin turn-based.** Each player builds for one wave, the
  other watches. Kills the pace of the game.

## Recommendation

Ship Race first. Two-player Co-op second. Versus when there's
demand and bandwidth.
