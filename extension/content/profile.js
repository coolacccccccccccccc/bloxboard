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

  async function lastOnline() {
    try {
      const res = await BB.api('https://presence.roblox.com/v1/presence/last-online', { method: 'POST', body: { userIds: [USER_ID] }, retries: 1 });
      return res?.lastOnlineTimestamps?.[0]?.lastOnline || null;
    } catch {
      return null;
    }
  }

  async function mutuals() {
    const me = await BB.me().catch(() => null);
    if (!me || me.id === USER_ID) return null;
    const [mine, theirs] = await Promise.all([BB.friendIds(me.id), BB.friendIds(USER_ID)]);
    const set = new Set(mine);
    return theirs.filter(id => set.has(id));
  }

  // Private note about this player, stored only in this browser.
  async function noteButton() {
    const notes = await BB.get('notes', {});
    const btn = el('button', { class: 'bbx-link', type: 'button', text: notes[USER_ID] ? '✎ Your note' : '+ Add note' });
    const box = el('textarea', { class: 'bbx-input bbx-note', rows: '3', maxlength: '1000', placeholder: 'Only you can see this note. It saves as you type.' });
    box.value = notes[USER_ID] || '';
    let t = null;
    box.oninput = () => {
      clearTimeout(t);
      t = setTimeout(async () => {
        const all = await BB.get('notes', {});
        if (box.value.trim()) all[USER_ID] = box.value; else delete all[USER_ID];
        await BB.set('notes', all);
        btn.textContent = box.value.trim() ? '✎ Your note' : '+ Add note';
      }, 400);
    };
    const wrap = el('div', { class: 'bbx-note-wrap', hidden: !notes[USER_ID] }, box);
    btn.onclick = () => { wrap.hidden = !wrap.hidden; if (!wrap.hidden) box.focus(); };
    strip.append(wrap);
    return btn;
  }

  async function load() {
    const [user, value, pres, seen] = await Promise.all([
      BB.api(`https://users.roblox.com/v1/users/${USER_ID}`).catch(() => null),
      BB.playerValue(USER_ID).catch(() => null),
      BB.presence([USER_ID]).then(p => p.get(USER_ID)).catch(() => null),
      lastOnline(),
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
    if (seen && !(pres?.userPresenceType >= 1)) out.push(chip('', `Last online ${BB.ago(seen)}`, new Date(seen).toLocaleString()));
    if (pres?.userPresenceType === 2 && pres.gameId && pres.placeId) {
      out.push(el('a', { class: 'bbx-btn bbx-sm', href: BB.joinUrl(pres.placeId, pres.gameId), text: 'Join' }));
    }
    const mutualSlot = el('span', { class: 'bbx-chip bbx-muted', text: 'Mutual friends…' });
    out.push(mutualSlot);
    out.push(await noteButton());
    items.replaceChildren(...out);

    try {
      const ids = await mutuals();
      if (!ids) return mutualSlot.remove();
      if (!ids.length) return mutualSlot.replaceChildren(el('b', { text: '0' }), ' mutual friends');
      const [names, shots] = await Promise.all([BB.users(ids.slice(0, 50)), BB.headshots(ids.slice(0, 5))]);
      const list = ids.map(id => names.get(id)?.displayName).filter(Boolean);
      mutualSlot.className = 'bbx-chip bbx-mutuals';
      mutualSlot.title = list.join(', ') + (ids.length > list.length ? ` +${ids.length - list.length} more` : '');
      mutualSlot.replaceChildren(
        el('span', { class: 'bbx-faces bbx-faces-sm' }, ids.slice(0, 5).map(id => el('img', { src: shots.get(id) || undefined, alt: '' }))),
        el('b', { text: ` ${ids.length}` }), ` mutual friend${ids.length === 1 ? '' : 's'}`);
    } catch {
      mutualSlot.remove();
    }
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
