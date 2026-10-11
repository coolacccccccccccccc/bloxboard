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
git push                        # GitHub: coolacccccccccccccc/bloxboard via deploy key (~/.ssh/bloxboard_deploy, host alias github-bloxboard)
```

## Developing

Helium → `helium://extensions` → Developer mode → Load unpacked → `extension/`.
After editing, click the reload icon on the extension card and refresh roblox.com.

## Code map

- `extension/lib.js`: shared helpers (`BB.api` with CSRF + backoff, Roblox lookups, Rolimons values, formatting, `BB.el` DOM builder). Loaded by everything.
- `extension/background.js`: service worker. 1-minute alarm (playtime, trade + friend notifications), server-region lookups, opens the dashboard.
- `extension/content/game.js`: game page panel (stats, server browser, player finder).
- `extension/content/profile.js`: profile info bar (value, mutuals, last online, private note).
- `extension/content/home.js`: "Most played" row on roblox.com/home.
- `extension/content/search.js`: quick search under the navbar search box.
- `extension/content/trade.js`: trade window totals + lowball warning.
- `extension/content/item.js`: value card on catalog pages of limiteds.
- `extension/content/cards.js`: playtime badges on game cards.
- `extension/content/theme.js`: optional roblox.com themes (document_start).
- `extension/dashboard/`: the dashboard tab (hash routes: `#home`, `#playtime`, `#games`, `#friends`, `#robux`, `#trades`, `#items`, `#sandbox`, `#lookup/<name>`, `#settings`).

## Website hosting (one-time Caddy setup in CT103)

Not done yet: auto mode blocked the Caddyfile change, so this is a manual step. Same routine as always:

```sh
pct exec 103 -- cp /etc/caddy/Caddyfile /etc/caddy/Caddyfile.before-bloxboard
pct exec 103 -- sh -c 'cat >> /etc/caddy/Caddyfile' <<'BLOCK'

# Bloxboard: extension website + update feed (deployed from /root/test/bloxboard on the host)
bloxboard.enesserver.dev {
	import cloudflare_tls
	import crowdsec_logging
	root * /var/www/bloxboard
	@crx path *.crx
	header @crx Content-Type application/x-chrome-extension
	@fresh path /updates.xml /plan.html /
	header @fresh Cache-Control "no-cache"
	file_server
}
BLOCK
pct exec 103 -- caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile && pct exec 103 -- systemctl reload caddy
tools/deploy.sh
```

Undo: `pct exec 103 -- cp /etc/caddy/Caddyfile.before-bloxboard /etc/caddy/Caddyfile && pct exec 103 -- systemctl reload caddy`
