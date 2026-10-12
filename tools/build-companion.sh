#!/usr/bin/env bash
# Build the Windows companion (BloxboardCompanion.exe) in a .NET 8 SDK container on CT105,
# run the core tests first, and copy the exe to dist/. No .NET needed on the host.
set -euo pipefail
ROOT=$(cd "$(dirname "$0")/.." && pwd)
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT
tar -C "$ROOT" --exclude='bin' --exclude='obj' --exclude='out' -czf "$TMP/c.tgz" companion
pct exec 105 -- sh -c 'rm -rf /root/companion-build && mkdir -p /root/companion-build'
pct push 105 "$TMP/c.tgz" /root/companion-build/c.tgz
pct exec 105 -- sh -c 'cd /root/companion-build && tar xzf c.tgz && docker run --rm -v bbx-nuget:/root/.nuget -v /root/companion-build/companion:/src -w /src mcr.microsoft.com/dotnet/sdk:8.0 sh -c "
  cd Tests && dotnet run -c Release 2>&1 | grep -E \"PASS|FAIL\" ; dotnet run -c Release >/dev/null 2>&1 || { echo TESTS FAILED; exit 1; }
  cd ../App && dotnet publish -c Release -r win-x64 --self-contained -p:PublishSingleFile=true -p:IncludeNativeLibrariesForSelfExtract=true -p:EnableCompressionInSingleFile=true -p:DebugType=none -o /src/out 2>&1 | grep -E \" error |warning CS|-> /src/out\""'
mkdir -p "$ROOT/dist"
pct pull 105 /root/companion-build/companion/out/BloxboardCompanion.exe "$ROOT/dist/BloxboardCompanion.exe"
pct exec 105 -- rm -rf /root/companion-build
ls -la "$ROOT/dist/BloxboardCompanion.exe"
sha256sum "$ROOT/dist/BloxboardCompanion.exe"
echo "Remove the SDK image when done: pct exec 105 -- docker rmi mcr.microsoft.com/dotnet/sdk:8.0"
