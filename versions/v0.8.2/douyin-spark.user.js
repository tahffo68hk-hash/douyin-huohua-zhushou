// ==UserScript==
// @name         抖音火花助手 · 一键续火
// @namespace    spark-full-local-userscript
// @version      0.8.2
// @description  自动扫描、勾选后直接逐个发送；高级模块含定时、重试、火花、日志和多账号联动。非官方工具。
// @author       Spark Full contributors
// @match        https://www.douyin.com/chat*
// @run-at       document-idle
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_listValues
// @grant        GM_registerMenuCommand
// @grant        GM_xmlhttpRequest
// @connect      127.0.0.1
// @connect      localhost
// @license      MIT
// ==/UserScript==
(function () {
  "use strict";
  const NS = "spark-full:v2:";
  const VERSION = "0.8.2";
  const BUILD_ID = "v082-auto-result-no-manual-20261009-r1";
  const SCHEMA_KEY = "simple:v1:state";
  const MIGRATION_KEY = "simple:v1:migration";
  const SNAPSHOT_KEY = "simple:v1:legacy-snapshot";
  const RESTORE_SNAPSHOT_KEY = "simple:v1:before-restore";
  const DEFAULT_TEXT = "续火🔥";
  const SEND_INTENT_KEY = "simple:v1:send-intents";
  const PLUGIN_DEFAULTS = Object.freeze({
    library: false,
    emoji: true,
    history: false,
    backup: false,
    diagnostics: false,
    streak: false,
    pacing: false,
    presets: false,
    scheduling: false,
    retry: false,
    fireManage: false,
    accounts: false,
  });
  const SCHEDULE_DEFAULTS = Object.freeze({
    enabled: false,
    time: "20:30",
    graceMinutes: 20,
    lastRunDay: "",
    targets: [],
    retryCount: 2,
    retryDelaySeconds: 4,
    callbackEnabled: false,
    callbackPort: 7788,
    callbackToken: "",
    accountId: "",
  });
  const normalizeSchedule = (x) => {
    const v = isRecord(x) ? x : {};
    return {
      ...SCHEDULE_DEFAULTS,
      ...v,
      enabled: !!v.enabled,
      callbackEnabled: !!v.callbackEnabled,
      time: /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(String(v.time))
        ? v.time
        : "20:30",
      graceMinutes: Math.max(1, Math.min(120, Number(v.graceMinutes) || 20)),
      retryCount: Math.max(0, Math.min(3, Number(v.retryCount) || 0)),
      retryDelaySeconds: Math.max(
        1,
        Math.min(60, Number(v.retryDelaySeconds) || 4),
      ),
      callbackPort: Math.max(
        1024,
        Math.min(65535, Number(v.callbackPort) || 7788),
      ),
      callbackToken: String(v.callbackToken || "").slice(0, 150),
      accountId: String(v.accountId || "")
        .replace(/[^a-zA-Z0-9_-]/g, "")
        .slice(0, 60),
      targets: (Array.isArray(v.targets) ? v.targets : [])
        .filter(
          (t) =>
            t &&
            typeof t.name === "string" &&
            ["PERSON", "GROUP", "UNKNOWN"].includes(t.type),
        )
        .slice(0, 30)
        .map((t) => ({
          name: t.name.slice(0, 120),
          type: t.type,
          stableId: typeof t.stableId === "string" ? t.stableId : null,
        })),
    };
  };
  const sleep = (ms) => new Promise((done) => setTimeout(done, ms));
  const plain = (s) =>
    String(s || "")
      .replace(/\s+/g, " ")
      .trim();
  /* Douyin's editor kit keeps one U+200B placeholder at the start/end of an empty or edited editor.*/ /* Remove only those boundary placeholders; preserve internal zero-width characters in user text.*/ const editorText =
    (editor) =>
      String(editor?.textContent || "").replace(/^\u200B+|\u200B+$/g, "");
  const LEGACY_DEFAULT =
    "—————每日续火—————\n[TXTAPI]\n\n—————每日一言—————\n[API]\n\n—————专属一言—————\n[专属一言]\n\n🔥 火花已续 [天数] 天";
  const MAX_MATERIALS = 150,
    MAX_CONTENT = 900,
    MAX_BACKUP = 2_000_000;
  const SEL = {
    rows: '[data-e2e="conversation-item"],[class*="conversationConversationItemwrapper"],[class*="ConversationItemwrapper"]',
    titles: [
      ".conversationConversationItemtitle",
      '[class*="ConversationItemtitle"]:not([class*="titleWrapper"]):not([class*="TitleWrapper"])',
      '[data-e2e="conversation-title"]',
    ],
    header:
      '[class*="RightPanelHeadertitleContainer"],[class*="RightPanelHeader"]',
    editor:
      'div[data-slate-editor="true"][contenteditable="true"],div[contenteditable="true"][data-slate-editor]',
  };
  const KEY_NAMES = [
    "settings",
    "contacts",
    "selected",
    "tasks",
    "materials",
    "contactRules",
    "fireDaysByContact",
    "logs",
    "alerts",
    "isPaused",
    "migrated-v03",
    "migrated-v04",
    "migrated-v05",
    "migrated-v051",
    "migrated-v052",
    "migrated-v053",
  ];
  const isRecord = (x) =>
    x !== null && typeof x === "object" && !Array.isArray(x);
  const clone = (v) => JSON.parse(JSON.stringify(v));
  const deepEq = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  const esc = (s) =>
    String(s ?? "").replace(
      /[&<>"']/g,
      (x) =>
        ({
          "&": "&amp;",
          "<": "&lt;",
          ">": "&gt;",
          '"': "&quot;",
          "'": "&#39;",
        })[x],
    );
  const dayNow = (d = new Date()) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  const cleanName = (s) =>
    String(s ?? "")
      .replace(/\s+/g, " ")
      .trim();
  const disabledSettings = (x) => ({
    ...(isRecord(x) ? x : {}),
    autoEnabled: false,
    enableScriptBCallback: false,
    riskAlertsEnabled: false,
    failureAlertsEnabled: false,
    unknownAlertsEnabled: false,
    autoAllowVerifiedNoId: false,
  });
  const secretKey = (k) =>
    /(?:token|secret|passw|cookie|credential|sessionauth|api.?key|authorization)/i.test(
      k,
    );
  const sanitize = (value, depth = 0) => {
    if (depth > 15) return null;
    if (Array.isArray(value))
      return value.slice(0, 2000).map((v) => sanitize(v, depth + 1));
    if (!isRecord(value)) return value;
    return Object.fromEntries(
      Object.entries(value)
        .filter(
          ([k]) => !secretKey(k) && !/^(?:node|element|dom|html)$/i.test(k),
        )
        .map(([k, v]) => [k, sanitize(v, depth + 1)]),
    );
  };
  const storage = {
    get(key, fallback = null) {
      try {
        if (typeof GM_getValue === "function")
          return GM_getValue(NS + key, fallback);
        const v = localStorage.getItem(NS + key);
        return v === null ? fallback : JSON.parse(v);
      } catch (e) {
        throw Error(
          `无法读取本地数据：${key} (${String(e.message).slice(0, 80)})`,
        );
      }
    },
    set(key, val) {
      if (typeof GM_setValue === "function") GM_setValue(NS + key, clone(val));
      else localStorage.setItem(NS + key, JSON.stringify(val));
      if (!deepEq(this.get(key), val))
        throw Error(`本地数据写入校验失败：${key}`);
    },
    keys() {
      if (typeof GM_listValues === "function")
        return {
          keys: GM_listValues()
            .filter((k) => k.startsWith(NS) && !k.includes("simple:v1:"))
            .map((k) => k.slice(NS.length)),
          complete: true,
        };
      /* Older userscript managers may not have enumeration support; state this explicitly.*/ return {
        keys: KEY_NAMES.filter((k) => this.get(k, null) !== null),
        complete: false,
      };
    },
  };
  const materialFrom = (m) => {
    if (
      !isRecord(m) ||
      !["TEXT", "EMOJI"].includes(m.kind) ||
      typeof m.content !== "string"
    )
      return null;
    const c = m.content.trim();
    if (!c || c.length > MAX_CONTENT) return null;
    const id =
      typeof m.id === "string" && /^[a-zA-Z0-9_-]{5,90}$/.test(m.id)
        ? m.id
        : `manual_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
    return {
      id,
      kind: m.kind,
      content: c,
      title: cleanName(m.title || c.split("\n")[0]).slice(0, 60) || "常用内容",
      tags: String(m.tags || "").slice(0, 100),
    };
  };
  const sourceIsSimple = (str) =>
    typeof str === "string" &&
    !/(?:\[(?:API|TXTAPI|专属一言|天数)\]|\{(?:hitokoto|from_who|from)\})/i.test(
      str,
    );
  const initialData = (raw) => {
    const s = isRecord(raw.settings) ? raw.settings : {};
    const original = typeof s.message === "string" ? s.message : DEFAULT_TEXT;
    const draft =
      original === LEGACY_DEFAULT ||
      !sourceIsSimple(original) ||
      original.length > MAX_CONTENT
        ? "续火🔥"
        : original;
    const archive = isRecord(raw) ? sanitize(raw) : {};
    return {
      schema: 1,
      day: dayNow(),
      draft,
      paused: !!raw.isPaused,
      materials: (Array.isArray(raw.materials) ? raw.materials : [])
        .map(materialFrom)
        .filter(Boolean)
        .slice(0, MAX_MATERIALS),
      daily: {},
      manualChecks: {},
      plugins: { ...PLUGIN_DEFAULTS },
      automation: { ...SCHEDULE_DEFAULTS },
      fireRecords: {},
      deliveryLog: [],
      legacyArchive: archive,
      legacySnapshotComplete: !!raw.__complete,
      legacyDataNotice:
        original !== LEGACY_DEFAULT && original !== draft
          ? "旧版动态文案已归档，请到设置导出查看。"
          : "",
      /* Only stable IDs may survive refresh. Legacy names or provisional keys NEVER become identity evidence.*/ savedStableChoices:
        [],
      ui: { collapsed: true, tab: "today" },
    };
  };
  const loadState = () => {
    const prev = storage.get(SCHEMA_KEY, null);
    if (isRecord(prev) && prev.schema === 1) return prev;
    return null;
  };
  const migrate = () => {
    const flag = storage.get(MIGRATION_KEY, null);
    if (flag === "COMPLETE") {
      const v = loadState();
      if (!v) throw Error("轻量版数据不完整，请保留旧数据并重新加载");
      /* Ensure older configuration cannot silently re-arm after a downgrade/reinstall.*/ storage.set(
        "settings",
        disabledSettings(storage.get("settings", {})),
      );
      return v;
    }
    /* Snapshot happens BEFORE reading any normalized legacy contact list, to avoid missing no-ID names.*/ let snapshot =
      storage.get(SNAPSHOT_KEY, null);
    if (!snapshot) {
      const enumerated = storage.keys(),
        original = { __complete: enumerated.complete };
      for (const k of enumerated.keys) original[k] = storage.get(k, null);
      snapshot = {
        createdAt: new Date().toISOString(),
        complete: enumerated.complete,
        raw: original,
      };
      storage.set(SNAPSHOT_KEY, snapshot);
      storage.set(MIGRATION_KEY, "SNAPSHOTTED");
    }
    const original = snapshot.raw;
    /* Disable old executor settings even in downgrade. No timer or executor exists in this new script.*/ storage.set(
      "settings",
      disabledSettings(original.settings),
    );
    const state = loadState() || initialData(original);
    storage.set(SCHEMA_KEY, state);
    storage.set(MIGRATION_KEY, "COMPLETE");
    return state;
  };
  const normalized = (s) => {
    if (!isRecord(s) || s.schema !== 1) throw Error("不支持的数据格式");
    const data = {
      ...s,
      ui: isRecord(s.ui) ? s.ui : { collapsed: true, tab: "today" },
    };
    data.paused = !!s.paused;
    data.automation = normalizeSchedule(s.automation);
    data.fireRecords = isRecord(s.fireRecords) ? s.fireRecords : {};
    data.sendDelay = Math.min(30, Math.max(1, Number(s.sendDelay) || 3));
    data.plugins = {
      ...PLUGIN_DEFAULTS,
      ...(isRecord(s.plugins) ? s.plugins : {}),
    };
    data.deliveryLog = Array.isArray(s.deliveryLog)
      ? s.deliveryLog.slice(-100)
      : [];
    data.draft = typeof s.draft === "string" ? s.draft : DEFAULT_TEXT;
    data.materials = (Array.isArray(s.materials) ? s.materials : [])
      .map(materialFrom)
      .filter(Boolean)
      .slice(0, MAX_MATERIALS);
    data.daily = isRecord(s.daily) ? s.daily : {};
    data.manualChecks = isRecord(s.manualChecks) ? s.manualChecks : {};
    data.savedStableChoices = [];
    data.legacyArchive = isRecord(s.legacyArchive) ? s.legacyArchive : {};
    data.ui.tab = ["today", "advanced", "settings"].includes(data.ui.tab)
      ? data.ui.tab
      : "today";
    /* Current-page no-ID selections are NEVER persisted.*/ return data;
  };
  /* Read-only selectors adapted from V0.5.3, with time/date sibling nodes excluded.*/ const visible =
    (n) => Boolean(n && n.isConnected && n.getClientRects().length);
  const first = (scope, selectors) => {
    for (const sel of selectors) {
      try {
        const found = scope?.querySelector(sel);
        if (found) return found;
      } catch (_) {
        /* CSS changed */
      }
    }
    return null;
  };
  const nameNode = (root) => {
    if (!root) return null;
    const specific = first(root, [
      '[data-e2e*="nickname"]',
      '[class*="nickname"]',
      '[class*="Nickname"]',
      '[class*="userName"]',
      '[class*="UserName"]',
    ]);
    if (specific) {
      const t = cleanName(specific.textContent);
      if (t && t.length <= 120) return specific;
    }
    const all = [];
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) {
      const n = walker.currentNode,
        p = n.parentElement,
        t = cleanName(n.nodeValue);
      if (!p || !t || t.length > 120) continue;
      let el = p,
        skip = false;
      while (el && el !== root.parentElement) {
        const cls = String(el.className || "");
        if (
          el.tagName === "TIME" ||
          el.hasAttribute("datetime") ||
          /(?:date|time|weekday|timestamp)/i.test(cls)
        ) {
          skip = true;
          break;
        }
        el = el.parentElement;
      }
      if (!skip) all.push({ n: p, t });
    }
    return all.sort((a, b) => b.t.length - a.t.length)[0]?.n || null;
  };
  const conversationType = (row) => {
    const attrs = [
      "data-conversation-type",
      "data-chat-type",
      "data-type",
      "aria-label",
      "title",
    ]
      .map((k) => `${k}:${row.getAttribute(k) || ""}`)
      .join(" ");
    const ctx = (String(row.className || "") + " " + attrs).toLowerCase();
    if (/(?:group[-_ ]?chat|conversation[-_ ]?group|群聊|群成员)/.test(ctx))
      return "GROUP";
    if (/(?:person[-_ ]?chat|conversation[-_ ]?single|单聊|私聊)/.test(ctx))
      return "PERSON";
    const groups = row.querySelectorAll(".commonConversationIconnoDrag");
    const avatars = row.querySelectorAll(".commonIMAvataravatarContainer");
    if (groups.length === 1 && avatars.length === 0) return "GROUP";
    if (
      groups.length === 0 &&
      avatars.length === 1 &&
      avatars[0].querySelector("img")
    )
      return "PERSON";
    return "UNKNOWN";
  };
  const ID_ATTRS = [
    "data-conversation-id",
    "data-chat-id",
    "data-session-id",
    "data-conversation-key",
  ];
  const idFromRow = (row) => {
    const ids = new Set();
    let node = row;
    for (let depth = 0; node && depth < 4; depth++, node = node.parentElement) {
      if (
        node === document.body ||
        (node.matches?.(SEL.rows) === false &&
          node.querySelectorAll?.(SEL.rows).length > 1)
      )
        break;
      for (const k of ID_ATTRS) {
        const v = node.getAttribute(k);
        if (v && /^[\w:\-.]{3,180}$/.test(v)) ids.add(v);
      }
    }
    return ids.size === 1 ? [...ids][0] : null;
  };
  const pageSalt = `scan_${Math.random().toString(36).slice(2)}`;
  const candidateKey = (name, type, id) =>
    id ? `id:${id}` : `temp:${pageSalt}:${encodeURIComponent(name)}:${type}`;
  const scanCandidates = () => {
    const rows = [...document.querySelectorAll(SEL.rows)],
      items = [],
      duplicates = new Map();
    for (const row of rows) {
      const title = first(row, SEL.titles),
        n = nameNode(title),
        name = cleanName(n?.textContent || "");
      if (!name) continue;
      const id = idFromRow(row),
        type = conversationType(row),
        key = candidateKey(name, type, id);
      const daysNode = first(row, [
        '[class*="commonStreaknormalText"]',
        '[data-e2e*="streak"]',
      ]);
      const fireText = cleanName(daysNode?.textContent || "");
      const fireDays = /^(?:\d{1,5}|\d{1,5}天)$/.test(fireText)
        ? parseInt(fireText, 10)
        : null;
      const c = {
        key,
        name,
        type,
        stableId: id,
        fireDays,
        ambiguous: false,
        node: row,
      };
      items.push(c);
      duplicates.set(key, (duplicates.get(key) || 0) + 1);
    }
    for (const it of items) it.ambiguous = duplicates.get(it.key) > 1;
    return items;
  };
  const findScrollContainer = () => {
    const row = document.querySelector(SEL.rows);
    let p = row?.parentElement;
    while (p && p !== document.body) {
      const st = getComputedStyle(p);
      if (
        /auto|scroll/.test(st.overflowY) &&
        p.scrollHeight > p.clientHeight + 12
      )
        return p;
      p = p.parentElement;
    }
    return null;
  };
  const legacyTaskCounts = (tasks) => {
    const rows = Object.entries(isRecord(tasks) ? tasks : {}).filter(
      ([k, v]) => k.startsWith(dayNow() + "|") && isRecord(v),
    );
    return rows.reduce(
      (a, [, v]) => {
        if (["SUBMITTED", "UNKNOWN"].includes(v.status)) a.pending++;
        return a;
      },
      { pending: 0 },
    );
  };
  const statusFor = (item, day = dayNow()) => {
    const v = item?.dayStates?.[day];
    return v?.status || "PENDING";
  };
  const statusLabel = (s) =>
    ({
      PENDING: "待处理",
      SKIPPED: "今天跳过",
      SENT: "网页已确认发出",
      FAILED: "本次未发送",
      UNCERTAIN: "发送结果未知",
    })[s] || "待处理";
  const UI_CSS = `     :host{all:initial;color-scheme:light;font-family:system-ui,-apple-system,"PingFang SC","Microsoft YaHei",sans-serif;--ink:#182538;--sub:#617184;--line:#e4e9f0;--blue:#2563eb;--paper:#fff;--bg:#f7f9fc}     *{box-sizing:border-box}button,input,textarea{font:inherit}button{cursor:pointer}button:disabled{cursor:not-allowed;opacity:.55}     .chip{position:fixed;right:22px;bottom:22px;border:1px solid #d4dae6;background:#172c46;color:#fff;border-radius:100px;padding:12px 17px;box-shadow:0 10px 25px #142d4b3d;font-size:13px;font-weight:700;z-index:2147483646;max-width:250px;touch-action:none}     .panel{position:fixed;bottom:76px;right:20px;width:370px;max-width:calc(100vw - 16px);height:min(650px,calc(100vh - 92px));min-height:310px;border:1px solid #e0e6ef;background:var(--paper);border-radius:16px;box-shadow:0 22px 70px #102b4433;z-index:2147483646;overflow:hidden;display:flex;flex-direction:column;color:var(--ink);font-size:13px}     .top{padding:13px 16px 8px;touch-action:none;cursor:grab;display:flex;align-items:center;justify-content:space-between;gap:8px}.top strong{font-size:16px;letter-spacing:.2px}.nav{display:grid;grid-template-columns:1fr 1fr;padding:5px 16px 10px;gap:6px;border-bottom:1px solid var(--line)}.nav button{padding:8px;border:0;background:#f0f3f7;border-radius:9px;color:#506174}.nav button[aria-selected=true]{background:#e9f0ff;color:#1b51bb;font-weight:700}     .body{overflow:auto;min-height:0;padding:13px 15px 18px;overscroll-behavior:contain}.hint{font-size:12px;line-height:1.5;background:#f1f6ff;border:1px solid #e5edff;padding:10px 11px;border-radius:10px;color:#496081;margin-bottom:12px}.muted{font-size:12px;color:var(--sub);line-height:1.5}.meta{font-size:11px;color:var(--sub)}     .metrics{display:grid;grid-template-columns:repeat(3,1fr);gap:6px;margin:8px 0 15px}.metric{background:var(--bg);border-radius:10px;text-align:center;padding:9px 3px}.metric b{display:block;font-size:19px}.metric span{font-size:11px;color:var(--sub)}     .section{margin-top:13px}.section-title{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:9px}.section-title strong{font-size:14px}     .primary{border:0;background:var(--blue);color:white;border-radius:9px;padding:10px 13px;font-weight:600;min-height:36px}.secondary{background:#fff;border:1px solid #dce4ee;color:var(--ink);border-radius:9px;padding:8px 10px;min-height:34px}.ghost{border:0;background:transparent;color:#42639b;padding:7px 8px;border-radius:8px}.tiny{font-size:12px;padding:6px 8px;min-height:31px}.wide{width:100%;margin-top:10px}.row{display:flex;align-items:center;justify-content:space-between;gap:7px}.stack{display:flex;flex-direction:column;gap:8px}     .contact{border:1px solid var(--line);border-radius:10px;padding:9px 8px;margin:6px 0;display:flex;align-items:center;gap:8px}.contact.selected{border-color:#a9c4fc;background:#f5f8ff}.info{min-width:0;flex:1}.truncate{white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:100%;display:block}.state{font-size:11px;color:#65758a}.state.problem{color:#a45317}.state.good{color:#14826b}     .filters{display:flex;gap:5px}.filters button{font-size:11px;padding:6px 8px;border:1px solid #e1e6ee;border-radius:16px;background:white;color:#51647c}.filters button[aria-pressed=true]{background:#e9f0ff;color:#1a50a9;border-color:#bad0ff}     textarea{display:block;width:100%;border:1px solid #cfd8e6;border-radius:10px;min-height:86px;padding:11px;background:#fff;color:var(--ink);font-size:14px;line-height:1.55;resize:vertical}textarea:focus,input:focus,button:focus-visible{outline:2px solid #719fff;outline-offset:1px}     input{width:100%;padding:9px;border:1px solid #d6dfeb;border-radius:9px;color:var(--ink);background:white;font-size:13px}.emoji{display:flex;gap:5px;margin:8px 0}.emoji button{border:1px solid #e3e9f1;background:#fff;border-radius:8px;min-width:36px;min-height:32px}     .drawer{position:absolute;inset:57px 0 0;background:#fff;z-index:2;display:flex;flex-direction:column;border-top:1px solid var(--line)}.drawerhead{padding:13px 16px;border-bottom:1px solid var(--line);display:flex;justify-content:space-between;align-items:center}.drawerbody{padding:13px 15px;overflow:auto;flex:1}.badge{font-size:10px;border-radius:5px;padding:2px 5px;background:#f1f4f9;color:#63738a}.warning{background:#fff7e9;color:#875a16;padding:9px;border-radius:8px;font-size:12px}.empty{text-align:center;border:1px dashed #d8e1ec;border-radius:11px;padding:17px 8px;color:var(--sub)}.hr{height:1px;background:var(--line);margin:16px 0}     .toast{position:absolute;left:12px;right:12px;bottom:10px;padding:9px 12px;background:#243851;color:#fff;border-radius:9px;box-shadow:0 4px 12px #1233;z-index:5;font-size:12px;pointer-events:none}.hidden{display:none!important}     .scan-results{max-height:238px;overflow:auto;border:1px solid var(--line);border-radius:10px;margin:8px 0 7px;padding:2px;overscroll-behavior:contain}     .scan-results .contact{margin:4px;border:0;border-bottom:1px solid #edf0f5;border-radius:4px}     .scan-results input[type=checkbox],.plugin-row input[type=checkbox]{appearance:auto;width:18px;height:18px;flex:none;accent-color:#2563eb}     .plugin-row{display:flex;gap:12px;align-items:center;padding:12px 2px;border-bottom:1px solid var(--line);cursor:pointer}     .help p{margin:7px 0;color:#5b6b7e;font-size:12px;line-height:1.55}     @media(max-width:380px){.panel{right:8px;bottom:62px;height:min(580px,calc(100vh - 75px))}.chip{right:10px;bottom:10px}}   `;
  const download = (filename, obj) => {
    const blob = new Blob([JSON.stringify(obj, null, 2)], {
        type: "application/json;charset=utf-8",
      }),
      url = URL.createObjectURL(blob),
      a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  };
  const exportWhitelist = (source, dayLog) => {
    const raw = {
      format: "spark-simple-v1",
      version: VERSION,
      exportedAt: new Date().toISOString(),
      data: {
        schema: 1,
        draft: source.draft,
        materials: clone(source.materials),
        paused: source.paused,
        automation: {
          ...normalizeSchedule(source.automation),
          enabled: false,
          callbackEnabled: false,
          callbackToken: "",
        },
        fireRecords: sanitize(source.fireRecords || {}),
        manualChecks: sanitize(source.manualChecks),
        daily: sanitize(dayLog || {}),
        legacyArchive: {
          contacts: sanitize(source.legacyArchive.contacts || []),
          selected: sanitize(source.legacyArchive.selected || []),
          materials: sanitize(source.legacyArchive.materials || []),
          settings: sanitize(source.legacyArchive.settings || {}),
          contactRules: sanitize(source.legacyArchive.contactRules || {}),
          fireDaysByContact: sanitize(
            source.legacyArchive.fireDaysByContact || {},
          ),
          alerts: sanitize(source.legacyArchive.alerts || []),
          tasks: sanitize(source.legacyArchive.tasks || {}),
        },
      },
    };
    return sanitize(raw);
  };
  const parseImport = (text) => {
    if (typeof text !== "string" || text.length > MAX_BACKUP)
      throw Error("备份过大（最大 2 MB）");
    const x = JSON.parse(text);
    if (!isRecord(x)) throw Error("备份文件格式错误");
    const old = x.format === "spark-full-v2";
    const lite = x.format === "spark-simple-v1";
    if (!old && !lite) throw Error("不支持的备份版本");
    let data;
    if (old) {
      if (
        !isRecord(x.settings) ||
        !Array.isArray(x.contacts) ||
        !Array.isArray(x.selected)
      )
        throw Error("旧版备份结构错误");
      if (
        x.contacts.length > 1000 ||
        x.selected.length > 1000 ||
        (x.materials?.length || 0) > MAX_MATERIALS
      )
        throw Error("备份内容超过限制");
      data = initialData({
        settings: x.settings,
        contacts: x.contacts,
        selected: x.selected,
        materials: x.materials || [],
        contactRules: x.contactRules || {},
        fireDaysByContact: x.fireDays || {},
        tasks: x.tasks || {},
        __complete: false,
        isPaused: true,
      });
    } else {
      if (
        !isRecord(x.data) ||
        !Array.isArray(x.data.materials) ||
        x.data.materials.length > MAX_MATERIALS ||
        typeof x.data.draft !== "string" ||
        x.data.draft.length > MAX_CONTENT
      )
        throw Error("新版备份内容错误");
      data = normalized({ ...x.data, schema: 1 });
    }
    /* NEVER grant identity, overwrite current frozen tasks, or revive legacy execution.*/ data.savedStableChoices =
      [];
    data.paused = true;
    data.automation = normalizeSchedule({
      ...data.automation,
      enabled: false,
      callbackEnabled: false,
      callbackToken: "",
    });
    data.legacyArchive = sanitize(data.legacyArchive);
    return {
      old,
      data,
      materials: data.materials.length,
      archiveContactCount: (data.legacyArchive.contacts || []).length,
    };
  };
  const safeDiagnosis = ({ scan, store }) => ({
    format: "spark-simple-diagnostic-v1",
    version: VERSION,
    buildId: BUILD_ID,
    date: dayNow(),
    listPresent: document.querySelectorAll(SEL.rows).length > 0,
    headerPresent: !!document.querySelector(SEL.header),
    editorPresent: !!document.querySelector(SEL.editor),
    candidateCount: scan.length,
    stableCandidates: scan.filter((i) => !!i.stableId).length,
    types: {
      personal: scan.filter((i) => i.type === "PERSON").length,
      group: scan.filter((i) => i.type === "GROUP").length,
      unknown: scan.filter((i) => i.type === "UNKNOWN").length,
    },
    legacySnapshotComplete: !!store.legacySnapshotComplete,
    /* No names, identifiers, chats, text, or full URL.*/ errors: [],
  });
  let model = null,
    host = null,
    shadow = null,
    panel = null,
    body = null,
    chip = null,
    notice = null;
  const run = {
    logSearch: "",
    fireEditName: "",
    tab: "today",
    scanning: false,
    sending: false,
    aborted: false,
    scanComplete: false,
    progress: "",
    delivered: 0,
    failed: 0,
    uncertain: 0,
    scanMap: new Map(),
    sessionSent: new Set(),
    tabOpenCount: 0,
    open: false,
    drawer: "",
    filter: "ALL",
    search: "",
    candidates: [],
    items: new Map(),
    active: null,
    toast: "",
    copyStatus: "",
    restore: null,
    deleted: null,
    deletedTimeout: null,
    showLegacy: false,
    showSupport: false,
    legacyPending: 0,
    warning: "",
    readOnly: false,
    suppressClick: false,
  };
  const save = () => {
    storage.set(SCHEMA_KEY, { ...model, savedStableChoices: [] });
  };
  const setToast = (msg) => {
    run.toast = msg;
    if (notice) {
      notice.textContent = msg;
      notice.classList.toggle("hidden", !msg);
    }
  };
  const mergeVisible = () => {
    for (const c of scanCandidates()) {
      const previous = run.scanMap.get(c.key);
      if (previous) {
        if (c.ambiguous) previous.ambiguous = true;
        const oldAvatar = previous.node
          ?.querySelector?.(".commonIMAvataravatarContainer img")
          ?.getAttribute("src");
        const newAvatar = c.node
          ?.querySelector?.(".commonIMAvataravatarContainer img")
          ?.getAttribute("src");
        if (oldAvatar && newAvatar && oldAvatar !== newAvatar)
          previous.ambiguous = true;
        /* Across virtualized rows retain the identity key, but never retain old DOM pointers.*/ previous.node =
          c.node;
      } else run.scanMap.set(c.key, { ...c, node: c.node });
    }
    run.candidates = [...run.scanMap.values()];
    for (const c of run.candidates) {
      const it = run.items.get(c.key);
      if (it) {
        it.name = c.name;
        it.type = c.type;
        it.ambiguous = c.ambiguous;
      }
      if (
        model &&
        (model.plugins.streak || model.plugins.fireManage) &&
        !c.ambiguous &&
        c.type === "PERSON" &&
        Number.isInteger(c.fireDays) &&
        c.fireDays > 0
      ) {
        const old = model.fireRecords[c.name];
        if (!old || old.days !== c.fireDays || old.source !== "PAGE_ROW") {
          model.fireRecords[c.name] = {
            days: c.fireDays,
            source: "PAGE_ROW",
            at: Date.now(),
          };
          save();
        }
      }
    }
    return run.candidates.length;
  };
  const syncCandidates = () => mergeVisible();
  const scanAll = async () => {
    if (run.scanning || run.sending) return;
    run.scanning = true;
    run.scanMap.clear();
    run.scanComplete = false;
    run.progress = "读取聊天列表";
    render();
    const scroller = findScrollContainer(),
      oldTop = scroller?.scrollTop || 0;
    try {
      mergeVisible();
      if (scroller) {
        scroller.scrollTop = 0;
        await sleep(180);
        mergeVisible();
        let last = -1,
          stale = 0;
        for (let i = 0; i < 65; i++) {
          if (!scroller.isConnected || run.aborted) break;
          const max = Math.max(
              0,
              scroller.scrollHeight - scroller.clientHeight,
            ),
            next = Math.min(
              max,
              scroller.scrollTop + Math.max(170, scroller.clientHeight * 0.75),
            );
          scroller.scrollTop = next;
          await sleep(110);
          mergeVisible();
          if (scroller.scrollTop === last || scroller.scrollTop >= max) {
            if (++stale >= 2) break;
          } else stale = 0;
          last = scroller.scrollTop;
        }
      }
      run.scanComplete = true;
      run.progress = `已读取 ${run.candidates.length} 个会话`;
    } catch (e) {
      run.progress = "读取已停止：" + String(e.message).slice(0, 65);
    } finally {
      if (scroller?.isConnected) scroller.scrollTop = oldTop;
      run.scanning = false;
      render();
    }
  };
  const currentStreak = () => {
    const header = document.querySelector(SEL.header);
    if (!header || !visible(header)) return null;
    const target = [
      header,
      header.parentElement,
      header.parentElement?.parentElement,
    ].filter(Boolean);
    for (const scope of target) {
      const n = scope.querySelector?.(
        '[class*="commonStreaknormalText"],[data-e2e*="streak"]',
      );
      if (!n || !visible(n)) continue;
      const text = cleanName(n.textContent);
      if (!text) continue;
      const nearby = cleanName(n.parentElement?.textContent || "").slice(
        0,
        140,
      );
      const days = /^(?:\d{1,5}|\d{1,5}天|连续\d{1,5}天)$/.test(text)
        ? text
        : null;
      return {
        days,
        status: /待重燃|需要重燃|去重燃/.test(nearby)
          ? "待重燃"
          : /已重燃|重燃成功/.test(nearby)
            ? "已重燃"
            : "状态需查看抖音页面",
      };
    }
    return null;
  };
  const currentStatus = (it) => {
    if (!it) return "PENDING";
    if (it.day !== dayNow()) {
      it.day = dayNow();
      it.status = "PENDING";
      it.manualAt = null;
    }
    return it.status;
  };
  const counts = () => {
    const arr = [...run.items.values()];
    return {
      pending: arr.filter((i) => currentStatus(i) === "PENDING").length,
      checked: arr.filter((i) => currentStatus(i) === "SENT").length,
      uncertain: arr.filter((i) => currentStatus(i) === "UNCERTAIN").length,
    };
  };
  const createItem = (c) => ({
    key: c.key,
    name: c.name,
    type: c.type,
    ambiguous: c.ambiguous,
    day: dayNow(),
    status: "PENDING",
    manualAt: null,
  });
  const addCandidate = (key) => {
    const c = run.candidates.find((v) => v.key === key && !v.ambiguous);
    if (!c) {
      setToast("列表发生变化，请重新读取后选择");
      return;
    }
    if (c.type === "GROUP") {
      setToast("群聊不加入个人处理清单");
      return;
    }
    if (/(?:AI分身|智能体|AI助手)/i.test(c.name)) {
      setToast("AI 会话不自动加入，请自行在官方聊天操作");
      return;
    }
    if (!run.items.has(key)) run.items.set(key, createItem(c));
    run.active = key;
    run.drawer = "";
    setToast("已加入今天，未发送任何消息");
    render();
  };
  const setListStatus = (it, status) => {
    if (!it) return;
    it.status = status;
    it.day = dayNow();
    render();
  };
  const rowHtml = (it) => {
    const s = currentStatus(it);
    return `<div class="contact" data-local-row="${esc(it.key)}"><div class="info"><b class="truncate">${esc(it.name)}</b><div class="state ${s === "SENT" ? "good" : ["UNCERTAIN", "FAILED"].includes(s) ? "problem" : ""}">${esc(statusLabel(s))} ${it.type === "GROUP" ? "· 群聊" : it.type === "UNKNOWN" ? "· 类型待核实" : ""}</div></div><button class="ghost tiny" data-action="row-more" data-key="${esc(it.key)}" aria-label="更多操作">⋯</button></div>${run.drawer === "more:" + it.key ? `<div class="row" style="padding:4px 8px 10px;justify-content:flex-end"><button class="secondary tiny" data-action="${s === "SKIPPED" ? "unskip" : "skip"}" data-key="${esc(it.key)}">${s === "SKIPPED" ? "撤销跳过" : "今天跳过"}</button><button class="secondary tiny" data-action="remove" data-key="${esc(it.key)}">移出清单</button></div>` : ""}`;
  };
  const selectable = (c) =>
    !c.ambiguous &&
    c.type !== "GROUP" &&
    !/(?:AI分身|智能体|AI助手)/i.test(c.name);
  const candidateHtml = (c) => {
    const checked = run.items.has(c.key),
      allowed = selectable(c);
    const typ =
      c.type === "GROUP" ? "群聊" : c.type === "PERSON" ? "个人" : "类型待核实";
    const it = run.items.get(c.key),
      stat = it ? statusLabel(currentStatus(it)) : "";
    return `<label class="contact ${checked ? "selected" : ""}" data-candidate="${esc(c.key)}" style="cursor:${allowed ? "pointer" : "default"}"><input type="checkbox" data-select-key="${esc(c.key)}" ${checked ? "checked" : ""} ${allowed ? "" : "disabled"} aria-label="选择 ${esc(c.name)}"/><div class="info"><b class="truncate">${esc(c.name)}</b><div class="meta">${esc(typ)}${model.plugins.streak && Number.isInteger(c.fireDays) && c.fireDays > 0 ? " · 火花 " + c.fireDays + " 天" : ""}${stat ? " · " + esc(stat) : ""}${c.ambiguous ? " · 名称重复" : ""}</div></div></label>`;
  };
  const todayHtml = () => {
    const count = counts(),
      selected = [...run.items.values()],
      good = selected.filter((i) => currentStatus(i) === "PENDING").length;
    const filtered = run.candidates.filter(
      (c) =>
        !run.search || c.name.toLowerCase().includes(run.search.toLowerCase()),
    );
    return `<div class="metrics"><div class="metric"><b>${run.candidates.length}</b><span>扫描会话</span></div><div class="metric"><b>${selected.length}</b><span>已勾选</span></div><div class="metric"><b>${count.checked}</b><span>已确认发送</span></div></div>       <div class="row"><strong>勾选要处理的聊天</strong><button class="secondary tiny" data-action="scan" ${run.scanning || run.sending ? "disabled" : ""}>${run.scanning ? "扫描中…" : "↻ 扫描全部"}</button></div>       <div class="meta" style="margin:5px 0">${esc(run.progress || "进入页面自动读取聊天；可搜索后勾选。")}</div>       <input id="spark-quick-search" placeholder="搜索聊天昵称" value="${esc(run.search)}" aria-label="搜索聊天昵称" />       <div class="scan-results" id="spark-scan-results">${filtered.length ? filtered.map(candidateHtml).join("") : '<div class="empty">当前没有匹配的会话，可点击扫描全部。</div>'}</div>       <div class="row"><span class="meta">${selected.length} 个已勾选 · 每轮最多30个</span><div class="row"><button class="ghost tiny" data-action="select-all">全选可用</button><button class="ghost tiny" data-action="deselect">取消全选</button></div></div>       ${model.plugins.streak ? `<div class="hint">当前聊天火花：${currentStreak() ? `${esc(currentStreak().days || "未知")} · ${esc(currentStreak().status)}` : "页面未显示可读取的火花标记"}。以抖音官方聊天为准。</div>` : ""}       <div class="section"><div class="section-title"><strong>发送内容</strong>${model.plugins.library ? '<button class="ghost tiny" data-action="library-open">常用内容 ›</button>' : ""}</div>       <textarea id="spark-final-draft" maxlength="10000">${esc(model.draft)}</textarea>       ${model.plugins.emoji ? `<div class="emoji">${["🔥", "❤️", "🫶", "😊"].map((v) => `<button data-action="emoji" data-value="${v}">${v}</button>`).join("")}</div>` : ""}       <div class="row"><span class="meta" id="spark-draft-counter">${model.draft.length}/${MAX_CONTENT} 字</span><span class="meta">${run.sending ? esc(run.progress) : "自动切换并验证结果"}</span></div>       <button class="primary wide" data-action="batch-send" ${!good || run.sending || run.scanning || model.paused ? "disabled" : ""}>${run.sending ? "发送执行中…" : `一键自动发送（${good}）`}</button>       ${run.sending ? '<button class="secondary wide" data-action="stop-send">停止后续发送</button>' : ""}       <p class="muted">点击即执行：按所选顺序自动切换、输入并发送，无额外确认弹窗。对象不匹配或结果不明确时停止后续发送。</p>       ${model.paused ? '<div class="warning">发送已暂停，可到「高级」恢复。</div>' : ""}       ${run.progress && !run.sending ? `<div class="warning" role="status">${esc(run.progress)}</div>` : ""}       ${
      selected.some((i) =>
        ["UNCERTAIN", "SENT", "FAILED"].includes(currentStatus(i)),
      )
        ? `<div class="section-title" style="margin-top:12px"><strong>本次处理结果</strong></div>${selected
            .filter((i) => currentStatus(i) !== "PENDING")
            .map(rowHtml)
            .join("")}`
        : ""
    }       ${run.legacyPending ? `<p class="muted">旧版有 ${run.legacyPending} 项结果未知记录，已自动阻止重复发送。</p>` : ""}       <button class="secondary wide" data-action="copy">仅复制正文，不发送</button></div>`;
  };
  const pluginRows = [
    ["library", "常用文案库", "保存、选择常用内容"],
    ["emoji", "快捷 Emoji", "在正文中快速插入表情"],
    ["history", "执行记录", "查看本次逐人发送状态"],
    ["backup", "备份与恢复", "导出、预览及恢复本地数据"],
    ["diagnostics", "脱敏诊断", "导出不含聊天内容的兼容信息"],
    ["streak", "火花状态读取", "只显示页面能实际识别的状态"],
    ["pacing", "自定义发送间隔", "每个会话发送确认后再等待"],
    ["presets", "批量内容轮换", "从常用文案里逐条轮换发送"],
    ["scheduling", "每日定时执行", "设时间及保存当前勾选名单，前台自动执行"],
    ["retry", "发送失败重试", "只重试未提交消息的导航失败，不重发未知消息"],
    ["fireManage", "火花天数管理", "读取当前页面可见天数或手工建立本地记录"],
    ["accounts", "多账号调度联动", "配置本地调度器回调与独立浏览器账号"],
  ];
  const scheduleHtml = () =>
    `<div class="section"><strong>每日定时执行</strong><p class="muted">保存勾选名单后，每天在浏览器已登录且该页处于前台时运行。重名或当前聊天不匹配会停止，不会后台群发。</p>     <label class="plugin-row"><div class="info"><b>启用定时</b></div><input type="checkbox" data-auto-toggle="enabled" ${model.automation.enabled ? "checked" : ""}/></label>     <label class="muted">执行时间（本机时间）<input type="time" data-auto-field="time" value="${esc(model.automation.time)}"/></label>     <label class="muted">错过时间允许补执行（分钟）<input type="number" data-auto-field="graceMinutes" min="1" max="120" value="${model.automation.graceMinutes}"/></label>     <button class="secondary wide" data-action="schedule-save-targets">保存当前勾选为定时名单</button>     <p class="muted">当前已保存 ${model.automation.targets.length} 位 · 上次执行 ${esc(model.automation.lastRunDay || "暂无")} · 定时默认关闭</p></div>`;
  const fireManageHtml = () =>
    `<div class="section"><strong>火花天数管理</strong><p class="muted">页面值和手动记录分开标注；本地编辑不改变抖音官方天数。</p>     <p class="muted">当前聊天：${esc(headerName() || "未打开")} · 页面读取：${esc(currentStreak()?.days || "暂无")}</p>     <input id="spark-fire-name" placeholder="昵称（精确填写）" value="${esc(run.fireEditName || headerName())}" />     <input id="spark-fire-days" type="number" min="0" max="99999" placeholder="手工填写天数" />     <div class="row"><button class="secondary tiny" data-action="fire-save">保存本地天数</button><button class="secondary tiny" data-action="fire-capture">记录当前页面数值</button></div>     ${Object.entries(
      model.fireRecords || {},
    )
      .slice(-15)
      .map(
        ([k, v]) =>
          `<div class="meta">${esc(k)}：${Number(v.days) || 0} 天 · ${v.source === "PAGE" || v.source === "PAGE_ROW" ? "页面读取" : "本地手工记录"}</div>`,
      )
      .join("")}</div>`;
  const accountsHtml = () =>
    `<div class="section"><strong>多账号调度器回调</strong><p class="muted">请通过 tools/manager.py 配置不同 Chrome Profile；每个账号的脚本设置相同回调端口与令牌。只向本机 127.0.0.1 报告执行结果。</p>     <label class="muted">账号标识（与调度器配置一致）<input data-auto-field="accountId" value="${esc(model.automation.accountId)}" placeholder="account_1"/></label>     <label class="muted">本机回调端口<input data-auto-field="callbackPort" type="number" min="1024" max="65535" value="${model.automation.callbackPort}" /></label>     <label class="muted">回调令牌<input data-auto-field="callbackToken" type="password" value="${esc(model.automation.callbackToken)}" autocomplete="off" placeholder="从本地管理器复制" /></label>     <label class="plugin-row"><div class="info">定时执行完成后通知本地调度器</div><input type="checkbox" data-auto-toggle="callbackEnabled" ${model.automation.callbackEnabled ? "checked" : ""}/></label></div>`;
  const logRowsHtml = () =>
    (model.deliveryLog || [])
      .slice(-100)
      .filter(
        (e) =>
          !run.logSearch ||
          [e.name, e.status, e.reason].join(" ").includes(run.logSearch),
      )
      .slice(-30)
      .reverse()
      .map(
        (e) =>
          `<div class="contact"><div class="info"><b>${esc(e.name)}</b><div class="muted">${esc(e.status)} · ${esc(e.reason || "")} · ${new Date(e.at).toLocaleString()}</div></div></div>`,
      )
      .join("") || '<p class="muted">没有匹配的执行记录</p>';
  const advancedHtml = () =>
    `<div class="section-title"><strong>高级功能</strong><span class="badge">按需启用</span></div>     <p class="muted">勾选后功能立即加入工作台或本页。取消勾选只隐藏功能，不删除已有数据。</p>     <button class="primary wide" data-action="plugin-open">⚙ 管理高级功能 · 已开启 ${Object.values(model.plugins).filter(Boolean).length} 项</button>     <p class="muted">可随时在模块窗口勾选或关闭，不会删除原来的素材与记录。</p>     ${model.plugins.pacing ? `<div class="section"><label for="spark-delay" class="muted">两位联系人之间的间隔（秒）</label><input id="spark-delay" type="number" min="1" max="30" value="${Number(model.sendDelay) || 3}" /></div>` : ""}     ${model.plugins.presets ? `<div class="section"><p class="muted">轮换仅使用已保存的文字素材；点击发送后依序分配给已勾选会话。</p><button class="secondary tiny" data-action="library-open">管理轮换文案（${model.materials.length}）</button></div>` : ""}     ${model.plugins.history ? `<div class="section"><strong>执行记录</strong><input id="spark-log-search" placeholder="筛选昵称、状态或原因" value="${esc(run.logSearch || "")}" /><div id="spark-log-rows">${logRowsHtml()}</div><button class="secondary wide" data-action="export-logs">导出执行日志</button></div>` : ""}     ${model.plugins.backup ? settingsHtml() : ""}     ${model.plugins.diagnostics ? `<div class="section"><button class="secondary wide" data-action="diagnostic">导出脱敏诊断</button></div>` : ""}      ${model.plugins.scheduling ? scheduleHtml() : ""}      ${model.plugins.retry ? `<div class="section"><strong>安全失败重试</strong><p class="muted">仅重试未发生提交的聊天定位失败；提交结果未知时绝不重试。</p><label class="muted">最多重试次数（0～3）<input data-auto-field="retryCount" type="number" min="0" max="3" value="${model.automation.retryCount}"/></label><label class="muted">重试等待（秒）<input data-auto-field="retryDelaySeconds" type="number" min="1" max="60" value="${model.automation.retryDelaySeconds}"/></label></div>` : ""}      ${model.plugins.fireManage ? fireManageHtml() : ""}      ${model.plugins.accounts ? accountsHtml() : ""}     <div class="section"><button class="secondary wide" data-action="pause-toggle">${model.paused ? "恢复一键发送" : "暂停一键发送"}</button></div>     <div class="hr"></div><p class="muted">V${VERSION} · ${BUILD_ID} · 仅在当前打开的抖音聊天网页执行。</p>`;
  const settingsHtml = () =>
    `<div class="section"><strong>数据备份</strong><p class="muted">导出的备份含联系人名称和文案，请自行保管。</p>     <button class="secondary wide" data-action="export">导出备份</button><button class="secondary wide" data-action="import-open">导入备份</button><input type="file" id="spark-import-file" accept=".json,application/json" hidden />     <button class="ghost tiny" data-action="archive-toggle">${run.showLegacy ? "收起迁移说明" : "旧版数据说明"}</button>${run.showLegacy ? '<p class="muted">旧设置和任务已隔离归档。旧定时与回调均已关闭，不会自动启动。</p>' : ""}     ${run.restore ? `<div class="warning">备份预览：素材 ${run.restore.materials} 项。<button class="primary tiny" data-action="restore-yes">确认恢复</button><button class="secondary tiny" data-action="restore-cancel">取消</button></div>` : ""}</div>`;
  const drawerHtml = () => {
    if (run.drawer === "plugins")
      return `<section class="drawer" aria-label="高级功能管理"><div class="drawerhead"><strong>按需添加功能</strong><button class="ghost" data-action="drawer-close">完成</button></div><div class="drawerbody">${pluginRows.map(([key, title, desc]) => `<label class="plugin-row"><div class="info"><b>${title}</b><div class="muted">${desc}</div></div><input type="checkbox" data-plugin="${key}" ${model.plugins[key] ? "checked" : ""} /></label>`).join("")}</div></section>`;
    if (run.drawer === "add") {
      const q = run.search.toLowerCase();
      const candidates = run.candidates.filter(
        (x) => !q || x.name.toLowerCase().includes(q),
      );
      return `<section class="drawer" aria-label="添加聊天"><div class="drawerhead"><strong>添加聊天</strong><button class="ghost" data-action="drawer-close">关闭</button></div><div class="drawerbody"><input id="spark-contact-search" placeholder="搜索聊天名称" value="${esc(run.search)}" aria-label="搜索聊天名称"/>       <p class="muted">只展示当前网页能读取的聊天。无稳定 ID 时仅当前页面有效，刷新需要重新选择。群聊和 AI 分身不主动列入。</p>       <div id="spark-drawer-results">${candidates.length ? candidates.map((c) => `<div class="contact"><div class="info"><b class="truncate">${esc(c.name)}</b><span class="meta">${c.type === "PERSON" ? "个人" : c.type === "GROUP" ? "群聊" : "类型待核实"}${c.ambiguous ? " · 记录重复" : ""}</span></div><button class="secondary tiny" data-action="add" data-key="${esc(c.key)}" ${run.items.has(c.key) || c.ambiguous || c.type === "GROUP" || /(?:AI分身|智能体|AI助手)/i.test(c.name) ? "disabled" : ""}>${run.items.has(c.key) ? "已加入" : "添加"}</button></div>`).join("") : '<div class="empty">没找到对应的聊天。请先在抖音打开聊天列表。</div>'}</div>       <button class="secondary wide" data-action="rescan">重新读取当前列表</button></div></section>`;
    }
    if (run.drawer === "library")
      return `<section class="drawer" aria-label="常用内容"><div class="drawerhead"><strong>常用内容</strong><button class="ghost" data-action="drawer-close">关闭</button></div><div class="drawerbody">       <label for="spark-material-new" class="muted">新增一条常用文字</label><textarea id="spark-material-new" placeholder="输入文字或 Emoji" style="min-height:74px"></textarea><button class="primary wide" data-action="material-save">保存到常用内容</button>       <p class="muted">当前 ${model.materials.length}/${MAX_MATERIALS} 项；原生表情名称仅存旧归档。</p>       ${run.deleted ? `<div class="warning">已删除「${esc(run.deleted.item.title)}」 <button class="ghost tiny" data-action="material-undo">5 秒内撤销</button></div>` : ""}       ${model.materials.map((x) => `<div class="contact"><div class="info"><b class="truncate">${esc(x.title)}</b><span class="meta truncate">${esc(x.content).replace(/\n/g, " · ")}</span></div><button class="secondary tiny" data-action="material-use" data-key="${esc(x.id)}">使用</button><button class="ghost tiny" data-action="material-delete" data-key="${esc(x.id)}">删除</button></div>`).join("") || '<div class="empty">还没有常用内容</div>'}</div></section>`;
    return "";
  };
  const clamp = (x, lo, hi) => Math.min(Math.max(x, lo), Math.max(lo, hi));
  const placeFloating = () => {
    if (!chip || !panel || !isRecord(model?.ui?.float)) return;
    const pos = model.ui.float;
    const right = clamp(
      Number(pos.right) || 0,
      8,
      Math.max(8, innerWidth - 64),
    );
    const bottom = clamp(
      Number(pos.bottom) || 0,
      8,
      Math.max(8, innerHeight - 60),
    );
    chip.style.right = right + "px";
    chip.style.bottom = bottom + "px";
    panel.style.right =
      clamp(right, 8, Math.max(8, innerWidth - panel.offsetWidth - 8)) + "px";
    const panelHeight =
      panel.getBoundingClientRect().height || Math.min(650, innerHeight - 92);
    panel.style.bottom =
      clamp(
        bottom + chip.offsetHeight + 10,
        8,
        Math.max(8, innerHeight - panelHeight - 8),
      ) + "px";
  };
  const attachDragging = (target, allowed) => {
    let drag = null;
    target.addEventListener("pointerdown", (e) => {
      if (e.button !== 0 || !allowed(e)) return;
      const box = chip.getBoundingClientRect();
      drag = {
        x: e.clientX,
        y: e.clientY,
        right: innerWidth - box.right,
        bottom: innerHeight - box.bottom,
        moved: false,
      };
      try {
        target.setPointerCapture(e.pointerId);
      } catch (_) {
        /* pointer capture optional */
      }
    });
    target.addEventListener("pointermove", (e) => {
      if (!drag) return;
      const dx = e.clientX - drag.x,
        dy = e.clientY - drag.y;
      if (Math.hypot(dx, dy) > 6) drag.moved = true;
      if (!drag.moved) return;
      model.ui.float = {
        right: clamp(drag.right - dx, 8, Math.max(8, innerWidth - 64)),
        bottom: clamp(drag.bottom - dy, 8, Math.max(8, innerHeight - 60)),
      };
      placeFloating();
    });
    const done = () => {
      if (drag?.moved) {
        run.suppressClick = true;
        save();
      }
      drag = null;
    };
    target.addEventListener("pointerup", done);
    target.addEventListener("pointercancel", done);
  };
  const render = () => {
    if (!host) return;
    const scroll = body?.scrollTop || 0,
      drawerScroll = panel?.querySelector(".drawerbody")?.scrollTop || 0;
    chip.textContent =
      "🔥 续火" +
      (counts().uncertain + run.legacyPending
        ? ` · ${counts().uncertain + run.legacyPending}结果未知`
        : "");
    panel.classList.toggle("hidden", !run.open);
    if (!run.open) return;
    if (run.readOnly) {
      panel.innerHTML = `<div class="top"><strong>迁移需要处理</strong><button class="ghost" data-action="collapse">收起</button></div><div class="body"><div class="warning">${esc(run.warning)}。未覆盖原数据、没有执行任何发送或通知。请检查 ScriptCat 存储权限，恢复后刷新页面。</div></div>`;
      return;
    }
    panel.innerHTML = `<div class="top"><strong>🔥 续火助手</strong><button class="ghost" data-action="collapse" aria-label="收起助手">收起 ↓</button></div><div class="nav" role="tablist" aria-label="助手页面"><button role="tab" aria-selected="${run.tab === "today"}" data-action="tab" data-value="today">今天</button><button role="tab" aria-selected="${run.tab === "advanced"}" data-action="tab" data-value="advanced">高级</button></div><main class="body" role="tabpanel">${run.tab === "today" ? todayHtml() : advancedHtml()}</main>${drawerHtml()}<div class="toast ${run.toast ? "" : "hidden"}" role="status" aria-live="polite">${esc(run.toast)}</div>`;
    body = panel.querySelector(".body");
    body.scrollTop = scroll;
    const drawerBody = panel.querySelector(".drawerbody");
    if (drawerBody) drawerBody.scrollTop = drawerScroll;
    notice = panel.querySelector(".toast");
    placeFloating();
  };
  const copyContent = async () => {
    const text = model.draft;
    if (!text.trim()) {
      setToast("先输入要发送的内容");
      return;
    }
    if (text.length > MAX_CONTENT) {
      setToast(`内容超过 ${MAX_CONTENT} 字，请修改后复制；原文已保留`);
      return;
    }
    try {
      if (!navigator.clipboard?.writeText)
        throw Error("Clipboard API unavailable");
      await navigator.clipboard.writeText(text);
      run.copyStatus = "已复制 · 尚未发送";
      setToast("已复制，可自行在抖音聊天框使用");
    } catch (_) {
      run.copyStatus = "复制失败";
      setToast("复制未成功，请手动选择正文复制；没有发送消息");
      const textarea = panel.querySelector("#spark-final-draft");
      textarea?.focus();
      textarea?.select();
    }
    /* No task.status changes on clipboard events.*/ const s =
      panel.querySelector("#spark-copy-state");
    if (s) s.textContent = run.copyStatus;
  };
  const restore = () => {
    if (!run.restore) return;
    if (
      !window.confirm(
        `确定恢复备份？\n有效素材 ${run.restore.materials} 条。旧身份不会自动绑定，所有自动发送仍关闭。`,
      )
    )
      return;
    const old = { ...model };
    const backup = storage.get(RESTORE_SNAPSHOT_KEY, null);
    /* Before overwrite, keep current lite state and raw old data safe.*/ storage.set(
      RESTORE_SNAPSHOT_KEY,
      {
        createdAt: new Date().toISOString(),
        lite: clone(model),
        oldBackup: backup ? { createdAt: backup.createdAt } : null,
      },
    );
    try {
      const draft = normalized(run.restore.data);
      draft.paused = old.paused;
      draft.automation = normalizeSchedule({
        ...draft.automation,
        enabled: false,
        callbackEnabled: false,
        callbackToken: "",
      });
      draft.ui = { collapsed: false, tab: "settings" };
      draft.legacyArchive = { ...old.legacyArchive, ...draft.legacyArchive };
      /* Never import external task statuses over locally committed/unknown tasks.*/ const localFrozen =
        isRecord(old.legacyArchive.tasks) ? old.legacyArchive.tasks : {};
      const imported = isRecord(draft.legacyArchive.tasks)
        ? draft.legacyArchive.tasks
        : {};
      draft.legacyArchive.tasks = { ...imported, ...localFrozen };
      draft.manualChecks = { ...draft.manualChecks, ...old.manualChecks };
      draft.fireRecords = { ...draft.fireRecords, ...old.fireRecords };
      storage.set(SCHEMA_KEY, draft);
      storage.set("settings", disabledSettings(storage.get("settings", {})));
      model = draft;
      run.items.clear();
      run.active = null;
      run.restore = null;
      run.drawer = "";
      run.open = true;
      run.tab = "advanced";
      setToast("恢复成功，自动发送关闭，请重新选择聊天");
      render();
    } catch (e) {
      try {
        storage.set(SCHEMA_KEY, old);
        model = old;
      } catch (_) {
        /* snapshot remains */
      }
      setToast("恢复失败，原数据已保留：" + String(e.message).slice(0, 80));
      render();
    }
  };
  const onClick = (event) => {
    if (run.suppressClick) {
      run.suppressClick = false;
      event.preventDefault();
      return;
    }
    if (run.readOnly) {
      if (event.target.closest?.('[data-action="collapse"]')) {
        run.open = false;
        render();
      }
      event.preventDefault();
      return;
    }
    const btn = event.target.closest?.("[data-action]");
    if (!btn) return;
    const act = btn.dataset.action,
      key = btn.dataset.key,
      val = btn.dataset.value;
    if (!act) return;
    event.preventDefault();
    switch (act) {
      case "collapse":
        run.open = false;
        run.drawer = "";
        break;
      case "tab":
        run.tab = val;
        run.drawer = "";
        run.toast = "";
        break;
      case "scan":
        void scanAll();
        return;
      case "select-all": {
        if (run.sending) return;
        for (const c of run.candidates.filter(selectable).slice(0, 30)) {
          if (!run.items.has(c.key)) run.items.set(c.key, createItem(c));
        }
        run.progress = `已选择 ${run.items.size} 位`;
        break;
      }
      case "plugin-open":
        run.drawer = "plugins";
        break;
      case "deselect":
        if (run.sending) return;
        run.items.clear();
        run.active = null;
        break;
      case "schedule-save-targets":
        saveScheduledTargets();
        break;
      case "export-logs":
        download(`spark-execution-${dayNow()}.json`, {
          format: "spark-execution-v1",
          at: new Date().toISOString(),
          logs: model.deliveryLog || [],
        });
        return;
      case "fire-save":
        saveManualFire();
        break;
      case "fire-capture":
        capturePageFire();
        break;
      case "batch-send":
        void startBatch();
        return;
      case "stop-send":
        run.aborted = true;
        run.progress = "已请求停止；已经尝试提交的消息不会自动重发";
        break;
      case "pause-toggle":
        model.paused = !model.paused;
        save();
        break;
      case "add-open":
        syncCandidates();
        run.drawer = "add";
        run.search = "";
        break;
      case "clear-filter":
        run.filter = "ALL";
        break;
      case "filter":
        run.filter = val;
        break;
      case "drawer-close":
        run.drawer = "";
        break;
      case "rescan":
        syncCandidates();
        setToast("已重新读取当前可见会话，未发送任何消息");
        break;
      case "add":
        addCandidate(key);
        break;
      case "row-more":
        run.drawer = run.drawer === "more:" + key ? "" : "more:" + key;
        break;
      case "skip":
        setListStatus(run.items.get(key), "SKIPPED");
        run.drawer = "";
        break;
      case "unskip":
        setListStatus(run.items.get(key), "PENDING");
        run.drawer = "";
        break;
      case "remove":
        run.items.delete(key);
        if (run.active === key) run.active = null;
        run.drawer = "";
        break;
      case "emoji": {
        const ta = panel.querySelector("#spark-final-draft"),
          pos = ta?.selectionStart ?? model.draft.length;
        model.draft = model.draft.slice(0, pos) + val + model.draft.slice(pos);
        save();
        run.copyStatus = "";
        render();
        const next = panel.querySelector("#spark-final-draft");
        if (next) {
          next.focus();
          next.setSelectionRange(pos + val.length, pos + val.length);
        }
        return;
      }
      case "copy":
        void copyContent();
        return;
      case "library-open":
        run.drawer = "library";
        run.toast = "";
        break;
      case "material-save": {
        const t = panel.querySelector("#spark-material-new")?.value || "";
        if (
          !t.trim() ||
          t.length > MAX_CONTENT ||
          model.materials.length >= MAX_MATERIALS
        ) {
          setToast("内容为空、超过900字或素材已满");
          return;
        }
        const id =
          "manual_" +
          Date.now().toString(36) +
          "_" +
          Math.random().toString(36).slice(2, 8);
        model.materials.push({
          id,
          kind: "TEXT",
          content: t,
          title: cleanName(t.split("\n")[0]).slice(0, 60),
          tags: "",
        });
        save();
        setToast("已保存到常用内容");
        break;
      }
      case "material-use": {
        const item = model.materials.find((v) => v.id === key);
        if (item) {
          model.draft = item.content;
          save();
          run.drawer = "";
          setToast("内容已放入编辑框，尚未发送");
        }
        break;
      }
      case "material-delete": {
        const idx = model.materials.findIndex((m) => m.id === key);
        if (idx < 0) return;
        const [item] = model.materials.splice(idx, 1);
        run.deleted = { item, idx };
        save();
        if (run.deletedTimeout) clearTimeout(run.deletedTimeout);
        const origin = run.deleted;
        run.deletedTimeout = setTimeout(() => {
          if (run.deleted === origin) {
            run.deleted = null;
            if (run.drawer === "library") render();
          }
        }, 5000);
        setToast("已删除常用内容，5秒内可撤销");
        break;
      }
      case "material-undo": {
        if (run.deleted) {
          model.materials.splice(run.deleted.idx, 0, run.deleted.item);
          run.deleted = null;
          clearTimeout(run.deletedTimeout);
          save();
          setToast("已撤销删除");
        }
        break;
      }
      case "archive-toggle":
        run.showLegacy = !run.showLegacy;
        break;
      case "support-toggle":
        run.showSupport = !run.showSupport;
        break;
      case "diagnostic":
        download(
          `spark-support-${dayNow()}.json`,
          safeDiagnosis({ scan: run.candidates, store: model }),
        );
        return;
      case "export":
        download(
          `spark-simple-backup-${dayNow()}.json`,
          exportWhitelist(model, model.daily),
        );
        return;
      case "import-open":
        panel.querySelector("#spark-import-file")?.click();
        return;
      case "restore-yes":
        restore();
        return;
      case "restore-cancel":
        run.restore = null;
        setToast("已取消恢复，数据未更改");
        break;
      default:
        return;
    }
    render();
  };
  const onInput = (e) => {
    if (run.readOnly) return;
    if (e.target.id === "spark-delay") {
      model.sendDelay = Math.min(30, Math.max(1, Number(e.target.value) || 3));
      save();
      return;
    }
    if (e.target.hasAttribute("data-auto-field")) {
      const field = e.target.dataset.autoField;
      model.automation = normalizeSchedule({
        ...model.automation,
        [field]: e.target.value,
      });
      save();
      return;
    }
    if (e.target.id === "spark-log-search") {
      run.logSearch = e.target.value;
      const result = panel.querySelector("#spark-log-rows");
      if (result) result.innerHTML = logRowsHtml();
      return;
    }
    if (e.target.id === "spark-fire-name") {
      run.fireEditName = e.target.value;
      return;
    }
    if (e.target.id === "spark-final-draft") {
      model.draft = e.target.value;
      save();
      run.copyStatus = "";
      const counter = panel.querySelector("#spark-draft-counter");
      if (counter)
        counter.textContent = `${model.draft.length}/${MAX_CONTENT} 字`;
      const st = panel.querySelector("#spark-copy-state");
      if (st) st.textContent = "";
    } else if (e.target.id === "spark-quick-search") {
      run.search = e.target.value;
      const el = panel.querySelector("#spark-scan-results");
      if (el)
        el.innerHTML =
          run.candidates
            .filter((c) =>
              c.name.toLowerCase().includes(run.search.toLowerCase()),
            )
            .map(candidateHtml)
            .join("") || '<div class="empty">没有匹配的会话</div>';
    } else if (e.target.id === "spark-contact-search") {
      run.search = e.target.value;
      /* Render only the drawer's results, keeping focus/caret in its input.*/ const target =
        panel.querySelector("#spark-drawer-results");
      if (!target) return;
      const v = run.search.toLowerCase();
      const items = run.candidates.filter((c) =>
        c.name.toLowerCase().includes(v),
      );
      target.innerHTML =
        items
          .map(
            (c) =>
              `<div class="contact"><div class="info"><b class="truncate">${esc(c.name)}</b><span class="meta">${c.type === "GROUP" ? "群聊" : c.type === "PERSON" ? "个人" : "类型待核实"}</span></div><button class="secondary tiny" data-action="add" data-key="${esc(c.key)}" ${run.items.has(c.key) || c.ambiguous || c.type === "GROUP" || /(?:AI分身|智能体|AI助手)/i.test(c.name) ? "disabled" : ""}>${run.items.has(c.key) ? "已加入" : "添加"}</button></div>`,
          )
          .join("") || '<div class="empty">没有匹配的聊天</div>';
    }
  };
  const onChange = (e) => {
    if (run.readOnly) return;
    if (e.target.matches?.("[data-select-key]")) {
      const key = e.target.dataset.selectKey,
        c = run.candidates.find((x) => x.key === key);
      if (e.target.checked) {
        if (!c || !selectable(c)) {
          e.target.checked = false;
          setToast("该会话不能加入发送名单");
          return;
        }
        run.items.set(key, createItem(c));
      } else {
        run.items.delete(key);
        if (run.active === key) run.active = null;
      }
      render();
      return;
    }
    if (e.target.matches?.("[data-auto-toggle]")) {
      const field = e.target.dataset.autoToggle;
      model.automation[field] = !!e.target.checked;
      save();
      render();
      return;
    }
    if (e.target.matches?.("[data-plugin]")) {
      const key = e.target.dataset.plugin;
      if (!(key in PLUGIN_DEFAULTS)) return;
      model.plugins[key] = e.target.checked;
      if (key === "scheduling" && !e.target.checked)
        model.automation.enabled = false;
      if (key === "accounts" && !e.target.checked)
        model.automation.callbackEnabled = false;
      save();
      render();
      return;
    }
    void onFile(e);
  };
  const headerName = () => {
    const h = document.querySelector(SEL.header);
    if (!h || !visible(h)) return "";
    const n = nameNode(h);
    return cleanName(n?.textContent || h.textContent);
  };
  const findExactly = (target) => {
    const rows = scanCandidates().filter(
      (c) => c.name === target.name && c.type === target.type,
    );
    /* No ID means we only allow a single EXACT match in the currently visible list.*/ const matches =
      rows.filter((x) =>
        target.stableId ? x.stableId === target.stableId : true,
      );
    return matches.length === 1 && !matches[0].ambiguous
      ? matches[0].node
      : null;
  };
  const navigateTo = async (target) => {
    const currentEditor = document.querySelector(SEL.editor);
    if (
      currentEditor &&
      visible(currentEditor) &&
      plain(editorText(currentEditor))
    )
      return { ok: false, reason: "当前聊天有尚未发送的草稿，请先处理草稿" };
    let node = findExactly(target);
    const scroller = findScrollContainer();
    if (!node && scroller) {
      scroller.scrollTop = 0;
      await sleep(120);
      for (let i = 0; i < 80 && !node; i++) {
        node = findExactly(target);
        if (node) break;
        const max = Math.max(0, scroller.scrollHeight - scroller.clientHeight),
          next = Math.min(
            max,
            scroller.scrollTop + Math.max(150, scroller.clientHeight * 0.65),
          );
        if (next === scroller.scrollTop) break;
        scroller.scrollTop = next;
        await sleep(110);
      }
    }
    if (!node || !visible(node))
      return { ok: false, reason: "无法在页面中定位唯一会话" };
    if (run.candidates.filter((c) => c.name === target.name).length !== 1)
      return { ok: false, reason: "扫描结果中存在重名，已停止" };
    /* A second scan must agree with the selected contact before touching the page.*/ const verified =
      scanCandidates().filter(
        (c) =>
          c.node === node && c.name === target.name && c.type === target.type,
      );
    if (verified.length !== 1) return { ok: false, reason: "聊天列表发生变化" };
    node.click();
    for (let i = 0; i < 24; i++) {
      if (run.aborted) return { ok: false, reason: "已停止" };
      await sleep(130);
      if (
        headerName() === target.name &&
        visible(document.querySelector(SEL.editor))
      ) {
        /* Verify again immediately after selecting. Never use prefix/fuzzy name matching.*/ const again =
          scanCandidates().filter((c) => c.name === target.name);
        if (again.length !== 1)
          return { ok: false, reason: "当前聊天存在重名或类型冲突" };
        const allRows = [...document.querySelectorAll(SEL.rows)];
        const marked = allRows.filter(
          (r) =>
            r.getAttribute("aria-selected") === "true" ||
            /(?:^|\s)(?:selected|active|current)(?:\s|$)/i.test(
              String(r.className || ""),
            ),
        );
        if (
          marked.length &&
          (marked.length !== 1 || !marked.includes(again[0].node))
        )
          return { ok: false, reason: "当前被选中聊天与目标不一致" };
        return { ok: true };
      }
    }
    return { ok: false, reason: "聊天标题与目标不完全一致" };
  };
  const outgoingNodes = () =>
    [
      ...document.querySelectorAll(
        '[class*="MessageItemTextisFromMe"], [data-message-direction="outgoing"], [data-is-self="true"]',
      ),
    ].filter((n) => visible(n));
  const msgText = (n) =>
    plain(
      n?.querySelector?.('[class*="TextMessageTextpureText"]')?.textContent ||
        n?.textContent ||
        "",
    );
  const snapshotOutgoing = (text) =>
    outgoingNodes().filter((n) => msgText(n) === plain(text));
  const intentHash = (str) => {
    let h = 2166136261;
    for (let i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return (h >>> 0).toString(16).padStart(8, "0");
  };
  const intentKey = (target, message) =>
    dayNow() +
    ":" +
    intentHash(target.name + "\\u0000" + target.type + "\\u0000" + message);
  const getIntents = () => storage.get(SEND_INTENT_KEY, {}) || {};
  const markIntent = (target, message) => {
    const existing = getIntents(),
      key = intentKey(target, message);
    if (existing[key]) return false;
    const next = {
      ...Object.fromEntries(
        Object.entries(existing).filter(([k]) => k.startsWith(dayNow() + ":")),
      ),
      [key]: { at: Date.now(), status: "SUBMITTED_OR_UNKNOWN" },
    };
    storage.set(SEND_INTENT_KEY, next);
    return true;
  };
  const logged = (name, status, reason) => {
    model.deliveryLog ??= [];
    model.deliveryLog.push({ name, status, reason, at: Date.now() });
    model.deliveryLog = model.deliveryLog.slice(-100);
    save();
  };
  const runOne = async (target, message) => {
    const it = run.items.get(target.key);
    if (!it) return "SKIP";
    if (target.ambiguous || target.type === "GROUP") return "SKIP";
    if (currentStatus(it) !== "PENDING" || run.sessionSent.has(target.key))
      return "SKIP";
    if (target.stableId) {
      const legacyTasks = model.legacyArchive?.tasks || {};
      const old =
        legacyTasks[dayNow() + "|id:" + target.stableId] ||
        legacyTasks[dayNow() + "|" + target.stableId];
      if (["SUBMITTED", "UNKNOWN", "CONFIRMED"].includes(old?.status)) {
        it.status = "UNCERTAIN";
        run.progress = `${target.name}：旧版今天已有提交记录，已阻止重复发送`;
        return "UNKNOWN";
      }
    }
    if (getIntents()[intentKey(target, message)]) {
      it.status = "UNCERTAIN";
      run.progress = `${target.name}：本日已有提交记录，已阻止再次发送`;
      return "UNKNOWN";
    }
    const navigation = await navigateTo(target);
    if (!navigation.ok) {
      it.status = "FAILED";
      logged(target.name, "未发送", navigation.reason);
      run.progress = `${target.name}：${navigation.reason}`;
      return "RETRYABLE";
    }
    /* Never overwrite a real user draft; use exact expected message and matching current chat.*/ const editor =
      document.querySelector(SEL.editor);
    if (!editor || !visible(editor) || plain(editorText(editor))) {
      it.status = "FAILED";
      logged(target.name, "未发送", "聊天输入框已有内容或不可用");
      run.progress = `${target.name}：输入框不可用或已有草稿`;
      return "FAIL";
    }
    const baseline = snapshotOutgoing(message),
      baselineSet = new Set(baseline);
    if (typeof document.execCommand !== "function") {
      it.status = "FAILED";
      logged(target.name, "未发送", "浏览器不支持页面文本输入");
      return "FAIL";
    }
    editor.focus();
    const inserted = document.execCommand("insertText", false, message);
    await sleep(100);
    if (
      !inserted ||
      plain(editorText(editor)) !== plain(message) ||
      headerName() !== target.name
    ) {
      it.status = "FAILED";
      logged(target.name, "未发送", "写入聊天输入框后核对失败");
      return "FAIL";
    } /* The reference helper submits with an Enter event on the focused editor. */
    /* One submission method per attempt; never click again after an unknown result. */
    if (!markIntent(target, message)) {
      it.status = "UNCERTAIN";
      return "UNKNOWN";
    }
    it.status = "UNCERTAIN";
    run.sessionSent.add(target.key);
    render();
    editor.focus();
    const selection = editor.ownerDocument.defaultView.getSelection();
    const range = editor.ownerDocument.createRange();
    range.selectNodeContents(editor);
    range.collapse(false);
    selection.removeAllRanges();
    selection.addRange(range);
    for (const type of ["keydown", "keypress", "keyup"]) {
      editor.dispatchEvent(
        new KeyboardEvent(type, {
          key: "Enter",
          code: "Enter",
          keyCode: 13,
          which: 13,
          bubbles: true,
          cancelable: true,
          composed: true,
        }),
      );
    }
    const until = Date.now() + 6500;
    while (Date.now() < until) {
      await sleep(180);
      if (headerName() !== target.name) {
        logged(target.name, "待核实", "执行时聊天发生变化");
        return "UNKNOWN";
      }
      const hits = snapshotOutgoing(message);
      const fresh = hits.filter((n) => !baselineSet.has(n));
      if (
        fresh.length &&
        hits.length > baseline.length &&
        !plain(editorText(editor))
      ) {
        it.status = "SENT";
        it.manualAt = Date.now();
        logged(target.name, "已观察到新消息", "当前聊天新增匹配的己方文字");
        return "CONFIRMED";
      }
    }
    logged(target.name, "待核实", "页面未确认新增己方消息");
    return "UNKNOWN";
  };
  const contentFor = (targets) => {
    if (!model.plugins.presets || !model.materials.length)
      return targets.map(() => model.draft);
    const texts = model.materials
      .filter((x) => x.kind === "TEXT" || x.kind === "EMOJI")
      .map((x) => x.content)
      .filter(Boolean);
    return targets.map((_, i) =>
      texts.length ? texts[i % texts.length] : model.draft,
    );
  };
  const startBatch = async ({ scheduled = false, override = null } = {}) => {
    if (run.sending || run.scanning || model.paused || run.readOnly) return;
    const targets = (
      override ||
      [...run.items.keys()].map((key) =>
        run.candidates.find((c) => c.key === key),
      )
    )
      .filter(Boolean)
      .filter((c) => run.items.get(c.key)?.status === "PENDING");
    if (!targets.length) {
      setToast("请先勾选需要发送的会话");
      return;
    }
    if (targets.length > 30) {
      setToast("每轮最多 30 个聊天，请减少选择");
      return { status: "BLOCKED" };
    }
    /* No-ID conversations can be processed sequentially only after each visible row and current title agree.*/ /* Duplicated display names and selected-row conflicts still fail closed within navigateTo().*/ if (
      document.visibilityState !== "visible"
    ) {
      setToast("请将抖音聊天页面放到前台再发送");
      return;
    }
    if (!navigator.locks?.request) {
      setToast("当前浏览器缺少跨标签执行锁，已停止发送");
      return;
    }
    const messages = contentFor(targets);
    if (
      messages.some(
        (v) => !v.trim() || v.length > MAX_CONTENT || v.includes("\n"),
      )
    ) {
      setToast("一键发送仅接受 1～900 字的单行内容，请检查正文");
      return;
    }
    /* Clicking the primary button (or explicitly enabling a saved daily plan) is the execution instruction.*/ /* Keep per-recipient validation, cross-tab lock, draft protection and outgoing evidence; no extra confirm dialog.*/ return await navigator.locks.request(
      "spark-full-batch-send",
      { ifAvailable: true },
      async (lock) => {
        if (!lock) {
          setToast("其他标签页正在执行任务");
          return;
        }
        run.sending = true;
        run.aborted = false;
        run.progress = "准备发送";
        run.delivered = 0;
        run.failed = 0;
        run.uncertain = 0;
        render();
        try {
          for (let i = 0; i < targets.length; i++) {
            if (
              run.aborted ||
              document.visibilityState !== "visible" ||
              model.paused
            )
              break;
            run.progress = `${i + 1}/${targets.length} · ${targets[i].name}`;
            render();
            let result;
            try {
              let attempt = 0;
              for (;;) {
                result = await runOne(targets[i], messages[i]);
                if (
                  result !== "RETRYABLE" ||
                  !model.plugins.retry ||
                  attempt >= model.automation.retryCount
                )
                  break;
                /* Only navigation failures before a submission may be retried.*/ if (
                  getIntents()[intentKey(targets[i], messages[i])]
                ) {
                  result = "UNKNOWN";
                  break;
                }
                attempt++;
                run.items.get(targets[i].key).status = "PENDING";
                run.progress = `${targets[i].name}：定位失败，安全重试 ${attempt}/${model.automation.retryCount}`;
                render();
                await sleep(model.automation.retryDelaySeconds * 1000);
              }
              if (result === "RETRYABLE") result = "FAIL";
            } catch (error) {
              result = "UNKNOWN";
              const it = run.items.get(targets[i].key);
              if (it) it.status = "UNCERTAIN";
              run.progress = "发送流程出现异常，已停止后续操作";
              console.warn(
                "[Spark] batch stopped:",
                String(error?.message || error).slice(0, 120),
              );
            }
            if (result === "CONFIRMED") run.delivered++;
            else if (result === "FAIL") {
              run.failed++;
              run.progress =
                "当前聊天未发送，已停止后续操作，请检查会话或输入框";
              break;
            } else if (result === "UNKNOWN") {
              run.uncertain++;
              run.progress = "发送结果未知，已停止后续操作且不会重复发送";
              break;
            }
            if (run.aborted) break;
            if (i < targets.length - 1)
              await sleep(
                (model.plugins.pacing
                  ? Math.max(1, Math.min(30, Number(model.sendDelay) || 3))
                  : 3) * 1000,
              );
          }
          if (!run.uncertain && !run.failed)
            run.progress = `本轮结束：已确认 ${run.delivered}，未发送 ${run.failed}。`;
        } finally {
          run.sending = false;
          render();
        }
        const summary = {
          status: run.uncertain
            ? "UNKNOWN"
            : run.failed
              ? "FAILED"
              : run.aborted
                ? "STOPPED"
                : "DONE",
          confirmed: run.delivered,
          failed: run.failed,
          unknown: run.uncertain,
          selected: targets.length,
        };
        if (scheduled) void sendLocalCallback(summary);
        return summary;
      },
    );
  };
  const saveScheduledTargets = () => {
    const selected = [...run.items.keys()]
      .map((key) => run.candidates.find((c) => c.key === key))
      .filter(Boolean);
    if (!selected.length) {
      setToast("请先在「今天」勾选要定时处理的聊天");
      return;
    }
    if (selected.length > 30 || selected.some((c) => !selectable(c))) {
      setToast("名单包含群聊、重复或不适用对象，请检查");
      return;
    }
    const names = new Set(selected.map((c) => c.name));
    if (names.size !== selected.length) {
      setToast("名单存在重名，不能保存自动计划");
      return;
    }
    model.automation.targets = selected.map(({ name, type, stableId }) => ({
      name,
      type,
      stableId: stableId || null,
    }));
    save();
    setToast(`已保存 ${selected.length} 位定时对象`);
  };
  const saveManualFire = () => {
    const name = cleanName(
      panel?.querySelector("#spark-fire-name")?.value || "",
    );
    const raw = panel?.querySelector("#spark-fire-days")?.value;
    if (!name || !/^\d{1,5}$/.test(String(raw || ""))) {
      setToast("请填写昵称和 0～99999 的火花天数");
      return;
    }
    model.fireRecords[name] = {
      days: Number(raw),
      source: "MANUAL",
      at: Date.now(),
    };
    save();
    setToast("本地天数已保存，不代表官方天数");
  };
  const capturePageFire = () => {
    const n = headerName(),
      v = currentStreak(),
      days = v ? parseInt(v.days, 10) : NaN;
    if (!n || !Number.isFinite(days)) {
      setToast("当前聊天页没有可读取的官方火花天数");
      return;
    }
    model.fireRecords[n] = { days, source: "PAGE", at: Date.now() };
    save();
    setToast("已记录本次页面显示的火花天数");
  };
  const sendLocalCallback = async (summary) => {
    const a = model?.automation;
    if (
      !model?.plugins?.accounts ||
      !a?.callbackEnabled ||
      !a.accountId ||
      !a.callbackToken
    )
      return;
    const url = `http://127.0.0.1:${a.callbackPort}/done`;
    const payload = JSON.stringify({
      account: a.accountId,
      status: summary.status,
      confirmed: summary.confirmed,
      failed: summary.failed,
      unknown: summary.unknown,
      at: Date.now(),
    });
    if (typeof GM_xmlhttpRequest !== "function") return;
    try {
      GM_xmlhttpRequest({
        method: "POST",
        url,
        data: payload,
        headers: {
          "Content-Type": "application/json",
          "X-Spark-Token": a.callbackToken,
        },
        timeout: 10000,
      });
    } catch (_) {
      /* caller remains locally logged */
    }
  };
  const scheduleEligible = (a, now = new Date()) => {
    const parts = /^(\d\d):(\d\d)$/.exec(a.time || "");
    if (
      !parts ||
      !a.enabled ||
      !a.targets.length ||
      a.lastRunDay === dayNow(now)
    )
      return false;
    const from = Number(parts[1]) * 60 + Number(parts[2]),
      at = now.getHours() * 60 + now.getMinutes();
    return at >= from && at < from + a.graceMinutes;
  };
  const tickSchedule = async () => {
    if (
      run.readOnly ||
      run.scanning ||
      run.sending ||
      model.paused ||
      !model.plugins.scheduling ||
      !scheduleEligible(model.automation)
    )
      return;
    if (document.visibilityState !== "visible" || !navigator.locks?.request)
      return;
    /* Claim day once before any clicks; crashes, UNKNOWN and failures never silently replay.*/ model.automation.lastRunDay =
      dayNow();
    save();
    await scanAll();
    const list = [];
    for (const t of model.automation.targets) {
      const matching = run.candidates.filter(
        (c) =>
          c.name === t.name &&
          c.type === t.type &&
          (!t.stableId || c.stableId === t.stableId),
      );
      if (
        matching.length !== 1 ||
        matching[0].ambiguous ||
        !selectable(matching[0])
      ) {
        run.progress = `定时未执行：${t.name} 无法唯一核对`;
        render();
        void sendLocalCallback({
          status: "BLOCKED",
          confirmed: 0,
          failed: 0,
          unknown: 0,
        });
        return;
      }
      list.push(matching[0]);
    }
    for (const c of list) {
      const old = run.items.get(c.key);
      if (!old || currentStatus(old) === "PENDING")
        run.items.set(c.key, createItem(c));
    }
    await startBatch({ scheduled: true, override: list });
  };
  const onFile = async (e) => {
    if (run.readOnly) return;
    if (e.target.id !== "spark-import-file" || !e.target.files?.length) return;
    const file = e.target.files[0];
    e.target.value = "";
    try {
      run.restore = parseImport(await file.text());
      run.toast = "";
      setToast("已读取备份预览，还没有修改数据");
    } catch (err) {
      run.restore = null;
      setToast("无法读取备份：" + String(err.message).slice(0, 90));
    }
    render();
  };
  const mount = () => {
    if (document.getElementById("spark-full-root")) return;
    /* Avoid duplicate panel injection.*/ try {
      model = normalized(migrate());
      run.legacyPending = legacyTaskCounts(
        model.legacyArchive.tasks || {},
      ).pending;
      run.open = false;
      run.tab = "today";
      syncCandidates();
    } catch (e) {
      /* Fail closed: no timers/executors. Show error; do not silently erase old data.*/ model =
        {
          schema: 1,
          draft: DEFAULT_TEXT,
          materials: [],
          legacyArchive: {},
          legacySnapshotComplete: false,
          daily: {},
          manualChecks: {},
          ui: {},
          paused: true,
        };
      run.warning = "本地迁移暂未完成：" + String(e.message).slice(0, 120);
      run.readOnly = true;
    }
    host = document.createElement("div");
    host.id = "spark-full-root";
    document.body.append(host);
    shadow = host.attachShadow({ mode: "open" });
    const style = document.createElement("style");
    style.textContent = UI_CSS;
    shadow.append(style);
    chip = document.createElement("button");
    chip.className = "chip";
    chip.type = "button";
    chip.setAttribute("aria-label", "打开或收起续火助手");
    shadow.append(chip);
    panel = document.createElement("section");
    panel.className = "panel hidden";
    panel.setAttribute("aria-label", "抖音续火助手");
    shadow.append(panel);
    chip.addEventListener("click", () => {
      if (run.suppressClick) {
        run.suppressClick = false;
        return;
      }
      run.open = !run.open;
      if (run.open && !run.readOnly) run.tab = "today";
      run.drawer = "";
      render();
      if (run.open && !run.scanComplete && !run.readOnly) void scanAll();
    });
    attachDragging(chip, () => true);
    attachDragging(
      panel,
      (e) => !!e.target.closest?.(".top") && !e.target.closest?.("button"),
    );
    window.addEventListener("resize", placeFloating);
    panel.addEventListener("click", onClick);
    panel.addEventListener("input", onInput);
    panel.addEventListener("change", (e) => {
      void onChange(e);
    });
    shadow.addEventListener("keydown", (e) => {
      if (e.key === "Escape") {
        if (run.drawer) run.drawer = "";
        else run.open = false;
        render();
      }
    });
    if (run.warning) {
      run.open = true;
      run.tab = "advanced";
      run.toast = run.warning;
    }
    render();
    placeFloating();
    if (!run.readOnly) {
      setTimeout(() => {
        void tickSchedule();
      }, 2000);
      setInterval(() => {
        void tickSchedule();
      }, 15000);
    }
    /* Direct user-click send and separately opt-in advanced scheduling are the only execution entrypoints.*/ if (
      typeof GM_registerMenuCommand === "function"
    )
      GM_registerMenuCommand("打开 / 收起续火助手", () => {
        run.open = !run.open;
        run.drawer = "";
        render();
      });
  };
  if (typeof window !== "undefined" && window.__SPARK_SIMPLE_TEST_MODE__) {
    window.__SPARK_SIMPLE_TEST_HOOKS__ = {
      VERSION,
      BUILD_ID,
      NS,
      storage,
      migrate,
      normalized,
      initialData,
      parseImport,
      exportWhitelist,
      legacyTaskCounts,
      materialFrom,
      sanitize,
      disabledSettings,
      sourceIsSimple,
      dayNow,
      scanCandidates,
      conversationType,
      nameNode,
      idFromRow,
      statusFor,
      run,
      modelState: () => model,
      headerName,
      findExactly,
      msgText,
      contentFor,
      scanAll,
      snapshotOutgoing,
      scheduleEligible,
      normalizeSchedule,
      editorText,
      intentKey,
    };
    return;
  }
  if (document.readyState === "loading")
    document.addEventListener("DOMContentLoaded", mount, { once: true });
  else mount();
})();
