// Bloxboard Community: feed, posts (scripts, outfits, posts), applying, admin.
// Talks to the hub API at /api (CT116). Everything user-written is rendered as text, never HTML.

const view = document.getElementById('view');
const account = document.getElementById('account');
let me = null; // { user, application, loginReady, devLogin }

// ---------- helpers ----------

function el(tag, attrs = {}, ...children) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === 'class') n.className = v;
    else if (k === 'text') n.textContent = v;
    else if (k === 'html') n.innerHTML = v; // only used with our own escaped output
    else if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
    else n.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat(Infinity)) if (c != null && c !== false) n.append(c instanceof Node ? c : String(c));
  return n;
}

async function api(path, opts = {}) {
  const res = await fetch(`/api${path}`, {
    method: opts.method || 'GET',
    credentials: 'same-origin',
    headers: opts.body && !(opts.body instanceof FormData) ? { 'Content-Type': 'application/json' } : undefined,
    body: opts.body instanceof FormData ? opts.body : opts.body ? JSON.stringify(opts.body) : undefined,
  });
  let data = null;
  try { data = await res.json(); } catch { /* empty */ }
  if (!res.ok) {
    const err = new Error(data?.detail || `Something went wrong (HTTP ${res.status}).`);
    err.status = res.status;
    throw err;
  }
  return data;
}

const escapeHtml = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function ago(ts) {
  const s = Math.max(0, Date.now() / 1000 - ts);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  if (s < 86400 * 30) return `${Math.floor(s / 86400)}d ago`;
  return new Date(ts * 1000).toLocaleDateString();
}

const TYPE_LABEL = { script: 'Script', outfit: 'Outfit', post: 'Post' };
const avatar = (url, cls = '') => el('img', { src: url || '../icon.png', alt: '', class: cls, loading: 'lazy' });
const author = a => el('a', { class: 'author', href: `#/u/${a.id}` }, avatar(a.avatar), a.displayName || a.name || `User ${a.id}`);

// Luau syntax highlighting: comments, strings, numbers, keywords, common globals.
const KEYWORDS = new Set('and break continue do else elseif end export false for function if in local nil not or repeat return then true type typeof until while'.split(' '));
const GLOBALS = new Set('game workspace script Instance Vector3 Vector2 CFrame Color3 BrickColor UDim UDim2 Enum TweenInfo Ray task wait spawn delay print warn error pcall xpcall pairs ipairs next select tostring tonumber math string table require coroutine os tick time setmetatable getmetatable rawget rawset unpack'.split(' '));
function highlight(code) {
  const re = /(--\[(=*)\[[\s\S]*?\]\2\]|--[^\n]*)|("(?:\\.|[^"\\\n])*"|'(?:\\.|[^'\\\n])*'|\[(=*)\[[\s\S]*?\]\4\])|(\b0x[0-9a-fA-F]+\b|\b\d+\.?\d*(?:e[+-]?\d+)?\b)|([A-Za-z_][A-Za-z0-9_]*)/g;
  let out = '';
  let last = 0;
  for (const m of code.matchAll(re)) {
    out += escapeHtml(code.slice(last, m.index));
    const t = escapeHtml(m[0]);
    if (m[1]) out += `<span class="hl-c">${t}</span>`;
    else if (m[3]) out += `<span class="hl-s">${t}</span>`;
    else if (m[5]) out += `<span class="hl-n">${t}</span>`;
    else if (KEYWORDS.has(m[6])) out += `<span class="hl-k">${t}</span>`;
    else if (GLOBALS.has(m[6])) out += `<span class="hl-b">${t}</span>`;
    else out += t;
    last = m.index + m[0].length;
  }
  out += escapeHtml(code.slice(last));
  // One span per line so CSS can number them; keep multi-line spans intact by splitting on raw newlines.
  return out.split('\n').map(l => `<span class="ln">${l || ' '}</span>`).join('');
}

function codeBlock(code, maxLines) {
  const shown = maxLines ? code.split('\n').slice(0, maxLines).join('\n') : code;
  const pre = el('pre', { class: 'code' });
  if (!maxLines) {
    const copy = el('button', { class: 'btn xs ghost copy', type: 'button', text: 'Copy' });
    copy.onclick = async () => {
      try { await navigator.clipboard.writeText(code); copy.textContent = 'Copied'; } catch { copy.textContent = 'Select and copy'; }
      setTimeout(() => { copy.textContent = 'Copy'; }, 1500);
    };
    pre.append(copy);
  }
  pre.append(el('code', { html: highlight(shown) }));
  return pre;
}

// Plain text with paragraphs, `code`, **bold** and safe https links.
function richText(text) {
  const html = escapeHtml(text)
    .replace(/`([^`\n]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>')
    .replace(/(https:\/\/[^\s<]+[^\s<.,!?)])/g, '<a href="$1" target="_blank" rel="nofollow ugc noopener">$1</a>');
  return el('div', { class: 'body-text', html: html.split(/\n{2,}/).map(p => `<p>${p.replace(/\n/g, '<br>')}</p>`).join('') });
}

const hasExtension = () => document.documentElement.dataset.bloxboard != null;
const loginUrl = () => `/api/auth/login?r=${encodeURIComponent('/community/')}`;

function rememberRoute() {
  try { sessionStorage.setItem('bbx-return', location.hash); } catch { /* storage blocked */ }
}

// ---------- header ----------

function renderAccount() {
  document.querySelector('[data-nav="admin"]').hidden = !me?.user?.isAdmin;
  if (me?.user) {
    const u = me.user;
    account.replaceChildren(
      el('a', { class: 'who', href: `#/u/${u.id}` }, avatar(u.avatar), el('span', { text: u.displayName || u.name })),
      el('button', { class: 'btn xs ghost', type: 'button', text: 'Log out', onclick: async () => { await api('/auth/logout', { method: 'POST' }); await loadMe(); route(); } }));
  } else if (me?.loginReady) {
    account.replaceChildren(el('a', { class: 'btn sm', href: loginUrl(), onclick: rememberRoute, text: 'Sign in with Roblox' }));
  } else {
    account.replaceChildren(el('span', { class: 'small muted', text: 'Login coming soon' }));
  }
  if (me?.devLogin && !me.user) {
    account.append(el('a', { class: 'btn xs ghost', href: `/api/auth/dev?id=1001&name=tester&r=${encodeURIComponent('/community/')}`, text: 'Test login' }));
  }
}

async function loadMe() {
  try { me = await api('/me'); } catch { me = { user: null }; }
  renderAccount();
}

function canPost() {
  return me?.user?.status === 'approved';
}

function postGate() {
  if (!me?.user) {
    return el('div', { class: 'notice' },
      el('p', { style: 'margin:0 0 10px', text: 'Sign in with your Roblox account to like, comment and apply to post.' }),
      me?.loginReady ? el('a', { class: 'btn sm', href: loginUrl(), onclick: rememberRoute, text: 'Sign in with Roblox' }) : el('span', { class: 'small muted', text: 'Roblox login is being set up.' }));
  }
  const s = me.user.status;
  if (s === 'banned') return el('div', { class: 'notice bad', text: 'Your account can\'t post here.' });
  if (s === 'pending') return el('div', { class: 'notice warn', text: 'Your application is waiting for an admin. You can post as soon as it\'s approved.' });
  return el('div', { class: 'notice' },
    el('p', { style: 'margin:0 0 10px', text: s === 'rejected' ? `Your application wasn't approved${me.application?.note ? `: ${me.application.note}` : '.'} You can apply again.` : 'Anyone can read. To post and comment, send a short application first.' }),
    el('a', { class: 'btn sm', href: '#/apply', text: 'Apply to post' }));
}

// ---------- pages ----------

const pages = {};

pages.feed = async (params) => {
  const state = { type: params.get('type') || '', sort: params.get('sort') || 'new', q: params.get('q') || '', tag: params.get('tag') || '', page: 0 };
  const setParam = (k, v) => {
    const p = new URLSearchParams(params);
    if (v) p.set(k, v); else p.delete(k);
    location.hash = `#/?${p}`;
  };
  const seg = (options, current, key) => el('div', { class: 'seg', role: 'group' }, options.map(([v, t]) => el('button', { type: 'button', 'aria-pressed': String(v === current), text: t, onclick: () => setParam(key, v) })));
  const search = el('input', { class: 'input', type: 'search', placeholder: 'Search posts', value: state.q });
  search.addEventListener('keydown', (e) => { if (e.key === 'Enter') setParam('q', search.value.trim()); });
  const grid = el('div', { class: 'feed' }, el('p', { class: 'empty', text: 'Loading…' }));
  const more = el('button', { class: 'btn ghost', type: 'button', text: 'Load more', hidden: true });

  view.append(el('section', { class: 'page' },
    el('div', { class: 'page-head' },
      el('div', {}, el('div', { class: 'eyebrow', text: 'Bloxboard Community' }), el('h1', { text: 'Scripts, outfits and posts' }),
        el('p', { text: 'Share Roblox Studio scripts, outfits you made in the avatar sandbox, and anything else Roblox.' })),
      canPost() ? el('a', { class: 'btn sm', href: '#/new', text: 'New post' }) : null),
    canPost() ? null : postGate(),
    el('div', { class: 'toolbar' },
      seg([['', 'Everything'], ['script', 'Scripts'], ['outfit', 'Outfits'], ['post', 'Posts']], state.type, 'type'),
      seg([['new', 'New'], ['top', 'Top']], state.sort, 'sort'),
      search,
      state.tag ? el('a', { class: 'tag', href: '#/', text: `#${state.tag} ✕` }) : null),
    grid, more));

  async function load(append) {
    const p = new URLSearchParams({ sort: state.sort, page: String(state.page) });
    if (state.type) p.set('type', state.type);
    if (state.q) p.set('q', state.q);
    if (state.tag) p.set('tag', state.tag);
    try {
      const { posts, more: hasMore } = await api(`/posts?${p}`);
      if (!append) grid.replaceChildren();
      grid.append(...posts.map(postCard));
      if (!grid.children.length) grid.replaceChildren(el('p', { class: 'empty', text: state.q || state.tag || state.type ? 'Nothing matches that yet.' : 'No posts yet. Be the first!' }));
      more.hidden = !hasMore;
    } catch (e) {
      grid.replaceChildren(el('p', { class: 'error-text', text: e.message }));
    }
  }
  more.onclick = () => { state.page += 1; load(true); };
  await load(false);
};

function postCard(p) {
  let media = null;
  if (p.type === 'script' && p.code) media = codeBlock(p.code, 6);
  else if (p.type === 'outfit') {
    media = el('div', { class: 'media outfit' });
    const noPreview = () => media.replaceChildren(el('span', { class: 'no-preview', text: `${p.outfit?.assets?.length || 0} items · no preview` }));
    if (p.outfit?.preview) media.append(el('img', { src: p.outfit.preview, alt: '', loading: 'lazy', onerror: noPreview }));
    else noPreview();
  }
  else if (p.image) media = el('div', { class: 'media' }, el('img', { src: p.image, alt: '', loading: 'lazy' }));
  return el('a', { class: 'card post-card', href: `#/post/${p.id}` },
    el('div', { class: 'meta' }, el('span', { class: `type ${p.type}`, text: TYPE_LABEL[p.type] }), el('span', { text: ago(p.createdAt) })),
    el('h3', { text: p.title }),
    media,
    p.body && p.type !== 'script' ? el('p', { class: 'excerpt', text: p.body }) : null,
    el('div', { class: 'meta' },
      el('span', { class: 'author' }, avatar(p.author.avatar), p.author.displayName || p.author.name),
      el('span', { text: `♥ ${p.likes}` }), el('span', { text: `💬 ${p.comments}` })));
}

pages.post = async (params, id) => {
  const { post: p, comments } = await api(`/posts/${id}`);
  document.title = `${p.title} · Bloxboard Community`;

  const likeBtn = el('button', { class: 'btn sm ghost like', type: 'button', 'aria-pressed': String(p.liked), text: `♥ ${p.likes}` });
  likeBtn.onclick = async () => {
    if (!me?.user) { location.href = loginUrl(); return; }
    const r = await api(`/posts/${p.id}/like`, { method: 'POST' });
    likeBtn.setAttribute('aria-pressed', String(r.liked));
    likeBtn.textContent = `♥ ${r.likes}`;
  };

  const main = el('div', { class: 'post-main' },
    el('div', { class: 'meta' }, el('span', { class: `type ${p.type}`, text: TYPE_LABEL[p.type] }), author(p.author), el('span', { text: ago(p.createdAt) })),
    el('h1', { text: p.title }),
    p.tags.length ? el('div', { class: 'tags' }, p.tags.map(t => el('a', { class: 'tag', href: `#/?tag=${encodeURIComponent(t)}`, text: `#${t}` }))) : null,
    p.image ? el('img', { class: 'post-image', src: p.image, alt: '' }) : null,
    p.body ? richText(p.body) : null,
    p.type === 'script' && p.code ? codeBlock(p.code) : null);

  const side = el('aside', { class: 'side' });
  if (p.type === 'outfit' && p.outfit) {
    const o = p.outfit;
    const encoded = btoa(unescape(encodeURIComponent(JSON.stringify(o))));
    side.append(el('div', { class: 'card' },
      o.preview ? el('div', { class: 'outfit-preview' }, el('img', { src: o.preview, alt: `${p.title} outfit preview`, onerror: (e) => e.target.parentElement.remove() })) : null,
      el('div', { class: 'actions', style: 'margin-top:12px' },
        hasExtension()
          ? el('button', { class: 'btn sm', type: 'button', 'data-bbx-tryon': encoded, text: 'Try it on' })
          : el('a', { class: 'btn sm', href: '../#install', text: 'Get Bloxboard to try it on' }),
        el('button', { class: 'btn sm ghost', type: 'button', text: 'Copy item IDs', onclick: async (e) => {
          try { await navigator.clipboard.writeText(o.assets.map(a => a.id).join(', ')); e.target.textContent = 'Copied'; } catch { e.target.textContent = 'Copy failed'; }
        } })),
      el('h3', { style: 'margin:16px 0 8px;font-size:16px', text: `${o.assets.length} items` }),
      el('div', { class: 'items' }, o.assets.map(a => el('a', { href: `https://www.roblox.com/catalog/${a.id}`, target: '_blank', rel: 'noopener' }, el('span', { text: a.name || `Item ${a.id}` }), el('span', { class: 'muted', text: '↗' }))))));
  }
  side.append(el('div', { class: 'card actions' },
    likeBtn,
    me?.user && !p.mine ? el('button', { class: 'btn sm ghost', type: 'button', text: 'Report', onclick: () => reportDialog('post', p.id) }) : null,
    p.mine || me?.user?.isAdmin ? el('button', { class: 'btn sm ghost', type: 'button', text: 'Delete', onclick: async (e) => {
      if (e.target.dataset.armed !== '1') { e.target.dataset.armed = '1'; e.target.textContent = 'Click again to delete'; return; }
      await api(`/posts/${p.id}`, { method: 'DELETE' });
      location.hash = '#/';
    } }) : null));

  const commentList = el('div', { class: 'comments' }, comments.map(commentNode));
  const commentBox = el('div', {});
  if (canPost()) {
    const ta = el('textarea', { class: 'input', placeholder: 'Write a comment', maxlength: '1000', style: 'min-height:80px' });
    const err = el('p', { class: 'error-text' });
    commentBox.append(el('form', { class: 'form', onsubmit: async (e) => {
      e.preventDefault();
      err.textContent = '';
      try {
        await api(`/posts/${p.id}/comments`, { method: 'POST', body: { body: ta.value } });
        route();
      } catch (ex) { err.textContent = ex.message; }
    } }, ta, err, el('div', {}, el('button', { class: 'btn sm', type: 'submit', text: 'Comment' }))));
  } else {
    commentBox.append(postGate());
  }

  view.append(el('section', { class: 'page' },
    el('a', { href: '#/', class: 'small', text: '← Back to the community' }),
    el('div', { class: 'post-view' }, main, side),
    el('h2', { style: 'font-size:22px', text: `Comments (${comments.length})` }),
    commentList, commentBox));
};

function commentNode(c) {
  return el('div', { class: 'comment' },
    avatar(c.author.avatar),
    el('div', { class: 'bubble' },
      el('div', { class: 'meta' }, author(c.author), el('span', { text: ago(c.createdAt) }),
        me?.user && !c.mine ? el('a', { href: '#', class: 'small', text: 'Report', onclick: (e) => { e.preventDefault(); reportDialog('comment', c.id); } }) : null,
        c.mine || me?.user?.isAdmin ? el('a', { href: '#', class: 'small', text: 'Delete', onclick: async (e) => { e.preventDefault(); await api(`/comments/${c.id}`, { method: 'DELETE' }); route(); } }) : null),
      el('p', { text: c.body })));
}

function reportDialog(type, id) {
  const reason = el('textarea', { class: 'input', maxlength: '300', placeholder: 'What\'s wrong with it?', style: 'min-height:80px' });
  const err = el('p', { class: 'error-text' });
  const dlg = el('dialog', { class: 'card', style: 'max-width:420px;width:calc(100% - 32px);border:1px solid var(--line);color:var(--ink)' },
    el('form', { class: 'form', method: 'dialog', onsubmit: async (e) => {
      e.preventDefault();
      try {
        await api('/reports', { method: 'POST', body: { targetType: type, targetId: id, reason: reason.value } });
        dlg.replaceChildren(el('p', { text: 'Thanks. An admin will take a look.' }), el('button', { class: 'btn sm', type: 'button', text: 'Close', onclick: () => dlg.close() }));
      } catch (ex) { err.textContent = ex.message; }
    } },
    el('h2', { style: 'font-size:20px', text: `Report this ${type}` }), reason, err,
    el('div', { class: 'actions' }, el('button', { class: 'btn sm', type: 'submit', text: 'Send report' }), el('button', { class: 'btn sm ghost', type: 'button', text: 'Cancel', onclick: () => dlg.close() }))));
  dlg.addEventListener('close', () => dlg.remove());
  document.body.append(dlg);
  dlg.showModal();
}

pages.new = async (params) => {
  view.append(el('section', { class: 'page' }, el('div', { class: 'page-head' }, el('div', {}, el('h1', { text: 'New post' })))));
  const page = view.querySelector('.page');
  if (!canPost()) { page.append(postGate()); return; }

  let outfit = null;
  const incoming = params.get('outfit');
  if (incoming) {
    try { outfit = JSON.parse(decodeURIComponent(escape(atob(incoming)))); } catch { outfit = null; }
  }
  let type = outfit ? 'outfit' : (params.get('type') || 'script');
  let image = null;

  const typeSeg = el('div', { class: 'seg', role: 'group' });
  const title = el('input', { class: 'input', maxlength: '100', required: true, placeholder: 'Give it a clear title' });
  const tags = el('input', { class: 'input', placeholder: 'e.g. gui, tween, combat (up to 5)' });
  const body = el('textarea', { class: 'input', maxlength: '5000' });
  const code = el('textarea', { class: 'input code-input', maxlength: '50000', spellcheck: 'false', placeholder: '-- paste your Luau script here' });
  code.addEventListener('keydown', (e) => {
    if (e.key === 'Tab') { e.preventDefault(); const s = code.selectionStart; code.setRangeText('\t', s, code.selectionEnd, 'end'); }
  });
  const outfitCode = el('textarea', { class: 'input code-input', style: 'min-height:90px', placeholder: 'Use "Share" in the Bloxboard avatar sandbox, or paste an outfit code here' });
  const outfitPreview = el('div', {});
  const imageInput = el('input', { type: 'file', accept: 'image/png,image/jpeg,image/webp,image/gif' });
  const imagePreview = el('div', {});
  const err = el('p', { class: 'error-text' });
  const submit = el('button', { class: 'btn', type: 'submit', text: 'Publish' });

  const fields = {
    script: el('label', { class: 'lbl' }, 'Script', el('span', { class: 'hint', text: 'Luau. Explain what it does and where it goes (e.g. a LocalScript in StarterGui) below.' }), code),
    outfit: el('label', { class: 'lbl' }, 'Outfit', outfitCode, outfitPreview),
    image: el('label', { class: 'lbl' }, 'Image (optional)', el('span', { class: 'hint', text: 'PNG, JPG, WebP or GIF up to 5 MB.' }), imageInput, imagePreview),
  };

  function drawOutfit() {
    outfitPreview.replaceChildren(outfit
      ? el('div', { class: 'row' }, outfit.preview ? el('img', { src: outfit.preview, alt: '', style: 'width:96px;height:96px;border-radius:10px;background:var(--sunk);object-fit:contain' }) : null, el('span', { class: 'small muted', text: `${outfit.assets?.length || 0} items ready to share` }))
      : el('span', {}));
    if (outfit && !outfitCode.value) outfitCode.value = btoa(unescape(encodeURIComponent(JSON.stringify(outfit))));
  }
  outfitCode.oninput = () => {
    try { outfit = JSON.parse(decodeURIComponent(escape(atob(outfitCode.value.trim())))); } catch { outfit = null; }
    drawOutfit();
  };
  imageInput.onchange = async () => {
    const f = imageInput.files[0];
    if (!f) return;
    imagePreview.replaceChildren(el('span', { class: 'small muted', text: 'Uploading…' }));
    try {
      const fd = new FormData();
      fd.append('file', f);
      const r = await api('/uploads', { method: 'POST', body: fd });
      image = r.image;
      imagePreview.replaceChildren(el('img', { src: r.url, alt: '', style: 'max-width:240px;border-radius:10px' }));
    } catch (e) {
      imagePreview.replaceChildren(el('span', { class: 'error-text', text: e.message }));
    }
  };

  function drawType() {
    typeSeg.replaceChildren(...[['script', 'Script'], ['outfit', 'Outfit'], ['post', 'Post']].map(([v, t]) => el('button', { type: 'button', 'aria-pressed': String(v === type), text: t, onclick: () => { type = v; drawType(); } })));
    fields.script.hidden = type !== 'script';
    fields.outfit.hidden = type !== 'outfit';
    fields.image.hidden = type !== 'post';
    body.placeholder = type === 'script' ? 'What does it do? How do you use it?' : type === 'outfit' ? 'Tell people about the look (optional)' : 'What do you want to share?';
  }

  page.append(el('form', { class: 'form', onsubmit: async (e) => {
    e.preventDefault();
    err.textContent = '';
    submit.disabled = true;
    try {
      const { id } = await api('/posts', { method: 'POST', body: {
        type, title: title.value, body: body.value, code: type === 'script' ? code.value : null,
        outfit: type === 'outfit' ? outfit : null, image: type === 'post' ? image : null,
        tags: tags.value.split(/[,\s]+/).map(t => t.replace(/^#/, '').toLowerCase()).filter(Boolean),
      } });
      location.hash = `#/post/${id}`;
    } catch (ex) {
      err.textContent = ex.message;
      submit.disabled = false;
    }
  } },
    el('div', { class: 'lbl' }, 'Type', typeSeg),
    el('label', { class: 'lbl' }, 'Title', title),
    fields.script, fields.outfit, fields.image,
    el('label', { class: 'lbl' }, 'Text', body),
    el('label', { class: 'lbl' }, 'Tags', tags),
    err,
    el('div', { class: 'row' }, submit, el('span', { class: 'small muted' }, 'Keep it friendly. ', el('a', { href: '#/rules', text: 'Rules' })))));
  drawType();
  drawOutfit();
};

pages.apply = async () => {
  const page = el('section', { class: 'page' }, el('div', { class: 'page-head' }, el('div', {},
    el('h1', { text: 'Apply to post' }),
    el('p', { text: 'Everyone can read. Posting and commenting are for members, so the community stays friendly. An admin reads every application.' }))));
  view.append(page);
  if (!me?.user || canPost() || ['pending', 'banned'].includes(me.user.status)) {
    page.append(canPost() ? el('div', { class: 'notice', text: 'You can already post. Have fun!' }) : postGate());
    return;
  }
  const why = el('textarea', { class: 'input', maxlength: '600', required: true });
  const share = el('textarea', { class: 'input', maxlength: '600', required: true });
  const discord = el('input', { class: 'input', maxlength: '40', placeholder: 'Optional' });
  const age = el('input', { type: 'checkbox' });
  const rules = el('input', { type: 'checkbox' });
  const err = el('p', { class: 'error-text' });
  page.append(el('form', { class: 'form card', onsubmit: async (e) => {
    e.preventDefault();
    err.textContent = '';
    try {
      await api('/applications', { method: 'POST', body: { why: why.value, share: share.value, discord: discord.value, age13: age.checked, rules: rules.checked } });
      await loadMe();
      route();
    } catch (ex) { err.textContent = ex.message; }
  } },
    el('div', { class: 'row' }, avatar(me.user.avatar, ''), el('b', { text: `Applying as ${me.user.displayName || me.user.name}` })),
    el('label', { class: 'lbl' }, 'Why do you want to post here?', why),
    el('label', { class: 'lbl' }, 'What will you share?', el('span', { class: 'hint', text: 'Scripts, outfits, builds, tips… a sentence or two is enough.' }), share),
    el('label', { class: 'lbl' }, 'Discord username', discord),
    el('label', { class: 'check' }, age, el('span', { text: 'I\'m 13 or older.' })),
    el('label', { class: 'check' }, rules, el('span', {}, 'I read and agree to the ', el('a', { href: '#/rules', target: '_blank', text: 'rules' }), '.')),
    err,
    el('div', {}, el('button', { class: 'btn', type: 'submit', text: 'Send application' }))));
};

pages.rules = async () => {
  view.append(el('section', { class: 'page doc', style: 'max-width:760px' },
    el('h1', { text: 'Community rules' }),
    el('p', { text: 'Short version: be the kind of person you\'d want to meet in a game.' }),
    el('ul', {},
      el('li', { text: 'Be kind. No harassment, hate, slurs or bullying.' }),
      el('li', { text: 'Keep it safe for younger players: nothing sexual, gory or shocking.' }),
      el('li', { text: 'No scams, account selling, "free Robux", phishing links or cookie loggers.' }),
      el('li', { text: 'Only share scripts that are yours or that you have permission to share. Say where you got them.' }),
      el('li', { text: 'No exploits, cheats or scripts that break Roblox\'s rules.' }),
      el('li', { text: 'Don\'t share personal info: real names, addresses, phone numbers, passwords.' }),
      el('li', { text: 'No spam or self-promo floods.' })),
    el('p', { text: 'Breaking these gets your post removed, and repeat or serious breaks get you banned. See something bad? Use the Report button.' })));
};

pages.user = async (params, id) => {
  const { user } = await api(`/users/${id}`);
  const { posts } = await api(`/posts?user=${id}`);
  view.append(el('section', { class: 'page' },
    el('div', { class: 'profile-head' },
      avatar(user.avatar),
      el('div', { class: 'grow' },
        el('h1', { style: 'font-size:32px', text: user.displayName || user.name }),
        el('div', { class: 'meta' }, el('span', { text: `@${user.name}` }), el('span', { text: user.status === 'poster' ? 'Member' : user.status === 'banned' ? 'Banned' : 'Reader' }), el('span', { text: `joined ${ago(user.joined)}` }))),
      el('div', { class: 'kpis' }, el('div', { class: 'kpi' }, el('b', { text: String(user.posts) }), 'posts'), el('div', { class: 'kpi' }, el('b', { text: String(user.likes) }), 'likes')),
      el('a', { class: 'btn sm ghost', href: `https://www.roblox.com/users/${user.id}/profile`, target: '_blank', rel: 'noopener', text: 'Roblox profile ↗' })),
    posts.length ? el('div', { class: 'feed' }, posts.map(postCard)) : el('p', { class: 'empty', text: 'No posts yet.' })));
};

pages.admin = async () => {
  if (!me?.user?.isAdmin) { view.append(el('section', { class: 'page' }, el('p', { class: 'empty', text: 'Admins only.' }))); return; }
  const data = await api('/admin/overview');
  const act = async (path, body) => { await api(path, { method: 'POST', body }); route(); };

  const apps = data.applications.map(a => {
    const note = el('input', { class: 'input', placeholder: 'Note for them (optional, shown if rejected)', maxlength: '300' });
    return el('div', { class: 'card list' },
      el('div', { class: 'row' }, avatar(a.avatar, ''), el('a', { class: 'author', href: `https://www.roblox.com/users/${a.user_id}/profile`, target: '_blank', rel: 'noopener', text: `${a.display_name} (@${a.name}) ↗` }), el('span', { class: 'small muted', text: ago(a.created_at) })),
      el('div', {}, el('b', { text: 'Why: ' }), el('span', { text: a.answers.why })),
      el('div', {}, el('b', { text: 'Will share: ' }), el('span', { text: a.answers.share })),
      a.answers.discord ? el('div', {}, el('b', { text: 'Discord: ' }), el('span', { text: a.answers.discord })) : null,
      note,
      el('div', { class: 'actions' },
        el('button', { class: 'btn sm', type: 'button', text: 'Approve', onclick: () => act(`/admin/applications/${a.id}`, { decision: 'approved', note: note.value }) }),
        el('button', { class: 'btn sm ghost', type: 'button', text: 'Reject', onclick: () => act(`/admin/applications/${a.id}`, { decision: 'rejected', note: note.value }) })));
  });

  const reports = data.reports.map(r => el('div', { class: 'card list' },
    el('div', { class: 'row' }, el('span', { class: `type ${r.target_type === 'post' ? 'script' : 'post'}`, text: r.target_type }), el('span', { class: 'small muted', text: ago(r.created_at) })),
    el('div', {}, el('b', { text: 'Reason: ' }), el('span', { text: r.reason })),
    r.target ? el('div', { class: 'notice', style: 'white-space:pre-wrap', text: r.target.title ? `${r.target.title}\n\n${(r.target.body || '').slice(0, 400)}` : (r.target.body || r.target.display_name || '').slice(0, 400) }) : el('p', { class: 'muted', text: 'Already deleted.' }),
    el('div', { class: 'actions' },
      r.target_type === 'post' && r.target ? el('a', { class: 'btn sm ghost', href: `#/post/${r.target.id}`, text: 'Open' }) : null,
      r.target_type !== 'user' ? el('button', { class: 'btn sm danger', type: 'button', text: 'Remove it', onclick: () => act(`/admin/reports/${r.id}`, { action: 'remove' }) }) : null,
      r.target?.user_id ? el('button', { class: 'btn sm ghost', type: 'button', text: 'Ban author', onclick: () => act(`/admin/users/${r.target.user_id}`, { status: 'banned' }) }) : null,
      el('button', { class: 'btn sm ghost', type: 'button', text: 'Dismiss', onclick: () => act(`/admin/reports/${r.id}`, { action: 'dismiss' }) }))));

  const members = data.members.map(m => el('div', { class: 'row' },
    avatar(m.avatar, ''), el('a', { class: 'author grow', href: `#/u/${m.id}`, text: `${m.display_name} (@${m.name})` }),
    el('span', { class: 'small muted', text: m.status === 'banned' ? 'Banned' : `seen ${ago(m.last_seen)}` }),
    m.status === 'banned'
      ? el('button', { class: 'btn xs ghost', type: 'button', text: 'Unban', onclick: () => act(`/admin/users/${m.id}`, { status: 'approved' }) })
      : el('button', { class: 'btn xs ghost', type: 'button', text: 'Ban', onclick: () => act(`/admin/users/${m.id}`, { status: 'banned' }) })));

  view.append(el('section', { class: 'page' },
    el('div', { class: 'page-head' }, el('div', {}, el('h1', { text: 'Admin' }), el('p', { text: 'Applications, reports and members.' })),
      el('div', { class: 'kpis' }, Object.entries(data.counts).map(([k, v]) => el('div', { class: 'kpi' }, el('b', { text: String(v) }), k)))),
    el('div', { class: 'admin-grid' },
      el('div', { class: 'list' }, el('h2', { style: 'font-size:22px', text: `Applications (${apps.length})` }), apps.length ? apps : el('p', { class: 'muted', text: 'Nothing waiting.' })),
      el('div', { class: 'list' }, el('h2', { style: 'font-size:22px', text: `Reports (${reports.length})` }), reports.length ? reports : el('p', { class: 'muted', text: 'No open reports.' })),
      el('div', { class: 'list card' }, el('h2', { style: 'font-size:22px', text: 'Members' }), members.length ? members : el('p', { class: 'muted', text: 'No members yet.' })))));
};

// ---------- router ----------

let token = 0;
async function route() {
  const mine = ++token;
  const raw = location.hash.replace(/^#\/?/, '');
  const [pathPart, query = ''] = raw.split('?');
  const [name, arg] = pathPart.split('/');
  const params = new URLSearchParams(query);
  const page = { '': 'feed', post: 'post', new: 'new', apply: 'apply', rules: 'rules', u: 'user', admin: 'admin' }[name] || 'feed';
  document.title = 'Bloxboard Community';
  for (const a of document.querySelectorAll('[data-nav]')) {
    if (a.dataset.nav === page) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
  }
  view.replaceChildren();
  try {
    // Status can change while the page is open (approved, banned), so refresh it on every page.
    await loadMe();
    if (mine !== token) return;
    await pages[page](params, arg);
  } catch (e) {
    if (mine === token) view.replaceChildren(el('section', { class: 'page' }, el('p', { class: 'error-text', text: e.message }), el('a', { href: '#/', text: 'Back to the community' })));
  }
  if (mine === token) view.focus({ preventScroll: true });
}

addEventListener('hashchange', route);
(async () => {
  await loadMe();
  let back = null;
  try { back = sessionStorage.getItem('bbx-return'); sessionStorage.removeItem('bbx-return'); } catch { /* storage blocked */ }
  if (back && me?.user && (!location.hash || location.hash === '#/')) location.hash = back;
  route();
})();
