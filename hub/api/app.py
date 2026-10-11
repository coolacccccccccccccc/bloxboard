"""Bloxboard community hub API.

Sign in with Roblox (OAuth 2.0 + PKCE), applications to post, posts (scripts, outfits,
community posts), comments, likes, reports and an admin queue. SQLite + local uploads.

Config (environment):
  BASE_URL              https://bloxboard.enesserver.dev
  ROBLOX_CLIENT_ID      from create.roblox.com -> OAuth 2.0 apps
  ROBLOX_CLIENT_SECRET
  ADMIN_IDS             comma-separated Roblox user ids with admin rights
  DEV_LOGIN             1 = enable /api/auth/dev for testing (never in production)
  DATA_DIR              /data
"""
import base64
import hashlib
import io
import json
import os
import re
import secrets
import sqlite3
import time
import urllib.parse
import urllib.request
from contextlib import contextmanager

from fastapi import FastAPI, HTTPException, Request, Response, UploadFile
from fastapi.responses import FileResponse, RedirectResponse
from PIL import Image

BASE_URL = os.environ.get('BASE_URL', 'https://bloxboard.enesserver.dev').rstrip('/')
CLIENT_ID = os.environ.get('ROBLOX_CLIENT_ID', '')
CLIENT_SECRET = os.environ.get('ROBLOX_CLIENT_SECRET', '')
ADMIN_IDS = {int(x) for x in os.environ.get('ADMIN_IDS', '').replace(' ', '').split(',') if x}
DEV_LOGIN = os.environ.get('DEV_LOGIN') == '1'
DATA_DIR = os.environ.get('DATA_DIR', '/data')
UPLOADS = os.path.join(DATA_DIR, 'uploads')
DB_PATH = os.path.join(DATA_DIR, 'hub.db')
COOKIE = 'bbx_session'
SESSION_DAYS = 30

os.makedirs(UPLOADS, exist_ok=True)
app = FastAPI(docs_url=None, redoc_url=None, openapi_url=None)

# ---------- database ----------

SCHEMA = """
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY, name TEXT, display_name TEXT, avatar TEXT,
  status TEXT NOT NULL DEFAULT 'none',          -- none | pending | approved | rejected | banned
  created_at INTEGER, last_seen INTEGER);
CREATE TABLE IF NOT EXISTS sessions (token TEXT PRIMARY KEY, user_id INTEGER, expires_at INTEGER);
CREATE TABLE IF NOT EXISTS oauth_states (state TEXT PRIMARY KEY, verifier TEXT, return_to TEXT, created_at INTEGER);
CREATE TABLE IF NOT EXISTS applications (
  id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER, answers TEXT, status TEXT DEFAULT 'pending',
  note TEXT, created_at INTEGER, reviewed_at INTEGER, reviewed_by INTEGER);
CREATE TABLE IF NOT EXISTS posts (
  id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER, type TEXT, title TEXT, body TEXT,
  code TEXT, outfit TEXT, image TEXT, tags TEXT, created_at INTEGER, hidden INTEGER DEFAULT 0,
  like_count INTEGER DEFAULT 0, comment_count INTEGER DEFAULT 0);
CREATE TABLE IF NOT EXISTS comments (
  id INTEGER PRIMARY KEY AUTOINCREMENT, post_id INTEGER, user_id INTEGER, body TEXT,
  created_at INTEGER, hidden INTEGER DEFAULT 0);
CREATE TABLE IF NOT EXISTS likes (post_id INTEGER, user_id INTEGER, PRIMARY KEY (post_id, user_id));
CREATE TABLE IF NOT EXISTS reports (
  id INTEGER PRIMARY KEY AUTOINCREMENT, target_type TEXT, target_id INTEGER, user_id INTEGER,
  reason TEXT, status TEXT DEFAULT 'open', created_at INTEGER);
CREATE TABLE IF NOT EXISTS actions (user_id INTEGER, kind TEXT, at INTEGER);
CREATE INDEX IF NOT EXISTS posts_created ON posts(created_at);
CREATE INDEX IF NOT EXISTS comments_post ON comments(post_id);
CREATE INDEX IF NOT EXISTS actions_user ON actions(user_id, kind, at);
"""


@contextmanager
def db():
    conn = sqlite3.connect(DB_PATH, timeout=10)
    conn.row_factory = sqlite3.Row
    conn.execute('PRAGMA foreign_keys = ON')
    try:
        yield conn
        conn.commit()
    finally:
        conn.close()


with db() as c:
    c.execute('PRAGMA journal_mode = WAL')
    c.executescript(SCHEMA)

now = lambda: int(time.time())


# ---------- helpers ----------

def current_user(request: Request, required=True):
    token = request.cookies.get(COOKIE)
    user = None
    if token:
        with db() as c:
            row = c.execute('SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token = ? AND s.expires_at > ?', (token, now())).fetchone()
            if row:
                user = dict(row)
                c.execute('UPDATE users SET last_seen = ? WHERE id = ?', (now(), user['id']))
    if user:
        user['is_admin'] = user['id'] in ADMIN_IDS
        if user['is_admin'] and user['status'] != 'banned':
            user['status'] = 'approved'
    if required and not user:
        raise HTTPException(401, 'Log in with Roblox first.')
    return user


def require_poster(request: Request):
    user = current_user(request)
    if user['status'] == 'banned':
        raise HTTPException(403, 'Your account is banned from posting.')
    if user['status'] != 'approved':
        raise HTTPException(403, 'Apply first. Once an admin approves you, you can post and comment.')
    return user


def require_admin(request: Request):
    user = current_user(request)
    if not user['is_admin']:
        raise HTTPException(403, 'Admins only.')
    return user


LIMITS = {'post': (5, 3600), 'comment': (20, 600), 'report': (10, 3600), 'upload': (10, 3600), 'apply': (3, 86400)}


def rate_limit(user_id, kind):
    count, window = LIMITS[kind]
    with db() as c:
        n = c.execute('SELECT COUNT(*) FROM actions WHERE user_id = ? AND kind = ? AND at > ?', (user_id, kind, now() - window)).fetchone()[0]
        if n >= count:
            raise HTTPException(429, f'Slow down a bit: max {count} per {window // 60} minutes.')
        c.execute('INSERT INTO actions VALUES (?, ?, ?)', (user_id, kind, now()))


# Short blocklist for the worst words; the report button + admin queue handle the rest.
BLOCKED = re.compile(r'\b(n[i1]gg(?:a|er)s?|f[a4]gg?[o0]ts?|r[e3]t[a4]rds?|k[i1]ll\s+yourself|kys)\b', re.I)


def clean_text(value, field, max_len, required=False):
    value = (value or '').strip()
    if required and not value:
        raise HTTPException(400, f'{field} is required.')
    if len(value) > max_len:
        raise HTTPException(400, f'{field} is too long (max {max_len} characters).')
    if BLOCKED.search(value):
        raise HTTPException(400, f'{field} contains words that aren\'t allowed here.')
    return value


def public_user(row):
    return {'id': row['id'], 'name': row['name'], 'displayName': row['display_name'], 'avatar': row['avatar']} if row else None


def post_json(row, me=None, liked=None):
    p = dict(row)
    return {
        'id': p['id'], 'type': p['type'], 'title': p['title'], 'body': p['body'], 'code': p['code'],
        'outfit': json.loads(p['outfit']) if p['outfit'] else None,
        'image': f'{BASE_URL}/api/uploads/{p["image"]}' if p['image'] else None,
        'tags': [t for t in (p['tags'] or '').split(',') if t],
        'createdAt': p['created_at'], 'likes': p['like_count'], 'comments': p['comment_count'],
        'liked': bool(liked), 'hidden': bool(p['hidden']),
        'author': {'id': p['user_id'], 'name': p.get('name'), 'displayName': p.get('display_name'), 'avatar': p.get('avatar')},
        'mine': bool(me and me['id'] == p['user_id']),
    }


# ---------- auth: Sign in with Roblox ----------

def set_session(response: Response, user_id: int, secure=True):
    token = secrets.token_urlsafe(32)
    with db() as c:
        c.execute('INSERT INTO sessions VALUES (?, ?, ?)', (token, user_id, now() + SESSION_DAYS * 86400))
    response.set_cookie(COOKIE, token, max_age=SESSION_DAYS * 86400, httponly=True, secure=secure, samesite='lax', path='/')


def upsert_user(uid, name, display, avatar):
    with db() as c:
        c.execute("""INSERT INTO users (id, name, display_name, avatar, created_at, last_seen) VALUES (?, ?, ?, ?, ?, ?)
                     ON CONFLICT(id) DO UPDATE SET name = excluded.name, display_name = excluded.display_name,
                     avatar = COALESCE(excluded.avatar, users.avatar), last_seen = excluded.last_seen""",
                  (uid, name, display, avatar, now(), now()))


def safe_return(path):
    return path if isinstance(path, str) and path.startswith('/') and not path.startswith('//') else '/community/'


@app.get('/api/auth/login')
def login(r: str = '/community/'):
    if not CLIENT_ID:
        raise HTTPException(503, 'Sign in with Roblox isn\'t set up yet.')
    state = secrets.token_urlsafe(24)
    verifier = secrets.token_urlsafe(48)
    challenge = base64.urlsafe_b64encode(hashlib.sha256(verifier.encode()).digest()).rstrip(b'=').decode()
    with db() as c:
        c.execute('DELETE FROM oauth_states WHERE created_at < ?', (now() - 900,))
        c.execute('INSERT INTO oauth_states VALUES (?, ?, ?, ?)', (state, verifier, safe_return(r), now()))
    q = urllib.parse.urlencode({
        'client_id': CLIENT_ID, 'redirect_uri': f'{BASE_URL}/api/auth/callback', 'response_type': 'code',
        'scope': 'openid profile', 'state': state, 'code_challenge': challenge, 'code_challenge_method': 'S256',
    })
    return RedirectResponse(f'https://apis.roblox.com/oauth/v1/authorize?{q}', 302)


def roblox_post(url, data):
    body = urllib.parse.urlencode(data).encode()
    req = urllib.request.Request(url, body, {'Content-Type': 'application/x-www-form-urlencoded'})
    with urllib.request.urlopen(req, timeout=15) as res:
        return json.load(res)


def roblox_get(url, token):
    req = urllib.request.Request(url, headers={'Authorization': f'Bearer {token}'})
    with urllib.request.urlopen(req, timeout=15) as res:
        return json.load(res)


@app.get('/api/auth/callback')
def callback(code: str = '', state: str = '', error: str = ''):
    if error:
        return RedirectResponse(f'/community/#/?login=cancelled', 302)
    with db() as c:
        row = c.execute('SELECT * FROM oauth_states WHERE state = ?', (state,)).fetchone()
        c.execute('DELETE FROM oauth_states WHERE state = ?', (state,))
    if not row or row['created_at'] < now() - 900:
        raise HTTPException(400, 'Login expired. Try again.')
    try:
        tokens = roblox_post('https://apis.roblox.com/oauth/v1/token', {
            'grant_type': 'authorization_code', 'code': code, 'code_verifier': row['verifier'],
            'client_id': CLIENT_ID, 'client_secret': CLIENT_SECRET, 'redirect_uri': f'{BASE_URL}/api/auth/callback',
        })
        info = roblox_get('https://apis.roblox.com/oauth/v1/userinfo', tokens['access_token'])
    except Exception as e:
        raise HTTPException(502, f'Roblox login failed: {e}')
    uid = int(info['sub'])
    upsert_user(uid, info.get('preferred_username'), info.get('nickname') or info.get('name'), info.get('picture'))
    response = RedirectResponse(row['return_to'], 302)
    set_session(response, uid)
    return response


def is_direct_lan(request: Request):
    # Test login only for direct LAN requests: anything through Caddy carries X-Forwarded-For.
    host = request.client.host if request.client else ''
    return not request.headers.get('x-forwarded-for') and re.match(r'^(127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)', host)


@app.get('/api/auth/dev')
def dev_login(request: Request, id: int = 1001, name: str = 'tester', r: str = '/community/'):
    if not DEV_LOGIN or not is_direct_lan(request):
        raise HTTPException(404)
    upsert_user(id, name, name.capitalize(), None)
    response = RedirectResponse(safe_return(r), 302)
    set_session(response, id, secure=False)
    return response


@app.post('/api/auth/logout')
def logout(request: Request, response: Response):
    token = request.cookies.get(COOKIE)
    if token:
        with db() as c:
            c.execute('DELETE FROM sessions WHERE token = ?', (token,))
    response.delete_cookie(COOKIE, path='/')
    return {'ok': True}


@app.get('/api/me')
def me(request: Request):
    user = current_user(request, required=False)
    if not user:
        return {'user': None, 'loginReady': bool(CLIENT_ID), 'devLogin': bool(DEV_LOGIN and is_direct_lan(request))}
    with db() as c:
        app_row = c.execute('SELECT status, note, created_at FROM applications WHERE user_id = ? ORDER BY id DESC LIMIT 1', (user['id'],)).fetchone()
    return {
        'user': {**public_user(user), 'status': user['status'], 'isAdmin': user['is_admin']},
        'application': dict(app_row) if app_row else None,
        'loginReady': bool(CLIENT_ID), 'devLogin': bool(DEV_LOGIN and is_direct_lan(request)),
    }


# ---------- applications ----------

@app.post('/api/applications')
async def apply(request: Request):
    user = current_user(request)
    if user['status'] in ('approved', 'pending'):
        raise HTTPException(400, 'You already applied.' if user['status'] == 'pending' else 'You can already post.')
    if user['status'] == 'banned':
        raise HTTPException(403, 'Your account is banned.')
    rate_limit(user['id'], 'apply')
    data = await request.json()
    answers = {
        'why': clean_text(data.get('why'), 'Why you want to post', 600, True),
        'share': clean_text(data.get('share'), 'What you\'ll share', 600, True),
        'discord': clean_text(data.get('discord'), 'Discord', 40),
    }
    if not data.get('age13') or not data.get('rules'):
        raise HTTPException(400, 'Confirm you\'re 13 or older and agree to the rules.')
    with db() as c:
        c.execute('INSERT INTO applications (user_id, answers, created_at) VALUES (?, ?, ?)', (user['id'], json.dumps(answers), now()))
        c.execute("UPDATE users SET status = 'pending' WHERE id = ?", (user['id'],))
    return {'ok': True}


# ---------- posts ----------

TYPES = {'script', 'outfit', 'post'}
TAG = re.compile(r'^[a-z0-9-]{1,20}$')
HEX = re.compile(r'^#?[0-9a-fA-F]{6}$')


def clean_outfit(o):
    if not isinstance(o, dict):
        raise HTTPException(400, 'Outfit is missing.')
    assets = o.get('assets') or []
    if not isinstance(assets, list) or not 1 <= len(assets) <= 60:
        raise HTTPException(400, 'An outfit needs 1 to 60 items.')
    clean_assets = []
    for a in assets:
        try:
            clean_assets.append({'id': int(a['id']), 'name': str(a.get('name') or '')[:80], 'type': int(a['type']) if a.get('type') is not None else None})
        except (KeyError, TypeError, ValueError):
            raise HTTPException(400, 'Outfit has a broken item.')
    colors = {k: v if v.startswith('#') else f'#{v}' for k, v in (o.get('bodyColors') or {}).items() if isinstance(v, str) and HEX.match(v)}
    scales = {k: float(v) for k, v in (o.get('scales') or {}).items() if isinstance(v, (int, float)) and 0 <= v <= 2}
    preview = o.get('preview')
    if preview and not re.match(r'^https://[a-z0-9]+\.rbxcdn\.com/', str(preview)):
        preview = None
    return {'type': 'R6' if o.get('type') == 'R6' else 'R15', 'assets': clean_assets, 'bodyColors': colors, 'scales': scales, 'preview': preview}


@app.get('/api/posts')
def list_posts(request: Request, type: str = '', sort: str = 'new', tag: str = '', q: str = '', user: int = 0, page: int = 0):
    me_user = current_user(request, required=False)
    where, args = ['p.hidden = 0'], []
    if type in TYPES:
        where.append('p.type = ?'); args.append(type)
    if tag and TAG.match(tag):
        where.append("(',' || p.tags || ',') LIKE ?"); args.append(f'%,{tag},%')
    if q:
        where.append('(p.title LIKE ? OR p.body LIKE ?)'); args += [f'%{q[:60]}%'] * 2
    if user:
        where.append('p.user_id = ?'); args.append(user)
    order = 'p.like_count DESC, p.created_at DESC' if sort == 'top' else 'p.created_at DESC'
    with db() as c:
        rows = c.execute(f"""SELECT p.*, u.name, u.display_name, u.avatar FROM posts p JOIN users u ON u.id = p.user_id
                             WHERE {' AND '.join(where)} ORDER BY {order} LIMIT 21 OFFSET ?""", (*args, max(0, page) * 20)).fetchall()
        liked = set()
        if me_user and rows:
            ids = [r['id'] for r in rows]
            liked = {r[0] for r in c.execute(f'SELECT post_id FROM likes WHERE user_id = ? AND post_id IN ({",".join("?" * len(ids))})', (me_user['id'], *ids))}
    return {'posts': [post_json(r, me_user, r['id'] in liked) for r in rows[:20]], 'more': len(rows) > 20}


@app.get('/api/posts/{post_id}')
def get_post(post_id: int, request: Request):
    me_user = current_user(request, required=False)
    with db() as c:
        row = c.execute('SELECT p.*, u.name, u.display_name, u.avatar FROM posts p JOIN users u ON u.id = p.user_id WHERE p.id = ?', (post_id,)).fetchone()
        if not row or (row['hidden'] and not (me_user and me_user['is_admin'])):
            raise HTTPException(404, 'Post not found.')
        liked = me_user and c.execute('SELECT 1 FROM likes WHERE post_id = ? AND user_id = ?', (post_id, me_user['id'])).fetchone()
        comments = c.execute("""SELECT c.*, u.name, u.display_name, u.avatar FROM comments c JOIN users u ON u.id = c.user_id
                                WHERE c.post_id = ? AND c.hidden = 0 ORDER BY c.created_at""", (post_id,)).fetchall()
    return {'post': post_json(row, me_user, liked), 'comments': [{
        'id': x['id'], 'body': x['body'], 'createdAt': x['created_at'],
        'author': {'id': x['user_id'], 'name': x['name'], 'displayName': x['display_name'], 'avatar': x['avatar']},
        'mine': bool(me_user and me_user['id'] == x['user_id']),
    } for x in comments]}


@app.post('/api/posts')
async def create_post(request: Request):
    user = require_poster(request)
    data = await request.json()
    kind = data.get('type')
    if kind not in TYPES:
        raise HTTPException(400, 'Pick a post type.')
    title = clean_text(data.get('title'), 'Title', 100, True)
    body = clean_text(data.get('body'), 'Text', 5000, kind == 'post' and not data.get('image'))
    code = clean_text(data.get('code'), 'Script', 50000, kind == 'script') if kind == 'script' else None
    outfit = json.dumps(clean_outfit(data.get('outfit'))) if kind == 'outfit' else None
    image = data.get('image')
    if image and not re.match(r'^[a-f0-9]{32}\.webp$', image or ''):
        raise HTTPException(400, 'Bad image.')
    tags = [t.lower() for t in (data.get('tags') or [])][:5]
    if any(not TAG.match(t) for t in tags):
        raise HTTPException(400, 'Tags can only use a-z, 0-9 and dashes (max 20 characters).')
    rate_limit(user['id'], 'post')
    with db() as c:
        cur = c.execute('INSERT INTO posts (user_id, type, title, body, code, outfit, image, tags, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
                        (user['id'], kind, title, body, code, outfit, image, ','.join(tags), now()))
    return {'id': cur.lastrowid}


@app.delete('/api/posts/{post_id}')
def delete_post(post_id: int, request: Request):
    user = current_user(request)
    with db() as c:
        row = c.execute('SELECT user_id FROM posts WHERE id = ?', (post_id,)).fetchone()
        if not row:
            raise HTTPException(404, 'Post not found.')
        if row['user_id'] != user['id'] and not user['is_admin']:
            raise HTTPException(403, 'Not your post.')
        c.execute('DELETE FROM comments WHERE post_id = ?', (post_id,))
        c.execute('DELETE FROM likes WHERE post_id = ?', (post_id,))
        c.execute('DELETE FROM posts WHERE id = ?', (post_id,))
    return {'ok': True}


@app.post('/api/posts/{post_id}/like')
def like(post_id: int, request: Request):
    user = current_user(request)
    with db() as c:
        if not c.execute('SELECT 1 FROM posts WHERE id = ? AND hidden = 0', (post_id,)).fetchone():
            raise HTTPException(404, 'Post not found.')
        if c.execute('SELECT 1 FROM likes WHERE post_id = ? AND user_id = ?', (post_id, user['id'])).fetchone():
            c.execute('DELETE FROM likes WHERE post_id = ? AND user_id = ?', (post_id, user['id']))
            liked = False
        else:
            c.execute('INSERT INTO likes VALUES (?, ?)', (post_id, user['id']))
            liked = True
        n = c.execute('SELECT COUNT(*) FROM likes WHERE post_id = ?', (post_id,)).fetchone()[0]
        c.execute('UPDATE posts SET like_count = ? WHERE id = ?', (n, post_id))
    return {'liked': liked, 'likes': n}


@app.post('/api/posts/{post_id}/comments')
async def comment(post_id: int, request: Request):
    user = require_poster(request)
    body = clean_text((await request.json()).get('body'), 'Comment', 1000, True)
    rate_limit(user['id'], 'comment')
    with db() as c:
        if not c.execute('SELECT 1 FROM posts WHERE id = ? AND hidden = 0', (post_id,)).fetchone():
            raise HTTPException(404, 'Post not found.')
        cur = c.execute('INSERT INTO comments (post_id, user_id, body, created_at) VALUES (?, ?, ?, ?)', (post_id, user['id'], body, now()))
        c.execute('UPDATE posts SET comment_count = (SELECT COUNT(*) FROM comments WHERE post_id = ? AND hidden = 0) WHERE id = ?', (post_id, post_id))
    return {'id': cur.lastrowid}


@app.delete('/api/comments/{comment_id}')
def delete_comment(comment_id: int, request: Request):
    user = current_user(request)
    with db() as c:
        row = c.execute('SELECT user_id, post_id FROM comments WHERE id = ?', (comment_id,)).fetchone()
        if not row:
            raise HTTPException(404, 'Comment not found.')
        if row['user_id'] != user['id'] and not user['is_admin']:
            raise HTTPException(403, 'Not your comment.')
        c.execute('DELETE FROM comments WHERE id = ?', (comment_id,))
        c.execute('UPDATE posts SET comment_count = (SELECT COUNT(*) FROM comments WHERE post_id = ? AND hidden = 0) WHERE id = ?', (row['post_id'], row['post_id']))
    return {'ok': True}


# ---------- uploads ----------

@app.post('/api/uploads')
async def upload(request: Request, file: UploadFile):
    user = require_poster(request)
    rate_limit(user['id'], 'upload')
    raw = await file.read(5 * 1024 * 1024 + 1)
    if len(raw) > 5 * 1024 * 1024:
        raise HTTPException(400, 'Images can be 5 MB at most.')
    try:
        img = Image.open(io.BytesIO(raw))
        img.load()
    except Exception:
        raise HTTPException(400, 'That file isn\'t an image.')
    img = img.convert('RGBA' if img.mode in ('RGBA', 'LA', 'P') else 'RGB')
    img.thumbnail((1600, 1600))
    name = f'{secrets.token_hex(16)}.webp'
    img.save(os.path.join(UPLOADS, name), 'WEBP', quality=85)  # re-encoding also strips metadata
    return {'image': name, 'url': f'{BASE_URL}/api/uploads/{name}'}


@app.get('/api/uploads/{name}')
def get_upload(name: str):
    if not re.match(r'^[a-f0-9]{32}\.webp$', name):
        raise HTTPException(404)
    path = os.path.join(UPLOADS, name)
    if not os.path.exists(path):
        raise HTTPException(404)
    return FileResponse(path, media_type='image/webp', headers={'Cache-Control': 'public, max-age=31536000, immutable'})


# ---------- reports ----------

@app.post('/api/reports')
async def report(request: Request):
    user = current_user(request)
    data = await request.json()
    if data.get('targetType') not in ('post', 'comment', 'user'):
        raise HTTPException(400, 'Bad report.')
    reason = clean_text(data.get('reason'), 'Reason', 300, True)
    rate_limit(user['id'], 'report')
    with db() as c:
        c.execute('INSERT INTO reports (target_type, target_id, user_id, reason, created_at) VALUES (?, ?, ?, ?, ?)',
                  (data['targetType'], int(data.get('targetId') or 0), user['id'], reason, now()))
    return {'ok': True}


# ---------- users ----------

@app.get('/api/users/{user_id}')
def get_user(user_id: int):
    with db() as c:
        row = c.execute('SELECT * FROM users WHERE id = ?', (user_id,)).fetchone()
        if not row:
            raise HTTPException(404, 'User not found.')
        stats = c.execute('SELECT COUNT(*), COALESCE(SUM(like_count), 0) FROM posts WHERE user_id = ? AND hidden = 0', (user_id,)).fetchone()
    return {'user': {**public_user(row), 'status': 'banned' if row['status'] == 'banned' else ('poster' if row['status'] == 'approved' or user_id in ADMIN_IDS else 'reader'),
                     'joined': row['created_at'], 'posts': stats[0], 'likes': stats[1]}}


# ---------- admin ----------

@app.get('/api/admin/overview')
def admin_overview(request: Request):
    require_admin(request)
    with db() as c:
        apps = c.execute("""SELECT a.*, u.name, u.display_name, u.avatar FROM applications a JOIN users u ON u.id = a.user_id
                            WHERE a.status = 'pending' ORDER BY a.created_at""").fetchall()
        reports = c.execute("SELECT * FROM reports WHERE status = 'open' ORDER BY created_at").fetchall()
        out_reports = []
        for r in reports:
            target = None
            if r['target_type'] == 'post':
                t = c.execute('SELECT id, title, body, user_id, hidden FROM posts WHERE id = ?', (r['target_id'],)).fetchone()
                target = dict(t) if t else None
            elif r['target_type'] == 'comment':
                t = c.execute('SELECT id, body, post_id, user_id, hidden FROM comments WHERE id = ?', (r['target_id'],)).fetchone()
                target = dict(t) if t else None
            elif r['target_type'] == 'user':
                t = c.execute('SELECT id, name, display_name, status FROM users WHERE id = ?', (r['target_id'],)).fetchone()
                target = dict(t) if t else None
            out_reports.append({**dict(r), 'target': target})
        counts = {k: c.execute(f'SELECT COUNT(*) FROM {k}').fetchone()[0] for k in ('users', 'posts', 'comments')}
        posters = c.execute("SELECT id, name, display_name, avatar, status, last_seen FROM users WHERE status IN ('approved', 'banned') ORDER BY last_seen DESC LIMIT 100").fetchall()
    return {
        'applications': [{**dict(a), 'answers': json.loads(a['answers'])} for a in apps],
        'reports': out_reports, 'counts': counts, 'members': [dict(p) for p in posters],
    }


@app.post('/api/admin/applications/{app_id}')
async def review_application(app_id: int, request: Request):
    admin = require_admin(request)
    data = await request.json()
    decision = data.get('decision')
    if decision not in ('approved', 'rejected'):
        raise HTTPException(400, 'Approve or reject.')
    note = clean_text(data.get('note'), 'Note', 300)
    with db() as c:
        row = c.execute('SELECT user_id FROM applications WHERE id = ?', (app_id,)).fetchone()
        if not row:
            raise HTTPException(404, 'Application not found.')
        c.execute('UPDATE applications SET status = ?, note = ?, reviewed_at = ?, reviewed_by = ? WHERE id = ?', (decision, note, now(), admin['id'], app_id))
        c.execute('UPDATE users SET status = ? WHERE id = ?', (decision, row['user_id']))
    return {'ok': True}


@app.post('/api/admin/reports/{report_id}')
async def handle_report(report_id: int, request: Request):
    require_admin(request)
    action = (await request.json()).get('action')
    with db() as c:
        r = c.execute('SELECT * FROM reports WHERE id = ?', (report_id,)).fetchone()
        if not r:
            raise HTTPException(404, 'Report not found.')
        if action == 'remove':
            if r['target_type'] == 'post':
                c.execute('UPDATE posts SET hidden = 1 WHERE id = ?', (r['target_id'],))
            elif r['target_type'] == 'comment':
                c.execute('UPDATE comments SET hidden = 1 WHERE id = ?', (r['target_id'],))
                c.execute('UPDATE posts SET comment_count = (SELECT COUNT(*) FROM comments WHERE post_id = posts.id AND hidden = 0) WHERE id = (SELECT post_id FROM comments WHERE id = ?)', (r['target_id'],))
        elif action != 'dismiss':
            raise HTTPException(400, 'Remove or dismiss.')
        c.execute("UPDATE reports SET status = 'closed' WHERE target_type = ? AND target_id = ?", (r['target_type'], r['target_id']))
    return {'ok': True}


@app.post('/api/admin/users/{user_id}')
async def set_user_status(user_id: int, request: Request):
    require_admin(request)
    status = (await request.json()).get('status')
    if status not in ('approved', 'banned', 'none'):
        raise HTTPException(400, 'Bad status.')
    if user_id in ADMIN_IDS:
        raise HTTPException(400, 'Admins can\'t be changed here.')
    with db() as c:
        c.execute('UPDATE users SET status = ? WHERE id = ?', (status, user_id))
        if status == 'banned':
            c.execute('DELETE FROM sessions WHERE user_id = ?', (user_id,))
            c.execute('UPDATE posts SET hidden = 1 WHERE user_id = ?', (user_id,))
    return {'ok': True}


@app.get('/api/health')
def health():
    with db() as c:
        c.execute('SELECT 1').fetchone()
    return {'ok': True, 'login': bool(CLIENT_ID)}
