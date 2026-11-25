#!/usr/bin/env python3
"""Build the upload bundle for Technion central hosting (web3cloud, cPanel).

Usage:
    python3 scripts/build_deploy.py VERSION [--out DIR] [--force]

Writes DIR/vVERSION/ (DIR defaults to ../Boeing-www-deploy-staging beside the
primary checkout) holding exactly the tree that goes in public_html, plus
www.zip of the same tree. Upload the CONTENTS, including the dotfile
.htaccess, not the folder.

What ships is an ALLOWLIST: index.html, assets/, and the files in deploy/. A
new dev file added to the repo is excluded by default. The build fails loudly
rather than shipping a broken site; see verify().

Fonts: the repo's styles.css @imports Google Fonts (GitHub Pages keeps using
that). The bundle ships the self-hosted copies in deploy/vendor/fonts/ as
assets/vendor/fonts/ and drops the @import, so the CSP allows no font CDN.
"""

import argparse
import datetime
import json
import posixpath
import re
import shutil
import subprocess
import sys
import zipfile
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
DEPLOY_SRC = REPO_ROOT / "deploy"
FONTS_SRC = DEPLOY_SRC / "vendor" / "fonts"

# The single source for canonical, og:url, sitemap.xml and robots.txt;
# verify() fails the build if a page disagrees with it.
SITE = "https://boeing.technion.ac.il"

PAGES = ["index.html"]                       # indexable, in sitemap order
ROOT_FILES = [".htaccess", "robots.txt", "404.html"]
ASSET_EXCLUDE = [re.compile(r"\.test\.js$")]

# Every third-party origin the browser may fetch, by CSP directive. Anything
# else fetched by a shipped page fails verify().
THIRD_PARTY = {
    "frame-src": ["https://player.vimeo.com", "https://www.google.com"],
}
FONT_IMPORT = re.compile(r'@import\s*"https://fonts\.googleapis\.com/[^"]*"\s*;?')


def page_url(rel):
    return SITE + "/" if rel == "index.html" else SITE + "/" + rel


def should_ship(rel):
    if rel in PAGES:
        return True
    if not rel.startswith("assets/"):
        return False
    return not any(p.search(rel) for p in ASSET_EXCLUDE)


def walk(root):
    return sorted(p.relative_to(root).as_posix() for p in root.rglob("*") if p.is_file())


def last_commit_date(rel):
    try:
        out = subprocess.run(["git", "log", "-1", "--format=%cs", "--", rel], cwd=REPO_ROOT,
                             capture_output=True, text=True, check=True).stdout.strip()
    except (OSError, subprocess.CalledProcessError):
        return None
    return out if re.fullmatch(r"\d{4}-\d{2}-\d{2}", out) else None


def csp(sources):
    directives = {
        "default-src": ["'self'"],
        "script-src": ["'self'", "'unsafe-inline'"],
        "style-src": ["'self'", "'unsafe-inline'"],
        "img-src": ["'self'", "data:"],
        "font-src": ["'self'"],
        "connect-src": ["'self'"],
        "media-src": ["'self'"],
        "frame-src": [],
        "object-src": ["'none'"],
        "base-uri": ["'self'"],
        "form-action": ["'self'"],
        "frame-ancestors": ["'self'"],
    }
    for name, hosts in sources.items():
        directives[name] = directives[name] + hosts
    parts = [name + " " + " ".join(vals) for name, vals in directives.items() if vals]
    return "; ".join(parts + ["upgrade-insecure-requests"])


def replace_once(text, find, repl, what):
    if text.count(find) != 1:
        raise SystemExit("build: %s must occur exactly once, found %d" % (what, text.count(find)))
    return text.replace(find, repl)


def head_tags(html):
    """Canonical, Open Graph and JSON-LD for the home page."""
    title = re.search(r"<title>(.*?)</title>", html, re.S).group(1).strip()
    desc = re.search(r'<meta content="([^"]*)" name="description"', html).group(1)
    image = SITE + "/assets/img/hero-bg.jpg"
    org = {
        "@context": "https://schema.org",
        "@type": "ResearchOrganization",
        "@id": SITE + "/#organization",
        "name": title,
        "url": SITE + "/",
        "image": image,
        "description": desc,
        "parentOrganization": {
            "@type": "CollegeOrUniversity",
            "name": "Technion — Israel Institute of Technology",
            "url": "https://www.technion.ac.il/en/",
        },
    }
    ld = json.dumps(org, indent=2, ensure_ascii=False).replace("<", "\\u003c")
    return "\n".join([
        '<link rel="canonical" href="%s"/>' % page_url("index.html"),
        '<meta property="og:type" content="website"/>',
        '<meta property="og:url" content="%s"/>' % page_url("index.html"),
        '<meta property="og:title" content="%s"/>' % title,
        '<meta property="og:description" content="%s"/>' % desc,
        '<meta property="og:image" content="%s"/>' % image,
        '<meta name="twitter:card" content="summary_large_image"/>',
        '<script type="application/ld+json">\n%s\n</script>' % ld,
        "</head>",
    ])


def build_sitemap():
    rows = []
    for page in PAGES:
        lastmod = last_commit_date(page)
        rows.append("  <url>\n    <loc>%s</loc>%s\n  </url>" % (
            page_url(page), "\n    <lastmod>%s</lastmod>" % lastmod if lastmod else ""))
    return ('<?xml version="1.0" encoding="UTF-8"?>\n'
            '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n'
            + "\n".join(rows) + "\n</urlset>\n")


# --- verification ---------------------------------------------------------

ABS = re.compile(r"^(?:https?:)?//", re.I)
FETCH_ATTRS = {"script": ["src"], "link": ["href"], "img": ["src", "srcset"],
               "iframe": ["src"], "source": ["src", "srcset"], "video": ["src", "poster"],
               "audio": ["src"], "object": ["data"], "embed": ["src"]}
TAG = re.compile(r"<(%s)\b([^>]*)>" % "|".join(FETCH_ATTRS), re.I)
CSS_URL = re.compile(r"""url\(\s*['"]?([^)'"]+)['"]?\s*\)|@import\s*['"]([^'"]+)['"]""", re.I)


def origin(url):
    m = re.match(r"^(?:https?:)?//([^/?#]+)", url, re.I)
    return "https://" + m.group(1).lower() if m else None


def fetched_urls(html):
    """(directive, url) for every resource a page makes the browser fetch.
    <a href>, canonical and og: URLs are references, not fetches."""
    out = []
    for m in TAG.finditer(html):
        tag, attrs = m.group(1).lower(), m.group(2)
        if tag == "link" and re.search(r'rel="(canonical|preconnect|dns-prefetch)"', attrs):
            continue
        for name in FETCH_ATTRS[tag]:
            a = re.search(r"\b%s\s*=\s*\"([^\"]*)\"" % name, attrs)
            if not a:
                continue
            for cand in a.group(1).split(","):
                url = cand.strip().split(" ")[0]
                directive = {"script": "script-src", "link": "style-src",
                             "iframe": "frame-src"}.get(tag, "img-src")
                out.append((directive, url))
    for block in re.findall(r"<style\b[^>]*>(.*?)</style>", html, re.S | re.I):
        out += css_urls(block)
    return out


def css_urls(css):
    out = []
    for m in CSS_URL.finditer(css):
        url = (m.group(1) or m.group(2)).strip()
        out.append(("style-src" if m.group(2) else "img-src", url))
    return out


def verify(deploy, sources):
    problems = []
    allowed = {d: set(hosts) for d, hosts in sources.items()}

    def check_external(where, refs):
        for directive, url in refs:
            if ABS.match(url) and origin(url) not in allowed.get(directive, ()):
                problems.append("%s: third-party fetch not in CSP %s: %s" % (where, directive, url))

    for page in PAGES + ["404.html"]:
        path = deploy / page
        if not path.exists():
            problems.append("missing from bundle: " + page)
            continue
        html = path.read_text(encoding="utf-8")
        refs = fetched_urls(html)
        check_external(page, refs)
        for _, url in refs:
            if ABS.match(url) or url.startswith(("data:", "#")):
                continue
            url = url.split("?")[0].split("#")[0]
            target = (posixpath.normpath(url).lstrip("/") if url.startswith("/")
                      else posixpath.normpath(posixpath.join(posixpath.dirname(page), url)))
            if not (deploy / target).is_file():
                problems.append('%s: dangling reference "%s"' % (page, url))
        if page in PAGES:
            for pattern, label in [(r'<link rel="canonical" href="([^"]*)"', "canonical"),
                                   (r'<meta property="og:url" content="([^"]*)"', "og:url")]:
                m = re.search(pattern, html)
                if not m or m.group(1) != page_url(page):
                    problems.append("%s: %s should be %s" % (page, label, page_url(page)))
            ld = re.search(r'<script type="application/ld\+json">(.*?)</script>', html, re.S)
            try:
                json.loads(ld.group(1).replace("\\u003c", "<"))
            except (AttributeError, ValueError) as e:
                problems.append("%s: JSON-LD missing or invalid (%s)" % (page, e))

    if '<meta name="robots" content="noindex">' not in (deploy / "404.html").read_text("utf-8"):
        problems.append("404.html: missing noindex")

    for rel in walk(deploy):
        if rel.endswith(".css"):
            check_external(rel, css_urls((deploy / rel).read_text(encoding="utf-8")))
        if not (should_ship(rel) or rel in ROOT_FILES or rel == "sitemap.xml"):
            problems.append("not on the allowlist: " + rel)

    if "@CSP@" in (deploy / ".htaccess").read_text("utf-8"):
        problems.append(".htaccess: @CSP@ placeholder not filled")
    if "@SITE@" in (deploy / "robots.txt").read_text("utf-8"):
        problems.append("robots.txt: @SITE@ placeholder not filled")
    return problems


def human(n):
    return "%.1f MB" % (n / 1048576) if n >= 1048576 else "%d KB" % round(n / 1024)


def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("version", help="e.g. 1.0.0; writes vVERSION/")
    ap.add_argument("--out", type=Path,
                    default=REPO_ROOT.parent / "Boeing-www-deploy-staging")
    ap.add_argument("--force", action="store_true", help="overwrite an existing version")
    args = ap.parse_args()

    deploy = (args.out / ("v" + args.version.lstrip("v"))).resolve()
    if REPO_ROOT == deploy or REPO_ROOT in deploy.parents:
        raise SystemExit("build: refusing to build inside the repo")
    if deploy.exists():
        if not args.force:
            raise SystemExit("build: %s exists; bump the version or pass --force" % deploy)
        shutil.rmtree(deploy)

    tracked = subprocess.run(["git", "ls-files"], cwd=REPO_ROOT, capture_output=True,
                             text=True, check=True).stdout.split()
    files = [rel for rel in tracked if should_ship(rel)]
    for rel in files:
        (deploy / rel).parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(REPO_ROOT / rel, deploy / rel)

    shutil.copytree(FONTS_SRC, deploy / "assets" / "vendor" / "fonts")
    styles = deploy / "assets" / "styles.css"
    css, n = FONT_IMPORT.subn("", styles.read_text(encoding="utf-8"))
    if n != 1:
        raise SystemExit("build: expected one Google Fonts @import in styles.css, found %d" % n)
    styles.write_text(css, encoding="utf-8")
    index = deploy / "index.html"
    html = replace_once(index.read_text(encoding="utf-8"),
                        '<link href="./assets/styles.css" rel="stylesheet"/>',
                        '<link href="./assets/vendor/fonts/fonts.css" rel="stylesheet"/>'
                        '<link href="./assets/styles.css" rel="stylesheet"/>', "styles link")
    index.write_text(replace_once(html, "</head>", head_tags(html), "</head>"), encoding="utf-8")

    for name in ROOT_FILES:
        text = (DEPLOY_SRC / name).read_text(encoding="utf-8")
        text = text.replace("@SITE@", SITE).replace("@CSP@", csp(THIRD_PARTY))
        (deploy / name).write_text(text, encoding="utf-8")
    (deploy / "sitemap.xml").write_text(build_sitemap(), encoding="utf-8")

    problems = verify(deploy, THIRD_PARTY)
    if problems:
        print("build: FAILED, %d problem(s); bundle not usable:" % len(problems), file=sys.stderr)
        for p in problems:
            print("  ! " + p, file=sys.stderr)
        sys.exit(1)

    shipped = walk(deploy)
    zpath = deploy / "www.zip"
    with zipfile.ZipFile(zpath, "w", zipfile.ZIP_DEFLATED) as z:
        for rel in shipped:
            z.write(deploy / rel, rel)
    size = sum((deploy / rel).stat().st_size for rel in shipped)
    commit = subprocess.run(["git", "rev-parse", "--short", "HEAD"], cwd=REPO_ROOT,
                            capture_output=True, text=True).stdout.strip()

    print("build: %s ready: %d files, %s (www.zip %s), from %s on %s" % (
        deploy, len(shipped), human(size), human(zpath.stat().st_size), commit,
        datetime.date.today().isoformat()))
    print("build: all checks passed (allowlisted third parties only, no dangling refs)")
    print()
    print("Upload the CONTENTS of v%s/ (or unzip www.zip) into public_html. Include the"
          % args.version.lstrip("v"))
    print("dotfile .htaccess: FTP clients and file managers hide it by default, and without")
    print("it you lose the 404 page, compression, caching and the security headers.")


if __name__ == "__main__":
    main()
