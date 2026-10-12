// Optional roblox.com themes (Settings → roblox.com theme). Off by default.
// Roblox's newer pages are colored through its design tokens (--color-surface-*, --color-action-*);
// overriding those recolors cards, menus and buttons everywhere. Older parts get a few direct rules.
// A dark theme switches Roblox to its dark mode (Sakura to light mode), so text stays readable.

(async () => {
  if (window.__bbxTheme) return;
  window.__bbxTheme = true;
  const { theme } = await BB.settings();
  const THEMES = {
    midnight: { bg: '#0b1020', bg2: '#11182c', s1: '#141c33', s2: '#1a2340', s3: '#212b4d', header: '#0e1426', accent: '#7c8cff', ink: '#0b1020' },
    ocean: { bg: '#071e33', bg2: '#0b3050', s1: '#0b2945', s2: '#0f3354', s3: '#143d63', header: '#08243d', accent: '#38bdf8', ink: '#04121f' },
    forest: { bg: '#0c1a13', bg2: '#12281d', s1: '#13241b', s2: '#182e22', s3: '#1e3829', header: '#0e2017', accent: '#34d399', ink: '#05140c' },
    grape: { bg: '#170e24', bg2: '#22143a', s1: '#1f1432', s2: '#28193f', s3: '#311f4d', header: '#1b1030', accent: '#c084fc', ink: '#140a22' },
    sakura: { bg: '#fff4f7', bg2: '#ffe4ec', s1: '#fff9fb', s2: '#ffffff', s3: '#ffeef3', header: '#ffffff', accent: '#e8458b', ink: '#ffffff', light: true },
  };
  const t = THEMES[theme];
  if (!t) return;

  const mode = t.light ? 'light' : 'dark';
  const other = t.light ? 'dark' : 'light';
  const b = `body.${mode}-theme`;

  // Keep Roblox in the theme's mode (it sets these classes on <body> when the page loads).
  function forceMode() {
    const body = document.body;
    if (!body) return;
    if (body.classList.contains(`${other}-theme`) || !body.classList.contains(`${mode}-theme`)) {
      body.classList.remove(`${other}-theme`, `color-mode-${other}`);
      body.classList.add(`${mode}-theme`, `color-mode-${mode}`);
    }
  }
  const watchBody = () => {
    forceMode();
    new MutationObserver(forceMode).observe(document.body, { attributes: true, attributeFilter: ['class'] });
  };
  if (document.body) watchBody();
  else new MutationObserver((_, obs) => { if (document.body) { obs.disconnect(); watchBody(); } }).observe(document.documentElement, { childList: true });

  const soft = `color-mix(in srgb, ${t.accent} ${t.light ? 22 : 30}%, transparent)`;
  const style = document.createElement('style');
  style.id = 'bbx-theme';
  style.textContent = `
    /* Roblox design tokens (newer pages: home, game pages, menus, Foundation buttons) */
    ${b}, ${b} .${mode}-theme {
      --color-surface-0: ${t.bg} !important;
      --color-surface-100: ${t.s1} !important;
      --color-surface-200: ${t.s2} !important;
      --color-surface-300: ${t.s3} !important;
      --color-navigation-background: ${t.header} !important;
      --color-system-emphasis: ${t.accent} !important;
      --color-action-emphasis-background: ${t.accent} !important;
      --color-action-emphasis-border: ${t.accent} !important;
      --color-action-emphasis-foreground: ${t.ink} !important;
      --color-action-soft-emphasis-background: ${soft} !important;
      --color-action-link-foreground: ${t.accent} !important;
      --color-over-media-0: color-mix(in srgb, ${t.bg} 92%, transparent) !important;
    }
    /* Page background */
    html:has(${b}), ${b}, ${b} #wrap, ${b} #container-main, ${b} .content, ${b} #content {
      background: linear-gradient(180deg, ${t.bg} 0%, ${t.bg2} 100%) fixed !important;
    }
    /* Header and side menu */
    ${b} #header, ${b} .rbx-header, ${b} #header .navbar-search, ${b} #navigation-container .rbx-left-col, ${b} .rbx-left-col {
      background-color: ${t.header} !important;
    }
    /* Older panels: tabs, sections, dropdowns */
    ${b} #horizontal-tabs, ${b} .nav-tabs, ${b} .rbx-tab-heading, ${b} .section-content, ${b} .dropdown-menu, ${b} .popover, ${b} .rbx-popover-content, ${b} .modal-content {
      background-color: ${t.s1} !important;
    }
    ${b} .rbx-tab.active, ${b} .rbx-tab-heading.active { box-shadow: inset 0 -3px 0 ${t.accent} !important; }
    /* Older buttons in every size */
    ${b} [class*="btn-primary-"], ${b} [class*="btn-growth-"], ${b} [class*="btn-cta-"] {
      background-color: ${t.accent} !important; border-color: ${t.accent} !important; color: ${t.ink} !important;
    }
    ${b} [class*="btn-primary-"] .icon, ${b} [class*="btn-growth-"] .icon { filter: none; }
    ${b} a.text-link, ${b} .text-link, ${b} a.text-name { color: ${t.accent} !important; }
    ${b} ::selection { background: ${soft}; }
  `;
  (document.head || document.documentElement).append(style);
})();
