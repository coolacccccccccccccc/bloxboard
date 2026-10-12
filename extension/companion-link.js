// Link with the Bloxboard Windows companion (ws://127.0.0.1:47823/bridge).
// The companion has no Roblox login on purpose, so it asks us (logged in, in this browser) for the
// few things that need one: server regions, friends' presence and the player finder. It also sends
// its playtime (read from Roblox's log) so the dashboard counts play in the Roblox app.
// Only connects after the user clicked "Link" in Settings and granted access to 127.0.0.1.

const COMPANION_PORTS = [47823, 47824, 47825];
const COMPANION_ORIGINS = ['http://127.0.0.1/*', 'ws://127.0.0.1/*'];
let companionWs = null;
let companionConnecting = false;
let companionLastTry = 0;
const companionJobs = new Map();

async function companionEnabled() {
  if (!(await BB.settings()).companionLink) return false;
  try { return await chrome.permissions.contains({ origins: COMPANION_ORIGINS }); } catch { return false; }
}

function companionOpen(port) {
  return new Promise((resolve) => {
    let ws;
    try { ws = new WebSocket(`ws://127.0.0.1:${port}/bridge`); } catch { return resolve(null); }
    const timer = setTimeout(() => { try { ws.close(); } catch {} resolve(null); }, 2000);
    ws.onopen = () => { clearTimeout(timer); resolve(ws); };
    ws.onerror = () => { clearTimeout(timer); resolve(null); };
  });
}

async function connectCompanion(force = false) {
  if (companionWs && companionWs.readyState <= 1) return true;
  if (companionConnecting) return false;
  if (!force && Date.now() - companionLastTry < 10000) return false;
  companionLastTry = Date.now();
  if (!(await companionEnabled())) return false;
  companionConnecting = true;
  try {
    for (const port of COMPANION_PORTS) {
      const ws = await companionOpen(port);
      if (!ws) continue;
      companionSetup(ws);
      return true;
    }
    return false;
  } finally {
    companionConnecting = false;
  }
}

function companionSend(msg) {
  try { companionWs?.send(JSON.stringify(msg)); } catch {}
}

async function companionSetup(ws) {
  companionWs = ws;
  ws.onmessage = (e) => companionMessage(e.data);
  ws.onclose = () => {
    if (companionWs === ws) companionWs = null;
    for (const c of companionJobs.values()) c.abort();
    companionJobs.clear();
    BB.set('companionStatus', { connected: false, at: Date.now() });
  };
  let me = null;
  try { me = await BB.me(); } catch {}
  companionSend({ type: 'hello', version: chrome.runtime.getManifest().version, userId: me?.id || 0, userName: me?.name || '' });
  BB.set('companionStatus', { connected: true, at: Date.now(), userName: me?.name || '' });
}

async function companionMessage(raw) {
  let msg;
  try { msg = JSON.parse(raw); } catch { return; }
  if (msg.type === 'ping') return companionSend({ type: 'pong' });
  if (msg.type === 'cancel') { companionJobs.get(msg.id)?.abort(); return; }
  if (!msg.id || !companionHandlers[msg.type]) return companionSend({ id: msg.id, error: `Unknown request ${msg.type}` });
  const ctrl = new AbortController();
  companionJobs.set(msg.id, ctrl);
  try {
    const data = await companionHandlers[msg.type](msg.args || {}, progress => companionSend({ id: msg.id, progress }), ctrl.signal);
    companionSend({ id: msg.id, data });
  } catch (e) {
    companionSend({ id: msg.id, error: e.name === 'AbortError' ? 'Canceled.' : (e.message || String(e)) });
  } finally {
    companionJobs.delete(msg.id);
  }
}

const companionHandlers = {
  async regions({ placeId, serverIds }) {
    const ids = (serverIds || []).filter(id => /^[0-9a-f-]{36}$/i.test(id)).slice(0, 50);
    const list = await BB.pool(ids, 3, id => serverRegion(placeId, id));
    return Object.fromEntries(ids.map((id, i) => [id, list[i] instanceof Error ? null : list[i]]));
  },

  async presence({ userIds }) {
    const pres = await BB.presence((userIds || []).map(Number).filter(Boolean).slice(0, 500));
    return [...pres.values()];
  },

  async friends() {
    const me = await BB.me();
    const ids = await BB.friendIds(me.id, 1000);
    const [names, pres] = await Promise.all([BB.users(ids), BB.presence(ids)]);
    return ids.map(id => {
      const u = names.get(id) || {};
      const p = pres.get(id);
      return {
        id, name: u.name || '', displayName: u.displayName || '',
        presence: p ? { userPresenceType: p.userPresenceType, lastLocation: p.lastLocation, placeId: p.placeId, rootPlaceId: p.rootPlaceId, gameId: p.gameId, universeId: p.universeId } : null,
      };
    }).sort((a, b) => (b.presence?.userPresenceType === 2) - (a.presence?.userPresenceType === 2) || (a.displayName || a.name).localeCompare(b.displayName || b.name));
  },

  find: (args, progress, signal) => findPlayerBg(args, progress, signal),

  // Companion playtime (minutes per day per universe). Both sides see the same play, so keep the max.
  async playtime({ days, games }) {
    const playtime = await BB.get('playtime', {});
    let changed = 0;
    for (const [day, perGame] of Object.entries(days || {})) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) continue;
      playtime[day] ??= {};
      for (const [u, m] of Object.entries(perGame || {})) {
        const mins = Math.round(Number(m) || 0);
        if (mins > (playtime[day][u] || 0)) { playtime[day][u] = mins; changed++; }
      }
    }
    if (changed) await BB.set('playtime', playtime);
    const known = await BB.get('games', {});
    for (const [u, g] of Object.entries(games || {})) if (!known[u] && g?.name) known[u] = { name: g.name, placeId: g.placeId };
    await BB.set('games', known);
    return { changed };
  },
};

// Player finder for the companion: same method as the game page's finder (presence first, then
// repeated server-list scans matching avatar headshots).
async function findPlayerBg({ placeId, query, mode }, progress, signal) {
  placeId = String(placeId);
  const found = [];
  const label = u => (u.displayName && u.displayName !== u.name ? `${u.displayName} (@${u.name})` : `@${u.name}`);
  const say = (text, pct) => progress({ text, pct, found });
  const display = mode === 'display';
  const universeId = await BB.universeOf(placeId).catch(() => null);

  say(display ? `Looking up everyone named "${query}"…` : 'Looking up user…', 2);
  let users;
  if (display) {
    users = [];
    const lower = String(query).trim().toLowerCase();
    let cur = '';
    for (let i = 0; i < 3; i++) {
      let page;
      try {
        page = await BB.api(`https://users.roblox.com/v1/users/search?keyword=${encodeURIComponent(query)}&limit=100${cur ? `&cursor=${encodeURIComponent(cur)}` : ''}`, { signal, retries: 3 });
      } catch (e) {
        if (e.name === 'AbortError' || !users.length) throw e;
        break;
      }
      for (const u of page.data || []) if ((u.displayName || '').trim().toLowerCase() === lower) users.push({ id: u.id, name: u.name, displayName: u.displayName });
      cur = page.nextPageCursor;
      if (!cur) break;
      await BB.sleep(1500);
    }
    if (!users.length) return { found, text: `No accounts with the display name "${query}".` };
  } else {
    const u = await BB.resolveUser(query);
    if (!u) return { found, text: 'User not found.' };
    users = [u];
  }

  say(`Checking where ${users.length === 1 ? label(users[0]) : `${users.length} accounts`} are…`, 5);
  const pres = await BB.presence(users.map(u => u.id)).catch(() => new Map());
  const shots = await BB.headshots(users.map(u => u.id));
  const scanFor = [];
  let elsewhere = 0;
  for (const u of users) {
    const p = pres.get(u.id);
    if (p?.userPresenceType === 2 && p.gameId && p.placeId) {
      const here = String(p.placeId) === placeId || String(p.rootPlaceId) === placeId;
      if (here || !display) found.push({ title: here ? `${label(u)} is in this game` : `${label(u)} is in ${p.lastLocation || 'another game'}`, sub: `Server ${p.gameId.slice(0, 8)} · via online status`, placeId: p.placeId, gameId: p.gameId, face: shots.get(u.id) || '' });
      else elsewhere++;
      continue;
    }
    if (p?.userPresenceType === 2 && p.universeId && universeId && p.universeId !== universeId) { elsewhere++; continue; }
    scanFor.push(u);
  }
  if (!display && found.length) return { found, text: 'Found.' };

  const byUrl = new Map();
  const dupes = new Set();
  for (const u of scanFor) {
    const url = shots.get(u.id);
    if (!url) continue;
    if (byUrl.has(url)) dupes.add(url); else byUrl.set(url, u);
  }
  for (const url of dupes) byUrl.delete(url);
  if (!byUrl.size) return { found, text: found.length ? `Done. ${found.length} found by online status.` : `Nothing to scan for: ${dupes.size ? 'their avatars are default/identical' : 'no usable avatar picture'}.` };

  const skipped = elsewhere ? ` · ${elsewhere} in other games skipped` : '';
  const seen = new Map();
  const info = new Map();
  for (let pass = 1; pass <= 8; pass++) {
    let cur = '';
    let fresh = 0;
    do {
      if (signal.aborted) throw new DOMException('Canceled', 'AbortError');
      const page = await BB.api(`https://games.roblox.com/v1/games/${placeId}/servers/Public?limit=100${cur ? `&cursor=${encodeURIComponent(cur)}` : ''}`, { signal });
      cur = page.nextPageCursor;
      const reqs = [];
      for (const s of page.data || []) {
        info.set(s.id, s);
        if (!seen.has(s.id)) seen.set(s.id, new Set());
        for (const t of s.playerTokens || []) {
          if (seen.get(s.id).has(t)) continue;
          seen.get(s.id).add(t);
          fresh++;
          reqs.push({ token: t, type: 'AvatarHeadShot', size: '150x150', requestId: `${s.id}:${t}` });
        }
      }
      if (pass === 1 && !fresh && seen.size >= 200) throw new Error('Roblox returned no player info. Are you logged in to roblox.com in this browser?');
      const batches = await Promise.all(BB.chunk(reqs, 100).map(b => BB.api('https://thumbnails.roblox.com/v1/batch', { method: 'POST', body: b, signal })));
      for (const { data } of batches) {
        for (const t of data || []) {
          const u = t.imageUrl && byUrl.get(t.imageUrl);
          if (!u) continue;
          const sid = t.requestId.split(':')[0];
          const s = info.get(sid);
          found.push({ title: `Found ${label(u)}`, sub: `${s.playing}/${s.maxPlayers} players · pass ${pass}`, placeId: Number(placeId), gameId: sid, face: t.imageUrl });
          byUrl.delete(t.imageUrl);
          if (!display || !byUrl.size) return { found, text: display ? `Done: found ${found.length}.` : 'Found.' };
        }
      }
      let total = 0;
      let saw = 0;
      for (const [id, s] of info) { total += s.playing || 0; saw += seen.get(id)?.size || 0; }
      const pct = total ? (saw / total) * 100 : 0;
      say(`Pass ${pass}/8 · ${info.size} servers · saw ${saw} of ${total} players (${pct.toFixed(0)}%) · ${found.length} found${skipped}`, Math.max(8, pct));
    } while (cur);
    if (!fresh) break;
  }
  return { found, text: found.length ? `Done: found ${found.length}. Others may still be here; Roblox hides most players per server.` : 'Not found. Roblox hides most players per server, so they may still be here.' };
}
