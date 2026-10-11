# Bloxboard

Free Roblox companion extension (Chromium / Helium): server browser with regions, player finder,
playtime, trade values, friends, and a dashboard. Website: https://bloxboard.enesserver.dev

## Layout

| Path | What |
|---|---|
| `extension/` | The extension itself (Manifest V3). Load this folder unpacked while developing. |
| `site/` | Website templates (download page, plan). `{{…}}` placeholders are filled by the build. |
| `docs/PLAN.md` | The roadmap / checklist. The website's Plan page is generated from it. |
| `CHANGELOG.md` | Release notes, shown on the website. |
| `tools/build.py` | Checks JS, packs signed `.crx` + `.zip` into `dist/`, builds `site-dist/`. `--bump` raises the patch version. |
| `tools/deploy.sh` | Publishes `site-dist/` to Caddy in CT103 (`/var/www/bloxboard`). |
| `tools/test/run.sh` | Real-Chromium test in the Playwright container on CT105; screenshots in `tools/test/shots/`. |
| `keys/bloxboard.pem` | CRX signing key (not in git). Backup: `/root/backups/bloxboard-signing-key.pem`. Same key = same extension ID = updates keep working. |

## Release

```sh
python3 tools/build.py --bump   # new version
tools/test/run.sh               # browser test + screenshots
tools/deploy.sh                 # website + update feed
git commit -am "Release x.y.z"
```

## Developing

Helium → `helium://extensions` → Developer mode → Load unpacked → `extension/`.
After editing, click the reload icon on the extension card and refresh roblox.com.

## Code map

- `extension/lib.js`: shared helpers (`BB.api` with CSRF + backoff, Roblox lookups, Rolimons values, formatting, `BB.el` DOM builder). Loaded by everything.
- `extension/background.js`: service worker. 1-minute alarm (playtime, trade + friend notifications), server-region lookups, opens the dashboard.
- `extension/content/game.js`: game page panel (stats, server browser, player finder).
- `extension/content/profile.js`: profile info bar.
- `extension/dashboard/`: the dashboard tab (hash routes: `#home`, `#playtime`, `#friends`, `#trades`, `#items`, `#lookup/<name>`, `#settings`).
