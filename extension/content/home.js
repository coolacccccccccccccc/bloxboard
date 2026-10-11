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

  // Place the row near the top of the home feed: after the friends carousel if we can find it.
  function mount() {
    const friends = document.querySelector('.friend-carousel-container, [class*="friends-carousel"], .people-list-container');
    const home = document.querySelector('#HomeContainer, .home-container, [data-testid="home-page-container"]');
    // Walk up from the friends carousel to the block that sits directly inside the home container.
    let anchor = null;
    if (friends && home?.contains(friends)) {
      anchor = friends;
      while (anchor.parentElement && anchor.parentElement !== home) anchor = anchor.parentElement;
    }
    section.classList.toggle('bbx-dark', BBX_isDark());
    if (anchor?.parentElement) {
      if (section.previousElementSibling !== anchor) anchor.after(section);
      return true;
    }
    const fallback = home || document.querySelector('#content');
    if (!fallback) return false;
    if (!section.isConnected) fallback.prepend(section);
    return true;
  }

  renderSeg();
  render();
  let tries = 0;
  const iv = setInterval(() => {
    tries++;
    mount();
    if (tries > 40) clearInterval(iv); // Roblox's home feed renders in waves for ~20 s
  }, 500);
  mount();
})();
