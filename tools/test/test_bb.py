import json, re, time, random
from playwright.sync_api import sync_playwright

EXT = '/work/Bloxboard'
OUT = '/work/shots'
errors = []

AV = 'data:image/svg+xml,' + '%3Csvg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"%3E%3Ccircle cx="5" cy="5" r="5" fill="%23{c}"/%3E%3C/svg%3E'
COLORS = ['8a9cff', 'ffb86b', '6bd6a5', 'ff8fa3', 'b18cff', '6bc6ff', 'f2d16b']
def av(i): return AV.format(c=COLORS[int(i) % len(COLORS)])

ME = {'id': 1001, 'name': 'enes_dev', 'displayName': 'Enes'}
FRIENDS = list(range(2001, 2015))
NAMES = ['Lynx', 'Mira', 'Tobi', 'Daan', 'Sem', 'Noor', 'Jayden', 'Fleur', 'Bram', 'Liv', 'Milan', 'Saar', 'Ravi', 'Yara']
GAMES = {'Adopt Me!': 920587237, 'Blox Fruits': 2753915549, 'Brookhaven RP': 4924922222, 'Doors': 6516141723}
ITEMS = {
  '1365767': ['Valkyrie Helm', 'VH', 240000, 300000, 300000, 3, 2, -1, -1, -1],
  '1029025': ['The Classic ROBLOX Fedora', 'CRF', 98000, 120000, 120000, 2, 2, -1, -1, -1],
  '19027209': ['Perfectly Legitimate Business Hat', 'PLBH', 41000, -1, 41000, -1, -1, -1, -1, -1],
  '20573078': ['Shaggy', '', 8200, 9000, 9000, 1, 2, 1, -1, -1],
  '16630147': ['Beautiful Hair for Beautiful People', 'BHFBP', 5100, 5500, 5500, 3, 2, -1, 1, -1],
  '48545806': ['Rainbow Shaggy', 'RS', 52000, 60000, 60000, 4, 3, -1, -1, 1],
}

def j(route, obj, status=200):
  origin = route.request.headers.get('origin') or '*'
  route.fulfill(status=status, content_type='application/json', body=json.dumps(obj),
    headers={'access-control-allow-origin': origin, 'access-control-allow-credentials': 'true'})

HOME_HTML = '''<!doctype html><html><head><title>Home</title></head><body class="light-theme" style="background:#fff;font-family:sans-serif">
<div id="content"><div id="HomeContainer"><h1>Home</h1><div class="friends-section"><div class="friend-carousel-container">Friends carousel (mock)</div></div>
<div class="game-sort">Recommended for you (mock)</div></div></div></body></html>'''

TRADE_HTML = '''<!doctype html><html><head><title>Trades</title></head><body style="background:#fff;font-family:sans-serif">
<div id="content"><div class="trades-container"><div class="trades-list-detail">
<div class="trade-list-detail-offer"><h3>Items you will give</h3>
 <div class="item-card-container"><a href="https://www.roblox.com/catalog/1029025/x">The Classic ROBLOX Fedora</a></div>
 <div class="item-card-container"><a href="https://www.roblox.com/catalog/20573078/x">Shaggy</a></div></div>
<div class="trade-list-detail-offer"><h3>Items you will receive</h3>
 <div class="item-card-container"><a href="https://www.roblox.com/catalog/48545806/x">Rainbow Shaggy</a></div>
 <div><span>Robux Offered</span> <span>2,500</span></div></div>
<button class="btn-cta-md" id="accept">Accept</button> <span id="accepted"></span>
</div></div></div>
<script>document.getElementById('accept').onclick=()=>{document.getElementById('accepted').textContent='ROBLOX ACCEPT HANDLER RAN'}</script>
</body></html>'''

def handler(route):
  url = route.request.url
  if url.rstrip('/') == 'https://www.roblox.com/home':
    return route.fulfill(status=200, content_type='text/html', body=HOME_HTML)
  if url.rstrip('/') == 'https://www.roblox.com/charts':
    return route.fulfill(status=200, content_type='text/html', body='<!doctype html><body style="font-family:sans-serif"><div style="display:flex;gap:16px">' + ''.join(f'<a href="https://www.roblox.com/games/{pid}/x" style="width:150px;display:block"><div><img src="{AV.format(c="6bd6a5")}" width="150" height="150"></div>{n}</a>' for pid, n in [(2753915549, 'Blox Fruits'), (920587237, 'Adopt Me!'), (606849621, 'Jailbreak')]) + '</div></body>')
  if url.rstrip('/') == 'https://www.roblox.com/trades':
    return route.fulfill(status=200, content_type='text/html', body=TRADE_HTML)
  if 'transaction-totals' in url:
    return j(route, {'salesTotal': 1200, 'purchasesTotal': -3450, 'currencyPurchasesTotal': 4500, 'premiumStipendsTotal': 1000, 'tradeSystemEarningsTotal': 0, 'pendingRobuxTotal': 300, 'incomingRobuxTotal': 6700, 'outgoingRobuxTotal': 3450, 'groupPayoutsTotal': 0})
  if '/transactions?' in url:
    import datetime
    rows = []
    names = [('Speed Coil', 'GamePass', 'Doors'), ('500 Gems', 'DeveloperProduct', 'Blox Fruits'), ('Black Hair', 'Asset', None), ('VIP', 'GamePass', 'Adopt Me!'), ('Ice Wings', 'Asset', None)]
    for i in range(40):
      n, t, place = names[i % 5]
      d = datetime.datetime.now() - datetime.timedelta(days=i * 9)
      rows.append({'id': i, 'created': d.isoformat() + 'Z', 'agent': {'id': 5, 'type': 'User', 'name': place or 'Roblox'}, 'details': {'id': 1000 + i, 'name': n, 'type': t, 'place': {'name': place} if place else None}, 'currency': {'amount': -(50 + (i * 37) % 400), 'type': 'Robux'}})
    return j(route, {'data': rows, 'nextPageCursor': None})
  if 'v2/avatar/users' in url:
    return j(route, {'scales': {'height': 1, 'width': 1, 'head': 1, 'depth': 1, 'proportion': 0, 'bodyType': 0}, 'playerAvatarType': 'R15', 'bodyColor3s': {'headColor3': 'F8D9A0', 'torsoColor3': '0D69AC', 'leftArmColor3': 'F8D9A0', 'rightArmColor3': 'F8D9A0', 'leftLegColor3': '6E99CA', 'rightLegColor3': '6E99CA'}, 'assets': [{'id': 607702162, 'name': 'Roblox Baseball Cap', 'assetType': {'id': 8}}, {'id': 301811432, 'name': 'Oakley Pants', 'assetType': {'id': 12}}]})
  if 'avatar/render' in url:
    return j(route, {'state': 'Completed', 'imageUrl': AV.format(c='8a9cff')})
  if 'catalog.roblox.com/v1/search/items/details' in url:
    return j(route, {'data': [{'id': 9000 + i, 'itemType': 'Asset', 'assetType': [8, 41, 11, 12, 42, 8][i % 6], 'name': ['Valkyrie Helm', 'Black Hair', 'Hoodie', 'Jeans', 'Shades', 'Crown'][i % 6] + (f' {i}' if i > 5 else ''), 'price': (i * 75) % 500, 'lowestPrice': None} for i in range(12)], 'nextPageCursor': 'x'})
  try:
    body = route.request.post_data_json if route.request.method == 'POST' else None
  except Exception:
    body = None
  if 'rolimons.com/itemapi/itemdetails' in url: return j(route, {'success': True, 'items': ITEMS})
  if 'api.rolimons.com/players' in url: return j(route, {'success': True, 'value': 184500, 'rap': 121300, 'privacy_enabled': False})
  if 'users/authenticated' in url: return j(route, ME)
  if '/currency' in url: return j(route, {'robux': 12450})
  if 'validate-membership' in url: return j(route, True)
  if 'Inbound/count' in url: return j(route, {'count': 3})
  if 'avatar-headshot' in url:
    ids = re.search(r'userIds=([\d,]+)', url).group(1).split(',')
    return j(route, {'data': [{'targetId': int(i), 'state': 'Completed', 'imageUrl': av(i)} for i in ids]})
  if 'games/icons' in url or '/v1/assets?' in url:
    ids = re.search(r'(?:universeIds|assetIds)=([\d,]+)', url).group(1).split(',')
    return j(route, {'data': [{'targetId': int(i), 'state': 'Completed', 'imageUrl': av(int(i) // 7)} for i in ids]})
  if 'friends/find' in url: return j(route, {'PageItems': [{'id': i} for i in FRIENDS], 'NextCursor': None})
  if 'friends.roblox.com' in url and 'count' in url: return j(route, {'count': random.randint(40, 900)})
  if url.endswith('users.roblox.com/v1/users') and body:
    return j(route, {'data': [{'id': i, 'name': NAMES[(i - 2001) % len(NAMES)].lower() + '_rbx', 'displayName': NAMES[(i - 2001) % len(NAMES)]} for i in body['userIds']]})
  if 'usernames/users' in url: return j(route, {'data': [{'id': 2003, 'name': 'tobi_rbx', 'displayName': 'Tobi'}]})
  m = re.search(r'users\.roblox\.com/v1/users/(\d+)$', url)
  if m: return j(route, {'id': int(m.group(1)), 'name': 'tobi_rbx', 'displayName': 'Tobi', 'created': '2017-04-02T10:00:00Z', 'description': 'trading every day\nno lowballs pls', 'isBanned': False, 'hasVerifiedBadge': False})
  if 'presence/users' in url:
    out = []
    games = list(GAMES.items())
    for i in body['userIds']:
      k = i % 5
      if k in (0, 1):
        g = games[i % len(games)]
        out.append({'userId': i, 'userPresenceType': 2, 'lastLocation': g[0], 'placeId': g[1], 'rootPlaceId': g[1], 'gameId': 'a1b2c3d4-0000-4000-8000-%012d' % i, 'universeId': 100 + i % 4})
      elif k == 2: out.append({'userId': i, 'userPresenceType': 1, 'lastLocation': 'Website'})
      else: out.append({'userId': i, 'userPresenceType': 0, 'lastLocation': 'Website'})
    return j(route, {'userPresences': out})
  m = re.search(r'trades/v1/trades/(Inbound|Outbound|Completed|Inactive)\?', url.replace('trades.roblox.com', 'trades'))
  if m: return j(route, {'data': [{'id': 900 + i, 'user': {'id': 2001 + i, 'name': NAMES[i].lower() + '_rbx', 'displayName': NAMES[i]}, 'created': '2026-10-%02dT12:00:00Z' % (10 - i), 'status': 'Open'} for i in range(3)]})
  m = re.search(r'/v2/trades/(\d+)', url)
  if m:
    i = int(m.group(1)) - 900
    give = [('1029025', 'The Classic ROBLOX Fedora'), ('20573078', 'Shaggy')][: 1 + i % 2]
    get = [('1365767', 'Valkyrie Helm')] if i == 0 else [('48545806', 'Rainbow Shaggy'), ('16630147', 'Beautiful Hair for Beautiful People')]
    mk = lambda lst: [{'itemTarget': {'itemType': 'Asset', 'targetId': a}, 'itemName': n, 'serialNumber': (17 if a == '1365767' else None)} for a, n in lst]
    return j(route, {'tradeId': int(m.group(1)), 'participantAOffer': {'user': ME, 'items': mk(give), 'robux': 0}, 'participantBOffer': {'user': {'id': 2001 + i, 'name': 'x', 'displayName': NAMES[i]}, 'items': mk(get), 'robux': 2500 if i == 1 else 0}})
  if 'assets/collectibles' in url:
    return j(route, {'data': [{'assetId': int(a), 'name': r[0], 'recentAveragePrice': r[2], 'serialNumber': None} for a, r in list(ITEMS.items())[1:5]], 'nextPageCursor': None})
  return j(route, {'errors': [{'message': 'not mocked ' + url}]}, 404)

with sync_playwright() as p:
  ctx = p.chromium.launch_persistent_context('/tmp/bb-profile', channel='chromium', headless=True,
    args=[f'--disable-extensions-except={EXT}', f'--load-extension={EXT}'], viewport={'width': 1360, 'height': 900})
  sw = ctx.service_workers[0] if ctx.service_workers else ctx.wait_for_event('serviceworker', timeout=15000)
  ext_id = sw.url.split('/')[2]
  print('extension id', ext_id)

  def watch(page, tag):
    page.on('console', lambda m: m.type in ('error', 'warning') and errors.append(f'[{tag}] {m.type}: {m.text[:300]}'))
    page.on('pageerror', lambda e: errors.append(f'[{tag}] pageerror: {e}'))

  # ---- real roblox game page, logged out ----
  page = ctx.new_page(); watch(page, 'game')
  page.goto('https://www.roblox.com/games/920587237/Adopt-Me', wait_until='domcontentloaded', timeout=60000)
  try:
    page.wait_for_selector('#bbx-game', timeout=30000, state='attached')
    print('game panel mounted')
    page.evaluate("document.getElementById('cookie-banner-wrapper')?.remove()")
    tab = page.query_selector('#tab-game-instances')
    if tab: tab.click()
    page.wait_for_timeout(9000)
    print('game panel text:', page.inner_text('#bbx-game')[:500].replace('\n', ' | '))
    page.locator('#bbx-game').screenshot(path=f'{OUT}/game-panel.png')
    try:
      inp = page.locator('#navbar-search-input, input.navbar-search-input, #navbar-universal-search input, header input[type="search"]').first
      print('navbar input:', inp.evaluate('e => e.outerHTML.slice(0, 200)'))
      inp.click(); inp.type('adopt', delay=60)
      page.wait_for_selector('#bbx-search:not([hidden]) .bbx-sr', timeout=12000)
      print('quick search:', page.inner_text('#bbx-search').replace('\n', ' | ')[:400])
      page.screenshot(path=f'{OUT}/search.png')
      inp.press('Escape')
    except Exception as e:
      print('search problem:', e)
    page.select_option('#bbx-game select[data-key=sort]', 'least')
    page.fill('#bbx-game input[data-key=max]', '30')
    page.select_option('#bbx-game select[data-key=ping]', '100')
    page.wait_for_timeout(500)
    print('after filters:', page.inner_text('#bbx-game .bbx-toolbar').replace('\n', ' | '))
    page.locator('#bbx-game').screenshot(path=f'{OUT}/game-filters.png')
    page.click('#bbx-game .bbx-tab:nth-child(2)'); page.wait_for_timeout(500)
    print('recent tab:', page.inner_text('#bbx-game .bbx-view:not([hidden])')[:200])
    page.select_option('#bbx-game select[data-key=max]', '') if False else None
    page.click('#bbx-game .bbx-tab:nth-child(3)')
    page.fill('#bbx-game input.bbx-input.bbx-grow', 'Roblox')
    page.click('#bbx-game form button[type=submit]')
    page.wait_for_timeout(15000)
    print('finder status:', page.inner_text('#bbx-game .bbx-view:not([hidden])')[:300].replace('\n', ' | '))
    page.locator('#bbx-game').screenshot(path=f'{OUT}/game-finder.png')
  except Exception as e:
    print('game page problem:', e)
  page.screenshot(path=f'{OUT}/game-full.png')

  # ---- real profile page, logged out ----
  page2 = ctx.new_page(); watch(page2, 'profile')
  page2.goto('https://www.roblox.com/users/1/profile', wait_until='domcontentloaded', timeout=60000)
  try:
    page2.wait_for_selector('#bbx-profile', timeout=20000, state='attached')
    page2.wait_for_timeout(5000)
    print('profile strip:', page2.inner_text('#bbx-profile').replace('\n', ' | '), '| floating:', page2.eval_on_selector('#bbx-profile', 'e => e.classList.contains("bbx-floating")'))
  except Exception as e:
    print('profile problem:', e)
  page2.screenshot(path=f'{OUT}/profile.png')

  # ---- real catalog page of a limited ----
  page3 = ctx.new_page(); watch(page3, 'item')
  page3.goto('https://www.roblox.com/catalog/1365767/Valkyrie-Helm', wait_until='domcontentloaded', timeout=60000)
  try:
    page3.wait_for_selector('#bbx-item', timeout=25000, state='attached')
    page3.evaluate("document.getElementById('cookie-banner-wrapper')?.remove()")
    page3.wait_for_timeout(1500)
    print('item card:', page3.inner_text('#bbx-item').replace('\n', ' | '), '| floating:', page3.eval_on_selector('#bbx-item', 'e => e.classList.contains("bbx-floating")'))
  except Exception as e:
    print('item problem:', e)
  page3.screenshot(path=f'{OUT}/item.png')

  # ---- dashboard with mocked APIs ----
  sw.evaluate('''() => {
    const games = {101: {name: 'Blox Fruits', placeId: 2753915549}, 102: {name: 'Adopt Me!', placeId: 920587237}, 103: {name: 'Doors', placeId: 6516141723}, 100: {name: 'Brookhaven RP', placeId: 4924922222}};
    const playtime = {};
    const d = new Date();
    for (let i = 0; i < 30; i++) {
      const x = new Date(d); x.setDate(d.getDate() - i);
      const k = `${x.getFullYear()}-${String(x.getMonth()+1).padStart(2,'0')}-${String(x.getDate()).padStart(2,'0')}`;
      if (i % 6 === 5) continue;
      playtime[k] = {101: (i * 37) % 140 + 20, 102: (i * 13) % 50, 103: i % 3 ? 0 : 45};
    }
    const recentServers = [
      {gameId: 'f038d614-34b8-4fdf-a97e-2d5289c7567c', placeId: 2753915549, rootPlaceId: 2753915549, universeId: 101, name: 'Blox Fruits', joinedAt: Date.now() - 7200e3, lastSeen: Date.now() - 1800e3, minutes: 84},
      {gameId: '58ec10a5-ceec-4330-8248-9086931590e9', placeId: 920587237, rootPlaceId: 920587237, universeId: 102, name: 'Adopt Me!', joinedAt: Date.now() - 86400e3, lastSeen: Date.now() - 80000e3, minutes: 35}];
    const playHours = {}; for (let wd = 0; wd < 7; wd++) for (let h = 0; h < 24; h++) { const v = ((h >= 15 && h <= 22) ? 20 : 0) + ((wd === 0 || wd === 6) && h >= 11 ? 25 : 0) + ((wd * 7 + h * 3) % 6); if (v > 3) playHours[`${wd}-${h}`] = v; }
    const friendLog = [{at: Date.now() - 3600e3, id: 2005, type: 'added', name: 'Sem', username: 'sem_rbx'}, {at: Date.now() - 86400e3 * 2, id: 2010, type: 'removed', name: 'Milan', username: 'milan_rbx'}];
    const notes = {2003: 'Fair trader, prefers adds over robux.'};
    const errorLog = [{at: Date.now() - 600e3, where: '/v1/games/920587237/servers/Public', message: 'HTTP 429 from games.roblox.com', page: 'https://www.roblox.com/games/920587237'}];
    const autoDeclined = [{at: Date.now() - 7200e3, id: 977, user: 'Bram', give: 120000, get: 41000, pct: -66}];
    return chrome.storage.local.set({friendLog, notes, errorLog, autoDeclined, playtime, games, recentServers, playHours, currentGame: {universeId: 101, since: Date.now()}});
  }''')
  ctx.route(re.compile(r'https://([a-z]+\.)?(roblox|rolimons)\.com/.*'), handler)
  home = ctx.new_page(); watch(home, 'home')
  home.goto('https://www.roblox.com/home')
  try:
    home.wait_for_selector('#bbx-home .bbx-home-card', timeout=15000)
    home.wait_for_timeout(1000)
    print('home row:', home.inner_text('#bbx-home').replace('\n', ' | ')[:300], '| after friends:', home.evaluate("document.querySelector('#bbx-home').previousElementSibling?.className"))
    home.click('#bbx-home .bbx-seg button >> nth=2'); home.wait_for_timeout(800)
  except Exception as e:
    print('home problem:', e)
  try:
    print('home html:', home.evaluate("document.body.innerHTML.slice(0, 600)"))
    home.screenshot(path=f'{OUT}/home.png', full_page=True)
  except Exception as e:
    print('home screenshot problem:', e)
  print('\n'.join(x for x in errors if x.startswith('[home]')) or 'no home errors')

  cards = ctx.new_page(); watch(cards, 'cards')
  cards.goto('https://www.roblox.com/charts'); cards.wait_for_timeout(2500)
  print('card badges:', cards.locator('.bbx-card-time').all_inner_texts())
  cards.screenshot(path=f'{OUT}/cards.png')

  tr = ctx.new_page(); watch(tr, 'trade')
  tr.goto('https://www.roblox.com/trades')
  try:
    tr.wait_for_selector('#bbx-trade-bar', timeout=15000)
    print('trade bar:', tr.inner_text('#bbx-trade-bar').replace('\n', ' | '))
    print('trade lines:', [l.replace('\n', ' ') for l in tr.locator('.bbx-trade-line').all_inner_texts()])
    tr.click('#accept'); tr.wait_for_timeout(500)
    print('modal shown:', tr.locator('.bbx-modal').count(), '| roblox handler before confirm:', repr(tr.inner_text('#accepted')))
    tr.screenshot(path=f'{OUT}/trade-modal.png')
    tr.click('.bbx-modal .bbx-danger'); tr.wait_for_timeout(300)
    print('roblox handler after confirm:', repr(tr.inner_text('#accepted')))
  except Exception as e:
    print('trade problem:', e)
  tr.screenshot(path=f'{OUT}/trade.png', full_page=True)

  dash = ctx.new_page(); watch(dash, 'dash')
  for route_name in ['home', 'playtime', 'friends', 'trades', 'robux', 'items', 'sandbox', 'lookup/tobi_rbx', 'settings']:
    dash.goto(f'chrome-extension://{ext_id}/dashboard/dashboard.html#{route_name}')
    dash.wait_for_timeout(2500)
    if route_name in ('sandbox', 'robux'):
      dash.wait_for_timeout(2000)
    if route_name == 'sandbox':
      dash.click('.catalog-item >> nth=0'); dash.wait_for_timeout(800)
      print('sandbox wearing:', dash.inner_text('.chips').replace('\n', ' '), '|', dash.inner_text('.sandbox-left p.small'))
    if route_name == 'trades':
      dash.click('.trade-summary >> nth=1'); dash.wait_for_timeout(1500)
    dash.screenshot(path=f'{OUT}/dash-{route_name.split("/")[0]}.png', full_page=True)
    print('dash', route_name, 'errors on page:', dash.eval_on_selector_all('.error', 'n => n.map(x => x.textContent)'))
  dash.emulate_media(color_scheme='dark')
  dash.goto(f'chrome-extension://{ext_id}/dashboard/dashboard.html#home'); dash.wait_for_timeout(2500)
  dash.screenshot(path=f'{OUT}/dash-home-dark.png', full_page=True)
  dash.set_viewport_size({'width': 400, 'height': 860})
  dash.goto(f'chrome-extension://{ext_id}/dashboard/dashboard.html#trades'); dash.wait_for_timeout(2500)
  dash.screenshot(path=f'{OUT}/dash-trades-mobile.png', full_page=True)
  ctx.close()

print('\n'.join(errors) or 'no console errors')
