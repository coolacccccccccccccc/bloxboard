## Changelog

### 0.8.3 · 12 October 2026

- Fix: the "Most played" row was on the Roblox home page but drawn underneath the friends row. Roblox lays that page out with floating columns; the row now always starts below them, sits above its neighbours, and moves to another spot if something still overlaps it.
- Diagnostics: the home page report also says what is drawn on top of the row and how the blocks around it are positioned.

### 0.8.2 · 12 October 2026

- Fix: the "Most played" row could still vanish on the Roblox home page. It now has more places to go (above the home feed, or before the first game row like "Continue") and skips spots where it would be hidden.
- New: Settings → Diagnostics → "Most played row" reports where the row landed on your last home page visit; "Copy result" includes a short outline of the page so layout changes can be fixed quickly.

### 0.8.1 · 12 October 2026

- Fix: the "Most played" row on the Roblox home page disappeared once the page finished loading. Roblox re-draws its home page after loading; Bloxboard now keeps putting the row back for as long as the page is open.
- Fix: roblox.com themes barely changed anything. They now recolor Roblox's new design (cards, menus, the Play button and other buttons, links, header) and switch Roblox to the matching mode: dark themes to dark mode, Sakura to light mode.

### Companion 2.0.1 · 12 October 2026

- Fix: games were detected unreliably. The companion now follows every recent Roblox player log instead of jumping to the newest file (which could throw your game away), and uses Fishstrap's rules: stray "disconnect" lines while joining and "back to the app" lines during teleports no longer end your session.
- New: when Roblox closes or crashes without saying so in its log, the session ends within about 10 seconds instead of staying stuck.

### Companion 2.0.0 + extension 0.8.0 · 12 October 2026

- Companion: new panel (Ctrl+Shift+B, or the tray icon) with the extension's features for the Roblox app: Now playing (server location, uptime, players/ping/FPS, invite, server hop by size or ping, rejoin, favorite, notes), a server browser with filters, regions and friends' servers, player finder, friends with Join, game search and favorites, and playtime stats with streaks, top games and an hour heatmap.
- Companion: playtime counts the older Roblox logs too, so stats start with your last week of play.
- Companion: link with the browser extension (Settings → Windows companion → Link) for regions, friends online and the finder. The companion still never reads your login; the extension does the logged-in requests, over 127.0.0.1 only.
- Companion: Ctrl+Shift+N shows or hides the mini overlay, which got a Panel button. Opening the .exe again brings the panel back.
- Extension: companion playtime shows up in the dashboard.
- Site: install guide for Brave.

### Companion 1.0.1 · 12 October 2026

- Fix: the window could stay on "Waiting for Roblox…" in a game. It now shows the game as soon as Roblox starts joining, and picks Roblox's newest log the same way Fishstrap does.
- New: Diagnostics in the tray menu shows which Roblox log it reads and what it found.

### Companion 1.0.0 + extension 0.7.2 · 11 October 2026

- New Windows app: Bloxboard Companion. A small always-on-top window next to Roblox with the game, server location, time in server, Copy invite, Server hop, Rejoin and Recent servers. It only reads Roblox's log file (like Fishstrap and Bloxstrap), so it never touches the game. Starts with Roblox through Fishstrap/Bloxstrap Custom Integrations.
- Extension: the companion's "Bloxboard" button opens the game page straight on Find player.

### 0.7.1 · 11 October 2026

- Player finder: new "Display name" mode. It looks up every account with that display name and scans the servers for all of them at once. Accounts with identical default avatars are skipped, so it doesn't match strangers.
- Player finder: every result has a Copy link button for an invite link to that server.

### 0.7.0 · 11 October 2026

- New: the Bloxboard Community at bloxboard.enesserver.dev/community. Share Roblox Studio scripts, outfits and posts. Anyone can read; to post, apply and an admin approves you.
- Avatar sandbox: "Share to community" button.
- Outfit posts: "Try it on" opens the outfit in your sandbox.

### 0.6.0 · 11 October 2026

- Themes for roblox.com (Settings): Midnight, Ocean, Forest and Grape for dark mode, Sakura for light mode. Off by default.
- Settings → Diagnostics: checks every Roblox service Bloxboard uses and lets you copy the result.
- Trades → Completed: running profit chart.
- Playtime: a 14-day mini chart next to every game.

### 0.5.0 · 11 October 2026

- Game pages: new Badges tab with your progress, missing badges first and the easiest on top.
- Dashboard: new Games page with your favorites and played games, sortable, plus a Random game button.
- Notifications when one of your favorite games updates.
- Trades → Completed: net profit, wins, best and worst trade.
- Home: Recent alerts.
- Settings: Export everything.

### 0.4.0 · 11 October 2026

- Game cards across roblox.com show your time played.
- Private notes on players: add one on their profile, see it in Player lookup.
- Friend log: who added or removed you, on the Friends page.
- Auto-decline (off by default): declines new trades that lose more than your %. It never accepts or sends.
- Settings: set your own lowball % and auto-decline %, and a Problems card with the last 50 errors to copy.
- Server regions are remembered for 10 minutes, so Roblox gets asked less.

### 0.3.0 · 11 October 2026

- Quick search: type in Roblox's search box for instant games (with a Play button), limiteds with values, and an exact player match. Arrow keys pick, Enter without a pick still does Roblox's normal search.
- Trade window: totals under each side and a You give / You get / win-or-loss bar, updating as items change.
- Lowball warning: asks before you send, counter or accept a trade that loses more than 10% or gets you projected or terrible-demand items.
- Trade notifications: Decline and Open buttons.
- Dashboard: new Robux page (in and out, breakdown, spending per month, where it went, latest purchases).
- Dashboard: avatar sandbox. Try any catalog item on your avatar, see what it costs, save outfits.
- Playtime: current and longest streak, and a heatmap of when you play.
- Fix: no more stray "null" text in a few places.

### 0.2.0 · 11 October 2026

- Game pages: Bloxboard's server list now replaces Roblox's own list and filter bar ("Show Roblox list" brings it back).
- New filters: sort by FPS, free slots or friends; player count range; free slots; max ping; min FPS; friends only.
- Your Region choice becomes your preferred region on every game, and regions are detected automatically.
- Join best, Random server, Load all, and a Link button that copies an invite to any server.
- Friends' avatars on the servers they're in, and a "Been here" tag on servers you've played in.
- New Recent tab: servers you played in, with Rejoin.
- Live like and dislike counters.
- roblox.com home: a "Most played" row with your time in each game (week, month, all time).
- Profiles: mutual friends and last online.
- Catalog pages: value card for limiteds (value, RAP, demand, trend, flags).
- Trade notifications now show what you give, what you get, and the win or loss.
- Dashboard: Recent servers card, new settings.
- Fix: keeps retrying when Roblox rate-limits instead of stopping.

### 0.1.0 · 11 October 2026

- First version.
- Game pages: stats bar, server browser with ping, FPS, regions and quick join, player finder.
- Profiles: value, RAP, join date, status and Join.
- Dashboard: Home, Playtime, Friends, Trades, Items & values, Player lookup, Settings.
- Background: playtime tracking, trade notifications, optional friend notifications.
