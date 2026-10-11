#!/usr/bin/env bash
# Publish site-dist/ to https://bloxboard.enesserver.dev (Caddy in CT103, /var/www/bloxboard).
# Swaps the folder in one move, keeps the previous version in /var/www/bloxboard.old.
set -euo pipefail
ROOT=$(cd "$(dirname "$0")/.." && pwd)
[ -d "$ROOT/site-dist" ] || { echo "No site-dist/. Run: python3 tools/build.py"; exit 1; }

TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT
tar -C "$ROOT/site-dist" -czf "$TMP/site.tgz" .
pct push 103 "$TMP/site.tgz" /tmp/bloxboard-site.tgz
pct exec 103 -- sh -c '
  set -e
  rm -rf /var/www/bloxboard.new
  mkdir -p /var/www/bloxboard.new
  tar -xzf /tmp/bloxboard-site.tgz -C /var/www/bloxboard.new
  chmod -R a+rX /var/www/bloxboard.new
  rm -rf /var/www/bloxboard.old
  if [ -d /var/www/bloxboard ]; then mv /var/www/bloxboard /var/www/bloxboard.old; fi
  mv /var/www/bloxboard.new /var/www/bloxboard
  rm -f /tmp/bloxboard-site.tgz
'
echo "Deployed. Checking…"
for path in / /plan.html /updates.xml /download/bloxboard.crx; do
  code=$(curl -s -o /dev/null -w '%{http_code}' --resolve bloxboard.enesserver.dev:443:192.168.2.100 "https://bloxboard.enesserver.dev$path")
  echo "  $code  $path"
done
