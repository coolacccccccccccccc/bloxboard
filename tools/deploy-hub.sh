#!/usr/bin/env bash
# Deploy the community hub API to CT116 (bloxboard-hub, 192.168.2.44:8790).
# First run installs Python + a venv; later runs just update app.py and restart.
# Config lives in /etc/bloxboard-hub.env inside CT116 (never overwritten here).
set -euo pipefail
ROOT=$(cd "$(dirname "$0")/.." && pwd)
CT=116
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT
tar -C "$ROOT/hub/api" -czf "$TMP/api.tgz" app.py requirements.txt bloxboard-hub.service
pct push $CT "$TMP/api.tgz" /tmp/bloxboard-api.tgz
pct exec $CT -- bash -s <<'INNER'
set -e
if ! dpkg -s python3-venv >/dev/null 2>&1; then
  apt-get update -qq && DEBIAN_FRONTEND=noninteractive apt-get install -y -qq python3 python3-venv sqlite3 >/dev/null
fi
id bloxboard >/dev/null 2>&1 || useradd --system --home /var/lib/bloxboard-hub --shell /usr/sbin/nologin bloxboard
mkdir -p /opt/bloxboard-hub /var/lib/bloxboard-hub
chown bloxboard:bloxboard /var/lib/bloxboard-hub
tar -xzf /tmp/bloxboard-api.tgz -C /opt/bloxboard-hub && rm /tmp/bloxboard-api.tgz
[ -x /opt/bloxboard-hub/venv/bin/pip ] || { rm -rf /opt/bloxboard-hub/venv; python3 -m venv /opt/bloxboard-hub/venv; }
/opt/bloxboard-hub/venv/bin/pip install -q --upgrade pip >/dev/null
/opt/bloxboard-hub/venv/bin/pip install -q -r /opt/bloxboard-hub/requirements.txt
if [ ! -f /etc/bloxboard-hub.env ]; then
  cat > /etc/bloxboard-hub.env <<ENV
BASE_URL=https://bloxboard.enesserver.dev
DATA_DIR=/var/lib/bloxboard-hub
ROBLOX_CLIENT_ID=
ROBLOX_CLIENT_SECRET=
ADMIN_IDS=
DEV_LOGIN=0
ENV
  chmod 640 /etc/bloxboard-hub.env && chown root:bloxboard /etc/bloxboard-hub.env
fi
cp /opt/bloxboard-hub/bloxboard-hub.service /etc/systemd/system/
systemctl daemon-reload
systemctl enable -q bloxboard-hub
systemctl restart bloxboard-hub
sleep 2
systemctl is-active bloxboard-hub
INNER
curl -s -m 10 http://192.168.2.44:8790/api/health && echo
