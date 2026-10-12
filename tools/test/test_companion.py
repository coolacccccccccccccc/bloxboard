"""End-to-end: headless companion (Host) + the real extension in Chromium, linked over the bridge.
Fake Roblox logs (current session + older days), real public Roblox APIs for the companion,
mocked logged-in APIs for the extension. Screenshots of every panel page land in shots/."""
import json, os, re, subprocess, time, urllib.request, datetime, hashlib
from playwright.sync_api import sync_playwright

os.environ['PW_EXPERIMENTAL_SERVICE_WORKER_NETWORK_EVENTS'] = '1'
EXT = '/work/Bloxboard'
OUT = '/work/shots'
LOGS = '/tmp/rbx-logs'
DATA = '/tmp/bbx-data'
errors, fails = [], []
AV = 'data:image/svg+xml,' + '%3Csvg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"%3E%3Ccircle cx="5" cy="5" r="5" fill="%23{c}"/%3E%3C/svg%3E'
COLORS = ['8a9cff', 'ffb86b', '6bd6a5', 'ff8fa3', 'b18cff', '6bc6ff', 'f2d16b']

def check(ok, what):
  print(('PASS ' if ok else 'FAIL ') + what)
  if not ok: fails.append(what)

def get(url):
  req = urllib.request.Request(url, headers={'User-Agent': 'bbx-test'})
  return json.load(urllib.request.urlopen(req, timeout=20))

# ---- real game data for the fake logs ----
NDS = 189707
uni = get(f'https://apis.roblox.com/universes/v1/places/{NDS}/universe')['universeId']
servers = get(f'https://games.roblox.com/v1/games/{NDS}/servers/Public?limit=100&sortOrder=Desc')['data']
JOB = servers[0]['id']
OTHER = servers[min(2, len(servers) - 1)]['id']
FOUND = servers[min(4, len(servers) - 1)]['id']
print('NDS universe', uni, 'servers', len(servers))

now = datetime.datetime.now(datetime.timezone.utc)
ts = lambda t: t.strftime('%Y-%m-%dT%H:%M:%S.000Z')
os.makedirs(LOGS, exist_ok=True)
os.makedirs(DATA, exist_ok=True)

# Older log: sessions over the last 9 days (no universe lines, like many real logs).
old = []
games = [(6516141723, 95), (920587237, 40), (NDS, 60), (2753915549, 120)]
for d in range(9, 0, -1):
  if d in (6,): continue
  for k, (place, mins) in enumerate(games[: 1 + d % 3]):
    start = now - datetime.timedelta(days=d, hours=4 - k * 2)
    job = hashlib.md5(f'{d}-{k}'.encode()).hexdigest()
    job = f'{job[:8]}-{job[8:12]}-{job[12:16]}-{job[16:20]}-{job[20:32]}'
    old.append(f"{ts(start)},1.0,1a2b,6 [FLog::Output] ! Joining game '{job}' place {place} at 10.0.0.1")
    old.append(f"{ts(start + datetime.timedelta(minutes=mins * (1 + d % 2) // 2 + 10))},2.0,1a2b,6 [FLog::Network] Time to disconnect replication data: 0.1")
open(f'{LOGS}/0.700.0_20261001T100000Z_Player_AAA_last.log', 'w').write('\n'.join(old) + '\n')
time.sleep(1.2)

t0 = now - datetime.timedelta(minutes=25)
started = (now - datetime.timedelta(hours=3, minutes=12)).strftime('%Y%m%dT%H%M%SZ')
cur = [
  f"{ts(t0)},1.0,1a2b,6 [FLog::Output] Settings Date header was ...",
  f"{ts(t0)},2.0,1a2b,6 [FLog::Output] ! Joining game '{JOB}' place {NDS} at 10.0.0.5",
  f"{ts(t0)},3.0,1a2b,6 [FLog::Network] UDMUX Address = 128.116.44.12, Port = 55000 | RCC Server Address = 10.0.0.5, Port = 1234",
  f"{ts(t0)},4.0,1a2b,6 [FLog::Output] Server Prefix: 0.700.0.7000_{started}_RCC_ab12c",
  f"{ts(t0)},5.0,1a2b,6 [FLog::Network] serverId: 10.0.0.5|1234",
  f"{ts(t0)},6.0,1a2b,6 [FLog::GameJoinLoadTime] Report game_join_loadtime: placeid:{NDS}, universeid:{uni}, userid:1001, joinTime:1.2",
]
open(f'{LOGS}/0.700.0_20261012T090000Z_Player_BBB_last.log', 'w').write('\n'.join(cur) + '\n')

# ---- start the headless companion ----
env = dict(os.environ, DOTNET_SYSTEM_GLOBALIZATION_INVARIANT='1')
host = subprocess.Popen(['/work/host/Host', LOGS, DATA], env=env, stdout=open('/work/shots/host.log', 'w'), stderr=subprocess.STDOUT)
for _ in range(50):
  if os.path.exists(f'{DATA}/panel.txt'): break
  time.sleep(0.2)
PORT, TOKEN = open(f'{DATA}/panel.txt').read().split()
PANEL = f'http://127.0.0.1:{PORT}/#t={TOKEN}'
print('panel', PANEL)
time.sleep(3)  # import + details

# ---- mocks for the extension (logged-in APIs) ----
ME = {'id': 1001, 'name': 'enes_dev', 'displayName': 'Enes'}
NAMES = ['Lynx', 'Mira', 'Tobi', 'Daan', 'Sem', 'Noor', 'Jayden', 'Fleur', 'Bram', 'Liv', 'Milan', 'Saar', 'Ravi', 'Yara']
FRIENDS = list(range(2001, 2015))
PRES = {
  2001: {'userPresenceType': 2, 'lastLocation': 'Natural Disaster Survival', 'placeId': NDS, 'rootPlaceId': NDS, 'gameId': JOB, 'universeId': uni},
  2002: {'userPresenceType': 2, 'lastLocation': 'Natural Disaster Survival', 'placeId': NDS, 'rootPlaceId': NDS, 'gameId': OTHER, 'universeId': uni},
  2003: {'userPresenceType': 2, 'lastLocation': 'DOORS', 'placeId': 6516141723, 'rootPlaceId': 6516141723, 'gameId': None, 'universeId': 2440500124},
  2004: {'userPresenceType': 1, 'lastLocation': 'Website'},
  2005: {'userPresenceType': 3, 'lastLocation': 'Studio'},
  156: {'userPresenceType': 2, 'lastLocation': 'Natural Disaster Survival', 'placeId': NDS, 'rootPlaceId': NDS, 'gameId': FOUND, 'universeId': uni},
}
CITIES = [('Amsterdam', 'Netherlands', 'NL'), ('Frankfurt am Main', 'Germany', 'DE'), ('London', 'United Kingdom', 'GB'), ('Paris', 'France', 'FR'), ('Ashburn', 'United States', 'US')]

def j(route, obj, status=200):
  origin = route.request.headers.get('origin') or '*'
  route.fulfill(status=status, content_type='application/json', body=json.dumps(obj),
    headers={'access-control-allow-origin': origin, 'access-control-allow-credentials': 'true'})

def body(route):
  try: return route.request.post_data_json
  except Exception: return None

def handler(route):
  url = route.request.url
  if 'users/authenticated' in url: return j(route, ME)
  if re.search(r'friends\.roblox\.com/v1/users/1001/friends/find', url): return j(route, {'PageItems': [{'id': i} for i in FRIENDS], 'NextCursor': None})
  if url.startswith('https://users.roblox.com/v1/users') and route.request.method == 'POST' and 'usernames' not in url:
    ids = (body(route) or {}).get('userIds', [])
    return j(route, {'data': [{'id': i, 'name': NAMES[(i - 2001) % 14].lower() + '_rbx', 'displayName': NAMES[(i - 2001) % 14]} for i in ids]})
  if 'usernames/users' in url: return j(route, {'data': [{'id': 156, 'name': 'builderman', 'displayName': 'builderman', 'requestedUsername': 'Builderman'}]})
  if re.search(r'users\.roblox\.com/v1/users/156$', url): return j(route, {'id': 156, 'name': 'builderman', 'displayName': 'builderman'})
  if 'presence.roblox.com' in url:
    ids = (body(route) or {}).get('userIds', [])
    return j(route, {'userPresences': [{'userId': i, **PRES.get(i, {'userPresenceType': 0, 'lastLocation': 'Website'})} for i in ids]})
  if 'gamejoin.roblox.com' in url:
    gid = (body(route) or {}).get('gameId', '')
    n = int(hashlib.md5(gid.encode()).hexdigest(), 16)
    return j(route, {'status': 2, 'joinScript': {'UdmuxEndpoints': [{'Address': f'128.116.{n % 5}.{n % 200}'}]}})
  return route.continue_()

def geo(route):
  ip = route.request.url.split('/')[3].split('?')[0]
  c = CITIES[int(ip.split('.')[2]) % 5]
  route.fulfill(status=200, content_type='application/json', body=json.dumps({'success': True, 'city': c[0], 'country': c[1], 'country_code': c[2]}))

with sync_playwright() as p:
  ctx = p.chromium.launch_persistent_context('/tmp/bbc-profile', channel='chromium', headless=True,
    args=[f'--disable-extensions-except={EXT}', f'--load-extension={EXT}'], viewport={'width': 1120, 'height': 760})
  ctx.route(re.compile(r'https://([a-z]+\.)?roblox\.com/.*'), handler)
  ctx.route(re.compile(r'https://ipwho\.is/.*'), geo)
  sw = ctx.service_workers[0] if ctx.service_workers else ctx.wait_for_event('serviceworker', timeout=15000)
  ext_id = sw.url.split('/')[2]

  # ---- panel before linking ----
  page = ctx.new_page()
  page.on('console', lambda m: m.type == 'error' and errors.append(f'[panel] {m.text[:300]}'))
  page.on('pageerror', lambda e: errors.append(f'[panel] pageerror: {e}'))
  page.goto(PANEL)
  page.wait_for_selector('.hero h1', timeout=20000)
  page.wait_for_timeout(4000)
  check('Natural Disaster' in page.inner_text('.hero h1'), 'now: current game from the log')
  check('Server up' in page.inner_text('.facts'), 'now: server uptime from Server Prefix')
  page.screenshot(path=f'{OUT}/c-now.png')
  facts = page.inner_text('.facts')
  print('facts:', facts.replace('\n', ' | '))
  dbg = page.evaluate(f"fetch('/api/servers?place={NDS}&order=Desc', {{ headers: {{ 'X-Bbx-Token': '{TOKEN}' }} }}).then(r => r.text())")
  print('servers api:', dbg[:300])
  check('players' in page.inner_text('.grid').lower(), 'now: this server found in the public list')

  page.click('#nav button[data-page="find"]')
  page.wait_for_timeout(500)
  check('needs the browser link' in page.inner_text('main'), 'find: asks to link when not linked')
  page.click('#nav button[data-page="settings"]')
  page.wait_for_timeout(500)
  page.screenshot(path=f'{OUT}/c-settings-unlinked.png')

  # ---- link the extension ----
  sw.evaluate('''async () => { const s = await BB.settings(); await BB.set('settings', { ...s, companionLink: true }); return connectCompanion(true); }''')
  for _ in range(30):
    if 'Browser linked' in page.inner_text('#link-text'): break
    page.wait_for_timeout(300)
  check('enes_dev' in page.inner_text('#link-text'), 'link: panel shows the browser link with the user')
  page.wait_for_timeout(1500)
  page.screenshot(path=f'{OUT}/c-settings-linked.png')
  pt = sw.evaluate("async () => BB.get('playtime', {})")
  check(any(str(uni) in v for v in pt.values()), f'link: companion playtime merged into the extension ({len(pt)} days)')

  # ---- servers + regions + friends in servers ----
  page.click('#nav button[data-page="servers"]')
  try:
    page.wait_for_selector('.srv:not(.srv-head)', timeout=20000)
  except Exception:
    page.screenshot(path=f'{OUT}/c-servers-fail.png')
    print('servers page text:', page.inner_text('main')[:500])
    print('errors so far:', errors[:10])
    print('companion.log:', ''.join(l for l in open(f'{DATA}/companion.log').readlines() if 'error' in l or 'fail' in l)[-2000:])
    raise
  page.wait_for_timeout(2500)
  check(page.locator('.srv.current').count() == 1, 'servers: current server highlighted')
  check('Lynx' in page.inner_text('.card'), 'servers: friend badge in their server')
  page.click('text=Show regions')
  for _ in range(60):
    if not page.locator('select[aria-label="Region"]').is_hidden() and 'Regions' not in page.inner_text('.toolbar'): break
    page.wait_for_timeout(500)
  page.wait_for_timeout(800)
  txt = page.inner_text('.card')
  check(any(c[0] in txt for c in CITIES), 'servers: regions from the extension')
  page.screenshot(path=f'{OUT}/c-servers.png')
  page.locator('.srv:not(.srv-head) .btn.sm:not(.ghost)').nth(1).click()
  page.wait_for_timeout(500)
  opened = open(f'{DATA}/opened.txt').read() if os.path.exists(f'{DATA}/opened.txt') else ''
  check(f'roblox://experiences/start?placeId={NDS}&gameInstanceId=' in opened, 'servers: Join opens a roblox:// link')

  # ---- find ----
  page.click('#nav button[data-page="find"]')
  page.fill('input[placeholder="Username or display name"]', 'Builderman')
  page.click('button[type=submit]')
  page.wait_for_selector('.found', timeout=30000)
  page.wait_for_timeout(800)
  check('builderman' in page.inner_text('.found').lower(), 'find: found through the extension')
  page.screenshot(path=f'{OUT}/c-find.png')

  # ---- friends ----
  page.click('#nav button[data-page="friends"]')
  page.wait_for_selector('.friend', timeout=30000)
  page.wait_for_timeout(1500)
  check('In a game · 3' in page.inner_text('main'), 'friends: in-game friends from the extension')
  page.screenshot(path=f'{OUT}/c-friends.png')

  # ---- games ----
  page.click('#nav button[data-page="games"]')
  page.wait_for_timeout(2500)
  page.fill('input[type=search]', 'doors')
  page.wait_for_selector('text=Results for', timeout=20000)
  page.wait_for_timeout(2500)
  check(page.locator('.tile').count() > 3, 'games: search results + played lately')
  page.screenshot(path=f'{OUT}/c-games.png')

  # ---- playtime ----
  page.click('#nav button[data-page="stats"]')
  page.wait_for_selector('.chart', timeout=20000)
  page.wait_for_timeout(2500)
  k = page.inner_text('.kpis')
  print('stats:', k.replace('\n', ' | '))
  check('streak' in k.lower() and page.locator('.topg').count() >= 3, 'stats: imported older logs give top games')
  page.screenshot(path=f'{OUT}/c-stats.png', full_page=True)

  # ---- now page, linked ----
  page.click('#nav button[data-page="now"]')
  page.wait_for_timeout(3500)
  page.screenshot(path=f'{OUT}/c-now-linked.png')

  # narrow window
  page.set_viewport_size({'width': 740, 'height': 640})
  page.wait_for_timeout(600)
  page.screenshot(path=f'{OUT}/c-narrow.png')
  sw_overflow = page.evaluate('document.querySelector(".main").scrollWidth > document.querySelector(".main").clientWidth + 2')
  check(not sw_overflow, 'narrow: no horizontal overflow')

  # ---- dashboard companion card ----
  d = ctx.new_page()
  d.goto(f'chrome-extension://{ext_id}/dashboard/dashboard.html#settings')
  d.wait_for_selector('text=Windows companion', timeout=20000)
  d.wait_for_timeout(1500)
  check('Linked' in d.inner_text('main'), 'dashboard: companion card says Linked')
  d.locator('text=Windows companion').scroll_into_view_if_needed()
  d.screenshot(path=f'{OUT}/c-dashboard-card.png')

  # ---- leaving the game ----
  with open(f'{LOGS}/0.700.0_20261012T090000Z_Player_BBB_last.log', 'a') as f:
    f.write(f"{ts(datetime.datetime.now(datetime.timezone.utc))},9.0,1a2b,6 [FLog::Network] Time to disconnect replication data: 0.1\n")
  page.set_viewport_size({'width': 1120, 'height': 760})
  page.wait_for_selector('.idle', timeout=10000)
  page.wait_for_timeout(2500)
  check('Not in a game' in page.inner_text('main'), 'now: idle after leaving')
  page.screenshot(path=f'{OUT}/c-idle.png')
  ctx.close()

host.terminate()
print('host log tail:\n' + ''.join(open('/work/shots/host.log').readlines()[-5:]))
print('companion.log tail:\n' + ''.join(open(f'{DATA}/companion.log').readlines()[-15:]))
noise = ('favicon', 'status of 404', 'ERR_CONNECTION_REFUSED')
errors = [e for e in errors if not any(n in e for n in noise)]
print('console errors:', len(errors))
for e in errors[:20]: print('  ', e)
print('ALL PASSED' if not fails else f'{len(fails)} FAILED: {fails}')
