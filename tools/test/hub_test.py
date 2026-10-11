"""End-to-end test of the community hub against the real API on CT116 (test login mode).
Site files are served from site-dist via route interception on the API's own origin."""
import base64, json, os, mimetypes
from playwright.sync_api import sync_playwright

API = 'http://192.168.2.44:8790'
SITE = '/work/site-dist'
OUT = '/work/shots'
errors = []

def serve_site(route):
    path = route.request.url.split(API, 1)[1].split('?')[0].split('#')[0]
    local = os.path.join(SITE, path.lstrip('/'))
    if path.endswith('/'):
        local = os.path.join(local, 'index.html')
    if not os.path.isfile(local):
        return route.fulfill(status=404, body='not found')
    route.fulfill(status=200, body=open(local, 'rb').read(), content_type=mimetypes.guess_type(local)[0] or 'application/octet-stream')

def browser_as(p, uid, name):
    ctx = p.chromium.launch(channel='chromium', headless=True).new_context(viewport={'width': 1280, 'height': 900})
    ctx.route(lambda u: u.startswith(API) and not u.startswith(API + '/api/'), serve_site)
    page = ctx.new_page()
    page.on('pageerror', lambda e: errors.append(f'[{name}] {e}'))
    page.on('console', lambda m: m.type == 'error' and errors.append(f'[{name}] console: {m.text[:200]}'))
    page.goto(f'{API}/api/auth/dev?id={uid}&name={name}&r=/community/')
    page.goto(f'{API}/community/')  # redirects aren't intercepted, so open the page ourselves
    page.wait_for_selector('.who', timeout=10000)
    return page

OUTFIT = {'type': 'R15', 'assets': [{'id': 1365767, 'name': 'Valkyrie Helm', 'type': 8}, {'id': 607785314, 'name': 'ROBLOX Jacket', 'type': 11}],
          'bodyColors': {'headColor': '#F8D9A0'}, 'scales': {'height': 1}, 'preview': 'https://tr.rbxcdn.com/30DAY-AvatarHeadshot-0-150-150-Png-noFilter'}

with sync_playwright() as p:
    a = browser_as(p, 1001, 'maker')
    print('maker status before:', a.inner_text('.notice')[:80])

    # apply
    a.goto(f'{API}/community/#/apply'); a.wait_for_selector('form')
    a.fill('textarea >> nth=0', 'I make GUI scripts and want to share them.')
    a.fill('textarea >> nth=1', 'Tween scripts, a round system, some outfits.')
    a.check('input[type=checkbox] >> nth=0'); a.check('input[type=checkbox] >> nth=1')
    a.click('button[type=submit]'); a.wait_for_timeout(800)
    print('after apply:', a.inner_text('.notice')[:90])
    a.screenshot(path=f'{OUT}/hub-apply.png')

    # admin approves
    admin = browser_as(p, 9001, 'admin')
    admin.goto(f'{API}/community/#/admin'); admin.wait_for_selector('h1')
    admin.wait_for_timeout(600)
    print('admin sees applications:', admin.locator('text=Approve').count())
    admin.screenshot(path=f'{OUT}/hub-admin.png', full_page=True)
    admin.click('text=Approve'); admin.wait_for_timeout(700)

    # maker posts a script
    a.goto(f'{API}/community/#/new'); a.wait_for_selector('form')
    a.fill('input.input >> nth=0', 'Smooth button hover tween')
    a.fill('textarea.code-input >> nth=0', 'local TweenService = game:GetService("TweenService")\nlocal button = script.Parent\n\n-- grow a little on hover\nbutton.MouseEnter:Connect(function()\n\tTweenService:Create(button, TweenInfo.new(0.15), {Size = UDim2.fromScale(1.05, 1.05)}):Play()\nend)\nprint("ready", 42)')
    a.fill('textarea >> nth=-1', 'Put this **LocalScript** inside any TextButton. Works with `UIScale` too.\n\nDocs: https://create.roblox.com/docs/reference/engine/classes/TweenService')
    a.fill('input.input >> nth=1', 'gui, tween, ui')
    a.click('button[type=submit]'); a.wait_for_url('**/#/post/*', timeout=8000); a.wait_for_timeout(700)
    print('script post url:', a.url.split('#')[1])
    a.screenshot(path=f'{OUT}/hub-post-script.png', full_page=True)
    script_url = a.url

    # outfit via share link
    enc = base64.b64encode(json.dumps(OUTFIT).encode()).decode()
    a.goto(f'{API}/community/#/new?outfit={enc}'); a.wait_for_selector('form'); a.wait_for_timeout(400)
    a.fill('input.input >> nth=0', 'Winter knight')
    a.click('button[type=submit]'); a.wait_for_url('**/#/post/*', timeout=8000); a.wait_for_timeout(500)
    print('outfit post side:', a.inner_text('aside')[:160].replace('\n', ' | '))

    # post with an image
    a.goto(f'{API}/community/#/new?type=post'); a.wait_for_selector('form')
    a.click('.seg button >> text=Post')
    a.fill('input.input >> nth=0', 'My first obby is out!')
    a.fill('textarea >> nth=-1', 'Took me 2 weeks. Feedback welcome!')
    png = base64.b64decode('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==')
    a.set_input_files('input[type=file]', files=[{'name': 'shot.png', 'mimeType': 'image/png', 'buffer': png}])
    a.wait_for_timeout(1500)
    print('upload preview:', a.locator('label.lbl img').count())
    a.click('button[type=submit]'); a.wait_for_url('**/#/post/*', timeout=8000)

    # like + comment on the script
    a.goto(script_url); a.wait_for_selector('.like'); a.click('.like'); a.wait_for_timeout(400)
    a.fill('form textarea', 'Tip: set the AnchorPoint to 0.5, 0.5 so it grows from the middle.')
    a.click('form button[type=submit]'); a.wait_for_timeout(800)
    print('comments shown:', a.locator('.comment').count(), '| like:', a.inner_text('.like'))

    # word filter
    a.goto(f'{API}/community/#/new?type=post'); a.wait_for_selector('form')
    a.click('.seg button >> text=Post')
    a.fill('input.input >> nth=0', 'kys lol')
    a.fill('textarea >> nth=-1', 'test')
    a.click('button[type=submit]'); a.wait_for_timeout(600)
    print('filter message:', a.inner_text('.error-text >> nth=-1'))

    # reader (not approved) reports the script post
    r = browser_as(p, 1002, 'reader')
    r.goto(script_url); r.wait_for_selector('.like')
    print('reader comment gate:', r.inner_text('.notice')[:70])
    r.click('text=Report'); r.fill('dialog textarea', 'Testing the report button'); r.click('dialog button[type=submit]'); r.wait_for_timeout(600)
    print('report sent:', r.inner_text('dialog')[:50])

    # admin handles the report
    admin.goto(f'{API}/community/#/'); admin.wait_for_timeout(300)
    admin.goto(f'{API}/community/#/admin'); admin.wait_for_timeout(1200)
    print('open reports:', admin.locator('text=Remove it').count())
    admin.click('text=Dismiss'); admin.wait_for_timeout(600)

    # feed screenshots
    a.goto(f'{API}/community/#/'); a.wait_for_selector('.post-card'); a.wait_for_timeout(800)
    print('feed cards:', a.locator('.post-card').count())
    a.screenshot(path=f'{OUT}/hub-feed.png', full_page=True)
    a.emulate_media(color_scheme='dark'); a.wait_for_timeout(300)
    a.screenshot(path=f'{OUT}/hub-feed-dark.png', full_page=True)
    a.set_viewport_size({'width': 390, 'height': 844})
    a.goto(script_url); a.wait_for_timeout(800)
    a.screenshot(path=f'{OUT}/hub-post-mobile.png', full_page=True)

print('\n'.join(errors) or 'no page errors')
