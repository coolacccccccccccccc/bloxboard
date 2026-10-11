// Profile page: one thin info strip (value, RAP, join date, presence) and a dashboard link.

(() => {
  const m = location.pathname.match(/\/users\/(\d+)/);
  if (!m || document.getElementById('bbx-profile')) return;
  const USER_ID = Number(m[1]);
  const { el, num } = BB;

  const items = el('div', { class: 'bbx-stats' }, el('span', { class: 'bbx-muted', text: 'Loading…' }));
  const strip = el('section', { id: 'bbx-profile', class: 'bbx-panel bbx-strip' },
    el('span', { class: 'bbx-brand', text: 'Bloxboard' }),
    items,
    el('button', { class: 'bbx-link', type: 'button', text: 'Full lookup ↗', onclick: () => chrome.runtime.sendMessage({ type: 'openDashboard', hash: `lookup/${USER_ID}` }) }));

  const chip = (label, value, title) => el('span', { class: 'bbx-chip', title }, el('b', { text: value }), ` ${label}`);

  async function load() {
    const [user, value, pres] = await Promise.all([
      BB.api(`https://users.roblox.com/v1/users/${USER_ID}`).catch(() => null),
      BB.playerValue(USER_ID).catch(() => null),
      BB.presence([USER_ID]).then(p => p.get(USER_ID)).catch(() => null),
    ]);
    const status = ['Offline', 'Online', 'In game', 'In Studio', 'Invisible'][pres?.userPresenceType ?? 0];
    const out = [];
    if (value && !value.error) {
      out.push(chip('value', num(value.value), 'Rolimons value of their limiteds'));
      out.push(chip('RAP', num(value.rap), 'Recent average price of their limiteds'));
      if (value.privacy_enabled) out.push(el('span', { class: 'bbx-chip bbx-muted', text: 'Inventory private' }));
    }
    if (user?.created) {
      const created = new Date(user.created);
      const years = ((Date.now() - created) / (365.25 * 86400000)).toFixed(1);
      out.push(chip('joined', created.toLocaleDateString(), `${years} years ago`));
    }
    if (pres) out.push(chip(pres.userPresenceType === 2 && pres.lastLocation ? `· ${pres.lastLocation}` : '', status));
    if (pres?.userPresenceType === 2 && pres.gameId && pres.placeId) {
      out.push(el('a', { class: 'bbx-btn bbx-sm', href: BB.joinUrl(pres.placeId, pres.gameId), text: 'Join' }));
    }
    items.replaceChildren(...(out.length ? out : [el('span', { class: 'bbx-muted', text: 'No extra info available.' })]));
  }

  function mount() {
    const anchor = document.querySelector('.profile-header')
      || document.querySelector('#profile-header-container')
      || document.querySelector('[class*="profile-header"]');
    if (!anchor) return false;
    strip.classList.toggle('bbx-dark', BBX_isDark());
    anchor.after(strip);
    return true;
  }

  let mounted = mount();
  if (!mounted) {
    const obs = new MutationObserver(() => {
      if (mount()) {
        obs.disconnect();
        mounted = true;
      }
    });
    obs.observe(document.body, { childList: true, subtree: true });
    setTimeout(() => {
      obs.disconnect();
      if (!mounted) {
        // Unknown layout: fall back to a small floating strip.
        strip.classList.add('bbx-floating');
        strip.classList.toggle('bbx-dark', BBX_isDark());
        document.body.append(strip);
      }
    }, 8000);
  }
  load();
})();
