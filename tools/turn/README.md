# Self-hosted TURN server

A one-line installer for a hardened [coturn](https://github.com/coturn/coturn)
TURN/STUN server on **Ubuntu 24.04 / 26.04 LTS**, to replace the paid
Metered.live relay for Neon Defense multiplayer (WebRTC needs TURN for
symmetric-NAT peers).

## Install (one line, on the server)

```sh
curl -fsSL https://raw.githubusercontent.com/ilgmars/AI-Playground-TD-NeonDefense/main/tools/turn/install.sh | sudo bash
```

Idempotent — re-run any time to reconverge config/firewall. It **reuses the
existing credential** on re-run (never breaks connected clients) and only mints
a fresh random `user`/`pass` (via `openssl`) on the first run. Override
defaults with env vars:

```sh
curl -fsSL …/install.sh | sudo REALM=turn.you.com MIN_PORT=49160 MAX_PORT=49200 bash
```

What it sets up:

- coturn with long-term credential auth (`lt-cred-mech`) + abuse caps:
  `total-quota`, `user-quota`, and `max-bps` (~512 kbit/s/session — fine for
  game traffic, useless as a video/VPN relay if the credential leaks).
- `ufw` firewall opening only SSH, 3478 (TCP+UDP), and the relay UDP range.
- `unattended-upgrades` (auto security patches) + `fail2ban` (sshd jail).
- Anti-SSRF: refuses relaying to RFC-1918 / loopback / link-local ranges.

At the end it prints the ICE-server entry to paste into your config (below).

## Port forwarding (home router)

Forward to the server's LAN IP, **same port in→out, no remapping**:

| Port(s)         | Proto      | Purpose             |
| --------------- | ---------- | ------------------- |
| 3478            | TCP + UDP  | TURN/STUN control   |
| 49160–49200     | UDP        | media relay range   |
| 22              | TCP        | SSH (only if remote)|

## Wire it into the game

The installer prints an entry like:

```json
{ "urls": "turn:YOUR_PUBLIC_IP:3478", "username": "neon-xxxx", "credential": "…" }
```

Add it to the `metered.staticIceServers` array in your **`NEON_TURN_CONFIG`**
GitHub Secret (and local `.credentials`). On the next deploy,
[`tools/install-turn-config.sh`](../install-turn-config.sh) bakes it into
`src/multiplayer/turn-config.js` — no code change needed. See
[`src/multiplayer/turn-config.example.js`](../../src/multiplayer/turn-config.example.js)
for the full shape.

> A static page can't hide secrets from its own users — the credential ships in
> the deployed bundle. The `max-bps`/quota caps above are what bound abuse; if
> the credential turns up somewhere unwanted, just re-run the installer is **not**
> enough (it reuses creds) — delete the `user=` line in `/etc/turnserver.conf`
> first, then re-run to rotate.

## Verify

From a **different network** (NAT hairpin lies on your own LAN):

```sh
turnutils_uclient -v -u <user> -w <pass> YOUR_PUBLIC_IP
```

or paste the creds into the
[WebRTC trickle-ICE tester](https://webrtc.github.io/samples/src/content/peerconnection/trickle-ice/)
and confirm you get a `relay` candidate.

## Add TLS later (optional)

Plaintext TURN on 3478 is enough for most NATs. For `turns:5349` (which strict
firewalls prefer), get a domain + a Let's Encrypt cert and add `cert-file` /
`pkey-file` to `/etc/turnserver.conf`, then forward 5349 TCP+UDP.
