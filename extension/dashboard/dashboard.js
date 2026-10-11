const { el, api, num, duration } = BB;
const main = document.getElementById('main');
document.getElementById('version').textContent = `v${chrome.runtime.getManifest().version}`;

// ---------- helpers ----------

const loading = text => el('p', { class: 'loading', text });
const errorBox = e => el('p', { class: 'error', text: e?.status === 401 ? 'You\'re not logged in on roblox.com. Log in there, then refresh this page.' : (e?.message || String(e)) });
const pageHead = (title, sub, ...actions) => el('div', { class: 'page-head' },
  el('div', {}, el('h1', { text: title }), sub && el('p', { text: sub })),
  actions.length ? el('div', { class: 'row wrap' }, actions) : null);
const card = (title, ...children) => el('section', { class: 'card' }, title && el('h2', { text: title }), children);
const kpi = (label, value, sub) => el('div', { class: 'kpi' }, el('div', { class: 'label', text: label }), el('div', { class: 'value', text: value }), sub && el('div', { class: 'sub', text: sub }));
const img = (cls, src) => el('img', { class: cls, src: src || undefined, alt: '', loading: 'lazy' });
const profileUrl = id => `https://www.roblox.com/users/${id}/profile`;
const gameUrl = placeId => `https://www.roblox.com/games/${placeId}`;
const itemUrl = id => `https://www.roblox.com/catalog/${id}`;

function seg(options, value, onChange) {
  const wrap = el('div', { class: 'seg', role: 'group' });
  const render = (v) => wrap.replaceChildren(...options.map(([key, label]) => el('button', {
    type: 'button', 'aria-pressed': String(key === v), text: label,
    onclick: () => { render(key); onChange(key); },
  })));
  render(value);
  return wrap;
}

function daysBack(n) {
  const out = [];
  const d = new Date();
  for (let i = n - 1; i >= 0; i--) {
    const x = new Date(d);
    x.setDate(d.getDate() - i);
    out.push(BB.dayKey(x));
  }
  return out;
}

async function playtimeSummary(days) {
  const [playtime, games] = await Promise.all([BB.get('playtime', {}), BB.get('games', {})]);
  const perDay = days.map(d => ({ day: d, minutes: Object.values(playtime[d] || {}).reduce((a, b) => a + b, 0) }));
  const perGame = new Map();
  for (const d of days) for (const [u, m] of Object.entries(playtime[d] || {})) perGame.set(u, (perGame.get(u) || 0) + m);
  const top = [...perGame.entries()].sort((a, b) => b[1] - a[1]).map(([universeId, minutes]) => ({ universeId: Number(universeId), minutes, ...games[universeId] }));
  return { perDay, top, total: perDay.reduce((a, b) => a + b.minutes, 0) };
}

function barChart(perDay, W = 420, H = 230) {
  const pad = { l: 40, r: 8, t: 10, b: 26 };
  const max = Math.max(60, ...perDay.map(d => d.minutes));
  const stepH = max <= 120 ? 30 : max <= 360 ? 60 : max <= 720 ? 120 : 240;
  const top = Math.ceil(max / stepH) * stepH;
  const y = v => pad.t + (H - pad.t - pad.b) * (1 - v / top);
  const bw = (W - pad.l - pad.r) / perDay.length;
  const today = BB.dayKey();
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
  svg.setAttribute('class', 'chart');
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', 'Minutes played per day');
  const add = (tag, attrs, text) => {
    const n = document.createElementNS(ns, tag);
    for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
    if (text != null) n.textContent = text;
    svg.append(n);
    return n;
  };
  for (let v = 0; v <= top; v += stepH) {
    add('line', { x1: pad.l, x2: W - pad.r, y1: y(v), y2: y(v), class: 'grid-line' });
    add('text', { x: pad.l - 6, y: y(v) + 4, 'text-anchor': 'end' }, v === 0 ? '0' : duration(v));
  }
  const every = perDay.length > 16 ? Math.ceil(perDay.length / 10) : 1;
  perDay.forEach((d, i) => {
    const x = pad.l + i * bw + bw * 0.18;
    const h = (H - pad.t - pad.b) * (d.minutes / top);
    const bar = add('rect', { x, y: y(d.minutes), width: bw * 0.64, height: Math.max(h, d.minutes ? 2 : 0), rx: 3, class: `bar${d.day === today ? ' today' : ''}` });
    const t = document.createElementNS(ns, 'title');
    t.textContent = `${d.day}: ${duration(d.minutes)}`;
    bar.append(t);
    if (i % every === 0 || i === perDay.length - 1) {
      const date = new Date(`${d.day}T12:00:00`);
      add('text', { x: x + bw * 0.32, y: H - 8, 'text-anchor': 'middle' }, perDay.length <= 7 ? date.toLocaleDateString(undefined, { weekday: 'short' }) : `${date.getDate()}/${date.getMonth() + 1}`);
    }
  });
  return svg;
}

async function topGamesList(top, limit) {
  if (!top.length) return el('p', { class: 'empty', text: 'No games tracked yet. Play something with your browser open.' });
  const shown = top.slice(0, limit);
  const icons = await BB.gameIcons(shown.map(g => g.universeId)).catch(() => new Map());
  const max = shown[0].minutes;
  return el('div', { class: 'list' }, shown.map(g => el('div', { class: 'item' },
    img('icon', icons.get(g.universeId)),
    el('div', { class: 'grow' },
      el('div', { class: 'row' },
        g.placeId ? el('a', { class: 'item-title ellipsis grow', href: gameUrl(g.placeId), target: '_blank', text: g.name || `Game ${g.universeId}` })
          : el('span', { class: 'item-title ellipsis grow', text: g.name || `Game ${g.universeId}` }),
        el('span', { class: 'num muted', text: duration(g.minutes) })),
      el('div', { class: 'bar-track' }, el('i', { style: { width: `${Math.max(3, (g.minutes / max) * 100)}%` } }))),
    g.placeId && el('a', { class: 'btn sm ghost', href: BB.joinUrl(g.placeId), text: 'Play' }))));
}

// ---------- pages ----------

const pages = {};

pages.home = async (root) => {
  root.append(pageHead('Home', 'Your Roblox at a glance.'));
  const me = await BB.me();
  const [shot, robux, premium, settings, week, current, inbound, value] = await Promise.all([
    BB.headshots([me.id], '150x150').then(m => m.get(me.id)).catch(() => null),
    api(`https://economy.roblox.com/v1/users/${me.id}/currency`).then(r => r.robux).catch(() => null),
    api(`https://premiumfeatures.roblox.com/v1/users/${me.id}/validate-membership`).catch(() => null),
    BB.settings(),
    playtimeSummary(daysBack(7)),
    BB.get('currentGame'),
    api('https://trades.roblox.com/v1/trades/Inbound/count').then(r => r.count).catch(() => null),
    BB.playerValue(me.id).catch(() => null),
  ]);
  const today = week.perDay[week.perDay.length - 1].minutes;
  const games = await BB.get('games', {});

  root.append(el('div', { class: 'grid' },
    el('section', { class: 'card row wrap' },
      img('avatar lg', shot),
      el('div', { class: 'grow' },
        el('div', { class: 'row wrap' }, el('h2', { style: { margin: 0, fontSize: '20px' }, text: me.displayName }), premium === true && el('span', { class: 'badge accent', text: 'Premium' })),
        el('a', { class: 'muted', href: profileUrl(me.id), target: '_blank', text: `@${me.name}` }),
        current?.universeId && el('p', { class: 'small good', text: `Playing ${games[current.universeId]?.name || 'a game'} now` })),
      el('div', { class: 'row' }, el('a', { class: 'btn ghost', href: 'https://www.roblox.com/home', target: '_blank', text: 'Open Roblox' }))),
    el('div', { class: 'kpis' },
      kpi('Robux', robux == null ? '–' : num(robux)),
      kpi('Played today', duration(today), settings.trackPlaytime ? null : 'Tracking is off'),
      kpi('Played this week', duration(week.total)),
      kpi('Inbound trades', inbound == null ? '–' : String(inbound)),
      kpi('Limiteds value', value?.value != null ? num(value.value) : '–', value?.rap != null ? `RAP ${num(value.rap)}` : null)),
    el('div', { class: 'grid cols-2' },
      card('This week', barChart(week.perDay)),
      card('Most played this week', await topGamesList(week.top, 5))),
  ));

  // Friends online loads last; it's the slowest call.
  const friendsCard = card('Friends playing now', loading('Loading friends'));
  root.querySelector('.cols-2').append(friendsCard);
  try {
    const friends = await loadFriends(me.id);
    const playing = friends.filter(f => f.p?.userPresenceType === 2).slice(0, 8);
    friendsCard.lastChild.replaceWith(playing.length ? friendList(playing) : el('p', { class: 'empty', text: 'None of your friends are in a game right now.' }));
  } catch (e) {
    friendsCard.lastChild.replaceWith(errorBox(e));
  }
};

pages.playtime = async (root) => {
  let range = 14;
  const body = el('div', { class: 'grid' });
  root.append(pageHead('Playtime', 'Counted every minute while your browser is open.',
    seg([[7, '7 days'], [14, '14 days'], [30, '30 days'], [90, '90 days']], range, (v) => { range = v; draw(); })), body);

  async function draw() {
    body.replaceChildren(loading('Crunching'));
    const s = await playtimeSummary(daysBack(range));
    const active = s.perDay.filter(d => d.minutes > 0);
    const best = active.reduce((a, b) => (b.minutes > (a?.minutes || 0) ? b : a), null);
    body.replaceChildren(
      el('div', { class: 'kpis' },
        kpi('Total', duration(s.total)),
        kpi('Daily average', duration(s.total / range)),
        kpi('Days played', `${active.length}/${range}`),
        kpi('Biggest day', best ? duration(best.minutes) : '–', best ? new Date(`${best.day}T12:00:00`).toLocaleDateString() : null),
        kpi('Games played', String(s.top.length))),
      card('Per day', barChart(s.perDay, 900, 260)),
      card('Games', await topGamesList(s.top, 25)));
  }
  await draw();
};

async function loadFriends(userId) {
  const ids = [];
  let cursor = '';
  do {
    const page = await api(`https://friends.roblox.com/v1/users/${userId}/friends/find?limit=50${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`);
    for (const f of page.PageItems || []) ids.push(f.id);
    cursor = page.NextCursor;
  } while (cursor && ids.length < 1000);
  const [users, pres, shots] = await Promise.all([BB.users(ids), BB.presence(ids), BB.headshots(ids)]);
  return ids.map(id => ({ id, u: users.get(id), p: pres.get(id), shot: shots.get(id) }));
}

const STATUS = ['Offline', 'Online', 'In game', 'In Studio', 'Invisible'];

function friendList(friends) {
  return el('div', { class: 'list' }, friends.map(({ id, u, p, shot }) => el('div', { class: 'item' },
    img('avatar', shot),
    el('div', { class: 'grow' },
      el('a', { class: 'item-title ellipsis', href: profileUrl(id), target: '_blank', text: u?.displayName || `User ${id}`, style: { display: 'block' } }),
      el('div', { class: 'small muted ellipsis' }, `@${u?.name || id}`, p?.userPresenceType >= 1 ? ` · ${p.userPresenceType === 2 && p.lastLocation ? p.lastLocation : STATUS[p.userPresenceType]}` : '')),
    p?.userPresenceType === 2 && p.placeId
      ? el('a', { class: 'btn sm', href: BB.joinUrl(p.placeId, p.gameId), text: p.gameId ? 'Join' : 'Play game' })
      : el('span', { class: `badge${p?.userPresenceType === 1 ? ' good' : ''}`, text: STATUS[p?.userPresenceType ?? 0] }))));
}

pages.friends = async (root) => {
  const filter = el('input', { class: 'input', placeholder: 'Filter friends', type: 'search' });
  const refresh = el('button', { class: 'btn ghost', type: 'button', text: 'Refresh', onclick: () => route(true) });
  root.append(pageHead('Friends', 'Who\'s online and what they\'re playing.', filter, refresh));
  const body = el('div', {}, loading('Loading friends'));
  root.append(body);

  const me = await BB.me();
  const all = await loadFriends(me.id);
  const order = f => [2, 3, 1, 0, 4].indexOf(f.p?.userPresenceType ?? 0);
  all.sort((a, b) => order(a) - order(b) || (a.u?.displayName || '').localeCompare(b.u?.displayName || ''));

  function draw() {
    const q = filter.value.trim().toLowerCase();
    const list = q ? all.filter(f => `${f.u?.displayName} ${f.u?.name} ${f.p?.lastLocation || ''}`.toLowerCase().includes(q)) : all;
    const groups = [
      ['In a game', list.filter(f => f.p?.userPresenceType === 2)],
      ['Online', list.filter(f => [1, 3].includes(f.p?.userPresenceType))],
      ['Offline', list.filter(f => !f.p || [0, 4].includes(f.p.userPresenceType))],
    ];
    body.replaceChildren(
      el('div', { class: 'kpis', style: { marginBottom: '16px' } },
        kpi('Friends', String(all.length)),
        kpi('In a game', String(all.filter(f => f.p?.userPresenceType === 2).length)),
        kpi('Online', String(all.filter(f => [1, 2, 3].includes(f.p?.userPresenceType)).length))),
      el('div', { class: 'grid cols-2' }, groups.filter(([, g]) => g.length).map(([title, g]) => card(`${title} · ${g.length}`, friendList(g)))));
    if (!list.length) body.append(el('p', { class: 'empty', text: 'No friends match that filter.' }));
  }
  filter.oninput = draw;
  draw();
};

// ---------- trades ----------

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
    value += BB.itemWorth(row) || it.rap || 0;
    rap += row ? Math.max(row[2], 0) : (it.rap || 0);
  }
  return { value, rap, robux: side.robux };
}

pages.trades = async (root) => {
  let kind = 'Inbound';
  const body = el('div', { class: 'card' });
  root.append(pageHead('Trades', 'Values from Rolimons. Robux counts at 70% after Roblox\'s cut.',
    seg([['Inbound', 'Inbound'], ['Outbound', 'Outbound'], ['Completed', 'Completed'], ['Inactive', 'Inactive']], kind, (v) => { kind = v; draw(); }),
    el('a', { class: 'btn ghost', href: 'https://www.roblox.com/trades', target: '_blank', text: 'Open on Roblox' })), body);

  const [me, values] = await Promise.all([BB.me(), BB.values().catch(() => ({}))]);
  let token = 0;

  async function draw() {
    const mine = ++token;
    body.replaceChildren(loading(`Loading ${kind.toLowerCase()} trades`));
    try {
      const { data } = await api(`https://trades.roblox.com/v1/trades/${kind}?limit=25&sortOrder=Desc`);
      if (mine !== token) return;
      if (!data?.length) return body.replaceChildren(el('p', { class: 'empty', text: `No ${kind.toLowerCase()} trades.` }));
      const shots = await BB.headshots(data.map(t => t.user.id)).catch(() => new Map());
      const rows = data.map(t => tradeRow(t, shots.get(t.user.id)));
      body.replaceChildren(...rows.map(r => r.node));
      // Prefetch values for the first few, gently.
      await BB.pool(rows.slice(0, 8), 2, r => r.load());
    } catch (e) {
      if (mine === token) body.replaceChildren(errorBox(e));
    }
  }

  function tradeRow(t, shot) {
    const verdict = el('span', { class: 'badge', text: '…' });
    const sums = el('span', { class: 'small muted num', text: 'Click to load values' });
    const details = el('div', { class: 'trade-body', hidden: true });
    let loaded = null;

    const load = () => loaded ??= (async () => {
      try {
        const sides = await tradeDetails(t.id);
        const mySide = sides.find(s => s.user?.id === me.id) || sides[0];
        const theirSide = sides.find(s => s !== mySide) || sides[1];
        const give = sideWorth(mySide, values);
        const get = sideWorth(theirSide, values);
        const giveTotal = give.value + give.robux * 0.7;
        const getTotal = get.value + get.robux * 0.7;
        const diff = getTotal - giveTotal;
        const pct = giveTotal ? (diff / giveTotal) * 100 : 0;
        verdict.className = `badge ${diff > 0 ? 'good' : diff < 0 ? 'bad' : ''}`;
        verdict.textContent = `${diff > 0 ? '+' : ''}${num(Math.round(diff))} (${pct > 0 ? '+' : ''}${pct.toFixed(0)}%)`;
        sums.textContent = `You give ${num(Math.round(giveTotal))} · you get ${num(Math.round(getTotal))}`;

        const thumbs = await BB.itemThumbs([...mySide.items, ...theirSide.items].map(i => i.assetId)).catch(() => new Map());
        const col = (title, side, worth) => el('div', { class: 'side-col' },
          el('h3', { text: title }),
          el('div', { class: 'list' }, side.items.map((it) => {
            const row = values[it.assetId];
            return el('div', { class: 'item' },
              img('thumb', thumbs.get(it.assetId)),
              el('div', { class: 'grow' },
                el('a', { class: 'item-title ellipsis', style: { display: 'block' }, href: itemUrl(it.assetId), target: '_blank', text: it.name || row?.[0] || `Item ${it.assetId}` }),
                el('div', { class: 'small muted num' }, `Value ${row?.[3] > 0 ? num(row[3]) : '–'} · RAP ${num(row ? row[2] : it.rap)}`, row?.[7] === 1 ? ' · ' : '', row?.[7] === 1 ? el('span', { class: 'bad', text: 'Projected' }) : null)),
              it.serial ? el('span', { class: 'badge', text: `#${it.serial}` }) : null);
          }), side.robux ? el('div', { class: 'item' }, el('span', { class: 'grow', text: `${num(side.robux)} Robux` }), el('span', { class: 'small muted', text: `≈ ${num(Math.round(side.robux * 0.7))} after tax` })) : null),
          el('div', { class: 'side-total' }, el('span', { text: 'Total' }), el('span', { class: 'num', text: num(Math.round(worth.value + worth.robux * 0.7)) })));
        details.replaceChildren(col('You give', mySide, give), col('You get', theirSide, get));
      } catch (e) {
        verdict.textContent = 'Error';
        sums.textContent = e.message;
        details.replaceChildren(errorBox(e));
      }
    })();

    const node = el('div', { class: 'trade' },
      el('div', { class: 'trade-summary', role: 'button', tabindex: '0', onclick: () => { details.hidden = !details.hidden; load(); }, onkeydown: (e) => { if (e.key === 'Enter') { details.hidden = !details.hidden; load(); } } },
        img('avatar', shot),
        el('div', { class: 'grow' },
          el('div', { class: 'item-title ellipsis', text: `${t.user.displayName} (@${t.user.name})` }),
          sums),
        el('span', { class: 'small muted', text: new Date(t.created).toLocaleDateString() }),
        verdict),
      details);
    return { node, load };
  }

  await draw();
};

// ---------- items ----------

pages.items = async (root) => {
  const search = el('input', { class: 'input', type: 'search', placeholder: 'Search by name or acronym' });
  const sort = el('select', { class: 'input' },
    el('option', { value: 'value', text: 'Highest value' }),
    el('option', { value: 'rap', text: 'Highest RAP' }),
    el('option', { value: 'demand', text: 'Best demand' }),
    el('option', { value: 'name', text: 'Name' }));
  root.append(pageHead('Items & values', 'All limiteds with Rolimons values, plus your own inventory.', search, sort));

  const invCard = card('Your limiteds', loading('Loading your inventory'));
  const tableCard = card(null, loading('Loading values'));
  root.append(el('div', { class: 'grid' }, invCard, tableCard));

  const [me, values] = await Promise.all([BB.me(), BB.values()]);
  if (values?.error) throw new Error(values.error);
  const all = Object.entries(values).map(([id, r]) => ({ id: Number(id), name: r[0], acr: r[1], rap: r[2], value: r[3], demand: r[5], trend: r[6], projected: r[7] === 1, hyped: r[8] === 1, rare: r[9] === 1 }));

  async function drawTable() {
    const q = search.value.trim().toLowerCase();
    let list = q ? all.filter(i => i.name.toLowerCase().includes(q) || (i.acr && i.acr.toLowerCase() === q)) : all;
    const by = {
      value: (a, b) => (BB.itemWorth([0, 0, b.rap, b.value]) - BB.itemWorth([0, 0, a.rap, a.value])),
      rap: (a, b) => b.rap - a.rap,
      demand: (a, b) => b.demand - a.demand || b.value - a.value,
      name: (a, b) => a.name.localeCompare(b.name),
    }[sort.value];
    list = list.slice().sort(by);
    const shown = list.slice(0, 60);
    const thumbs = await BB.itemThumbs(shown.map(i => i.id)).catch(() => new Map());
    tableCard.replaceChildren(
      el('div', { class: 'card-head' }, el('h2', { text: q ? `${list.length} matches` : `${all.length.toLocaleString()} limiteds` }), el('span', { class: 'small muted', text: list.length > 60 ? 'Showing top 60' : '' })),
      el('div', { class: 'table-wrap' }, el('table', {},
        el('thead', {}, el('tr', {}, el('th', { text: 'Item' }), el('th', { class: 'r', text: 'Value' }), el('th', { class: 'r', text: 'RAP' }), el('th', { text: 'Demand' }), el('th', { text: 'Flags' }))),
        el('tbody', {}, shown.map(i => el('tr', {},
          el('td', {}, el('div', { class: 'row' }, img('thumb', thumbs.get(i.id)), el('div', { class: 'grow' }, el('a', { class: 'item-title', href: itemUrl(i.id), target: '_blank', text: i.name }), i.acr ? el('div', { class: 'small muted', text: i.acr }) : null))),
          el('td', { class: 'r', text: i.value > 0 ? num(i.value) : '–' }),
          el('td', { class: 'r', text: num(i.rap) }),
          el('td', {}, i.demand >= 0 ? el('span', { class: `badge${i.demand >= 3 ? ' good' : i.demand <= 0 ? ' bad' : ''}`, text: BB.DEMAND[i.demand] }) : el('span', { class: 'muted', text: '–' })),
          el('td', {}, el('div', { class: 'row wrap', style: { gap: '4px' } },
            i.projected && el('span', { class: 'badge bad', text: 'Projected' }),
            i.hyped && el('span', { class: 'badge warn', text: 'Hyped' }),
            i.rare && el('span', { class: 'badge accent', text: 'Rare' })))))))));
  }
  let t;
  search.oninput = () => { clearTimeout(t); t = setTimeout(drawTable, 200); };
  sort.onchange = drawTable;
  await drawTable();

  try {
    const inv = await collectibles(me.id);
    invCard.replaceChildren(...(await inventorySummary(inv, values)));
  } catch (e) {
    invCard.replaceChildren(el('h2', { text: 'Your limiteds' }), errorBox(e));
  }
};

async function collectibles(userId) {
  const out = [];
  let cursor = '';
  do {
    const page = await api(`https://inventory.roblox.com/v1/users/${userId}/assets/collectibles?limit=100&sortOrder=Asc${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`);
    out.push(...(page.data || []));
    cursor = page.nextPageCursor;
  } while (cursor && out.length < 5000);
  return out;
}

async function inventorySummary(inv, values, title = 'Your limiteds') {
  if (!inv.length) return [el('h2', { text: title }), el('p', { class: 'empty', text: 'No limiteds in this inventory.' })];
  const rows = inv.map(a => ({ ...a, worth: BB.itemWorth(values[a.assetId]) || a.recentAveragePrice || 0, row: values[a.assetId] }));
  rows.sort((a, b) => b.worth - a.worth);
  const total = rows.reduce((s, r) => s + r.worth, 0);
  const rap = rows.reduce((s, r) => s + (r.row ? Math.max(r.row[2], 0) : (r.recentAveragePrice || 0)), 0);
  const top = rows.slice(0, 6);
  const thumbs = await BB.itemThumbs(top.map(r => r.assetId)).catch(() => new Map());
  return [
    el('div', { class: 'card-head' }, el('h2', { text: title }), el('span', { class: 'small muted', text: `${rows.length} items` })),
    el('div', { class: 'kpis', style: { marginBottom: '14px' } }, kpi('Value', num(total)), kpi('RAP', num(rap)), kpi('Best item', num(top[0].worth), top[0].name)),
    el('div', { class: 'list' }, top.map(r => el('div', { class: 'item' },
      img('thumb', thumbs.get(r.assetId)),
      el('a', { class: 'item-title ellipsis grow', href: itemUrl(r.assetId), target: '_blank', text: r.name }),
      r.serialNumber ? el('span', { class: 'badge', text: `#${r.serialNumber}` }) : null,
      el('span', { class: 'num', text: num(r.worth) })))),
  ];
}

// ---------- lookup ----------

pages.lookup = async (root, arg) => {
  const input = el('input', { class: 'input', placeholder: 'Username or user ID', value: arg || '' });
  const go = el('button', { class: 'btn', type: 'submit', text: 'Look up' });
  const body = el('div', { class: 'grid' });
  root.append(pageHead('Player lookup', 'Everything public about a player in one place.',
    el('form', { class: 'row', onsubmit: (e) => { e.preventDefault(); location.hash = `lookup/${encodeURIComponent(input.value.trim())}`; } }, input, go)), body);
  if (!arg) {
    body.append(el('p', { class: 'empty', text: 'Type a username to start.' }));
    return;
  }

  body.append(loading('Looking up'));
  const user = await BB.resolveUser(decodeURIComponent(arg));
  if (!user) return body.replaceChildren(el('p', { class: 'empty', text: 'No player with that name or ID.' }));

  const count = path => api(`https://friends.roblox.com/v1/users/${user.id}/${path}`).then(r => r.count).catch(() => null);
  const [shot, pres, friends, followers, following, value, values] = await Promise.all([
    BB.headshots([user.id], '150x150').then(m => m.get(user.id)).catch(() => null),
    BB.presence([user.id]).then(m => m.get(user.id)).catch(() => null),
    count('friends/count'), count('followers/count'), count('followings/count'),
    BB.playerValue(user.id).catch(() => null),
    BB.values().catch(() => ({})),
  ]);
  const created = new Date(user.created);
  const years = ((Date.now() - created) / (365.25 * 86400000)).toFixed(1);

  body.replaceChildren(
    el('section', { class: 'card row wrap' },
      img('avatar lg', shot),
      el('div', { class: 'grow' },
        el('div', { class: 'row wrap' }, el('h2', { style: { margin: 0, fontSize: '20px' }, text: user.displayName }), user.hasVerifiedBadge && el('span', { class: 'badge accent', text: 'Verified' }), user.isBanned && el('span', { class: 'badge bad', text: 'Banned' })),
        el('div', { class: 'muted' }, `@${user.name} · ID ${user.id}`),
        el('div', { class: `small ${pres?.userPresenceType === 2 ? 'good' : 'muted'}`, text: pres ? (pres.userPresenceType === 2 && pres.lastLocation ? `Playing ${pres.lastLocation}` : STATUS[pres.userPresenceType]) : 'Status hidden' })),
      el('div', { class: 'row wrap' },
        pres?.userPresenceType === 2 && pres.placeId && el('a', { class: 'btn', href: BB.joinUrl(pres.placeId, pres.gameId), text: pres.gameId ? 'Join' : 'Play their game' }),
        el('a', { class: 'btn ghost', href: profileUrl(user.id), target: '_blank', text: 'Profile' }),
        el('a', { class: 'btn ghost', href: `https://www.rolimons.com/player/${user.id}`, target: '_blank', text: 'Rolimons' }))),
    el('div', { class: 'kpis' },
      kpi('Joined', created.toLocaleDateString(), `${years} years ago`),
      kpi('Friends', friends == null ? '–' : num(friends)),
      kpi('Followers', followers == null ? '–' : num(followers)),
      kpi('Following', following == null ? '–' : num(following)),
      kpi('Limiteds value', value?.value != null ? num(value.value) : '–', value?.rap != null ? `RAP ${num(value.rap)}` : (value?.privacy_enabled ? 'Inventory private' : null))),
    user.description ? card('About', el('p', { style: { whiteSpace: 'pre-wrap' }, text: user.description })) : null,
  );

  const invCard = card('Limiteds', loading('Loading inventory'));
  body.append(invCard);
  try {
    invCard.replaceChildren(...(await inventorySummary(await collectibles(user.id), values, 'Limiteds')));
  } catch (e) {
    invCard.replaceChildren(el('h2', { text: 'Limiteds' }), el('p', { class: 'empty', text: e.status === 403 ? 'This inventory is private.' : e.message }));
  }
};

// ---------- settings ----------

pages.settings = async (root) => {
  root.append(pageHead('Settings', 'Everything is stored only in this browser.'));
  const s = await BB.settings();
  const toggle = (key, title, sub) => el('label', { class: 'switch' },
    el('input', { type: 'checkbox', checked: s[key], onchange: async (e) => { s[key] = e.target.checked; await BB.set('settings', s); } }),
    el('div', {}, el('div', { class: 'item-title', text: title }), el('div', { class: 'small muted', text: sub })));

  const playtime = await BB.get('playtime', {});
  const days = Object.keys(playtime).length;

  root.append(el('div', { class: 'grid cols-2' },
    card('Features',
      toggle('trackPlaytime', 'Track playtime', 'Checks your status once a minute while the browser is open.'),
      toggle('notifyTrades', 'Trade notifications', 'Desktop notification when a new trade request arrives.'),
      toggle('notifyFriends', 'Friend notifications', 'Notify when friends start playing a game.'),
      toggle('regionLookup', 'Server regions', 'Lets "Detect regions" ask Roblox where servers are. Uses ipwho.is for the location.')),
    card('Your data',
      el('p', { class: 'muted', text: `${days} day${days === 1 ? '' : 's'} of playtime saved.` }),
      el('div', { class: 'row wrap', style: { marginTop: '12px' } },
        el('button', { class: 'btn ghost', type: 'button', text: 'Export playtime', onclick: exportData }),
        el('button', { class: 'btn ghost', type: 'button', text: 'Clear value cache', onclick: async (e) => { await chrome.storage.local.remove(['valuesCache', 'geoCache']); e.target.textContent = 'Cleared'; } }),
        clearButton())),
  ));

  function clearButton() {
    let armed = false;
    const b = el('button', { class: 'btn ghost', type: 'button', text: 'Delete playtime…' });
    b.onclick = async () => {
      if (!armed) {
        armed = true;
        b.textContent = 'Click again to delete';
        b.classList.remove('ghost');
        setTimeout(() => { armed = false; b.textContent = 'Delete playtime…'; b.classList.add('ghost'); }, 4000);
        return;
      }
      await chrome.storage.local.remove(['playtime', 'games', 'currentGame']);
      route(true);
    };
    return b;
  }

  async function exportData() {
    const data = { exported: new Date().toISOString(), playtime: await BB.get('playtime', {}), games: await BB.get('games', {}) };
    const a = el('a', { href: URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })), download: `bloxboard-playtime-${BB.dayKey()}.json` });
    a.click();
  }
};

// ---------- router ----------

let routeToken = 0;
async function route(force) {
  const [name, ...rest] = (location.hash.slice(1) || 'home').split('/');
  const page = pages[name] ? name : 'home';
  for (const a of document.querySelectorAll('#nav a')) a.toggleAttribute('aria-current', a.dataset.route === page);
  for (const a of document.querySelectorAll('#nav a')) if (a.dataset.route === page) a.setAttribute('aria-current', 'page');
  const mine = ++routeToken;
  const root = el('div', {});
  main.replaceChildren(root);
  document.title = `${document.querySelector(`#nav a[data-route="${page}"]`).textContent} · Bloxboard`;
  try {
    await pages[page](root, rest.join('/'));
  } catch (e) {
    if (mine === routeToken) root.append(errorBox(e));
  }
  if (!force) main.focus({ preventScroll: true });
}

addEventListener('hashchange', () => route());
route();
