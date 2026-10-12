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

function sparkline(values) {
  const W = 84;
  const H = 22;
  const max = Math.max(1, ...values);
  const step = W / Math.max(1, values.length - 1);
  const pts = values.map((v, i) => `${(i * step).toFixed(1)},${(H - 2 - (v / max) * (H - 4)).toFixed(1)}`);
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
  svg.setAttribute('class', 'spark');
  svg.setAttribute('aria-hidden', 'true');
  const area = document.createElementNS(ns, 'polygon');
  area.setAttribute('points', `0,${H} ${pts.join(' ')} ${W},${H}`);
  area.setAttribute('class', 'spark-area');
  const line = document.createElementNS(ns, 'polyline');
  line.setAttribute('points', pts.join(' '));
  line.setAttribute('class', 'spark-line');
  svg.append(area, line);
  return svg;
}

async function topGamesList(top, limit, trendDays = 0) {
  if (!top.length) return el('p', { class: 'empty', text: 'No games tracked yet. Play something with your browser open.' });
  const shown = top.slice(0, limit);
  const icons = await BB.gameIcons(shown.map(g => g.universeId)).catch(() => new Map());
  const playtime = trendDays ? await BB.get('playtime', {}) : null;
  const days = trendDays ? daysBack(trendDays) : [];
  const max = shown[0].minutes;
  return el('div', { class: 'list' }, shown.map(g => el('div', { class: 'item' },
    img('icon', icons.get(g.universeId)),
    el('div', { class: 'grow' },
      el('div', { class: 'row' },
        g.placeId ? el('a', { class: 'item-title ellipsis grow', href: gameUrl(g.placeId), target: '_blank', text: g.name || `Game ${g.universeId}` })
          : el('span', { class: 'item-title ellipsis grow', text: g.name || `Game ${g.universeId}` }),
        el('span', { class: 'num muted', text: duration(g.minutes) })),
      el('div', { class: 'bar-track' }, el('i', { style: { width: `${Math.max(3, (g.minutes / max) * 100)}%` } }))),
    trendDays ? el('span', { class: 'spark-wrap', title: `Last ${trendDays} days` }, sparkline(days.map(d => playtime[d]?.[g.universeId] || 0))) : null,
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

  const recent = (await BB.get('recentServers', [])).slice(0, 6);
  if (recent.length) {
    const icons = await BB.gameIcons(recent.map(r => r.universeId)).catch(() => new Map());
    root.querySelector('.cols-2').append(card('Recent servers', el('div', { class: 'list' }, recent.map(r => el('div', { class: 'item' },
      img('icon', icons.get(r.universeId)),
      el('div', { class: 'grow' },
        el('div', { class: 'item-title ellipsis', text: r.name }),
        el('div', { class: 'small muted', text: `Left ${BB.ago(r.lastSeen)} · ${duration(r.minutes)} in this server` })),
      el('a', { class: 'btn sm ghost', href: BB.joinUrl(r.placeId, r.gameId), text: 'Rejoin' }))))));
  }

  const alerts = (await BB.get('notifyLog', [])).slice(0, 6);
  if (alerts.length) {
    root.querySelector('.cols-2').append(card('Recent alerts', el('div', { class: 'list' }, alerts.map(a => el('div', { class: 'item' },
      el('div', { class: 'grow' }, el('div', { class: 'item-title ellipsis', text: a.title }), el('div', { class: 'small muted', style: { whiteSpace: 'pre-line' }, text: a.message })),
      el('span', { class: 'small muted', text: BB.ago(a.at) }))))));
  }

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
      el('div', { class: 'grid cols-2' }, await streakCard(), await heatmapCard()),
      card('Games', await topGamesList(s.top, 25, 14)));
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
  const log = await BB.get('friendLog', []);
  const changes = card('Friend changes', log.length
    ? el('div', { class: 'list' }, log.slice(0, 12).map(x => el('div', { class: 'item' },
      el('span', { class: `badge ${x.type === 'added' ? 'good' : 'bad'}`, text: x.type === 'added' ? 'Added' : 'Removed' }),
      el('a', { class: 'grow ellipsis item-title', href: profileUrl(x.id), target: '_blank', text: x.name ? `${x.name} (@${x.username})` : `User ${x.id}` }),
      el('span', { class: 'small muted', text: BB.ago(x.at) }))))
    : el('p', { class: 'small muted', text: 'Bloxboard checks your friend list every 30 minutes. New friends and unfriends show up here.' }));
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
      el('div', { class: 'grid cols-2' }, changes, groups.filter(([, g]) => g.length).map(([title, g]) => card(`${title} · ${g.length}`, friendList(g)))));
    if (!list.length) body.append(el('p', { class: 'empty', text: 'No friends match that filter.' }));
  }
  filter.oninput = draw;
  draw();
};

// ---------- trades ----------

pages.trades = async (root) => {
  let kind = 'Inbound';
  const body = el('div', { class: 'card' });
  root.append(pageHead('Trades', 'Values from Rolimons. Robux counts at 70% after Roblox\'s cut.',
    seg([['Inbound', 'Inbound'], ['Outbound', 'Outbound'], ['Completed', 'Completed'], ['Inactive', 'Inactive']], kind, (v) => { kind = v; draw(); }),
    el('a', { class: 'btn ghost', href: 'https://www.roblox.com/trades', target: '_blank', text: 'Open on Roblox' })), body);

  const [me, values] = await Promise.all([BB.me(), BB.values().catch(() => ({}))]);
  const declined = await BB.get('autoDeclined', []);
  if (declined.length) {
    root.append(el('div', { style: { marginTop: '16px' } }, card(`Auto-declined · ${declined.length}`, el('div', { class: 'list' }, declined.slice(0, 8).map(d => el('div', { class: 'item' },
      el('span', { class: 'grow', text: `${d.user}: you'd give ${num(Math.round(d.give))} for ${num(Math.round(d.get))}` }),
      el('span', { class: 'badge bad', text: `${d.pct}%` }),
      el('span', { class: 'small muted', text: BB.ago(d.at) })))))));
  }
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
      if (kind !== 'Completed') {
        // Prefetch values for the first few, gently.
        await BB.pool(rows.slice(0, 8), 2, r => r.load());
        return;
      }
      // Completed: work out every trade so we can total the profit.
      const summary = el('p', { class: 'small muted', style: { padding: '4px 4px 12px' }, text: `Working out ${rows.length} completed trades…` });
      body.prepend(summary);
      const results = await BB.pool(rows, 2, r => r.load());
      const diffs = results.filter(d => typeof d === 'number');
      const timeline = data.map((t, i) => ({ at: new Date(t.created), diff: results[i] })).filter(x => typeof x.diff === 'number').sort((a, b) => a.at - b.at);
      if (mine !== token) return;
      const net = diffs.reduce((a, b) => a + b, 0);
      const wins = diffs.filter(d => d > 0).length;
      summary.replaceWith(el('div', { class: 'kpis', style: { marginBottom: '12px' } },
        kpi('Net profit', `${net >= 0 ? '+' : '−'}${num(Math.abs(Math.round(net)))}`, `last ${diffs.length} trades, at today's values`),
        kpi('Wins', `${wins}/${diffs.length}`),
        kpi('Best trade', diffs.length ? `+${num(Math.round(Math.max(0, ...diffs)))}` : '–'),
        kpi('Worst trade', diffs.length ? `−${num(Math.round(Math.abs(Math.min(0, ...diffs))))}` : '–')));
      if (timeline.length >= 2) body.querySelector('.kpis').after(el('div', { style: { marginBottom: '12px' } }, profitChart(timeline)));
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
        const sides = await BB.tradeDetails(t.id);
        const mySide = sides.find(s => s.user?.id === me.id) || sides[0];
        const theirSide = sides.find(s => s !== mySide) || sides[1];
        const give = BB.sideWorth(mySide, values);
        const get = BB.sideWorth(theirSide, values);
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
        return diff;
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

function profitChart(timeline) {
  const W = 900;
  const H = 200;
  const pad = { l: 56, r: 12, t: 12, b: 26 };
  let run = 0;
  const pts = timeline.map(x => ({ at: x.at, v: (run += x.diff) }));
  const lo = Math.min(0, ...pts.map(p => p.v));
  const hi = Math.max(0, ...pts.map(p => p.v));
  const span = hi - lo || 1;
  const t0 = pts[0].at.getTime();
  const t1 = pts[pts.length - 1].at.getTime() || t0 + 1;
  const x = t => pad.l + (W - pad.l - pad.r) * ((t - t0) / Math.max(1, t1 - t0));
  const y = v => pad.t + (H - pad.t - pad.b) * (1 - (v - lo) / span);
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
  svg.setAttribute('class', 'chart');
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', 'Running profit from completed trades');
  const add = (tag, attrs, text) => {
    const n = document.createElementNS(ns, tag);
    for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
    if (text != null) n.textContent = text;
    svg.append(n);
    return n;
  };
  for (const v of [lo, 0, hi].filter((v, i, a) => a.indexOf(v) === i)) {
    add('line', { x1: pad.l, x2: W - pad.r, y1: y(v), y2: y(v), class: 'grid-line' });
    add('text', { x: pad.l - 6, y: y(v) + 4, 'text-anchor': 'end' }, `${v > 0 ? '+' : v < 0 ? '−' : ''}${num(Math.abs(Math.round(v)))}`);
  }
  const d = pts.map((p, i) => `${i ? 'L' : 'M'}${x(p.at.getTime()).toFixed(1)},${y(p.v).toFixed(1)}`).join(' ');
  add('path', { d, class: 'profit-line', fill: 'none' });
  pts.forEach((p) => {
    const c = add('circle', { cx: x(p.at.getTime()), cy: y(p.v), r: 3.5, class: p.v >= 0 ? 'profit-dot' : 'profit-dot neg' });
    const t = document.createElementNS(ns, 'title');
    t.textContent = `${p.at.toLocaleDateString()}: ${p.v >= 0 ? '+' : '−'}${num(Math.abs(Math.round(p.v)))} total`;
    c.append(t);
  });
  add('text', { x: pad.l, y: H - 6, 'text-anchor': 'start' }, pts[0].at.toLocaleDateString());
  add('text', { x: W - pad.r, y: H - 6, 'text-anchor': 'end' }, pts[pts.length - 1].at.toLocaleDateString());
  return svg;
}

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
  );
  if (user.description) body.append(card('About', el('p', { style: { whiteSpace: 'pre-wrap' }, text: user.description })));
  const note = (await BB.get('notes', {}))[user.id];
  if (note) body.append(card('Your note', el('p', { style: { whiteSpace: 'pre-wrap' }, text: note }), el('p', { class: 'small muted', style: { marginTop: '6px' }, text: 'Edit it on their Roblox profile.' })));

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

  const numberSetting = (key, label, unit) => el('label', { class: 'switch' },
    el('div', { class: 'grow' }, el('div', { class: 'item-title', text: label })),
    el('input', { class: 'input', type: 'number', min: '1', max: '100', value: String(s[key]), style: { width: '80px' }, onchange: async (e) => {
      const v = Math.min(100, Math.max(1, Number(e.target.value) || BB.DEFAULT_SETTINGS[key]));
      e.target.value = String(v);
      s[key] = v;
      await BB.set('settings', s);
    } }),
    el('span', { class: 'muted', text: unit }));

  const diagBox = el('div', { class: 'list', style: { marginTop: '8px' } });
  async function runDiagnostics(e) {
    e.target.disabled = true;
    diagBox.replaceChildren();
    const lines = [];
    const check = async (name, fn) => {
      const row = el('div', { class: 'item' }, el('span', { class: 'badge', text: '…' }), el('span', { class: 'grow', text: name }), el('span', { class: 'small muted' }));
      diagBox.append(row);
      const t = performance.now();
      try {
        const detail = await fn();
        row.children[0].className = 'badge good';
        row.children[0].textContent = 'OK';
        row.children[2].textContent = `${detail ?? ''} · ${Math.round(performance.now() - t)} ms`;
        lines.push(`OK    ${name}  ${detail ?? ''}`);
      } catch (err) {
        row.children[0].className = 'badge bad';
        row.children[0].textContent = 'Fail';
        row.children[2].textContent = err.message;
        lines.push(`FAIL  ${name}  ${err.message}`);
      }
    };
    let me = null;
    await check('Logged in', async () => { me = await BB.me(); return `@${me.name}`; });
    if (me) {
      await check('Robux balance', async () => `${(await api(`https://economy.roblox.com/v1/users/${me.id}/currency`)).robux} R$`);
      await check('Online status', async () => STATUS[(await BB.presence([me.id])).get(me.id)?.userPresenceType ?? 0]);
      await check('Friends list', async () => `${(await BB.friendIds(me.id, 200)).length} friends`);
      await check('Trades', async () => `${(await api('https://trades.roblox.com/v1/trades/Inbound/count')).count} inbound`);
      await check('Robux history', async () => { await api(`https://economy.roblox.com/v2/users/${me.id}/transaction-totals?timeFrame=Week&transactionType=summary`); return 'reachable'; });
      await check('Avatar renderer', async () => { const def = await myAvatar(me.id); await renderAvatar(def); return 'rendered'; });
    }
    let homeOutline = '';
    await check('Most played row (last home visit)', async () => {
      const h = await BB.get('homeDebug', null);
      if (!h) throw new Error('no report yet: open roblox.com/home, wait 10 seconds, then run this again');
      homeOutline = `\nHome page report (v${h.v}, ${new Date(h.at).toLocaleString()}): where=${h.where} visible=${h.visible} size=${h.size} removals=${h.removals} failed=${h.failed.join(',') || '-'}\n${h.outline}`;
      if (!h.visible) throw new Error(`not visible (${h.where}, removed ${h.removals}x) · ${BB.ago(h.at)}`);
      return `${h.where} · ${BB.ago(h.at)}`;
    });
    await check('Item values (Rolimons)', async () => `${Object.keys(await BB.values()).length} items`);
    let server = null;
    await check('Server list', async () => {
      const page = await api('https://games.roblox.com/v1/games/920587237/servers/Public?limit=10');
      server = page.data?.find(x => x.playing < x.maxPlayers);
      return `${page.data?.length || 0} servers, ${page.data?.reduce((a, x) => a + (x.playerTokens?.length || 0), 0)} player tokens`;
    });
    if (server && me) await check('Server region', async () => {
      const r = await chrome.runtime.sendMessage({ type: 'regions', placeId: '920587237', gameIds: [server.id] });
      if (r?.error) throw new Error(r.error);
      const v = r?.[server.id];
      if (!v?.city) throw new Error(`no address from Roblox (status ${v?.status ?? '?'})`);
      return `${v.city}, ${v.cc}`;
    });
    diagBox.append(el('button', { class: 'btn ghost sm', type: 'button', style: { marginTop: '8px' }, text: 'Copy result', onclick: async (ev) => {
      try { await navigator.clipboard.writeText(`Bloxboard ${chrome.runtime.getManifest().version} diagnostics\n${lines.join('\n')}${homeOutline}`); ev.target.textContent = 'Copied'; } catch { ev.target.textContent = 'Copy failed'; }
    } }));
    e.target.disabled = false;
  }

  const errors = await BB.get('errorLog', []);
  const errorText = errors.map(x => `${new Date(x.at).toISOString()}  ${x.where}  ${x.message}${x.page ? `  (${x.page})` : ''}`).join('\n');
  const errorList = el('div', {},
    el('p', { class: 'small muted', text: errors.length ? `The last ${errors.length} errors Bloxboard ran into. Copy them when something breaks.` : 'No errors logged. Nice.' }),
    errors.length ? el('pre', { class: 'errlog', text: errorText }) : null,
    errors.length ? el('div', { class: 'row', style: { marginTop: '10px' } },
      el('button', { class: 'btn ghost', type: 'button', text: 'Copy', onclick: async (e) => { try { await navigator.clipboard.writeText(errorText); e.target.textContent = 'Copied'; } catch { e.target.textContent = 'Copy failed'; } } }),
      el('button', { class: 'btn ghost', type: 'button', text: 'Clear', onclick: async () => { await chrome.storage.local.remove('errorLog'); route(true); } })) : null);

  const playtime = await BB.get('playtime', {});
  const days = Object.keys(playtime).length;

  // Windows companion link
  const compStatus = el('div', { class: 'row wrap', style: { gap: '8px' } });
  const compBtn = el('button', { class: 'btn', type: 'button' });
  async function drawCompanion() {
    const st = await BB.get('companionStatus', null);
    const on = (await BB.settings()).companionLink;
    compStatus.replaceChildren(
      el('span', { class: `badge ${st?.connected ? 'good' : on ? 'warn' : ''}`, text: st?.connected ? 'Linked' : on ? 'Waiting for the companion' : 'Off' }),
      el('span', { class: 'small muted', text: st?.connected ? 'The companion can use regions, friends online and the player finder.' : on ? 'Start Bloxboard Companion on your PC; it links within a few seconds.' : '' }));
    compBtn.textContent = on ? 'Unlink' : 'Link';
    compBtn.className = on ? 'btn ghost' : 'btn';
  }
  compBtn.onclick = async () => {
    const cur = await BB.settings();
    if (!cur.companionLink) {
      const ok = await chrome.permissions.request({ origins: ['http://127.0.0.1/*', 'ws://127.0.0.1/*'] }).catch(() => false);
      if (!ok) return;
      await BB.set('settings', { ...cur, companionLink: true });
      await chrome.runtime.sendMessage({ type: 'companionConnect' }).catch(() => {});
    } else {
      await BB.set('settings', { ...cur, companionLink: false });
      await chrome.runtime.sendMessage({ type: 'companionDisconnect' }).catch(() => {});
    }
    drawCompanion();
  };
  const compListener = (changes) => { if (changes.companionStatus) drawCompanion(); };
  chrome.storage.onChanged.addListener(compListener);
  drawCompanion();

  root.append(el('div', { class: 'grid cols-2' },
    card('Windows companion',
      el('p', { class: 'small muted', text: 'Bloxboard Companion runs next to the Roblox app on Windows. Linking lets it use your login here for server regions, friends online and the player finder, and adds its playtime to this dashboard. It only talks to 127.0.0.1 (your own PC).' }),
      el('div', { class: 'row wrap', style: { marginTop: '12px', justifyContent: 'space-between' } }, compStatus, compBtn),
      el('p', { class: 'small', style: { marginTop: '10px' } }, el('a', { href: 'https://bloxboard.enesserver.dev/companion.html', target: '_blank', rel: 'noopener', text: 'Get the companion' }))),
    card('Features',
      toggle('trackPlaytime', 'Track playtime', 'Checks your status once a minute while the browser is open.'),
      toggle('notifyTrades', 'Trade notifications', 'Desktop notification when a new trade request arrives.'),
      toggle('notifyFriends', 'Friend notifications', 'Notify when friends start playing a game.'),
      toggle('notifyGameUpdates', 'Game update notifications', 'Notify when one of your favorite games gets updated (checked every 30 minutes).'),
      toggle('regionLookup', 'Server regions', 'Lets "Detect regions" ask Roblox where servers are. Uses ipwho.is for the location.'),
      toggle('replaceServerList', 'Replace Roblox\'s server list', 'Hide Roblox\'s own public server list and filters on game pages; Bloxboard\'s list takes its place.'),
      toggle('homeMostPlayed', 'Most played on the Roblox home page', 'Adds a row with your most played games and your time in each.'),
      toggle('quickSearch', 'Quick search', 'Instant games, limiteds and players under Roblox\'s search box, with a Play button.'),
      toggle('gameCardPlaytime', 'Playtime on game cards', 'A small badge with your time played on game cards across roblox.com.'),
      el('label', { class: 'switch' },
        el('div', { class: 'grow' }, el('div', { class: 'item-title', text: 'roblox.com theme' }), el('div', { class: 'small muted', text: 'Recolors Roblox\'s pages: background, cards, header, buttons and links. Dark themes switch Roblox to dark mode, Sakura to light mode. Reload roblox.com after changing it.' })),
        el('select', { class: 'input', onchange: async (e) => { s.theme = e.target.value; await BB.set('settings', s); } },
          [['', 'Off'], ['midnight', 'Midnight'], ['ocean', 'Ocean'], ['forest', 'Forest'], ['grape', 'Grape'], ['sakura', 'Sakura']].map(([v, t]) => el('option', { value: v, text: t, selected: s.theme === v })))),
      el('p', { class: 'small muted', style: { marginTop: '8px' }, text: s.preferredRegion ? `Preferred region: ${s.preferredRegion}. Change it with the Region filter on any game page.` : 'Pick a region in the Region filter on a game page and it becomes your preferred region everywhere.' })),
    card('Trading',
      toggle('tradeWarn', 'Lowball warning', 'Asks before you send, counter or accept a trade that loses value or gets you projected items.'),
      numberSetting('tradeWarnPct', 'Warn when I lose more than', '%'),
      toggle('autoDecline', 'Auto-decline bad trades', 'Declines new inbound trades that lose more than the % below. It only ever declines; it never accepts or sends.'),
      numberSetting('autoDeclinePct', 'Auto-decline when I\'d lose more than', '%')),
    card('Problems',
      errorList,
      el('div', { style: { marginTop: '14px', paddingTop: '12px', borderTop: '1px solid var(--line)' } },
        el('div', { class: 'item-title', text: 'Diagnostics' }),
        el('p', { class: 'small muted', text: 'Checks every Roblox service Bloxboard uses. Run it when something doesn\'t work and send me the result.' }),
        diagBox,
        el('button', { class: 'btn', type: 'button', style: { marginTop: '10px' }, text: 'Run checks', onclick: runDiagnostics }))),
    card('Your data',
      el('p', { class: 'muted', text: `${days} day${days === 1 ? '' : 's'} of playtime saved.` }),
      el('div', { class: 'row wrap', style: { marginTop: '12px' } },
        el('button', { class: 'btn ghost', type: 'button', text: 'Export playtime', onclick: exportData }),
        el('button', { class: 'btn ghost', type: 'button', text: 'Export everything', onclick: exportAll }),
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

  async function exportAll() {
    const all = await chrome.storage.local.get(null);
    delete all.valuesCache; // big and re-downloadable
    const data = { exported: new Date().toISOString(), version: chrome.runtime.getManifest().version, ...all };
    const a = el('a', { href: URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })), download: `bloxboard-backup-${BB.dayKey()}.json` });
    a.click();
  }

  async function exportData() {
    const data = { exported: new Date().toISOString(), playtime: await BB.get('playtime', {}), games: await BB.get('games', {}) };
    const a = el('a', { href: URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })), download: `bloxboard-playtime-${BB.dayKey()}.json` });
    a.click();
  }
};


// ---------- playtime extras ----------

async function streakCard() {
  const playtime = await BB.get('playtime', {});
  const played = d => Object.values(playtime[d] || {}).some(m => m > 0);
  let current = 0;
  const d = new Date();
  if (!played(BB.dayKey(d))) d.setDate(d.getDate() - 1); // today not played yet: count up to yesterday
  while (played(BB.dayKey(d))) { current++; d.setDate(d.getDate() - 1); }
  const days = Object.keys(playtime).filter(played).sort();
  let longest = 0;
  let run = 0;
  let prev = null;
  for (const k of days) {
    const t = new Date(`${k}T12:00:00`);
    run = prev && Math.round((t - prev) / 86400000) === 1 ? run + 1 : 1;
    longest = Math.max(longest, run);
    prev = t;
  }
  return card('Streaks', el('div', { class: 'kpis' },
    kpi('Current streak', `${current} day${current === 1 ? '' : 's'}`),
    kpi('Longest streak', `${longest} day${longest === 1 ? '' : 's'}`),
    kpi('Days played', String(days.length), days.length ? `since ${new Date(`${days[0]}T12:00:00`).toLocaleDateString()}` : null)));
}

async function heatmapCard() {
  const hours = await BB.get('playHours', {});
  const max = Math.max(1, ...Object.values(hours));
  const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  const order = [1, 2, 3, 4, 5, 6, 0];
  const grid = el('div', { class: 'heat', role: 'img', 'aria-label': 'When you play, by weekday and hour' },
    el('span'), Array.from({ length: 24 }, (_, h) => el('span', { class: 'heat-h', text: h % 3 === 0 ? String(h) : '' })),
    order.map((wd, i) => [
      el('span', { class: 'heat-d', text: DAYS[i] }),
      Array.from({ length: 24 }, (_, h) => {
        const m = hours[`${wd}-${h}`] || 0;
        return el('span', { class: 'heat-c', title: `${DAYS[i]} ${h}:00: ${duration(m)}`, style: { opacity: m ? String(0.18 + 0.82 * (m / max)) : '1', background: m ? 'var(--accent)' : 'var(--sunk)' } });
      }),
    ]));
  const empty = !Object.keys(hours).length;
  return card('When you play', grid, el('p', { class: 'small muted', style: { marginTop: '8px' }, text: empty ? 'Fills up as you play. Counting started with version 0.3.' : 'Darker = more minutes played in that hour.' }));
}

// ---------- robux ----------

const TOTAL_LABELS = {
  salesTotal: 'Sales of your items',
  affiliateSalesTotal: 'Affiliate sales',
  groupPayoutsTotal: 'Group payouts',
  currencyPurchasesTotal: 'Robux bought',
  premiumStipendsTotal: 'Premium stipend',
  tradeSystemEarningsTotal: 'Trade earnings',
  premiumPayoutsTotal: 'Premium payouts (your games)',
  groupPremiumPayoutsTotal: 'Group premium payouts',
  adsRevsharePayoutsTotal: 'Ads revenue',
  purchasesTotal: 'Purchases',
  tradeSystemCostsTotal: 'Trade costs',
  adSpendTotal: 'Ad spend',
  developerExchangeTotal: 'DevEx',
  individualToGroupTotal: 'Sent to groups',
};
const PURCHASE_TYPES = { Asset: 'Item', GamePass: 'Game pass', DeveloperProduct: 'In-game purchase', PrivateServer: 'Private server', Bundle: 'Bundle' };

function monthBars(points, W = 520, H = 230) {
  const pad = { l: 46, r: 8, t: 10, b: 26 };
  const max = Math.max(10, ...points.map(p => p.value));
  const mag = 10 ** Math.floor(Math.log10(max));
  const step = [1, 2, 2.5, 5, 10].map(f => f * mag).find(st => max / st <= 5) || mag * 10;
  const top = Math.ceil(max / step) * step;
  const y = v => pad.t + (H - pad.t - pad.b) * (1 - v / top);
  const bw = (W - pad.l - pad.r) / points.length;
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
  svg.setAttribute('class', 'chart');
  svg.setAttribute('role', 'img');
  const add = (tag, attrs, text) => {
    const n = document.createElementNS(ns, tag);
    for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
    if (text != null) n.textContent = text;
    svg.append(n);
    return n;
  };
  for (let v = 0; v <= top; v += step) {
    add('line', { x1: pad.l, x2: W - pad.r, y1: y(v), y2: y(v), class: 'grid-line' });
    add('text', { x: pad.l - 6, y: y(v) + 4, 'text-anchor': 'end' }, num(v));
  }
  points.forEach((p, i) => {
    const x = pad.l + i * bw + bw * 0.18;
    const bar = add('rect', { x, y: y(p.value), width: bw * 0.64, height: Math.max((H - pad.t - pad.b) * (p.value / top), p.value ? 2 : 0), rx: 3, class: `bar${i === points.length - 1 ? ' today' : ''}` });
    const t = document.createElementNS(ns, 'title');
    t.textContent = `${p.label}: ${p.value.toLocaleString()} Robux`;
    bar.append(t);
    add('text', { x: x + bw * 0.32, y: H - 8, 'text-anchor': 'middle' }, p.short);
  });
  return svg;
}

async function transactions(userId, type, maxPages = 5) {
  const out = [];
  let cursor = '';
  for (let i = 0; i < maxPages; i++) {
    const page = await api(`https://economy.roblox.com/v2/users/${userId}/transactions?transactionType=${type}&limit=100${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`);
    out.push(...(page.data || []));
    cursor = page.nextPageCursor;
    if (!cursor) break;
    await BB.sleep(300);
  }
  return out;
}

pages.robux = async (root) => {
  let frame = 'Month';
  const totalsBox = el('div', { class: 'grid' }, loading('Loading totals'));
  root.append(pageHead('Robux', 'Where your Robux come from and where they go.',
    seg([['Day', 'Day'], ['Week', 'Week'], ['Month', 'Month'], ['Year', 'Year']], frame, (v) => { frame = v; drawTotals(); })), totalsBox);
  const me = await BB.me();
  const balance = await api(`https://economy.roblox.com/v1/users/${me.id}/currency`).then(r => r.robux).catch(() => null);

  async function drawTotals() {
    totalsBox.replaceChildren(loading('Loading totals'));
    try {
      const t = await api(`https://economy.roblox.com/v2/users/${me.id}/transaction-totals?timeFrame=${frame}&transactionType=summary`);
      const rows = Object.entries(TOTAL_LABELS).map(([k, label]) => ({ label, value: Math.abs(t[k] || 0), out: ['purchasesTotal', 'tradeSystemCostsTotal', 'adSpendTotal', 'developerExchangeTotal', 'individualToGroupTotal'].includes(k) })).filter(r => r.value);
      const max = Math.max(1, ...rows.map(r => r.value));
      const incoming = Math.abs(t.incomingRobuxTotal || 0);
      const outgoing = Math.abs(t.outgoingRobuxTotal || 0);
      totalsBox.replaceChildren(
        el('div', { class: 'kpis' },
          kpi('Balance', balance == null ? '–' : num(balance)),
          kpi(`In (${frame.toLowerCase()})`, `+${num(incoming)}`),
          kpi(`Out (${frame.toLowerCase()})`, `−${num(outgoing)}`),
          kpi('Net', `${incoming - outgoing >= 0 ? '+' : '−'}${num(Math.abs(incoming - outgoing))}`),
          kpi('Pending', num(Math.abs(t.pendingRobuxTotal || 0)), 'Sales still on hold')),
        card(`Breakdown · past ${frame.toLowerCase()}`, rows.length ? el('div', { class: 'list' }, rows.sort((a, b) => b.value - a.value).map(r => el('div', { class: 'item' },
          el('div', { class: 'grow' },
            el('div', { class: 'row' }, el('span', { class: 'grow', text: r.label }), el('span', { class: `num ${r.out ? 'bad' : 'good'}`, text: `${r.out ? '−' : '+'}${r.value.toLocaleString()}` })),
            el('div', { class: 'bar-track' }, el('i', { style: { width: `${Math.max(2, (r.value / max) * 100)}%`, background: r.out ? 'var(--bad)' : 'var(--good)' } })))))) : el('p', { class: 'empty', text: 'No Robux moved in this period.' })));
    } catch (e) {
      totalsBox.replaceChildren(errorBox(e));
    }
  }
  await drawTotals();

  const spendBox = el('div', { class: 'grid' }, card('Spending', loading('Loading your purchases (up to 500)')));
  root.append(el('div', { style: { marginTop: '16px' } }, spendBox));
  try {
    const buys = await transactions(me.id, 'Purchase');
    if (!buys.length) return spendBox.replaceChildren(card('Spending', el('p', { class: 'empty', text: 'No purchases yet.' })));
    const amount = b => Math.abs(b.currency?.amount || 0);

    const months = [];
    for (let i = 11; i >= 0; i--) {
      const d = new Date();
      d.setDate(1);
      d.setMonth(d.getMonth() - i);
      months.push({ key: `${d.getFullYear()}-${d.getMonth()}`, label: d.toLocaleDateString(undefined, { month: 'long', year: 'numeric' }), short: d.toLocaleDateString(undefined, { month: 'short' }), value: 0 });
    }
    const byMonth = new Map(months.map(m => [m.key, m]));
    const bySeller = new Map();
    const byType = new Map();
    for (const b of buys) {
      const d = new Date(b.created);
      const m = byMonth.get(`${d.getFullYear()}-${d.getMonth()}`);
      if (m) m.value += amount(b);
      const seller = b.details?.place?.name || b.agent?.name || 'Unknown';
      bySeller.set(seller, (bySeller.get(seller) || 0) + amount(b));
      const type = PURCHASE_TYPES[b.details?.type] || b.details?.type || 'Other';
      byType.set(type, (byType.get(type) || 0) + amount(b));
    }
    const total = buys.reduce((a, b) => a + amount(b), 0);
    const ranked = (map, n) => [...map.entries()].sort((a, b) => b[1] - a[1]).slice(0, n);
    const bars = (rows) => {
      const max = Math.max(1, ...rows.map(r => r[1]));
      return el('div', { class: 'list' }, rows.map(([label, v]) => el('div', { class: 'item' }, el('div', { class: 'grow' },
        el('div', { class: 'row' }, el('span', { class: 'grow ellipsis', text: label }), el('span', { class: 'num muted', text: v.toLocaleString() })),
        el('div', { class: 'bar-track' }, el('i', { style: { width: `${Math.max(2, (v / max) * 100)}%` } }))))));
    };
    const itemLink = (b) => {
      const id = b.details?.id;
      if (!id) return null;
      if (b.details.type === 'Asset' || b.details.type === 'Bundle') return `https://www.roblox.com/${b.details.type === 'Bundle' ? 'bundles' : 'catalog'}/${id}`;
      if (b.details.type === 'GamePass') return `https://www.roblox.com/game-pass/${id}`;
      return null;
    };

    spendBox.replaceChildren(
      el('div', { class: 'kpis' },
        kpi('Spent (last 500)', num(total), `${buys.length} purchases`),
        kpi('This month', num(months[11].value)),
        kpi('Average per month', num(Math.round(months.reduce((a, m) => a + m.value, 0) / 12)), 'past 12 months'),
        kpi('Biggest purchase', num(Math.max(...buys.map(amount))), buys.reduce((a, b) => (amount(b) > amount(a) ? b : a)).details?.name)),
      el('div', { class: 'grid cols-2' },
        card('Spent per month', monthBars(months)),
        card('By type', bars(ranked(byType, 6)))),
      el('div', { class: 'grid cols-2' },
        card('Where it went', bars(ranked(bySeller, 8))),
        card('Latest purchases', el('div', { class: 'list' }, buys.slice(0, 15).map(b => el('div', { class: 'item' },
          el('div', { class: 'grow' },
            itemLink(b) ? el('a', { class: 'item-title ellipsis', style: { display: 'block' }, href: itemLink(b), target: '_blank', text: b.details?.name || 'Purchase' }) : el('div', { class: 'item-title ellipsis', text: b.details?.name || 'Purchase' }),
            el('div', { class: 'small muted', text: `${PURCHASE_TYPES[b.details?.type] || b.details?.type || ''}${b.details?.place?.name ? ` · ${b.details.place.name}` : ''} · ${new Date(b.created).toLocaleDateString()}` })),
          el('span', { class: 'num', text: amount(b).toLocaleString() })))))));
  } catch (e) {
    spendBox.replaceChildren(card('Spending', errorBox(e)));
  }
};


// ---------- avatar sandbox ----------

const SINGLE_SLOT = new Set([2, 11, 12, 17, 18, 27, 28, 29, 30, 31]); // t-shirt, shirt, pants, head, face, body parts
const CATEGORIES = [
  ['', 'Everything'], ['Accessories', 'All accessories'], ['Accessories|HatAccessories', 'Hats'], ['Accessories|FaceAccessories', 'Face accessories'],
  ['Clothing|ClassicShirts', 'Classic shirts'], ['Clothing|ClassicPants', 'Classic pants'], ['AvatarAnimations', 'Animations'],
];

async function renderAvatar(def) {
  const body = {
    thumbnailConfig: { thumbnailId: 1, thumbnailType: '2d', size: '420x420' },
    avatarDefinition: {
      assets: def.assets.map(a => ({ id: a.id })),
      bodyColors: def.bodyColors,
      scales: def.scales,
      playerAvatarType: { playerAvatarType: def.type },
    },
  };
  for (let i = 0; i < 20; i++) {
    const r = await api('https://avatar.roblox.com/v1/avatar/render', { method: 'POST', body });
    if (r?.state === 'Completed' && r.imageUrl) return r.imageUrl;
    if (r?.state && !['Pending', 'InReview'].includes(r.state)) throw new Error(`Roblox couldn't render this outfit (${r.state}).`);
    await BB.sleep(1500);
  }
  throw new Error('Rendering took too long. Try again.');
}

async function myAvatar(userId) {
  const a = await api(`https://avatar.roblox.com/v2/avatar/users/${userId}/avatar`);
  const c = a.bodyColor3s || {};
  const hex = v => `#${(v || 'A3A2A5').replace('#', '')}`;
  return {
    type: a.playerAvatarType || 'R15',
    scales: a.scales,
    bodyColors: {
      headColor: hex(c.headColor3), torsoColor: hex(c.torsoColor3),
      leftArmColor: hex(c.leftArmColor3), rightArmColor: hex(c.rightArmColor3),
      leftLegColor: hex(c.leftLegColor3), rightLegColor: hex(c.rightLegColor3),
    },
    assets: (a.assets || []).map(x => ({ id: x.id, name: x.name, type: x.assetType?.id, owned: true })),
  };
}

const COMMUNITY = 'https://bloxboard.enesserver.dev/community/';
const encodeOutfit = o => btoa(unescape(encodeURIComponent(JSON.stringify(o))));
const decodeOutfit = s => JSON.parse(decodeURIComponent(escape(atob(s))));

pages.sandbox = async (root, arg) => {
  root.append(pageHead('Avatar sandbox', 'Try any item on your avatar without buying it. Outfits you save stay in this browser.',
    el('a', { class: 'btn ghost', href: `${COMMUNITY}#/?type=outfit`, target: '_blank', text: 'Community outfits ↗' })));
  const me = await BB.me();
  const base = await myAvatar(me.id);
  let def = structuredClone(base);
  // Opened from a community post: wear that outfit.
  if (arg?.startsWith('import/')) {
    try {
      const o = decodeOutfit(decodeURIComponent(arg.slice(7)));
      def = {
        type: o.type === 'R6' ? 'R6' : 'R15',
        scales: { ...base.scales, ...(o.scales || {}) },
        bodyColors: { ...base.bodyColors, ...(o.bodyColors || {}) },
        assets: (o.assets || []).map(a => ({ id: Number(a.id), name: a.name, type: a.type, owned: base.assets.some(b => b.id === Number(a.id)) })).filter(a => a.id),
      };
    } catch {
      root.append(el('p', { class: 'error', text: 'That outfit link is broken.' }));
    }
  }
  const prices = new Map();

  const preview = img('sandbox-img', null);
  const status = el('p', { class: 'small muted', text: 'Rendering…' });
  const worn = el('div', { class: 'chips' });
  const cost = el('p', { class: 'small muted' });
  const saved = el('div', { class: 'list' });
  const search = el('input', { class: 'input grow', type: 'search', placeholder: 'Search the catalog (e.g. "valkyrie", "black hair")' });
  const cat = el('select', { class: 'input' }, CATEGORIES.map(([v, t]) => el('option', { value: v, text: t })));
  const results = el('div', { class: 'catalog-grid' });
  const more = el('button', { class: 'btn ghost', type: 'button', text: 'More results', hidden: true });
  let cursor = null;
  let renderToken = 0;

  async function redraw() {
    const mine = ++renderToken;
    status.textContent = 'Rendering…';
    preview.style.opacity = '.5';
    try {
      const url = await renderAvatar(def);
      if (mine !== renderToken) return;
      preview.src = url;
      status.textContent = `${def.assets.length} items on`;
    } catch (e) {
      if (mine === renderToken) status.textContent = e.status === 401 ? 'Log in on roblox.com to render.' : e.message;
    } finally {
      if (mine === renderToken) preview.style.opacity = '1';
    }
    drawWorn();
  }

  function drawWorn() {
    worn.replaceChildren(...def.assets.map(a => el('span', { class: `chip${a.owned ? '' : ' accent'}` },
      el('span', { class: 'ellipsis', text: a.name || `Item ${a.id}` }),
      el('button', { type: 'button', 'aria-label': `Remove ${a.name}`, text: '×', onclick: () => { def.assets = def.assets.filter(x => x.id !== a.id); redraw(); } }))));
    const trying = def.assets.filter(a => !a.owned);
    const total = trying.reduce((sum, a) => sum + (prices.get(a.id) || 0), 0);
    cost.textContent = trying.length ? `Trying on ${trying.length} item${trying.length === 1 ? '' : 's'} you don't own · about ${total.toLocaleString()} Robux to buy them all` : 'Wearing your own avatar.';
  }

  function toggle(item) {
    const has = def.assets.find(a => a.id === item.id);
    if (has) {
      def.assets = def.assets.filter(a => a.id !== item.id);
    } else {
      if (SINGLE_SLOT.has(item.assetType)) def.assets = def.assets.filter(a => a.type !== item.assetType);
      def.assets.push({ id: item.id, name: item.name, type: item.assetType, owned: base.assets.some(b => b.id === item.id) });
    }
    redraw();
  }

  async function runSearch(append) {
    if (!append) {
      cursor = null;
      results.replaceChildren(loading('Searching'));
    }
    try {
      const q = new URLSearchParams({ Keyword: search.value.trim(), Limit: '30' });
      const [category, sub] = cat.value.split('|');
      if (category) q.set('Category', category);
      if (sub) q.set('Subcategory', sub);
      if (cursor) q.set('Cursor', cursor);
      const page = await api(`https://catalog.roblox.com/v1/search/items/details?${q}`);
      cursor = page.nextPageCursor;
      more.hidden = !cursor;
      const items = (page.data || []).filter(i => i.itemType === 'Asset');
      for (const i of items) prices.set(i.id, i.lowestPrice ?? i.price ?? 0);
      const thumbs = await BB.itemThumbs(items.map(i => i.id)).catch(() => new Map());
      if (!append) results.replaceChildren();
      results.append(...items.map(i => el('button', { class: 'catalog-item', type: 'button', title: i.name, onclick: () => toggle(i) },
        img('thumb', thumbs.get(i.id)),
        el('span', { class: 'ellipsis small', text: i.name }),
        el('span', { class: 'small muted num', text: i.lowestPrice != null ? `${num(i.lowestPrice)} R$` : i.price != null ? (i.price ? `${num(i.price)} R$` : 'Free') : 'Off sale' }))));
      if (!results.children.length) results.replaceChildren(el('p', { class: 'empty', text: 'Nothing found.' }));
    } catch (e) {
      results.replaceChildren(errorBox(e));
    }
  }

  async function drawSaved() {
    const outfits = await BB.get('sandboxOutfits', []);
    saved.replaceChildren(...(outfits.length ? outfits.map((o, idx) => el('div', { class: 'item' },
      el('div', { class: 'grow' }, el('div', { class: 'item-title', text: o.name }), el('div', { class: 'small muted', text: `${o.def.assets.length} items · ${new Date(o.at).toLocaleDateString()}` })),
      el('button', { class: 'btn sm ghost', type: 'button', text: 'Load', onclick: () => { def = structuredClone(o.def); redraw(); } }),
      el('button', { class: 'btn sm ghost', type: 'button', text: 'Delete', onclick: async () => { outfits.splice(idx, 1); await BB.set('sandboxOutfits', outfits); drawSaved(); } })))
      : [el('p', { class: 'small muted', text: 'No saved outfits yet.' })]));
  }

  const nameInput = el('input', { class: 'input grow', placeholder: 'Outfit name', maxlength: '40' });
  const saveForm = el('form', { class: 'row', onsubmit: async (e) => {
    e.preventDefault();
    const outfits = await BB.get('sandboxOutfits', []);
    outfits.unshift({ name: nameInput.value.trim() || `Outfit ${outfits.length + 1}`, at: Date.now(), def: structuredClone(def) });
    await BB.set('sandboxOutfits', outfits.slice(0, 50));
    nameInput.value = '';
    drawSaved();
  } }, nameInput, el('button', { class: 'btn', type: 'submit', text: 'Save outfit' }));

  root.append(el('div', { class: 'sandbox' },
    el('section', { class: 'card sandbox-left' },
      el('div', { class: 'sandbox-stage' }, preview),
      status,
      el('div', { class: 'row wrap', style: { margin: '10px 0' } },
        el('button', { class: 'btn ghost', type: 'button', text: 'Reset to my avatar', onclick: () => { def = structuredClone(base); redraw(); } }),
        el('button', { class: 'btn ghost', type: 'button', text: 'Remove everything', onclick: () => { def.assets = []; redraw(); } }),
        el('button', { class: 'btn', type: 'button', text: 'Share to community', onclick: () => {
          if (!def.assets.length) return;
          const outfit = { type: def.type, scales: def.scales, bodyColors: def.bodyColors, assets: def.assets.map(a => ({ id: a.id, name: a.name, type: a.type })), preview: preview.src || null };
          window.open(`${COMMUNITY}#/new?outfit=${encodeURIComponent(encodeOutfit(outfit))}`, '_blank');
        } })),
      el('h2', { text: 'Wearing', style: { marginTop: '8px' } }), worn, cost,
      el('h2', { text: 'Saved outfits', style: { marginTop: '16px' } }), saveForm, saved),
    el('section', { class: 'card' },
      el('form', { class: 'row wrap', style: { marginBottom: '12px' }, onsubmit: (e) => { e.preventDefault(); runSearch(false); } }, search, cat, el('button', { class: 'btn', type: 'submit', text: 'Search' })),
      results, more)));

  more.onclick = () => runSearch(true);
  cat.onchange = () => runSearch(false);
  drawSaved();
  redraw();
  runSearch(false);
};


// ---------- games: favorites + random pick ----------

pages.games = async (root) => {
  const sort = el('select', { class: 'input' },
    el('option', { value: 'updated', text: 'Recently updated' }),
    el('option', { value: 'playing', text: 'Most playing' }),
    el('option', { value: 'mine', text: 'Your playtime' }),
    el('option', { value: 'liked', text: 'Best liked' }),
    el('option', { value: 'name', text: 'Name' }));
  const minPlaying = el('select', { class: 'input' },
    [['0', 'Any size'], ['100', '100+ playing'], ['1000', '1K+ playing'], ['10000', '10K+ playing']].map(([v, t]) => el('option', { value: v, text: t })));
  const pick = el('div');
  root.append(pageHead('Games', 'Your favorites and the games you play, with a random pick when you can\'t decide.', minPlaying, sort,
    el('button', { class: 'btn', type: 'button', text: 'Random game', onclick: () => randomPick() })), pick);
  const body = card(null, loading('Loading your games'));
  root.append(body);

  const me = await BB.me();
  const favs = [];
  let cursor = '';
  do {
    const page = await api(`https://games.roblox.com/v2/users/${me.id}/favorite/games?limit=50&sortOrder=Desc${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`);
    favs.push(...(page.data || []));
    cursor = page.nextPageCursor;
  } while (cursor && favs.length < 300);

  const playedTop = await BB.topGames(null);
  const mine = new Map(playedTop.map(g => [g.universeId, g.minutes]));
  const list = new Map();
  for (const f of favs) list.set(f.id, { universeId: f.id, name: f.name, placeId: f.rootPlace?.id, updated: f.updated, fav: true });
  for (const g of playedTop) if (!list.has(g.universeId) && g.placeId) list.set(g.universeId, { universeId: g.universeId, name: g.name, placeId: g.placeId, fav: false });
  const all = [...list.values()];
  if (!all.length) return body.replaceChildren(el('p', { class: 'empty', text: 'Favorite a few games on Roblox (or play some) and they show up here.' }));

  const ids = all.map(g => g.universeId);
  const [details, votes, icons] = await Promise.all([
    Promise.all(BB.chunk(ids, 50).map(part => api(`https://games.roblox.com/v1/games?universeIds=${part.join(',')}`).then(r => r.data || []).catch(() => []))).then(x => x.flat()),
    Promise.all(BB.chunk(ids, 50).map(part => api(`https://games.roblox.com/v1/games/votes?universeIds=${part.join(',')}`).then(r => r.data || []).catch(() => []))).then(x => x.flat()),
    BB.gameIcons(ids).catch(() => new Map()),
  ]);
  for (const d of details) Object.assign(list.get(d.id) || {}, { playing: d.playing, visits: d.visits, updated: list.get(d.id)?.updated || d.updated });
  for (const v of votes) {
    const g = list.get(v.id);
    if (g) g.liked = v.upVotes + v.downVotes ? v.upVotes / (v.upVotes + v.downVotes) : null;
  }

  const filtered = () => {
    const min = Number(minPlaying.value);
    const by = {
      updated: (a, b) => new Date(b.updated || 0) - new Date(a.updated || 0),
      playing: (a, b) => (b.playing || 0) - (a.playing || 0),
      mine: (a, b) => (mine.get(b.universeId) || 0) - (mine.get(a.universeId) || 0),
      liked: (a, b) => (b.liked ?? -1) - (a.liked ?? -1),
      name: (a, b) => (a.name || '').localeCompare(b.name || ''),
    }[sort.value];
    return all.filter(g => (g.playing || 0) >= min).sort(by);
  };

  function draw() {
    const rows = filtered();
    body.replaceChildren(
      el('div', { class: 'card-head' }, el('h2', { text: `${rows.length} games` }), el('span', { class: 'small muted', text: `${favs.length} favorites · ${playedTop.length} played` })),
      rows.length ? el('div', { class: 'list' }, rows.map(g => el('div', { class: 'item' },
        img('icon', icons.get(g.universeId)),
        el('div', { class: 'grow' },
          el('div', { class: 'row' },
            el('a', { class: 'item-title ellipsis', href: gameUrl(g.placeId), target: '_blank', text: g.name }),
            g.fav ? el('span', { class: 'badge accent', text: 'Favorite' }) : null),
          el('div', { class: 'small muted', text: [
            g.playing != null ? `${num(g.playing)} playing` : null,
            g.liked != null ? `${Math.round(g.liked * 100)}% liked` : null,
            g.updated ? `updated ${BB.ago(g.updated)}` : null,
            mine.get(g.universeId) ? `you played ${duration(mine.get(g.universeId))}` : null,
          ].filter(Boolean).join(' · ') })),
        el('a', { class: 'btn sm', href: BB.joinUrl(g.placeId), text: 'Play' }))))
        : el('p', { class: 'empty', text: 'No games match that size.' }));
  }

  function randomPick() {
    const rows = filtered().filter(g => g.placeId);
    if (!rows.length) return;
    const g = rows[Math.floor(Math.random() * rows.length)];
    pick.replaceChildren(el('section', { class: 'card row wrap', style: { marginBottom: '16px', borderColor: 'var(--accent)' } },
      img('icon', icons.get(g.universeId)),
      el('div', { class: 'grow' }, el('div', { class: 'small muted', text: 'How about…' }), el('h2', { style: { margin: 0 }, text: g.name })),
      el('button', { class: 'btn ghost', type: 'button', text: 'Another', onclick: randomPick }),
      el('a', { class: 'btn', href: BB.joinUrl(g.placeId), text: 'Play it' })));
  }

  sort.onchange = draw;
  minPlaying.onchange = draw;
  draw();
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
