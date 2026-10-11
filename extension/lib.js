// Shared helpers for the background worker, content scripts and dashboard.
// Classic script: defines the global `BB`.

var BB = (() => {
  const isExtensionPage = location.protocol === 'chrome-extension:';
  const isWorker = typeof window === 'undefined';
  const canFetchAnywhere = isExtensionPage || isWorker;

  const sleep = ms => new Promise(res => setTimeout(res, ms));
  const chunk = (arr, size) => {
    const out = [];
    for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
    return out;
  };

  let csrfToken = '';

  async function api(url, { method = 'GET', body, signal, retries = 5 } = {}) {
    for (let attempt = 0; ; attempt++) {
      const headers = {};
      if (body !== undefined) headers['Content-Type'] = 'application/json';
      if (csrfToken && method !== 'GET') headers['x-csrf-token'] = csrfToken;

      let res;
      try {
        res = await fetch(url, {
          method,
          headers,
          body: body !== undefined ? JSON.stringify(body) : undefined,
          credentials: 'include',
          signal,
        });
      } catch (e) {
        // Roblox's 429 responses often lack CORS headers, which surfaces as a network error.
        if (e.name === 'AbortError' || attempt >= retries) throw e;
        await sleep(Math.min(30000, 1500 * 2 ** attempt));
        continue;
      }

      const token = res.headers.get('x-csrf-token');
      if (res.status === 403 && token && token !== csrfToken) {
        csrfToken = token;
        continue;
      }
      if ((res.status === 429 || res.status >= 500) && attempt < retries) {
        await sleep(Math.min(30000, 800 * 2 ** attempt));
        continue;
      }
      if (!res.ok) {
        const err = new Error(res.status === 401 ? 'Not logged in on roblox.com' : `HTTP ${res.status} from ${new URL(url).hostname}`);
        err.status = res.status;
        if (res.status !== 401 && res.status !== 404) logError(new URL(url).pathname.slice(0, 80), err);
        throw err;
      }
      return res.status === 204 ? null : res.json();
    }
  }

  // Run `fn` over `items` with at most `limit` in flight.
  async function pool(items, limit, fn) {
    const results = new Array(items.length);
    let next = 0;
    const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        try {
          results[i] = await fn(items[i], i);
        } catch (e) {
          results[i] = e;
        }
      }
    });
    await Promise.all(workers);
    return results;
  }

  // ---------- storage ----------

  const DEFAULT_SETTINGS = {
    trackPlaytime: true,
    notifyTrades: true,
    notifyFriends: false,
    regionLookup: true,
    replaceServerList: true,
    homeMostPlayed: true,
    preferredRegion: '',
    quickSearch: true,
    tradeWarn: true,
    tradeWarnPct: 10,
    autoDecline: false,
    autoDeclinePct: 30,
    gameCardPlaytime: true,
  };

  async function get(key, fallback) {
    const obj = await chrome.storage.local.get(key);
    return obj[key] ?? fallback;
  }
  const set = (key, value) => chrome.storage.local.set({ [key]: value });
  const settings = async () => ({ ...DEFAULT_SETTINGS, ...(await get('settings', {})) });

  // Last 50 errors, shown in Settings so problems can be reported.
  async function logError(where, e) {
    try {
      const list = await get('errorLog', []);
      list.unshift({ at: Date.now(), where, message: String(e?.message || e).slice(0, 300), page: typeof location !== 'undefined' ? location.href.slice(0, 120) : '' });
      await set('errorLog', list.slice(0, 50));
    } catch {
      // storage unavailable
    }
  }

  // ---------- Roblox ----------

  let meCache = null;
  async function me() {
    if (!meCache) meCache = api('https://users.roblox.com/v1/users/authenticated', { retries: 1 }).catch((e) => {
      meCache = null;
      throw e;
    });
    return meCache;
  }

  async function resolveUser(query) {
    query = String(query).trim().replace(/^@/, '');
    if (/^\d+$/.test(query)) {
      try {
        const u = await api(`https://users.roblox.com/v1/users/${query}`);
        return u;
      } catch (e) {
        if (e.status !== 404 && e.status !== 400) throw e;
      }
    }
    const { data } = await api('https://users.roblox.com/v1/usernames/users', {
      method: 'POST',
      body: { usernames: [query], excludeBannedUsers: false },
    });
    if (!data?.[0]) return null;
    return api(`https://users.roblox.com/v1/users/${data[0].id}`);
  }

  async function users(ids) {
    const out = new Map();
    for (const part of chunk([...new Set(ids)], 100)) {
      const { data } = await api('https://users.roblox.com/v1/users', {
        method: 'POST',
        body: { userIds: part, excludeBannedUsers: false },
      });
      for (const u of data || []) out.set(u.id, u);
    }
    return out;
  }

  async function presence(ids) {
    const out = new Map();
    for (const part of chunk([...new Set(ids)], 50)) {
      const { userPresences } = await api('https://presence.roblox.com/v1/presence/users', {
        method: 'POST',
        body: { userIds: part },
      });
      for (const p of userPresences || []) out.set(p.userId, p);
    }
    return out;
  }

  async function headshots(ids, size = '150x150') {
    const out = new Map();
    for (const part of chunk([...new Set(ids)], 100)) {
      const { data } = await api(`https://thumbnails.roblox.com/v1/users/avatar-headshot?userIds=${part.join(',')}&size=${size}&format=Png&isCircular=false`);
      for (const t of data || []) out.set(t.targetId, t.imageUrl);
    }
    return out;
  }

  async function gameIcons(universeIds) {
    const out = new Map();
    for (const part of chunk([...new Set(universeIds)].filter(Boolean), 100)) {
      const { data } = await api(`https://thumbnails.roblox.com/v1/games/icons?universeIds=${part.join(',')}&size=150x150&format=Png&isCircular=false`);
      for (const t of data || []) out.set(t.targetId, t.imageUrl);
    }
    return out;
  }

  async function itemThumbs(assetIds) {
    const out = new Map();
    for (const part of chunk([...new Set(assetIds)].filter(Boolean), 100)) {
      const { data } = await api(`https://thumbnails.roblox.com/v1/assets?assetIds=${part.join(',')}&size=110x110&format=Png&isCircular=false`);
      for (const t of data || []) out.set(t.targetId, t.imageUrl);
    }
    return out;
  }

  async function universeOf(placeId) {
    const { universeId } = await api(`https://apis.roblox.com/universes/v1/places/${placeId}/universe`);
    return universeId;
  }

  async function friendIds(userId, max = 1000) {
    const ids = [];
    let cursor = '';
    do {
      const page = await api(`https://friends.roblox.com/v1/users/${userId}/friends/find?limit=50${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`);
      for (const f of page.PageItems || []) ids.push(f.id);
      cursor = page.NextCursor;
    } while (cursor && ids.length < max);
    return ids;
  }

  // Trade sides normalized from the v2 API (falls back to v1).
  async function tradeDetails(id) {
    try {
      const t = await api(`https://trades.roblox.com/v2/trades/${id}`, { retries: 2 });
      const side = o => ({
        user: o.user,
        robux: o.robux || 0,
        items: (o.items || []).map(i => ({ assetId: Number(i.itemTarget?.targetId), name: i.itemName, serial: i.serialNumber, rap: i.recentAveragePrice })),
      });
      if (t.participantAOffer) return [side(t.participantAOffer), side(t.participantBOffer)];
    } catch (e) {
      if (e.status === 401) throw e;
    }
    const t = await api(`https://trades.roblox.com/v1/trades/${id}`, { retries: 2 });
    return (t.offers || []).map(o => ({
      user: o.user,
      robux: o.robux || 0,
      items: (o.userAssets || []).map(a => ({ assetId: a.assetId, name: a.name, serial: a.serialNumber, rap: a.recentAveragePrice })),
    }));
  }

  function sideWorth(side, values) {
    let value = 0;
    let rap = 0;
    for (const it of side.items) {
      const row = values[it.assetId];
      value += itemWorth(row) || it.rap || 0;
      rap += row ? Math.max(row[2], 0) : (it.rap || 0);
    }
    return { value, rap, robux: side.robux, total: value + side.robux * 0.7 };
  }

  // Shareable web link that opens Roblox straight into a server.
  const inviteUrl = (placeId, gameId) => `https://www.roblox.com/games/start?placeId=${placeId}&gameInstanceId=${gameId}`;

  const joinUrl = (placeId, gameId) => gameId
    ? `roblox://experiences/start?placeId=${placeId}&gameInstanceId=${gameId}`
    : `roblox://experiences/start?placeId=${placeId}`;

  // ---------- Rolimons values ----------
  // itemdetails row: [name, acronym, rap, value, default_value, demand, trend, projected, hyped, rare]

  async function values() {
    if (!canFetchAnywhere) return chrome.runtime.sendMessage({ type: 'values' });
    const cached = await get('valuesCache');
    if (cached && Date.now() - cached.at < 10 * 60 * 1000) return cached.items;
    try {
      const res = await fetch('https://www.rolimons.com/itemapi/itemdetails');
      const json = await res.json();
      if (!json.success) throw new Error('Rolimons returned an error');
      await set('valuesCache', { at: Date.now(), items: json.items });
      return json.items;
    } catch (e) {
      if (cached) return cached.items;
      throw e;
    }
  }

  async function playerValue(userId) {
    if (!canFetchAnywhere) return chrome.runtime.sendMessage({ type: 'playerValue', userId });
    const res = await fetch(`https://api.rolimons.com/players/v1/playerinfo/${userId}`);
    if (!res.ok) return null;
    const json = await res.json();
    return json.success ? json : null;
  }

  const itemWorth = (row) => {
    if (!row) return 0;
    return row[3] > 0 ? row[3] : Math.max(row[2], 0);
  };

  const DEMAND = ['Terrible', 'Low', 'Normal', 'High', 'Amazing'];

  // ---------- formatting ----------

  function num(n) {
    if (n == null || Number.isNaN(n)) return '–';
    const abs = Math.abs(n);
    if (abs >= 1e9) return `${(n / 1e9).toFixed(abs >= 1e10 ? 0 : 1)}B`;
    if (abs >= 1e6) return `${(n / 1e6).toFixed(abs >= 1e7 ? 0 : 1)}M`;
    if (abs >= 1e4) return `${(n / 1e3).toFixed(abs >= 1e5 ? 0 : 1)}K`;
    return n.toLocaleString('en-US');
  }

  function duration(minutes) {
    minutes = Math.round(minutes || 0);
    if (minutes < 60) return `${minutes}m`;
    const h = Math.floor(minutes / 60);
    const m = minutes % 60;
    return m ? `${h}h ${m}m` : `${h}h`;
  }

  function ago(ts) {
    const s = Math.max(0, (Date.now() - new Date(ts)) / 1000);
    if (s < 60) return 'just now';
    if (s < 3600) return `${Math.floor(s / 60)}m ago`;
    if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
    if (s < 86400 * 30) return `${Math.floor(s / 86400)}d ago`;
    return new Date(ts).toLocaleDateString();
  }

  async function topGames(days) {
    const [playtime, games] = await Promise.all([get('playtime', {}), get('games', {})]);
    const keys = days == null ? Object.keys(playtime) : Array.from({ length: days }, (_, i) => {
      const d = new Date();
      d.setDate(d.getDate() - i);
      return dayKey(d);
    });
    const per = new Map();
    for (const k of keys) for (const [u, m] of Object.entries(playtime[k] || {})) per.set(u, (per.get(u) || 0) + m);
    return [...per.entries()].sort((a, b) => b[1] - a[1]).map(([universeId, minutes]) => ({ universeId: Number(universeId), minutes, ...games[universeId] }));
  }

  const dayKey = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

  function el(tag, attrs = {}, ...children) {
    const node = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (v == null || v === false) continue;
      if (k === 'class') node.className = v;
      else if (k === 'text') node.textContent = v;
      else if (k.startsWith('on')) node.addEventListener(k.slice(2), v);
      else if (k === 'style' && typeof v === 'object') Object.assign(node.style, v);
      else node.setAttribute(k, v === true ? '' : v);
    }
    for (const c of children.flat(Infinity)) {
      if (c == null || c === false) continue;
      node.append(c instanceof Node ? c : document.createTextNode(String(c)));
    }
    return node;
  }

  return {
    sleep, chunk, api, pool, get, set, settings, DEFAULT_SETTINGS, logError,
    me, resolveUser, users, presence, headshots, gameIcons, itemThumbs, universeOf, joinUrl, inviteUrl, friendIds, tradeDetails, sideWorth,
    values, playerValue, itemWorth, DEMAND,
    num, duration, dayKey, ago, topGames, el,
  };
})();
