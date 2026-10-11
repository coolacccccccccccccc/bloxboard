# Bloxboard plan

> Goal: a free Roblox companion that covers what RoPro Plus / Rex / Ultra charge for, plus a niche dashboard, while staying tidy on roblox.com. Own code and own branding only. Nothing copied from RoPro.

Legend: done · in progress · to do. This file is the source of truth; the website's Plan page is built from it.

## 0. Project setup

- [x] Project folder `/root/test/bloxboard` with git
- [x] Folder layout: `extension/`, `site/`, `tools/`, `docs/`, `keys/`
- [x] Signing key `keys/bloxboard.pem` (backup in `/root/backups/bloxboard-signing-key.pem`). Losing it means a new extension ID and no updates
- [x] Build script `tools/build.py`: syntax check, signed .crx + .zip, update feed, website
- [x] Deploy script `tools/deploy.sh`: website to `bloxboard.enesserver.dev` (Caddy CT103, `/var/www/bloxboard`)
- [x] Test script `tools/test/run.sh`: real Chromium in the Playwright container on CT105, real roblox.com logged out, mocked APIs for the dashboard
- [x] Website: download page, install guide, features, changelog, this plan
- [x] Auto-update feed `updates.xml` + `update_url` in the manifest
- [ ] Decide: GitHub repo (private or public) or keep it local only
- [ ] Decide: website public, or only on LAN/Tailscale / behind Authentik

## 1. v0.1 shipped (needs your logged-in test)

- [x] Game page panel: like ratio, players, visits, favorites, last update, your playtime
- [x] Server browser: sort by players or ping, hide full, Join per server, Join smallest
- [x] Server regions via gamejoin + ipwho.is (on demand, 40 at a time)
- [x] Player finder: presence first, then repeated token scans (from RoSearcher 3.0)
- [x] Profile bar: Rolimons value and RAP, join date, status, Join
- [x] Dashboard: Home, Playtime, Friends, Trades, Items & values, Player lookup, Settings
- [x] Background: playtime every minute, trade notifications, optional friend notifications
- [x] Light and dark mode, phone-width layout
- [ ] **You:** install the .crx in Helium. Does it install, or does it need Load unpacked?
- [ ] **You:** logged in, open a game, Servers tab: do regions show up?
- [ ] **You:** player finder on a friend (instant) and on a stranger (scan)
- [ ] **You:** dashboard Home, Friends, Trades with real data: anything broken or ugly?
- [ ] **You:** play 10 minutes, then check that Playtime counted it
- [ ] **You:** does a trade notification pop up?
- [ ] Fix whatever the logged-in test turns up (0.1.x)

## 2. Server tools (RoPro Plus parity)

- [ ] Region filter remembers your favorite region per game
- [ ] "Join best server" picks by region + ping + free slots
- [ ] Share-a-server link: `bloxboard.enesserver.dev/join?place=…&id=…` opens Roblox straight into that server
- [ ] Server history: servers you joined, with time, so you can rejoin
- [ ] Friends-in-server marker in the server list
- [ ] Server size filter (e.g. 1–5 players) and "newest server" heuristic
- [ ] Cache regions per server for 10 minutes so re-opening a game doesn't re-ask Roblox
- [ ] Rate-limit guard for the Roblox API changes of 19 Oct 2026 (central request queue, backoff)

## 3. Trading (RoPro Rex parity)

- [ ] Values shown inside Roblox's own trade window (give, get, win or loss)
- [ ] Lowball warning before you accept or send a trade (value and % thresholds you set)
- [ ] Projected, hyped and low-demand warnings on every item in a trade
- [ ] Trade history analytics: profit over time, best and worst trades, chart
- [ ] Item value change alerts for items you own
- [ ] Wishlist with price alerts (resale price drops below your target)
- [ ] Item page extras: value, demand, trend, projected flag, owners
- [ ] Never auto-accept or auto-send trades (Roblox ToS). Only show and warn

## 4. Profiles and friends

- [ ] Mutual friends on someone's profile
- [ ] Your private notes on a player (stored locally)
- [ ] Friend log: who added or removed you, and when (dashboard)
- [ ] Friends' online history chart (when your friends are usually on)
- [ ] Best friends pinned to the top with notifications only for them

## 5. Games and discovery

- [ ] Playtime shown on game cards across roblox.com
- [ ] Random game button with filters (genre, player count, like ratio)
- [ ] Game page: badge progress (which badges you have and how rare they are)
- [ ] Favorites manager in the dashboard (sort, search, unfavorite dead games)
- [ ] Game update tracker: notify when a favorite game updates

## 6. Niche dashboard

- [ ] Robux page: spending and earnings history from the transactions API, chart per month, top purchases
- [ ] Group page: group funds and payouts for groups you own
- [ ] Account page: account age, badges count, collectibles count, "year in Roblox" style summary
- [ ] Playtime: streaks, hour-of-day heatmap, per-game trends
- [ ] Notification center: every alert Bloxboard sent, in one list
- [ ] Customizable Home (pick and order the cards)
- [ ] Export everything to JSON or CSV

## 7. Avatar

- [ ] Outfit sandbox: try items on your avatar before buying
- [ ] Quick outfit switcher in the dashboard
- [ ] Cheapest-copy finder for an outfit

## 8. Infrastructure on the homelab

- [ ] Optional sync server (small container) so playtime and settings follow you between PCs. Private token, your data only
- [ ] Shared region cache on the server so regions load instantly
- [ ] Release flow: `build.py --bump` → test → deploy, with the changelog shown on the site
- [ ] Uptime check for `bloxboard.enesserver.dev` in the nightly homelab check

## 9. Quality

- [ ] Mock-API test suite for every dashboard page (extend `tools/test`)
- [ ] Logged-in smoke test you can run with your own browser profile
- [ ] Error reporting page in Settings (last 50 errors, copy button)
- [ ] Accessibility pass: keyboard-only use, contrast, screen reader labels
- [ ] Performance: Rolimons values cached, no request storms on roblox.com

## Rules we stick to

- Read-only towards Roblox, except joining servers. No trading bots, no auto-accept, no spam
- Respect rate limits; back off on 429 instead of retrying hard
- No RoPro code, names or artwork
- Data stays in the browser unless the optional sync server is turned on
- Every release: test, build, deploy, changelog
