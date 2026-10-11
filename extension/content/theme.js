// Optional roblox.com themes (Settings → Theme). Off by default.
// Recolors the page background, header and primary buttons; Roblox's own layout stays as is.

(async () => {
  if (window.__bbxTheme) return;
  window.__bbxTheme = true;
  const { theme } = await BB.settings();
  const THEMES = {
    midnight: { bg: '#0b1020', bg2: '#11182c', header: '#0e1426', accent: '#7c8cff', ink: '#0b1020' },
    ocean: { bg: '#071e33', bg2: '#0b3050', header: '#08243d', accent: '#38bdf8', ink: '#04121f' },
    forest: { bg: '#0c1a13', bg2: '#12281d', header: '#0e2017', accent: '#34d399', ink: '#05140c' },
    grape: { bg: '#170e24', bg2: '#22143a', header: '#1b1030', accent: '#c084fc', ink: '#140a22' },
    sakura: { bg: '#fff4f7', bg2: '#ffe4ec', header: '#ffffff', accent: '#e8458b', ink: '#ffffff', light: true },
  };
  const t = THEMES[theme];
  if (!t) return;
  // Dark themes only apply on Roblox's dark mode and Sakura only on light mode,
  // so text always stays readable on the new background.
  const b = t.light ? 'body.light-theme' : 'body.dark-theme';
  const style = document.createElement('style');
  style.id = 'bbx-theme';
  style.textContent = `
    html:has(${b}), ${b}, ${b} #wrap, ${b} #container-main, ${b} .content, ${b} #content {
      background: linear-gradient(180deg, ${t.bg} 0%, ${t.bg2} 100%) fixed !important;
    }
    ${b} #header, ${b} .rbx-header, ${b} #navigation-container .rbx-left-col, ${b} .rbx-left-col {
      background-color: ${t.header} !important;
    }
    ${b} .btn-primary-md, ${b} .btn-primary-sm, ${b} .btn-primary-lg, ${b} .btn-growth-md, ${b} .btn-growth-lg, ${b} .btn-cta-md, ${b} .btn-cta-lg {
      background-color: ${t.accent} !important; border-color: ${t.accent} !important; color: ${t.ink} !important;
    }
    ${b} .rbx-tab.active { box-shadow: inset 0 -3px 0 ${t.accent} !important; }
    ${b} a.text-link, ${b} .text-link { color: ${t.accent} !important; }
  `;
  (document.head || document.documentElement).append(style);
})();
