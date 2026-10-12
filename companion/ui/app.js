// Bloxboard Companion panel. Talks only to the companion on 127.0.0.1 (which talks to Roblox's
// public APIs, and to the Bloxboard extension for anything that needs a login).
'use strict';

const TOKEN = (location.hash.match(/t=([0-9a-f]+)/) || [])[1] || sessionStorage.getItem('bbx-token') || '';
if (TOKEN) try { sessionStorage.setItem('bbx-token', TOKEN); } catch {}

// ---------- helpers ----------

function el(tag, attrs = {}, ...children) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') n.className = v;
    else if (k === 'text') n.textContent = v;
    else if (k === 'html') n.innerHTML = v;
    else if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
    else if (k === 'style' && typeof v === 'object') Object.assign(n.style, v);
    else n.setAttribute(k, v === true ? '' : v);
  }
  n.append(...children.flat(Infinity).filter(c => c != null && c !== false).map(c => (typeof c === 'string' || typeof c === 'number') ? document.createTextNode(String(c)) : c));
  return n;
}

const SVG = {
  copy: '<svg viewBox="0 0 24 24"><rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v1"/></svg>',
  hop: '<svg viewBox="0 0 24 24"><path d="M16 3h5v5M4 20 21 3M21 16v5h-5M15 15l6 6M4 4l5 5"/></svg>',
  rejoin: '<svg viewBox="0 0 24 24"><path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/></svg>',
  star: '<svg viewBox="0 0 24 24"><path d="m12 3 2.8 5.7 6.2.9-4.5 4.4 1 6.2L12 17.3 6.5 20.2l1-6.2L3 9.6l6.2-.9z"/></svg>',
  web: '<svg viewBox="0 0 24 24"><path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/></svg>',
  play: '<svg viewBox="0 0 24 24"><path d="M7 4v16l13-8z"/></svg>',
  refresh: '<svg viewBox="0 0 24 24"><path d="M21 12a9 9 0 1 1-3-6.7L21 8"/><path d="M21 3v5h-5"/></svg>',
};
const icon = (name, label) => el('span', { html: SVG[name], style: { display: 'contents' }, 'aria-label': label });

const fmtNum = n => n == null ? '–' : n >= 1e9 ? `${(n / 1e9).toFixed(1)}B` : n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e4 ? `${Math.round(n / 1e3)}K` : n.toLocaleString('en-US');
function fmtMin(m) {
  m = Math.round(m || 0);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  return h >= 100 ? `${h}h` : `${h}h ${String(m % 60).padStart(2, '0')}m`;
}
function fmtSince(date) {
  const s = Math.max(0, (Date.now() - new Date(date).getTime()) / 1000);
  if (s < 60) return `${Math.floor(s)}s`;
  return fmtMin(s / 60);
}
function ago(date) {
  const m = (Date.now() - new Date(date).getTime()) / 60000;
  if (m < 1) return 'just now';
  if (m < 60) return `${Math.round(m)} min ago`;
  if (m < 60 * 24) return `${Math.round(m / 60)} h ago`;
  const d = Math.round(m / 1440);
  return d === 1 ? 'yesterday' : `${d} days ago`;
}
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function api(path, { method = 'GET', body } = {}) {
  const res = await fetch(path, {
    method,
    headers: { 'X-Bbx-Token': TOKEN, ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  let json = null;
  try { json = await res.json(); } catch {}
  if (!res.ok) {
    const e = new Error(json?.error || `Companion error ${res.status}`);
    e.status = res.status;
    throw e;
  }
  return json;
}

let toastTimer;
function toast(text) {
  const t = document.getElementById('toast');
  t.textContent = text;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 2400);
}

async function copy(text, done = 'Copied') {
  try { await navigator.clipboard.writeText(text); toast(done); }
  catch { toast('Couldn\'t reach the clipboard'); }
}

const join = (placeId, jobId) => api('/api/open', { method: 'POST', body: jobId ? { placeId, jobId } : { placeId } })
  .then(() => toast(jobId ? 'Joining server… Roblox opens in a moment' : 'Starting game…')).catch(e => toast(e.message));
const openWeb = url => api('/api/open', { method: 'POST', body: { url } }).catch(e => toast(e.message));
const inviteUrl = (placeId, jobId) => `https://www.roblox.com/games/start?placeId=${placeId}&gameInstanceId=${jobId}`;

// Thumbnails go through the companion (Roblox's APIs don't allow this page's origin).
const iconCache = new Map();
async function icons(universeIds) {
  const need = [...new Set(universeIds.filter(id => id && !iconCache.has(String(id))))];
  for (let i = 0; i < need.length; i += 50) {
    try { Object.entries(await api(`/api/icons?ids=${need.slice(i, i + 50).join(',')}`)).forEach(([k, v]) => iconCache.set(k, v)); } catch {}
  }
  return id => iconCache.get(String(id)) || '';
}
const headCache = new Map();
async function heads(userIds) {
  const need = [...new Set(userIds.filter(id => id && !headCache.has(String(id))))];
  for (let i = 0; i < need.length; i += 100) {
    try { Object.entries(await api(`/api/heads?ids=${need.slice(i, i + 100).join(',')}`)).forEach(([k, v]) => headCache.set(k, v)); } catch {}
  }
  return id => headCache.get(String(id)) || '';
}
function img(src, cls, alt = '') {
  const i = el('img', { class: cls, alt, loading: 'lazy' });
  if (src) i.src = src;
  return i;
}

function menuButton(label, items, cls = 'btn ghost') {
  const wrap = el('div', { class: 'menu' });
  const pop = el('div', { class: 'menu-pop', hidden: true, role: 'menu' });
  const btn = el('button', { class: cls, type: 'button', 'aria-haspopup': 'menu', onclick: (e) => { e.stopPropagation(); pop.hidden = !pop.hidden; } }, label);
  for (const it of items) pop.append(el('button', { type: 'button', role: 'menuitem', onclick: () => { pop.hidden = true; it.run(); } }, it.label, it.hint ? el('small', { text: it.hint }) : null));
  document.addEventListener('click', () => { pop.hidden = true; });
  wrap.append(btn, pop);
  return wrap;
}

// ---------- state + routing ----------

let state = null;
let page = 'now';
let pageCtx = {};          // e.g. { placeId, universeId, name } for Servers / Find opened on another game
let renderToken = 0;
const main = document.getElementById('main');

function go(p, ctx = {}) {
  page = p;
  pageCtx = ctx;
  try { localStorage.setItem('bbx-page', p); } catch {}
  for (const b of document.querySelectorAll('#nav button')) {
    if (b.dataset.page === p) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current');
  }
  render();
}

function render() {
  const token = ++renderToken;
  const root = el('div', { class: 'page' });
  main.replaceChildren(root);
  main.scrollTop = 0;
  const alive = () => token === renderToken;
  (pages[page] || pages.now)(root, alive).catch(e => { if (alive()) root.append(el('div', { class: 'error', text: e.message })); });
}

function head(title, sub, ...right) {
  return el('div', { class: 'page-head' }, el('div', {}, el('h1', { text: title }), sub ? el('p', { text: sub }) : null), el('div', { class: 'row wrap' }, ...right));
}

function linkNeeded(what) {
  return el('div', { class: 'card' },
    el('div', { class: 'empty' },
      el('b', { text: `${what} needs the browser link` }),
      el('p', { text: 'Roblox only shares this with logged-in players. The companion never touches your login, so it asks the Bloxboard extension in your browser instead.' }),
      el('div', { class: 'sp' }),
      el('button', { class: 'btn', type: 'button', text: 'How to link', onclick: () => go('settings') })));
}

// The game a page works on: the one picked elsewhere, else the one you're in.
function targetGame() {
  if (pageCtx.placeId) return pageCtx;
  const s = state?.session;
  return s ? { placeId: s.placeId, universeId: s.universeId, name: s.gameName } : null;
}

// ---------- pages ----------

const pages = {};

pages.now = async (root, alive) => {
  const s = state?.session;
  if (!s) return renderIdle(root, alive);

  const hero = el('div', { class: 'hero' });
  const bg = el('div', { class: 'hero-bg' });
  const iconImg = img('', 'hero-icon');
  const title = el('h1', { text: s.gameName || `Place ${s.placeId}` });
  const facts = el('div', { class: 'facts' });
  const timeHere = el('b', { text: fmtSince(s.joinedAt) });
  facts.append(
    el('span', {}, s.location ? el('b', { text: s.location }) : el('span', { text: 'Finding location…' })),
    el('span', {}, 'Here for ', timeHere),
    s.serverStarted ? el('span', {}, 'Server up ', el('b', { text: fmtSince(s.serverStarted) })) : null,
    el('span', { class: 'faint', text: `Server ${s.jobId.slice(0, 8)}` }));
  const favBtn = el('button', { class: 'btn ghost icon-only', type: 'button', title: 'Favorite', 'aria-label': 'Favorite' }, icon('star'));
  const acts = el('div', { class: 'actions' },
    el('button', { class: 'btn', type: 'button', onclick: () => copy(s.invite, 'Invite link copied. Paste it to a friend.') }, icon('copy'), 'Copy invite'),
    menuButton([icon('hop'), 'Server hop'], [
      { label: 'Smallest server', hint: 'Fewest players, still someone there', run: () => hop('small') },
      { label: 'Best ping', hint: 'Lowest ping Roblox reports', run: () => hop('ping') },
      { label: 'Busiest with room', hint: 'Most players, not full', run: () => hop('busy') },
      { label: 'Random server', run: () => hop('random') },
    ]),
    el('button', { class: 'btn ghost', type: 'button', onclick: () => join(s.placeId, s.jobId) }, icon('rejoin'), 'Rejoin'),
    el('button', { class: 'btn ghost', type: 'button', onclick: () => go('servers') }, 'All servers'),
    favBtn,
    el('button', { class: 'btn ghost icon-only', type: 'button', title: 'Open on roblox.com', 'aria-label': 'Open on roblox.com', onclick: () => openWeb(`https://www.roblox.com/games/${s.placeId}`) }, icon('web')));
  hero.append(bg, el('div', { class: 'hero-in' }, iconImg, el('div', { class: 'grow' },
    el('div', { class: 'live' }, el('i'), 'Playing now'), title, facts, acts)));
  root.append(hero, el('div', { class: 'sp' }));

  const kpis = el('div', { class: 'kpis' });
  const grid = el('div', { class: 'grid cols-2' });
  root.append(kpis, el('div', { class: 'sp' }), grid);

  const tick = setInterval(() => { if (!alive()) return clearInterval(tick); timeHere.textContent = fmtSince(s.joinedAt); }, 1000);

  const [game, stats] = await Promise.all([
    api(`/api/game?${s.universeId ? `universe=${s.universeId}` : `place=${s.placeId}`}`).catch(() => null),
    api('/api/stats?days=365').catch(() => null),
  ]);
  if (!alive()) return;
  if (game?.icon) { iconImg.src = game.icon; bg.style.backgroundImage = `url("${game.icon}")`; }
  if (game?.game?.name) title.textContent = game.game.name;
  let fav = !!game?.favorite;
  const setFav = () => { favBtn.classList.toggle('on', fav); favBtn.title = fav ? 'Remove from favorites' : 'Add to favorites'; };
  setFav();
  favBtn.onclick = async () => {
    fav = !fav; setFav();
    await api('/api/favorites', { method: 'POST', body: { universeId: game?.universeId || s.universeId, placeId: s.placeId, name: game?.game?.name || s.gameName, on: fav } }).catch(e => toast(e.message));
    toast(fav ? 'Added to favorites' : 'Removed from favorites');
  };

  const g = game?.game;
  const v = game?.votes;
  const rating = v && (v.upVotes + v.downVotes) ? Math.round(v.upVotes / (v.upVotes + v.downVotes) * 100) : null;
  const mine = stats?.games?.find(x => x.universeId === (game?.universeId || s.universeId));
  const kpi = (label, value, sub) => el('div', { class: 'kpi' }, el('div', { class: 'label', text: label }), el('div', { class: 'value', text: value }), sub ? el('div', { class: 'sub', text: sub }) : null);
  kpis.append(
    kpi('Playing', fmtNum(g?.playing), g?.maxPlayers ? `${g.maxPlayers} per server` : null),
    kpi('Rating', rating == null ? '–' : `${rating}%`, v ? `${fmtNum(v.upVotes)} likes` : null),
    kpi('Visits', fmtNum(g?.visits), g?.favoritedCount ? `${fmtNum(g.favoritedCount)} favorites` : null),
    kpi('Your time here', fmtMin(mine?.minutes || 0), mine ? `${mine.sessions} session${mine.sessions === 1 ? '' : 's'} this year` : 'First time tracked'));

  // This server, from Roblox's public list (ping/fps/players).
  const srvCard = el('div', { class: 'card' }, el('h2', { text: 'This server' }), el('div', { class: 'loading', text: 'Looking it up' }));
  const noteCard = el('div', { class: 'card' });
  grid.append(srvCard, noteCard);

  const note = el('textarea', { class: 'input', placeholder: 'Codes, goals, who you met… saved automatically.', maxlength: '4000' });
  note.value = game?.note || '';
  let noteTimer;
  note.addEventListener('input', () => {
    clearTimeout(noteTimer);
    noteTimer = setTimeout(() => api('/api/note', { method: 'POST', body: { universeId: game?.universeId || s.universeId, text: note.value } }).then(() => toast('Note saved')).catch(e => toast(e.message)), 700);
  });
  noteCard.append(el('h2', { text: 'Notes for this game' }), note);

  let found = null;
  let cursor = '';
  for (let i = 0; i < 2 && !found; i++) {
    const pageData = await api(`/api/servers?place=${s.placeId}&order=Desc${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`).catch(() => null);
    if (!pageData) break;
    found = pageData.data.find(x => x.id === s.jobId);
    cursor = pageData.nextPageCursor;
    if (!cursor) break;
  }
  if (!alive()) return;
  const body = found
    ? el('div', { class: 'kpis three' },
        kpi('Players', `${found.playing}/${found.maxPlayers}`, found.playing >= found.maxPlayers ? 'Full' : `${found.maxPlayers - found.playing} spots left`),
        kpi('Ping', found.ping != null ? `${found.ping} ms` : '–', 'Reported by Roblox'),
        kpi('Server FPS', found.fps != null ? String(Math.round(found.fps)) : '–', found.fps != null && found.fps < 50 ? 'Laggy server' : 'Smooth'))
    : el('p', { class: 'muted', text: 'Not in Roblox\'s public list right now (private, reserved or very busy game). Invite, rejoin and hop still work.' });
  srvCard.replaceChildren(el('h2', { text: 'This server' }), body,
    el('p', { class: 'small faint', style: { marginTop: '10px' }, text: s.address ? `Address ${s.address}` : '' }));
};

async function hop(mode) {
  toast('Looking for another server…');
  try {
    const r = await api('/api/hop', { method: 'POST', body: { mode } });
    toast(`Joining a server with ${r.server.playing}/${r.server.maxPlayers} players…`);
  } catch (e) { toast(e.message); }
}

async function renderIdle(root, alive) {
  root.append(el('div', { class: 'card idle' },
    el('img', { src: 'icon.png', alt: '' }),
    el('h1', { text: 'Not in a game right now' }),
    el('p', { text: 'Join any game in Roblox and it shows up here within a second.' }),
    el('p', { class: 'small faint', text: state?.reading ? `Reading ${state.reading}` : 'Waiting for Roblox to write its log.' })));
  root.append(el('div', { class: 'sp' }));
  const recent = await api('/api/stats?days=30').catch(() => null);
  if (!alive() || !recent?.games?.length) return;
  const get = await icons(recent.games.map(g => g.universeId));
  if (!alive()) return;
  root.append(el('div', { class: 'card' }, el('div', { class: 'card-head' }, el('h2', { text: 'Jump back in' }), el('button', { class: 'btn ghost sm', type: 'button', text: 'Playtime', onclick: () => go('stats') })),
    el('div', { class: 'tiles' }, recent.games.slice(0, 12).map(g => gameTile({ universeId: g.universeId, placeId: g.placeId, name: g.name || `Game ${g.universeId}`, meta: `${fmtMin(g.minutes)} · ${ago(g.last)}` }, get)))));
}

function gameTile(g, get) {
  return el('div', { class: 'tile' },
    img(get(g.universeId), '', ''),
    el('div', { class: 't-body' },
      el('div', { class: 't-name', title: g.name, text: g.name }),
      g.meta ? el('div', { class: 't-meta', text: g.meta }) : null,
      el('div', { class: 't-acts' },
        el('button', { class: 'btn sm', type: 'button', onclick: () => join(g.placeId) }, icon('play'), 'Play'),
        el('button', { class: 'btn ghost sm', type: 'button', text: 'Servers', onclick: () => go('servers', { placeId: g.placeId, universeId: g.universeId, name: g.name }) }))));
}

// ---------- Servers ----------

const srvPrefs = (() => { try { return JSON.parse(localStorage.getItem('bbx-srv') || '{}'); } catch { return {}; } })();
const saveSrvPrefs = () => { try { localStorage.setItem('bbx-srv', JSON.stringify(srvPrefs)); } catch {} };

pages.servers = async (root, alive) => {
  const t = targetGame();
  if (!t) {
    root.append(head('Servers', 'Every public server of a game, with filters.'));
    root.append(el('div', { class: 'card empty' }, el('b', { text: 'Pick a game' }), el('p', { text: 'Join a game, or open Servers from a game in Games or Playtime.' }), el('div', { class: 'sp' }), el('button', { class: 'btn', type: 'button', text: 'Browse games', onclick: () => go('games') })));
    return;
  }
  const linked = state?.link?.connected;
  const status = el('span', { class: 'small muted' });
  root.append(head('Servers', t.name || `Place ${t.placeId}`, status,
    pageCtx.placeId && state?.session ? el('button', { class: 'btn ghost sm', type: 'button', text: 'Back to my game', onclick: () => go('servers') }) : null));

  const sort = el('select', { class: 'input', 'aria-label': 'Sort' },
    el('option', { value: 'few', text: 'Fewest players' }), el('option', { value: 'many', text: 'Most players' }), el('option', { value: 'ping', text: 'Best ping' }), el('option', { value: 'fps', text: 'Best server FPS' }));
  const size = el('select', { class: 'input', 'aria-label': 'Size' },
    el('option', { value: 'any', text: 'Any size' }), el('option', { value: 'empty', text: 'Almost empty (≤25%)' }), el('option', { value: 'half', text: 'Under half full' }), el('option', { value: 'busy', text: 'Busy (≥75%)' }));
  const ping = el('select', { class: 'input', 'aria-label': 'Max ping' },
    el('option', { value: '0', text: 'Any ping' }), el('option', { value: '60', text: 'Ping under 60' }), el('option', { value: '100', text: 'Ping under 100' }), el('option', { value: '150', text: 'Ping under 150' }));
  const region = el('select', { class: 'input', 'aria-label': 'Region', hidden: true }, el('option', { value: '', text: 'All regions' }));
  const hideFull = el('input', { type: 'checkbox' });
  const regionBtn = el('button', { class: 'btn ghost', type: 'button', text: 'Show regions', title: linked ? 'Ask your browser for each server\'s location' : 'Needs the browser link' });
  const more = el('button', { class: 'btn ghost', type: 'button', text: 'Load more' });
  const refresh = el('button', { class: 'btn ghost icon-only', type: 'button', title: 'Refresh', 'aria-label': 'Refresh' }, icon('refresh'));
  sort.value = srvPrefs.sort || 'few'; size.value = srvPrefs.size || 'any'; ping.value = srvPrefs.ping || '0'; hideFull.checked = srvPrefs.hideFull ?? true;
  root.append(el('div', { class: 'toolbar' }, sort, size, ping, region, el('label', { class: 'row small muted', style: { gap: '6px' } }, hideFull, 'Hide full'), el('div', { class: 'tb-right' }, regionBtn, refresh)));

  const list = el('div', { class: 'card', style: { padding: '8px' } });
  root.append(list, el('div', { class: 'sp' }), el('div', { class: 'row', style: { justifyContent: 'center' } }, more));

  let servers = [];
  let cursor = '';
  let loadError = '';
  const regions = {};
  let friendsIn = {};

  const draw = () => {
    if (!alive()) return;
    const maxPing = Number(ping.value);
    let rows = servers.filter(s => {
      const fill = s.playing / s.maxPlayers;
      if (hideFull.checked && s.playing >= s.maxPlayers && !s.current) return false;
      if (size.value === 'empty' && fill > .25) return false;
      if (size.value === 'half' && fill >= .5) return false;
      if (size.value === 'busy' && fill < .75) return false;
      if (maxPing && (s.ping == null || s.ping > maxPing)) return false;
      if (region.value && regions[s.id]?.city !== region.value) return false;
      return true;
    });
    const by = { few: (a, b) => a.playing - b.playing, many: (a, b) => b.playing - a.playing, ping: (a, b) => (a.ping ?? 9999) - (b.ping ?? 9999), fps: (a, b) => (b.fps ?? 0) - (a.fps ?? 0) }[sort.value];
    rows.sort((a, b) => (b.current - a.current) || by(a, b));
    status.textContent = `${rows.length} of ${servers.length} servers`;
    if (loadError && !servers.length) {
      list.replaceChildren(el('div', { class: 'empty' }, el('b', { text: 'Couldn\'t load the server list' }), el('p', { text: loadError }), el('div', { class: 'sp' }),
        el('button', { class: 'btn', type: 'button', text: 'Try again', onclick: () => load(true) })));
      return;
    }
    const pc = p => p == null ? '' : p < 80 ? 'ping-good' : p < 150 ? 'ping-mid' : 'ping-bad';
    list.replaceChildren(
      el('div', { class: 'srv srv-head' }, el('span', { text: 'Players' }), el('span', { text: 'Ping' }), el('span', { text: 'FPS' }), el('span', { text: 'Region' }), el('span', { text: '' })),
      ...(rows.length ? rows.slice(0, 300).map(s => {
        const r = regions[s.id];
        const friends = friendsIn[s.id] || [];
        return el('div', { class: `srv${s.current ? ' current' : ''}` },
          el('div', { class: 'fill' },
            el('div', { class: 'row', style: { gap: '8px' } }, el('b', { class: 'num', text: `${s.playing}/${s.maxPlayers}` }),
              el('div', { class: 'tags' },
                s.current ? el('span', { class: 'badge good', text: 'You\'re here' }) : null,
                s.visited && !s.current ? el('span', { class: 'badge', text: 'Visited' }) : null,
                friends.map(f => el('span', { class: 'badge accent', text: f })))),
            el('div', { class: 'bar-track' }, el('i', { class: s.playing >= s.maxPlayers ? 'full' : '', style: { width: `${Math.min(100, s.playing / s.maxPlayers * 100)}%` } }))),
          el('span', { class: `num ${pc(s.ping)}`, text: s.ping != null ? `${s.ping} ms` : '–' }),
          el('span', { class: 'num muted', text: s.fps != null ? String(Math.round(s.fps)) : '–' }),
          el('span', { class: 'small ellipsis', title: r?.country || '', text: r ? (r.city ? `${r.city}${r.cc ? `, ${r.cc}` : ''}` : '?') : '' }),
          el('div', { class: 'acts' },
            el('button', { class: 'btn ghost sm icon-only', type: 'button', title: 'Copy invite link', 'aria-label': 'Copy invite link', onclick: () => copy(inviteUrl(t.placeId, s.id), 'Invite link copied') }, icon('copy')),
            el('button', { class: 'btn sm', type: 'button', text: s.current ? 'Rejoin' : 'Join', onclick: () => join(t.placeId, s.id) })));
      }) : [el('div', { class: 'empty', text: servers.length ? 'No servers match these filters.' : 'No public servers right now.' })]));
  };

  async function load(reset) {
    if (reset) { servers = []; cursor = ''; }
    more.disabled = true;
    more.textContent = 'Loading…';
    loadError = '';
    if (reset) list.replaceChildren(el('div', { class: 'loading', text: 'Loading servers' }));
    try {
      const p = await api(`/api/servers?place=${t.placeId}&order=${sort.value === 'many' ? 'Desc' : 'Asc'}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`);
      const have = new Set(servers.map(s => s.id));
      servers.push(...p.data.filter(s => !have.has(s.id)));
      cursor = p.nextPageCursor;
      // Your own server is usually busy, so it's at the other end of the list: make sure it's in.
      const mine = state?.session;
      if (reset && mine && String(mine.placeId) === String(t.placeId) && !servers.some(s => s.id === mine.jobId)) {
        const other = await api(`/api/servers?place=${t.placeId}&order=${sort.value === 'many' ? 'Asc' : 'Desc'}`).catch(() => null);
        const ids = new Set(servers.map(s => s.id));
        if (other) servers.push(...other.data.filter(s => !ids.has(s.id)));
      }
    } catch (e) {
      loadError = e.message;
      if (servers.length) toast(e.message);
    }
    if (!alive()) return;
    more.hidden = !cursor;
    more.disabled = false;
    more.textContent = 'Load more';
    draw();
  }

  async function detectRegions() {
    if (!state?.link?.connected) { toast('Link your browser first (Settings)'); return go('settings'); }
    regionBtn.disabled = true;
    const todo = servers.filter(s => !regions[s.id]).map(s => s.id);
    let done = 0;
    for (let i = 0; i < todo.length; i += 20) {
      const chunk = todo.slice(i, i + 20);
      regionBtn.textContent = `Regions ${Math.round(done / todo.length * 100)}%`;
      try {
        const r = await api('/api/regions', { method: 'POST', body: { placeId: t.placeId, serverIds: chunk } });
        for (const id of chunk) regions[id] = r?.[id] || { city: null };
      } catch (e) { toast(e.message); break; }
      done += chunk.length;
      if (!alive()) return;
      const cities = [...new Set(Object.values(regions).map(x => x.city).filter(Boolean))].sort();
      const keep = region.value;
      region.replaceChildren(el('option', { value: '', text: 'All regions' }), ...cities.map(c => el('option', { value: c, text: c })));
      region.value = cities.includes(keep) ? keep : (cities.includes(srvPrefs.region) ? srvPrefs.region : '');
      region.hidden = !cities.length;
      draw();
    }
    regionBtn.disabled = false;
    regionBtn.textContent = 'Show regions';
  }

  for (const c of [sort, size, ping, region, hideFull]) c.addEventListener('change', () => {
    Object.assign(srvPrefs, { sort: sort.value, size: size.value, ping: ping.value, hideFull: hideFull.checked, region: region.value || srvPrefs.region });
    saveSrvPrefs();
    if (c === sort && (sort.value === 'many') !== (srvPrefs.lastOrder === 'many')) { srvPrefs.lastOrder = sort.value; load(true); } else draw();
  });
  srvPrefs.lastOrder = sort.value;
  more.onclick = () => load(false);
  refresh.onclick = () => load(true);
  regionBtn.onclick = detectRegions;

  await load(true);

  // Friends in these servers (browser link only).
  if (linked) {
    try {
      const f = await api('/api/friends');
      for (const fr of f.data || []) {
        const p = fr.presence;
        if (p?.gameId && (String(p.placeId) === String(t.placeId) || String(p.rootPlaceId) === String(t.placeId))) (friendsIn[p.gameId] ||= []).push(fr.displayName || fr.name);
      }
      draw();
    } catch {}
    if (srvPrefs.autoRegions) detectRegions();
  }
};

// ---------- Find ----------

let findJob = null;

pages.find = async (root, alive) => {
  const t = targetGame();
  root.append(head('Find player', t ? `Search ${t.name || `place ${t.placeId}`} for someone` : 'Find which server someone is in'));
  if (!state?.link?.connected) {
    root.append(linkNeeded('The player finder'));
    if (t) root.append(el('div', { class: 'sp' }), el('div', { class: 'card row wrap' }, el('span', { class: 'grow muted', text: 'Or use the finder on the game page in your browser.' }), el('button', { class: 'btn ghost', type: 'button', onclick: () => openWeb(`https://www.roblox.com/games/${t.placeId}#bbx-find`) }, icon('web'), 'Open in browser')));
    return;
  }
  if (!t) {
    root.append(el('div', { class: 'card empty' }, el('b', { text: 'Pick a game first' }), el('p', { text: 'Join the game, or open Find from Games.' })));
    return;
  }
  const input = el('input', { class: 'input grow', placeholder: 'Username or display name', autocomplete: 'off', spellcheck: 'false' });
  const mode = el('div', { class: 'seg' });
  let m = 'username';
  const setMode = v => { m = v; for (const b of mode.children) b.setAttribute('aria-pressed', b.dataset.v === v); };
  for (const [v, label] of [['username', 'Username'], ['display', 'Display name']]) mode.append(el('button', { type: 'button', 'data-v': v, text: label, onclick: () => setMode(v) }));
  setMode('username');
  const go_ = el('button', { class: 'btn', type: 'submit', text: 'Search' });
  const bar = el('div', { class: 'progress' }, el('i'));
  const say = el('p', { class: 'muted small', style: { marginTop: '8px' } });
  const results = el('div', { style: { marginTop: '14px' } });
  const form = el('form', { class: 'card' },
    el('div', { class: 'row wrap' }, input, mode, go_),
    el('div', { class: 'sp' }), bar, say, results,
    el('p', { class: 'small faint', style: { marginTop: '12px' }, text: 'Uses your browser\'s Roblox login through the Bloxboard extension. Roblox shows only a few players per server, so the finder scans the list a few times.' }));
  root.append(form);

  const show = (data) => {
    const p = data?.progress;
    if (p) {
      bar.firstChild.style.width = `${Math.round(p.pct || 0)}%`;
      say.textContent = p.text || '';
    }
    const res = data?.result || p;
    const items = res?.found || [];
    results.replaceChildren(...items.map(f => el('div', { class: 'found' },
      img(f.face, 'avatar'),
      el('div', { class: 'grow' }, el('b', { text: f.title }), el('div', { class: 'small muted', text: f.sub })),
      el('button', { class: 'btn ghost sm', type: 'button', onclick: () => copy(inviteUrl(f.placeId, f.gameId), 'Invite link copied') }, icon('copy'), 'Copy link'),
      el('button', { class: 'btn sm', type: 'button', text: 'Join', onclick: () => join(f.placeId, f.gameId) }))));
    if (data?.done) {
      bar.firstChild.style.width = '100%';
      say.textContent = data.error || data.result?.text || say.textContent;
      say.className = `small ${data.error ? 'bad' : items.length ? 'good' : 'muted'}`;
    }
  };

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (findJob) {
      await api('/api/find/cancel', { method: 'POST', body: { job: findJob } }).catch(() => {});
      return;
    }
    const q = input.value.trim();
    if (!q) return input.focus();
    results.replaceChildren();
    say.className = 'muted small';
    say.textContent = 'Starting…';
    bar.firstChild.style.width = '0%';
    try {
      findJob = (await api('/api/find', { method: 'POST', body: { placeId: t.placeId, query: q, mode: m } })).job;
      go_.textContent = 'Cancel';
      while (findJob) {
        await sleep(700);
        const d = await api(`/api/find?job=${findJob}`);
        if (alive()) show(d);
        if (d.done) break;
      }
    } catch (err) {
      if (alive()) { say.textContent = err.message; say.className = 'small bad'; }
    }
    findJob = null;
    go_.textContent = 'Search';
  });
  input.focus();
};

// ---------- Friends ----------

pages.friends = async (root, alive) => {
  root.append(head('Friends', state?.link?.connected ? 'Who\'s playing, live from your browser' : 'Your friend list'));
  const box = el('div', {}, el('div', { class: 'loading', text: 'Loading friends' }));
  root.append(box);
  const f = await api('/api/friends');
  if (!alive()) return;
  if (f.needUser) {
    box.replaceChildren(el('div', { class: 'card empty' }, el('b', { text: 'Play one game first' }), el('p', { text: 'The companion learns who you are from Roblox\'s log the first time you join a game. Or link your browser.' })));
    return;
  }
  const list = f.data || [];
  const get = await heads(list.map(x => x.id));
  const gameIcons = await icons(list.map(x => x.presence?.universeId).filter(Boolean));
  if (!alive()) return;
  const card = (fr) => {
    const p = fr.presence;
    const t = p?.userPresenceType;
    const stCls = t === 2 ? 'game' : t === 1 ? 'online' : t === 3 ? 'studio' : 'off';
    const where = t === 2 ? (p.lastLocation || 'In a game') : t === 1 ? 'Online' : t === 3 ? 'In Studio' : f.linked ? 'Offline' : '';
    return el('div', { class: 'friend' },
      img(get(fr.id), 'avatar'), el('i', { class: `st ${stCls}`, hidden: !f.linked }),
      el('div', { class: 'grow' }, el('div', { class: 'item-title ellipsis', text: fr.displayName || fr.name }), el('div', { class: 'small muted ellipsis', text: where ? `${where}` : `@${fr.name}` })),
      t === 2 && p.universeId ? img(gameIcons(p.universeId), 'icon sm', '') : null,
      t === 2 && p.placeId ? el('button', { class: 'btn sm', type: 'button', text: p.gameId ? 'Join' : 'Play', title: p.gameId ? 'Join their server' : 'Their server is hidden; starts the same game', onclick: () => join(p.rootPlaceId || p.placeId, p.gameId || undefined) }) : null);
  };
  if (!f.linked) {
    box.replaceChildren(
      el('div', { class: 'note-box row wrap' }, el('span', { class: 'grow', text: 'Link your browser to see who\'s online and join their servers.' }), el('button', { class: 'btn sm', type: 'button', text: 'How to link', onclick: () => go('settings') })),
      el('div', { class: 'sp' }),
      el('div', { class: 'card' }, el('h2', { text: `${list.length} friends` }), el('div', { class: 'fgrid' }, list.map(card))));
    return;
  }
  const ingame = list.filter(x => x.presence?.userPresenceType === 2);
  const online = list.filter(x => [1, 3].includes(x.presence?.userPresenceType));
  const off = list.filter(x => !x.presence || x.presence.userPresenceType === 0);
  box.replaceChildren(
    el('div', { class: 'card' }, el('h2', { text: `In a game · ${ingame.length}` }), ingame.length ? el('div', { class: 'fgrid' }, ingame.map(card)) : el('p', { class: 'muted', text: 'Nobody is in a game right now.' })),
    el('div', { class: 'sp' }),
    el('div', { class: 'card' }, el('h2', { text: `Online · ${online.length}` }), online.length ? el('div', { class: 'fgrid' }, online.map(card)) : el('p', { class: 'muted', text: 'Nobody else is online.' })),
    el('div', { class: 'sp' }),
    el('details', { class: 'card' }, el('summary', { style: { cursor: 'pointer', fontWeight: 700 }, text: `Offline · ${off.length}` }), el('div', { class: 'fgrid', style: { marginTop: '10px' } }, off.map(card))));
};

// ---------- Games ----------

pages.games = async (root, alive) => {
  const input = el('input', { class: 'input', type: 'search', placeholder: 'Search Roblox games', style: { width: 'min(360px, 100%)' } });
  root.append(head('Games', 'Search, favorites and what you played lately', input));
  const results = el('div');
  const favCard = el('div', { class: 'card' });
  const recentCard = el('div', { class: 'card' });
  root.append(results, favCard, el('div', { class: 'sp' }), recentCard);

  let timer;
  input.addEventListener('input', () => {
    clearTimeout(timer);
    timer = setTimeout(async () => {
      const q = input.value.trim();
      if (!q) return results.replaceChildren();
      results.replaceChildren(el('div', { class: 'loading', text: 'Searching' }));
      try {
        const r = await api(`/api/search?q=${encodeURIComponent(q)}`);
        const get = await icons(r.data.map(g => g.universeId));
        results.replaceChildren(el('div', { class: 'card' }, el('h2', { text: `Results for "${q}"` }),
          r.data.length ? el('div', { class: 'tiles' }, r.data.map(g => gameTile({ ...g, meta: `${fmtNum(g.playing)} playing${g.up + g.down ? ` · ${Math.round(g.up / (g.up + g.down) * 100)}%` : ''}` }, get))) : el('p', { class: 'muted', text: 'Nothing found.' })), el('div', { class: 'sp' }));
      } catch (e) { results.replaceChildren(el('div', { class: 'error', text: e.message })); }
    }, 350);
  });

  const [favs, stats] = await Promise.all([api('/api/favorites').catch(() => []), api('/api/stats?days=90').catch(() => null)]);
  const get = await icons([...favs.map(f => f.universeId), ...(stats?.games || []).map(g => g.universeId)]);
  if (!alive()) return;
  favCard.append(el('h2', { text: 'Favorites' }), favs.length
    ? el('div', { class: 'tiles' }, favs.map(f => gameTile({ universeId: f.universeId, placeId: f.placeId, name: f.name, meta: `Added ${ago(f.added)}` }, get)))
    : el('p', { class: 'muted', text: 'Star a game on the Now page to keep it here.' }));
  recentCard.append(el('h2', { text: 'Played lately' }), stats?.games?.length
    ? el('div', { class: 'tiles' }, stats.games.slice(0, 18).map(g => gameTile({ universeId: g.universeId, placeId: g.placeId, name: g.name || `Game ${g.universeId}`, meta: `${fmtMin(g.minutes)} · ${ago(g.last)}` }, get)))
    : el('p', { class: 'muted', text: 'Nothing yet. Play something and it shows up here.' }));
};

// ---------- Playtime ----------

let statDays = 30;

pages.stats = async (root, alive) => {
  const seg = el('div', { class: 'seg' });
  for (const d of [7, 30, 90, 365]) seg.append(el('button', { type: 'button', 'aria-pressed': d === statDays, text: d === 365 ? 'Year' : `${d} days`, onclick: () => { statDays = d; render(); } }));
  root.append(head('Playtime', 'Counted from Roblox\'s log, including the days before you installed this.', seg));
  const s = await api(`/api/stats?days=${statDays}`);
  if (!alive()) return;
  const kpi = (label, value, sub) => el('div', { class: 'kpi' }, el('div', { class: 'label', text: label }), el('div', { class: 'value', text: value }), sub ? el('div', { class: 'sub', text: sub }) : null);
  const active = s.days.filter(d => d.minutes > 0).length;
  root.append(el('div', { class: 'kpis' },
    kpi('Today', fmtMin(s.today)),
    kpi(statDays === 365 ? 'This year' : `Last ${statDays} days`, fmtMin(s.total), active ? `${fmtMin(s.total / active)} per day played` : null),
    kpi('Streak', `${s.streak} day${s.streak === 1 ? '' : 's'}`, `Best ${s.bestStreak}`),
    kpi('Sessions', String(s.sessions), s.firstDay ? `Tracked since ${s.firstDay}` : null)), el('div', { class: 'sp' }));

  // Bars per day
  const W = 900, H = 170, pad = 24;
  const max = Math.max(60, ...s.days.map(d => d.minutes));
  const bw = (W - pad) / s.days.length;
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', `0 0 ${W} ${H + 18}`);
  svg.setAttribute('class', 'chart');
  const ns = (tag, attrs) => { const n = document.createElementNS('http://www.w3.org/2000/svg', tag); for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v); return n; };
  const stepH = max > 600 ? 240 : max > 240 ? 120 : 60;
  for (let v = stepH; v <= max; v += stepH) {
    const y = H - (v / max) * (H - 10);
    svg.append(ns('line', { x1: pad, x2: W, y1: y, y2: y, class: 'grid-line' }));
    const t = ns('text', { x: 0, y: y + 4 }); t.textContent = `${v / 60}h`; svg.append(t);
  }
  s.days.forEach((d, i) => {
    const h = (d.minutes / max) * (H - 10);
    const r = ns('rect', { x: pad + i * bw + bw * 0.15, y: H - h, width: Math.max(1, bw * 0.7), height: Math.max(d.minutes ? 2 : 0, h), rx: Math.min(3, bw * 0.2), class: `bar${i === s.days.length - 1 ? ' today' : ''}` });
    const tt = ns('title', {}); tt.textContent = `${d.day}: ${fmtMin(d.minutes)}`; r.append(tt);
    svg.append(r);
  });
  const every = Math.ceil(s.days.length / 8);
  s.days.forEach((d, i) => { if (i % every === 0) { const t = ns('text', { x: pad + i * bw, y: H + 15 }); t.textContent = d.day.slice(5); svg.append(t); } });
  root.append(el('div', { class: 'card' }, el('h2', { text: 'Per day' }), svg), el('div', { class: 'sp' }));

  const grid = el('div', { class: 'grid cols-2' });
  root.append(grid);

  const get = await icons(s.games.map(g => g.universeId));
  if (!alive()) return;
  const top = s.games[0]?.minutes || 1;
  grid.append(el('div', { class: 'card' }, el('h2', { text: 'Top games' }), s.games.length ? s.games.slice(0, 10).map(g => el('div', { class: 'topg' },
    img(get(g.universeId), ''),
    el('div', { class: 'row', style: { gap: '8px' } }, el('b', { class: 'grow ellipsis', text: g.name || `Game ${g.universeId}` }), el('span', { class: 'num small', text: fmtMin(g.minutes) })),
    el('button', { class: 'btn ghost sm', type: 'button', style: { gridRow: 'span 2' }, onclick: () => join(g.placeId) }, icon('play'), 'Play'),
    el('div', { class: 'bar-track' }, el('i', { style: { width: `${(g.minutes / top) * 100}%` } })))) : el('p', { class: 'muted', text: 'No playtime in this range yet.' })));

  // Hour-of-week heatmap
  const heat = el('div', { class: 'heat' });
  const hmax = Math.max(1, ...s.heat.flat());
  heat.append(el('span'), ...Array.from({ length: 24 }, (_, h) => el('span', { text: h % 6 === 0 ? String(h) : '' })));
  ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].forEach((d, di) => {
    heat.append(el('span', { class: 'heat-d', text: d }));
    for (let h = 0; h < 24; h++) {
      const v = s.heat[di][h];
      heat.append(el('span', { class: 'heat-c', title: `${d} ${h}:00 · ${fmtMin(v)}`, style: { background: v ? `color-mix(in srgb, var(--accent) ${Math.round(18 + (v / hmax) * 82)}%, var(--sunk))` : 'var(--sunk)' } }));
    }
  });
  grid.append(el('div', { class: 'card' }, el('h2', { text: 'When you play' }), heat));

  const recent = await api('/api/recent').catch(() => []);
  if (!alive()) return;
  root.append(el('div', { class: 'sp' }), el('div', { class: 'card' }, el('h2', { text: 'Recent servers' }),
    recent.length ? el('div', { class: 'list' }, recent.slice(0, 25).map(r => el('div', { class: 'item' },
      img(get(r.universeId), 'icon'),
      el('div', { class: 'grow' }, el('div', { class: 'item-title ellipsis', text: r.name || `Place ${r.placeId}` }), el('div', { class: 'small muted', text: `${ago(r.end)} · ${fmtMin(r.minutes)}${r.location ? ` · ${r.location}` : ''}` })),
      el('button', { class: 'btn ghost sm icon-only', type: 'button', title: 'Copy invite link', 'aria-label': 'Copy invite link', onclick: () => copy(inviteUrl(r.placeId, r.jobId), 'Invite link copied') }, icon('copy')),
      el('button', { class: 'btn ghost sm', type: 'button', text: 'Rejoin', title: 'Works while that server is still running', onclick: () => join(r.placeId, r.jobId) })))) : el('p', { class: 'muted', text: 'No servers yet.' })));
};

// ---------- Settings ----------

pages.settings = async (root, alive) => {
  root.append(head('Settings', 'The companion only reads Roblox\'s log file. It never touches the game.'));
  const l = state?.link || {};
  const linkCard = el('div', { class: 'card' });
  if (l.connected) {
    linkCard.append(el('div', { class: 'card-head' }, el('h2', { text: 'Browser link' }), el('span', { class: 'badge good', text: 'Linked' })),
      el('p', {}, 'Linked to Bloxboard ', el('b', { text: `v${l.version || '?'}` }), l.userName ? [' in your browser, logged in as ', el('b', { text: `@${l.userName}` })] : ' in your browser', '.'),
      el('p', { class: 'small muted', style: { marginTop: '6px' }, text: 'Regions, friends online and the player finder work while your browser is open. Your playtime from the companion also shows up in the Bloxboard dashboard.' }));
  } else {
    linkCard.append(el('div', { class: 'card-head' }, el('h2', { text: 'Link your browser' }), el('span', { class: 'badge', text: 'Not linked' })),
      el('p', { class: 'muted', text: 'Server regions, friends online and the player finder need a Roblox login. The companion never touches yours: it asks the Bloxboard extension in your browser, which is already logged in.' }),
      el('div', { class: 'sp' }),
      el('ol', { class: 'steps' },
        el('li', {}, 'Install Bloxboard 0.8 or newer in your browser (Helium, Brave, Chrome, Edge). ', el('a', { href: '#', onclick: (e) => { e.preventDefault(); openWeb('https://bloxboard.enesserver.dev/#install'); }, text: 'Install guide' })),
        el('li', {}, 'Click the Bloxboard icon → ', el('b', { text: 'Settings' }), ' → ', el('b', { text: 'Windows companion' }), ' → ', el('b', { text: 'Link' }), '. Allow it when the browser asks.'),
        el('li', {}, 'Keep the browser open (minimized is fine). This box turns green within a few seconds.')));
  }

  const st = state?.settings || {};
  const toggle = (key, label, sub) => {
    const input = el('input', { type: 'checkbox', checked: !!st[key] });
    input.addEventListener('change', async () => {
      await api('/api/settings', { method: 'POST', body: { [key]: input.checked } }).catch(e => toast(e.message));
      toast('Saved');
      refreshState();
    });
    return el('label', { class: 'switch' }, input, el('div', {}, el('div', { class: 'item-title', text: label }), el('div', { class: 'small muted', text: sub })));
  };
  const opacity = el('input', { type: 'range', min: '50', max: '100', value: String(Math.round((st.opacity || .94) * 100)), style: { width: '160px', accentColor: 'var(--accent)' } });
  opacity.addEventListener('change', () => api('/api/settings', { method: 'POST', body: { opacity: Number(opacity.value) / 100 } }).then(() => toast('Saved')));

  const diag = el('pre', { class: 'diag', hidden: true });
  const grid = el('div', { class: 'grid cols-2' },
    el('div', { class: 'card' }, el('h2', { text: 'Mini overlay' }),
      toggle('overlayVisible', 'Show the mini overlay', 'The small box with your server, on top of Roblox.'),
      toggle('hideWhenNotInGame', 'Hide it when not in a game', 'Only shows up while you\'re in a server.'),
      el('label', { class: 'switch' }, el('span', { style: { width: '16px' } }), el('div', { class: 'grow' }, el('div', { class: 'item-title', text: 'Overlay opacity' }), el('div', { class: 'small muted', text: 'See-through so it doesn\'t cover the game.' })), opacity)),
    el('div', { class: 'card' }, el('h2', { text: 'This panel' }),
      toggle('panelOnTop', 'Keep the panel on top of Roblox', 'Stays visible over the game until you close it.'),
      toggle('openPanelOnJoin', 'Open the panel when you join a game', 'Otherwise it opens with the hotkey or the tray icon.'),
      el('p', { class: 'small muted', style: { marginTop: '10px' } }, el('kbd', { text: 'Ctrl' }), ' + ', el('kbd', { text: 'Shift' }), ' + ', el('kbd', { text: 'B' }), ' opens or closes the panel. ', el('kbd', { text: 'Ctrl' }), ' + ', el('kbd', { text: 'Shift' }), ' + ', el('kbd', { text: 'N' }), ' shows or hides the mini overlay.')),
    el('div', { class: 'card' }, el('h2', { text: 'Data' }),
      el('p', { class: 'muted small', text: 'Playtime, favorites and notes stay on this PC (in %APPDATA%\\Bloxboard).' }),
      el('div', { class: 'row wrap', style: { marginTop: '12px' } },
        el('button', { class: 'btn ghost sm', type: 'button', text: 'Re-read old Roblox logs', onclick: async (e) => { e.target.disabled = true; const r = await api('/api/import', { method: 'POST', body: {} }).catch(err => ({ error: err.message })); toast(r.error || `${r.sessions} sessions saved`); e.target.disabled = false; } }),
        el('button', { class: 'btn ghost sm', type: 'button', text: 'Diagnostics', onclick: async () => { diag.hidden = !diag.hidden; if (!diag.hidden) diag.textContent = JSON.stringify(await api('/api/diagnostics'), null, 2); } })),
      el('div', { class: 'sp' }), diag),
    el('div', { class: 'card' }, el('h2', { text: 'Safe by design' }),
      el('p', { class: 'muted small', text: 'No injection, no memory reading, no cookies. The companion reads the plain-text log Roblox writes for everyone (the same lines Fishstrap and Bloxstrap read), uses Roblox\'s public website data, and joins servers with official roblox:// links. Executors like Xeno get you banned because they inject into the game; this never does.' }),
      el('p', { class: 'small', style: { marginTop: '10px' } }, el('a', { href: '#', onclick: (e) => { e.preventDefault(); openWeb('https://bloxboard.enesserver.dev/companion.html'); }, text: 'Bloxboard Companion website' }))));
  root.append(linkCard, el('div', { class: 'sp' }), grid);
};

// ---------- live state ----------

let lastKey = '';
async function refreshState() {
  try {
    state = await api('/api/state');
  } catch (e) {
    if (e.status === 403) {
      main.replaceChildren(el('div', { class: 'page' }, el('div', { class: 'card empty' }, el('b', { text: 'Open the panel from the companion' }), el('p', { text: 'Use the tray icon or Ctrl+Shift+B. This page needs the link the companion opens.' }))));
    }
    return;
  }
  document.getElementById('ver').textContent = `Companion v${state.version}`;
  document.getElementById('nav-live').hidden = !state.session;
  const pill = document.getElementById('link-pill');
  pill.classList.toggle('on', !!state.link.connected);
  document.getElementById('link-text').textContent = state.link.connected ? `Browser linked${state.link.userName ? ` · @${state.link.userName}` : ''}` : 'Browser not linked';
  // Re-render when something the current page shows has changed.
  const key = JSON.stringify([state.session?.jobId, state.session?.gameName, state.session?.location, state.session?.serverStarted, state.link.connected]);
  if (key !== lastKey) {
    const first = !lastKey;
    lastKey = key;
    if (first || ['now', 'settings'].includes(page) || (page === 'servers' && !pageCtx.placeId) || (page === 'friends')) {
      if (!(page === 'find' && findJob)) render();
    }
  }
}

document.getElementById('nav').addEventListener('click', (e) => {
  const b = e.target.closest('button[data-page]');
  if (b) go(b.dataset.page);
});
document.getElementById('link-pill').addEventListener('click', () => go('settings'));
document.addEventListener('keydown', (e) => {
  // Esc: back to the game (hides the panel window; only inside the companion's own window).
  if (e.key === 'Escape' && window.chrome?.webview && !document.querySelector('.menu-pop:not([hidden])')) { window.chrome.webview.postMessage('hide'); return; }
  if (e.altKey || e.ctrlKey || e.metaKey || /input|textarea|select/i.test(document.activeElement?.tagName || '')) return;
  const map = { 1: 'now', 2: 'servers', 3: 'find', 4: 'friends', 5: 'games', 6: 'stats', 7: 'settings' };
  if (map[e.key]) go(map[e.key]);
});

try { page = localStorage.getItem('bbx-page') || 'now'; } catch {}
for (const b of document.querySelectorAll('#nav button')) if (b.dataset.page === page) b.setAttribute('aria-current', 'page');
refreshState();
setInterval(refreshState, 1500);
