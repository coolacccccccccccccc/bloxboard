// Game page: one compact panel at the top of the Servers tab with game stats,
// a server browser (regions, filters, quick join) and a player finder.

(() => {
  const placeMatch = location.pathname.match(/\/games\/(\d+)/);
  if (!placeMatch || document.getElementById('bbx-game')) return;
  const PLACE_ID = placeMatch[1];
  const { el, api, num, duration } = BB;

  // ---------- skeleton ----------

  const stats = el('div', { class: 'bbx-stats' }, el('span', { class: 'bbx-muted', text: 'Loading game stats…' }));
  const tabServers = el('button', { class: 'bbx-tab', 'aria-selected': 'true', type: 'button', text: 'Servers' });
  const tabFind = el('button', { class: 'bbx-tab', 'aria-selected': 'false', type: 'button', text: 'Find player' });
  const viewServers = el('div', { class: 'bbx-view' });
  const viewFind = el('div', { class: 'bbx-view', hidden: true });

  const panel = el('section', { id: 'bbx-game', class: 'bbx-panel' },
    el('header', { class: 'bbx-head' },
      el('span', { class: 'bbx-brand', text: 'Bloxboard' }),
      stats,
      el('button', { class: 'bbx-link', type: 'button', text: 'Dashboard ↗', onclick: () => chrome.runtime.sendMessage({ type: 'openDashboard' }) })),
    el('nav', { class: 'bbx-tabs' }, tabServers, tabFind),
    viewServers,
    viewFind);

  function showTab(which) {
    tabServers.setAttribute('aria-selected', String(which === 'servers'));
    tabFind.setAttribute('aria-selected', String(which === 'find'));
    viewServers.hidden = which !== 'servers';
    viewFind.hidden = which !== 'find';
    if (which === 'servers' && !servers.length && !loadingServers) loadServers();
  }
  tabServers.onclick = () => showTab('servers');
  tabFind.onclick = () => showTab('find');

  // ---------- stats ----------

  async function loadStats() {
    try {
      const universeId = await BB.universeOf(PLACE_ID);
      const [{ data: [game] }, { data: [votes] }, fav, playtime] = await Promise.all([
        api(`https://games.roblox.com/v1/games?universeIds=${universeId}`),
        api(`https://games.roblox.com/v1/games/votes?universeIds=${universeId}`),
        api(`https://games.roblox.com/v1/games/${universeId}/favorites/count`).catch(() => null),
        BB.get('playtime', {}),
      ]);

      let mine = 0;
      for (const day of Object.values(playtime)) mine += day[universeId] || 0;
      const total = votes.upVotes + votes.downVotes;
      const ratio = total ? Math.round((votes.upVotes / total) * 100) : null;
      const updated = new Date(game.updated);
      const days = Math.floor((Date.now() - updated) / 86400000);

      const chip = (label, value, title) => el('span', { class: 'bbx-chip', title }, el('b', { text: value }), ` ${label}`);
      stats.replaceChildren(...[
        chip('liked', ratio == null ? '–' : `${ratio}%`, `${votes.upVotes.toLocaleString()} up · ${votes.downVotes.toLocaleString()} down`),
        chip('playing', num(game.playing)),
        chip('visits', num(game.visits)),
        fav && chip('favs', num(fav.favoritesCount)),
        chip('updated', days <= 0 ? 'today' : `${days}d ago`, updated.toLocaleString()),
        mine ? chip('played by you', duration(mine)) : null,
      ].filter(Boolean));
    } catch (e) {
      stats.replaceChildren(el('span', { class: 'bbx-muted', text: `Stats unavailable (${e.message})` }));
    }
  }

  // ---------- server browser ----------

  let servers = [];
  let cursor = null;
  let loadingServers = false;
  const regions = new Map(); // gameId -> {city, cc} | null

  const sortSel = el('select', { class: 'bbx-input', 'aria-label': 'Sort servers' },
    el('option', { value: 'most', text: 'Most players' }),
    el('option', { value: 'least', text: 'Fewest players' }),
    el('option', { value: 'ping', text: 'Best ping' }));
  const regionSel = el('select', { class: 'bbx-input', 'aria-label': 'Filter by region' }, el('option', { value: '', text: 'All regions' }));
  const hideFull = el('input', { type: 'checkbox' });
  const regionBtn = el('button', { class: 'bbx-btn bbx-ghost', type: 'button', text: 'Detect regions' });
  const smallestBtn = el('a', { class: 'bbx-btn', text: 'Join smallest' });
  const list = el('div', { class: 'bbx-list' });
  const moreBtn = el('button', { class: 'bbx-btn bbx-ghost bbx-more', type: 'button', text: 'Load more servers', hidden: true });
  const serverStatus = el('p', { class: 'bbx-muted bbx-small' });

  viewServers.append(
    el('div', { class: 'bbx-toolbar' },
      sortSel, regionSel,
      el('label', { class: 'bbx-check' }, hideFull, 'Hide full'),
      el('span', { class: 'bbx-grow' }),
      regionBtn, smallestBtn),
    list, moreBtn, serverStatus);

  sortSel.onchange = regionSel.onchange = hideFull.onchange = renderServers;
  moreBtn.onclick = () => loadServers();
  regionBtn.onclick = detectRegions;

  async function loadServers() {
    loadingServers = true;
    moreBtn.disabled = true;
    serverStatus.textContent = 'Loading servers…';
    try {
      const page = await api(`https://games.roblox.com/v1/games/${PLACE_ID}/servers/Public?limit=100&sortOrder=Desc&excludeFullGames=false${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`);
      const seen = new Set(servers.map(s => s.id));
      servers.push(...(page.data || []).filter(s => !seen.has(s.id)));
      cursor = page.nextPageCursor;
      moreBtn.hidden = !cursor;
      serverStatus.textContent = `${servers.length} servers loaded${cursor ? '' : ' (all of them)'}.`;
      renderServers();
    } catch (e) {
      serverStatus.textContent = `Couldn't load servers: ${e.message}`;
    } finally {
      loadingServers = false;
      moreBtn.disabled = false;
    }
  }

  function regionLabel(r) {
    if (!r) return null;
    return r.cc ? `${r.city}, ${r.cc}` : r.city;
  }

  function visibleServers() {
    let out = servers.slice();
    if (hideFull.checked) out = out.filter(s => s.playing < s.maxPlayers);
    if (regionSel.value) out = out.filter(s => regionLabel(regions.get(s.id)) === regionSel.value);
    const by = {
      most: (a, b) => b.playing - a.playing,
      least: (a, b) => a.playing - b.playing,
      ping: (a, b) => (a.ping ?? 9999) - (b.ping ?? 9999),
    }[sortSel.value];
    return out.sort(by);
  }

  function renderServers() {
    // Region dropdown
    const labels = [...new Set([...regions.values()].map(regionLabel).filter(Boolean))].sort();
    const current = regionSel.value;
    regionSel.replaceChildren(el('option', { value: '', text: 'All regions' }), ...labels.map(l => el('option', { value: l, text: l })));
    regionSel.value = labels.includes(current) ? current : '';

    const rows = visibleServers();
    const smallest = rows.filter(s => s.playing > 0).sort((a, b) => a.playing - b.playing)[0];
    smallestBtn.href = smallest ? BB.joinUrl(PLACE_ID, smallest.id) : '#';
    smallestBtn.classList.toggle('bbx-disabled', !smallest);

    if (!rows.length) {
      list.replaceChildren(el('p', { class: 'bbx-empty', text: !servers.length ? 'No servers yet.' : hideFull.checked && !regionSel.value ? 'Every loaded server is full. Load more servers or untick "Hide full".' : 'No servers match these filters.' }));
      return;
    }

    list.replaceChildren(...rows.slice(0, 200).map((s) => {
      const r = regions.get(s.id);
      const pct = Math.round((s.playing / s.maxPlayers) * 100);
      return el('div', { class: 'bbx-row' },
        el('div', { class: 'bbx-fill' },
          el('div', { class: 'bbx-fill-top' }, el('b', { text: `${s.playing}/${s.maxPlayers}` }), el('span', { class: 'bbx-muted', text: ' players' })),
          el('div', { class: 'bbx-meter' }, el('i', { style: { width: `${pct}%` } }))),
        el('span', { class: 'bbx-num', title: 'Ping from the server to its players' }, s.ping != null ? `${s.ping} ms` : '–'),
        el('span', { class: 'bbx-num bbx-hide-sm', title: 'Server frame rate' }, s.fps != null ? `${Math.round(s.fps)} fps` : '–'),
        el('span', { class: `bbx-region${r ? '' : ' bbx-muted'}` }, regions.has(s.id) ? (regionLabel(r) || 'Unknown') : '—'),
        el('a', { class: 'bbx-btn bbx-sm', href: BB.joinUrl(PLACE_ID, s.id), text: 'Join' }));
    }));
  }

  async function detectRegions() {
    const todo = visibleServers().filter(s => !regions.has(s.id)).slice(0, 40);
    if (!todo.length) {
      serverStatus.textContent = 'Regions already detected for the servers shown.';
      return;
    }
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
      serverStatus.textContent = found
        ? `Detected ${found} of ${todo.length} regions. Click again for more.`
        : 'Roblox didn\'t share server addresses. Full servers and some games hide them.';
    } catch (e) {
      serverStatus.textContent = `Region lookup failed: ${e.message}`;
    } finally {
      regionBtn.disabled = false;
    }
  }

  // ---------- player finder ----------

  const findInput = el('input', { class: 'bbx-input bbx-grow', placeholder: 'Username or user ID', spellcheck: 'false', autocomplete: 'off' });
  const findBtn = el('button', { class: 'bbx-btn', type: 'submit', text: 'Search' });
  const findAvatar = el('img', { class: 'bbx-avatar', alt: '' });
  const findBar = el('i');
  const findStatus = el('p', { class: 'bbx-muted bbx-small' }, 'Finds friends instantly. For others, Roblox only reveals ~5 random players per server, so the scan repeats a few passes.');
  const findResult = el('div');
  let finder = null;

  viewFind.append(
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

  function mount() {
    const host = document.querySelector('#game-instances') || document.querySelector('#rbx-running-games');
    if (!host) return false;
    panel.classList.toggle('bbx-dark', BBX_isDark());
    host.prepend(panel);
    return true;
  }

  function start() {
    loadStats();
    // Load servers only once the Servers tab is opened, to spare Roblox's rate limits.
    const tabLink = document.querySelector('#tab-game-instances');
    const host = document.querySelector('#game-instances');
    const visible = () => host && host.offsetParent !== null;
    if (visible()) loadServers();
    else {
      tabLink?.addEventListener('click', () => { if (!servers.length && !loadingServers) loadServers(); }, { once: true });
      const iv = setInterval(() => {
        if (visible()) {
          clearInterval(iv);
          if (!servers.length && !loadingServers) loadServers();
        }
      }, 1500);
    }
  }

  if (mount()) start();
  else {
    const obs = new MutationObserver(() => {
      if (mount()) {
        obs.disconnect();
        start();
      }
    });
    obs.observe(document.body, { childList: true, subtree: true });
    setTimeout(() => obs.disconnect(), 60000);
  }
  setInterval(() => { if (!panel.isConnected) mount(); }, 2000);
})();
