// Quick search: instant results under Roblox's navbar search box.
// Games (with a Play button), limiteds (with values) and an exact player match.
// Enter without picking a result still runs Roblox's normal search.

(async () => {
  if (window.__bbxSearch) return;
  window.__bbxSearch = true;
  const settings = await BB.settings();
  if (!settings.quickSearch) return;
  const { el, num } = BB;

  const INPUT = '#navbar-search-input, input.navbar-search-input, #navbar-universal-search input, .navbar-search input[type="text"], header input[type="search"]';
  const sessionId = crypto.randomUUID();
  let input = null;
  let timer = null;
  let seq = 0;
  let active = -1;

  const box = el('div', { id: 'bbx-search', class: 'bbx-panel bbx-search', role: 'listbox', hidden: true });
  document.body.append(box);

  const links = () => [...box.querySelectorAll('.bbx-sr')];

  function place() {
    if (!input) return;
    const r = input.getBoundingClientRect();
    const width = Math.min(Math.max(r.width, 420), window.innerWidth - 16);
    box.style.top = `${r.bottom + 8}px`;
    box.style.left = `${Math.max(8, Math.min(r.left, window.innerWidth - width - 8))}px`;
    box.style.width = `${width}px`;
  }

  function open() {
    box.classList.toggle('bbx-dark', BBX_isDark());
    place();
    box.hidden = false;
    document.documentElement.classList.add('bbx-search-open');
  }

  function close() {
    box.hidden = true;
    active = -1;
    document.documentElement.classList.remove('bbx-search-open');
  }

  async function games(q) {
    const res = await BB.api(`https://apis.roblox.com/search-api/omni-search?searchQuery=${encodeURIComponent(q)}&sessionId=${sessionId}&pageType=all`, { retries: 1 });
    return (res.searchResults || []).filter(g => g.contentGroupType === 'Game').flatMap(g => g.contents || []).slice(0, 4);
  }

  async function limiteds(q) {
    const values = await BB.values();
    if (!values || values.error) return [];
    const lower = q.toLowerCase();
    return Object.entries(values)
      .filter(([, r]) => r[0].toLowerCase().includes(lower) || (r[1] && r[1].toLowerCase() === lower))
      .map(([id, r]) => ({ id: Number(id), row: r, worth: BB.itemWorth(r), exact: r[1]?.toLowerCase() === lower }))
      .sort((a, b) => b.exact - a.exact || b.worth - a.worth)
      .slice(0, 4);
  }

  async function person(q) {
    if (!/^[A-Za-z0-9_]{3,20}$/.test(q)) return null;
    const { data } = await BB.api('https://users.roblox.com/v1/usernames/users', { method: 'POST', body: { usernames: [q], excludeBannedUsers: true }, retries: 1 });
    return data?.[0] || null;
  }

  const section = (title, rows) => (rows.length ? el('div', { class: 'bbx-sr-group' }, el('div', { class: 'bbx-sr-title', text: title }), rows) : null);

  async function search(q) {
    const mine = ++seq;
    const [g, l, p] = await Promise.all([games(q).catch(() => []), limiteds(q).catch(() => []), person(q).catch(() => null)]);
    if (mine !== seq || input.value.trim() !== q) return;
    const [icons, thumbs, face] = await Promise.all([
      BB.gameIcons(g.map(x => x.universeId)).catch(() => new Map()),
      BB.itemThumbs(l.map(x => x.id)).catch(() => new Map()),
      p ? BB.headshots([p.id]).catch(() => new Map()) : new Map(),
    ]);
    if (mine !== seq) return;

    const gameRows = g.map((x) => {
      const votes = (x.totalUpVotes || 0) + (x.totalDownVotes || 0);
      const liked = votes ? `${Math.round((x.totalUpVotes / votes) * 100)}% liked` : '';
      return el('a', { class: 'bbx-sr', href: `https://www.roblox.com/games/${x.rootPlaceId}`, role: 'option' },
        el('img', { class: 'bbx-sr-img', src: icons.get(x.universeId) || undefined, alt: '' }),
        el('span', { class: 'bbx-sr-main' }, el('b', { text: x.name }), el('span', { class: 'bbx-muted bbx-small', text: [x.playerCount != null ? `${num(x.playerCount)} playing` : '', liked].filter(Boolean).join(' · ') })),
        el('span', { class: 'bbx-btn bbx-sm', role: 'button', text: '▶ Play', onclick: (e) => { e.preventDefault(); e.stopPropagation(); location.href = BB.joinUrl(x.rootPlaceId); } }));
    });
    const itemRows = l.map(x => el('a', { class: 'bbx-sr', href: `https://www.roblox.com/catalog/${x.id}`, role: 'option' },
      el('img', { class: 'bbx-sr-img', src: thumbs.get(x.id) || undefined, alt: '' }),
      el('span', { class: 'bbx-sr-main' }, el('b', { text: x.row[0] }), el('span', { class: 'bbx-muted bbx-small', text: `${x.row[1] ? `${x.row[1]} · ` : ''}RAP ${num(x.row[2])}${x.row[5] >= 0 ? ` · ${BB.DEMAND[x.row[5]]} demand` : ''}` })),
      el('span', { class: 'bbx-sr-value' }, el('b', { text: x.row[3] > 0 ? num(x.row[3]) : num(x.row[2]) }), el('span', { class: 'bbx-muted bbx-small', text: x.row[3] > 0 ? 'value' : 'RAP' }))));
    const personRows = p ? [el('a', { class: 'bbx-sr', href: `https://www.roblox.com/users/${p.id}/profile`, role: 'option' },
      el('img', { class: 'bbx-sr-img bbx-round', src: face.get(p.id) || undefined, alt: '' }),
      el('span', { class: 'bbx-sr-main' }, el('b', { text: p.displayName }), el('span', { class: 'bbx-muted bbx-small', text: `@${p.name}` })),
      el('span', { class: 'bbx-muted bbx-small', text: 'Profile' }))] : [];

    const groups = [section('Experiences', gameRows), section('Limiteds', itemRows), section('People', personRows)].filter(Boolean);
    if (!groups.length) return close();
    active = -1;
    box.replaceChildren(...groups, el('div', { class: 'bbx-sr-foot bbx-muted bbx-small', text: 'Press Enter to search all of Roblox · ↑↓ to pick · Esc to close' }));
    open();
  }

  function onInput() {
    clearTimeout(timer);
    const q = input.value.trim();
    if (q.length < 2) return close();
    timer = setTimeout(() => search(q), 220);
  }

  function onKey(e) {
    if (box.hidden) return;
    const rows = links();
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      e.stopPropagation();
      // -1 means "nothing picked", so Enter falls through to Roblox's own search.
      if (e.key === 'ArrowDown') active = active >= rows.length - 1 ? -1 : active + 1;
      else active = active <= -1 ? rows.length - 1 : active - 1;
      rows.forEach((r, i) => r.classList.toggle('bbx-sr-active', i === active));
      rows[active]?.scrollIntoView({ block: 'nearest' });
    } else if (e.key === 'Enter' && active >= 0) {
      e.preventDefault();
      e.stopPropagation();
      rows[active].click();
    } else if (e.key === 'Escape') {
      close();
    }
  }

  function attach() {
    const found = document.querySelector(INPUT);
    if (!found || found === input) return;
    input = found;
    input.addEventListener('input', onInput);
    input.addEventListener('keydown', onKey, true);
    input.addEventListener('focus', () => { if (input.value.trim().length >= 2) onInput(); });
  }

  document.addEventListener('mousedown', (e) => {
    if (!box.hidden && !box.contains(e.target) && e.target !== input) close();
  });
  window.addEventListener('resize', () => { if (!box.hidden) place(); });
  window.addEventListener('scroll', () => { if (!box.hidden) place(); }, { passive: true });
  attach();
  setInterval(attach, 1500);
})();
