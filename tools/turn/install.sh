#!/usr/bin/env bash
# Self-hosted coturn TURN server for Neon Defense multiplayer, with basic
# hardening (unattended-upgrades + fail2ban + ufw). Idempotent: re-running
# reuses the existing credential and just reconverges config/firewall.
#
# One-liner (Ubuntu 24.04 / 26.04 LTS):
#   curl -fsSL https://raw.githubusercontent.com/ilgmars/AI-Playground-TD-NeonDefense/main/tools/turn/install.sh | sudo bash
#
# Override defaults:  REALM=turn.you.com MIN_PORT=49160 curl ... | sudo REALM=... bash
set -euo pipefail

CONF=/etc/turnserver.conf
REALM="${REALM:-}"
MIN_PORT="${MIN_PORT:-49160}"
MAX_PORT="${MAX_PORT:-49200}"   # ponytail: 40 relay ports — plenty for a small game; widen if you see "no free relay" errors
SSH_PORT="${SSH_PORT:-22}"

[ "$(id -u)" -eq 0 ] || { echo "run as root (… | sudo bash)"; exit 1; }

export DEBIAN_FRONTEND=noninteractive
apt-get update
apt-get install -y coturn fail2ban ufw unattended-upgrades curl openssl

# Network identity. coturn behind home NAT needs external/internal mapping.
PUBLIC_IP="${PUBLIC_IP:-$(curl -fsS https://api.ipify.org || true)}"
PRIVATE_IP="$(ip -4 route get 1.1.1.1 2>/dev/null | awk '{print $7; exit}')"
[ -n "$PUBLIC_IP" ] || { echo "could not detect public IP; rerun with PUBLIC_IP=..."; exit 1; }
[ -n "$REALM" ] || REALM="$PUBLIC_IP"

# Idempotent credentials: reuse what's already in the conf so re-running
# never invalidates clients; otherwise mint random ones with openssl.
TURN_USER=""; TURN_PASS=""
if [ -f "$CONF" ]; then
    TURN_USER="$(sed -n 's/^user=\([^:]*\):.*/\1/p' "$CONF" | head -1)"
    TURN_PASS="$(sed -n 's/^user=[^:]*:\(.*\)/\1/p' "$CONF" | head -1)"
fi
TURN_USER="${TURN_USER:-neon-$(openssl rand -hex 4)}"
TURN_PASS="${TURN_PASS:-$(openssl rand -hex 24)}"   # 48 hex chars: no shell/JSON-unsafe characters

cat > "$CONF" <<EOF
listening-port=3478
fingerprint
lt-cred-mech
realm=$REALM
user=$TURN_USER:$TURN_PASS
min-port=$MIN_PORT
max-port=$MAX_PORT
external-ip=$PUBLIC_IP/$PRIVATE_IP
no-cli
no-multicast-peers
# --- rate limiting / abuse bounds (harmless if the credential leaks) ---
total-quota=100         # max concurrent relay allocations server-wide
user-quota=6            # max concurrent allocations per credential
max-bps=64000           # per-session cap ~512 kbit/s: fine for game/voice, kills video/VPN freeloading
stale-nonce=600
# refuse relaying to internal ranges (anti-SSRF)
denied-peer-ip=10.0.0.0-10.255.255.255
denied-peer-ip=172.16.0.0-172.31.255.255
denied-peer-ip=192.168.0.0-192.168.255.255
denied-peer-ip=169.254.0.0-169.254.255.255
denied-peer-ip=127.0.0.0-127.255.255.255
# ponytail: plaintext TURN (3478) only. For turns:5349 add cert-file/pkey-file + a real domain.
EOF
chmod 600 "$CONF"

# Enable the coturn service flag (Debian/Ubuntu ships it disabled).
sed -i 's/^#\?TURNSERVER_ENABLED=.*/TURNSERVER_ENABLED=1/' /etc/default/coturn
grep -q '^TURNSERVER_ENABLED=1' /etc/default/coturn || echo TURNSERVER_ENABLED=1 >> /etc/default/coturn

# Firewall (ufw rules dedupe, so this is idempotent).
ufw allow "$SSH_PORT"/tcp
ufw allow 3478/tcp
ufw allow 3478/udp
ufw allow "$MIN_PORT":"$MAX_PORT"/udp
ufw --force enable

# Hardening: unattended security updates + fail2ban (default sshd jail is the
# real attack-surface win; coturn's own auth is gated by lt-cred-mech).
dpkg-reconfigure -f noninteractive unattended-upgrades
systemctl enable --now unattended-upgrades
systemctl enable --now fail2ban

systemctl enable --now coturn
systemctl restart coturn

cat <<EOF

================ TURN READY ($PUBLIC_IP) ================
Paste this entry into your NEON_TURN_CONFIG secret / .credentials,
inside  metered.staticIceServers:

  { "urls": "turn:$PUBLIC_IP:3478", "username": "$TURN_USER", "credential": "$TURN_PASS" }

Then port-forward on your router (see tools/turn/README.md):
  3478 TCP+UDP,  $MIN_PORT-$MAX_PORT UDP
========================================================
EOF
