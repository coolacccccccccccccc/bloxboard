// Catalog item page: value card for limiteds (Rolimons value, RAP, demand, trend, flags).

(async () => {
  const m = location.pathname.match(/\/catalog\/(\d+)/);
  if (!m || document.getElementById('bbx-item')) return;
  const ITEM_ID = m[1];
  const { el, num } = BB;

  const values = await BB.values().catch(() => null);
  const row = values && !values.error ? values[ITEM_ID] : null;
  if (!row) return; // not a limited

  const [name, acronym, rap, value, , demand, trend, projected, hyped, rare] = row;
  const TREND = ['Lowering', 'Unstable', 'Stable', 'Raising', 'Fluctuating'];
  const chip = (label, v, title) => el('span', { class: 'bbx-chip', title }, el('b', { text: v }), ` ${label}`);

  const card = el('section', { id: 'bbx-item', class: 'bbx-panel bbx-strip' },
    el('span', { class: 'bbx-brand', text: 'Bloxboard' }),
    el('div', { class: 'bbx-stats' },
      chip('value', value > 0 ? num(value) : '–', 'Rolimons value'),
      chip('RAP', num(rap), 'Recent average price'),
      demand >= 0 ? chip('demand', BB.DEMAND[demand]) : null,
      trend >= 0 ? chip('trend', TREND[trend]) : null,
      acronym ? chip('', acronym, name) : null,
      projected === 1 ? el('span', { class: 'bbx-tag bbx-tag-bad', text: 'Projected' }) : null,
      hyped === 1 ? el('span', { class: 'bbx-tag bbx-tag-warn', text: 'Hyped' }) : null,
      rare === 1 ? el('span', { class: 'bbx-tag', text: 'Rare' }) : null),
    el('a', { class: 'bbx-link', href: `https://www.rolimons.com/item/${ITEM_ID}`, target: '_blank', rel: 'noopener', text: 'Rolimons ↗' }));

  function mount() {
    const anchor = document.querySelector('#item-details, .item-details-section, [class*="item-details-info"], .item-details, #item-container .border-bottom');
    card.classList.toggle('bbx-dark', BBX_isDark());
    if (anchor?.parentElement) {
      if (card.previousElementSibling !== anchor) anchor.after(card);
      return true;
    }
    return false;
  }

  let tries = 0;
  const iv = setInterval(() => {
    tries++;
    if (mount() && tries > 20) clearInterval(iv);
    if (tries > 40) {
      clearInterval(iv);
      if (!card.isConnected) {
        card.classList.add('bbx-floating');
        card.classList.toggle('bbx-dark', BBX_isDark());
        document.body.append(card);
      }
    }
  }, 500);
})();
