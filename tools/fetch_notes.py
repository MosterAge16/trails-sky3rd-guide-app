#!/usr/bin/env python3
"""Convert the harvested 3rd-notes tables into structured content for the app.

    python -I tools/fetch_notes.py

Input : cache/raw/notes-tables.json
Output: cache/content/3rd-notes.json

The battle table has a broken row in the source data (id 188, 阿卡玛纳): its first cell is
missing so every value sits one column to the left. That shift is repaired here.

Harvesting notes-tables.json (the site's wpDataTables only serves paginated rows through
admin-ajax.php, which rejects scripted requests). Open
https://trails-game.com/walkthrough/3rd-notes/ in a browser, let the tables load, then run
this in the devtools console and save its output as cache/raw/notes-tables.json:

    async function harvest(tableId) {
      const dt = jQuery('#' + tableId).DataTable();
      dt.page.len(100).draw();
      await new Promise(res => { dt.one('draw', res); setTimeout(res, 10000); });
      const pages = dt.page.info().pages;
      const rows = [];
      for (let p = 0; p < pages; p++) {
        dt.page(p).draw(false);
        await new Promise(res => { dt.one('draw', res); setTimeout(res, 10000); });
        rows.push(...dt.rows().data().toArray());
      }
      return { pages, total: dt.page.info().recordsTotal, rows };
    }
    copy(JSON.stringify({
      battle:  await harvest('table_1'),
      books:   await harvest('table_2'),
      cooking: await harvest('table_3'),
    }));
"""
import datetime
import io
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
RAW = ROOT / "cache" / "raw" / "notes-tables.json"
OUT = ROOT / "cache" / "content" / "3rd-notes.json"
SOURCE = "https://trails-game.com/walkthrough/3rd-notes/"

# Filter options in story order, never the order the site scatters them into.
CHAPTER_ORDER = [
    "第零话 星杯骑士", "第一话 影之国", "第二话 异界化王都", "第三话 金之道 银之道",
    "第四话 昏暗圣痕", "第五话 光与影的迷宫", "第六话 守护者的试炼", "第七话 遥远的炎群",
    "最终话 历尽艰险 终达彼岸", "月亮之门", "星星之门", "太阳之门",
]
TYPE_ORDER = ["大盘料理", "携带料理", "攻击料理"]
EFF_LABELS = ["地", "水", "火", "风", "时", "空", "幻"]
STATUS_GROUPS = [
    ("中毒/冻结/石化/睡眠", ["中毒", "冻结", "石化", "睡眠"]),
    ("封魔/黑暗/封技/混乱", ["封魔", "黑暗", "封技", "混乱"]),
    ("气绝/即死/愤怒/MOV降低", ["气绝", "即死", "愤怒", "MOV降低"]),
    ("STR降低/DEF降低/SPD降低/ADF降低", ["STR降低", "DEF降低", "SPD降低", "ADF降低"]),
]
DEBUFF_LABELS = ["AGL降低", "延迟"]


def cells(row, n):
    vals = ["" if c is None else str(c).strip() for c in (row + [None] * n)[:n]]
    return vals


def pairs(values, labels, raw):
    """Label/value pairs split on "/", falling back to the raw string when counts disagree."""
    if raw and len(values) == len(labels):
        return [{"l": l, "v": v} for l, v in zip(labels, values)]
    return [{"l": "原文", "v": raw}]


def battle_row(row, no):
    r = cells(row, 16)
    if not r[15] and not r[14] and not r[13]:  # shifted row: id sits in r[0], values one left
        r = [r[0], r[1], r[2], r[3], r[4], r[5], r[6], "", "", "", "", "", "", "", "", ""]
    drops = [d for d in r[2].splitlines() if d.strip()]
    return {
        "id": int(r[0]) if r[0].isdigit() else no,
        "name": r[1],
        "drops": drops,
        "chapter": r[3],
        "place": r[4],
        "level": r[5],
        "hsd": r[6], "asd": r[7], "exp": r[8],
        "eff": pairs(r[9].split("/"), EFF_LABELS, r[9]),
        "status": [{"group": title, "items": pairs(r[10 + i].split("/"), labels, r[10 + i])}
                   for i, (title, labels) in enumerate(STATUS_GROUPS)],
        "debuff": pairs(r[14].split("/"), DEBUFF_LABELS, r[14]),
        "septium": pairs(r[15].split("/"), EFF_LABELS, r[15]),
    }


def main():
    sys.stdout.reconfigure(encoding="utf-8")
    data = json.loads(io.open(RAW, encoding="utf-8").read())

    battles = [battle_row(row, no + 1) for no, row in enumerate(data["battle"]["rows"])]
    chapters_seen = {b["chapter"] for b in battles}
    chapters = [c for c in CHAPTER_ORDER if c in chapters_seen] + sorted(chapters_seen - set(CHAPTER_ORDER))
    counts = {c: sum(1 for b in battles if b["chapter"] == c) for c in chapters}

    books = [{"id": int(cells(r, 4)[0]), "title": cells(r, 4)[1], "when": cells(r, 4)[2], "how": cells(r, 4)[3]}
             for r in data["books"]["rows"]]

    cooking = []
    for row in data["cooking"]["rows"]:
        r = cells(row, 5)
        cooking.append({"id": int(r[0]), "type": r[1], "name": r[2], "when": r[3], "how": r[4]})
    types_seen = {c["type"] for c in cooking}
    types = [t for t in TYPE_ORDER if t in types_seen] + sorted(types_seen - set(TYPE_ORDER))
    type_rank = {t: i for i, t in enumerate(types)}
    cooking.sort(key=lambda c: (type_rank[c["type"]], c["id"]))
    type_counts = {t: sum(1 for c in cooking if c["type"] == t) for t in types}

    out = {
        "source": SOURCE,
        "fetched": datetime.date.today().isoformat(),
        "battle": {"chapters": [{"key": c, "label": c, "count": counts[c]} for c in chapters], "rows": battles},
        "books": books,
        "cooking": {"types": [{"key": t, "label": t, "count": type_counts[t]} for t in types], "rows": cooking},
    }
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(out, ensure_ascii=False, indent=1), encoding="utf-8")

    print(f"battle: {len(battles)} rows in {len(chapters)} chapters | " +
          ", ".join(f"{c['label']} {c['count']}" for c in out["battle"]["chapters"]))
    for b in battles:
        if not b["name"] or (b["chapter"] not in chapters_seen):
            print("  odd row:", json.dumps(b, ensure_ascii=False)[:200])
    shifted = [b for b in battles if not b["septium"][0]["v"] and b["name"] == "阿卡玛纳"]
    if shifted:
        print(f"  shifted row repaired: id {shifted[0]['id']} {shifted[0]['name']} ({shifted[0]['chapter']}, {shifted[0]['place']}), stats columns empty on the site too")
    print(f"books: {len(books)}")
    print(f"cooking: {len(cooking)} rows | " + ", ".join(f"{t['label']} {t['count']}" for t in out["cooking"]["types"]))
    print(f"wrote {OUT.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
