#!/usr/bin/env python3
"""Download one trails-game.com guide page and convert it into content for the app.

    python -I tools/fetch_guide.py <guide-id> <page-url> [--refresh]

Outputs
    cache/raw/<guide-id>.html        saved page (kept so rebuilds work offline)
    cache/img/<guide-id>/*           full-size images, jpeg + webp variants
    cache/content/<guide-id>.json    parsed chapters + door/boss index

The page is expected to hold the guide in an Elementor accordion: one item per chapter.
WordPress breaks the nesting of the collapsible boxes inside each chapter (<p><div>...),
the same way a browser would repair it is done here in text before parsing.
"""
import argparse
import datetime
import html
import io
import json
import re
import sys
import time
import urllib.request
from pathlib import Path

from bs4 import BeautifulSoup, NavigableString, Tag

ROOT = Path(__file__).resolve().parent.parent
CACHE = ROOT / "cache"

UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36"
COLOR_CLASS = {"#40c040": "c-item", "#c080c0": "c-name", "#ff99cc": "c-note", "#99ccff": "c-head"}
# Inline/block tags kept as they are. Anything else is unwrapped (children kept) or replaced.
KEEP = {"strong", "em", "u", "span", "ul", "ol", "li"}
BOX_KIND = {"main_quest_border": "moon", "sub_quest_border": "star", "hidden_quest_border": "sun", "boss_border": "boss"}
BLOCK_TAGS = {"p", "div", "section", "h5", "h6", "ul", "ol", "li", "figure"}
# A reward clause: a reward verb near the start of its clause, with something after it.
CLAUSE_BREAK = r"[，。；：:]"
REWARD_RE = re.compile(rf"(?:^|({CLAUSE_BREAK}))([^，。；：:\n]{{0,14}}?)(获得奖励|奖励|获得|奖品|学会)[：:]?([^，。；：:\n]*)")


def http_get(url, referer):
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Referer": referer})
    with urllib.request.urlopen(req, timeout=60) as resp:
        return resp.read()


def save_page(gid, url, refresh):
    path = CACHE / "raw" / f"{gid}.html"
    if path.exists() and not refresh:
        return path.read_bytes().decode("utf-8", errors="replace"), "cached"
    path.parent.mkdir(parents=True, exist_ok=True)
    text = http_get(url, url).decode("utf-8", errors="replace")
    path.write_text(text, encoding="utf-8")
    return text, "downloaded"


def load_chapters(page_html):
    soup = BeautifulSoup(page_html, "lxml")
    title = soup.title.get_text(strip=True) if soup.title else ""
    author = ""
    for meta in soup.find_all("meta", attrs={"name": "author"}):
        author = meta.get("content", "").strip()
    accordion = soup.select_one(".elementor-accordion")
    if accordion is None:
        sys.exit("no .elementor-accordion found: this page does not use the per-chapter accordion layout")
    chapters = []
    for item in accordion.find_all("div", class_="elementor-accordion-item", recursive=False):
        head = item.find("div", class_="elementor-tab-title")
        body = item.find("div", class_="elementor-tab-content")
        chapters.append({"title": head.get_text(strip=True), "raw": body.decode_contents()})
    return title, author, chapters


def repair_nesting(raw):
    """Undo the <p> tags WordPress wrapped around the box markup."""
    raw = re.sub(r'<p>\s*(<div class="(?:boss|main_quest|sub_quest|hidden_quest)_border">)', r"\1", raw)
    raw = re.sub(r'(class="collapseomatic_content[^"]*"[^>]*>)\s*</p>', r"\1", raw)
    raw = re.sub(r"<p>\s*</div>\s*</div>\s*</p>", "</div></div>", raw)
    return raw


def lines(text):
    """Non-empty lines of a block's plain text (lines are separated by <br> in the source)."""
    return [ln.strip() for ln in re.split(r"\n+", text) if ln.strip()]


class Sanitizer:
    def __init__(self, gid):
        self.gid = gid
        self.images = {}
        self.index = []
        self.heading_no = 0
        self.chapter_no = 0
        self.fig_no = 1

    def next_id(self):
        self.heading_no += 1
        return f"s{self.chapter_no}-{self.heading_no}"

    def clean(self, node):
        """Return (html, plain text with a newline per block / <br> line)."""
        out, text = [], []
        self.walk(node, out, text)
        return "".join(out), "".join(text)

    def walk(self, node, out, text):
        for child in node.children:
            self.walk_one(child, out, text)

    def walk_one(self, child, out, text):
        if isinstance(child, NavigableString):
            value = str(child)
            if child.__class__.__name__ in ("Comment", "Doctype", "ProcessingInstruction", "CData", "Declaration"):
                return
            # Whitespace between two block elements is layout noise from the source.
            if not value.strip() and self.between_blocks(child):
                return
            flat = re.sub(r"\s+", " ", value)  # source line breaks inside a text node are plain spaces
            out.append(html.escape(flat, quote=False))
            text.append(flat)
            return
        if isinstance(child, Tag):
            self.tag(child, out, text)

    def paragraph(self, t, out, text):
        """A source paragraph: images are hoisted out of it and an empty one emits nothing."""
        buf_out, buf_text = [], []

        def flush():
            joined = "".join(buf_out)
            if not "".join(buf_text).strip() and "<img" not in joined:
                return
            bare = "<section" in joined or "<figure" in joined
            out.append(joined if bare else f"<p>{joined}</p>")
            text.append("\n")
            text.extend(buf_text)
            text.append("\n")

        for child in t.children:
            if isinstance(child, Tag) and (child.name == "img" or (child.name == "a" and child.find("img") is not None)):
                flush()
                buf_out, buf_text = [], []
                self.figure(child, out, text)
            else:
                self.walk_one(child, buf_out, buf_text)
        flush()

    @staticmethod
    def between_blocks(child):
        def is_block(sib):
            return sib is None or (isinstance(sib, Tag) and (sib.name in BLOCK_TAGS or sib.name in ("picture", "h4")))
        return is_block(child.previous_sibling) and is_block(child.next_sibling)

    def tag(self, t, out, text):
        name = t.name
        classes = t.get("class") or []

        if name == "div" and any(c in BOX_KIND for c in classes):
            self.box(t, out, text)
            return
        if name == "div" and "collapseomatic_content" in classes:
            out.append('<div class="box-b">')
            self.walk(t, out, text)
            out.append("</div>")
            text.append("\n")
            return
        if name == "img" or (name == "a" and t.find("img") is not None):
            self.figure(t, out, text)
            return
        if name == "h4":
            # Chapter title repeated inside the body; the app shows it in the header instead.
            text.append("\n")
            return
        if name == "p":
            self.paragraph(t, out, text)
            return
        if name in KEEP:
            cls = ""
            if name == "span":
                color = self.style_color(t)
                cls = f' class="{COLOR_CLASS[color]}"' if color in COLOR_CLASS else ""
            if name in BLOCK_TAGS:
                text.append("\n")
            out.append(f"<{name}{cls}>")
            self.walk(t, out, text)
            out.append(f"</{name}>")
            if name in BLOCK_TAGS:
                text.append("\n")
            return
        # Unknown wrappers (picture/source/icon tags, stray divs): keep the children only.
        if name == "br":
            out.append("<br>")
            text.append("\n")
            return
        print(f"  note: unwrapped <{name}{'.' + '.'.join(classes) if classes else ''}>", file=sys.stderr)
        self.walk(t, out, text)

    @staticmethod
    def style_color(t):
        style = t.get("style") or ""
        m = re.search(r"color\s*:\s*(#[0-9a-fA-F]{6})", style)
        return m.group(1).lower() if m else ""

    def figure(self, t, out, text):
        img = t if t.name == "img" else t.find("img")
        text.append("\n")
        if img is None:
            return
        link = t if t.name == "a" else t.find_parent("a")
        full = (link.get("href") if link is not None else None) or img.get("src") or ""
        stem = Path(urllib.request.urlparse(full).path).stem
        w = int(link.get("data-large_image_width") or img.get("width") or 0) if link is not None else int(img.get("width") or 0)
        h = int(link.get("data-large_image_height") or img.get("height") or 0) if link is not None else int(img.get("height") or 0)
        webp = ""
        for source in t.find_all("source") if t.name == "a" else []:
            candidates = re.findall(r"(\S+\.webp)\s+(\d+)w", source.get("srcset") or "")
            if candidates:
                webp = max(candidates, key=lambda c: int(c[1]))[0]
        if stem in self.images and self.images[stem]["full"] != full:
            sys.exit(f"image name clash for {stem}")
        self.images.setdefault(stem, {"full": full, "webp": webp, "w": w, "h": h})
        out.append(
            f'<figure class="fig"><img src="img://{self.gid}/{stem}" width="{w}" height="{h}" '
            f'alt="示意图 {self.fig_no}" loading="lazy" decoding="async"></figure>'
        )
        self.fig_no += 1

    def box(self, t, out, text):
        head = t.find("h5", recursive=False)
        if head is None:
            self.walk(t, out, text)
            return
        title = head.get_text(strip=True)
        classes = t.get("class") or []
        kind = next((BOX_KIND[c] for c in classes if c in BOX_KIND), "boss")
        m = re.search(r"(月|星|太阳)之门", title)
        if m:
            kind = {"月": "moon", "星": "star", "太阳": "sun"}[m.group(1)]
        anchor = self.next_id()  # before the body, so nested boxes number in document order
        body = t.find("div", class_="collapseomatic_content", recursive=False)
        inner, body_text = self.clean(body if body is not None else t)
        text.append(title + "\n")
        out.append(f'<section class="box box-{kind}" data-kind="{kind}" id="{anchor}">')
        out.append(f'<h5 class="box-h">{html.escape(title)}</h5>')
        out.append(f'<div class="box-b">{inner}</div></section>')
        text.append(body_text + "\n")
        entry = {"id": anchor, "kind": kind, "title": title, "chapter": self.chapter_no}
        ls = lines(body_text)
        if kind != "boss":
            entry["name"] = re.sub(r"^支线任务\s*[:：]?", "", title).strip("【】")
            entry["condition"] = next((ln.split("：", 1)[-1].split(":", 1)[-1].strip() for ln in ls if re.match(r"^开启条件\s*[:：]", ln)), "")
            entry["reward"] = self.reward(ls)
        else:
            entry["snippet"] = ls[0] if ls else ""
        self.index.append(entry)

    @staticmethod
    def reward(ls):
        """First reward clause of a door ("通过后奖励 3000 米拉和…").

        Counts as a reward when the item follows the verb straight away as a number of 米拉 or when
        the verb opens its clause ("通过后奖励虚无回路"); "…不影响奖励" or "对话获得料理…" do not qualify.
        """
        for no, ln in enumerate(ls):
            for m in REWARD_RE.finditer(ln):
                lead, verb, tail = m.group(2), m.group(3), m.group(4).strip()
                if not tail or not (tail[0].isdigit() or len(lead) <= 5):
                    continue
                if verb == "学会":
                    text = re.sub(r"^(?:通过后|胜利后|战后|剧情后|过关|通过|胜利)+", "", lead) + verb + tail
                else:
                    text = re.sub(r"^[是为]", "", tail)
                while text.endswith("、") and no + 1 < len(ls):  # a list of rewards continues on the next line
                    no += 1
                    text = text.rstrip("、") + "、" + ls[no].rstrip("。")
                return text
        return ""

    def run(self, chapter_no, raw):
        self.chapter_no = chapter_no
        self.fig_no = 1
        frag = BeautifulSoup(repair_nesting(raw), "lxml")
        return self.clean(frag.body if frag.body is not None else frag)


def download_images(gid, url, images, refresh):
    """Download every image in both variants, then keep the smaller valid full-size copy
    (normalised to the right extension: some ".jpg" URLs on the CDN actually serve WebP)."""
    from PIL import Image

    folder = CACHE / "img" / gid
    folder.mkdir(parents=True, exist_ok=True)
    for stem, info in images.items():
        for key in ("full", "webp"):
            src = info[key]
            if not src:
                continue
            target = folder / Path(urllib.request.urlparse(src).path).name
            if not (target.exists() and target.stat().st_size > 0) or refresh:
                time.sleep(0.3)
                target.write_bytes(http_get(src, url))
            try:
                with Image.open(target) as im:
                    fmt, size = im.format, im.size
                    im.verify()
            except Exception as exc:  # noqa: BLE001 - a broken download just drops out of the contest
                print(f"  image variant unusable: {target.name}: {exc}", file=sys.stderr)
                continue
            if size != (info["w"], info["h"]):
                print(f"  image variant skipped ({size[0]}x{size[1]} instead of {info['w']}x{info['h']}): {target.name}", file=sys.stderr)
                continue
            if fmt not in ("JPEG", "WEBP") or (info.get("bytes") is not None and info["bytes"] <= target.stat().st_size):
                continue
            info.update(file=target.name, bytes=target.stat().st_size, mime="image/jpeg" if fmt == "JPEG" else "image/webp")
        if "file" not in info:
            sys.exit(f"no usable full-size image for {stem}")
    return images


def main():
    sys.stdout.reconfigure(encoding="utf-8")
    sys.stderr.reconfigure(encoding="utf-8")
    ap = argparse.ArgumentParser()
    ap.add_argument("guide_id")
    ap.add_argument("url")
    ap.add_argument("--refresh", action="store_true", help="download again even if cached")
    args = ap.parse_args()
    gid, url = args.guide_id, args.url

    page_html, state = save_page(gid, url, args.refresh)
    print(f"page {gid}: {state}, {len(page_html)} chars")
    title, author, chapters = load_chapters(page_html)
    print(f"title: {title} | author: {author or '-'} | chapters: {len(chapters)}")

    san = Sanitizer(gid)
    out_chapters, problems = [], 0
    for no, ch in enumerate(chapters):
        body, _ = san.run(no, ch["raw"])
        # Fidelity check: every character of the source text must survive (the repeated <h4> title excepted).
        src_text = BeautifulSoup(ch["raw"], "lxml")
        for h4 in src_text.find_all("h4"):
            h4.decompose()
        want = re.sub(r"\s+", "", src_text.get_text())
        got = re.sub(r"\s+", "", BeautifulSoup(body, "lxml").get_text())
        if want != got:
            problems += 1
            for i, (a, b) in enumerate(zip(want, got)):
                if a != b:
                    print(f"  TEXT MISMATCH in chapter {no}: at {i}: source ...{want[max(0, i - 20):i + 20]}... vs output ...{got[max(0, i - 20):i + 20]}...")
                    break
            else:
                print(f"  TEXT LENGTH MISMATCH in chapter {no}: source {len(want)} vs output {len(got)}")
        if re.search(r'collapseomatic|_border|style="', body):
            problems += 1
            print(f"  LEFTOVER MARKUP in chapter {no}")
        figures = body.count('class="fig"')
        boxes = body.count('class="box ')
        print(f"  [{no}] {ch['title']}: {len(want)} chars, {figures} figures, {boxes} boxes")
        out_chapters.append({"title": ch["title"], "html": body})
    print(f"text fidelity: {'OK' if not problems else str(problems) + ' PROBLEM(S)'}")

    san.index.sort(key=lambda e: tuple(int(x) for x in e["id"][1:].split("-")))
    images = download_images(gid, url, san.images, args.refresh)
    total = sum(i["bytes"] for i in images.values())
    formats = {}
    for info in images.values():
        formats[info["mime"]] = formats.get(info["mime"], 0) + 1
    print(f"images: {len(images)} | {total / 1024:.0f} KB | {formats}")

    content = {
        "id": gid,
        "title": title,
        "author": author,
        "source": url,
        "fetched": datetime.date.today().isoformat(),
        "chapters": out_chapters,
        "index": san.index,
        "images": images,
    }
    out = CACHE / "content" / f"{gid}.json"
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(content, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"wrote {out.relative_to(ROOT)}")
    for e in san.index:
        if e["kind"] == "boss":
            extra = e.get("snippet", "")[:44]
        else:
            extra = f"条件[{e.get('condition', '')}] 奖励[{e.get('reward', '')}]"
        print(f"  {e['id']:>6} {e['kind']:<4} ch{e['chapter']} {e['title'][:24]:<24} | {extra}")


if __name__ == "__main__":
    main()
