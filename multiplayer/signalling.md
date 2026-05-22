# Signalling — how peers find each other without a server

WebRTC needs an out-of-band channel for the two peers to swap their
SDP offer/answer and ICE candidates before the data channel can open.
That out-of-band channel is the only piece that's hard in a
serverless setup. After signalling completes the data flow is
peer-to-peer (NAT permitting) and the signalling service goes idle.

This document compares the realistic options for a static-hosted
project that refuses to operate any infrastructure.

## The candidates

| Option | "Serverless" from our POV? | Bundle cost | UX | Robustness |
|---|---|---|---|---|
| [Trystero](https://github.com/dmotz/trystero) (BitTorrent trackers) | **Yes** — public trackers | ~10 KB gz | Type a 6-char room code | Tracker churn possible; multiple fallbacks |
| Trystero (Nostr relays) | **Yes** — public relays | same | same | Newer protocol, lots of relays |
| Trystero (MQTT — public broker) | **Yes** | same | same | One broker = single point |
| PeerJS public broker (`0.peerjs.com`) | **Mostly** — one project we don't own | ~30 KB gz | type peer ID | Rate limits known |
| Firebase realtime DB (anonymous auth) | **No** — needs API key + a project | ~50 KB | invisible | Reliable but requires our account |
| Supabase realtime | **No** — needs project | ~70 KB | invisible | Reliable but requires our account |
| **Manual clipboard signalling** | **Yes** — uses no third party at all | ~0 KB | paste two long base64 strings | Bullet-proof; bad UX |
| GitHub Issues / Discussions API | **No** — auth + rate limits | n/a | n/a | Hilarious, but no |

## Recommendation

**Use Trystero with the default BitTorrent-tracker strategy, and
keep the manual clipboard signalling as a fallback.**

Trystero pulls in a couple of `.mjs` files (or a single UMD build),
talks to a hard-coded list of public BitTorrent trackers that already
exist for the WebTorrent ecosystem, and gives back a small room API:
`joinRoom(config, roomId)` returns objects you can use to send and
listen to JSON-serialisable messages. We then bring up a WebRTC data
channel between every pair of peers.

Reasons it fits:

1. **It's the actual smallest possible vendor footprint.** A single
   `<script>` tag and ~10KB gz. No build step needed.
2. **No accounts.** No API key, no JWT, no `.env`. The room code is
   the entire piece of identity.
3. **Public infra.** WebTorrent trackers have been up for over a
   decade. Trystero picks one that responds; if it doesn't, it
   rotates through the list.
4. **Multiple transports.** If the BitTorrent trackers all fail,
   the same library can swap to Nostr relays or MQTT with a single
   config change.

## Failure modes & fallbacks

### "All trackers blocked / firewalled"

Some corporate networks block WebTorrent tracker endpoints. Trystero
exposes a `relayUrls` option — we will:

1. Default to BitTorrent (free, sized for the use case).
2. Fall back automatically to Nostr relays (one-line config).
3. If both fail, surface the **clipboard fallback** (below).

### Clipboard fallback

When everything else fails, the host generates a base64-encoded
WebRTC offer string and copies it to the clipboard. They send it to
the joiner via whatever means (Discord, SMS, carrier pigeon). The
joiner pastes it into the lobby screen and gets back an "answer"
string the same way. Two round trips and the data channel is open.

This is identical to how a lot of old experimental P2P games worked
(`webrtc.txt` signalling). It is the literal worst UX in the
multiplayer space, but it depends on *nothing* and is therefore the
correct safety net.

The UI sketch:

```
┌───────────────────────────────────────────────┐
│  CO-OP LOBBY — CLIPBOARD MODE                 │
├───────────────────────────────────────────────┤
│  1. Click GENERATE OFFER.                     │
│  2. Share the copied code with your friend.   │
│  3. Paste their ANSWER below and hit JOIN.    │
│                                               │
│  [ GENERATE OFFER ]   offer: ND2-A3F9C2…      │
│                                               │
│  Answer ▼                                     │
│  ┌─────────────────────────────────────────┐  │
│  │ paste here…                              │  │
│  └─────────────────────────────────────────┘  │
│  [ JOIN ]                                     │
└───────────────────────────────────────────────┘
```

The contents of `offer` and `answer` are gzipped + base64-encoded
SDP+ICE bundles — about 1.5 KB each. Players probably won't reach
this screen often, but when they do they can still play.

## NAT traversal

WebRTC handles NAT traversal via STUN. We use Google's public STUN
servers (`stun:stun.l.google.com:19302`) — they're public-good
infrastructure that's been up since 2011. For symmetric-NAT cases
where STUN isn't enough, the only fix is a TURN relay. We don't
operate one. The user gets a "we can't reach your friend's network"
dialog and is told to try a hotspot.

About 5-10% of internet users live behind symmetric NAT; that's the
known cost.

## Room-code design

A 6-character room code (the alphabet `ABCDEFGHJKLMNPQRSTUVWXYZ23456789`)
gives ~31^6 ≈ 887M combinations — enough to avoid accidental
collisions when the player base is tiny. The same string is used
both as the signalling room id (Trystero's `roomId` parameter) AND as
the world seed (after FNV-1a hashing via Aegis). That way the host
doesn't have to communicate two things — one code does everything.

```
roomCode  = 'NEON42'
trysteroRoom = roomCode                       // signalling identifier
worldSeed   = NeonAegis.fnv1a(roomCode)       // RNG seed
```

The fact that anyone who joins your room can see what seed you'd be
playing on doesn't matter — the game is the same for everyone.

## What about a chat / voice channel?

WebRTC supports media tracks alongside data channels. For text chat,
just reuse the same `RTCDataChannel` with a tiny `{type:'chat',
body:'…'}` envelope. For voice, players are better served by Discord
or a phone call — we don't ship an audio UI and the bandwidth bump
isn't worth our effort.

## Reading list

- WebRTC: [Browser-to-browser data with WebRTC](https://developer.mozilla.org/en-US/docs/Web/API/WebRTC_API)
- [Trystero docs](https://oxism.com/trystero/) and [GitHub repo](https://github.com/dmotz/trystero)
- The actual [WebTorrent tracker list](https://github.com/ngosang/trackerslist) Trystero rotates through
- [PeerJS](https://peerjs.com/) — alternative broker-based approach
- Background on lockstep sync (we use it in [sync.md](sync.md)):
  [1500 archers on a 28.8](https://www.gamedeveloper.com/programming/1500-archers-on-a-28-8-network-programming-in-age-of-empires-and-beyond)
