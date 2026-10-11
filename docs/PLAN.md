# Bloxboard plan

> Goal: a free Roblox companion that covers what RoPro Plus / Rex / Ultra charge for, plus a niche dashboard, while staying tidy on roblox.com. Own code and own branding only. Nothing copied from RoPro.

Legend: done · in progress · to do. This file is the source of truth; the website's Plan page is built from it.

## 0. Project setup

- [x] Project folder `/root/test/bloxboard` with git
- [x] Folder layout: `extension/`, `site/`, `tools/`, `docs/`, `keys/`
- [x] Signing key `keys/bloxboard.pem` (backup in `/root/backups/bloxboard-signing-key.pem`). Losing it means a new extension ID and no updates
- [x] Build script `tools/build.py`: syntax check, signed .crx + .zip, update feed, website
- [x] Deploy script `tools/deploy.sh`: website to `bloxboard.enesserver.dev` (Caddy CT103, `/var/www/bloxboard`)
- [x] Test script `tools/test/run.sh`: real Chromium in the Playwright container on CT105, real roblox.com logged out, mocked APIs for the dashboard and home page
- [x] Website: download page, install guide, features, changelog, this plan
- [x] Auto-update feed `updates.xml` + `update_url` in the manifest
- [x] Decided: website is public
- [x] Website live at `bloxboard.enesserver.dev` (Caddy site block)
- [x] Decided: GitHub repo
- [x] GitHub repo created (`coolacccccccccccccc/bloxboard`)
- [ ] **You:** add the deploy key (Settings → Deploy keys, write access) so the server can push

## 1. v0.1 (tested by you, logged in)

- [x] Game page panel: like ratio, players, visits, favorites, last update, your playtime
- [x] Server browser with Join per server
- [x] Server regions via gamejoin + ipwho.is (confirmed working logged in)
- [x] Player finder: presence first, then repeated token scans
- [x] Profile bar: Rolimons value and RAP, join date, status, Join
- [x] Dashboard: Home, Playtime, Friends, Trades, Items & values, Player lookup, Settings
- [x] Background: playtime every minute, trade notifications, optional friend notifications
- [x] Light and dark mode, phone-width layout
- [x] Installs in Helium and works logged in

## 2. v0.2 server tools (RoPro free + Plus parity)

- [x] Replaces Roblox's own public server list and filter bar (toggle "Show Roblox list")
- [x] Filters: sort (most, fewest, ping, FPS, free slots, friends first), region, player count min–max, free slots, max ping, min FPS, hide full, friends only
- [x] Preferred region: the Region filter is remembered for every game and auto-detects regions
- [x] Join best (first server matching your filters with room)
- [x] Random server hop
- [x] Invite link to any server (copies an official roblox.com link that opens straight into that server)
- [x] Friends-in-server marker with their avatars
- [x] Recent servers: servers you played in, with time, Rejoin, and whether it's still running
- [x] "Been here" tag on servers you've played in
- [x] Load all servers (stops at 3000, can be stopped)
- [x] Live like/dislike counters (refresh every 30 s)
- [ ] **You:** check that Roblox's own list is hidden and the panel sits in its place
- [ ] World map view of server regions (pick a region on the map)
- [ ] Server uptime (oldest/newest): Roblox doesn't expose it. Needs our own "first seen" tracking, best with the sync server (section 8)
- [x] Cache regions per server for 10 minutes so re-opening a game doesn't re-ask Roblox
- [ ] Rate-limit guard for the Roblox API changes of 19 Oct 2026 (central request queue, backoff)

## 3. Home page and games

- [x] "Most played" row on roblox.com/home with time played, past week / month / all time
- [ ] **You:** check where the row lands on the real home page
- [x] Playtime badge on game cards across roblox.com
- [x] Quick search & quick play in the navbar: games with Play, limiteds with values, exact player match
- [x] Random game from your favorites and played games, filtered by size (Games page)
- [x] Game page: badge progress (which badges you have, missing ones first, easiest on top)
- [x] Favorites in the dashboard (sort by updated, players, your playtime, likes)
- [x] Game update tracker: notify when a favorite game updates

## 4. Trading (RoPro Plus + Rex parity)

- [x] Trade notifications show the values: you give, you get, win or loss in %
- [x] Item info card on catalog pages: value, RAP, demand, trend, projected / hyped / rare
- [x] Trades page in the dashboard with values and win/loss
- [x] Values shown inside Roblox's own trade window, updating as you add items (trade calculator)
- [ ] **You:** check the trade window totals on a real trade (built against Roblox's class names, tested on a mock page)
- [x] Decline a trade straight from the notification (Decline / Open buttons)
- [x] Lowball warning before you accept, send or counter a trade (loss above 10%, or projected / terrible-demand items)
- [x] Outbound trade protection: same warning before sending
- [x] Auto-decline bad inbound trades by your rule (off by default, only declines, never accepts)
- [x] Quick limited search in the navbar
- [ ] Advanced item search inside the trade window
- [ ] Item value graphs (value and RAP history) on the item card
- [x] Completed trades: net profit, wins, best and worst trade (at today's values)
- [x] Profit-over-time chart (running total of completed trades)
- [ ] Item value change alerts for items you own
- [ ] Wishlist with price alerts (resale price drops below your target)
- [ ] Never auto-accept or auto-send trades (Roblox ToS). Only show, warn and decline

## 5. Profiles and friends

- [x] Account value on profiles
- [x] Mutual friends on profiles (count, avatars, names on hover)
- [x] Last online on profiles (when Roblox still returns it)
- [ ] More mutuals on the friends page
- [x] Your private notes on a player (on their profile, shown in Player lookup)
- [x] Friend log: who added or removed you, and when (checked every 30 minutes)
- [ ] Friends' online history chart (when your friends are usually on)
- [ ] Best friends pinned to the top with notifications only for them
- [ ] Profile likes and Discord tag (RoPro does this with its own server; would need the sync server)

## 6. Niche dashboard

- [x] Recent servers on the dashboard home
- [x] Robux page: in/out per day/week/month/year, breakdown, spending per month, by type, where it went, latest purchases
- [ ] Group page: group funds and payouts for groups you own
- [ ] Account page: account age, badges count, collectibles count, "year in Roblox" style summary
- [x] Playtime: current and longest streak, when-you-play heatmap (weekday × hour)
- [x] Playtime per-game trends (14-day sparkline per game)
- [x] Recent alerts on the dashboard home
- [ ] Customizable Home (pick and order the cards)
- [x] Export everything to JSON (Settings)

## 7. Avatar and themes

- [x] Avatar sandbox: try any catalog item on your avatar without owning it, with cost of what you don't own
- [ ] **You:** check the sandbox renders (Roblox's render service needs a login, so it's untested)
- [x] Save sandbox outfits
- [ ] Quick equip / unequip in the avatar editor
- [ ] Advanced body type editor (exact sliders)
- [ ] Avatar editor look: compact layout, bigger item grid
- [x] Themes for roblox.com: Midnight, Ocean, Forest, Grape (dark mode) and Sakura (light mode)
- [ ] Custom theme colors, shareable as a code
- [ ] Cheapest-copy finder for an outfit

## 8. Infrastructure on the homelab

- [ ] Optional sync server (small container) so playtime and settings follow you between PCs. Private token, your data only
- [ ] Shared region cache and server "first seen" times (enables uptime filters)
- [x] Release flow: `build.py --bump` → test → deploy, with the changelog shown on the site
- [ ] Uptime check for `bloxboard.enesserver.dev` in the nightly homelab check

## 9. Quality

- [x] Mock-API test suite for every dashboard page and the home row (`tools/test`)
- [x] Diagnostics in Settings: checks every Roblox service Bloxboard uses, with a Copy button
- [x] Error log in Settings (last 50 errors, copy button)
- [ ] Accessibility pass: keyboard-only use, contrast, screen reader labels
- [ ] Performance: Rolimons values cached, no request storms on roblox.com

## RoPro feature check

Every RoPro feature from ropro.io/features, and where it stands in Bloxboard.

- [x] Track playtime by game
- [x] Most played games on the home page
- [x] Recent servers you've left
- [x] Hop to a random server
- [x] Filter servers by player count (smallest first, not full, custom count)
- [x] Invite link to any server
- [x] Preferred server location
- [x] Live like and dislike counters
- [x] Mutual friends and last online on profiles
- [x] Account value on profiles
- [x] Trade notifier with value calculator
- [x] Trade win/loss preview (dashboard)
- [x] Item info card
- [ ] Preferred location on a world map
- [ ] Oldest / newest server filters (needs uptime tracking)
- [x] Quick search & quick play
- [x] Trade value calculator inside the trade window
- [x] Quick limited search in the navbar
- [ ] Item search inside the trade window
- [x] Outbound trade protection
- [x] Auto-decline bad trades
- [x] Decline from the trade notification
- [x] Avatar sandbox and saved outfits
- [ ] Quick equip, body type editor, editor look
- [x] Themes
- [ ] More mutuals on the friends page
- [ ] Profile likes, Discord tag, item comments, Trade Board (all run on RoPro's own server; possible later with our sync server)

## 10. Community hub (idea from spectre)

> Stays free, no ads. One small server on the homelab powers this and the RoPro server-side features below.

- [ ] Decide who can post: invite-only (friends) first, or public
- [ ] Decide login: Sign in with Roblox (official OAuth app) or Discord
- [ ] Backend on the homelab: small API + database in its own container, behind Caddy at `bloxboard.enesserver.dev/api`
- [ ] Scripts: share Roblox Studio (Luau) scripts with highlighting, tags and a copy button
- [ ] Outfits: share avatar sandbox outfits; anyone can try them on in their own sandbox with one click
- [ ] Posts: short community posts with images
- [ ] Likes, comments, profiles (your Roblox avatar and name)
- [ ] Safety from day one: report button, admin queue, word filter, rate limits, delete and ban (lots of Roblox players are kids)
- [ ] In the extension: "Share outfit" in the sandbox, community feed in the dashboard
- [ ] Same server unlocks: profile likes, comments on limiteds, trade board, oldest/newest servers, playtime sync between PCs

## Rules we stick to

- Read-only towards Roblox, except joining servers and (opt-in) declining trades. No trading bots, no auto-accept, no spam
- Respect rate limits; back off on 429 instead of retrying hard
- No RoPro code, names or artwork
- Data stays in the browser unless the optional sync server is turned on
- Every release: test, build, deploy, changelog
