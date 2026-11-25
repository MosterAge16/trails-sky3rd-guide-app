#!/usr/bin/env python3
"""Assemble the reader from the cached guide content.

    python -I tools/build.py

Outputs
    dist/轨迹攻略.html      one self-contained file (images embedded) for any phone browser
    dist/www/               the same app with separate files, what the APK bundles
"""
import base64
import datetime
import json
import re
import shutil
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SRC, CACHE, DIST = ROOT / "src", ROOT / "cache", ROOT / "dist"
SINGLE_FILE = DIST / "轨迹攻略.html"
EXT = {"image/webp": ".webp", "image/jpeg": ".jpg"}


def js_literal(obj):
    """JSON that is safe inside a <script> element."""
    text = json.dumps(obj, ensure_ascii=False, separators=(",", ":"))
    return text.replace("<", "\\u003c").replace("\u2028", "\\u2028").replace("\u2029", "\\u2029")


def load_guides():
    """Guides listed in guides.json that have cached content, plus their image files."""
    registry = json.loads((ROOT / "guides.json").read_text(encoding="utf-8"))
    guides, files = [], {}
    for meta in registry:
        path = CACHE / "content" / (meta["id"] + ".json")
        if not path.exists():
            print(f"skip {meta['id']}: no cached content, run tools/fetch_guide.py first", file=sys.stderr)
            continue
        data = json.loads(path.read_text(encoding="utf-8"))
        guides.append({
            "id": meta["id"],
            "game": meta["game"],
            "name": meta["name"],
            "source": meta["url"],
            "author": data.get("author", ""),
            "fetched": data.get("fetched", ""),
            "related": meta.get("related", []),
            "chapters": [{"title": c["title"], "html": c["html"]} for c in data["chapters"]],
            "index": data["index"],
        })
        for stem, info in data["images"].items():
            files[meta["id"] + "/" + stem] = (CACHE / "img" / meta["id"] / info["file"], info["mime"])
    return guides, files


def load_notes():
    """The notes tables (battle / books / cooking) if tools/fetch_notes.py has produced them."""
    path = CACHE / "content" / "3rd-notes.json"
    if not path.exists():
        print("no notes content (tools/fetch_notes.py), building without the notes tab data", file=sys.stderr)
        return None
    return json.loads(path.read_text(encoding="utf-8"))


def main():
    sys.stdout.reconfigure(encoding="utf-8")
    guides, files = load_guides()
    if not guides:
        sys.exit("nothing to build")
    notes = load_notes()
    template = (SRC / "app.html").read_text(encoding="utf-8")
    css = (SRC / "app.css").read_text(encoding="utf-8")
    js = (SRC / "app.js").read_text(encoding="utf-8")
    if re.search(r"</script|<!--", js, re.I):
        sys.exit("app.js contains a sequence that would end the <script> element")
    referenced = set()
    for g in guides:
        for c in g["chapters"]:
            referenced.update(re.findall(r'src="img://([^"]+)"', c["html"]))
    missing = sorted(referenced - set(files))
    if missing:
        sys.exit("images referenced but not downloaded: " + ", ".join(missing))
    build = datetime.date.today().isoformat()
    notes_js = "" if notes is None else "window.NOTES=" + js_literal(notes) + ";\n"

    # 1) folder variant: what the APK bundles
    www = DIST / "www"
    if www.exists():
        shutil.rmtree(www)
    (www / "img").mkdir(parents=True)
    paths = {}
    for key, (src, mime) in files.items():
        name = key.replace("/", "-") + EXT[mime]
        shutil.copyfile(src, www / "img" / name)
        paths[key] = "img/" + name
    content = notes_js + "window.GUIDES=" + js_literal(guides) + ";\nwindow.IMAGES=" + js_literal(paths) + ";\n"
    (www / "content.js").write_text(content, encoding="utf-8")
    (www / "app.css").write_text(css, encoding="utf-8")
    (www / "app.js").write_text(js, encoding="utf-8")
    head = '<link rel="stylesheet" href="app.css">'
    body = '<script src="content.js"></script>\n<script src="app.js"></script>'
    (www / "index.html").write_text(template.replace("{{HEAD}}", head).replace("{{BODY}}", body), encoding="utf-8")

    # 2) single file: everything inlined, images as data URIs
    embedded = {
        key: "data:" + mime + ";base64," + base64.b64encode(src.read_bytes()).decode("ascii")
        for key, (src, mime) in files.items()
    }
    content = notes_js + "window.GUIDES=" + js_literal(guides) + ";\nwindow.IMAGES=" + js_literal(embedded) + ";\n"
    head = "<style>\n" + css + "\n</style>"
    body = "<script>\n" + content + "\n</script>\n<script>\n" + js + "\n</script>"
    DIST.mkdir(parents=True, exist_ok=True)
    SINGLE_FILE.write_text(
        template.replace("{{HEAD}}", head).replace("{{BODY}}", body)
        .replace("<title>", f"<!-- built {build} -->\n<title>"),
        encoding="utf-8",
    )

    size = sum(f.stat().st_size for f in www.rglob("*") if f.is_file())
    print(f"guides: {len(guides)} ({', '.join(g['id'] for g in guides)}) | images: {len(files)}")
    print(f"{SINGLE_FILE.relative_to(ROOT)}  {SINGLE_FILE.stat().st_size / 1024 / 1024:.2f} MB")
    print(f"{www.relative_to(ROOT)}/  {size / 1024 / 1024:.2f} MB")


if __name__ == "__main__":
    main()
