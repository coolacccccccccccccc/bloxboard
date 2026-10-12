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
  const SORT_TITLE = /^(continue|recommended for you|today's picks|favorites|your favorites|up next|top trending|popular|sponsored)/i;

  // A game-sort section: the block around a heading like "Recommended For You".
  function firstSortBlock(root) {
    for (const h of root.querySelectorAll('h1, h2, h3, h4, [class*="header"], [class*="heading"], [class*="title"]')) {
      const text = (h.textContent || '').trim();
      if (section.contains(h) || text.length > 40 || !SORT_TITLE.test(text)) continue;
      let block = h;
      while (block.parentElement && block.parentElement !== root && block.parentElement.children.length < 3) block = block.parentElement;
      return block;
    }
    return null;
  }

  const SPOTS = [
    ['after friends', () => {
      // Roblox draws the friends carousel inside the game feed now, so climb only up to the block
      // that holds both the friends and the first game row, and sit between the two.
      const home = homeEl();
      const friends = q('.friend-carousel-container, [class*="friends-carousel"], .people-list-container, [class*="friend-carousel"]');
      if (!friends || !home?.contains(friends)) return null;
      const sort = firstSortBlock(home);
      if (sort && !friends.contains(sort) && !sort.contains(friends)) {
        const up = new Set();
        for (let n = friends; n && n !== home.parentElement; n = n.parentElement) up.add(n);
        let shared = sort;
        while (shared && !up.has(shared)) shared = shared.parentElement;
        if (shared) {
          let anchor = friends;
          while (anchor.parentElement && anchor.parentElement !== shared) anchor = anchor.parentElement;
          if (anchor.parentElement === shared && anchor !== section) return { after: anchor };
        }
      }
      let anchor = friends;
      while (anchor.parentElement && anchor.parentElement !== home) anchor = anchor.parentElement;
      // Never after the whole feed: that's the bottom of the page.
      if (anchor.matches('.place-list-container') || anchor.querySelector('[data-testid="HomePageContainerTestId"]')) return null;
      return anchor.parentElement ? { after: anchor } : null;
    }],
    ['top of game list', () => { const l = q('.place-list-container'); return l ? { prepend: l } : null; }],
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
      // A spot inside something hidden (collapsed carousel, display:none wrapper) doesn't count,
      // and neither does one where Roblox's own blocks are drawn over the row.
      if (section.checkVisibility && !section.checkVisibility() && section.offsetHeight === 0) { failed.add(name); continue; }
      if (overlap()) { failed.add(name); continue; }
      return true;
    }
    return false;
  }

  // Does a neighbouring block sit on top of the row (negative margins, absolute positioning)?
  function overlap() {
    const r = section.getBoundingClientRect();
    if (r.height === 0) return '';
    for (const [label, n] of [['next', section.nextElementSibling], ['previous', section.previousElementSibling]]) {
      if (!n) continue;
      const b = n.getBoundingClientRect();
      if (b.height > 0 && b.width > 0 && b.top < r.bottom - 8 && b.bottom > r.top + 8) return `${label} block overlaps`;
    }
    return '';
  }
  const desc = n => n ? `${n.tagName.toLowerCase()}${n.id ? '#' + n.id : ''}${typeof n.className === 'string' && n.className ? '.' + n.className.trim().split(/\s+/).slice(0, 2).join('.') : ''}` : '-';
  const box = n => {
    if (!n) return '-';
    const r = n.getBoundingClientRect();
    const cs = getComputedStyle(n);
    return `${desc(n)} top=${Math.round(r.top + scrollY)} h=${Math.round(r.height)} display=${cs.display} pos=${cs.position} mt=${cs.marginTop} z=${cs.zIndex}`;
  };
  function details() {
    const r = section.getBoundingClientRect();
    const cs = getComputedStyle(section);
    let onTop = 'off screen';
    const y = r.top + 14;
    if (y > 0 && y < innerHeight) onTop = desc(document.elementFromPoint(r.left + r.width / 2, y));
    return [
      `row: ${box(section)} opacity=${cs.opacity} visibility=${cs.visibility} color=${cs.color} bg=${cs.backgroundColor}`,
      `drawn on top of row header: ${onTop}`,
      `previous: ${box(section.previousElementSibling)}`,
      `next: ${box(section.nextElementSibling)}`,
      `parent: ${box(section.parentElement)} grid=${getComputedStyle(section.parentElement || section).gridTemplateRows}`,
      `overlap: ${overlap() || 'none'}`,
    ].join('\n');
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
    const data = { v: chrome.runtime.getManifest().version, url: location.pathname, where: section.isConnected ? where : 'not on page', removals, visible: section.isConnected && r.height > 0 && !overlap(), size: `${Math.round(r.width)}x${Math.round(r.height)}`, top: Math.round(r.top + scrollY), failed: [...failed] };
    const key = JSON.stringify(data);
    if (key === lastReport) return;
    lastReport = key;
    BB.set('homeDebug', { ...data, at: Date.now(), outline: (section.isConnected ? details() + '\n\n' : '') + outline(document.body, 0, []).join('\n') }).catch(() => {});
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
