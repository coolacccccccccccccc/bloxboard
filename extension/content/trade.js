// Trade pages: live values inside Roblox's trade window and trade details.
// - A total under each side (value, RAP, warnings), updated as items change.
// - A summary bar: you give / you get / win or loss.
// - A lowball warning before sending, countering or accepting a trade you'd lose on.

(async () => {
  if (window.__bbxTrade) return;
  window.__bbxTrade = true;
  const { el, num } = BB;
  const settings = await BB.settings();
  const values = await BB.values().catch(() => ({}));
  if (!values || values.error) return;

  const OFFER = '.trade-request-window-offer, .trade-list-detail-offer, [class*="trade-request-window-offer"], [class*="trade-list-detail-offer"], [data-bbx-offer]';
  const ACTION = /^(make offer|send|send offer|accept|counter|confirm)$/i;
  let last = null; // latest computed summary
  let bypass = false;

  function readOffer(offer) {
    const ids = [];
    for (const a of offer.querySelectorAll('a[href*="/catalog/"]')) {
      const m = a.href.match(/\/catalog\/(\d+)/);
      if (m) ids.push(Number(m[1]));
    }
    // One link per item card; de-duplicate links inside the same card.
    const cards = offer.querySelectorAll('.item-card-container, .item-card, [class*="item-card-container"]');
    const items = cards.length
      ? [...cards].map(c => Number(c.querySelector('a[href*="/catalog/"]')?.href.match(/\/catalog\/(\d+)/)?.[1])).filter(Boolean)
      : [...new Set(ids)];
    let robux = 0;
    const robuxLabel = [...offer.querySelectorAll('*')].find(n => n.childElementCount === 0 && /robux offered/i.test(n.textContent));
    if (robuxLabel) {
      const m = robuxLabel.parentElement.textContent.replace(/robux offered/i, '').match(/[\d,]+/);
      if (m) robux = Number(m[0].replace(/,/g, ''));
    }
    return { items, robux };
  }

  function worth({ items, robux }) {
    let value = 0;
    let rap = 0;
    const warnings = [];
    for (const id of items) {
      const row = values[id];
      if (!row) continue;
      value += BB.itemWorth(row);
      rap += Math.max(row[2], 0);
      if (row[7] === 1) warnings.push(`${row[0]} is projected`);
      else if (row[5] === 0) warnings.push(`${row[0]} has terrible demand`);
    }
    return { value, rap, robux, total: value + robux * 0.7, warnings };
  }

  // Which side is "you give"? Use the offer's own heading, else the order on the page.
  function isGive(offer, index) {
    const text = (offer.querySelector('h1, h2, h3, h4, .text-label, [class*="header"]')?.textContent || offer.textContent.slice(0, 120)).toLowerCase();
    if (/receive|request|they give|get/.test(text)) return false;
    if (/give|your offer|you gave/.test(text)) return true;
    return index === 0;
  }

  function scan() {
    const offers = [...document.querySelectorAll(OFFER)].filter(o => !o.parentElement.closest(OFFER) && o.offsetParent !== null);
    if (offers.length < 2) {
      document.getElementById('bbx-trade-bar')?.remove();
      last = null;
      return;
    }
    let give = null;
    let get = null;
    offers.slice(0, 2).forEach((offer, i) => {
      const w = worth(readOffer(offer));
      if (isGive(offer, i)) give = w; else get = w;
      let line = offer.querySelector(':scope > .bbx-trade-line');
      if (!line) {
        line = el('div', { class: 'bbx-trade-line' });
        offer.append(line);
      }
      line.replaceChildren(...[
        el('span', { class: 'bbx-brand', text: 'Bloxboard' }),
        el('span', { class: 'bbx-chip' }, el('b', { text: num(Math.round(w.total)) }), ' value'),
        el('span', { class: 'bbx-chip' }, el('b', { text: num(w.rap) }), ' RAP'),
        w.robux ? el('span', { class: 'bbx-chip' }, el('b', { text: num(w.robux) }), ' Robux (70% counted)') : null,
        ...w.warnings.slice(0, 3).map(t => el('span', { class: 'bbx-tag bbx-tag-bad', text: t })),
      ].filter(Boolean));
    });
    give ??= { total: 0, warnings: [] };
    get ??= { total: 0, warnings: [] };
    const diff = get.total - give.total;
    const pct = give.total ? (diff / give.total) * 100 : (get.total ? 100 : 0);
    last = { give, get, diff, pct };

    let bar = document.getElementById('bbx-trade-bar');
    if (!bar) {
      bar = el('div', { id: 'bbx-trade-bar', class: 'bbx-panel bbx-strip' });
      offers[0].parentElement.insertBefore(bar, offers[0]);
    }
    bar.classList.toggle('bbx-dark', BBX_isDark());
    bar.replaceChildren(...[
      el('span', { class: 'bbx-brand', text: 'Bloxboard' }),
      el('span', { class: 'bbx-chip' }, 'You give ', el('b', { text: num(Math.round(give.total)) })),
      el('span', { class: 'bbx-chip' }, 'You get ', el('b', { text: num(Math.round(get.total)) })),
      el('span', { class: `bbx-tag ${diff > 0 ? 'bbx-tag-good' : diff < 0 ? 'bbx-tag-bad' : ''}`, text: `${diff >= 0 ? 'Win' : 'Loss'} ${diff > 0 ? '+' : ''}${num(Math.round(diff))} (${pct > 0 ? '+' : ''}${pct.toFixed(0)}%)` }),
      get.warnings.length ? el('span', { class: 'bbx-tag bbx-tag-warn', text: `${get.warnings.length} warning${get.warnings.length === 1 ? '' : 's'} on what you get` }) : null,
    ].filter(Boolean));
    const dark = BBX_isDark();
    document.querySelectorAll('.bbx-trade-line').forEach(l => l.classList.toggle('bbx-dark', dark));
  }

  // ---------- lowball warning ----------

  function warnModal(button) {
    const { give, get, diff, pct } = last;
    const reasons = [];
    if (pct <= -settings.tradeWarnPct) reasons.push(`You lose ${num(Math.round(-diff))} value (${pct.toFixed(0)}%).`);
    for (const w of get.warnings) reasons.push(w);
    const overlay = el('div', { class: 'bbx-modal-bg' });
    const modal = el('div', { class: `bbx-panel bbx-modal${BBX_isDark() ? ' bbx-dark' : ''}`, role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'bbx-modal-title' },
      el('h2', { id: 'bbx-modal-title', text: 'Check this trade first' }),
      el('p', { class: 'bbx-muted', text: `You give ${num(Math.round(give.total))} and get ${num(Math.round(get.total))}.` }),
      el('ul', {}, reasons.map(r => el('li', { text: r }))),
      el('div', { class: 'bbx-toolbar', style: { justifyContent: 'flex-end', marginTop: '14px' } },
        el('button', { class: 'bbx-btn bbx-ghost', type: 'button', text: 'Go back', onclick: () => overlay.remove() }),
        el('button', { class: 'bbx-btn bbx-danger', type: 'button', text: `${button.textContent.trim()} anyway`, onclick: () => { overlay.remove(); bypass = true; button.click(); bypass = false; } })));
    overlay.append(modal);
    overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });
    document.body.append(overlay);
    modal.querySelector('button').focus();
  }

  document.addEventListener('click', (e) => {
    if (bypass || !settings.tradeWarn || !last) return;
    const button = e.target.closest('button, a.btn-primary-md, [role="button"]');
    if (!button || !ACTION.test(button.textContent.trim())) return;
    const risky = last.pct <= -settings.tradeWarnPct || last.get.warnings.length > 0;
    if (!risky) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    warnModal(button);
  }, true);

  let pending = null;
  const obs = new MutationObserver((records) => {
    if (records.every(r => [...r.addedNodes, ...r.removedNodes].every(n => n.nodeType !== 1 || n.closest?.('.bbx-trade-line, #bbx-trade-bar') || n.classList?.contains('bbx-trade-line')))) return;
    clearTimeout(pending);
    pending = setTimeout(scan, 300);
  });
  obs.observe(document.body, { childList: true, subtree: true });
  scan();
})();
