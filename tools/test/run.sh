#!/usr/bin/env bash
# Browser test: loads extension/ in real Chromium (Playwright container on CT105).
# - real roblox.com game + profile pages (logged out)
# - dashboard pages with mocked Roblox/Rolimons APIs
# Screenshots land in tools/test/shots/.
set -euo pipefail
ROOT=$(cd "$(dirname "$0")/../.." && pwd)
IMAGE=mcr.microsoft.com/playwright/python:v1.55.0-noble
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT

tar -C "$ROOT" -czf "$TMP/bb.tgz" extension tools/test/test_bb.py
pct exec 105 -- sh -c 'rm -rf /root/bbtest && mkdir -p /root/bbtest/shots'
pct push 105 "$TMP/bb.tgz" /root/bbtest/bb.tgz
pct exec 105 -- sh -c 'cd /root/bbtest && tar xzf bb.tgz && mv extension Bloxboard && mv tools/test/test_bb.py . '
pct exec 105 -- sh -c "docker image inspect $IMAGE >/dev/null 2>&1 || docker pull -q $IMAGE >/dev/null"
pct exec 105 -- sh -c "docker run --rm --network mediastack -v /root/bbtest:/work -w /work $IMAGE sh -c 'pip install -q playwright==1.55.0 2>/dev/null; python3 test_bb.py'" 2>&1 \
  | grep -v -e 'namespace' -e 'apollo' -e 'realtime' -e 'SignalR' -e 'status of 401' -e 'Maximum call stack'

mkdir -p "$ROOT/tools/test/shots"
for f in $(pct exec 105 -- ls /root/bbtest/shots); do
  pct pull 105 "/root/bbtest/shots/$f" "$ROOT/tools/test/shots/$f"
done
pct exec 105 -- rm -rf /root/bbtest
echo "Screenshots: tools/test/shots/"
echo "Note: 'Maximum call stack' on game pages is Roblox's own bug (happens without the extension too)."
echo "To free ~2 GB on CT105 afterwards: pct exec 105 -- docker rmi $IMAGE"
