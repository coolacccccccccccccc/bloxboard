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

  const games = await BB.get('games', {});
  games[p.universeId] = {
    name: p.lastLocation || games[p.universeId]?.name || `Game ${p.universeId}`,
    placeId: p.rootPlaceId || p.placeId || games[p.universeId]?.placeId,
  };
  await BB.set('games', games);
  await BB.set('currentGame', { universeId: p.universeId, since: (await BB.get('currentGame'))?.universeId === p.universeId ? (await BB.get('currentGame')).since : Date.now() });
}

async function checkTrades() {
  const { count } = await BB.api('https://trades.roblox.com/v1/trades/Inbound/count', { retries: 1 });
  const last = await BB.get('lastInboundCount', null);
  await BB.set('lastInboundCount', count);
  if (last == null || count <= last) return;

  const fresh = count - last;
  chrome.notifications.create(`trade-${Date.now()}`, {
    type: 'basic',
    iconUrl: chrome.runtime.getURL('icons/128.png'),
    title: fresh === 1 ? 'New trade request' : `${fresh} new trade requests`,
    message: `You have ${count} inbound trade${count === 1 ? '' : 's'}. Click to see values.`,
    priority: 1,
  });
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

async function serverRegion(placeId, gameId) {
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
