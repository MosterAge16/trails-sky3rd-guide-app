/* 轨迹攻略 – offline reader for trails-game.com guides. Plain browser JavaScript, no dependencies. */
(function () {
  "use strict";

  const GUIDES = (window.GUIDES || []).map(prepareGuide);
  const NOTES = window.NOTES || null;
  const IMAGES = window.IMAGES || {};
  const KEY = "trails-reader.v1";
  const BLOCKS = "p, li, .box-h"; // indexable blocks of a chapter, in document order
  const FONT_SCALES = [0.9, 1, 1.12, 1.25];
  const FONT_NAMES = ["小", "标准", "大", "特大"];
  const THEMES = [["auto", "跟随系统"], ["light", "浅色"], ["dark", "深色"]];
  const KINDS = { boss: "target", moon: "moon", star: "star", sun: "sun" };
  const KIND_LABEL = { moon: "月之门", star: "星之门", sun: "太阳之门" };
  const NOTE_TABS = [["battle", "战斗", "target"], ["books", "书籍", "book"], ["cooking", "料理", "dish"]];
  const NOTE_LABEL = { battle: "战斗", books: "书籍", cooking: "料理" };
  const TABS = [["read", "阅读", "book"], ["doors", "之门", "door"], ["notes", "笔记", "notes"]];
  const OVERLAYS = ["search", "settings", "picker", "viewer"]; // bottom → top

  /* ---------- content shaping ---------- */
  function prepareGuide(g) {
    const sections = g.index.map(e => Object.assign({}, e));
    const bossNo = {};
    sections.forEach(e => {
      if (e.kind === "boss") { bossNo[e.chapter] = (bossNo[e.chapter] || 0) + 1; e.no = bossNo[e.chapter]; }
    });
    return Object.assign({}, g, { sections, chapters: g.chapters.map(prepareChapter) });
  }
  function prepareChapter(c) {
    const m = /^(第.+?话)\s+(.+)$/.exec(c.title);
    return Object.assign(m ? { label: m[1], name: m[2] } : { label: "前言", name: c.title }, { html: c.html });
  }

  /* ---------- saved state ---------- */
  const memory = {};
  function readAll() {
    try { return JSON.parse(localStorage.getItem(KEY) || "{}") || {}; } catch (e) { return memory; }
  }
  function persist(key, value) {
    try {
      const all = readAll();
      all[key] = value;
      localStorage.setItem(KEY, JSON.stringify(all));
    } catch (e) { memory[key] = value; }
  }
  const saved = readAll();
  const S = {
    guide: GUIDES.some(g => g.id === saved.guide) ? saved.guide : GUIDES[0].id,
    tab: "read",
    chapter: 0,
    font: FONT_SCALES[saved.font] ? saved.font : 1,
    theme: THEMES.some(t => t[0] === saved.theme) ? saved.theme : "auto",
    pos: saved.pos || {},       // guide id -> { ch, ratio }: where each guide was left
    read: saved.read || {},     // guide id -> chapters marked as read
    done: saved.done || {},     // guide id -> ids of doors / boss fights ticked off
    drawer: false,
    openChapters: {},
    onlyTodo: false,
    notesTab: NOTE_TABS.some(t => t[0] === saved.notesTab) ? saved.notesTab : "battle",
    battleFilter: "all",
    cookingFilter: "all",
    openBattles: {},
  };
  if (NOTES) {
    if (!NOTES.battle.chapters.some(c => c.key === saved.battleFilter)) saved.battleFilter = "all";
    if (saved.battleFilter) S.battleFilter = saved.battleFilter;
    if (!NOTES.cooking.types.some(t => t.key === saved.cookingFilter)) saved.cookingFilter = "all";
    if (saved.cookingFilter) S.cookingFilter = saved.cookingFilter;
  }
  const guide = () => GUIDES.filter(g => g.id === S.guide)[0];
  const isRead = (g, i) => (S.read[g.id] || []).indexOf(i) >= 0;
  const isDone = (g, id) => (S.done[g.id] || []).indexOf(id) >= 0;
  function toggle(map, g, value) {
    const list = (S[map][g.id] || []).slice();
    const at = list.indexOf(value);
    if (at >= 0) list.splice(at, 1); else list.push(value);
    S[map][g.id] = list;
    persist(map, S[map]);
  }

  /* ---------- tiny DOM helpers ---------- */
  const $ = (sel, root) => (root || document).querySelector(sel);
  const $$ = (sel, root) => Array.prototype.slice.call((root || document).querySelectorAll(sel));
  function h(tag, props) {
    const node = document.createElement(tag);
    if (props) Object.keys(props).forEach(key => {
      const value = props[key];
      if (key === "class") node.className = value;
      else if (key === "text") node.textContent = value;
      else if (key === "html") node.innerHTML = value;
      else if (key.indexOf("on") === 0) node.addEventListener(key.slice(2), value);
      else if (value != null) node.setAttribute(key, value);
    });
    for (let i = 2; i < arguments.length; i++) {
      const kid = arguments[i];
      if (kid != null && kid !== false) node.append(kid);
    }
    return node;
  }
  const escapeHtml = text => text.replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
  const escapeRegExp = text => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

  const ICONS = {
    menu: "M4 6h16M4 12h16M4 18h16",
    search: "M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zM16.5 16.5L20.5 20.5",
    sliders: "M4 7h9M17 7h3M4 17h3M11 17h9M13 4.5v5M7 14.5v5",
    book: "M4 5.5A2.5 2.5 0 0 1 6.5 3H20v15.5H6.5A2.5 2.5 0 0 0 4 21zM4 18.5V5.5M20 18.5V21H6.5",
    door: "M6 21V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v17M3.5 21h17M14.5 12.2v.8",
    notes: "M5 3h11l4 4v14a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1zM16 3v4h4M8.5 12h7M8.5 16h5",
    dish: "M4 11h16M6 11a6 6 0 0 1 12 0M3.5 15.5h17M5 15.5c0 1.5 1 3 2.5 3h9c1.5 0 2.5-1.5 2.5-3M12 3v1.5",
    target: "M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8zM12 1.5V4M12 20v2.5M1.5 12H4M20 12h2.5",
    moon: { d: "M20.5 14.6A9 9 0 0 1 9.4 3.5a9 9 0 1 0 11.1 11.1z", fill: true },
    star: { d: "M12 2.8l2.8 5.9 6.4.8-4.7 4.4 1.2 6.3-5.7-3.1-5.7 3.1 1.2-6.3-4.7-4.4 6.4-.8z", fill: true },
    sun: "M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8zM12 2v2.5M12 19.5V22M2 12h2.5M19.5 12H22M5 5l1.8 1.8M17.2 17.2L19 19M5 19l1.8-1.8M17.2 6.8L19 5",
    "chevron-down": "M6 9l6 6 6-6",
    "chevron-right": "M9 6l6 6-6 6",
    check: "M5 12.5l4.5 4.5L19 7",
    close: "M6 6l12 12M18 6L6 18",
    "arrow-left": "M19 12H5M11 6l-6 6 6 6",
    "arrow-right": "M5 12h14M13 6l6 6-6 6",
    "zoom-in": "M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zM16.5 16.5L20.5 20.5M8 11h6M11 8v6",
    filter: "M4 6h16M7 12h10M10 18h4",
  };
  const SVG_NS = "http://www.w3.org/2000/svg";
  function icon(name, cls) {
    const spec = ICONS[name];
    const svg = document.createElementNS(SVG_NS, "svg");
    svg.setAttribute("viewBox", "0 0 24 24");
    svg.setAttribute("class", "ico" + (cls ? " " + cls : "") + (spec.fill ? " fill" : ""));
    svg.setAttribute("aria-hidden", "true");
    const path = document.createElementNS(SVG_NS, "path");
    path.setAttribute("d", spec.d || spec);
    svg.append(path);
    return svg;
  }

  /* ---------- appearance ---------- */
  const darkQuery = window.matchMedia ? window.matchMedia("(prefers-color-scheme: dark)") : null;
  function applyTheme() {
    const dark = S.theme === "dark" || (S.theme === "auto" && darkQuery && darkQuery.matches);
    document.documentElement.setAttribute("data-theme", dark ? "dark" : "light");
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute("content", dark ? "#111317" : "#f5f4f0");
  }
  if (darkQuery) {
    const onChange = () => { if (S.theme === "auto") applyTheme(); };
    if (darkQuery.addEventListener) darkQuery.addEventListener("change", onChange);
    else if (darkQuery.addListener) darkQuery.addListener(onChange);
  }
  function applyFont() {
    document.documentElement.style.setProperty("--scale", FONT_SCALES[S.font]);
  }

  /* ---------- reading view ---------- */
  const resolveImages = html => html.replace(/src="img:\/\/([^"]+)"/g, (m, key) => 'src="' + (IMAGES[key] || "") + '"');

  function renderChapter(view, g) {
    const ch = g.chapters[S.chapter];
    const article = h("article", { class: "article" },
      h("header", { class: "ch-head" }, h("div", { class: "label", text: ch.label }), h("h1", { text: ch.name })),
      h("div", { class: "article-body", html: resolveImages(ch.html) }),
      chapterEnd(g));
    view.textContent = "";
    view.append(article);
    $$(".box", article).forEach(box => {
      const head = $(".box-h", box);
      const title = head.textContent;
      head.textContent = "";
      head.append(icon(KINDS[box.dataset.kind]), h("span", { class: "box-title", text: title }), icon("chevron-down", "chev"));
    });
    $$(".fig", article).forEach(fig => fig.append(h("span", { class: "zoom" }, icon("zoom-in"))));
    $$(BLOCKS, $(".article-body", article)).forEach((block, i) => { block.dataset.b = i; });
    // back to where this chapter was left
    const p = S.pos[g.id];
    view.scrollTop = p && p.ch === S.chapter ? Math.round(p.ratio * (view.scrollHeight - view.clientHeight)) : 0;
  }

  function chapterEnd(g) {
    const i = S.chapter;
    const next = g.chapters[i + 1];
    const read = isRead(g, i);
    const end = h("div", { class: "ch-end" },
      h("button", { class: "ghost", onclick: () => { toggle("read", g, i); render(); } }, read ? "取消已读标记" : "标记本话已读"));
    if (next) {
      end.append(h("button", { class: "primary", onclick: () => goChapter(i + 1, true) },
        h("span", { class: "small", text: "下一话" }),
        h("span", { class: "next", text: next.label + "　" + next.name })));
    } else {
      end.append(h("div", { class: "fin", text: "攻略到这里就结束了" }));
    }
    return end;
  }

  function goChapter(i, markRead) {
    const g = guide();
    if (markRead && !isRead(g, S.chapter)) toggle("read", g, S.chapter);
    S.chapter = i;
    S.tab = "read";
    setDrawer(false);
    render();
  }

  function scrollToNode(node) {
    if (!node) return;
    const box = node.closest(".box");
    if (box) box.classList.remove("closed");
    const view = $("#view");
    view.scrollTop += node.getBoundingClientRect().top - view.getBoundingClientRect().top - 8;
    node.classList.remove("flash");
    void node.offsetWidth;
    node.classList.add("flash");
    node.addEventListener("animationend", () => node.classList.remove("flash"), { once: true });
  }

  function jumpToSection(g, id) {
    S.chapter = Number(id.split("-")[0].slice(1));
    S.tab = "read";
    setDrawer(false);
    render();
    scrollToNode(document.getElementById(id));
  }

  function openBlock(g, chapter, block) {
    if (g.id !== S.guide) {
      S.guide = g.id;
      persist("guide", g.id);
      S.openChapters = {};
    }
    S.chapter = chapter;
    S.tab = "read";
    setDrawer(false);
    render();
    scrollToNode($$(BLOCKS, $(".article-body"))[block]);
  }

  /* ---------- check lists (doors / boss fights) ---------- */
  const KIND_ORDER = { moon: 0, star: 1, sun: 2 };

  function entryRow(g, e) {
    const done = isDone(g, e.id);
    const ch = g.chapters[e.chapter];
    const title = h("div", { class: "entry-title" }, icon(KINDS[e.kind]), h("span", { text: e.name || e.title }));
    if (e.kind === "boss") {
      const fights = g.sections.filter(x => x.kind === "boss" && x.chapter === e.chapter).length;
      if (fights > 1) title.append(h("span", { class: "chip", text: "第 " + e.no + " 场" }));
    }
    title.append(h("span", { class: "chip", text: ch.label }));
    const detail = e.kind === "boss"
      ? h("div", { class: "snippet", text: e.snippet })
      : h("div", null,
        h("div", { class: "meta" }, h("b", { text: "条件" }), h("span", { text: e.condition || "原文未注明" })),
        h("div", { class: "meta" }, h("b", { text: "奖励" }), h("span", { text: e.reward || "—" })));
    return h("div", {
      class: "entry " + e.kind + (done ? " done" : ""),
      onclick: () => jumpToSection(g, e.id),
    },
      h("button", {
        class: "check" + (done ? " done" : ""),
        "aria-label": done ? "取消完成标记" : "标记为已完成",
        onclick: event => { event.stopPropagation(); toggle("done", g, e.id); render(); },
      }, done ? icon("check") : null),
      h("div", { class: "entry-body" }, title, detail));
  }

  function renderList(view, g) {
    // doors grouped by kind (月/星/太阳), each entry in story order
    const groupOf = e => e.kind;
    const items = g.sections
      .filter(e => e.kind !== "boss")
      .map((e, i) => ({ e, i, group: groupOf(e) }))
      .sort((a, b) => KIND_ORDER[a.group] - KIND_ORDER[b.group] || a.i - b.i)
      .map(x => x.e);
    const doneCount = items.filter(e => isDone(g, e.id)).length;
    const shown = S.onlyTodo ? items.filter(e => !isDone(g, e.id)) : items;
    const list = h("div", { class: "list" },
      h("div", { class: "list-top" },
        h("span", null, h("b", { text: doneCount + " / " + items.length }), " 已完成"),
        h("button", {
          class: "filter" + (S.onlyTodo ? " on" : ""),
          onclick: () => { S.onlyTodo = !S.onlyTodo; render(); },
        }, icon("filter"), S.onlyTodo ? "显示全部" : "只看未完成")));
    let lastGroup = null;
    shown.forEach(e => {
      if (groupOf(e) !== lastGroup) {
        lastGroup = groupOf(e);
        const inGroup = items.filter(x => groupOf(x) === lastGroup);
        const name = KIND_LABEL[lastGroup];
        list.append(h("div", { class: "group-h", text: name + "　" + inGroup.filter(x => isDone(g, x.id)).length + " / " + inGroup.length }));
      }
      list.append(entryRow(g, e));
    });
    if (!shown.length) list.append(h("div", { class: "list-end", text: doneCount ? "全部完成" : "暂无内容" }));
    view.textContent = "";
    view.append(list);
    view.scrollTop = 0;
  }

  /* ---------- notes: battle / books / cooking ---------- */
  const shortChapter = ch => (ch.startsWith("第") ? ch.slice(0, 3) : ch.indexOf(" ") > 0 ? ch.slice(0, ch.indexOf(" ")) : ch);

  function kv(pairs) {
    const wrap = h("div", { class: "kvs" });
    pairs.forEach(p => wrap.append(h("span", { class: "kv" + (p.v === "-" ? " none" : "") }, h("b", { text: p.l }), p.v)));
    return wrap;
  }

  function battleEntry(r) {
    const open = !!S.openBattles[r.id];
    const entry = h("div", { class: "nentry" + (open ? " open" : ""), id: "battle-" + r.id },
      h("button", { class: "nrow", onclick: () => { S.openBattles[r.id] = !open; renderNotes($("#view"), true); } },
        h("span", { class: "n-main" },
          h("span", { class: "n-title" }, h("span", { class: "n-name", text: r.name }), h("span", { class: "chip", text: shortChapter(r.chapter) })),
          h("span", { class: "n-sub", text: r.place + (r.level ? " · Lv" + r.level : "") })),
        icon(open ? "chevron-down" : "chevron-right", "chev")));
    if (open) {
      const detail = h("div", { class: "n-detail" });
      detail.append(h("div", { class: "n-line" }, h("b", { text: "掉落物" }), r.drops.length ? r.drops.join("、") : "—"));
      detail.append(h("div", { class: "n-cols" },
        h("div", { class: "n-stat" }, h("b", { text: "HP / STR / DEF" }), r.hsd || "—"),
        h("div", { class: "n-stat" }, h("b", { text: "ATS / ADF / SPD" }), r.asd || "—"),
        h("div", { class: "n-stat" }, h("b", { text: "EXP" }), r.exp || "—")));
      detail.append(h("div", { class: "n-line" }, h("b", { text: "属性有效率" }), kv(r.eff)));
      r.status.forEach(group => detail.append(h("div", { class: "n-line" }, h("b", { text: group.group }), kv(group.items))));
      detail.append(h("div", { class: "n-line" }, h("b", { text: "能力降低" }), kv(r.debuff)));
      detail.append(h("div", { class: "n-line" }, h("b", { text: "耀晶片" }), kv(r.septium)));
      entry.append(detail);
    }
    return entry;
  }

  function renderNotes(view, keepScroll) {
    const at = keepScroll ? view.scrollTop : 0;
    const wrap = h("div", { class: "notes" });
    const subs = h("div", { class: "subtabs" });
    NOTE_TABS.forEach(([id, label]) => subs.append(h("button", {
      class: "subtab" + (S.notesTab === id ? " active" : ""),
      onclick: () => { S.notesTab = id; persist("notesTab", id); render(); },
    }, label)));
    wrap.append(subs);
    if (!NOTES) {
      wrap.append(h("div", { class: "hint", text: "笔记内容缺失，请重新运行 tools/fetch_notes.py。" }));
      view.textContent = "";
      view.append(wrap);
      return;
    }
    if (S.notesTab === "battle") {
      const rows = S.battleFilter === "all" ? NOTES.battle.rows : NOTES.battle.rows.filter(r => r.chapter === S.battleFilter);
      wrap.append(h("div", { class: "list-top" },
        h("span", null, h("b", { text: rows.length + " / " + NOTES.battle.rows.length }), " 条记录"),
        h("button", {
          class: "filter" + (S.battleFilter !== "all" ? " on" : ""),
          onclick: openBattlePicker,
        }, icon("filter"), S.battleFilter === "all" ? "章节：全部" : "章节：" + shortChapter(S.battleFilter))));
      rows.forEach(r => wrap.append(battleEntry(r)));
    } else if (S.notesTab === "books") {
      wrap.append(h("div", { class: "list-top" }, h("span", null, "共 ", h("b", { text: NOTES.books.length }), " 本")));
      NOTES.books.forEach(bk => wrap.append(h("div", { class: "nentry", id: "books-" + bk.id },
        h("div", { class: "nrow static" },
          h("span", { class: "n-main" },
            h("span", { class: "n-name", text: "《" + bk.title + "》" }),
            h("span", { class: "n-sub", text: bk.when }),
            h("span", { class: "n-sub", text: bk.how }))))));
    } else {
      const rows = S.cookingFilter === "all" ? NOTES.cooking.rows : NOTES.cooking.rows.filter(c => c.type === S.cookingFilter);
      wrap.append(h("div", { class: "list-top" },
        h("span", null, h("b", { text: rows.length + " / " + NOTES.cooking.rows.length }), " 道料理"),
        h("button", {
          class: "filter" + (S.cookingFilter !== "all" ? " on" : ""),
          onclick: openCookingPicker,
        }, icon("filter"), S.cookingFilter === "all" ? "类型：全部" : "类型：" + S.cookingFilter)));
      rows.forEach(c => wrap.append(h("div", { class: "nentry", id: "cooking-" + c.id },
        h("div", { class: "nrow static" },
          h("span", { class: "n-main" },
            h("span", { class: "n-title" }, h("span", { class: "n-name", text: c.name }), h("span", { class: "chip", text: c.type })),
            h("span", { class: "n-sub", text: c.when + " · " + c.how }))))));
    }
    view.textContent = "";
    view.append(wrap);
    view.scrollTop = at;
  }

  function openPicker(titleText, options, active, onPick) {
    const sheet = $("#picker .sheet");
    sheet.textContent = "";
    sheet.append(h("h3", { text: titleText }));
    const list = h("div", { class: "pick-list" });
    options.forEach(op => list.append(h("button", {
      class: "pick" + (op.key === active ? " active" : ""),
      onclick: () => { closeOverlay("picker"); onPick(op.key); },
    }, h("span", { text: op.label }), h("span", { class: "pick-count", text: String(op.count) }))));
    sheet.append(list);
    openOverlay("picker");
  }

  function openBattlePicker() {
    const options = [{ key: "all", label: "全部章节", count: NOTES.battle.rows.length }]
      .concat(NOTES.battle.chapters.map(c => ({ key: c.key, label: c.label, count: c.count })));
    openPicker("按出现章节筛选", options, S.battleFilter, key => {
      S.battleFilter = key;
      persist("battleFilter", key);
      render();
    });
  }

  function openCookingPicker() {
    const options = [{ key: "all", label: "全部类型", count: NOTES.cooking.rows.length }]
      .concat(NOTES.cooking.types.map(t => ({ key: t.key, label: t.label, count: t.count })));
    openPicker("按料理类型筛选", options, S.cookingFilter, key => {
      S.cookingFilter = key;
      persist("cookingFilter", key);
      render();
    });
  }

  function openNotesHit(target) {
    S.notesTab = target.tab;
    persist("notesTab", target.tab);
    if (target.tab === "battle" && S.battleFilter !== "all") { S.battleFilter = "all"; persist("battleFilter", "all"); }
    if (target.tab === "cooking" && S.cookingFilter !== "all") { S.cookingFilter = "all"; persist("cookingFilter", "all"); }
    S.tab = "notes";
    render();
    scrollToNode(document.getElementById(target.id));
  }

  /* ---------- drawer ---------- */
  function chapterRow(g, ch, i) {
    const sections = g.sections.filter(e => e.chapter === i);
    const read = isRead(g, i);
    const fights = sections.filter(e => e.kind === "boss").length;
    const figures = (ch.html.match(/class="fig"/g) || []).length;
    const facts = [sections.length && sections.length + " 个小节", figures && figures + " 张图"].filter(Boolean);
    const line = h("div", { class: "ch-line" },
      h("div", { class: "ch-main", onclick: () => goChapter(i, false) },
        h("span", { class: "ch-label", text: ch.label }),
        h("span", { class: "ch-text" },
          h("span", { class: "ch-name", text: ch.name }),
          h("span", { class: "ch-sub", text: facts.length ? facts.join(" · ") : "无小节和配图" })),
        h("button", {
          class: "check" + (read ? " done" : ""),
          "aria-label": read ? "取消已读标记" : "标记为已读",
          onclick: event => { event.stopPropagation(); toggle("read", g, i); render(); },
        }, read ? icon("check") : null)));
    const row = h("div", { class: "ch-row" + (S.openChapters[i] ? " open" : "") + (i === S.chapter ? " current" : "") }, line);
    if (sections.length) {
      line.append(h("button", {
        class: "expand",
        "aria-label": S.openChapters[i] ? "收起小节" : "展开小节",
        onclick: event => { event.stopPropagation(); S.openChapters[i] = !S.openChapters[i]; render(); },
      }, icon("chevron-right")));
      const secList = h("div", { class: "sec-list" });
      sections.forEach(e => {
        secList.append(h("div", {
          class: "sec " + e.kind + (isDone(g, e.id) ? " done" : ""),
          onclick: () => jumpToSection(g, e.id),
        }, icon(KINDS[e.kind]), h("span", { text: e.kind === "boss" && fights > 1 ? e.title + " " + e.no : (e.name || e.title) })));
      });
      row.append(secList);
    }
    return row;
  }

  function renderDrawer() {
    const g = guide();
    const readCount = g.chapters.filter((c, i) => isRead(g, i)).length;
    const head = h("div", { class: "drawer-head" }, h("h2", null, g.game, h("small", { text: g.name })));
    if (GUIDES.length > 1) {
      const picks = h("div", { class: "guide-picks" });
      GUIDES.forEach(x => picks.append(h("button", {
        class: "guide-pick" + (x.id === g.id ? " active" : ""),
        onclick: () => switchGuide(x.id),
      }, x.game + " " + x.name)));
      head.append(picks);
    }
    head.append(
      h("div", { class: "progress", text: "已读 " + readCount + " / " + g.chapters.length + " 话" }),
      h("div", { class: "bar" }, h("i", { style: "width:" + Math.round(readCount / g.chapters.length * 100) + "%" })));
    const body = h("div", { class: "drawer-body" });
    g.chapters.forEach((ch, i) => body.append(chapterRow(g, ch, i)));
    const drawer = $(".drawer");
    drawer.textContent = "";
    drawer.append(head, body);
  }

  function switchGuide(id) {
    if (id === S.guide) { setDrawer(false); return; }
    S.guide = id;
    persist("guide", id);
    const p = S.pos[id];
    S.chapter = p ? Math.min(p.ch, guide().chapters.length - 1) : 0;
    S.tab = "read";
    S.openChapters = {};
    setDrawer(false);
    render();
  }

  function setDrawer(open) {
    S.drawer = open;
    document.body.classList.toggle("drawer-open", open);
    document.body.classList.toggle("masked", open);
    syncBack();
  }

  /* ---------- frame ---------- */
  function renderTop() {
    const g = guide();
    const title = $("#top-title");
    title.textContent = "";
    if (S.tab === "read") {
      const ch = g.chapters[S.chapter];
      title.append(h("span", { class: "t-label", text: ch.label }), h("span", { class: "t-name", text: ch.name }));
    } else if (S.tab === "notes") {
      title.append(h("span", { class: "t-label", text: "笔记 ·" }), h("span", { class: "t-name", text: NOTE_LABEL[S.notesTab] }));
    } else {
      title.append(h("span", { class: "t-name", text: "之门清单" }));
    }
  }

  function renderTabs() {
    const g = guide();
    const nav = $("#tabs");
    nav.textContent = "";
    TABS.forEach(([id, label, ico]) => {
      const tab = h("button", { class: "tab" + (S.tab === id ? " active" : ""), onclick: () => setTab(id) }, icon(ico), h("span", { text: label }));
      if (id === "doors") {
        const left = g.sections.filter(e => !isDone(g, e.id)).length;
        if (left) tab.append(h("span", { class: "badge", text: String(left) }));
      }
      nav.append(tab);
    });
  }

  function setTab(tab) { S.tab = tab; render(); }

  function render() {
    const view = $("#view");
    const g = guide();
    renderTop();
    if (S.tab === "read") renderChapter(view, g);
    else if (S.tab === "doors") renderList(view, g);
    else renderNotes(view);
    renderTabs();
    renderDrawer();
    syncBack();
  }

  /* ---------- back / overlays ---------- */
  function topOverlay() {
    for (let i = OVERLAYS.length - 1; i >= 0; i--) {
      if (document.getElementById(OVERLAYS[i]).classList.contains("open")) return OVERLAYS[i];
    }
    return null;
  }
  function openOverlay(id) {
    document.getElementById(id).classList.add("open");
    syncBack();
  }
  function closeOverlay(id) {
    document.getElementById(id).classList.remove("open");
    syncBack();
  }
  function canBack() { return !!topOverlay() || S.drawer || S.tab !== "read"; }
  function goBack() {
    const overlay = topOverlay();
    if (overlay) { closeOverlay(overlay); return true; }
    if (S.drawer) { setDrawer(false); return true; }
    if (S.tab !== "read") { setTab("read"); return true; }
    return false;
  }
  function syncBack() {
    if (window.AndroidBridge && AndroidBridge.setCanBack) AndroidBridge.setCanBack(canBack());
  }
  window.TrailsBack = goBack;

  /* ---------- search ---------- */
  const searchIndex = [];

  function buildSearchIndex() {
    const tpl = document.createElement("template");
    GUIDES.forEach(g => g.chapters.forEach((ch, ci) => {
      tpl.innerHTML = ch.html;
      $$(BLOCKS, tpl.content).forEach((block, bi) => {
        const copy = block.cloneNode(true);
        $$("br", copy).forEach(br => br.replaceWith(" · "));
        searchIndex.push({ g: g.id, ch: ci, b: bi, text: copy.textContent.replace(/\s+/g, " ").trim() });
      });
    }));
    if (NOTES) {
      NOTES.battle.rows.forEach(r => searchIndex.push({
        notes: { tab: "battle", id: "battle-" + r.id }, where: "笔记 · 战斗",
        text: [r.name, r.place, r.chapter, r.drops.join(" ")].join(" "),
      }));
      NOTES.books.forEach(bk => searchIndex.push({
        notes: { tab: "books", id: "books-" + bk.id }, where: "笔记 · 书籍",
        text: [bk.title, bk.when, bk.how].join(" "),
      }));
      NOTES.cooking.rows.forEach(c => searchIndex.push({
        notes: { tab: "cooking", id: "cooking-" + c.id }, where: "笔记 · 料理",
        text: [c.name, c.type, c.when, c.how].join(" "),
      }));
    }
  }

  function snippet(text, terms) {
    const low = text.toLowerCase();
    let at = -1;
    terms.forEach(t => { const i = low.indexOf(t); if (i >= 0 && (at < 0 || i < at)) at = i; });
    const from = Math.max(0, at - 18);
    const to = Math.min(text.length, at + 56);
    const re = new RegExp("(" + terms.map(escapeRegExp).join("|") + ")", "gi");
    const html = text.slice(from, to).split(re)
      .map((part, i) => (i % 2 ? "<mark>" + escapeHtml(part) + "</mark>" : escapeHtml(part))).join("");
    return (from > 0 ? "…" : "") + html + (to < text.length ? "…" : "");
  }

  function runSearch(query) {
    const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
    const out = $(".search-results");
    out.textContent = "";
    if (!terms.length) {
      out.append(h("div", { class: "hint", text: "输入关键词搜索攻略\n例如：暗物质 · 封印石 · 耀脉" }));
      return;
    }
    const hits = searchIndex.filter(item => {
      const low = item.text.toLowerCase();
      return terms.every(t => low.indexOf(t) >= 0);
    });
    hits.slice(0, 80).forEach(item => {
      const g = item.notes ? null : GUIDES.filter(x => x.id === item.g)[0];
      const ch = g ? g.chapters[item.ch] : null;
      const where = item.notes ? item.where : (GUIDES.length > 1 ? g.game + " · " : "") + ch.label + " " + ch.name;
      out.append(h("button", {
        class: "hit",
        onclick: () => { closeOverlay("search"); if (item.notes) openNotesHit(item.notes); else openBlock(g, item.ch, item.b); },
      },
        h("span", { class: "where", text: where }),
        h("span", { class: "text", html: snippet(item.text, terms) })));
    });
    if (!hits.length) out.append(h("div", { class: "hint", text: "没有找到「" + query.trim() + "」" }));
    else if (hits.length > 80) out.append(h("div", { class: "hint", text: "共 " + hits.length + " 条，仅显示前 80 条" }));
  }

  /* ---------- settings ---------- */
  const external = { target: "_blank", rel: "noopener" };

  function aboutNode(g) {
    const about = h("div", null,
      h("p", null, "本应用是个人使用的离线阅读工具，非官方产品。攻略内容搬运自 ",
        h("a", Object.assign({ href: "https://trails-game.com/" }, external), "轨迹系列 – Cafe"),
        "，原作者 ", g.author || "（见原网页）", "。"),
      h("p", null, "原文地址：", h("a", Object.assign({ href: g.source }, external), g.source)),
      h("p", null, "许可：", h("a", Object.assign({ href: "https://creativecommons.org/licenses/by-nc/4.0/deed-zh" }, external),
        "知识共享 署名 – 非商业性使用 4.0 国际许可协议（CC BY-NC 4.0）"), "，仅限非商业用途。"),
      h("p", null, "改动说明：仅重新排版，并增加了章节导航、之门 / Boss 清单和搜索；文字未作修改，配图即原文图片。"),
      h("p", null, "内容快照日期：" + g.fetched + "。原文更新后需要重新同步。"));
    if (g.related && g.related.length) {
      const list = h("ul");
      g.related.forEach(link => list.append(h("li", null, h("a", Object.assign({ href: link.url }, external), link.label))));
      about.append(h("p", { text: "这几部分未收录，请到原网页查看：" }), list);
    }
    return about;
  }

  function openSettings() {
    renderSettings();
    openOverlay("settings");
  }

  function renderSettings() {
    const fonts = $("#font-opts");
    fonts.textContent = "";
    FONT_NAMES.forEach((name, i) => fonts.append(h("button", {
      class: i === S.font ? "active" : "",
      onclick: () => { S.font = i; persist("font", i); applyFont(); renderSettings(); },
    }, name)));
    const themes = $("#theme-opts");
    themes.textContent = "";
    THEMES.forEach(([id, name]) => themes.append(h("button", {
      class: S.theme === id ? "active" : "",
      onclick: () => { S.theme = id; persist("theme", id); applyTheme(); renderSettings(); },
    }, name)));
    const about = $("#about");
    about.textContent = "";
    about.append(aboutNode(guide()));
  }

  /* ---------- image viewer (pinch / pan / swipe) ---------- */
  let viewerImages = [];
  let viewerAt = 0;

  function showViewerImage() {
    const img = $("#viewer-img");
    const source = viewerImages[viewerAt];
    resetZoom();
    img.src = source.getAttribute("src");
    img.alt = source.alt;
    $("#viewer-count").textContent = viewerAt + 1 + " / " + viewerImages.length;
    $("#viewer-prev").disabled = viewerAt === 0;
    $("#viewer-next").disabled = viewerAt === viewerImages.length - 1;
  }
  function openViewer(img) {
    viewerImages = $$(".fig img", $("#view"));
    viewerAt = viewerImages.indexOf(img);
    showViewerImage();
    openOverlay("viewer");
  }
  function stepViewer(delta) {
    const next = viewerAt + delta;
    if (next < 0 || next >= viewerImages.length) return;
    viewerAt = next;
    showViewerImage();
  }

  let resetZoom = () => {};
  function setupViewer() {
    const overlay = $("#viewer");
    const img = $("#viewer-img");
    let scale = 1, tx = 0, ty = 0, start = null, moved = false, pressedAt = 0, lastTap = null, tapTimer = 0;
    const pointers = new Map();

    const apply = () => {
      img.style.transform = "translate(" + tx + "px," + ty + "px) scale(" + scale + ")";
    };
    resetZoom = () => { scale = 1; tx = 0; ty = 0; apply(); };
    const centre = () => ({ x: overlay.clientWidth / 2, y: overlay.clientHeight / 2 });
    const clamp = () => {
      const c = centre();
      const mx = Math.max(0, img.offsetWidth * scale / 2 - c.x);
      const my = Math.max(0, img.offsetHeight * scale / 2 - c.y);
      tx = Math.max(-mx, Math.min(mx, tx));
      ty = Math.max(-my, Math.min(my, ty));
    };
    const snapshot = () => {
      const p = Array.from(pointers.values());
      if (p.length === 1) return { x: p[0].x, y: p[0].y, scale, tx, ty };
      return {
        d: Math.hypot(p[0].x - p[1].x, p[0].y - p[1].y),
        cx: (p[0].x + p[1].x) / 2, cy: (p[0].y + p[1].y) / 2,
        scale, tx, ty,
      };
    };
    // Scale about the image centre so that the image point under (x, y) stays there.
    const zoomAt = (next, x, y) => {
      const c = centre();
      const ux = (x - c.x - tx) / scale;
      const uy = (y - c.y - ty) / scale;
      scale = next;
      tx = x - c.x - ux * scale;
      ty = y - c.y - uy * scale;
      if (scale === 1) { tx = 0; ty = 0; }
      clamp();
      apply();
    };

    overlay.addEventListener("pointerdown", event => {
      if (event.target.closest("button")) return;
      overlay.setPointerCapture(event.pointerId);
      overlay.classList.add("dragging");
      pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
      start = snapshot();
      moved = false;
      pressedAt = Date.now();
    });
    overlay.addEventListener("pointermove", event => {
      if (!pointers.has(event.pointerId)) return;
      pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
      const now = snapshot();
      if (!start) { start = now; return; }
      if (now.d != null && start.d != null) { // two fingers: pinch
        moved = true;
        zoomAt(Math.min(6, Math.max(1, start.scale * now.d / start.d)), now.cx, now.cy);
      } else if (now.d == null) { // one finger: pan when zoomed in
        if (Math.abs(now.x - start.x) + Math.abs(now.y - start.y) > 8) moved = true;
        if (scale > 1) {
          tx = start.tx + now.x - start.x;
          ty = start.ty + now.y - start.y;
          clamp();
          apply();
        }
      }
    });
    const release = event => {
      if (!pointers.has(event.pointerId)) return;
      pointers.delete(event.pointerId);
      if (pointers.size) { start = snapshot(); return; }
      overlay.classList.remove("dragging");
      const from = start;
      start = null;
      if (!from) return;
      if (moved) {
        const dx = event.clientX - from.x;
        const dy = event.clientY - from.y;
        if (scale === 1 && Math.abs(dx) > 56 && Math.abs(dx) > Math.abs(dy) * 1.5) stepViewer(dx < 0 ? 1 : -1);
        return;
      }
      if (Date.now() - pressedAt > 400) return; // long press, not a tap
      const tap = { x: event.clientX, y: event.clientY };
      const twice = lastTap && Date.now() - lastTap.at < 320 && Math.hypot(tap.x - lastTap.x, tap.y - lastTap.y) < 32;
      clearTimeout(tapTimer);
      if (twice) {
        lastTap = null;
        if (scale > 1) resetZoom(); else zoomAt(3, tap.x, tap.y);
      } else {
        lastTap = Object.assign({ at: Date.now() }, tap);
        tapTimer = setTimeout(() => {
          if (scale === 1) closeOverlay("viewer"); else resetZoom();
        }, 300);
      }
    };
    overlay.addEventListener("pointerup", release);
    overlay.addEventListener("pointercancel", event => {
      pointers.delete(event.pointerId);
      start = null;
      overlay.classList.remove("dragging");
    });
  }

  /* ---------- wiring ---------- */
  function init() {
    if (!GUIDES.length) {
      $("#view").textContent = "没有找到攻略内容，请先运行 tools/fetch_guide.py。";
      return;
    }
    $("#btn-menu").append(icon("menu"));
    $("#btn-search").append(icon("search"));
    $("#btn-settings").append(icon("sliders"));
    $("#btn-menu").addEventListener("click", () => setDrawer(!S.drawer));
    $("#top-title").addEventListener("click", () => setDrawer(true));
    $("#btn-search").addEventListener("click", () => {
      openOverlay("search");
      $("#search-input").focus();
    });
    $("#btn-settings").addEventListener("click", openSettings);
    $(".scrim").addEventListener("click", () => setDrawer(false));

    const searchBack = $("#search .icon-btn");
    searchBack.append(icon("arrow-left"));
    searchBack.addEventListener("click", () => closeOverlay("search"));
    $("#search-input").addEventListener("input", event => runSearch(event.target.value));
    $("#settings").addEventListener("click", event => {
      if (event.target === event.currentTarget) { closeOverlay("settings"); return; }
      // inside the APK the page cannot leave itself: ask the app to open the link in a browser
      const link = event.target.closest("a[href]");
      if (link && window.AndroidBridge && AndroidBridge.openUrl) {
        event.preventDefault();
        AndroidBridge.openUrl(link.href);
      }
    });
    $("#picker").addEventListener("click", event => { if (event.target === event.currentTarget) closeOverlay("picker"); });
    $("#viewer .icon-btn[data-close]").append(icon("close"));
    $("#viewer .icon-btn[data-close]").addEventListener("click", () => closeOverlay("viewer"));
    $("#viewer-prev").append(icon("arrow-left"));
    $("#viewer-prev").addEventListener("click", () => stepViewer(-1));
    $("#viewer-next").append(icon("arrow-right"));
    $("#viewer-next").addEventListener("click", () => stepViewer(1));

    $("#view").addEventListener("click", event => {
      const head = event.target.closest(".box-h");
      if (head) { head.parentNode.classList.toggle("closed"); return; }
      const img = event.target.closest(".fig img");
      if (img) openViewer(img);
    });

    // Remember how far down the current chapter was read.
    let frame = 0, saveTimer = 0;
    $("#view").addEventListener("scroll", () => {
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        if (S.tab !== "read") return;
        const view = $("#view");
        const max = view.scrollHeight - view.clientHeight;
        S.pos[S.guide] = { ch: S.chapter, ratio: max > 0 ? view.scrollTop / max : 0 };
        clearTimeout(saveTimer);
        saveTimer = setTimeout(() => persist("pos", S.pos), 400);
      });
    });
    document.addEventListener("keydown", event => { if (event.key === "Escape") goBack(); });

    buildSearchIndex();
    setupViewer();
    applyTheme();
    applyFont();
    const p = S.pos[S.guide];
    S.chapter = p ? Math.min(p.ch, guide().chapters.length - 1) : 0;
    render();
  }

  init();
})();
