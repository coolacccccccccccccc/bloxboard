#!/usr/bin/env python3
"""Build Bloxboard: pack the extension and assemble the website.

  python3 tools/build.py            # build dist/ and site-dist/
  python3 tools/build.py --bump     # bump the patch version first (0.1.0 -> 0.1.1)

Output:
  dist/bloxboard-<ver>.crx / .zip     signed CRX (keys/bloxboard.pem) + plain zip
  site-dist/                          the website, ready for tools/deploy.sh
"""
import html, json, os, re, shutil, subprocess, sys, zipfile, datetime

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
EXT = os.path.join(ROOT, 'extension')
DIST = os.path.join(ROOT, 'dist')
SITE = os.path.join(ROOT, 'site')
SITE_OUT = os.path.join(ROOT, 'site-dist')
KEY = os.path.join(ROOT, 'keys', 'bloxboard.pem')
BASE_URL = 'https://bloxboard.enesserver.dev'


def manifest():
    with open(os.path.join(EXT, 'manifest.json')) as f:
        return json.load(f)


def bump():
    m = manifest()
    parts = [int(x) for x in m['version'].split('.')]
    parts[-1] += 1
    m['version'] = '.'.join(map(str, parts))
    with open(os.path.join(EXT, 'manifest.json'), 'w') as f:
        json.dump(m, f, indent=2)
        f.write('\n')
    print('version ->', m['version'])


def ext_files():
    for dirpath, _, files in os.walk(EXT):
        for name in sorted(files):
            full = os.path.join(dirpath, name)
            yield full, os.path.relpath(full, EXT)


def pack(version):
    os.makedirs(DIST, exist_ok=True)
    zip_path = os.path.join(DIST, f'bloxboard-{version}.zip')
    crx_path = os.path.join(DIST, f'bloxboard-{version}.crx')
    with zipfile.ZipFile(zip_path, 'w', zipfile.ZIP_DEFLATED) as z:
        for full, rel in ext_files():
            z.write(full, f'bloxboard/{rel}')
    files = [full for full, _ in ext_files()]
    crx3 = os.path.join(ROOT, 'tools', 'node_modules', '.bin', 'crx3')
    subprocess.run([crx3, '-p', KEY, '-o', crx_path, *files], check=True, cwd=EXT, stdout=subprocess.DEVNULL)
    return zip_path, crx_path


def extension_id():
    """Chrome extension id = first 32 hex chars of sha256(DER public key), mapped 0-f -> a-p."""
    der = subprocess.run(['openssl', 'rsa', '-in', KEY, '-pubout', '-outform', 'DER'], check=True, capture_output=True).stdout
    import hashlib
    digest = hashlib.sha256(der).hexdigest()[:32]
    return ''.join(chr(ord('a') + int(c, 16)) for c in digest)


# ---------- tiny markdown renderer for docs pages ----------

def inline(text):
    text = html.escape(text, quote=False)
    text = re.sub(r'`([^`]+)`', r'<code>\1</code>', text)
    text = re.sub(r'\*\*([^*]+)\*\*', r'<strong>\1</strong>', text)
    text = re.sub(r'(?<![\w*])\*([^*]+)\*(?!\w)', r'<em>\1</em>', text)
    text = re.sub(r'\[([^\]]+)\]\(([^)]+)\)', r'<a href="\2">\1</a>', text)
    return text


def markdown(md):
    out, in_list, para = [], False, []

    def flush_para():
        if para:
            out.append(f'<p>{inline(" ".join(para))}</p>')
            para.clear()

    def close_list():
        nonlocal in_list
        if in_list:
            out.append('</ul>')
            in_list = False

    for line in md.splitlines():
        s = line.rstrip()
        m_head = re.match(r'^(#{1,4})\s+(.*)', s)
        m_task = re.match(r'^\s*[-*]\s+\[( |x|X|~)\]\s+(.*)', s)
        m_item = re.match(r'^\s*[-*]\s+(.*)', s)
        if not s:
            flush_para(); close_list(); continue
        if m_head:
            flush_para(); close_list()
            level = len(m_head.group(1))
            text = m_head.group(2)
            slug = re.sub(r'[^a-z0-9]+', '-', text.lower()).strip('-')
            out.append(f'<h{level} id="{slug}">{inline(text)}</h{level}>')
        elif m_task or m_item:
            flush_para()
            if not in_list:
                out.append('<ul>')
                in_list = True
            if m_task:
                mark = m_task.group(1).lower()
                state = {'x': 'done', '~': 'doing', ' ': 'todo'}[mark]
                label = {'done': 'Done', 'doing': 'In progress', 'todo': 'To do'}[state]
                out.append(f'<li class="task {state}"><span class="box" role="img" aria-label="{label}"></span><span>{inline(m_task.group(2))}</span></li>')
            else:
                out.append(f'<li>{inline(m_item.group(1))}</li>')
        elif s.startswith('>'):
            flush_para(); close_list()
            out.append(f'<blockquote>{inline(s.lstrip("> "))}</blockquote>')
        else:
            para.append(s.strip())
    flush_para(); close_list()
    return '\n'.join(out)


def progress(md):
    done = len(re.findall(r'^\s*[-*]\s+\[[xX]\]', md, re.M))
    doing = len(re.findall(r'^\s*[-*]\s+\[~\]', md, re.M))
    todo = len(re.findall(r'^\s*[-*]\s+\[ \]', md, re.M))
    return done, doing, todo


def build_site(version, ext_id, zip_path, crx_path):
    if os.path.exists(SITE_OUT):
        shutil.rmtree(SITE_OUT)
    shutil.copytree(SITE, SITE_OUT)
    dl = os.path.join(SITE_OUT, 'download')
    os.makedirs(dl, exist_ok=True)
    shutil.copy(crx_path, os.path.join(dl, 'bloxboard.crx'))
    shutil.copy(zip_path, os.path.join(dl, 'bloxboard.zip'))
    shutil.copy(crx_path, dl)
    shutil.copy(zip_path, dl)
    shutil.copy(os.path.join(EXT, 'icons', '128.png'), os.path.join(SITE_OUT, 'icon.png'))
    shutil.copy(os.path.join(EXT, 'icons', '48.png'), os.path.join(SITE_OUT, 'favicon.png'))

    with open(os.path.join(SITE_OUT, 'updates.xml'), 'w') as f:
        f.write(f"""<?xml version='1.0' encoding='UTF-8'?>
<gupdate xmlns='http://www.google.com/update2/response' protocol='2.0'>
  <app appid='{ext_id}'>
    <updatecheck codebase='{BASE_URL}/download/bloxboard-{version}.crx' version='{version}' />
  </app>
</gupdate>
""")

    # Windows companion (built separately by tools/build-companion.sh).
    exe = os.path.join(DIST, 'BloxboardCompanion.exe')
    comp = {'{{COMP_VERSION}}': '1.0.0', '{{COMP_MB}}': '?', '{{COMP_SHA}}': 'not built yet', '{{COMP_FILE}}': 'BloxboardCompanion.exe'}
    if os.path.exists(exe):
        import hashlib
        shutil.copy(exe, os.path.join(dl, 'BloxboardCompanion.exe'))
        csproj = open(os.path.join(ROOT, 'companion', 'App', 'App.csproj')).read()
        comp_ver = re.search(r'<Version>([^<]+)</Version>', csproj).group(1)
        # Versioned copy for the download links: Cloudflare caches the plain name for hours.
        shutil.copy(exe, os.path.join(dl, f'BloxboardCompanion-{comp_ver}.exe'))
        comp = {
            '{{COMP_FILE}}': f'BloxboardCompanion-{comp_ver}.exe',
            '{{COMP_VERSION}}': comp_ver,
            '{{COMP_MB}}': str(round(os.path.getsize(exe) / 1024 / 1024)),
            '{{COMP_SHA}}': hashlib.sha256(open(exe, 'rb').read()).hexdigest(),
        }

    plan_md = open(os.path.join(ROOT, 'docs', 'PLAN.md')).read()
    changelog_md = open(os.path.join(ROOT, 'CHANGELOG.md')).read()
    done, doing, todo = progress(plan_md)
    total = max(done + doing + todo, 1)
    stamp = datetime.datetime.now().strftime('%Y-%m-%d %H:%M')
    replacements = {
        '{{VERSION}}': version,
        '{{EXT_ID}}': ext_id,
        '{{BUILT}}': stamp,
        '{{PLAN_HTML}}': markdown(plan_md),
        '{{CHANGELOG_HTML}}': markdown(changelog_md),
        '{{DONE}}': str(done),
        '{{DOING}}': str(doing),
        '{{TODO}}': str(todo),
        '{{PCT}}': str(round(done / total * 100)),
        '{{CRX_KB}}': str(round(os.path.getsize(crx_path) / 1024)),
        **comp,
    }
    for name in os.listdir(SITE_OUT):
        if name.endswith('.html'):
            path = os.path.join(SITE_OUT, name)
            text = open(path).read()
            for k, v in replacements.items():
                text = text.replace(k, v)
            # Same for the extension downloads.
            text = text.replace('href="download/bloxboard.zip"', f'href="download/bloxboard-{version}.zip"').replace('href="download/bloxboard.crx"', f'href="download/bloxboard-{version}.crx"')
            open(path, 'w').write(text)


def main():
    if '--bump' in sys.argv:
        bump()
    version = manifest()['version']
    for name in ('lib.js', 'background.js', 'content/common.js', 'content/game.js', 'content/profile.js', 'dashboard/dashboard.js'):
        subprocess.run(['node', '--check', os.path.join(EXT, name)], check=True)
    zip_path, crx_path = pack(version)
    ext_id = extension_id()
    build_site(version, ext_id, zip_path, crx_path)
    print(f'built v{version}  id={ext_id}')
    print(' ', os.path.relpath(crx_path, ROOT))
    print(' ', os.path.relpath(zip_path, ROOT))
    print('  site-dist/  (run tools/deploy.sh to publish)')


if __name__ == '__main__':
    main()
