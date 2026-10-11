// Game page: replaces Roblox's public server list with Bloxboard's panel:
// live game stats, a filterable server browser (regions, ping, FPS, size, friends),
// recent servers and a player finder.

(() => {
  const placeMatch = location.pathname.match(/\/games\/(\d+)/);
  if (!placeMatch || document.getElementById('bbx-game')) return;
  const PLACE_ID = placeMatch[1];
  const { el, api, num, duration } = BB;
  const ROBLOX_LIST = '[id*="public-running-games"], #rbx-public-game-server-item-container';

  let settings = { ...BB.DEFAULT_SETTINGS };
  let universeId = null;

  // ---------- skeleton ----------

  const stats = el('div', { class: 'bbx-stats' }, el('span', { class: 'bbx-muted', text: 'Loading game stats…' }));
  const robloxToggle = el('button', { class: 'bbx-link', type: 'button' });
  const tabs = {
    servers: el('button', { class: 'bbx-tab', type: 'button', text: 'Servers' }),
    recent: el('button', { class: 'bbx-tab', type: 'button', text: 'Recent' }),
    find: el('button', { class: 'bbx-tab', type: 'button', text: 'Find player' }),
  };
  const views = {
    servers: el('div', { class: 'bbx-view' }),
    recent: el('div', { class: 'bbx-view' }),
    find: el('div', { class: 'bbx-view' }),
  };

  const panel = el('section', { id: 'bbx-game', class: 'bbx-panel' },
    el('header', { class: 'bbx-head' },
      el('span', { class: 'bbx-brand', text: 'Bloxboard' }),
      stats,
      el('div', { class: 'bbx-head-links' },
        robloxToggle,
        el('button', { class: 'bbx-link', type: 'button', text: 'Dashboard ↗', onclick: () => chrome.runtime.sendMessage({ type: 'openDashboard' }) }))),
    el('nav', { class: 'bbx-tabs' }, Object.values(tabs)),
    Object.values(views));

  function showTab(which) {
    for (const [k, t] of Object.entries(tabs)) t.setAttribute('aria-selected', String(k === which));
    for (const [k, v] of Object.entries(views)) v.hidden = k !== which;
    if (which === 'servers' && !servers.length && !loading) loadServers();
    if (which === 'recent') renderRecent();
  }
  for (const [k, t] of Object.entries(tabs)) t.onclick = () => showTab(k);

  function applyReplace() {
    document.documentElement.classList.toggle('bbx-replace-servers', settings.replaceServerList);
    robloxToggle.textContent = settings.replaceServerList ? 'Show Roblox list' : 'Hide Roblox list';
  }
  robloxToggle.onclick = async () => {
    settings.replaceServerList = !settings.replaceServerList;
    await BB.set('settings', { ...(await BB.get('settings', {})), replaceServerList: settings.replaceServerList });
    applyReplace();
  };

  // ---------- stats (likes refresh every 30 s, like a live counter) ----------

  const chip = (label, value, title) => el('span', { class: 'bbx-chip', title }, el('b', { text: value }), ` ${label}`);

  async function loadStats() {
    try {
      universeId ??= await BB.universeOf(PLACE_ID);
      const [{ data: [game] }, { data: [votes] }, fav, playtime] = await Promise.all([
        api(`https://games.roblox.com/v1/games?universeIds=${universeId}`),
        api(`https://games.roblox.com/v1/games/votes?universeIds=${universeId}`),
        api(`https://games.roblox.com/v1/games/${universeId}/favorites/count`).catch(() => null),
        BB.get('playtime', {}),
      ]);
      let mine = 0;
      let week = 0;
      const weekKeys = new Set(Array.from({ length: 7 }, (_, i) => { const d = new Date(); d.setDate(d.getDate() - i); return BB.dayKey(d); }));
      for (const [day, games] of Object.entries(playtime)) {
        mine += games[universeId] || 0;
        if (weekKeys.has(day)) week += games[universeId] || 0;
      }
      const total = votes.upVotes + votes.downVotes;
      const ratio = total ? (votes.upVotes / total) * 100 : null;
      const updated = new Date(game.updated);
      stats.replaceChildren(...[
        chip('liked', ratio == null ? '–' : `${ratio.toFixed(1)}%`, `${votes.upVotes.toLocaleString()} likes · ${votes.downVotes.toLocaleString()} dislikes (live)`),
        chip('👍', num(votes.upVotes)),
        chip('👎', num(votes.downVotes)),
        chip('playing', num(game.playing)),
        chip('visits', num(game.visits)),
        fav && chip('favs', num(fav.favoritesCount)),
        chip('updated', BB.ago(updated), updated.toLocaleString()),
        mine ? chip('played', duration(mine), `${duration(week)} this week`) : null,
      ].filter(Boolean));
    } catch (e) {
      stats.replaceChildren(el('span', { class: 'bbx-muted', text: `Stats unavailable (${e.message})` }));
    }
  }

  // ---------- server browser ----------

  let servers = [];
  let cursor = null;
  let loading = false;
  let loadAllAbort = null;
  const regions = new Map(); // gameId -> {city, cc} | null
  const friendsIn = new Map(); // gameId -> [{name, shot}]
  let recentIds = new Set();
  let filters = {
    sort: 'most', region: '', min: '', max: '', room: '0', ping: '0', fps: '0', hideFull: false, friendsOnly: false,
  };

  const select = (key, label, options) => {
    const s = el('select', { class: 'bbx-input', 'aria-label': label, 'data-key': key },
      options.map(([v, t]) => el('option', { value: v, text: t })));
    s.onchange = () => { filters[key] = s.value; saveFilters(); renderServers(); };
    return s;
  };
  const numberBox = (key, placeholder) => {
    const i = el('input', { class: 'bbx-input bbx-num-input', type: 'number', min: '0', max: '700', placeholder, 'aria-label': `${placeholder} players`, 'data-key': key });
    i.oninput = () => { filters[key] = i.value; saveFilters(); renderServers(); };
    return i;
  };
  const check = (key, label) => {
    const c = el('input', { type: 'checkbox', 'data-key': key });
    c.onchange = () => { filters[key] = c.checked; saveFilters(); renderServers(); };
    return el('label', { class: 'bbx-check' }, c, label);
  };

  const sortSel = select('sort', 'Sort servers', [
    ['most', 'Most players'], ['least', 'Fewest players'], ['ping', 'Best ping'], ['fps', 'Best FPS'], ['room', 'Most free slots'], ['friends', 'Friends first'],
  ]);
  const regionSel = el('select', { class: 'bbx-input', 'aria-label': 'Region' });
  regionSel.onchange = async () => {
    filters.region = regionSel.value;
    saveFilters();
    // The region filter doubles as your preferred region across all games.
    await BB.set('settings', { ...(await BB.get('settings', {})), preferredRegion: regionSel.value });
    renderServers();
    if (regionSel.value) detectRegions(true);
  };
  const minBox = numberBox('min', 'Min');
  const maxBox = numberBox('max', 'Max');
  const roomSel = select('room', 'Free slots', [['0', 'Any room'], ['1', 'Room for 1+'], ['2', 'Room for 2+'], ['3', 'Room for 3+'], ['4', 'Room for 4+'], ['6', 'Room for 6+']]);
  const pingSel = select('ping', 'Max ping', [['0', 'Any ping'], ['60', 'Ping ≤ 60'], ['100', 'Ping ≤ 100'], ['150', 'Ping ≤ 150'], ['250', 'Ping ≤ 250']]);
  const fpsSel = select('fps', 'Min FPS', [['0', 'Any FPS'], ['30', 'FPS ≥ 30'], ['45', 'FPS ≥ 45'], ['55', 'FPS ≥ 55']]);
  const hideFullBox = check('hideFull', 'Hide full');
  const friendsBox = check('friendsOnly', 'Friends only');

  const regionBtn = el('button', { class: 'bbx-btn bbx-ghost', type: 'button', text: 'Detect regions', onclick: () => detectRegions(false) });
  const loadAllBtn = el('button', { class: 'bbx-btn bbx-ghost', type: 'button', text: 'Load all' });
  const randomBtn = el('button', { class: 'bbx-btn bbx-ghost', type: 'button', text: 'Random server' });
  const bestBtn = el('a', { class: 'bbx-btn', text: 'Join best' });
  const countText = el('span', { class: 'bbx-muted bbx-small' });
  const list = el('div', { class: 'bbx-list' });
  const moreBtn = el('button', { class: 'bbx-btn bbx-ghost bbx-more', type: 'button', text: 'Load more servers', hidden: true, onclick: () => loadServers() });
  const serverStatus = el('p', { class: 'bbx-muted bbx-small' });

  views.servers.append(
    el('div', { class: 'bbx-filters' },
      el('div', { class: 'bbx-field' }, el('span', { text: 'Sort' }), sortSel),
      el('div', { class: 'bbx-field' }, el('span', { text: 'Region' }), regionSel),
      el('div', { class: 'bbx-field' }, el('span', { text: 'Players' }), el('div', { class: 'bbx-range' }, minBox, el('span', { class: 'bbx-muted', text: '–' }), maxBox)),
      el('div', { class: 'bbx-field' }, el('span', { text: 'Free slots' }), roomSel),
      el('div', { class: 'bbx-field' }, el('span', { text: 'Ping' }), pingSel),
      el('div', { class: 'bbx-field' }, el('span', { text: 'FPS' }), fpsSel),
      el('div', { class: 'bbx-field bbx-checks' }, hideFullBox, friendsBox)),
    el('div', { class: 'bbx-toolbar' }, countText, el('span', { class: 'bbx-grow' }), regionBtn, loadAllBtn, randomBtn, bestBtn),
    list, moreBtn, serverStatus);

  async function saveFilters() {
    const { region, ...rest } = filters;
    await BB.set('serverFilters', rest);
  }

  async function restoreFilters() {
    filters = { ...filters, ...(await BB.get('serverFilters', {})), region: settings.preferredRegion || '' };
    for (const node of views.servers.querySelectorAll('[data-key]')) {
      const v = filters[node.dataset.key];
      if (node.type === 'checkbox') node.checked = !!v;
      else node.value = v ?? '';
    }
  }

  async function loadServers() {
    if (loading) return;
    loading = true;
    moreBtn.disabled = true;
    serverStatus.textContent = 'Loading servers…';
    try {
      const page = await api(`https://games.roblox.com/v1/games/${PLACE_ID}/servers/Public?limit=100&sortOrder=Desc&excludeFullGames=false${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`);
      const seen = new Set(servers.map(s => s.id));
      servers.push(...(page.data || []).filter(s => !seen.has(s.id)));
      cursor = page.nextPageCursor;
      moreBtn.hidden = !cursor;
      loadAllBtn.disabled = !cursor;
      serverStatus.textContent = `${servers.length} servers loaded${cursor ? '' : ' (that\'s all of them)'}.`;
      renderServers();
      if (filters.region) detectRegions(true);
    } catch (e) {
      serverStatus.textContent = `Couldn't load servers: ${e.message}`;
    } finally {
      loading = false;
      moreBtn.disabled = false;
    }
  }

  loadAllBtn.onclick = async () => {
    if (loadAllAbort) {
      loadAllAbort.abort();
      return;
    }
    loadAllAbort = new AbortController();
    loadAllBtn.textContent = 'Stop';
    while (cursor && !loadAllAbort.signal.aborted && servers.length < 3000) {
      await loadServers();
      await BB.sleep(350);
    }
    loadAllAbort = null;
    loadAllBtn.textContent = 'Load all';
  };

  const regionLabel = r => (r ? (r.cc ? `${r.city}, ${r.cc}` : r.city) : null);
  const freeSlots = s => s.maxPlayers - s.playing;

  function visibleServers() {
    const min = parseInt(filters.min, 10);
    const max = parseInt(filters.max, 10);
    const room = Number(filters.room);
    const ping = Number(filters.ping);
    const fps = Number(filters.fps);
    let out = servers.filter((s) => {
      if (filters.hideFull && freeSlots(s) <= 0) return false;
      if (!Number.isNaN(min) && s.playing < min) return false;
      if (!Number.isNaN(max) && s.playing > max) return false;
      if (room && freeSlots(s) < room) return false;
      if (ping && (s.ping == null || s.ping > ping)) return false;
      if (fps && (s.fps == null || s.fps < fps)) return false;
      if (filters.friendsOnly && !friendsIn.has(s.id)) return false;
      if (filters.region && regionLabel(regions.get(s.id)) !== filters.region) return false;
      return true;
    });
    const by = {
      most: (a, b) => b.playing - a.playing,
      least: (a, b) => a.playing - b.playing,
      ping: (a, b) => (a.ping ?? 9999) - (b.ping ?? 9999),
      fps: (a, b) => (b.fps ?? 0) - (a.fps ?? 0),
      room: (a, b) => freeSlots(b) - freeSlots(a),
      friends: (a, b) => (friendsIn.get(b.id)?.length || 0) - (friendsIn.get(a.id)?.length || 0) || b.playing - a.playing,
    }[filters.sort] || ((a, b) => b.playing - a.playing);
    return out.sort(by);
  }

  function renderRegionOptions() {
    const labels = new Set([...regions.values()].map(regionLabel).filter(Boolean));
    if (filters.region) labels.add(filters.region);
    const sorted = [...labels].sort();
    regionSel.replaceChildren(el('option', { value: '', text: 'All regions' }), ...sorted.map(l => el('option', { value: l, text: l })));
    regionSel.value = filters.region || '';
  }

  function renderServers() {
    renderRegionOptions();
    const rows = visibleServers();
    const best = rows.find(s => freeSlots(s) > 0);
    bestBtn.href = best ? BB.joinUrl(PLACE_ID, best.id) : '#';
    bestBtn.classList.toggle('bbx-disabled', !best);
    bestBtn.title = best ? 'First server that matches your filters and has room' : '';
    randomBtn.disabled = !rows.some(s => freeSlots(s) > 0);
    countText.textContent = servers.length ? `Showing ${Math.min(rows.length, 200)} of ${servers.length} loaded servers` : '';

    if (!rows.length) {
      const reason = !servers.length ? 'No servers loaded yet.'
        : filters.region && ![...regions.values()].some(Boolean) ? 'Detecting regions…'
          : 'No servers match these filters. Load more servers or loosen a filter.';
      list.replaceChildren(el('p', { class: 'bbx-empty', text: reason }));
      return;
    }

    list.replaceChildren(...rows.slice(0, 200).map((s) => {
      const r = regions.get(s.id);
      const friends = friendsIn.get(s.id) || [];
      const pct = Math.min(100, Math.round((s.playing / s.maxPlayers) * 100));
      const copyBtn = el('button', { class: 'bbx-btn bbx-ghost bbx-sm', type: 'button', title: 'Copy an invite link to this server', text: 'Link' });
      copyBtn.onclick = async () => {
        try {
          await navigator.clipboard.writeText(BB.inviteUrl(PLACE_ID, s.id));
          copyBtn.textContent = 'Copied';
        } catch {
          copyBtn.textContent = 'Failed';
        }
        setTimeout(() => { copyBtn.textContent = 'Link'; }, 1500);
      };
      return el('div', { class: `bbx-row${friends.length ? ' bbx-row-friends' : ''}` },
        el('div', { class: 'bbx-fill' },
          el('div', { class: 'bbx-fill-top' },
            el('b', { text: `${s.playing}/${s.maxPlayers}` }),
            friends.length ? el('span', { class: 'bbx-faces bbx-faces-sm', title: friends.map(f => f.name).join(', ') }, friends.slice(0, 3).map(f => el('img', { src: f.shot || undefined, alt: '' })), el('span', { class: 'bbx-small', text: ` ${friends.length === 1 ? friends[0].name : `${friends.length} friends`}` })) : null,
            recentIds.has(s.id) ? el('span', { class: 'bbx-tag', text: 'Been here' }) : null),
          el('div', { class: 'bbx-meter' }, el('i', { style: { width: `${pct}%` } }))),
        el('span', { class: 'bbx-num', title: 'Average ping of players in this server' }, s.ping != null ? `${s.ping} ms` : '–'),
        el('span', { class: 'bbx-num bbx-hide-sm', title: 'Server frame rate' }, s.fps != null ? `${Math.round(s.fps)} fps` : '–'),
        el('span', { class: `bbx-region${r ? '' : ' bbx-muted'}` }, regions.has(s.id) ? (regionLabel(r) || 'Unknown') : '—'),
        el('span', { class: 'bbx-row-actions' }, copyBtn, el('a', { class: 'bbx-btn bbx-sm', href: BB.joinUrl(PLACE_ID, s.id), text: 'Join' })));
    }));
  }

  randomBtn.onclick = () => {
    const pool = visibleServers().filter(s => freeSlots(s) > 0);
    if (!pool.length) return;
    const pick = pool[Math.floor(Math.random() * pool.length)];
    location.href = BB.joinUrl(PLACE_ID, pick.id);
  };

  let detecting = false;
  async function detectRegions(auto) {
    if (detecting) return;
    const pool = auto ? servers : visibleServers();
    const todo = pool.filter(s => !regions.has(s.id) && freeSlots(s) > 0).slice(0, auto ? 30 : 40);
    if (!todo.length) {
      if (!auto) serverStatus.textContent = 'Regions are already known for these servers.';
      return;
    }
    detecting = true;
    regionBtn.disabled = true;
    serverStatus.textContent = `Detecting regions for ${todo.length} servers…`;
    try {
      for (const part of BB.chunk(todo.map(s => s.id), 10)) {
        const res = await chrome.runtime.sendMessage({ type: 'regions', placeId: PLACE_ID, gameIds: part });
        if (res?.error) throw new Error(res.error);
        for (const id of part) regions.set(id, res?.[id]?.city ? res[id] : null);
        renderServers();
      }
      const found = todo.filter(s => regions.get(s.id)).length;
      serverStatus.textContent = found ? `Detected ${found} of ${todo.length} regions.` : 'Roblox didn\'t share server addresses for these servers.';
    } catch (e) {
      serverStatus.textContent = `Region lookup failed: ${e.message}`;
    } finally {
      detecting = false;
      regionBtn.disabled = false;
    }
  }

  async function loadFriendsInServers() {
    try {
      const me = await BB.me();
      const ids = await BB.friendIds(me.id);
      const pres = await BB.presence(ids);
      const here = [...pres.values()].filter(p => p.userPresenceType === 2 && p.gameId && (String(p.placeId) === PLACE_ID || String(p.rootPlaceId) === PLACE_ID));
      if (!here.length) return;
      const [users, shots] = await Promise.all([BB.users(here.map(p => p.userId)), BB.headshots(here.map(p => p.userId))]);
      for (const p of here) {
        const list = friendsIn.get(p.gameId) || [];
        list.push({ name: users.get(p.userId)?.displayName || 'Friend', shot: shots.get(p.userId) });
        friendsIn.set(p.gameId, list);
      }
      renderServers();
    } catch {
      // not logged in or friends hidden; nothing to show
    }
  }

  // ---------- recent servers ----------

  async function renderRecent() {
    const all = await BB.get('recentServers', []);
    const mine = all.filter(r => String(r.placeId) === PLACE_ID || String(r.rootPlaceId) === PLACE_ID || (universeId && r.universeId === universeId));
    recentIds = new Set(mine.map(r => r.gameId));
    const alive = new Set(servers.map(s => s.id));
    if (!mine.length) {
      views.recent.replaceChildren(el('p', { class: 'bbx-empty', text: 'Servers you play in show up here, so you can hop back in.' }));
      return;
    }
    views.recent.replaceChildren(el('div', { class: 'bbx-list' }, mine.slice(0, 20).map(r => el('div', { class: 'bbx-row bbx-row-recent' },
      el('div', {}, el('b', { text: `Server ${r.gameId.slice(0, 8)}` }), el('div', { class: 'bbx-muted bbx-small', text: `Left ${BB.ago(r.lastSeen)} · played ${duration(r.minutes)}` })),
      el('span', { class: `bbx-tag${alive.has(r.gameId) ? ' bbx-tag-good' : ''}`, text: alive.has(r.gameId) ? 'Still running' : servers.length && !cursor ? 'Closed' : 'Unknown' }),
      el('a', { class: 'bbx-btn bbx-sm', href: BB.joinUrl(r.placeId || PLACE_ID, r.gameId), text: 'Rejoin' })))));
  }

  // ---------- player finder ----------

  const findInput = el('input', { class: 'bbx-input bbx-grow', placeholder: 'Username or user ID', spellcheck: 'false', autocomplete: 'off' });
  const findBtn = el('button', { class: 'bbx-btn', type: 'submit', text: 'Search' });
  const findAvatar = el('img', { class: 'bbx-avatar', alt: '' });
  const findBar = el('i');
  const findStatus = el('p', { class: 'bbx-muted bbx-small' }, 'Finds friends instantly. For others, Roblox only reveals ~5 random players per server, so the scan repeats a few passes.');
  const findResult = el('div');
  let finder = null;

  views.find.append(
    el('form', { class: 'bbx-toolbar', onsubmit: (e) => { e.preventDefault(); finder ? finder.abort() : runFinder(findInput.value); } },
      findAvatar, findInput, findBtn),
    el('div', { class: 'bbx-meter bbx-meter-lg' }, findBar),
    findStatus, findResult);

  const say = (text, kind = '') => {
    findStatus.textContent = text;
    findStatus.dataset.kind = kind;
  };

  function foundCard(title, sub, placeId, gameId, faces) {
    findResult.replaceChildren(el('div', { class: 'bbx-found' },
      el('div', { class: 'bbx-faces' }, faces.slice(0, 5).map(src => el('img', { src, alt: '' }))),
      el('div', { class: 'bbx-grow' }, el('b', { text: title }), el('div', { class: 'bbx-muted bbx-small', text: sub })),
      el('a', { class: 'bbx-btn', href: BB.joinUrl(placeId, gameId), text: 'Join' })));
  }

  async function runFinder(query) {
    if (!query.trim()) return;
    finder = new AbortController();
    const signal = finder.signal;
    findBtn.textContent = 'Cancel';
    findInput.disabled = true;
    findResult.replaceChildren();
    findBar.style.width = '0%';

    try {
      say('Looking up user…');
      const user = await BB.resolveUser(query);
      if (!user) return say('User not found.', 'bad');
      const label = user.displayName !== user.name ? `${user.displayName} (@${user.name})` : `@${user.name}`;
      const shot = (await api(`https://thumbnails.roblox.com/v1/users/avatar-headshot?userIds=${user.id}&size=150x150&format=Png&isCircular=false`)).data?.[0];
      if (shot?.imageUrl) findAvatar.src = shot.imageUrl;

      say(`Checking where ${label} is…`);
      const p = (await BB.presence([user.id]).catch(() => new Map())).get(user.id);
      if (p?.userPresenceType === 2 && p.gameId && p.placeId) {
        const here = String(p.placeId) === PLACE_ID || String(p.rootPlaceId) === PLACE_ID;
        foundCard(here ? `${label} is in this game` : `${label} is in ${p.lastLocation || 'another game'}`, `Server ${p.gameId.slice(0, 8)}… · via online status`, p.placeId, p.gameId, shot?.imageUrl ? [shot.imageUrl] : []);
        findBar.style.width = '100%';
        return say('Found.', 'good');
      }
      if (shot?.state !== 'Completed') return say(`Can't scan: ${label}'s avatar picture isn't available.`, 'bad');

      const seen = new Map();
      const info = new Map();
      for (let pass = 1; pass <= 8; pass++) {
        let cur = '';
        let fresh = 0;
        do {
          if (signal.aborted) throw new DOMException('Canceled', 'AbortError');
          const page = await api(`https://games.roblox.com/v1/games/${PLACE_ID}/servers/Public?limit=100${cur ? `&cursor=${encodeURIComponent(cur)}` : ''}`, { signal });
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
          if (pass === 1 && !fresh && seen.size >= 200) throw new Error('Roblox returned no player info. Are you logged in?');
          const batches = await Promise.all(BB.chunk(reqs, 100).map(b => api('https://thumbnails.roblox.com/v1/batch', { method: 'POST', body: b, signal })));
          for (const { data } of batches) {
            for (const t of data || []) {
              if (t.imageUrl && t.imageUrl === shot.imageUrl) {
                const sid = t.requestId.split(':')[0];
                const s = info.get(sid);
                foundCard(`Found ${label}`, `${s.playing}/${s.maxPlayers} players · pass ${pass}`, PLACE_ID, sid, [shot.imageUrl]);
                findBar.style.width = '100%';
                return say('Found.', 'good');
              }
            }
          }
          let total = 0;
          let saw = 0;
          for (const [id, s] of info) {
            total += s.playing || 0;
            saw += seen.get(id)?.size || 0;
          }
          const pct = total ? (saw / total) * 100 : 0;
          findBar.style.width = `${pct}%`;
          say(`Pass ${pass}/8 · ${info.size} servers · saw ${saw} of ${total} players (${pct.toFixed(0)}%)`);
        } while (cur);
        if (!fresh) break;
      }
      say('Not found. Roblox hides most players per server, so they may still be here.', 'bad');
    } catch (e) {
      say(e.name === 'AbortError' ? 'Canceled.' : e.message, e.name === 'AbortError' ? '' : 'bad');
    } finally {
      finder = null;
      findBtn.textContent = 'Search';
      findInput.disabled = false;
    }
  }

  // ---------- mount ----------

  // Sit where Roblox's public server list is (and hide it), or at the top of the Servers tab.
  function mount() {
    const robloxList = document.querySelector(ROBLOX_LIST);
    const anchor = robloxList?.closest('[id*="public-running-games"]') || robloxList;
    const host = document.querySelector('#game-instances') || document.querySelector('#rbx-running-games');
    if (anchor?.parentElement) {
      if (panel.nextElementSibling !== anchor) anchor.before(panel);
    } else if (host) {
      if (!panel.isConnected) host.prepend(panel);
    } else {
      return false;
    }
    panel.classList.toggle('bbx-dark', BBX_isDark());
    return true;
  }

  async function start() {
    settings = await BB.settings();
    applyReplace();
    await restoreFilters();
    renderRecent();
    loadStats();
    setInterval(() => { if (!document.hidden) loadStats(); }, 30000);
    showTab('servers');
    loadFriendsInServers();
  }

  let started = false;
  const tryMount = () => {
    if (!mount()) return false;
    if (!started) {
      started = true;
      start();
    }
    return true;
  };
  if (!tryMount()) {
    const obs = new MutationObserver(() => { if (tryMount()) obs.disconnect(); });
    obs.observe(document.body, { childList: true, subtree: true });
    setTimeout(() => obs.disconnect(), 60000);
  }
  // Roblox renders its server list late and re-renders it; keep the panel next to it.
  setInterval(() => { if (started) mount(); }, 1500);
})();
