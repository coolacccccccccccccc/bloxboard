// Game cards anywhere on roblox.com: a small "time played" badge on games you've played.

(async () => {
  if (window.__bbxCards) return;
  window.__bbxCards = true;
  const settings = await BB.settings();
  if (!settings.gameCardPlaytime) return;

  const [playtime, games] = await Promise.all([BB.get('playtime', {}), BB.get('games', {})]);
  const byPlace = new Map();
  const total = new Map();
  for (const day of Object.values(playtime)) for (const [u, m] of Object.entries(day)) total.set(u, (total.get(u) || 0) + m);
  for (const [u, g] of Object.entries(games)) if (g.placeId && total.get(u)) byPlace.set(String(g.placeId), total.get(u));
  if (!byPlace.size) return;

  function badge(link) {
    if (link.dataset.bbxPlaytime || link.closest('[id^="bbx-"], .bbx-panel')) return;
    const m = link.href.match(/\/games\/(\d+)/);
    const minutes = m && byPlace.get(m[1]);
    const thumb = link.querySelector('img');
    if (!minutes || !thumb) return;
    link.dataset.bbxPlaytime = '1';
    const host = thumb.parentElement;
    if (getComputedStyle(host).position === 'static') host.style.position = 'relative';
    host.append(BB.el('span', { class: 'bbx-card-time', title: 'Your playtime (Bloxboard)', text: `⏱ ${BB.duration(minutes)}` }));
  }

  const scan = () => document.querySelectorAll('a[href*="/games/"]').forEach(badge);
  let pending = null;
  new MutationObserver(() => {
    clearTimeout(pending);
    pending = setTimeout(scan, 400);
  }).observe(document.body, { childList: true, subtree: true });
  scan();
})();
