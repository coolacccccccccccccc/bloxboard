importScripts('lib.js');

const TICK = 'bloxboard-tick';

async function ensureSetup() {
  const alarm = await chrome.alarms.get(TICK);
  if (!alarm) chrome.alarms.create(TICK, { periodInMinutes: 1, delayInMinutes: 0.1 });

  // gamejoin answers browser-style requests less reliably; identify our own
  // background requests (tabId -1) the way the Roblox client does.
  await chrome.declarativeNetRequest.updateSessionRules({
    removeRuleIds: [1],
    addRules: [{
      id: 1,
      priority: 1,
      action: {
        type: 'modifyHeaders',
        requestHeaders: [{ header: 'User-Agent', operation: 'set', value: 'Roblox/WinInet' }],
      },
      condition: { urlFilter: '||gamejoin.roblox.com/', tabIds: [-1] },
    }],
  });
}

chrome.runtime.onInstalled.addListener(ensureSetup);
chrome.runtime.onStartup.addListener(ensureSetup);

chrome.action.onClicked.addListener(() => openDashboard());

async function openDashboard(hash = '') {
  const url = chrome.runtime.getURL(`dashboard/dashboard.html${hash ? `#${hash}` : ''}`);
  const [existing] = await chrome.tabs.query({ url: chrome.runtime.getURL('dashboard/dashboard.html') + '*' });
  if (existing) {
    await chrome.tabs.update(existing.id, { active: true, url });
    await chrome.windows.update(existing.windowId, { focused: true });
  } else {
    await chrome.tabs.create({ url });
  }
}

// ---------- periodic work ----------

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === TICK) tick().catch(() => {});
});

async function tick() {
  const settings = await BB.settings();
  let me;
  try {
    me = await BB.me();
  } catch {
    return; // logged out
  }

  const now = Date.now();
  const lastTick = await BB.get('lastTick', 0);
  if (now - lastTick < 45000) return;
  await BB.set('lastTick', now);
  const minute = Math.floor(now / 60000);

  if (settings.trackPlaytime) await trackPlaytime(me.id).catch(() => {});
  if (settings.notifyTrades && minute % 2 === 0) await checkTrades().catch(() => {});
  if (settings.notifyFriends && minute % 2 === 1) await checkFriends(me.id).catch(() => {});
  if (minute % 30 === 7) await friendLog(me.id).catch(e => BB.logError('friend log', e));
}

async function trackPlaytime(userId) {
  const p = (await BB.presence([userId])).get(userId);
  if (p?.userPresenceType !== 2 || !p.universeId) {
    await BB.set('currentGame', null);
    return;
  }

  const day = BB.dayKey();
  const playtime = await BB.get('playtime', {});
  playtime[day] ??= {};
  playtime[day][p.universeId] = (playtime[day][p.universeId] || 0) + 1;
  await BB.set('playtime', playtime);

  // Hour-of-week heatmap: minutes per "weekday-hour" (0 = Sunday).
  const now = new Date();
  const hours = await BB.get('playHours', {});
  const hk = `${now.getDay()}-${now.getHours()}`;
  hours[hk] = (hours[hk] || 0) + 1;
  await BB.set('playHours', hours);

  const games = await BB.get('games', {});
  const name = p.lastLocation || games[p.universeId]?.name || `Game ${p.universeId}`;
  const placeId = p.rootPlaceId || p.placeId || games[p.universeId]?.placeId;
  games[p.universeId] = { name, placeId };
  await BB.set('games', games);

  const current = await BB.get('currentGame');
  await BB.set('currentGame', { universeId: p.universeId, since: current?.universeId === p.universeId ? current.since : Date.now() });

  // Recent servers: one entry per server, newest first.
  if (p.gameId) {
    const recent = await BB.get('recentServers', []);
    const existing = recent.find(r => r.gameId === p.gameId);
    if (existing) {
      existing.lastSeen = Date.now();
      existing.minutes = (existing.minutes || 0) + 1;
    } else {
      recent.unshift({ gameId: p.gameId, placeId: p.placeId, rootPlaceId: p.rootPlaceId, universeId: p.universeId, name, joinedAt: Date.now(), lastSeen: Date.now(), minutes: 1 });
    }
    recent.sort((a, b) => b.lastSeen - a.lastSeen);
    await BB.set('recentServers', recent.slice(0, 60));
  }
}

async function checkTrades() {
  const { count } = await BB.api('https://trades.roblox.com/v1/trades/Inbound/count', { retries: 1 });
  const last = await BB.get('lastInboundCount', null);
  await BB.set('lastInboundCount', count);
  if (last == null || count <= last) return;

  const seen = new Set(await BB.get('notifiedTrades', []));
  const { data } = await BB.api('https://trades.roblox.com/v1/trades/Inbound?limit=10&sortOrder=Desc', { retries: 1 });
  const fresh = (data || []).filter(t => !seen.has(t.id)).slice(0, 3);
  const [me, values] = await Promise.all([BB.me(), BB.values().catch(() => ({}))]);

  for (const t of fresh) {
    seen.add(t.id);
    let message = 'Click to see the trade.';
    try {
      const sides = await BB.tradeDetails(t.id);
      const mine = sides.find(s => s.user?.id === me.id) || sides[0];
      const theirs = sides.find(s => s !== mine) || sides[1];
      const give = BB.sideWorth(mine, values).total;
      const get = BB.sideWorth(theirs, values).total;
      const diff = get - give;
      const pct = give ? Math.round((diff / give) * 100) : 0;
      const settings = await BB.settings();
      if (settings.autoDecline && give > 0 && pct <= -settings.autoDeclinePct) {
        await BB.api(`https://trades.roblox.com/v1/trades/${t.id}/decline`, { method: 'POST', body: {}, retries: 2 });
        const log = await BB.get('autoDeclined', []);
        log.unshift({ at: Date.now(), id: t.id, user: t.user.displayName, give, get, pct });
        await BB.set('autoDeclined', log.slice(0, 100));
        chrome.notifications.create(`autodeclined-${t.id}`, {
          type: 'basic',
          iconUrl: chrome.runtime.getURL('icons/128.png'),
          title: `Auto-declined a trade from ${t.user.displayName}`,
          message: `You'd give ${BB.num(Math.round(give))} for ${BB.num(Math.round(get))} (${pct}%). Change the rule in Bloxboard settings.`,
        });
        continue;
      }
      message = `You give ${BB.num(Math.round(give))} · you get ${BB.num(Math.round(get))}\n${diff >= 0 ? 'Win' : 'Loss'}: ${diff >= 0 ? '+' : ''}${BB.num(Math.round(diff))} (${pct > 0 ? '+' : ''}${pct}%)`;
    } catch {
      // keep the plain message
    }
    chrome.notifications.create(`trade-${t.id}`, {
      type: 'basic',
      iconUrl: chrome.runtime.getURL('icons/128.png'),
      title: `Trade from ${t.user.displayName}`,
      message,
      priority: 1,
      requireInteraction: true,
      buttons: [{ title: 'Decline trade' }, { title: 'Open trades' }],
    });
  }
  await BB.set('notifiedTrades', [...seen].slice(-200));
}

// Friend log: snapshot friend ids, record who appeared or disappeared.
async function friendLog(userId) {
  const ids = await BB.friendIds(userId, 2000);
  if (!ids.length) return;
  const prev = await BB.get('friendSnapshot', null);
  await BB.set('friendSnapshot', ids);
  if (!prev) return;
  const before = new Set(prev);
  const now = new Set(ids);
  const added = ids.filter(id => !before.has(id));
  const removed = prev.filter(id => !now.has(id));
  if (!added.length && !removed.length) return;
  const names = await BB.users([...added, ...removed]).catch(() => new Map());
  const log = await BB.get('friendLog', []);
  const at = Date.now();
  for (const id of added) log.unshift({ at, id, type: 'added', name: names.get(id)?.displayName, username: names.get(id)?.name });
  for (const id of removed) log.unshift({ at, id, type: 'removed', name: names.get(id)?.displayName, username: names.get(id)?.name });
  await BB.set('friendLog', log.slice(0, 300));
}

async function checkFriends(userId) {
  const ids = [];
  let cursor = '';
  do {
    const page = await BB.api(`https://friends.roblox.com/v1/users/${userId}/friends/find?limit=50${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`, { retries: 1 });
    for (const f of page.PageItems || []) ids.push(f.id);
    cursor = page.NextCursor;
  } while (cursor && ids.length < 500);

  const pres = await BB.presence(ids);
  const inGame = {};
  for (const [id, p] of pres) if (p.userPresenceType === 2) inGame[id] = p.lastLocation || 'a game';

  const before = await BB.get('friendsInGame', null);
  await BB.set('friendsInGame', inGame);
  if (!before) return;

  const started = Object.keys(inGame).filter(id => !before[id]);
  if (!started.length) return;
  const names = await BB.users(started.map(Number));
  const lines = started.slice(0, 4).map(id => `${names.get(Number(id))?.displayName || 'Friend'} → ${inGame[id]}`);
  chrome.notifications.create(`friends-${Date.now()}`, {
    type: 'basic',
    iconUrl: chrome.runtime.getURL('icons/128.png'),
    title: started.length === 1 ? 'A friend started playing' : `${started.length} friends started playing`,
    message: lines.join('\n') + (started.length > 4 ? `\n+${started.length - 4} more` : ''),
    priority: 0,
  });
}

chrome.notifications.onButtonClicked.addListener(async (id, index) => {
  const m = id.match(/^trade-(\d+)$/);
  if (!m) return;
  chrome.notifications.clear(id);
  if (index === 1) {
    chrome.tabs.create({ url: 'https://www.roblox.com/trades' });
    return;
  }
  try {
    await BB.api(`https://trades.roblox.com/v1/trades/${m[1]}/decline`, { method: 'POST', body: {}, retries: 2 });
    chrome.notifications.create(`declined-${m[1]}`, { type: 'basic', iconUrl: chrome.runtime.getURL('icons/128.png'), title: 'Trade declined', message: 'Done. It\'s gone from your inbound trades.' });
  } catch (e) {
    chrome.notifications.create(`declinefail-${m[1]}`, { type: 'basic', iconUrl: chrome.runtime.getURL('icons/128.png'), title: 'Couldn\'t decline the trade', message: `${e.message}. Open roblox.com/trades to decline it there.` });
  }
});

chrome.notifications.onClicked.addListener((id) => {
  openDashboard(id.startsWith('trade') ? 'trades' : 'friends');
  chrome.notifications.clear(id);
});

// ---------- server regions ----------

async function geo(ip) {
  const key = ip.split('.').slice(0, 3).join('.');
  const cache = await BB.get('geoCache', {});
  if (cache[key]) return cache[key];
  const res = await fetch(`https://ipwho.is/${ip}?fields=success,city,region,country,country_code`);
  const json = await res.json();
  if (!json.success) return null;
  const info = { city: json.city || json.region || json.country, country: json.country, cc: json.country_code };
  cache[key] = info;
  await BB.set('geoCache', cache);
  return info;
}

// Regions per server, remembered for 10 minutes.
const regionCache = new Map();

async function serverRegion(placeId, gameId) {
  const hit = regionCache.get(gameId);
  if (hit && Date.now() - hit.at < 10 * 60 * 1000) return hit.value;
  const value = await lookupRegion(placeId, gameId);
  if (value?.city) regionCache.set(gameId, { at: Date.now(), value });
  return value;
}

async function lookupRegion(placeId, gameId) {
  const res = await BB.api('https://gamejoin.roblox.com/v1/join-game-instance', {
    method: 'POST',
    retries: 2,
    body: { placeId: Number(placeId), gameId, gameJoinAttemptId: crypto.randomUUID(), isTeleport: false },
  });
  const js = res?.joinScript;
  const ip = js?.UdmuxEndpoints?.[0]?.Address || js?.MachineAddress;
  if (!ip || !/^\d+\.\d+\.\d+\.\d+$/.test(ip)) return { status: res?.status ?? null };
  return { ip, ...(await geo(ip)) };
}

// ---------- messages ----------

chrome.runtime.onMessage.addListener((msg, sender, reply) => {
  const handlers = {
    values: () => BB.values(),
    playerValue: () => BB.playerValue(msg.userId),
    openDashboard: () => openDashboard(msg.hash),
    regions: async () => {
      if (!(await BB.settings()).regionLookup) return {};
      const list = await BB.pool(msg.gameIds, 3, id => serverRegion(msg.placeId, id));
      return Object.fromEntries(msg.gameIds.map((id, i) => [id, list[i] instanceof Error ? null : list[i]]));
    },
  };
  const handler = handlers[msg?.type];
  if (!handler) return false;
  Promise.resolve(handler()).then(reply, e => reply({ error: e.message }));
  return true;
});
