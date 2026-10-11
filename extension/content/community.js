// On bloxboard.enesserver.dev: tell the community site the extension is installed,
// and handle "Try it on" buttons by opening the outfit in the dashboard's avatar sandbox.
document.documentElement.dataset.bloxboard = chrome.runtime.getManifest().version;

document.addEventListener('click', (e) => {
  const btn = e.target.closest('[data-bbx-tryon]');
  if (!btn) return;
  e.preventDefault();
  chrome.runtime.sendMessage({ type: 'openDashboard', hash: `sandbox/import/${btn.dataset.bbxTryon}` });
});
