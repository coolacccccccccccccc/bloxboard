// Shared bits for content scripts.

function BBX_isDark() {
  const rgb = getComputedStyle(document.body).backgroundColor.match(/\d+/g);
  if (!rgb || rgb.length < 3 || (rgb.length === 4 && rgb[3] === '0')) {
    return document.body.classList.contains('dark-theme') || document.documentElement.classList.contains('dark-theme');
  }
  const [r, g, b] = rgb.map(Number);
  return (r * 299 + g * 587 + b * 114) / 1000 < 128;
}

// Wake the background worker so it can re-link with the Windows companion if that is running.
try { chrome.runtime.sendMessage({ type: 'companionWake' }).catch(() => {}); } catch {}
