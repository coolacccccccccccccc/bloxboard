#!/usr/bin/env bash
# Companion end-to-end test on CT105: builds the headless companion (Host, linux-x64), loads the
# extension in Playwright's Chromium, links them and screenshots every panel page (tools/test/shots/c-*.png).
set -euo pipefail
ROOT=$(cd "$(dirname "$0")/../.." && pwd)
PW=mcr.microsoft.com/playwright/python:v1.55.0-noble
SDK=mcr.microsoft.com/dotnet/sdk:8.0
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT

tar -C "$ROOT" --exclude='bin' --exclude='obj' --exclude='out' -czf "$TMP/c.tgz" companion extension tools/test/test_companion.py
pct exec 105 -- sh -c 'rm -rf /root/bbctest && mkdir -p /root/bbctest/shots'
pct push 105 "$TMP/c.tgz" /root/bbctest/c.tgz
pct exec 105 -- sh -c 'cd /root/bbctest && tar xzf c.tgz && mv extension Bloxboard && mv tools/test/test_companion.py . &&
  python3 - <<PY
import json
p = "Bloxboard/manifest.json"
m = json.load(open(p))
# Test copy only: grant the optional 127.0.0.1 access up front (a real user clicks Link and allows it).
m["host_permissions"] += m.pop("optional_host_permissions")
json.dump(m, open(p, "w"), indent=2)
PY'
pct exec 105 -- sh -c "docker run --rm -v bbx-nuget:/root/.nuget -v /root/bbctest/companion:/src -w /src $SDK sh -c 'dotnet publish Host -c Release -r linux-x64 --self-contained -o /src/hostout -v q 2>&1 | grep -E \" error \" || true'"
pct exec 105 -- sh -c 'mv /root/bbctest/companion/hostout /root/bbctest/host'
pct exec 105 -- sh -c "docker image inspect $PW >/dev/null 2>&1 || docker pull -q $PW >/dev/null"
pct exec 105 -- sh -c "docker run --rm --network mediastack -v /root/bbctest:/work -w /work $PW sh -c 'pip install -q playwright==1.55.0 2>/dev/null; python3 test_companion.py'" 2>&1 | grep -v -e 'namespace' -e 'apollo' || true

mkdir -p "$ROOT/tools/test/shots"
for f in $(pct exec 105 -- ls /root/bbctest/shots); do pct pull 105 "/root/bbctest/shots/$f" "$ROOT/tools/test/shots/$f"; done
pct exec 105 -- rm -rf /root/bbctest
echo "Screenshots: tools/test/shots/c-*.png"
