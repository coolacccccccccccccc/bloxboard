// roblox.com/home: a "Most played" row with your playtime per game (week / month / all time).

(async () => {
  if (document.getElementById('bbx-home')) return;
  const settings = await BB.settings();
  if (!settings.homeMostPlayed) return;
  const { el, duration } = BB;

  let period = (await BB.get('homePeriod')) || 7;
  const seg = el('div', { class: 'bbx-seg', role: 'group', 'aria-label': 'Period' });
  const row = el('div', { class: 'bbx-home-row' });
  const section = el('section', { id: 'bbx-home', class: 'bbx-panel bbx-home' },
    el('header', { class: 'bbx-home-head' },
      el('h2', { class: 'bbx-home-title', text: 'Most played' }),
      seg,
      el('span', { class: 'bbx-grow' }),
      el('button', { class: 'bbx-link', type: 'button', text: 'Playtime stats ↗', onclick: () => chrome.runtime.sendMessage({ type: 'openDashboard', hash: 'playtime' }) })),
    row);

  const PERIODS = [[7, 'Past week'], [30, 'Past month'], [0, 'All time']];
  function renderSeg() {
    seg.replaceChildren(...PERIODS.map(([days, label]) => el('button', {
      type: 'button', 'aria-pressed': String(days === period), text: label,
      onclick: async () => { period = days; await BB.set('homePeriod', days); renderSeg(); render(); },
    })));
  }

  async function render() {
    const games = (await BB.topGames(period || null)).slice(0, 12);
    if (!games.length) {
      row.replaceChildren(el('p', { class: 'bbx-muted bbx-small bbx-home-empty', text: period ? 'Nothing played in this period yet. Bloxboard counts your playtime while the browser is open.' : 'Bloxboard counts your playtime while the browser is open. Play something and it shows up here.' }));
      return;
    }
    const icons = await BB.gameIcons(games.map(g => g.universeId)).catch(() => new Map());
    const max = games[0].minutes;
    row.replaceChildren(...games.map(g => el('a', { class: 'bbx-home-card', href: g.placeId ? `https://www.roblox.com/games/${g.placeId}` : '#', title: g.name },
      el('div', { class: 'bbx-home-thumb' },
        el('img', { src: icons.get(g.universeId) || undefined, alt: '', loading: 'lazy' }),
        g.placeId ? el('span', { class: 'bbx-home-play', title: `Play ${g.name}`, role: 'button', onclick: (e) => { e.preventDefault(); e.stopPropagation(); location.href = BB.joinUrl(g.placeId); } }, '▶') : null),
      el('div', { class: 'bbx-home-name', text: g.name || `Game ${g.universeId}` }),
      el('div', { class: 'bbx-home-time' }, el('b', { text: duration(g.minutes) }), el('span', { class: 'bbx-muted', text: ' played' })),
      el('div', { class: 'bbx-meter' }, el('i', { style: { width: `${Math.max(4, (g.minutes / max) * 100)}%` } })))));
  }

  // Place the row near the top of the home feed. Roblox's home is a React app that re-renders
  // (and throws our row out) while and after it loads, and its layout changes now and then, so:
  // try several spots in order, skip spots where the row would be hidden, keep watching for as
  // long as the page is open, and leave a small report for Settings → Diagnostics.
  const failed = new Set();
  let removals = 0;
  let wasMounted = false;
  let where = '';

  const q = sel => document.querySelector(sel);
  const homeEl = () => q('#HomeContainer, .home-container, [data-testid="home-page-container"], [data-testid*="home-page"], [class*="home-page-container"]');
  const SORT_TITLE = /^(continue|recommended for you|today's picks|favorites|your favorites|friends|up next|top trending|popular|sponsored)/i;

  // A game-sort section: the block around a heading like "Recommended For You".
  function firstSortBlock(root) {
    for (const h of root.querySelectorAll('h2, h3, [class*="sort-header"], [class*="container-header"]')) {
      if (section.contains(h) || !SORT_TITLE.test((h.textContent || '').trim())) continue;
      let block = h;
      while (block.parentElement && block.parentElement !== root && block.parentElement.children.length < 3) block = block.parentElement;
      return block;
    }
    return null;
  }

  const SPOTS = [
    ['after friends', () => {
      const home = homeEl();
      const friends = q('.friend-carousel-container, [class*="friends-carousel"], .people-list-container, [class*="friend-carousel"], [data-testid*="friend"]');
      if (!friends || !home?.contains(friends)) return null;
      let anchor = friends;
      while (anchor.parentElement && anchor.parentElement !== home) anchor = anchor.parentElement;
      return anchor.parentElement ? { after: anchor } : null;
    }],
    ['above home', () => { const h = homeEl(); return h?.parentElement ? { before: h } : null; }],
    ['before first sort', () => { const root = q('main, [role="main"], #content, #container-main') || document.body; const b = firstSortBlock(root); return b?.parentElement ? { before: b } : null; }],
    ['top of content', () => { const c = q('#content, main, [role="main"], #container-main'); return c ? { prepend: c } : null; }],
  ];

  function place(spot) {
    if (spot.after) { if (section.previousElementSibling !== spot.after) spot.after.after(section); }
    else if (spot.before) { if (section.nextElementSibling !== spot.before) spot.before.before(section); }
    else if (spot.prepend) { if (section.parentElement !== spot.prepend) spot.prepend.prepend(section); }
  }

  function mount() {
    if (wasMounted && !section.isConnected) removals++;
    // Removed over and over from inside the feed: stop fighting React there.
    if (removals >= 4) failed.add('after friends');
    section.classList.toggle('bbx-dark', BBX_isDark());
    for (const [name, find] of SPOTS) {
      if (failed.has(name)) continue;
      const spot = find();
      if (!spot) continue;
      place(spot);
      where = name;
      wasMounted = true;
      // A spot inside something hidden (collapsed carousel, display:none wrapper) doesn't count.
      if (section.checkVisibility && !section.checkVisibility() && section.offsetHeight === 0) { failed.add(name); continue; }
      return true;
    }
    return false;
  }

  // Report for Settings → Diagnostics (what the real home page looks like when the row misbehaves).
  function outline(node, depth, out) {
    for (const c of node.children) {
      if (out.length > 90 || /^(SCRIPT|STYLE|LINK|NOSCRIPT|SVG|PATH|IMG)$/i.test(c.tagName) || c === section) continue;
      const cls = typeof c.className === 'string' ? c.className.trim().split(/\s+/).slice(0, 2).join('.') : '';
      const tid = c.getAttribute('data-testid');
      out.push(`${'  '.repeat(depth)}${c.tagName.toLowerCase()}${c.id ? '#' + c.id : ''}${cls ? '.' + cls : ''}${tid ? `[${tid}]` : ''}`);
      if (depth < 5) outline(c, depth + 1, out);
    }
    return out;
  }
  let lastReport = '';
  const report = () => {
    const r = section.getBoundingClientRect();
    const data = { v: chrome.runtime.getManifest().version, url: location.pathname, where: section.isConnected ? where : 'not on page', removals, visible: section.isConnected && r.height > 0, size: `${Math.round(r.width)}x${Math.round(r.height)}`, failed: [...failed] };
    const key = JSON.stringify(data);
    if (key === lastReport) return;
    lastReport = key;
    BB.set('homeDebug', { ...data, at: Date.now(), outline: outline(document.body, 0, []).join('\n') }).catch(() => {});
  };

  renderSeg();
  render();
  mount();
  let queued = false;
  new MutationObserver(() => {
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => { queued = false; mount(); });
  }).observe(document.body, { childList: true, subtree: true });
  setInterval(report, 3000);
  setTimeout(report, 1500);
})();
