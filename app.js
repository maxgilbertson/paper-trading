"use strict";
// Paper trading dashboard v2 (IBKR-style portfolio). Reads data/dashboard.json (written by paper_trader.dashboard).
// Data text goes in through textContent; only the daily notes' HTML (escaped by the exporter) uses innerHTML.
// Times in the data are UK local and are shown as written. Every sentence comes from the fixed phrases in this file:
// it states what the data shows, nothing more. No bars anywhere: tables, numbers, donuts and lines only.
// Every renderer runs inside its own try/catch, and every new data field has a fallback for older files.

const SVGNS = "http://www.w3.org/2000/svg";
const MINUS = "−";
const NA = "—";
const FAIL = "This part of the page could not be drawn today.";
const START_VALUE = 1000000;
const $ = (id) => document.getElementById(id);
const arr = (x) => (Array.isArray(x) ? x : []);
const obj = (x) => (x && typeof x === "object" && !Array.isArray(x) ? x : {});
const isNum = (x) => typeof x === "number" && Number.isFinite(x);
const lower = (x) => String(x === null || x === undefined ? "" : x).toLowerCase();
const rnd = (x) => (x < 0 ? -Math.round(-x) : Math.round(x)); // halves away from zero, like the exporter
const plural = (n, one, many) => (n === 1 ? one : many);
const total = (xs) => xs.reduce((a, b) => a + b, 0);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const thousands = (n) => n.toLocaleString("en-GB");

// ------------------------------------------------------------------ number formats (one helper each)
function fmtGBP(n) { if (!isNum(n)) return NA; const r = rnd(n); return (r < 0 ? MINUS : "") + "£" + thousands(Math.abs(r)); }
function fmtSignedGBP(n) { if (!isNum(n)) return NA; const r = rnd(n); return (r > 0 ? "+" : r < 0 ? MINUS : "") + "£" + thousands(Math.abs(r)); }
function fmtCompactGBP(n) {
  if (!isNum(n)) return NA;
  const a = Math.abs(n), sign = rnd(n) < 0 ? MINUS : "";
  if (a >= 999500) return sign + "£" + (a / 1e6).toFixed(2) + "m";
  if (a >= 10000) return sign + "£" + thousands(Math.round(a / 1000)) + "k";
  return sign + "£" + thousands(Math.round(a));
}
function fmtAbout(n, step) {
  if (!isNum(n)) return NA;
  const s = step || 1000, r = Math.round(Math.abs(n) / s) * s;
  return "about " + (n < 0 && r > 0 ? MINUS : "") + "£" + thousands(r);
}
function fmt3sf(n) { if (!isNum(n)) return NA; const a = Number(Math.abs(n).toPrecision(3)); return (n < 0 && a > 0 ? MINUS : "") + "£" + thousands(a); }
function fmtChangePct(x) {
  if (!isNum(x)) return NA;
  if (x === 0) return "0.00%";
  const a = Math.abs(x);
  if (a < 0.00005) return "under 0.01%";
  const p = a * 100;
  let s = p < 9.995 ? p.toFixed(2) : p.toFixed(1);
  if (Number(s) >= 1000) s = thousands(Number(s));
  return (x > 0 ? "+" : MINUS) + s + "%";
}
function fmtShare(x) { if (!isNum(x)) return NA; const s = (Math.abs(x) * 100).toFixed(1); return (x < 0 && Number(s) !== 0 ? MINUS : "") + s + "%"; }
const fmtMult = (x) => (isNum(x) ? Math.abs(x).toFixed(1) + "×" : NA);
function fmtPrice(p) {
  if (!isNum(p)) return NA;
  const a = Math.abs(p);
  const dec = a > 0 ? clamp(5 - Math.floor(Math.log10(a)), 2, 8) : 2;
  let [i, f = ""] = a.toFixed(dec).split(".");
  while (f.length > 2 && f.endsWith("0")) f = f.slice(0, -1);
  return (p < 0 ? MINUS : "") + thousands(Number(i)) + "." + f;
}
function fmtSignal(v) { if (!isNum(v)) return NA; const s = Math.abs(v).toFixed(1); if (Number(s) === 0) return "0.0"; return (v > 0 ? "+" : MINUS) + s; }
const fmtRatio = (v) => { if (!isNum(v)) return NA; const s = Math.abs(v).toFixed(2); return (v < 0 && Number(s) !== 0 ? MINUS : "") + s; };
const fmtQty = (q) => (isNum(q) ? Math.abs(q).toLocaleString("en-GB", { maximumFractionDigits: 2 }) : "");
const UNIT_WORDS = { USD: "US dollars", USc: "US cents", EUR: "euros", GBP: "pounds", GBp: "pence" };
const unitWords = (u) => UNIT_WORDS[u] || "";

// ------------------------------------------------------------------ dates and times (UK-local strings, read as written)
const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
let GEN_YEAR = null;
const ISO_RE = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2}))?/;
const dateOf = (iso) => String(iso).slice(0, 10);
const fmtTime = (iso) => String(iso).slice(11, 16);
function dayUTC(iso) { const [y, m, d] = dateOf(iso).split("-").map(Number); return new Date(Date.UTC(y, m - 1, d)); }
function validIso(s) {
  const m = typeof s === "string" ? ISO_RE.exec(s) : null;
  if (!m) return false;
  const mo = Number(m[2]), da = Number(m[3]);
  return mo >= 1 && mo <= 12 && da >= 1 && da <= 31 && !isNaN(dayUTC(s).getTime());
}
const hasTime = (s) => validIso(s) && ISO_RE.exec(s)[4] !== undefined;
const validMonth = (s) => typeof s === "string" && /^\d{4}-(0[1-9]|1[0-2])$/.test(s);
function fmtDate(iso, withYear) {
  const t = dayUTC(iso);
  const s = `${DAYS[t.getUTCDay()]} ${t.getUTCDate()} ${MONTHS[t.getUTCMonth()]}`;
  return withYear || (GEN_YEAR && t.getUTCFullYear() !== GEN_YEAR) ? `${s} ${t.getUTCFullYear()}` : s;
}
const whenText = (iso) => (hasTime(iso) ? `${fmtDate(iso)}, ${fmtTime(iso)}` : fmtDate(iso));
const fmtDayMonth = (iso) => { const t = dayUTC(iso); return `${t.getUTCDate()} ${MONTHS[t.getUTCMonth()]}`; };
function fmtMonth(ym) { const m = /^(\d{4})-(\d{2})/.exec(String(ym || "")); return m ? `${MONTHS[Number(m[2]) - 1]} ${m[1]}` : ""; }
const isWeekday = (iso) => { const w = dayUTC(iso).getUTCDay(); return w >= 1 && w <= 5; };
function tsec(iso) {
  const s = String(iso);
  const [y, m, d] = s.slice(0, 10).split("-").map(Number);
  const [hh = 0, mm = 0, ss = 0] = s.length > 11 ? s.slice(11, 19).split(":").map(Number) : [];
  return Date.UTC(y, m - 1, d, hh || 0, mm || 0, ss || 0) / 1000;
}
const isoDay = (t) => t.toISOString().slice(0, 10);
function addWeekdays(iso, n) {
  if (!validIso(iso) || !isNum(n) || n < 0) return null;
  let t = dayUTC(iso), k = 0;
  for (let it = 0; k < n && it < n * 2 + 14; it++) { t = new Date(t.getTime() + 864e5); const w = t.getUTCDay(); if (w >= 1 && w <= 5) k++; }
  return k < n ? null : isoDay(t);
}
function weekdaysBetween(a, b) {
  if (!validIso(a) || !validIso(b)) return 0;
  let t = dayUTC(a), k = 0;
  const end = dayUTC(b).getTime();
  for (let it = 0; t.getTime() < end && it < 40000; it++) { t = new Date(t.getTime() + 864e5); const w = t.getUTCDay(); if (w >= 1 && w <= 5) k++; }
  return k;
}
function addMinutes(hhmm, mins) { const [h, m] = hhmm.split(":").map(Number); return new Date(Date.UTC(1970, 0, 1, h, m + mins)).toISOString().slice(11, 16); }
function ukNow() {
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false }).formatToParts(new Date()).map((x) => [x.type, x.value]));
  return { iso: `${p.year}-${p.month}-${p.day}T${p.hour === "24" ? "00" : p.hour}:${p.minute}` };
}
function lastExpected(hhmm, graceMin) {
  const now = ukNow();
  let d = new Date(now.iso.slice(0, 10) + "T00:00:00Z");
  const due = addMinutes(hhmm, graceMin);
  for (let i = 0; i < 8; i++) {
    const wd = d.getUTCDay(), iso = d.toISOString().slice(0, 10);
    if (wd >= 1 && wd <= 5 && (i > 0 || now.iso.slice(11, 16) >= due)) return `${iso}T${hhmm}`;
    d = new Date(d.getTime() - 864e5);
  }
  return null;
}
const hoursAgo = (iso) => (tsec(ukNow().iso) - tsec(iso)) / 3600;
// "today" before 16:05 on a weekday; otherwise the next weekday's date
function nextRunWhen() {
  const now = ukNow(), today = now.iso.slice(0, 10);
  if (isWeekday(today) && now.iso.slice(11, 16) < "16:05") return "today";
  const nx = addWeekdays(today, 1);
  return nx ? "on " + fmtDate(nx) : "at the next daily run";
}

// ------------------------------------------------------------------ names, classes, colours
function shortName(name) {
  const n = String(name || "");
  if (/^World shares fund/.test(n)) return "World shares fund";
  let m = /^(.*) vs US dollar$/.exec(n);
  if (m) return m[1];
  m = /^[^:]+: (.+)$/.exec(n);
  if (m) return m[1];
  m = /^(.*) government bonds(?: \(gilts\))?$/.exec(n);
  if (m) return m[1] + " bonds";
  return n;
}
const isFundName = (name) => /^World shares fund/.test(String(name || ""));
const slugOf = (name) => shortName(name).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
const RING = ["World fund", "Bonds", "Shares", "Currencies", "Commodities", "Other"];
const CLS_KEY = { "World fund": "fund", Bonds: "bonds", Shares: "shares", Currencies: "currencies", Commodities: "commodities", Other: "other" };
const SLOT = { "World fund": 5, Bonds: 1, Shares: 2, Currencies: 3, Commodities: 4 };
const UNSAFE = new Set(["2-4", "2-5", "3-5"]);
const ringRank = (c) => { const i = RING.indexOf(c); return i < 0 ? 99 : i; };
function clsOf(group, key, name) {
  if (key === "BETA" || group === "World fund" || isFundName(name)) return "World fund";
  if (group === "Metals" || group === "Energy" || group === "Farm goods" || group === "Commodities") return "Commodities";
  if (group === "Bonds" || group === "Shares" || group === "Currencies") return group;
  return "Other";
}
const verbAre = (c) => (c === "World fund" ? "is" : "are");
// the ring's touching slot pairs, seam included; a ring with an unsafe neighbour pair is never drawn
function ringSafe(classes) {
  const slots = classes.map((c) => SLOT[c]).filter(Boolean);
  if (slots.length < 3) return true;
  for (let i = 0; i < slots.length; i++) {
    const a = slots[i], b = slots[(i + 1) % slots.length];
    if (UNSAFE.has(Math.min(a, b) + "-" + Math.max(a, b))) return false;
  }
  return true;
}
const CCY = [{ id: "USD", label: "US dollars", key: "bonds" }, { id: "EUR", label: "euros", key: "shares" }, { id: "GBP", label: "pounds", key: "currencies" }];

// ------------------------------------------------------------------ DOM helpers
function el(tag, attrs, ...kids) {
  const e = document.createElement(tag);
  if (attrs) for (const [k, v] of Object.entries(attrs)) {
    if (v === null || v === undefined || v === false) continue;
    if (k === "class") e.className = v; else e.setAttribute(k, v === true ? "" : String(v));
  }
  for (const k of kids.flat(3)) if (k !== null && k !== undefined && k !== false && k !== "") e.append(k instanceof Node ? k : document.createTextNode(String(k)));
  return e;
}
function svgEl(tag, attrs) {
  const e = document.createElementNS(SVGNS, tag);
  for (const [k, v] of Object.entries(attrs || {})) if (v !== null && v !== undefined) e.setAttribute(k, String(v));
  return e;
}
function svgText(attrs, text) { const t = svgEl("text", attrs); t.textContent = text; return t; }
const ICONS = {
  info: (s) => { s.append(svgEl("circle", { cx: 12, cy: 12, r: 9.25 }), svgEl("path", { d: "M12 11v5.5" }), svgEl("circle", { cx: 12, cy: 7.6, r: 1.15, class: "fillc" })); },
  check: (s) => { s.append(svgEl("path", { d: "M5 12.5l4.5 4.5L19 7.5" })); },
  cross: (s) => { s.append(svgEl("path", { d: "M7 7l10 10M17 7L7 17" })); },
  warn: (s) => { s.append(svgEl("path", { d: "M12 6v8" }), svgEl("circle", { cx: 12, cy: 18.2, r: 1.3, class: "fillc" })); },
  half: (s) => { s.append(svgEl("circle", { cx: 12, cy: 12, r: 8 }), svgEl("path", { d: "M12 4a8 8 0 0 1 0 16z", class: "fillc" })); },
  dots: (s) => { for (const x of [6, 12, 18]) s.append(svgEl("circle", { cx: x, cy: 12, r: 1.6, class: "fillc" })); },
  dash: (s) => { s.append(svgEl("path", { d: "M7 12h10" })); },
  question: (s) => { s.append(svgEl("path", { d: "M9.2 9.3a2.9 2.9 0 1 1 4.1 2.6c-.8.4-1.3 1-1.3 1.9v.6" }), svgEl("circle", { cx: 12, cy: 18, r: 1.2, class: "fillc" })); },
  close: (s) => { s.append(svgEl("path", { d: "M7 7l10 10M17 7L7 17" })); },
};
function icon(name, size) {
  const s = svgEl("svg", { width: size || 16, height: size || 16, viewBox: "0 0 24 24", "aria-hidden": "true", focusable: "false", class: "ic ic-" + name });
  (ICONS[name] || ICONS.info)(s);
  return s;
}
const moneyCls = (n) => (!isNum(n) ? "" : rnd(n) > 0 ? "gain" : rnd(n) < 0 ? "loss" : "");
function moneySpan(n, fmt, extra) {
  if (!isNum(n)) return el("span", { class: "na" + (extra ? " " + extra : "") }, NA);
  return el("span", { class: ["amt", moneyCls(n), extra].filter(Boolean).join(" ") }, (fmt || fmtSignedGBP)(n));
}
function infoDetails(summary, body, cls) {
  const dt = el("details", { class: "info" + (cls ? " " + cls : "") });
  dt.append(el("summary", null, icon("info", 18), el("span", null, summary)));
  const b = el("div", { class: "info-body" });
  for (const x of arr(body).flat(2)) if (x) b.append(typeof x === "string" ? el("p", null, x) : x);
  dt.append(b);
  return dt;
}
function swatch(key) { return el("span", { class: "sw sw-" + key, "aria-hidden": "true" }); }
let measureCtx = null;
function textWidth(s, font) {
  try {
    measureCtx = measureCtx || document.createElement("canvas").getContext("2d");
    measureCtx.font = font || "500 14px Inter, system-ui, sans-serif";
    return measureCtx.measureText(String(s)).width;
  } catch (e) { return String(s).length * 8; }
}
const isPhone = () => window.matchMedia("(max-width: 699.98px)").matches;
const isDesk = () => window.matchMedia("(min-width: 1000px)").matches;
function posText(h) { if (!h || !h.dir || h.qty === null) return NA; return (h.dir === "long" ? "Long +" : "Short " + MINUS) + fmtQty(h.qty) + (h.isFund ? " shares" : ""); }
function posNode(h) {
  if (!h || !h.dir || h.qty === null) return el("span", { class: "na" }, NA);
  return el("span", { class: "pos" }, el("span", { class: "gl", "aria-hidden": "true" }, h.dir === "long" ? "▲" : "▼"), " " + posText(h));
}
function chipBtn(label, count, pressed, onClick) {
  const b = el("button", { type: "button", class: "chip", "aria-pressed": String(!!pressed) }, el("span", { class: "ck", "aria-hidden": "true" }, icon("check", 15)), label, count !== null && count !== undefined ? el("span", { class: "cnt" }, ` (${count})`) : null);
  b.addEventListener("click", onClick);
  return b;
}
function segmented(label, options, current, onPick) {
  const g = el("div", { class: "seg", role: "group", "aria-label": label });
  for (const o of options) {
    const b = el("button", { type: "button", "aria-pressed": String(o.id === current), disabled: o.disabled ? true : null }, o.label);
    b.addEventListener("click", () => { if (!o.disabled) onPick(o.id); });
    g.append(b);
  }
  return g;
}
function selectBox(id, label, options, current, onPick) {
  const s = el("select", { id });
  for (const o of options) s.append(el("option", { value: o.id, selected: o.id === current ? true : null }, o.label));
  s.addEventListener("change", () => onPick(s.value));
  return el("div", { class: "sel-wrap" }, el("label", { for: id }, label), s);
}
function sortHeader(col, state, onSort, extraCls) {
  const sorted = state.key === col.k;
  const th = el("th", { scope: "col", class: [col.num ? "num" : "", col.cls || "", extraCls || ""].filter(Boolean).join(" ") || null, "aria-sort": sorted ? (state.dir === "asc" ? "ascending" : "descending") : null });
  const b = el("button", { type: "button", class: "sort" },
    el("span", { class: "h1l" }, col.h, sorted ? el("span", { class: "si", "aria-hidden": "true" }, state.dir === "asc" ? "▲" : "▼") : null),
    col.h2 ? el("span", { class: "h2l" }, col.h2) : null);
  b.addEventListener("click", () => onSort(col.k));
  th.append(b);
  return th;
}

// ------------------------------------------------------------------ per-viewer conveniences (localStorage, optional)
const STORE = "pt.ui.v2";
const UI = {
  donut: null, figure: "pnl", group: true, range: "All",
  hold: { filter: "all", key: null, dir: "desc", open: null },
  sig: { filter: "all", key: "signal", dir: "asc", open: null },
  orders: { day: "all" },
  contribAll: false, monthlyAll: false, riskPin: null, ccyPin: null,
};
function loadUI() {
  try { window.localStorage.removeItem("pt.open.v1"); } catch (e) { /* storage unavailable */ }
  try {
    const v = JSON.parse(window.localStorage.getItem(STORE) || "{}");
    if (!v || typeof v !== "object") return;
    if (["face", "risk", "ccy"].includes(v.donut)) UI.donut = v.donut;
    if (typeof v.figure === "string" && FIGS[v.figure]) UI.figure = v.figure;
    if (typeof v.group === "boolean") UI.group = v.group;
    if (["1W", "1M", "3M", "YTD", "All"].includes(v.range)) UI.range = v.range;
  } catch (e) { /* storage unavailable: the page works, it just forgets */ }
}
function saveUI() {
  try { window.localStorage.setItem(STORE, JSON.stringify({ donut: UI.donut || undefined, figure: UI.figure, group: UI.group, range: UI.range })); } catch (e) { /* storage unavailable */ }
}

// ------------------------------------------------------------------ orders: status kinds and words
const KINDS = new Set(["filled", "held", "notfilled", "partly", "nofill", "awaiting", "unknown"]);
function orderKind(t, snapOk) {
  const s = String(t.status || "").trim();
  const br = /\(([^)]*)\)/.exec(s);
  const reason = br ? br[1] : "";
  let kind = KINDS.has(t.status_kind) ? t.status_kind : null;
  if (!kind) {
    if (/^filled$/i.test(s)) kind = "filled";
    else if (/^not sent/i.test(s)) kind = /market (had |has |was |is )?closed/i.test(reason) ? "held" : "notfilled";
    else if (/^not filled/i.test(s)) kind = "notfilled";
    else if (/^partly filled/i.test(s)) kind = "partly";
    else if (/^no fill recorded/i.test(s)) kind = "nofill";
    else if (/^sent, fill not yet confirmed/i.test(s)) kind = snapOk && t.time && String(t.time) < snapOk ? "nofill" : "awaiting";
    else kind = "unknown";
  }
  const out = { kind, reason: kind === "held" ? "" : reason };
  if (kind === "partly") {
    const m = /([\d.,]+)\s+of\s+([\d.,]+)/.exec(reason);
    out.filledQty = m ? Number(m[1].replace(/,/g, "")) : null;
    out.orderQty = m ? Number(m[2].replace(/,/g, "")) : null;
  }
  return out;
}
const wentThrough = (st) => st.kind === "filled" || st.kind === "partly";
function statusWords(o) {
  const st = o.st;
  switch (st.kind) {
    case "filled": return ["check", "Filled"];
    case "held": return ["info", "Held back: market closed (goes at the next run)"];
    case "notfilled": return ["cross", "Not filled" + (st.reason ? ": " + st.reason : "")];
    case "partly": return ["half", "Partly filled" + (st.reason ? ` (${st.reason})` : "")];
    case "awaiting": return ["dots", "Awaiting fill"];
    case "nofill": return ["dash", "No fill recorded"];
    default: return ["question", "Outcome not recorded"];
  }
}
function statusNode(o, withPrice) {
  const [ic, words] = statusWords(o);
  const text = withPrice && o.st.kind === "filled" && isNum(o.price) ? `Filled at ${fmtPrice(o.price)}` : words;
  return el("span", { class: "ost k-" + o.st.kind }, icon(ic, 16), el("span", null, text));
}
function countWords(c, n) {
  let s = c.filled === n ? (n === 1 ? "1 order filled" : `all ${n} orders filled`) : `${c.filled} of ${n} ${plural(n, "order", "orders")} filled`;
  if (c.held) s += `, ${c.held} held back`;
  if (c.notfilled) s += `, ${c.notfilled} not filled`;
  if (c.partly) s += `, ${c.partly} partly filled`;
  if (c.awaiting) s += `, ${c.awaiting} awaiting fill`;
  return s;
}
function runCountText(c, n) {
  const head = `${n} ${plural(n, "order", "orders")}`;
  if (c.filled === n) return head + (n === 1 ? ", filled" : ", all filled");
  return head + ": " + [`${c.filled} filled`, c.held ? `${c.held} held back` : null, c.notfilled ? `${c.notfilled} not filled` : null, c.partly ? `${c.partly} partly filled` : null, c.awaiting ? `${c.awaiting} awaiting fill` : null].filter(Boolean).join(", ");
}
const VERB_BACK = { buy: "Bought", sell: "Sold", add: "Added", reduce: "Reduced", open: "Opened", close: "Closed", closed: "Closed", switch: "Switched", move: "Moved" };
const VERB_TO = { Bought: "buy", Sold: "sell", Added: "add", Reduced: "reduce", Opened: "open", Closed: "close", Switched: "switch", Moved: "move" };
function intendedWhy(why, st) {
  const w = String(why || "");
  if (!w || /^Intended to /.test(w) || !["awaiting", "nofill", "notfilled", "held"].includes(st.kind)) return w;
  const m = /^(\S+) (.*)$/.exec(w);
  return m && VERB_TO[m[1]] ? `Intended to ${VERB_TO[m[1]]} ${m[2]}` : w;
}
const strengthNum = (v) => (Math.abs(v) < 1 ? "under 1" : String(Math.round(Math.abs(v))));
function plainWhy(why) {
  return String(why || "")
    .replace(/the signal \(([+-]?\d+(?:\.\d+)?)\) is too weak/g, (m, v) => `strength ${strengthNum(Number(v))} of 20 at the time is too weak`)
    .replace(/\(signal ([+-]?\d+(?:\.\d+)?)\)/g, (m, v) => `(strength ${strengthNum(Number(v))} of 20 at the time)`)
    .replace(/(^|[\s(])-(\d)/g, (m, a, b) => a + MINUS + b);
}

// ------------------------------------------------------------------ derive: computed once, read by every renderer
function emptyDerived(d) {
  const s = obj(d && d.stats);
  return {
    stats: s, perf: obj(d && d.performance), health: obj(d && d.health), risk: obj(d && d.risk), wf: obj(d && d.world_fund),
    nav: isNum(s.nav) && s.nav > 0 ? s.nav : null,
    rm: d && d.risk_model && typeof d.risk_model === "object" ? d.risk_model : null,
    rmAbsent: !(d && typeof d === "object" && "risk_model" in d),
    holdings: [], hByKey: {}, fund: null, swingAll: false, classes: [], cByName: {}, tot: null, posFile: false,
    signals: [], sByKey: {}, noBet: [], slugByKey: {},
    trades: [], runs: [], days: [], R: null, snapOk: null, problems: [], infos: [],
  };
}
function derive(d) {
  const D = emptyDerived(d);
  const step = (name, fn) => { try { fn(); } catch (e) { console.error("derive " + name, e); } };
  step("holdings", () => {
    const raw = arr(d.positions).filter((p) => p && typeof p === "object" && (p.name || p.key));
    const signedData = raw.some((p) => isNum(p.quantity) && p.quantity < 0);
    const sigName = {};
    for (const s of arr(d.signals)) if (s && s.key && s.name) sigName[s.key] = s.name;
    D.holdings = raw.map((p) => {
      const key = typeof p.key === "string" && p.key ? p.key : null;
      const name = typeof p.name === "string" && p.name.trim() ? p.name : (key && sigName[key]) || (key === "BETA" ? "World shares fund" : "Unnamed market");
      const isFund = key === "BETA" || isFundName(name);
      let dir = lower(p.direction);
      dir = dir === "long" || dir === "short" ? dir : null;
      if (!dir && isFund) dir = "long";
      if (!dir && signedData && isNum(p.quantity) && p.quantity !== 0) dir = p.quantity < 0 ? "short" : "long";
      const qty = isNum(p.quantity) ? Math.abs(p.quantity) : null;
      return {
        p, key, name, short: shortName(name), isFund, dir, qty, sq: qty === null ? null : dir === "short" ? -qty : qty,
        group: typeof p.group === "string" ? p.group : null, cls: clsOf(p.group, key, name),
        exp: isNum(p.exposure_gbp) ? Math.abs(p.exposure_gbp) : null,
        pnl: isNum(p.pnl_gbp) ? p.pnl_gbp : null,
        day: isNum(p.day_pnl_gbp) ? p.day_pnl_gbp : null,
        swing: isNum(p.swing_gbp) && p.swing_gbp >= 0 ? p.swing_gbp : null,
        posSignal: isFund ? null : isNum(p.signal) ? p.signal : null,
        month: validMonth(p.month) ? p.month : null,
        unit: typeof p.unit === "string" ? p.unit : null,
        ccy: typeof p.ccy === "string" && p.ccy ? p.ccy : p.unit === "USc" ? "USD" : typeof p.unit === "string" && p.unit ? p.unit : null,
        last: isNum(p.last_price) ? p.last_price : null,
        avg: isNum(p.avg_price) ? p.avg_price : null,
        after: isNum(p.risk_share_after) ? p.risk_share_after : null,
        share: null, sig: null, slug: null,
      };
    });
    for (const h of D.holdings) if (h.key) D.hByKey[h.key] = h;
    D.fund = D.holdings.find((h) => h.isFund) || null;
    D.posFile = validIso(d.positions_date) || D.holdings.length > 0;
    const withSwing = D.holdings.filter((h) => h.swing !== null);
    D.swingAll = D.holdings.length > 0 && withSwing.length === D.holdings.length;
    const sw = total(withSwing.map((h) => h.swing));
    for (const h of D.holdings) h.share = h.swing !== null && sw > 0 ? h.swing / sw : null;
  });
  step("signals", () => {
    D.signals = arr(d.signals).filter((s) => s && typeof s === "object" && typeof s.key === "string" && s.key && s.key !== "BETA" && typeof s.name === "string" && s.name.trim() && isNum(s.signal)).map((s) => ({
      key: s.key, name: s.name, short: shortName(s.name), group: s.group || null, cls: clsOf(s.group, s.key, s.name),
      signal: s.signal, trend: isNum(s.trend) ? s.trend : null, carry: isNum(s.carry) ? s.carry : null,
      carryUsed: s.carry_used !== false && isNum(s.carry), cswing: isNum(s.contract_swing_gbp) ? s.contract_swing_gbp : null,
      hasCswing: isNum(s.contract_swing_gbp), held: null, slug: null,
    }));
    for (const s of D.signals) { D.sByKey[s.key] = s; s.held = D.hByKey[s.key] || null; }
    for (const h of D.holdings) { h.sig = h.key ? D.sByKey[h.key] || null : null; h.signal = h.isFund ? null : h.posSignal !== null ? h.posSignal : h.sig ? h.sig.signal : null; }
    D.noBet = D.signals.filter((s) => !s.held);
    // name slugs for deep links: signals[] order first; a repeat gets -2, -3 ...
    const used = new Set();
    const addSlug = (id, name) => {
      if (D.slugByKey[id]) return D.slugByKey[id];
      const base = slugOf(name) || "market";
      let sl = base;
      for (let k = 2; used.has(sl); k++) sl = `${base}-${k}`;
      used.add(sl);
      D.slugByKey[id] = sl;
      return sl;
    };
    for (const s of D.signals) s.slug = addSlug(s.key, s.name);
    for (const h of D.holdings) h.slug = addSlug(h.key || "name:" + h.name, h.name);
  });
  step("classes", () => {
    const m = new Map();
    for (const h of D.holdings) { if (!m.has(h.cls)) m.set(h.cls, []); m.get(h.cls).push(h); }
    const bca = D.rm ? obj(D.rm.by_class_after) : {};
    D.classes = RING.filter((c) => m.has(c)).map((c) => {
      const items = m.get(c);
      return {
        cls: c, key: CLS_KEY[c], items, n: items.length,
        nLong: items.filter((h) => h.dir === "long").length, nShort: items.filter((h) => h.dir === "short").length,
        face: total(items.map((h) => h.exp || 0)),
        pnl: items.some((h) => h.pnl !== null) ? total(items.map((h) => h.pnl || 0)) : null,
        day: items.every((h) => h.day !== null) ? total(items.map((h) => h.day)) : null,
        swing: D.swingAll ? total(items.map((h) => h.swing)) : null,
        share: D.swingAll ? total(items.map((h) => h.share)) : null,
        after: isNum(bca[c]) ? bca[c] : items.every((h) => h.after !== null) ? total(items.map((h) => h.after)) : null,
      };
    });
    const face = total(D.classes.map((c) => c.face));
    for (const c of D.classes) { c.faceShare = face > 0 ? c.face / face : null; D.cByName[c.cls] = c; }
    const H = D.holdings;
    D.tot = {
      n: H.length, face, pnl: H.some((h) => h.pnl !== null) ? total(H.map((h) => h.pnl || 0)) : null,
      day: H.length && H.every((h) => h.day !== null) ? total(H.map((h) => h.day)) : null,
      nLong: H.filter((h) => h.dir === "long").length, nShort: H.filter((h) => h.dir === "short").length,
    };
  });
  step("orders", () => {
    const sn = obj(D.health.snapshot);
    D.snapOk = lower(sn.status) === "ok" && sn.time ? String(sn.time) : null;
    const byName = {}, nameByKey = {};
    for (const h of D.holdings) if (h.key) { byName[h.name] = h.key; nameByKey[h.key] = h.name; }
    for (const s of D.signals) { byName[s.name] = s.key; nameByKey[s.key] = nameByKey[s.key] || s.name; }
    const wfo = obj(D.wf.last_order);
    D.trades = arr(d.trades).filter((t) => t && typeof t === "object" && hasTime(t.time)).map((t, i) => {
      const rawName = typeof t.name === "string" && t.name.trim() ? t.name : null;
      const key = (typeof t.key === "string" && t.key) || (isFundName(rawName) ? "BETA" : byName[rawName] || null);
      const name = rawName || (key && nameByKey[key]) || (key === "BETA" ? "World shares fund" : "Unnamed market");
      const isFund = key === "BETA" || isFundName(name);
      const st = orderKind(t, D.snapOk);
      let value = isNum(t.value_gbp) ? Math.abs(t.value_gbp) : null;
      if (isFund && value === null && wfo.time === t.time && isNum(wfo.value_gbp)) value = Math.abs(wfo.value_gbp);
      if (isFund && value === null && st.kind === "filled" && isNum(t.price) && isNum(t.quantity)) value = Math.abs(t.price * t.quantity);
      return {
        t, i, key, isFund, st, name, short: shortName(name), value,
        action: t.action === "Buy" || t.action === "Sell" ? t.action : null,
        qty: isNum(t.quantity) ? Math.abs(t.quantity) : null, price: isNum(t.price) ? t.price : null,
        month: validMonth(t.month) ? t.month : null, time: t.time, sec: tsec(t.time),
      };
    });
    const sorted = D.trades.slice().sort((a, b) => (a.sec - b.sec) || (b.i - a.i));
    const runs = [], byKey = new Map();
    let prevO = null, prevRun = null;
    for (const o of sorted) {
      const rk = hasTime(o.t.run) ? o.t.run : null;
      let run = rk !== null ? byKey.get(rk) || null : prevRun && o.sec - prevO.sec <= 120 && dateOf(o.time) === prevRun.date ? prevRun : null;
      if (!run) {
        run = { runKey: rk, start: rk || o.time, orders: [] };
        run.date = dateOf(run.start);
        runs.push(run);
        if (rk !== null) byKey.set(rk, run);
      }
      run.orders.push(o);
      prevO = o; prevRun = run;
    }
    for (const r of runs) {
      r.orders.sort((a, b) => a.i - b.i);
      const hm = fmtTime(r.start);
      r.label = r.date === d.start_date && hm < "15:50" ? "Set-up run" : isWeekday(r.date) && hm >= "15:50" && hm <= "16:59" ? "Daily run" : "Extra run";
      r.c = { filled: 0, held: 0, notfilled: 0, partly: 0, awaiting: 0 };
      for (const o of r.orders) {
        const k = o.st.kind;
        if (k === "filled") r.c.filled++; else if (k === "held") r.c.held++; else if (k === "partly") r.c.partly++; else if (k === "awaiting") r.c.awaiting++; else r.c.notfilled++;
      }
      r.lastSec = Math.max(...r.orders.map((o) => o.sec));
    }
    for (const r of runs) {
      if (r.label !== "Extra run" || !isWeekday(r.date) || fmtTime(r.start) < "17:00") continue;
      if (!runs.some((o) => o !== r && o.date === r.date && o.label === "Daily run" && o.start < r.start)) r.label = "Late daily run";
    }
    runs.sort((a, b) => (a.start < b.start ? 1 : a.start > b.start ? -1 : 0));
    D.runs = runs;
    D.R = runs[0] || null;
    for (const r of runs) {
      let day = D.days.find((x) => x.date === r.date);
      if (!day) D.days.push((day = { date: r.date, runs: [] }));
      day.runs.push(r);
    }
  });
  step("status", () => { const r = statusItems(d, D); D.problems = r.problems; D.infos = r.infos; });
  return D;
}

// ------------------------------------------------------------------ status: problems (counted) and info notes (never counted)
const sameMarket = (a, b) => (a.key && b.key ? a.key === b.key : a.name === b.name);
function verbOf(o) { return o.action === "Sell" ? "sell" : o.action === "Buy" ? "buy" : null; }
function orderWhat(o) {
  const v = verbOf(o);
  return v ? `order to ${v}${o.qty !== null ? " " + fmtQty(o.qty) : ""}` : "order";
}
function fundWhat(o, cap) {
  const w = o.action === "Sell" ? "sale" : o.action === "Buy" ? "purchase" : "order";
  return `${cap ? "World shares fund" : "World fund"} ${w}` + (o.value !== null ? ` (${fmtAbout(o.value)})` : "");
}
function outcomeText(st) {
  switch (st.kind) {
    case "notfilled": return "not filled" + (st.reason ? ": " + st.reason : "");
    case "partly": return "only partly filled" + (st.reason ? ` (${st.reason})` : "");
    case "nofill": return "no fill recorded";
    default: return "outcome not recorded";
  }
}
function statusItems(d, D) {
  const P = [], I = [];
  const add = (level, order, text, full) => P.push({ level, order, text, full: full || null });
  const gen = validIso(d.generated) ? d.generated : null;
  const latestDue = [lastExpected("16:05", 90), lastExpected("21:35", 90)].filter(Boolean).sort().pop();
  const stale = !!(gen && latestDue && gen.slice(0, 16) < latestDue);
  if (stale) add("warn", 1, `Page not updated since ${whenText(gen)}: figures may be out of date.`, `This page has not updated since ${whenText(gen)}. The trading computer may be off, so the figures may be out of date.`);
  const job = (j, at, base, txt) => {
    if (!j || !hasTime(j.time)) return;
    const st = lower(j.status), t = j.time;
    if (st === "running") { if (hoursAgo(t) > 2) add("bad", base + 1, txt.unfinished(t)); return; }
    if (st === "skipped") return;
    if (st !== "ok") { add("bad", base, txt.problem(t)); return; }
    if (stale) return;
    const due = lastExpected(at, 45);
    if (due && t.slice(0, 16) < due) add("warn", base + 2, txt.late(t, due, addMinutes(at, 45)));
  };
  job(D.health.trade, "16:05", 2, {
    problem: (t) => `The daily run on ${fmtDate(t)} reported a problem (last attempt ended ${fmtTime(t)}).`,
    unfinished: (t) => `The daily run that started ${fmtDate(t)} at ${fmtTime(t)} did not finish.`,
    late: (t, due, by) => `No daily run since ${fmtDate(t)}. One was due by ${by} on ${fmtDate(due)}.`,
  });
  job(D.health.snapshot, "21:35", 5, {
    problem: (t) => `The closing-value snapshot on ${fmtDate(t)} at ${fmtTime(t)} reported a problem.`,
    unfinished: (t) => `The closing-value snapshot that started ${fmtDate(t)} at ${fmtTime(t)} did not finish.`,
    late: (t, due, by) => `No closing value recorded since ${fmtDate(t)}. One was due by ${by} on ${fmtDate(due)}.`,
  });
  const hb = obj(D.health.trade), R = D.R;
  const superseded = !!(R && hasTime(hb.time) && lower(hb.status) === "ok" && dateOf(hb.time) > R.date);
  const when = nextRunWhen();
  let awaitingN = 0, runTime = null;
  if (R && !superseded) {
    const held = [], awaiting = [];
    for (const o of R.orders) {
      const k = o.st.kind;
      if (k === "held") {
        const prevRun = D.runs.find((r) => r.start < R.start && r.orders.some((x) => sameMarket(x, o)));
        const prevO = prevRun ? prevRun.orders.find((x) => sameMarket(x, o)) : null;
        if (prevO && prevO.st.kind === "held") add("warn", 8, o.isFund ? `${fundWhat(o, true)} held back at 2 runs in a row because the market had closed both times.` : `${o.short}: order held back at 2 runs in a row because the market had closed both times.`);
        else held.push(o);
      } else if (k === "notfilled" || k === "partly" || k === "nofill" || k === "unknown") {
        add("warn", 8, o.isFund ? `${fundWhat(o, true)} ${outcomeText(o.st)}.` : `${o.short}: ${orderWhat(o)} ${outcomeText(o.st)}.`);
      } else if (k === "awaiting") awaiting.push(o);
    }
    const goes = when === "today" ? "16:05 today" : `16:05 ${when}`;
    if (held.length > 3) {
      I.push({ short: `${held.length} orders held back (markets closed); they go at ${goes}.`, full: `${held.length} orders held back because their markets had closed. They go at the next daily run, about 16:05 ${when}.` });
    } else for (const o of held) {
      if (o.isFund) I.push({ short: `${fundWhat(o)} held back (market closed); goes at ${goes}.`, full: `${fundWhat(o)} held back: the London market had closed. It goes at the next daily run, about 16:05 ${when}.` });
      else I.push({ short: `${o.short}: ${orderWhat(o)} held back (market closed); goes at ${goes}.`, full: `${o.short}: ${orderWhat(o)} held back: the market had closed. It goes at the next daily run, about 16:05 ${when}.` });
    }
    awaitingN = awaiting.length;
    runTime = fmtTime(R.start);
  }
  const mc = obj(D.stats.missed_close);
  if (validIso(mc.date)) {
    const st = hasTime(mc.standin_time) ? mc.standin_time : null;
    const tail = st ? `; the ${fmtDate(st)} ${fmtTime(st)} reading stands in.` : ".";
    I.push({ short: `${fmtDate(mc.date)} close missed${tail}`, full: `${fmtDate(mc.date)}'s 21:35 closing value was missed${tail}` });
  }
  if (awaitingN > 0) {
    I.push({ short: `${awaitingN} ${plural(awaitingN, "order", "orders")} from the ${runTime} run ${plural(awaitingN, "awaits", "await")} fill confirmation.`, full: `${awaitingN} ${plural(awaitingN, "order", "orders")} from the ${runTime} run ${plural(awaitingN, "is", "are")} waiting for the broker to confirm ${plural(awaitingN, "its fill", "their fills")}.` });
  }
  if (superseded && isNum(hb.orders) && hb.orders > 0) {
    add("warn", 9, `The daily run on ${fmtDate(hb.time)} placed ${hb.orders} ${plural(hb.orders, "order", "orders")}, but ${hb.orders === 1 ? "it is" : "they are"} not listed on this page yet.`);
  }
  if (typeof d.fx_note === "string" && d.fx_note.trim()) {
    add("warn", 10, /earlier run/i.test(d.fx_note) ? "Pound values use exchange rates from an earlier run, because live rates were unavailable." : "Exchange rates were unavailable, so some pound values are missing.");
  }
  if (D.health.unreadable) add("warn", 11, "The run status could not be read.");
  const problems = P.map((p, i) => ({ ...p, i })).sort((a, b) => (a.level === b.level ? 0 : a.level === "bad" ? -1 : 1) || a.order - b.order || a.i - b.i);
  return { problems, infos: I.slice(0, 3) };
}

// ------------------------------------------------------------------ top bar, strip, risk line, status
function renderTop(d) {
  $("updated").textContent = hasTime(d.generated) ? `Updated ${fmtDate(d.generated)}, ${fmtTime(d.generated)} UK time` : validIso(d.generated) ? `Updated ${fmtDate(d.generated)}` : "";
}
function lastNum(a) { for (let i = a.length - 1; i >= 0; i--) if (isNum(a[i])) return a[i]; return null; }
let helpOpen = null;
function renderStrip(d, D) {
  const host = $("strip");
  host.replaceChildren();
  const s = D.stats, nav = D.nav, perf = D.perf;
  const startTxt = validIso(d.start_date) ? fmtDate(d.start_date) : null;
  const cells = [];
  const add = (id, label, value, opts) => cells.push({ id, label, value, ...(opts || {}) });
  const sub1 = hasTime(s.nav_time) ? (s.nav_kind === "close" ? `Closing value, ${fmtDate(s.nav_time)} (${fmtTime(s.nav_time)})` : `Reading at ${fmtTime(s.nav_time)}, ${fmtDate(s.nav_time)}`) : "";
  add("value", "Account value", nav === null ? "Not available yet" : fmtGBP(nav), { hero: true, sub: sub1, help: "What the whole account is worth: cash plus everything held. It started at £1,000,000." });
  if (nav !== null) {
    if ("prev_close_gbp" in s) {
      const pc = isNum(s.prev_close_gbp) && s.prev_close_gbp > 0 ? s.prev_close_gbp : null;
      const ref = pc !== null ? pc : START_VALUE, chg = nav - ref;
      const sub = pc === null ? "since the £1,000,000 start" : hasTime(s.prev_close_time) ? `since the ${fmtDate(s.prev_close_time)} close` : "since the last close";
      add("day", "Day change", fmtSignedGBP(chg), { pct: fmtChangePct(chg / ref), money: chg, sub, help: "How much the account value has moved since the last closing value. A closing value is recorded at 21:35 UK time each weekday." });
    } else if (isNum(s.day_change)) {
      const dates = arr(perf.dates), times = arr(perf.times), kinds = arr(perf.kinds), acct = arr(perf.account), k = dates.length - 2;
      let sub = "since the previous reading";
      if (k >= 0) {
        if (kinds[k] === "start") sub = "since the £1,000,000 start";
        else if (hasTime(times[k])) sub = `since ${fmtDate(times[k])}, ${fmtTime(times[k])}`;
        else if (validIso(dates[k])) sub = `since ${fmtDate(dates[k])}`;
      }
      const prevV = k >= 0 && isNum(acct[k]) && acct[k] > 0 ? acct[k] : null;
      add("daylast", "Change since last reading", fmtSignedGBP(s.day_change), { pct: prevV ? fmtChangePct(s.day_change / prevV) : null, money: s.day_change, sub, help: "How much the account value has moved since the previous reading. Readings are taken at each daily run and at 21:35 UK time." });
    } else add("day", "Day change", "Not available today", { na: true, help: "How much the account value has moved since the last closing value." });
    // open profit/loss
    if (!D.posFile) add("open", "Open profit/loss", "None yet", { na: true, sub: "Holdings appear after the first evening snapshot (21:35)", help: "Gains or losses on holdings that are still open, so not yet banked (also called unrealised profit or loss)." });
    else {
      const n = D.holdings.length, pnl = D.tot ? D.tot.pnl : null;
      let sub = n ? `on ${n} ${plural(n, "holding", "holdings")} still open` : "no holdings open";
      if (n && hasTime(d.positions_time) && hasTime(s.nav_time) && d.positions_time.slice(0, 16) !== s.nav_time.slice(0, 16)) sub = `on ${n} ${plural(n, "holding", "holdings")}, as at the ${fmtDate(d.positions_time)} ${fmtTime(d.positions_time)} snapshot`;
      else if (n && !hasTime(d.positions_time) && validIso(d.positions_date) && validIso(s.nav_time) && dateOf(d.positions_date) !== dateOf(s.nav_time)) sub = `on ${n} ${plural(n, "holding", "holdings")}, as at ${fmtDate(d.positions_date)}`;
      add("open", "Open profit/loss", pnl === null ? (n ? NA : "£0") : fmtSignedGBP(pnl), { money: pnl, sub, help: "Gains or losses on holdings that are still open, so not yet banked (also called unrealised profit or loss)." });
    }
    const pnl = isNum(s.pnl) ? s.pnl : nav - START_VALUE, ret = isNum(s.ret) ? s.ret : pnl / START_VALUE;
    add("start", "Since the start", fmtSignedGBP(pnl), { pct: fmtChangePct(ret), money: pnl, sub: startTxt ? `since ${startTxt}` : "since the £1,000,000 start", help: `The change in the account value since it started with £1,000,000${validIso(d.start_date) ? " on " + fmtDate(d.start_date, true) : ""}.` });
    const fv = lastNum(arr(perf.world_fund));
    const wlc = validIso(perf.world_fund_last_close) ? perf.world_fund_last_close : null;
    if (isNum(s.world_fund_ret)) add("fund", "World fund instead", fmtChangePct(s.world_fund_ret), { sub: [fv !== null ? fmtGBP(fv) : null, wlc ? `${fmtDate(wlc)} close` : null].filter(Boolean).join(" · "), help: "What the account would show if all £1,000,000 had gone into the world shares fund on the same day." });
    else add("fund", "World fund instead", "Not available today", { na: true, help: "What the account would show if all £1,000,000 had gone into the world shares fund on the same day." });
    const cv = lastNum(arr(perf.cash));
    if (isNum(s.cash_ret)) add("cash", "Cash instead", fmtChangePct(s.cash_ret), { sub: [cv !== null ? fmtGBP(cv) : null, isNum(perf.cash_rate) ? `at ${perf.cash_rate.toFixed(2)}% a year` : null].filter(Boolean).join(" · "), help: "What the account would show if all £1,000,000 had stayed in cash, earning the Bank of England overnight rate." });
    else add("cash", "Cash instead", "Not available today", { na: true, help: "What the account would show if all £1,000,000 had stayed in cash, earning the Bank of England overnight rate." });
  }
  const helpP = $("strip-help");
  const buttons = [];
  for (const c of cells) {
    const btn = el("button", { type: "button", class: "ib", "aria-expanded": "false", "aria-controls": "strip-help", "aria-label": `What “${c.label}” means` }, icon("info", 18));
    btn.addEventListener("click", () => {
      const open = helpOpen === c.id;
      helpOpen = open ? null : c.id;
      for (const b of buttons) b.setAttribute("aria-expanded", "false");
      if (open) { helpP.hidden = true; helpP.textContent = ""; return; }
      btn.setAttribute("aria-expanded", "true");
      helpP.textContent = `${c.label}: ${c.help}`;
      helpP.hidden = false;
    });
    buttons.push(btn);
    const valCls = ["cell-val", c.hero ? "hero" : "", c.na ? "na" : "", isNum(c.money) ? moneyCls(c.money) : ""].filter(Boolean).join(" ");
    host.append(el("div", { class: "cell c-" + c.id },
      el("p", { class: "cell-head" }, el("span", { class: "cell-label" }, c.label), btn),
      el("p", { class: valCls }, el("span", { class: "v" }, c.value)),
      c.sub || c.pct ? el("p", { class: "cell-sub" }, c.pct ? el("span", { class: "pct " + (isNum(c.money) ? moneyCls(c.money) : "") }, c.pct) : null, c.pct && c.sub ? " · " : null, c.sub || null) : null));
  }
  helpP.hidden = true;
  helpOpen = null;
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && helpOpen) { const b = buttons.find((x) => x.getAttribute("aria-expanded") === "true"); helpOpen = null; helpP.hidden = true; for (const x of buttons) x.setAttribute("aria-expanded", "false"); if (b) b.focus(); }
  });
}
function renderShortHistory(d, D) {
  const p = $("short-history"), n = D.stats.days;
  if (isNum(n) && n < 20) { p.hidden = false; p.textContent = n <= 0 ? "No trading days yet: far too few to judge." : `${n} trading ${plural(n, "day", "days")} so far: far too few to judge.`; } else p.hidden = true;
}
function renderRiskLine(d, D) {
  const s = D.stats, span = $("max-fall"), line = $("max-fall-line");
  if (!isNum(s.max_drawdown)) { line.hidden = true; return; }
  line.hidden = false;
  span.textContent = s.max_drawdown < 0 && fmtChangePct(s.max_drawdown) !== "0.00%" ? fmtChangePct(s.max_drawdown) : "none yet";
}
function runFact(d, D) {
  const hb = obj(D.health.trade), R = D.R;
  const st = lower(hb.status), t = hasTime(hb.time) ? hb.time : null;
  if (t && st === "running" && hoursAgo(t) <= 2) return `Daily run in progress (started ${fmtTime(t)})`;
  if (t && st === "skipped") return `Daily run skipped on ${fmtDate(t)}`;
  const hbLater = t && st === "ok" && (!R || dateOf(t) > R.date);
  if (R && !hbLater) {
    let s = `Last run: ${fmtDate(R.start)}, ${fmtTime(R.start)} (${R.label.toLowerCase()}) · ${countWords(R.c, R.orders.length)}`;
    if (t && st === "ok" && dateOf(t) === R.date && tsec(t) - R.lastSec >= 300 && !(isNum(hb.orders) && hb.orders > 0)) s += ` · checked again at ${fmtTime(t)}, no further orders`;
    return s;
  }
  if (t && st === "ok") return `Last run: ${fmtDate(t)}, ${fmtTime(t)} · ` + (hb.orders === 0 ? "no orders needed" : isNum(hb.orders) && hb.orders > 0 ? `${hb.orders} ${plural(hb.orders, "order", "orders")} placed` : "no orders recorded");
  if (t) return null; // a failed or unfinished run with no orders listed: the problem item says it
  if (!R) return "First daily run: about 16:05 UK time on a weekday";
  return null;
}
function valueFact(D) {
  const sn = obj(D.health.snapshot);
  const st = lower(sn.status), t = hasTime(sn.time) ? sn.time : null;
  if (!t) return "Closing value: the first is recorded at 21:35 UK time on a weekday";
  if (st === "ok") {
    const lab = lower(sn.label), hm = fmtTime(t);
    if (lab === "close" || (!lab && hm >= "21:30" && hm <= "21:59")) return `Closing value recorded: ${fmtDate(t)}, ${hm}`;
    if (lab === "late") return `Value recorded: ${fmtDate(t)}, ${hm} (a catch-up reading)`;
    return `Value recorded: ${fmtDate(t)}, ${hm}`;
  }
  if (st === "running" && hoursAgo(t) <= 2) return `Closing value being recorded (started ${fmtTime(t)})`;
  if (st === "skipped") return `Closing value skipped on ${fmtDate(t)}`;
  return null;
}
function renderStatus(d, D) {
  const host = $("status");
  host.replaceChildren();
  const P = D.problems;
  const level = P.some((p) => p.level === "bad") ? "bad" : P.length ? "warn" : "ok";
  const box = el("div", { class: "st st-" + level });
  const head = level === "bad" ? "Something needs fixing" : level === "warn" ? (P.length === 1 ? "1 thing to check" : `${P.length} things to check`) : "Running normally";
  const facts = [runFact(d, D), valueFact(D)].filter(Boolean);
  box.append(el("div", { class: "st-line" },
    el("span", { class: "st-ico", "aria-hidden": "true" }, icon(level === "bad" ? "cross" : level === "warn" ? "warn" : "check", 15)),
    el("strong", { class: "st-title" }, head), facts.map((f) => el("span", { class: "st-fact" }, f))));
  if (D.infos.length) box.append(el("ul", { class: "st-notes" }, D.infos.map((n) => el("li", null, icon("info", 16), el("span", null, n.short)))));
  if (P.length) {
    const orderItems = P.filter((p) => p.order === 8);
    const shown = new Set(orderItems.slice(0, 4));
    const list = P.filter((p) => p.order !== 8 || shown.has(p));
    box.append(el("ul", { class: "st-probs" }, list.map((p) => el("li", null, icon(p.level === "bad" ? "cross" : "warn", 16), el("span", { class: "visually-hidden" }, p.level === "bad" ? "Problem: " : "To check: "), el("span", null, p.text)))));
    const hiddenN = orderItems.length - shown.size;
    if (hiddenN > 0) box.lastChild.append(el("li", null, el("span", null, `and ${hiddenN} more: see the Orders tab.`)));
  }
  const more = [...D.infos.map((n) => n.full), ...P.filter((p) => p.full).map((p) => p.full)];
  if (D.infos.some((n) => /held back/.test(n.short))) more.push("Orders held back because their market had closed are expected. They go at the next daily run and are not counted as problems.");
  if (P.some((p) => p.order === 8)) more.push("Every order, with its status, is on the Orders tab.");
  if (more.length) box.append(infoDetails("Details", more));
  host.append(box);
}

// ------------------------------------------------------------------ donuts (shared by Portfolio and Risk)
const polar = (cx, cy, r, a) => [cx + r * Math.sin(a), cy - r * Math.cos(a)];
function arcPath(cx, cy, r0, r1, a0, a1) {
  const large = a1 - a0 > Math.PI ? 1 : 0;
  const [x0, y0] = polar(cx, cy, r1, a0), [x1, y1] = polar(cx, cy, r1, a1), [x2, y2] = polar(cx, cy, r0, a1), [x3, y3] = polar(cx, cy, r0, a0);
  const f = (v) => v.toFixed(2);
  return `M${f(x0)},${f(y0)}A${r1},${r1} 0 ${large} 1 ${f(x1)},${f(y1)}L${f(x2)},${f(y2)}A${r0},${r0} 0 ${large} 0 ${f(x3)},${f(y3)}Z`;
}
// slices: [{id, key (colour), label, value}] in ring order. Returns { svg, setFocus(id|null) }.
function drawDonut(slices, o) {
  const W = 284, H = 232, cx = 142, cy = 116, R1 = 88, R0 = 58, RL = 102;
  const big = window.matchMedia("(min-width: 700px)").matches;
  const tot = total(slices.map((s) => s.value));
  const svg = svgEl("svg", { viewBox: `0 0 ${W} ${H}`, width: W, height: H, class: "donut", role: "img", "aria-label": o.aria });
  let a = 0;
  const paths = {};
  for (const s of slices) {
    s.frac = s.value / tot;
    s.a0 = a; s.a1 = a + s.frac * 2 * Math.PI; a = s.a1;
    const p = svgEl("path", { d: arcPath(cx, cy, R0, R1, s.a0, Math.min(s.a1, s.a0 + 2 * Math.PI - 1e-6)), class: "sl sl-" + s.key });
    p.addEventListener("pointerenter", () => setFocus(s.id, true));
    p.addEventListener("pointerleave", () => setFocus(null, true));
    p.addEventListener("click", () => { if (o.onPick) o.onPick(s.id); });
    paths[s.id] = p;
    svg.append(p);
  }
  if (slices.length >= 2) for (const s of slices) { const [x0, y0] = polar(cx, cy, R0 - 1, s.a0), [x1, y1] = polar(cx, cy, R1 + 1, s.a0); svg.append(svgEl("line", { x1: x0, y1: y0, x2: x1, y2: y1, class: "gap" })); }
  // % labels outside the ring, never on a fill; the smaller of two overlapping labels is dropped (the legend has it)
  const fs = big ? 15 : 14;
  const boxes = [];
  for (const s of slices.filter((x) => x.frac >= 0.04).sort((p, q) => q.frac - p.frac)) {
    const mid = (s.a0 + s.a1) / 2, deg = (mid * 180) / Math.PI;
    const [x, y] = polar(cx, cy, RL, mid);
    const text = fmtShare(s.frac), w = textWidth(text, `600 ${fs}px Inter, system-ui, sans-serif`);
    const anchor = deg <= 12 || deg >= 348 || (deg >= 168 && deg <= 192) ? "middle" : deg < 180 ? "start" : "end";
    const left = anchor === "start" ? x : anchor === "end" ? x - w : x - w / 2;
    const b = { l: left - 2, r: left + w + 2, t: y - fs * 0.6, btm: y + fs * 0.6 };
    if (boxes.some((q) => b.l < q.r && b.r > q.l && b.t < q.btm && b.btm > q.t)) continue;
    boxes.push(b);
    svg.append(svgText({ x: x.toFixed(1), y: y.toFixed(1), dy: "0.35em", "text-anchor": anchor, class: "pl" }, text));
  }
  const cV = svgEl("text", { x: cx, y: cy - 4, "text-anchor": "middle", class: "dc-v" });
  const cC = svgEl("text", { x: cx, y: cy + 18, "text-anchor": "middle", class: "dc-c" });
  svg.append(cV, cC);
  const setCentre = (v, c) => {
    let size = 20;
    while (size > 14 && textWidth(v, `700 ${size}px Inter, system-ui, sans-serif`) > 2 * R0 - 18) size -= 1;
    cV.setAttribute("font-size", size);
    cV.textContent = v;
    cC.textContent = c;
  };
  let pinned = o.pinned || null;
  function setFocus(id, hover) {
    const show = id || pinned;
    for (const s of slices) paths[s.id].classList.toggle("dim", !!show && s.id !== show);
    const s = slices.find((x) => x.id === show);
    if (s) setCentre(s.label, fmtShare(s.frac) + (o.unitWord ? " " + o.unitWord : ""));
    else setCentre(o.centre[0], o.centre[1]);
    if (!hover && o.onFocus) o.onFocus(id);
  }
  setFocus(null, true);
  return { svg, setFocus: (id) => setFocus(id, true), pin: (id) => { pinned = id; setFocus(null, true); } };
}
function classSlices(D, measure) {
  return D.classes.map((c) => ({ id: c.cls, key: c.key, label: c.cls, value: measure === "face" ? c.face : c.swing || 0 })).filter((s) => s.value > 0);
}
// what to draw for a set of slices: a ring, a sentence (1 or 2 classes), or nothing (unsafe neighbours)
function donutOrText(slices, o) {
  if (!slices.length) return { node: el("p", { class: "dn-msg" }, o.emptyText || "Nothing to show yet.") };
  const sum = total(slices.map((s) => s.value));
  if (slices.length === 1) return { node: el("p", { class: "dn-msg" }, o.oneText(slices[0].label)) };
  if (slices.length === 2) return { node: el("p", { class: "dn-msg" }, slices.map((s) => `${s.label} ${fmtShare(s.value / sum)}`).join(" · ")) };
  if (o.checkRing && !ringSafe(slices.map((s) => s.id))) return { node: el("p", { class: "dn-msg" }, "Chart not drawn today: neighbouring colours would be too similar. The table has the same figures."), unsafe: true };
  const dn = drawDonut(slices, o);
  return { node: dn.svg, dn };
}

function classLegend(D, opts) {
  // opts: { cols: [...], compact, pressed, onPick, onFocus }
  const cols = opts.cols;
  const COL = {
    face: { h: "Face value", get: (c) => (opts.compact ? fmtCompactGBP(c.face) : fmtGBP(c.face)), tot: () => (opts.compact ? fmtCompactGBP(D.tot.face) : fmtGBP(D.tot.face)) },
    faceShare: { h: opts.compact ? "Share" : "Share of face value", get: (c) => fmtShare(c.faceShare), tot: () => "100%" },
    riskShare: { h: "Share of the risk", get: (c) => fmtShare(c.share), tot: () => "100%" },
    n: { h: "Holdings", get: (c) => String(c.n), tot: () => String(D.tot.n) },
  };
  const table = el("table", { class: "tbl legend" },
    el("caption", { class: "visually-hidden" }, "Asset classes: the same figures as the charts"),
    el("thead", null, el("tr", null, el("th", { scope: "col" }, "Asset class"), cols.map((k) => el("th", { scope: "col", class: "num" }, COL[k].h)))));
  const body = el("tbody");
  const btns = {};
  for (const c of D.classes) {
    const pressed = opts.pressed === c.cls;
    const b = el("button", { type: "button", class: "lg-btn", "aria-pressed": opts.onPick ? String(pressed) : null }, swatch(c.key), c.cls);
    if (opts.onPick) b.addEventListener("click", () => opts.onPick(c.cls));
    b.addEventListener("focus", () => opts.onFocus && opts.onFocus(c.cls));
    b.addEventListener("blur", () => opts.onFocus && opts.onFocus(null));
    b.addEventListener("pointerenter", () => opts.onFocus && opts.onFocus(c.cls));
    b.addEventListener("pointerleave", () => opts.onFocus && opts.onFocus(null));
    btns[c.cls] = b;
    body.append(el("tr", { class: pressed ? "on" : null }, el("th", { scope: "row" }, b), cols.map((k) => el("td", { class: "num" }, COL[k].get(c)))));
  }
  table.append(body, el("tfoot", null, el("tr", null, el("th", { scope: "row" }, "All holdings"), cols.map((k) => el("td", { class: "num" }, COL[k].tot())))));
  return el("div", { class: "tbl-scroll" }, table);
}
function currencyRows(D) {
  const map = new Map();
  for (const h of D.holdings) {
    const c = h.isFund ? "GBP" : h.ccy;
    const id = CCY.some((x) => x.id === c) ? c : "Other";
    if (!map.has(id)) map.set(id, { id, face: 0, n: 0 });
    const r = map.get(id);
    r.face += h.exp || 0; r.n += 1;
  }
  const rows = [...CCY.map((x) => (map.has(x.id) ? { ...map.get(x.id), label: x.label, key: x.key } : null)).filter(Boolean)];
  if (map.has("Other")) rows.push({ ...map.get("Other"), label: "other currencies", key: "other" });
  const t = total(rows.map((r) => r.face));
  for (const r of rows) r.share = t > 0 ? r.face / t : null;
  return rows;
}
const capFirst = (s) => s.charAt(0).toUpperCase() + s.slice(1);
function currencyLegend(D, rows, onFocus, pressed, onPick) {
  const table = el("table", { class: "tbl legend" },
    el("caption", { class: "visually-hidden" }, "Currency the contracts are priced in"),
    el("thead", null, el("tr", null, el("th", { scope: "col" }, "Currency"), el("th", { scope: "col", class: "num" }, "Face value"), el("th", { scope: "col", class: "num" }, "Share"), el("th", { scope: "col", class: "num" }, "Holdings"))));
  const body = el("tbody");
  for (const r of rows) {
    const b = el("button", { type: "button", class: "lg-btn", "aria-pressed": onPick ? String(pressed === r.id) : null }, swatch(r.key), capFirst(r.label));
    if (onPick) b.addEventListener("click", () => onPick(r.id));
    b.addEventListener("focus", () => onFocus(r.id)); b.addEventListener("blur", () => onFocus(null));
    b.addEventListener("pointerenter", () => onFocus(r.id)); b.addEventListener("pointerleave", () => onFocus(null));
    body.append(el("tr", { class: pressed === r.id ? "on" : null }, el("th", { scope: "row" }, b), el("td", { class: "num" }, isPhone() ? fmtCompactGBP(r.face) : fmtGBP(r.face)), el("td", { class: "num" }, fmtShare(r.share)), el("td", { class: "num" }, String(r.n))));
  }
  table.append(body);
  return el("div", { class: "tbl-scroll" }, table);
}
function takeaway(D) {
  if (!D.swingAll) return null;
  const r1 = (x) => Math.round(x * 1000) / 10;
  const cand = D.classes.filter((c) => c.faceShare !== null && c.share !== null).map((c) => ({ c, f: r1(c.faceShare), r: r1(c.share) }))
    .filter((x) => Math.abs(x.f - x.r) >= 10).sort((a, b) => Math.abs(b.f - b.r) - Math.abs(a.f - a.r)).slice(0, 2);
  if (!cand.length) return "Each class's share of the risk is close to its share of face value.";
  return cand.map((x) => `${x.c.cls} ${verbAre(x.c.cls)} ${x.f.toFixed(1)}% of face value but ${x.r.toFixed(1)}% of the risk.`).join(" ");
}

// ------------------------------------------------------------------ Portfolio tab
function fundTarget(d, D) {
  const wf = D.wf;
  const tw = isNum(wf.target_weight) && wf.target_weight > 0 ? wf.target_weight : null;
  const tg = isNum(wf.target_gbp) && wf.target_gbp > 0 ? wf.target_gbp : null;
  const maxW = isNum(d.fund_max_weight) && d.fund_max_weight > 0 ? d.fund_max_weight : isNum(wf.max_weight) && wf.max_weight > 0 ? wf.max_weight : 0.85;
  const step = isNum(wf.step_gbp) && wf.step_gbp > 0 ? wf.step_gbp : 250000;
  return { tw, tg, maxW, step, pctText: tw !== null ? `about ${Math.round(tw * 100)}%` : `up to ${Math.round(maxW * 100)}%`, full: tg !== null && tw !== null ? `target ${fmtAbout(tg)} (${Math.round(tw * 100)}% of the account)` : `target up to ${Math.round(maxW * 100)}% of the account` };
}
function renderHoldingsAsof(d) {
  const p = $("holdings-asof");
  const t = hasTime(d.positions_time) ? d.positions_time : null;
  if (t && d.positions_kind === "close") p.textContent = `As at the ${fmtDate(t)} closing snapshot (${fmtTime(t)}).`;
  else if (t && d.positions_kind === "late") p.textContent = `As at the ${fmtDate(t)} ${fmtTime(t)} catch-up reading.`;
  else if (t) p.textContent = `As at the ${fmtDate(t)} ${fmtTime(t)} snapshot.`;
  else if (validIso(d.positions_date)) p.textContent = `As at ${fmtDate(d.positions_date)}.`;
  else p.textContent = "";
  p.hidden = !p.textContent;
}
function tile(label, value, sub, cls) {
  return el("div", { class: "tile" + (cls ? " " + cls : "") }, el("p", { class: "t-l" }, label), el("p", { class: "t-v" }, value), sub ? el("p", { class: "t-s" }, sub) : null);
}
function renderGlance(d, D) {
  const host = $("glance");
  host.replaceChildren();
  if (!D.posFile) { host.hidden = true; return; }
  host.hidden = false;
  const nav = D.nav, T = D.tot, ft = fundTarget(d, D);
  const tiles = el("div", { class: "tiles" });
  tiles.append(tile("Holdings", String(T.n), `${T.nLong} rising ${plural(T.nLong, "bet", "bets")}, ${T.nShort} falling ${plural(T.nShort, "bet", "bets")}`));
  tiles.append(tile("Face value", fmtCompactGBP(T.face), nav ? `${fmtMult(T.face / nav)} the account` : null));
  if (D.fund) tiles.append(tile("World fund", fmtGBP(D.fund.exp), `${nav && D.fund.exp !== null ? Math.round((D.fund.exp / nav) * 100) + "% of the account · " : ""}target ${ft.pctText}`));
  else tiles.append(tile("World fund", "None held yet", ft.full));
  if (D.signals.length) tiles.append(tile("Markets with no bet", `${D.noBet.length} of ${D.signals.length}`, D.noBet.length ? D.noBet.map((s) => s.short).join(", ") : "every market has a bet"));
  host.append(el("h3", { class: "visually-hidden" }, "At a glance"), tiles);
}
function glanceNotes(d, D) {
  if (!D.posFile) return [];
  const ft = fundTarget(d, D);
  return [
    "Holdings counts every open position. A rising bet gains if the price rises; a falling bet gains if it falls. The world fund counts as a rising bet.",
    "Face value is the full value of the contracts. Futures need only a deposit, so face values add up to more than the account.",
    `The world fund is bought in steps of up to ${fmtGBP(ft.step)} at the daily runs, ${ft.full}.`,
    "A market has no bet when its signal is too weak for one contract.",
  ];
}
function setHoldFilter(id) {
  UI.hold.filter = UI.hold.filter === id && id !== "all" ? "all" : id;
  rerender("portfolio");
}
function renderAlloc(d, D) {
  const host = $("alloc");
  host.replaceChildren(el("h3", null, "Where the money is, and where the risk is"));
  if (!D.posFile || !D.holdings.length) { host.append(el("p", { class: "empty" }, "Holdings appear after the first evening snapshot (21:35 UK time).")); return; }
  const picked = UI.hold.filter.startsWith("cls:") ? UI.hold.filter.slice(4) : null;
  const faceSlices = classSlices(D, "face"), riskSlices = D.swingAll ? classSlices(D, "risk") : [];
  const donuts = [];
  const onPick = (id) => setHoldFilter("cls:" + id);
  const focusAll = (id) => donuts.forEach((x) => x.setFocus(id));
  const T = D.tot;
  const mkFace = () => donutOrText(faceSlices, { aria: "Face value by asset class. The same figures are in the table.", centre: [fmtCompactGBP(T.face), "face value"], unitWord: "", oneText: (c) => `All of the face value is in ${c}.`, checkRing: true, onPick, pinned: picked });
  const mkRisk = () => (D.swingAll ? donutOrText(riskSlices, { aria: "Share of the risk by asset class. The same figures are in the table.", centre: [`${T.n} ${plural(T.n, "holding", "holdings")}`, `${D.classes.length} asset ${plural(D.classes.length, "class", "classes")}`], unitWord: "", oneText: (c) => `All of the risk is in ${c}.`, checkRing: true, onPick, pinned: picked })
    : { node: el("p", { class: "dn-msg" }, "Risk shares appear once each holding's typical yearly swing is available.") });
  const fig = (caption, r) => { if (r.dn) donuts.push(r.dn); return el("figure", { class: "dn" }, el("figcaption", null, caption), r.node); };
  const legendOpts = { pressed: picked, onPick, onFocus: focusAll };
  if (isPhone()) {
    const mode = UI.donut === "risk" && D.swingAll ? "risk" : "face";
    host.append(el("div", { class: "seg-row" }, segmented("Chart", [{ id: "face", label: "Face value" }, { id: "risk", label: "Risk", disabled: !D.swingAll }], mode, (id) => { UI.donut = id; saveUI(); rerender("portfolio"); })));
    host.append(mode === "face" ? fig("Face value by asset class", mkFace()) : fig("Share of the risk by asset class", mkRisk()));
    host.append(el("div", { class: "legend-wrap" }, classLegend(D, { ...legendOpts, compact: true, cols: mode === "face" ? ["face", "faceShare", "n"] : ["riskShare", "n"] })));
  } else {
    const grid = el("div", { class: "alloc-grid" });
    grid.append(fig("Face value by asset class", mkFace()), fig("Share of the risk by asset class", mkRisk()));
    grid.append(el("div", { class: "legend-col legend-wrap" }, classLegend(D, { ...legendOpts, cols: D.swingAll ? ["face", "faceShare", "riskShare", "n"] : ["face", "faceShare", "n"] })));
    host.append(grid);
  }
  const tk = takeaway(D);
  host.append(infoDetails("What this shows", [
    ...glanceNotes(d, D),
    tk,
    "Share of the risk counts each holding on its own (its typical yearly swing). Holdings partly offset each other; the Risk tab allows for that.",
    "Tap a class in the table to show only its holdings below; tap it again to show all.",
  ]));
}

// holdings: filter options, figures (phone), sort
function holdFilters(D) {
  const H = D.holdings;
  const f = [{ id: "all", label: "All", n: H.length }, { id: "long", label: "Rising bets", n: H.filter((h) => h.dir === "long").length }, { id: "short", label: "Falling bets", n: H.filter((h) => h.dir === "short").length }];
  for (const c of D.classes) f.push({ id: "cls:" + c.cls, label: c.cls, n: c.n });
  return f;
}
function passFilter(h, f) {
  if (f === "all") return true;
  if (f === "long") return h.dir === "long";
  if (f === "short") return h.dir === "short";
  if (f.startsWith("cls:")) return h.cls === f.slice(4);
  return true;
}
const FIGS = {
  pnl: { label: "Open profit/loss", head: "Open profit/loss", sort: "swing" },
  pnlabs: { label: "Open profit/loss, largest first", head: "Open profit/loss", sort: "pnlabs" },
  face: { label: "Face value", head: "Face value", sort: "face" },
  pct: { label: "% of account", head: "% of account", sort: "face" },
  swing: { label: "Typical yearly swing", head: "Typical yearly swing", sort: "swing" },
  signal: { label: "Signal", head: "Signal", sort: "sigabs" },
  last: { label: "Last price", head: "Last price", sort: "swing" },
  name: { label: "Name A–Z", head: "Open profit/loss", sort: "name" },
};
const SORTVAL = {
  name: (h) => h.short.toLowerCase(), pos: (h) => h.sq, avg: (h) => h.avg, last: (h) => h.last, face: (h) => h.exp, pct: (h) => h.exp,
  pnl: (h) => h.pnl, day: (h) => h.day, swing: (h) => h.swing, signal: (h) => h.signal,
  pnlabs: (h) => (h.pnl === null ? null : Math.abs(h.pnl)), sigabs: (h) => (h.signal === null ? null : Math.abs(h.signal)),
};
function sorter(key, dir) {
  const f = SORTVAL[key] || SORTVAL.swing;
  return (a, b) => {
    const va = f(a), vb = f(b);
    if (va === null && vb === null) return a.short.localeCompare(b.short);
    if (va === null) return 1;
    if (vb === null) return -1;
    const r = typeof va === "string" ? va.localeCompare(vb) : va - vb;
    return (dir === "asc" ? r : -r) || (b.swing || 0) - (a.swing || 0) || a.short.localeCompare(b.short);
  };
}
function holdGroups(D, list, sortFn) {
  if (!UI.group) return [{ cls: null, items: list.slice().sort(sortFn) }];
  const out = [];
  for (const c of D.classes) {
    const items = list.filter((h) => h.cls === c.cls).sort(sortFn);
    if (items.length) out.push({ cls: c.cls, key: c.key, items });
  }
  return out;
}
function grpSummary(items) {
  const n = items.length, L = items.filter((h) => h.dir === "long").length, S = items.filter((h) => h.dir === "short").length;
  const head = `${n} ${plural(n, "holding", "holdings")}`;
  if (L + S < n) return head;
  if (n === 1) return `${head}, ${L ? "long" : "short"}`;
  if (L === n) return `${head}, all long`;
  if (S === n) return `${head}, all short`;
  return `${head}: ${L} long, ${S} short`;
}
function sumOrNull(items, f) { return items.length && items.every((h) => f(h) !== null) ? total(items.map(f)) : null; }
function instLine2(h) {
  if (h.isFund) return "Fund shares · pounds";
  const parts = [h.month ? fmtMonth(h.month) : null, h.cls === "Commodities" && h.group ? h.group : null, unitWords(h.unit) || null].filter(Boolean);
  if (!h.month && !h.unit) return h.cls === "Commodities" && h.group ? h.group : h.cls;
  return parts.join(" · ");
}
function dayHead(d, short) { return hasTime(d.positions_prev_time) ? `since ${short ? fmtDayMonth(d.positions_prev_time) : fmtDate(d.positions_prev_time)}` : short ? "since last snapshot" : "since the previous snapshot"; }
function reconcile(d, D) {
  // the account rows appear only when the holdings snapshot and the account reading are the same moment
  const s = D.stats;
  const sameNow = hasTime(d.positions_time) && hasTime(s.nav_time) && d.positions_time.slice(0, 16) === s.nav_time.slice(0, 16);
  if (!sameNow || !isNum(s.pnl) || D.tot.pnl === null) return null;
  const acctPnl = rnd(s.pnl), rowsPnl = rnd(D.tot.pnl);
  const sameRef = hasTime(d.positions_prev_time) && hasTime(s.prev_close_time) && d.positions_prev_time.slice(0, 16) === s.prev_close_time.slice(0, 16) && isNum(s.prev_close_gbp) && D.nav !== null && D.tot.day !== null;
  const acctDay = sameRef ? rnd(D.nav - s.prev_close_gbp) : null;
  return { elsePnl: acctPnl - rowsPnl, acctPnl, elseDay: sameRef ? acctDay - rnd(D.tot.day) : null, acctDay };
}
function renderHoldings(d, D) {
  const card = $("hold-card"), ctl = $("hold-controls"), table = $("holdings"), list = $("holdings-list"), help = $("cols-help"), scroll = $("holdings-scroll");
  ctl.replaceChildren(); table.replaceChildren(); list.replaceChildren(); help.replaceChildren();
  if (!D.posFile || !D.holdings.length) {
    card.hidden = !D.posFile;
    if (D.posFile) { card.hidden = false; ctl.append(el("p", { class: "empty" }, "No holdings are open.")); }
    scroll.hidden = true; list.hidden = true;
    return;
  }
  card.hidden = false;
  if (!UI.hold.key) UI.hold.key = D.swingAll ? "swing" : "face";
  const filters = holdFilters(D);
  if (!filters.some((f) => f.id === UI.hold.filter)) UI.hold.filter = "all";
  const grpBtn = el("button", { type: "button", class: "chk", role: "switch", "aria-checked": String(UI.group) }, el("span", { class: "box", "aria-hidden": "true" }, icon("check", 14)), "Group by asset class");
  grpBtn.addEventListener("click", () => { UI.group = !UI.group; saveUI(); rerender("portfolio"); });
  if (isPhone()) {
    const fig = FIGS[UI.figure] ? UI.figure : "pnl";
    ctl.append(el("div", { class: "ph-ctl" },
      selectBox("hold-show", "Show", filters.map((f) => ({ id: f.id, label: `${f.label} (${f.n})` })), UI.hold.filter, (v) => { UI.hold.filter = v; rerender("portfolio"); }),
      selectBox("hold-fig", "Figure and sort", Object.entries(FIGS).map(([id, f]) => ({ id, label: f.label })), fig, (v) => { UI.figure = v; saveUI(); rerender("portfolio"); })),
    el("div", { class: "ctl-row" }, grpBtn));
    scroll.hidden = true; list.hidden = false;
    renderHoldingsList(d, D);
  } else {
    ctl.append(el("div", { class: "ctl-row" }, el("div", { class: "chips", role: "group", "aria-label": "Show" }, filters.map((f) => chipBtn(f.label, f.n, UI.hold.filter === f.id, () => { UI.hold.filter = f.id; rerender("portfolio"); }))), grpBtn));
    scroll.hidden = false; list.hidden = true;
    renderHoldingsTable(d, D);
  }
  const posT = hasTime(d.positions_time) ? `${fmtDate(d.positions_time)} ${fmtTime(d.positions_time)}` : validIso(d.positions_date) ? fmtDate(d.positions_date) : "latest";
  const prevT = hasTime(d.positions_prev_time) ? `${fmtDate(d.positions_prev_time)}` : "previous";
  const T = D.tot, nav = D.nav;
  help.append(infoDetails("What the columns mean", [el("dl", null,
    [["Instrument", "The market, and for futures the contract month (when the contract ends) and the currency its price is quoted in."],
      ["Position", "How many contracts (or fund shares) are held. Long is a bet on the price rising; Short is a bet on it falling."],
      ["Average price (incl. costs)", "The average price of the holding, including commission, in the market's own units."],
      ["Last price", `The price at the ${posT} snapshot.`],
      ["Face value", "The full value of the contracts in pounds. Futures need only a deposit, so this is much larger than the money at risk."],
      ["% of account", "Face value divided by the account value."],
      ["Open profit/loss", "The gain or loss on the holding since it was opened, not yet banked."],
      ["Day change", `How much the holding gained or lost since the ${prevT} close snapshot, including any trades in between.`],
      ["Typical yearly swing", "Roughly how much this holding might gain or lose in an ordinary year, on its own. Bad years can be much bigger, and it is not the most that could be lost. The % is its share of the risk, counting each holding on its own."],
      ["Signal", "How strongly the system leans towards rising (+) or falling (−) prices, from −20 to +20. The size of the holding follows it."],
      [NA, "Not applicable."]].map(([t, x]) => [el("dt", null, t), el("dd", null, x)])),
  `Face values are not money held. Futures need only a deposit, so face values add up to more than the account${nav ? ` (${fmtMult(T.face / nav)} today)` : ""}. Day change includes any trades between the two snapshots.`,
  "Tap a holding for its price chart, signal and trades."]));
}
function holdSortState() { return { key: UI.hold.key, dir: UI.hold.dir }; }
function onHoldSort(k) {
  if (UI.hold.key === k) UI.hold.dir = UI.hold.dir === "asc" ? "desc" : "asc";
  else { UI.hold.key = k; UI.hold.dir = k === "name" ? "asc" : "desc"; }
  rerender("portfolio");
}
function renderHoldingsTable(d, D) {
  const table = $("holdings"), nav = D.nav;
  const cols = [
    { k: "name", h: "Instrument", cls: "c-name" }, { k: "pos", h: "Position" },
    { k: "avg", h: "Average price", h2: "incl. costs", num: true }, { k: "last", h: "Last price", num: true },
    { k: "face", h: "Face value", num: true }, { k: "pct", h: "% of account", num: true },
    { k: "pnl", h: "Open profit/loss", num: true }, { k: "day", h: "Day change", h2: dayHead(d, true), num: true },
    { k: "swing", h: "Typical yearly swing", h2: "and risk share", num: true }, { k: "signal", h: "Signal", h2: `${MINUS}20 to +20`, num: true },
  ];
  // a column with no figures at all (older data files) is left out rather than shown as a column of dashes
  const H0 = D.holdings;
  const empty = { avg: H0.every((h) => h.avg === null), last: H0.every((h) => h.last === null), day: H0.every((h) => h.day === null), swing: H0.every((h) => h.swing === null) };
  const vis = cols.filter((c) => !empty[c.k]);
  const NC = vis.length;
  const st = holdSortState();
  table.append(el("caption", { class: "visually-hidden" }, "Holdings by asset class"), el("colgroup", null, vis.map((c) => el("col", { class: "w-" + c.k }))), el("thead", null, el("tr", null, vis.map((c) => sortHeader(c, st, onHoldSort)))));
  table.classList.toggle("slim", NC < 10);
  const want = (k) => !empty[k];
  const shown = D.holdings.filter((h) => passFilter(h, UI.hold.filter));
  const groups = holdGroups(D, shown, sorter(st.key, st.dir));
  const pct = (x) => (nav && x !== null ? fmtShare(x / nav) : NA);
  const ft = fundTarget(d, D);
  if (UI.group && UI.hold.filter === "all" && !D.fund && D.posFile) {
    table.append(el("tbody", { class: "g-fund" }, el("tr", { class: "grp" }, el("th", { scope: "rowgroup", colspan: NC },
      el("span", { class: "grp-name" }, swatch("fund"), "World fund", el("span", { class: "rest" }, ` · not held yet · ${ft.full}`))))));
  }
  for (const g of groups) {
    const tb = el("tbody");
    if (g.cls) {
      const items = g.items;
      tb.append(el("tr", { class: "grp" },
        el("th", { scope: "rowgroup", colspan: 2 + (want("avg") ? 1 : 0) + (want("last") ? 1 : 0) }, el("span", { class: "grp-name" }, swatch(g.key), g.cls, el("span", { class: "rest" }, " · " + grpSummary(items)))),
        el("td", { class: "num" }, fmtGBP(total(items.map((h) => h.exp || 0)))),
        el("td", { class: "num" }, pct(total(items.map((h) => h.exp || 0)))),
        el("td", { class: "num" }, moneySpan(sumOrNull(items, (h) => h.pnl))),
        want("day") ? el("td", { class: "num" }, sumOrNull(items, (h) => h.day) === null ? "" : moneySpan(sumOrNull(items, (h) => h.day))) : null,
        want("swing") ? el("td", { class: "num" }, D.swingAll ? `${fmtShare(total(items.map((h) => h.share)))} of risk` : "") : null,
        el("td", null)));
    }
    for (const h of g.items) {
      const open = UI.hold.open === h.slug;
      const btn = el("button", { type: "button", class: "row-open", "aria-expanded": String(open), "aria-controls": "d-" + h.slug }, el("span", { class: "nm" }, h.name), el("span", { class: "l2" }, instLine2(h)));
      const tr = el("tr", { class: "row" + (open ? " open" : ""), "data-slug": h.slug },
        el("th", { scope: "row" }, btn),
        el("td", null, posNode(h)),
        want("avg") ? el("td", { class: "num" }, fmtPrice(h.avg)) : null,
        want("last") ? el("td", { class: "num" }, fmtPrice(h.last)) : null,
        el("td", { class: "num" }, fmtGBP(h.exp)),
        el("td", { class: "num" }, pct(h.exp)),
        el("td", { class: "num" }, moneySpan(h.pnl)),
        want("day") ? el("td", { class: "num" }, moneySpan(h.day)) : null,
        want("swing") ? el("td", { class: "num" }, h.swing === null ? el("span", { class: "na" }, NA) : [fmtGBP(h.swing), D.swingAll ? el("span", { class: "l2" }, `${fmtShare(h.share)} of risk`) : null]) : null,
        el("td", { class: "num" }, h.isFund ? el("span", { class: "na" }, NA) : fmtSignal(h.signal)));
      tr.addEventListener("click", (e) => { if (!e.target.closest("button")) btn.click(); });
      btn.addEventListener("click", () => toggleHold(h.slug));
      tb.append(tr);
      if (open) tb.append(detailRow(d, D, h, NC, "portfolio"));
    }
    table.append(tb);
  }
  // footer: totals; the account rows only under All
  const foot = el("tfoot");
  const T = D.tot;
  const lead = 2 + (want("avg") ? 1 : 0) + (want("last") ? 1 : 0);
  const dayTd = (v) => (want("day") ? el("td", { class: "num" }, v === null || v === undefined ? "" : moneySpan(v)) : null);
  const swTd = (v) => (want("swing") ? el("td", { class: "num" }, v) : null);
  if (UI.hold.filter !== "all") {
    foot.append(el("tr", { class: "shown" }, el("th", { scope: "row", colspan: lead }, `Shown holdings (${shown.length})`),
      el("td", { class: "num" }, fmtGBP(total(shown.map((h) => h.exp || 0)))), el("td", { class: "num" }, pct(total(shown.map((h) => h.exp || 0)))),
      el("td", { class: "num" }, moneySpan(sumOrNull(shown, (h) => h.pnl))), dayTd(sumOrNull(shown, (h) => h.day)),
      swTd(D.swingAll ? `${fmtShare(total(shown.map((h) => h.share)))} of risk` : ""), el("td", null)));
  } else {
    foot.append(el("tr", null, el("th", { scope: "row", colspan: lead }, "All holdings"),
      el("td", { class: "num" }, fmtGBP(T.face)), el("td", { class: "num" }, pct(T.face)),
      el("td", { class: "num" }, moneySpan(T.pnl)), dayTd(T.day),
      swTd(D.swingAll ? "100%" : ""), el("td", null)));
    const rc = reconcile(d, D);
    if (rc) {
      foot.append(el("tr", null, el("th", { scope: "row", colspan: lead + 2 }, "Everything else (closed bets, fees, interest, currency)"),
        el("td", { class: "num" }, moneySpan(rc.elsePnl)), dayTd(rc.elseDay), swTd(""), el("td", null)));
      foot.append(el("tr", null, el("th", { scope: "row", colspan: lead + 2 }, "Account"),
        el("td", { class: "num" }, moneySpan(rc.acctPnl), el("span", { class: "l2" }, "since the start")), dayTd(rc.acctDay), swTd(""), el("td", null)));
    } else foot.append(el("tr", null, el("td", { colspan: NC, class: "tbl-note" }, "Totals that match the account appear after the evening snapshot.")));
  }
  table.append(foot);
}
function phoneFigure(h, D, fig) {
  const nav = D.nav;
  switch (fig) {
    case "face": return el("span", { class: "fig" }, fmtGBP(h.exp));
    case "pct": return el("span", { class: "fig" }, nav && h.exp !== null ? fmtShare(h.exp / nav) : NA);
    case "swing": return el("span", { class: "fig" }, h.swing === null ? NA : D.swingAll ? `${fmtGBP(h.swing)} · ${fmtShare(h.share)}` : fmtGBP(h.swing));
    case "signal": return el("span", { class: "fig" }, h.isFund ? NA : fmtSignal(h.signal));
    case "last": return el("span", { class: "fig" }, fmtPrice(h.last));
    default: return moneySpan(h.pnl, null, "fig");
  }
}
function phoneGroupFigure(items, D, fig) {
  const nav = D.nav;
  switch (fig) {
    case "face": return fmtGBP(total(items.map((h) => h.exp || 0)));
    case "pct": return nav ? fmtShare(total(items.map((h) => h.exp || 0)) / nav) : "";
    case "swing": return D.swingAll ? `${fmtShare(total(items.map((h) => h.share)))} of risk` : "";
    case "signal": case "last": return "";
    default: return moneySpan(sumOrNull(items, (h) => h.pnl));
  }
}
function renderHoldingsList(d, D) {
  const ul = $("holdings-list");
  const fig = FIGS[UI.figure] ? UI.figure : "pnl";
  const F = FIGS[fig];
  ul.append(el("li", { class: "hl-head" }, el("span", null, "Holding"), el("span", { class: "r" }, F.head, el("span", null, `Day change ${dayHead(d)}`))));
  const shown = D.holdings.filter((h) => passFilter(h, UI.hold.filter));
  const sortKey = F.sort, dir = sortKey === "name" ? "asc" : "desc";
  const groups = holdGroups(D, shown, sorter(sortKey, dir));
  const ft = fundTarget(d, D);
  if (UI.group && UI.hold.filter === "all" && !D.fund) ul.append(el("li", { class: "hl-grp" }, el("div", { class: "l1" }, el("span", { class: "nm" }, swatch("fund"), "World fund · not held yet")), el("div", { class: "l2" }, el("span", null, ft.full))));
  for (const g of groups) {
    if (g.cls) {
      const dsum = sumOrNull(g.items, (h) => h.day);
      ul.append(el("li", { class: "hl-grp" },
        el("div", { class: "l1" }, el("span", { class: "nm" }, swatch(g.key), `${g.cls} · ${g.items.length} ${plural(g.items.length, "holding", "holdings")}`), el("span", null, phoneGroupFigure(g.items, D, fig))),
        el("div", { class: "l2" }, el("span", null, ""), dsum === null ? el("span") : moneySpan(dsum))));
    }
    for (const h of g.items) {
      const open = UI.hold.open === h.slug;
      const btn = el("button", { type: "button", class: "hl-btn", "aria-expanded": String(open), "aria-controls": "d-" + h.slug },
        el("span", { class: "l1" }, el("span", { class: "nm" }, h.name), phoneFigure(h, D, fig)),
        el("span", { class: "l2" }, el("span", null, h.dir ? el("span", { class: "gl", "aria-hidden": "true" }, h.dir === "long" ? "▲ " : "▼ ") : null, [posText(h), h.month ? fmtMonth(h.month) : null].filter((x) => x && x !== NA).join(" · ")), h.day === null ? el("span") : moneySpan(h.day)));
      btn.addEventListener("click", () => toggleHold(h.slug));
      ul.append(el("li", { class: "hl-row", "data-slug": h.slug }, btn));
      if (open) ul.append(detailItem(d, D, h, "portfolio"));
    }
  }
  const T = D.tot;
  const footItem = (label, a, b, bLabel) => el("li", { class: "hl-foot" }, el("span", null, label), el("span", { class: "r" }, a, b !== undefined && b !== null ? el("span", { class: "l2 " + moneyCls(b) }, (bLabel ? bLabel + " " : "") + fmtSignedGBP(b)) : null));
  if (UI.hold.filter !== "all") ul.append(footItem(`Shown holdings (${shown.length})`, moneySpan(sumOrNull(shown, (h) => h.pnl)), sumOrNull(shown, (h) => h.day), "day"));
  else {
    ul.append(footItem("All holdings", moneySpan(T.pnl), T.day, "day"));
    const rc = reconcile(d, D);
    if (rc) {
      ul.append(footItem("Everything else (closed bets, fees, interest, currency)", moneySpan(rc.elsePnl), rc.elseDay, "day"));
      ul.append(footItem("Account, since the start", moneySpan(rc.acctPnl), rc.acctDay, "day"));
    } else ul.append(el("li", { class: "hl-note" }, "Totals that match the account appear after the evening snapshot."));
  }
}

// ------------------------------------------------------------------ detail panel (a holding, or a market on the Signals tab)
function whatItIs(h, s) {
  const cls = h ? h.cls : s.cls, name = h ? h.name : s.name, short = h ? h.short : s.short;
  const dirWord = h && h.dir === "short" ? "falling" : "rising";
  if (h && h.isFund) return { lead: "One world shares index fund (Vanguard FTSE All-World).", full: "Shares in one index fund (Vanguard FTSE All-World) that holds companies around the world." };
  if (cls === "Currencies") { const n = /^(Euro|Pound)$/.test(short) ? short.toLowerCase() : short; const t = `A bet on the ${n} ${dirWord} against the US dollar.`; return { lead: t, full: t }; }
  if (cls === "Bonds") { const b = name.replace(/ \(gilts\)$/, "").replace(/bonds$/, "bond"); const t = `A bet on ${b} prices ${dirWord}.`; return { lead: t, full: t + " Bond prices fall when interest rates rise, and rise when they fall." }; }
  if (cls === "Shares") { const t = `A bet on the ${short} share index ${dirWord}.`; return { lead: t, full: t }; }
  if (cls === "Commodities") { const t = `A bet on the price of ${name.toLowerCase()} ${dirWord}.`; return { lead: t, full: t }; }
  const t = `A bet on ${short} prices ${dirWord}.`;
  return { lead: t, full: t };
}
function marketTrades(d, D, key) {
  const mt = obj(d.market_trades);
  if (key && Array.isArray(mt[key])) {
    return mt[key].filter((t) => t && hasTime(t.time)).map((t, i) => ({ t, i, time: t.time, action: t.action === "Buy" || t.action === "Sell" ? t.action : null, qty: isNum(t.quantity) ? Math.abs(t.quantity) : null, price: isNum(t.price) ? t.price : null, st: orderKind(t, D.snapOk) }))
      .sort((a, b) => (a.time < b.time ? 1 : a.time > b.time ? -1 : a.i - b.i)).slice(0, 10);
  }
  return D.trades.filter((o) => o.key === key).sort((a, b) => b.sec - a.sec || a.i - b.i).slice(0, 10);
}
function detailContent(d, D, h, s, ctx) {
  const name = h ? h.name : s.name, slug = h ? h.slug : s.slug, key = h ? h.key : s.key;
  const sig = h ? h.sig : s;
  const pre = ctx === "signals" ? "ds-" : "d-";
  const wrap = el("div", { class: "dp", id: pre + slug, role: "region", "aria-labelledby": pre + "h-" + slug });
  wrap.append(el("h3", { id: pre + "h-" + slug }, name));
  const w = h ? whatItIs(h, null) : null;
  wrap.append(el("p", { class: "lead" }, h ? w.lead : "No bet held: the signal is too weak for one contract."));
  const grid = el("div", { class: "dp-grid" });
  const left = el("div", { class: "dp-col" }), right = el("div", { class: "dp-col" });
  // figures
  if (h) {
    const nav = D.nav, phone = isPhone();
    const items = [];
    const move = h.exp !== null ? fmt3sf(h.exp * 0.01) : null;
    const riskTxt = h.share === null || !D.swingAll ? null : `${fmtShare(h.share)} on its own` + (h.after !== null ? ` · ${fmtShare(h.after)} after offsets` + (h.after < 0 ? " (offsets other holdings)" : "") : "");
    if (phone) {
      items.push(["Position", posNode(h)], ["Average price (incl. costs)", fmtPrice(h.avg)], ["Last price", fmtPrice(h.last)], ["Face value", fmtGBP(h.exp)],
        ["% of account", nav && h.exp !== null ? fmtShare(h.exp / nav) : NA], ["Open profit/loss", moneySpan(h.pnl)], ["Day change", moneySpan(h.day)],
        ["Typical yearly swing", h.swing === null ? NA : fmtGBP(h.swing)], ["Signal", h.isFund ? NA : fmtSignal(h.signal)]);
      if (riskTxt) items.push(["Share of the risk", riskTxt]);
      if (h.month) items.push(["Contract month", fmtMonth(h.month)]);
      if (h.unit && unitWords(h.unit)) items.push(["Priced in", unitWords(h.unit)]);
    } else {
      if (h.month) items.push(["Contract month", fmtMonth(h.month)]);
      if (h.isFund) items.push(["Priced in", "pounds"]); else if (h.unit && unitWords(h.unit)) items.push(["Priced in", unitWords(h.unit)]);
      if (riskTxt) items.push(["Share of the risk", riskTxt]);
      if (h.avg !== null) items.push(["Average price", `${fmtPrice(h.avg)} (incl. costs)`]);
    }
    if (move) items.push(["A 1% price move", `about ${move}`]);
    right.append(el("dl", { class: "figs" }, items.map(([t, v]) => el("div", null, el("dt", null, t), el("dd", null, v)))));
  }
  // price chart
  const chartBox = el("div", { class: "chart-box pc-box" });
  const ro = el("p", { class: "readout pc-ro", "aria-live": "polite" });
  left.append(el("div", null, el("h4", null, "Price"), ro, chartBox));
  // signal parts
  if (!(h && h.isFund)) {
    if (sig) {
      right.append(el("div", null, el("h4", null, "What the signal is made of"), el("table", { class: "tbl" },
        el("thead", null, el("tr", null, el("th", { scope: "col" }, "Part"), el("th", { scope: "col", class: "num" }, "Value"))),
        el("tbody", null,
          el("tr", null, el("th", { scope: "row" }, "Price trend"), el("td", { class: "num" }, fmtSignal(sig.trend))),
          el("tr", null, el("th", { scope: "row" }, "Pays to hold"), el("td", { class: "num" }, sig.carryUsed ? fmtSignal(sig.carry) : "not used for this market")),
          el("tr", null, el("th", { scope: "row" }, `Combined signal (capped at ${MINUS}20 and +20)`), el("td", { class: "num" }, fmtSignal(sig.signal)))))));
    }
  }
  // trades
  const tr = marketTrades(d, D, key);
  const tradesBox = el("div", null, el("h4", null, "Trades in this market"));
  if (!tr.length) tradesBox.append(el("p", { class: "tbl-note" }, "No trades in this market are listed."));
  else {
    tradesBox.append(el("div", { class: "tbl-scroll" }, el("table", { class: "tbl" },
      el("thead", null, el("tr", null, ["Date and time", "Buy/Sell", "Quantity", "Price", "Status"].map((x, i) => el("th", { scope: "col", class: i === 2 || i === 3 ? "num" : null }, x)))),
      el("tbody", null, tr.map((o) => el("tr", null, el("th", { scope: "row" }, whenText(o.time)), el("td", null, o.action || NA), el("td", { class: "num" }, o.qty === null ? NA : fmtQty(o.qty)), el("td", { class: "num" }, fmtPrice(o.price)), el("td", null, statusNode(o, false))))))));
  }
  right.append(tradesBox);
  grid.append(left, right);
  wrap.append(grid);
  // one dropdown with every explanation
  const notes = [];
  if (h) {
    notes.push(w.full + (h.isFund ? "" : h.qty !== null ? ` ${fmtQty(h.qty)} ${plural(h.qty, "contract", "contracts")}.` : ""));
    if (h.exp !== null) notes.push(`A 1% move in its price changes the account by about ${fmt3sf(h.exp * 0.01)}.`);
  }
  notes.push("Price chart: daily closes with successive contract months joined, so older prices are adjusted and differ slightly from prices quoted at the time. ▲ marks a buy and ▼ a sell, at the fill price.");
  if (sig && validIso(d.signals_asof)) notes.push(`Signal parts as of the ${whenText(d.signals_asof)} run.`);
  const tableHost = el("div");
  notes.push(tableHost);
  const close = el("button", { type: "button", class: "btn" }, icon("close", 16), "Close details");
  close.addEventListener("click", () => (ctx === "signals" ? toggleSig(slug) : toggleHold(slug)));
  wrap.append(el("div", { class: "dp-actions" }, close), infoDetails("About this market", notes));
  wrap.addEventListener("keydown", (e) => { if (e.key === "Escape") { e.stopPropagation(); ctx === "signals" ? toggleSig(slug, true) : toggleHold(slug, true); } });
  wrap._draw = () => guard("price chart", null, () => drawPrice(d, D, key, h, chartBox, ro, tableHost, tr));
  return wrap;
}
function detailRow(d, D, h, cols, ctx, s) {
  const c = detailContent(d, D, h, s, ctx);
  const tr = el("tr", { class: "detail" }, el("td", { colspan: cols }, c));
  tr._draw = c._draw;
  pendingDraw.push(c);
  return tr;
}
function detailItem(d, D, h, ctx) {
  const c = detailContent(d, D, h, null, ctx);
  pendingDraw.push(c);
  return el("li", { class: "detail" }, c);
}
let pendingDraw = [];
function flushDraws() { const p = pendingDraw; pendingDraw = []; for (const c of p) if (c.isConnected && c._draw) c._draw(); }
function toggleHold(slug, close) {
  UI.hold.open = !close && UI.hold.open !== slug ? slug : null;
  try { history.pushState(null, "", UI.hold.open ? "#portfolio/" + UI.hold.open : "#portfolio"); } catch (e) { /* file:// */ }
  CUR.slug = UI.hold.open;
  rerender("portfolio", { keepScroll: true });
  const btn = document.querySelector(`#p-portfolio [aria-controls="d-${slug}"]`);
  if (btn) btn.focus({ preventScroll: true });
}
function toggleSig(slug, close) {
  UI.sig.open = !close && UI.sig.open !== slug ? slug : null;
  try { history.pushState(null, "", UI.sig.open ? "#signals/" + UI.sig.open : "#signals"); } catch (e) { /* file:// */ }
  CUR.slug = UI.sig.open;
  rerender("signals", { keepScroll: true });
  const btn = document.querySelector(`#p-signals [aria-controls="ds-${slug}"]`);
  if (btn) btn.focus({ preventScroll: true });
}

// ------------------------------------------------------------------ charts: shared line-chart engine (no floating tooltip)
function niceStep(span, maxIntervals) {
  const raw = span / Math.max(1, maxIntervals);
  const p = Math.pow(10, Math.floor(Math.log10(raw)));
  for (const m of [1, 2, 2.5, 5, 10]) if (m * p >= raw - 1e-12) return m * p;
  return 10 * p;
}
function pctSteps(lo, hi, steps) {
  const st = steps.find((s) => Math.ceil(hi / s - 1e-9) - Math.floor(lo / s + 1e-9) <= 6) || 100;
  const a = Math.floor(lo / st + 1e-9) * st, b = Math.ceil(hi / st - 1e-9) * st;
  const ticks = [];
  for (let v = a; v <= b + 1e-9; v += st) ticks.push(Math.abs(v) < 1e-9 ? 0 : v);
  return { lo: a, hi: b, ticks, step: st };
}
const pctTick = (v) => (v === 0 ? "0%" : (v > 0 ? "+" : MINUS) + String(Number(Math.abs(v).toFixed(2))) + "%");
function layoutTicks(cands, W) {
  const place = (c, w) => {
    if (c.anchor === "end" && c.x - w >= 0) return ["end", c.x - w];
    if (c.anchor === "start" && c.x + w <= W - 2) return ["start", c.x];
    if (c.x + w / 2 > W - 2) return ["end", c.x - w];
    if (c.x - w / 2 < 2) return ["start", c.x];
    return ["middle", c.x - w / 2];
  };
  let list = cands.map((c) => { const w = textWidth(c.text); const [anchor, left] = place(c, w); return { ...c, w, anchor, left, right: left + w }; });
  for (let guard = 0; guard < 80 && list.length > 1; guard++) {
    let bad = -1;
    for (let i = 1; i < list.length; i++) if (list[i].left < list[i - 1].right + 16) { bad = i; break; }
    if (bad < 0) break;
    const drop = bad === list.length - 1 ? bad - 1 : bad;
    list.splice(Math.max(drop, list.length > 2 ? 1 : 0), 1);
  }
  return list;
}
function lastIdx(v) { for (let i = v.length - 1; i >= 0; i--) if (isNum(v[i])) return i; return -1; }
// cfg: host, H, ml, mr, xs (x index per point), xMax, lo, hi, ticks, tickFmt, xTicks [{i,text}], series [{cls, dotCls, vals, area, hollowLast, dl}],
//      dotsAll, direct, zero, aria, onSelect(i|null, announce), extra(svg, ctx), pts (selectable indices)
function timeChart(cfg) {
  const host = cfg.host;
  host.replaceChildren();
  const W = Math.max(280, Math.floor(host.clientWidth || 640)), H = cfg.H;
  const m = { l: cfg.ml, r: cfg.mr, t: 16, b: 34 };
  const pw = Math.max(40, W - m.l - m.r), ph = H - m.t - m.b;
  const X = (k) => m.l + (cfg.xMax > 0 ? (k / cfg.xMax) * pw : pw / 2);
  const Y = (v) => m.t + ((cfg.hi - v) / (cfg.hi - cfg.lo || 1)) * ph;
  const svg = svgEl("svg", { width: W, height: H, viewBox: `0 0 ${W} ${H}`, class: "chart", role: "img", tabindex: 0, "aria-label": cfg.aria });
  for (const v of cfg.ticks) {
    svg.append(svgEl("line", { x1: m.l, x2: W - m.r, y1: Y(v).toFixed(1), y2: Y(v).toFixed(1), class: cfg.zero && v === 0 ? "zero" : "gl" }));
    svg.append(svgText({ x: m.l - 10, y: Y(v).toFixed(1), dy: "0.35em", "text-anchor": "end", class: "tick" }, cfg.tickFmt(v)));
  }
  for (const c of layoutTicks(cfg.xTicks.map((t) => ({ x: X(cfg.xs[t.i]), text: t.text, anchor: t.anchor })).sort((a, b) => a.x - b.x), W)) {
    svg.append(svgText({ x: c.x.toFixed(1), y: H - 10, "text-anchor": c.anchor, class: "tick" }, c.text));
  }
  const pathOf = (vals, join) => {
    let d = "", pen = false;
    vals.forEach((v, i) => { if (!isNum(v)) { if (!join) pen = false; return; } d += (pen ? "L" : "M") + X(cfg.xs[i]).toFixed(1) + "," + Y(v).toFixed(1); pen = true; });
    return d;
  };
  for (const s of cfg.series) if (s.area) {
    const idx = s.vals.map((v, i) => (isNum(v) ? i : -1)).filter((i) => i >= 0);
    if (idx.length > 1) {
      let d = `M${X(cfg.xs[idx[0]]).toFixed(1)},${Y(0).toFixed(1)}`;
      for (const i of idx) d += `L${X(cfg.xs[i]).toFixed(1)},${Y(s.vals[i]).toFixed(1)}`;
      d += `L${X(cfg.xs[idx[idx.length - 1]]).toFixed(1)},${Y(0).toFixed(1)}Z`;
      svg.append(svgEl("path", { d, class: "area" }));
    }
  }
  for (const s of cfg.series) svg.append(svgEl("path", { d: pathOf(s.vals, s.join), class: "ln " + s.cls }));
  for (const s of cfg.series) {
    const li = lastIdx(s.vals);
    s.vals.forEach((v, i) => {
      if (!isNum(v) || !(cfg.dotsAll || i === li)) return;
      const hollow = i === li && s.hollowLast;
      svg.append(svgEl("circle", { cx: X(cfg.xs[i]).toFixed(1), cy: Y(v).toFixed(1), r: 4, class: "dot " + s.dotCls + (hollow ? " hollow" : "") }));
    });
  }
  if (cfg.direct) {
    const labs = cfg.series.map((s) => { const i = lastIdx(s.vals); return i < 0 || !s.dl ? null : { x: X(cfg.xs[i]), y: Y(s.vals[i]), text: s.dl }; }).filter(Boolean).sort((a, b) => a.y - b.y);
    const close = labs.some((l, k) => k > 0 && l.y - labs[k - 1].y < 18);
    const edge = X(cfg.xMax);
    labs.forEach((l) => { l.ly = l.y; });
    if (close) {
      // spread into a column 20px apart, centred on the dots, kept inside the plot; leader lines join each label to its line end
      const n = labs.length;
      let start = labs.reduce((a, l) => a + l.y, 0) / n - ((n - 1) * 20) / 2;
      start = clamp(start, m.t + 6, H - m.b - 6 - (n - 1) * 20);
      labs.forEach((l, k) => { l.ly = start + k * 20; });
    }
    for (const l of labs) {
      const lx = edge + (close ? 30 : 12);
      if (close || l.x < edge - 1) svg.append(svgEl("path", { d: `M${(l.x + 6).toFixed(1)},${l.y.toFixed(1)}L${(lx - 4).toFixed(1)},${l.ly.toFixed(1)}`, class: "leader" }));
      svg.append(svgText({ x: lx.toFixed(1), y: l.ly.toFixed(1), dy: "0.35em", class: "dl" }, l.text));
    }
  }
  const ctx = { X, Y, m, W, H, pw, ph, svg };
  if (cfg.extra) cfg.extra(svg, ctx);
  const guide = svgEl("line", { class: "guide", x1: 0, x2: 0, y1: m.t, y2: H - m.b, visibility: "hidden" });
  const selG = svgEl("g");
  svg.insertBefore(guide, svg.firstChild ? svg.childNodes[cfg.ticks.length * 2] || null : null);
  svg.append(selG);
  const pts = cfg.pts;
  let sel = null;
  const select = (i, announce) => {
    sel = i;
    selG.replaceChildren();
    if (i === null) { guide.setAttribute("visibility", "hidden"); cfg.onSelect(null, announce); return; }
    const x = X(cfg.xs[i]).toFixed(1);
    guide.setAttribute("x1", x); guide.setAttribute("x2", x); guide.setAttribute("visibility", "visible");
    for (const s of cfg.series) if (isNum(s.vals[i])) selG.append(svgEl("circle", { cx: x, cy: Y(s.vals[i]).toFixed(1), r: 5, class: "dot " + s.dotCls }));
    cfg.onSelect(i, announce);
  };
  const nearest = (evt) => {
    const r = svg.getBoundingClientRect();
    const px = ((evt.clientX - r.left) * W) / (r.width || W);
    let best = pts[pts.length - 1], bd = Infinity;
    for (const i of pts) { const dd = Math.abs(X(cfg.xs[i]) - px); if (dd < bd) { bd = dd; best = i; } }
    return best;
  };
  svg.addEventListener("pointermove", (e) => { if (e.target.closest && e.target.closest(".mk")) return; select(nearest(e), false); });
  svg.addEventListener("pointerdown", (e) => { if (e.target.closest && e.target.closest(".mk")) return; select(nearest(e), false); });
  svg.addEventListener("pointerleave", (e) => { if (e.pointerType !== "touch") select(null, false); });
  svg.addEventListener("pointercancel", () => select(null, false));
  svg.addEventListener("blur", () => select(null, false));
  svg.addEventListener("keydown", (e) => {
    if (e.target !== svg) return;
    let k = sel === null ? pts.length - 1 : pts.indexOf(sel);
    if (e.key === "ArrowLeft") k = Math.max(0, k - 1);
    else if (e.key === "ArrowRight") k = Math.min(pts.length - 1, k + 1);
    else if (e.key === "Home") k = 0;
    else if (e.key === "End") k = pts.length - 1;
    else return;
    e.preventDefault();
    select(pts[k], true);
  });
  host.append(svg);
  cfg.onSelect(null, false);
  return { svg, select, ctx };
}
function xTicksFor(dates, xs, s, e, pw) {
  const n = e - s + 1, out = [];
  if (n < 22) {
    for (let i = s; i <= e; i++) out.push({ i, text: fmtDayMonth(dates[i]) });
    return out;
  }
  if (n <= 130) {
    const k = clamp(Math.floor(pw / 110), 4, 6);
    const seen = new Set();
    for (let q = 0; q < k; q++) {
      const target = xs[s] + ((xs[e] - xs[s]) * q) / (k - 1);
      let best = s;
      for (let i = s; i <= e; i++) if (Math.abs(xs[i] - target) < Math.abs(xs[best] - target)) best = i;
      if (!seen.has(best)) { seen.add(best); out.push({ i: best, text: fmtDayMonth(dates[best]) }); }
    }
    return out;
  }
  let lastYear = dayUTC(dates[s]).getUTCFullYear(), lastX = -1e9;
  const span = xs[e] - xs[s] || 1;
  for (let i = s + 1; i <= e; i++) {
    const a = dayUTC(dates[i - 1]), b = dayUTC(dates[i]);
    if (a.getUTCMonth() === b.getUTCMonth()) continue;
    const px = ((xs[i] - xs[s]) / span) * pw;
    if (px - lastX < 64) continue;
    const yr = b.getUTCFullYear();
    out.push({ i, text: MONTHS[b.getUTCMonth()] + (yr !== lastYear ? " " + yr : "") });
    lastX = px; lastYear = yr;
  }
  return out;
}
function keyLine(k) {
  const s = svgEl("svg", { class: "key", viewBox: "0 0 22 10", width: 22, height: 10, "aria-hidden": "true", focusable: "false" });
  s.append(svgEl("line", { x1: 1, x2: 21, y1: 5, y2: 5, class: "k-" + k }));
  return s;
}
function roItem(k, label, value, sub) {
  return el("span", { class: "ro-i" }, keyLine(k), el("span", null, label), el("strong", null, value), sub ? el("span", { class: "ro-s" }, sub) : null);
}

// ------------------------------------------------------------------ Performance tab
function perfModel(D) {
  const p = D.perf, dates = arr(p.dates), n = dates.length, acct = arr(p.account);
  if (n < 2 || acct.length !== n || !dates.every(validIso) || acct.filter(isNum).length < 2) return null;
  const fundRaw = arr(p.world_fund).length === n && arr(p.world_fund).some(isNum) ? arr(p.world_fund) : null;
  const cash = arr(p.cash).length === n && arr(p.cash).some(isNum) ? arr(p.cash) : null;
  const wlc = validIso(p.world_fund_last_close) ? dateOf(p.world_fund_last_close) : null;
  let fundLag = n;
  if (fundRaw && wlc) for (let i = 1; i < n; i++) if (dateOf(dates[i]) > wlc) { fundLag = i; break; }
  const fund = fundRaw ? fundRaw.map((v, i) => (i < fundLag ? v : null)) : null;
  const xs = [0];
  for (let i = 1; i < n; i++) xs.push(Math.max(xs[i - 1] + 1, xs[i - 1] + weekdaysBetween(dates[i - 1], dates[i])));
  return { dates, n, acct, fund, fundRaw, cash, kinds: arr(p.kinds), times: arr(p.times), wlc, fundLag, xs };
}
const RANGES = [{ id: "1W", n: 5 }, { id: "1M", n: 21 }, { id: "3M", n: 63 }, { id: "YTD" }, { id: "All" }];
function rangeEnabled(P, id) {
  if (id === "All") return true;
  const r = RANGES.find((x) => x.id === id);
  if (r && r.n) return P.n >= r.n + 2;
  if (id === "YTD") return P.dates[0].slice(0, 4) < P.dates[P.n - 1].slice(0, 4);
  return false;
}
function perfWindow(P, id) {
  const e = P.n - 1;
  let s = 0;
  if (id !== "All" && rangeEnabled(P, id)) {
    const r = RANGES.find((x) => x.id === id);
    if (r.n) s = e - r.n;
    else { const yr = P.dates[e].slice(0, 4); for (let i = e; i >= 0; i--) if (P.dates[i].slice(0, 4) < yr) { s = i; break; } }
  }
  const today = ukNow().iso.slice(0, 10);
  const dropLast = P.kinds[e] === "intraday" && dateOf(P.dates[e]) === today;
  return { s, e, m: Math.max(0, e - s - (dropLast ? 1 : 0)), dropLast };
}
function renderPerformance(d, D) {
  const P = perfModel(D);
  const range = P && rangeEnabled(P, UI.range) ? UI.range : "All";
  guard("ranges", "ranges", () => renderRanges(P, range));
  guard("growth", "growth-chart", () => renderGrowth(d, D, P, range));
  guard("drawdown", "dd-chart", () => renderDD(d, D, P, range));
  guard("statistics", "stats-card", () => renderStats(d, D, P, range));
  guard("monthly", "monthly-card", () => renderMonthly(d, D, P, range));
  guard("pnl by class", "pnl-card", () => renderPnlClass(d, D));
}
function renderRanges(P, range) {
  const host = $("ranges"), note = $("perf-note");
  host.replaceChildren();
  if (!P) { host.hidden = true; note.hidden = true; return; }
  host.hidden = false;
  const opts = RANGES.map((r) => ({ id: r.id, label: r.id, disabled: !rangeEnabled(P, r.id) }));
  host.append(segmented("Range", opts, range, (id) => { UI.range = id; saveUI(); rerender("performance"); }));
  const any = opts.some((o) => o.disabled);
  note.hidden = !any;
  note.textContent = any ? "Longer ranges unlock as history builds." : "";
}
function renderGrowth(d, D, P, range) {
  const chart = $("growth-chart"), ro = $("growth-readout"), more = $("growth-more");
  chart.replaceChildren(); ro.replaceChildren(); more.replaceChildren();
  if (!P) { ro.hidden = true; chart.append(el("p", { class: "empty" }, "The chart starts after the first closing value (21:35 UK time on a weekday).")); return; }
  ro.hidden = false;
  const Wn = perfWindow(P, range), s = Wn.s, e = Wn.e;
  const base = (vals) => (vals && isNum(vals[s]) && vals[s] !== 0 ? vals[s] : null);
  const rebase = (vals) => { const b = base(vals); return vals ? vals.map((v, i) => (i < s || i > e || !isNum(v) || b === null ? null : (v / b - 1) * 100)) : null; };
  const sA = rebase(P.acct), sF = rebase(P.fund), sC = rebase(P.cash);
  const today = ukNow().iso.slice(0, 10);
  const hollow = P.kinds[e] === "intraday" && dateOf(P.dates[e]) === today;
  const big = window.matchMedia("(min-width: 700px)").matches;
  const series = [{ cls: "s-acct", dotCls: "d-acct", vals: sA, hollowLast: hollow, name: "This account" }];
  if (sF) series.push({ cls: "s-fund", dotCls: "d-fund", vals: sF, name: "World fund only" });
  if (sC) series.push({ cls: "s-cash", dotCls: "d-cash", vals: sC, hollowLast: hollow, name: "Cash only" });
  for (const x of series) { const li = lastIdx(x.vals); x.dl = li >= 0 ? `${x.name} ${fmtChangePct(x.vals[li] / 100)}` : null; }
  const all = series.flatMap((x) => x.vals.filter(isNum));
  const mn = Math.min(...all), mx = Math.max(...all), span = mx - mn;
  const sc = pctSteps(Math.min(-3, mn - 0.1 * span, 0), Math.max(3, mx + 0.1 * span, 0), [0.5, 1, 2, 2.5, 5, 10, 20, 25, 50, 100, 200, 250, 500]);
  const xs = P.xs.map((x) => x - P.xs[s]);
  const W = Math.max(280, chart.clientWidth || 640);
  const direct = big && W >= 640;
  const pts = []; for (let i = s; i <= e; i++) pts.push(i);
  const wlcTxt = P.wlc ? fmtDate(P.wlc) : null;
  const readout = (i) => {
    const k = i === null ? e : i;
    ro.replaceChildren();
    if (k === s) {
      ro.append(el("span", { class: "ro-h" }, k === 0 ? `Start (close on ${fmtDate(P.dates[0])})` : `Range start (${fmtDate(P.dates[k])})`));
      for (const x of series) { const raw = x.cls === "s-acct" ? P.acct : x.cls === "s-fund" ? P.fundRaw : P.cash; ro.append(roItem(x.cls.slice(2), x.name, k === 0 ? fmtGBP(raw[k]) : "0.00%", k === 0 ? null : fmtGBP(raw[k]))); }
    } else {
      const head = P.kinds[k] === "intraday" ? `${fmtDate(P.dates[k])}, ${hasTime(P.times[k]) ? fmtTime(P.times[k]) + " reading" : "reading"}` : `${fmtDate(P.dates[k])} close`;
      ro.append(el("span", { class: "ro-h" }, head));
      ro.append(roItem("acct", "This account", fmtChangePct(sA[k] / 100), fmtGBP(P.acct[k])));
      if (sF) {
        let j = k; while (j > s && !isNum(sF[j])) j--;
        const lag = j < k && wlcTxt;
        ro.append(roItem("fund", "World fund only", isNum(sF[j]) ? fmtChangePct(sF[j] / 100) : NA, isNum(P.fundRaw[j]) ? fmtGBP(P.fundRaw[j]) + (lag ? `, to its ${wlcTxt} close` : "") : null));
      } else ro.append(el("span", { class: "ro-i" }, "World fund only: not available today"));
      if (sC) ro.append(roItem("cash", "Cash only", isNum(sC[k]) ? fmtChangePct(sC[k] / 100) : NA, isNum(P.cash[k]) ? fmtGBP(P.cash[k]) : null));
      else ro.append(el("span", { class: "ro-i" }, "Cash only: not available today"));
    }
  };
  timeChart({
    host: chart, H: big ? 300 : 230, ml: 56, mr: direct ? 200 : 16, xs, xMax: xs[e], lo: sc.lo, hi: sc.hi, ticks: sc.ticks, tickFmt: pctTick,
    xTicks: xTicksFor(P.dates, xs, s, e, W - 72 - (direct ? 200 : 16)), series, dotsAll: e - s + 1 < 5, direct, zero: true, pts,
    aria: "Growth of £1,000,000 for this account, all in the world fund, and all in cash. The same figures are in the table below.",
    onSelect: (i, announce) => { ro.setAttribute("aria-live", announce ? "polite" : "off"); readout(i); },
  });
  // details: caption and the table view
  const days = isNum(D.stats.days) ? D.stats.days : P.n - 1;
  const cap = `${days} trading ${plural(days, "day", "days")} so far.` + (e - s + 1 < 20 ? " Too short to read anything into." : "");
  const notes = [cap, "Each line shows the change since the start of the selected range. The grey solid line puts all £1,000,000 in the world shares fund; the grey dashed line leaves it in cash. A hollow dot is a reading taken during today, before the close."];
  if (wlcTxt && P.fundLag < P.n) notes.push(`World fund figures are to its ${wlcTxt} close.`);
  notes.push("Use the left and right arrow keys on the chart to step through the days.");
  const tbl = growthTable(P, s, e);
  notes.push(tbl);
  more.append(infoDetails("Details and table", notes));
}
function growthTable(P, s, e) {
  const wrap = el("div");
  const head = ["Date", "This account", "World fund only", "Cash only"];
  const table = el("table", { class: "tbl" }, el("thead", null, el("tr", null, head.map((h, i) => el("th", { scope: "col", class: i ? "num" : null }, h)))));
  const body = el("tbody"), rows = [];
  const cell = (vals, i, b) => (vals && isNum(vals[i]) && isNum(b) ? `${fmtGBP(vals[i])} / ${fmtChangePct(vals[i] / b - 1)}` : NA);
  for (let i = e; i >= s; i--) {
    const label = i === 0 ? `Start (${fmtDate(P.dates[0])})` : fmtDate(P.dates[i]) + (P.kinds[i] === "intraday" ? " (reading)" : "");
    const tr = el("tr", null, el("th", { scope: "row" }, label), el("td", { class: "num" }, cell(P.acct, i, P.acct[s])), el("td", { class: "num" }, cell(P.fund, i, P.fundRaw ? P.fundRaw[s] : null)), el("td", { class: "num" }, cell(P.cash, i, P.cash ? P.cash[s] : null)));
    rows.push(tr); body.append(tr);
  }
  table.append(body);
  wrap.append(el("div", { class: "tbl-scroll" }, table));
  if (rows.length > 30) wrap.append(showAllBtn(rows, 30, `Show all ${rows.length} days`, "Show the latest 30 days"));
  return wrap;
}
function showAllBtn(rows, k, moreTxt, lessTxt) {
  let all = false;
  const btn = el("button", { type: "button", class: "btn", "aria-expanded": "false" });
  const apply = () => { rows.forEach((r, i) => { r.hidden = !all && i >= k; }); btn.textContent = all ? lessTxt : moreTxt; btn.setAttribute("aria-expanded", String(all)); };
  btn.addEventListener("click", () => { all = !all; apply(); });
  apply();
  btn.style.marginTop = "8px";
  return btn;
}
function renderDD(d, D, P, range) {
  const chart = $("dd-chart"), ro = $("dd-readout"), more = $("dd-more");
  chart.replaceChildren(); ro.replaceChildren(); more.replaceChildren();
  if (!P) { ro.hidden = true; chart.append(el("p", { class: "empty" }, "The chart starts after the first closing value (21:35 UK time on a weekday).")); return; }
  ro.hidden = false;
  const Wn = perfWindow(P, range), s = Wn.s, e = Wn.e;
  const ddOf = (vals) => {
    if (!vals) return null;
    let peak = null;
    return vals.map((v, i) => { if (i < s || i > e || !isNum(v)) return null; peak = peak === null ? v : Math.max(peak, v); return (v / peak - 1) * 100; });
  };
  const dA = ddOf(P.acct), dF = ddOf(P.fund);
  const today = ukNow().iso.slice(0, 10);
  const hollow = P.kinds[e] === "intraday" && dateOf(P.dates[e]) === today;
  const series = [{ cls: "s-acct", dotCls: "d-acct", vals: dA, area: true, hollowLast: hollow }];
  if (dF) series.push({ cls: "s-fund", dotCls: "d-fund", vals: dF });
  const worst = Math.min(0, ...series.flatMap((x) => x.vals.filter(isNum)));
  const sc = pctSteps(Math.min(-5, 1.15 * worst), 0, [0.5, 1, 2, 2.5, 5, 10, 20, 25, 50]);
  const xs = P.xs.map((x) => x - P.xs[s]);
  const big = window.matchMedia("(min-width: 700px)").matches;
  const W = Math.max(280, chart.clientWidth || 640);
  const pts = []; for (let i = s; i <= e; i++) pts.push(i);
  const fall = (v) => (!isNum(v) ? NA : Math.abs(v) < 0.005 ? "at its high" : `${Math.abs(v).toFixed(2)}% below its high`);
  const readout = (i) => {
    const k = i === null ? e : i;
    ro.replaceChildren(el("span", { class: "ro-h" }, P.kinds[k] === "intraday" && hasTime(P.times[k]) ? `${fmtDate(P.dates[k])}, ${fmtTime(P.times[k])}` : fmtDate(P.dates[k])));
    ro.append(roItem("acct", "This account", fall(dA[k])));
    if (dF) { let j = k; while (j > s && !isNum(dF[j])) j--; ro.append(roItem("fund", "World fund only", fall(dF[j]))); }
  };
  timeChart({
    host: chart, H: big ? 240 : 200, ml: 56, mr: 16, xs, xMax: xs[e], lo: sc.lo, hi: 0, ticks: sc.ticks, tickFmt: pctTick,
    xTicks: xTicksFor(P.dates, xs, s, e, W - 72), series, dotsAll: e - s + 1 < 5, zero: true, pts,
    aria: "Fall from the highest value so far, for this account and for the world fund. The same figures are in the table below.",
    onSelect: (i, announce) => { ro.setAttribute("aria-live", announce ? "polite" : "off"); readout(i); },
  });
  const notes = [];
  if (worst > -0.005) notes.push("No fall from a high in this period.");
  notes.push("Each line shows how far the value is below the highest value it had reached so far in the selected range. Cash does not fall, so it is not shown.");
  const table = el("table", { class: "tbl" }, el("thead", null, el("tr", null, ["Date", "This account", "World fund only"].map((h, i) => el("th", { scope: "col", class: i ? "num" : null }, h)))));
  const body = el("tbody"), rows = [];
  for (let i = e; i >= s; i--) { const tr = el("tr", null, el("th", { scope: "row" }, fmtDate(P.dates[i])), el("td", { class: "num" }, isNum(dA[i]) ? fmtChangePct(dA[i] / 100) : NA), el("td", { class: "num" }, dF && isNum(dF[i]) ? fmtChangePct(dF[i] / 100) : NA)); rows.push(tr); body.append(tr); }
  table.append(body);
  const wrap = el("div", null, el("div", { class: "tbl-scroll" }, table));
  if (rows.length > 30) wrap.append(showAllBtn(rows, 30, `Show all ${rows.length} days`, "Show the latest 30 days"));
  notes.push(wrap);
  more.append(infoDetails("Details and table", notes));
}
function stdev(xs) { if (xs.length < 2) return null; const mu = total(xs) / xs.length; return Math.sqrt(total(xs.map((x) => (x - mu) ** 2)) / (xs.length - 1)); }
function seriesStats(vals, dates, Wn, cashVals) {
  const { s, e, m } = Wn;
  const out = {};
  if (!vals || !isNum(vals[s])) return out;
  let lastV = null;
  for (let i = e; i >= s; i--) if (isNum(vals[i])) { lastV = vals[i]; break; }
  if (lastV !== null) out.total = lastV / vals[s] - 1;
  const mEnd = s + m;
  if (m >= 126 && isNum(vals[mEnd])) out.yearly = Math.pow(vals[mEnd] / vals[s], 252 / m) - 1;
  const r = [], rd = [], ex = [];
  for (let t = s + 1; t <= mEnd; t++) {
    if (!isNum(vals[t]) || !isNum(vals[t - 1]) || vals[t - 1] === 0) continue;
    const x = vals[t] / vals[t - 1] - 1;
    r.push(x); rd.push(t);
    if (cashVals && isNum(cashVals[t]) && isNum(cashVals[t - 1]) && cashVals[t - 1] !== 0) ex.push(x - (cashVals[t] / cashVals[t - 1] - 1));
  }
  out.r = r; out.rd = rd;
  const sd = stdev(r);
  if (sd !== null) out.vol = sd * Math.sqrt(252);
  const sdx = stdev(ex);
  if (sdx && ex.length) out.sharpe = ((total(ex) / ex.length) * 252) / (sdx * Math.sqrt(252));
  let peak = vals[s], peakI = s, worst = 0, wPeak = s, wTrough = s, run = 0, runStart = null, best = 0, bFrom = null, bTo = null;
  for (let t = s; t <= e; t++) {
    const v = vals[t];
    if (!isNum(v)) continue;
    if (v > peak) { peak = v; peakI = t; }
    const dd = v / peak - 1;
    if (dd < worst) { worst = dd; wPeak = peakI; wTrough = t; }
    if (v < peak) { run++; if (run === 1) runStart = t; if (run > best) { best = run; bFrom = runStart; bTo = t; } } else run = 0;
  }
  out.maxdd = worst; out.ddFrom = dates[wPeak]; out.ddTo = dates[wTrough];
  out.below = lastV !== null ? lastV / peak - 1 : null; out.highDate = dates[peakI];
  out.spell = best; out.spFrom = bFrom !== null ? dates[bFrom] : null; out.spTo = bTo !== null ? dates[bTo] : null;
  if (r.length) {
    let hi = 0, lo = 0;
    for (let k = 1; k < r.length; k++) { if (r[k] > r[hi]) hi = k; if (r[k] < r[lo]) lo = k; }
    out.rise = r[hi]; out.riseDate = dates[rd[hi]]; out.fall = r[lo]; out.fallDate = dates[rd[lo]];
    out.up = r.filter((x) => x > 0).length / r.length;
  }
  return out;
}
function corr(a, ad, b, bd) {
  const mb = new Map(bd.map((t, k) => [t, b[k]]));
  const xs = [], ys = [];
  ad.forEach((t, k) => { if (mb.has(t)) { xs.push(a[k]); ys.push(mb.get(t)); } });
  if (xs.length < 3) return null;
  const mx = total(xs) / xs.length, my = total(ys) / ys.length;
  let sxy = 0, sxx = 0, syy = 0;
  for (let k = 0; k < xs.length; k++) { sxy += (xs[k] - mx) * (ys[k] - my); sxx += (xs[k] - mx) ** 2; syy += (ys[k] - my) ** 2; }
  return sxx > 0 && syy > 0 ? sxy / Math.sqrt(sxx * syy) : null;
}
function renderStats(d, D, P, range) {
  const host = $("stats-card");
  host.replaceChildren(el("h3", null, "Statistics"));
  if (!P) { host.append(el("p", { class: "empty" }, "Statistics start after the first closing value.")); return; }
  const Wn = perfWindow(P, range), m = Wn.m;
  const A = seriesStats(P.acct, P.dates, Wn, P.cash), F = seriesStats(P.fund, P.dates, Wn, P.cash), C = seriesStats(P.cash, P.dates, Wn, null);
  const needs = (from) => { const k = from - m; return `needs ${k} more trading ${plural(k, "day", "days")}`; };
  const dates2 = (a, b) => (a && b ? `${fmtDate(a)} to ${fmtDate(b)}` : "");
  const v = (x, f) => (x === undefined || x === null ? NA : f(x));
  const two = (val, sub) => (sub ? [val, el("span", { class: "l2" }, sub)] : val);
  const rows = [
    { label: "Total return", from: 1, cells: [A, F, C].map((S) => v(S.total, fmtChangePct)) },
    { label: "Yearly rate (annualised)", from: 126, cells: [A, F, C].map((S) => v(S.yearly, (x) => fmtChangePct(x) + (m < 252 ? " (short history)" : ""))) },
    { label: "Typical yearly ups and downs (volatility)", from: 20, cells: [A, F, C].map((S) => v(S.vol, fmtShare)) },
    { label: "Return per unit of ups and downs, after cash (similar to the Sharpe ratio)", from: 252, cells: [v(A.sharpe, fmtRatio), v(F.sharpe, fmtRatio), "not meaningful"] },
    { label: "Biggest fall from a high", from: 1, cells: [A, F, C].map((S) => (S.maxdd === undefined ? NA : S.maxdd > -0.00005 ? "none yet" : two(fmtChangePct(S.maxdd), dates2(S.ddFrom, S.ddTo)))) },
    { label: "Now below the high", from: 1, cells: [A, F, C].map((S) => (S.below === undefined || S.below === null ? NA : S.below > -0.00005 ? "at its high" : two(fmtChangePct(S.below), `high on ${fmtDate(S.highDate)}`))) },
    { label: "Longest spell below a previous high", from: 60, cells: [A, F, C].map((S) => (S.spell === undefined ? NA : S.spell === 0 ? "none" : two(`${S.spell} trading ${plural(S.spell, "day", "days")}`, dates2(S.spFrom, S.spTo)))) },
    { label: "Biggest daily rise", from: 5, cells: [A, F, C].map((S) => (S.rise === undefined ? NA : two(fmtChangePct(S.rise), fmtDate(S.riseDate)))) },
    { label: "Biggest daily fall", from: 5, cells: [A, F, C].map((S) => (S.fall === undefined ? NA : two(fmtChangePct(S.fall), fmtDate(S.fallDate)))) },
    { label: "Share of days up", from: 20, cells: [A, F, C].map((S) => v(S.up, fmtShare)) },
    { label: `Moves with the world fund (correlation, ${MINUS}1 to +1)`, from: 60, cells: [v(A.r && F.r ? corr(A.r, A.rd, F.r, F.rd) : null, fmtRatio), NA, NA] },
  ];
  const table = el("table", { class: "tbl stats" }, el("caption", { class: "visually-hidden" }, "Statistics for the selected range"),
    el("thead", null, el("tr", null, el("th", { scope: "col" }, "Statistic"), ["This account", "All in world fund", "All in cash"].map((h) => el("th", { scope: "col", class: "num" }, h)))));
  const body = el("tbody");
  for (const r of rows) {
    const tr = el("tr", null, el("th", { scope: "row" }, r.label));
    if (r.from > 1 && m < r.from) tr.append(el("td", { class: "num na", colspan: 3 }, needs(r.from)));
    else for (const c of r.cells) tr.append(el("td", { class: "num" }, c));
    body.append(tr);
  }
  table.append(body);
  host.append(el("div", { class: "tbl-scroll" }, table));
  host.append(infoDetails("What these mean", [
    "Figures cover the selected range. A few weeks or months say very little about what to expect.",
    el("dl", null, [
      ["Total return", "The change in value over the range."],
      ["Yearly rate", "The total return scaled to a year. It is shown from 126 trading days, marked “short history” until 252."],
      ["Typical yearly ups and downs", "How much the daily value moves, scaled to a year. Shown from 20 trading days."],
      ["Return per unit of ups and downs", "The yearly return above cash divided by its yearly ups and downs. Shown from 252 trading days."],
      ["Biggest fall from a high", "The deepest drop from a previous high, with the dates of the high and the low."],
      ["Longest spell below a previous high", "The most trading days in a row spent below an earlier high. Shown from 60 trading days."],
      ["Moves with the world fund", "From −1 to +1: how closely the account's daily moves follow the world fund's. Shown from 60 trading days."],
    ].map(([t, x]) => [el("dt", null, t), el("dd", null, x)])),
    "A reading taken during today is left out of the daily figures until its day closes.",
  ]));
}
function renderMonthly(d, D, P, range) {
  const host = $("monthly-card");
  host.replaceChildren(el("h3", null, "Monthly returns"));
  if (!P) { host.append(el("p", { class: "empty" }, "Monthly returns start after the first closing value.")); return; }
  const Wn = perfWindow(P, range);
  const months = [];
  for (let i = 1; i < P.n; i++) {
    const ym = P.dates[i].slice(0, 7);
    let mo = months[months.length - 1];
    if (!mo || mo.ym !== ym) months.push((mo = { ym, last: i }));
    mo.last = i;
  }
  const ret = (vals, k) => { if (!vals) return null; const prevI = k === 0 ? 0 : months[k - 1].last; let li = months[k].last; while (li > prevI && !isNum(vals[li])) li--; return isNum(vals[li]) && isNum(vals[prevI]) && vals[prevI] !== 0 && li > prevI ? vals[li] / vals[prevI] - 1 : null; };
  const fromYm = P.dates[Wn.s].slice(0, 7), curYm = P.dates[P.n - 1].slice(0, 7);
  const rowsData = months.map((mo, k) => ({ mo, a: ret(P.acct, k), f: ret(P.fund, k), c: ret(P.cash, k) })).filter((r) => r.mo.ym >= fromYm).reverse();
  const table = el("table", { class: "tbl" }, el("caption", { class: "visually-hidden" }, "Monthly returns"),
    el("thead", null, el("tr", null, el("th", { scope: "col" }, "Month"), ["This account", "All in world fund", "All in cash"].map((h) => el("th", { scope: "col", class: "num" }, h)))));
  const body = el("tbody"), rows = [];
  for (const r of rowsData) {
    const tr = el("tr", null, el("th", { scope: "row" }, fmtMonth(r.mo.ym) + (r.mo.ym === curYm ? " (so far)" : "")),
      el("td", { class: "num" }, isNum(r.a) ? el("span", { class: rnd(r.a * 10000) > 0 ? "gain" : rnd(r.a * 10000) < 0 ? "loss" : "" }, fmtChangePct(r.a)) : NA),
      el("td", { class: "num" }, fmtChangePct(r.f)), el("td", { class: "num" }, fmtChangePct(r.c)));
    rows.push(tr); body.append(tr);
  }
  table.append(body);
  host.append(el("div", { class: "tbl-scroll" }, table));
  if (rows.length > 12) host.append(showAllBtn(rows, 12, `Show all ${rows.length} months`, "Show the latest 12 months"));
  host.append(infoDetails("How it's worked out", ["Each month's last value divided by the previous month's last value, minus 1. The first month starts from £1,000,000, and the current month uses the latest value. Rows cover the months in the selected range."]));
}
function renderPnlClass(d, D) {
  const host = $("pnl-card");
  host.replaceChildren();
  const pc = d.pnl_by_class && typeof d.pnl_by_class === "object" ? d.pnl_by_class : null;
  const rows = pc ? arr(pc.rows).filter((r) => r && typeof r.class === "string") : [];
  if (!pc || !rows.length) { host.hidden = true; return; }
  host.hidden = false;
  host.append(el("h3", null, "Profit/loss by asset class since the start"));
  rows.sort((a, b) => ringRank(a.class) - ringRank(b.class));
  const table = el("table", { class: "tbl" }, el("caption", { class: "visually-hidden" }, "Profit or loss by asset class since the start"),
    el("thead", null, el("tr", null, el("th", { scope: "col" }, "Asset class"), ["On holdings still open", "On bets already closed or cut", "Total"].map((h) => el("th", { scope: "col", class: "num" }, h)))));
  const body = el("tbody");
  for (const r of rows) body.append(el("tr", null, el("th", { scope: "row" }, el("span", { class: "grp-name" }, swatch(CLS_KEY[r.class] || "other"), r.class)), el("td", { class: "num" }, moneySpan(r.open_gbp)), el("td", { class: "num" }, moneySpan(r.closed_gbp)), el("td", { class: "num" }, moneySpan(r.total_gbp))));
  if (isNum(pc.other_gbp)) body.append(el("tr", null, el("th", { scope: "row" }, "Interest, fees and exchange-rate effects (approximate)"), el("td", null), el("td", null), el("td", { class: "num" }, moneySpan(pc.other_gbp))));
  table.append(body);
  if (isNum(pc.account_gbp)) table.append(el("tfoot", null, el("tr", null, el("th", { scope: "row" }, "Account since the start"), el("td", null), el("td", null), el("td", { class: "num" }, moneySpan(pc.account_gbp)))));
  host.append(el("div", { class: "tbl-scroll" }, table));
  host.append(infoDetails("How it's worked out", ["Closed amounts are worked out from the recorded fills at today's exchange rates, so they are approximate. Interest, fees and exchange-rate effects take up the rest, so the column adds up to the account's change since the start. This table is not affected by the range buttons."]));
}

// ------------------------------------------------------------------ price chart (detail panel)
function drawPrice(d, D, key, h, box, ro, tableHost, trades) {
  box.replaceChildren(); ro.replaceChildren(); tableHost.replaceChildren();
  const ph = d.price_history && typeof d.price_history === "object" ? d.price_history : null;
  const dates = ph ? arr(ph.dates) : [];
  const vals = ph && key ? arr(obj(ph.close)[key]) : [];
  if (!ph || !vals.length || vals.length !== dates.length) { box.append(el("p", { class: "tbl-note" }, "Price history unavailable for this market.")); ro.hidden = true; return; }
  const nClose = vals.filter(isNum).length;
  if (nClose < 20) { box.append(el("p", { class: "tbl-note" }, "Not enough price history yet.")); ro.hidden = true; return; }
  ro.hidden = false;
  const xsD = dates.map((_, i) => i), values = vals.map((v) => (isNum(v) ? v : null));
  const lastDate = dates[dates.length - 1];
  let latest = null;
  const pT = hasTime(d.positions_time) ? d.positions_time : null;
  if (h && h.last !== null && pT && validIso(lastDate) && dateOf(pT) > dateOf(lastDate)) latest = { v: h.last, time: pT };
  const xs = latest ? [...xsD, dates.length] : xsD;
  const series = latest ? [...values, latest.v] : values;
  const fills = arr(trades).filter((o) => wentThrough(o.st) && isNum(o.price) && validIso(o.time) && dateOf(o.time) >= dateOf(dates[0]));
  const ys = series.filter(isNum).concat(h && h.avg !== null ? [h.avg] : [], fills.map((o) => o.price));
  let lo = Math.min(...ys), hi = Math.max(...ys);
  const pad = (hi - lo) * 0.05 || Math.abs(hi) * 0.01 || 1;
  lo -= pad; hi += pad;
  const stp = niceStep(hi - lo, 4);
  lo = Math.floor(lo / stp + 1e-9) * stp; hi = Math.ceil(hi / stp - 1e-9) * stp;
  const ticks = [];
  for (let k = 0, v = lo; v <= hi + stp * 1e-6 && k < 12; k++, v = lo + k * stp) ticks.push(Number(v.toPrecision(10)));
  // tick labels share one number of decimals, just enough for the step (600, 650 ... or 1.20, 1.25 ...)
  const tdec = clamp(Math.ceil(-Math.log10(stp) - 1e-9) + (Math.abs(stp / Math.pow(10, Math.floor(Math.log10(stp))) - 2.5) < 1e-9 ? 1 : 0), 0, 8);
  const tickFmt = (v) => (v < 0 ? MINUS : "") + Math.abs(v).toLocaleString("en-GB", { minimumFractionDigits: tdec, maximumFractionDigits: tdec });
  const tickW = Math.max(...ticks.map((t) => textWidth(tickFmt(t))));
  const big = window.matchMedia("(min-width: 700px)").matches;
  const W = Math.max(280, box.clientWidth || 600);
  const ml = Math.ceil(tickW) + 16;
  const xMax = xs[xs.length - 1];
  const pts = series.map((v, i) => (isNum(v) ? i : -1)).filter((i) => i >= 0);
  const dateAt = (i) => (i < dates.length ? dates[i] : dateOf(latest.time));
  const unit = h && h.isFund ? "" : "";
  const dflt = () => { const li = lastIdx(values); return `${fmtDate(dates[li])} close: ${fmtPrice(values[li])}${unit}`; };
  const xIndexOf = (iso) => { const dd = dateOf(iso); let best = -1; for (let i = 0; i < dates.length; i++) { if (dateOf(dates[i]) <= dd) best = i; else break; } if (latest && dd > dateOf(lastDate)) return dates.length; return best; };
  const chart = timeChart({
    host: box, H: big ? 240 : 200, ml, mr: 16, xs, xMax, lo, hi, ticks, tickFmt,
    xTicks: xTicksFor(dates.concat(latest ? [dateOf(latest.time)] : []), xs, 0, xs.length - 1, W - ml - 16),
    series: [{ cls: "s-acct", dotCls: "d-acct", vals: series, join: true, hollowLast: !!latest }], dotsAll: false, pts,
    aria: `Daily closing prices for ${h ? h.name : key} over about a year, in the market's own units. The same figures are in the table under About this market.`,
    onSelect: (i, announce) => {
      ro.setAttribute("aria-live", announce ? "polite" : "off");
      if (i === null) { ro.textContent = dflt(); return; }
      if (latest && i === dates.length) ro.textContent = `${fmtDate(latest.time)}, ${fmtTime(latest.time)} reading: ${fmtPrice(latest.v)}`;
      else ro.textContent = `${fmtDate(dates[i])} close: ${fmtPrice(series[i])}`;
    },
    extra: (svg, c) => {
      if (h && h.avg !== null) {
        const y = c.Y(h.avg).toFixed(1);
        svg.append(svgEl("line", { x1: c.m.l, x2: c.W - c.m.r, y1: y, y2: y, class: "avg" }));
        // the label sits at whichever end leaves the line more room, above or below it
        const nv = series.filter(isNum), q = Math.max(1, Math.floor(nv.length / 4));
        const gap = (xs2) => Math.min(...xs2.map((v) => Math.abs(c.Y(v) - c.Y(h.avg))));
        const leftRoom = gap(nv.slice(0, q)), rightRoom = gap(nv.slice(-q));
        const atLeft = leftRoom > rightRoom;
        const side = atLeft ? nv.slice(0, q) : nv.slice(-q);
        let above = side.filter((v) => v > h.avg).length <= side.length / 2;
        if (!above && Number(y) + 17 > c.H - c.m.b - 4) above = true;
        if (above && Number(y) - 20 < c.m.t) above = false;
        svg.append(svgText({ x: atLeft ? c.m.l + 4 : c.W - c.m.r, y: Number(y) + (above ? -7 : 17), "text-anchor": atLeft ? "start" : "end", class: "avg-l" }, `Average price ${fmtPrice(h.avg)}`));
      }
      for (const o of fills) {
        const xi = xIndexOf(o.time);
        if (xi < 0) continue;
        const x = c.X(xi), y = c.Y(o.price);
        const buy = o.action === "Buy";
        const label = `${fmtDate(o.time)}, ${fmtTime(o.time)}: ${buy ? "bought" : o.action === "Sell" ? "sold" : "traded"} ${o.qty !== null ? fmtQty(o.qty) + " " : ""}at ${fmtPrice(o.price)}`;
        const g = svgEl("g", { class: "mk", tabindex: 0, role: "img", "aria-label": label });
        const tri = buy ? `M${x},${y - 6}L${x + 6},${y + 4}L${x - 6},${y + 4}Z` : `M${x},${y + 6}L${x + 6},${y - 4}L${x - 6},${y - 4}Z`;
        g.append(svgEl("circle", { cx: x, cy: y, r: 22, class: "hit" }), svgEl("circle", { cx: x, cy: y, r: 11, class: "ring" }), svgEl("path", { d: tri, class: "tri" }));
        const show = () => { ro.setAttribute("aria-live", "polite"); ro.textContent = label; g.classList.add("on"); };
        const hide = () => { g.classList.remove("on"); ro.textContent = dflt(); };
        g.addEventListener("focus", show); g.addEventListener("blur", hide);
        g.addEventListener("pointerenter", show); g.addEventListener("pointerleave", hide);
        g.addEventListener("click", (e) => { e.stopPropagation(); show(); });
        svg.append(g);
      }
    },
  });
  if (chart) ro.textContent = dflt();
  // table view (inside the panel's dropdown)
  const table = el("table", { class: "tbl" }, el("caption", { class: "visually-hidden" }, "Daily closing prices"), el("thead", null, el("tr", null, el("th", { scope: "col" }, "Date"), el("th", { scope: "col", class: "num" }, "Close"))));
  const body = el("tbody"), rows = [];
  if (latest) { const tr = el("tr", null, el("th", { scope: "row" }, `${fmtDate(latest.time)}, ${fmtTime(latest.time)} reading`), el("td", { class: "num" }, fmtPrice(latest.v))); rows.push(tr); body.append(tr); }
  for (let i = dates.length - 1; i >= 0; i--) if (isNum(values[i])) { const tr = el("tr", null, el("th", { scope: "row" }, fmtDate(dates[i])), el("td", { class: "num" }, fmtPrice(values[i]))); rows.push(tr); body.append(tr); }
  table.append(body);
  tableHost.append(el("p", null, el("strong", null, "Prices as a table")), el("div", { class: "tbl-scroll" }, table));
  if (rows.length > 30) tableHost.append(showAllBtn(rows, 30, `Show all ${rows.length} prices`, "Show the latest 30"));
}

// ------------------------------------------------------------------ Risk tab
function renderRisk(d, D) {
  guard("risk figures", "risk-tiles", () => renderRiskTiles(d, D));
  guard("risk spread", "risk-spread", () => renderRiskSpread(d, D));
  guard("risk donuts", "risk-donuts", () => renderRiskDonuts(d, D));
  guard("contributors", "contrib-card", () => renderContrib(d, D));
  guard("risk by class", "risk-class-card", () => renderRiskClass(d, D));
}
function renderRiskTiles(d, D) {
  const host = $("risk-tiles");
  host.replaceChildren(el("h3", null, "How big the swings could be"));
  const rm = D.rm, nav = D.nav, r = D.risk;
  const tiles = el("div", { class: "tiles t3" });
  if (rm && isNum(rm.together_gbp)) {
    tiles.append(tile("Typical yearly swing, whole account", fmtAbout(rm.together_gbp), nav ? `${fmtShare(rm.together_gbp / nav)} of the account · allows for offsets` : "allows for offsets"));
    tiles.append(tile("A bad day (1 day in 20)", isNum(rm.bad_day_gbp) ? fmtAbout(rm.bad_day_gbp, 100) + " or worse" : NA, "past year, today's holdings"));
    tiles.append(tile("Worst day in the past year", isNum(rm.worst_day_gbp) ? fmtAbout(rm.worst_day_gbp, 100) : NA, validIso(rm.worst_day_date) ? fmtDate(rm.worst_day_date, true) : null));
  } else tiles.append(tile("Whole-account swing", D.rmAbsent ? "Not available today" : "Not available yet", D.rmAbsent ? null : "Needs at least 200 days of price history for the holdings.", "wide"));
  host.append(tiles);
  const aims = isNum(r.trend) && r.trend > 0 ? `The system aims for about ${Math.round(r.trend * 100)}% a year on the futures` + (isNum(r.beta) && r.beta > 0 ? `, and about ${Math.round(Math.sqrt(r.trend ** 2 + r.beta ** 2) * 100)}% for the whole account once the world fund is fully bought.` : ".") : null;
  host.append(infoDetails("What these mean", [
    "Rough estimates from the past year's prices, for today's holdings. They are not the most that could be lost: bad years can be much bigger.",
    "The yearly swing allows for holdings that move together or against each other. It is the only whole-account yearly risk figure on this page.",
    "A bad day: on 1 day in 20 over the past year, today's holdings would have lost this much or more. The worst day is the single biggest daily loss.",
    aims,
  ]));
}
function renderRiskSpread(d, D) {
  const host = $("risk-spread");
  host.replaceChildren(el("h3", null, "How the holdings are spread"));
  if (!D.holdings.length) { host.append(el("p", { class: "empty" }, "Holdings appear after the first evening snapshot (21:35 UK time).")); return; }
  const nav = D.nav, H = D.holdings, T = D.tot;
  const longF = total(H.filter((h) => h.dir === "long").map((h) => h.exp || 0)), shortF = total(H.filter((h) => h.dir === "short").map((h) => h.exp || 0));
  const net = longF - shortF;
  const shareOf = (dir) => (D.swingAll ? total(H.filter((h) => h.dir === dir).map((h) => h.share)) : null);
  const tiles = el("div", { class: "tiles" });
  tiles.append(tile("Face value, all holdings", nav ? el("span", null, fmtMult(T.face / nav), el("small", null, "the account")) : fmtGBP(T.face), `${fmtGBP(T.face)} in all`));
  tiles.append(tile("Net face value", nav ? el("span", null, fmtMult(net / nav), el("small", null, net < 0 ? "towards falling prices" : net > 0 ? "towards rising prices" : "")) : fmtGBP(Math.abs(net)), net === 0 ? "rising and falling balance" : `${fmtGBP(Math.abs(net))} more on ${net < 0 ? "falling than rising" : "rising than falling"} prices`));
  const sl = shareOf("long"), ss = shareOf("short");
  tiles.append(tile("Rising bets", `${T.nLong} ${plural(T.nLong, "holding", "holdings")}`, sl !== null ? `${fmtShare(sl)} of the risk, on its own` : null));
  tiles.append(tile("Falling bets", `${T.nShort} ${plural(T.nShort, "holding", "holdings")}`, ss !== null ? `${fmtShare(ss)} of the risk, on its own` : null));
  host.append(tiles, infoDetails("What these mean", [
    "Face value is the full value of the contracts. Futures need only a deposit, so face values add up to more than the account.",
    "Net face value is the face value on rising bets minus the face value on falling bets.",
    "The risk shares count each holding on its own (its typical yearly swing), as if nothing else were held.",
  ]));
}
function renderRiskDonuts(d, D) {
  const host = $("risk-donuts");
  host.replaceChildren(el("h3", null, "Where the risk and money are"));
  if (!D.holdings.length) { host.append(el("p", { class: "empty" }, "Holdings appear after the first evening snapshot (21:35 UK time).")); return; }
  const T = D.tot;
  const donuts = [];
  const focusAll = (id) => donuts.forEach((x) => x.setFocus(id));
  const pin = UI.riskPin && D.cByName[UI.riskPin] ? UI.riskPin : null;
  const pick = (id) => { UI.riskPin = UI.riskPin === id ? null : id; rerender("risk", { keepScroll: true }); };
  const mk = {
    risk: () => (D.swingAll ? donutOrText(classSlices(D, "risk"), { aria: "Share of the risk by asset class. The same figures are in the table.", centre: [`${T.n} ${plural(T.n, "holding", "holdings")}`, `${D.classes.length} asset ${plural(D.classes.length, "class", "classes")}`], oneText: (c) => `All of the risk is in ${c}.`, checkRing: true, onPick: pick, pinned: pin })
      : { node: el("p", { class: "dn-msg" }, "Risk shares appear once each holding's typical yearly swing is available.") }),
    face: () => donutOrText(classSlices(D, "face"), { aria: "Face value by asset class. The same figures are in the table.", centre: [fmtCompactGBP(T.face), "face value"], oneText: (c) => `All of the face value is in ${c}.`, checkRing: true, onPick: pick, pinned: pin }),
  };
  const cRows = D.holdings.some((h) => !h.isFund && h.ccy) ? currencyRows(D) : [];
  const ccyDonuts = [];
  const ccyFocus = (id) => ccyDonuts.forEach((x) => x.setFocus(id));
  const cpin = UI.ccyPin && cRows.some((r) => r.id === UI.ccyPin) ? UI.ccyPin : null;
  const cpick = (id) => { UI.ccyPin = UI.ccyPin === id ? null : id; rerender("risk", { keepScroll: true }); };
  mk.ccy = () => (cRows.length ? donutOrText(cRows.map((r) => ({ id: r.id, key: r.key, label: capFirst(r.label), value: r.face })).filter((s) => s.value > 0), { aria: "Currency the contracts are priced in. The same figures are in the table.", centre: [String(cRows.length), plural(cRows.length, "currency", "currencies")], oneText: (c) => `Every contract is priced in ${c.toLowerCase()}.`, onPick: cpick, pinned: cpin })
    : { node: el("p", { class: "dn-msg" }, "Currency figures are not available today.") });
  const fig = (caption, r, list) => { if (r.dn) list.push(r.dn); return el("figure", { class: "dn" }, el("figcaption", null, caption), r.node); };
  const CAP = { risk: "Share of the risk by asset class", face: "Face value by asset class", ccy: "Currency the contracts are priced in" };
  const classTable = () => el("div", { class: "legend-wrap" }, classLegend(D, { onFocus: focusAll, pressed: pin, onPick: pick, compact: isPhone(), cols: isPhone() ? ["faceShare", "riskShare", "n"].filter((k) => k !== "riskShare" || D.swingAll) : D.swingAll ? ["face", "faceShare", "riskShare", "n"] : ["face", "faceShare", "n"] }));
  const ccyTable = () => (cRows.length ? el("div", { class: "legend-wrap" }, currencyLegend(D, cRows, ccyFocus, cpin, cpick)) : null);
  const hasCcy = cRows.length > 0;
  if (isDesk()) {
    host.append(el("div", { class: "alloc-grid" + (hasCcy ? " three" : "") }, fig(CAP.risk, mk.risk(), donuts), fig(CAP.face, mk.face(), donuts), hasCcy ? fig(CAP.ccy, mk.ccy(), ccyDonuts) : null));
    host.append(el("div", { class: "legend-pair" + (hasCcy ? "" : " one") }, classTable(), ccyTable()));
  } else {
    let mode = ["risk", "face", "ccy"].includes(UI.donut) ? (UI.donut === "risk" && !D.swingAll ? "face" : UI.donut) : D.swingAll ? "risk" : "face";
    if (mode === "ccy" && !hasCcy) mode = "face";
    const opts = [{ id: "risk", label: "Risk", disabled: !D.swingAll }, { id: "face", label: "Face value" }];
    if (hasCcy) opts.push({ id: "ccy", label: "Currency" });
    host.append(el("div", { class: "seg-row" }, segmented("Chart", opts, mode, (id) => { UI.donut = id; saveUI(); rerender("risk"); })));
    host.append(fig(CAP[mode], mk[mode](), mode === "ccy" ? ccyDonuts : donuts));
    host.append(mode === "ccy" ? ccyTable() || el("span") : classTable());
  }
  host.append(infoDetails("What this shows", [
    takeaway(D),
    "Share of the risk counts each holding on its own (its typical yearly swing). The tables below allow for offsets.",
    "The currency chart is not currency risk: it shows which currency each contract is priced in. Bets on currencies themselves are under Currencies. The world fund counts as pounds.",
  ]));
}
function renderContrib(d, D) {
  const host = $("contrib-card");
  host.replaceChildren(el("h3", null, "Top risk contributors"));
  if (!D.holdings.length) { host.append(el("p", { class: "empty" }, "Holdings appear after the first evening snapshot (21:35 UK time).")); return; }
  const hasAfter = D.holdings.some((h) => h.after !== null);
  const ranked = D.holdings.slice().sort((a, b) => (hasAfter ? (b.after ?? -9) - (a.after ?? -9) : (b.share ?? -9) - (a.share ?? -9)));
  const top = ranked.slice(0, 10);
  const neg = hasAfter ? ranked.slice(10).filter((h) => h.after !== null && h.after < 0).sort((a, b) => a.after - b.after) : [];
  const first = [...top, ...neg], rest = ranked.filter((h) => !first.includes(h));
  const afterTxt = (h) => (h.after === null ? NA : fmtShare(h.after) + (h.after < 0 ? " (offsets others)" : ""));
  const rowsAll = [];
  if (isPhone()) {
    const ul = el("ul", { class: "hl" });
    ul.append(el("li", { class: "hl-head" }, el("span", null, "Holding"), el("span", { class: "r" }, hasAfter ? "Share after offsets" : "Share on its own")));
    for (const h of [...first, ...rest]) {
      const li = el("li", { class: "hl-order" }, el("div", { class: "l1" }, el("span", null, h.name), el("span", { class: "tnum" }, hasAfter ? afterTxt(h) : fmtShare(h.share))), el("div", { class: "l2" }, hasAfter ? `${posText(h)} · on its own ${fmtShare(h.share)}` : posText(h)));
      rowsAll.push(li); ul.append(li);
    }
    host.append(ul);
  } else {
    const table = el("table", { class: "tbl" }, el("caption", { class: "visually-hidden" }, "Top risk contributors"),
      el("thead", null, el("tr", null, el("th", { scope: "col" }, "Instrument"), el("th", { scope: "col" }, "Position"), ["Typical yearly swing (on its own)", "Share of the risk on its own", hasAfter ? "Share after offsets" : null, "Signal"].filter(Boolean).map((x) => el("th", { scope: "col", class: "num" }, x)))));
    const body = el("tbody");
    for (const h of [...first, ...rest]) {
      const tr = el("tr", null, el("th", { scope: "row" }, h.name), el("td", null, posNode(h)), el("td", { class: "num" }, fmtGBP(h.swing)), el("td", { class: "num" }, fmtShare(h.share)), hasAfter ? el("td", { class: "num" }, afterTxt(h)) : null, el("td", { class: "num" }, h.isFund ? NA : fmtSignal(h.signal)));
      rowsAll.push(tr); body.append(tr);
    }
    table.append(body);
    host.append(el("div", { class: "tbl-scroll" }, table));
  }
  if (rest.length) {
    let all = UI.contribAll;
    const btn = el("button", { type: "button", class: "btn", "aria-expanded": String(all) });
    const apply = () => { rowsAll.forEach((r, i) => { r.hidden = !all && i >= first.length; }); btn.textContent = all ? "Show fewer" : `Show all ${rowsAll.length}`; btn.setAttribute("aria-expanded", String(all)); };
    btn.addEventListener("click", () => { all = !all; UI.contribAll = all; apply(); });
    apply();
    btn.style.marginTop = "12px";
    host.append(btn);
  }
  host.append(infoDetails("What this shows", [
    "Each holding's share of the whole account's swing, allowing for holdings that move together or against each other over the past year. A negative share means the holding offsets others.",
    hasAfter ? null : "Shares after offsets are not available today, so the list is in order of each holding's share on its own.",
  ]));
}
function renderRiskClass(d, D) {
  const host = $("risk-class-card");
  host.replaceChildren(el("h3", null, "Risk by asset class"));
  if (!D.holdings.length) { host.append(el("p", { class: "empty" }, "Holdings appear after the first evening snapshot (21:35 UK time).")); return; }
  const nav = D.nav, phone = isPhone();
  const anyAfter = D.classes.some((c) => c.after !== null);
  const heads = (phone ? ["Holdings (long / short)", "On its own", "After offsets"] : ["Holdings (long / short)", "Face value", "× account", "On its own", "After offsets"]).filter((x) => anyAfter || x !== "After offsets");
  const table = el("table", { class: "tbl" }, el("caption", { class: "visually-hidden" }, "Risk by asset class"),
    el("thead", null, el("tr", null, el("th", { scope: "col" }, "Asset class"), heads.map((x) => el("th", { scope: "col", class: "num" }, x)))));
  const body = el("tbody");
  for (const c of D.classes) body.append(el("tr", null, el("th", { scope: "row" }, el("span", { class: "grp-name" }, swatch(c.key), c.cls)), el("td", { class: "num" }, `${c.n} (${c.nLong} / ${c.nShort})`),
    phone ? null : el("td", { class: "num" }, fmtGBP(c.face)), phone ? null : el("td", { class: "num" }, nav ? fmtMult(c.face / nav) : NA),
    el("td", { class: "num" }, fmtShare(c.share)), anyAfter ? el("td", { class: "num" }, fmtShare(c.after)) : null));
  table.append(body);
  host.append(el("div", { class: "tbl-scroll" }, table));
  let gapTxt = null;
  const cand = D.classes.filter((c) => c.share !== null && c.after !== null).sort((a, b) => Math.abs(b.after - b.share) - Math.abs(a.after - a.share))[0];
  if (cand) gapTxt = cand.cls === "World fund" ? `World fund is ${fmtShare(cand.share)} on its own but ${fmtShare(cand.after)} after offsets.` : `${cand.cls} are ${fmtShare(cand.share)} on their own but ${fmtShare(cand.after)} after offsets.`;
  host.append(infoDetails("What the columns mean", ["On its own counts each holding as if nothing else were held; the donuts use this. After offsets allows for holdings that tend to move together or against each other, so a class can count for less or more than on its own." + (gapTxt ? " " + gapTxt : ""), anyAfter ? null : "Shares after offsets are not available today."]));
}

// ------------------------------------------------------------------ Signals tab
function renderSignals(d, D) {
  guard("signals", "sig-card", () => renderSignalsInner(d, D));
}
function renderSignalsInner(d, D) {
  const ctl = $("sig-controls"), table = $("signals-table"), nobet = $("nobet"), help = $("sig-help"), asof = $("signals-asof");
  ctl.replaceChildren(); table.replaceChildren(); help.replaceChildren();
  $("h-signals").textContent = D.signals.length ? `Signals for all ${D.signals.length} markets` : "Signals";
  asof.textContent = validIso(d.signals_asof) ? `As of the ${whenText(d.signals_asof)} run.` : "";
  if (!D.signals.length) { nobet.hidden = true; table.hidden = true; ctl.append(el("p", { class: "empty" }, "Signals appear after the first daily run.")); return; }
  table.hidden = false;
  if (D.noBet.length) { nobet.hidden = false; nobet.replaceChildren(el("strong", null, "No bet held: "), el("span", null, D.noBet.map((s) => s.short).join(", ") + ".")); } else nobet.hidden = true;
  const filters = [{ id: "all", label: "All", n: D.signals.length }, { id: "held", label: "Held", n: D.signals.filter((s) => s.held).length }, { id: "nobet", label: "No bet", n: D.noBet.length }];
  for (const c of RING) { const n = D.signals.filter((s) => s.cls === c).length; if (n) filters.push({ id: "cls:" + c, label: c, n }); }
  if (!filters.some((f) => f.id === UI.sig.filter)) UI.sig.filter = "all";
  if (isPhone()) ctl.append(el("div", { class: "ctl-row" }, el("div", { style: "flex:1 1 100%" }, selectBox("sig-show", "Show", filters.map((f) => ({ id: f.id, label: `${f.label} (${f.n})` })), UI.sig.filter, (v) => { UI.sig.filter = v; rerender("signals"); }))));
  else ctl.append(el("div", { class: "ctl-row" }, el("div", { class: "chips", role: "group", "aria-label": "Show" }, filters.map((f) => chipBtn(f.label, f.n, UI.sig.filter === f.id, () => { UI.sig.filter = f.id; rerender("signals"); })))));
  const phone = isPhone();
  const hasSw = D.signals.some((s) => s.hasCswing);
  const cols = [{ k: "name", h: "Market" }, { k: "signal", h: "Signal", h2: `(${MINUS}20 to +20)`, num: true }];
  if (!phone) cols.push({ k: "lean", h: "Leans towards" });
  cols.push({ k: "trend", h: "Price trend part", num: true }, { k: "carry", h: "Pays-to-hold part", num: true });
  if (!phone && hasSw) cols.push({ k: "cswing", h: "One contract's typical yearly swing", num: true });
  const st = { key: UI.sig.key, dir: UI.sig.dir };
  const onSort = (k) => { if (UI.sig.key === k) UI.sig.dir = UI.sig.dir === "asc" ? "desc" : "asc"; else { UI.sig.key = k; UI.sig.dir = k === "name" || k === "lean" ? "asc" : "desc"; } rerender("signals"); };
  table.append(el("caption", { class: "visually-hidden" }, "Signals for every market"), el("thead", null, el("tr", null, cols.map((c) => sortHeader(c, st, onSort)))));
  const val = { name: (s) => s.short.toLowerCase(), signal: (s) => s.signal, lean: (s) => lean(s.signal), trend: (s) => s.trend, carry: (s) => (s.carryUsed ? s.carry : null), cswing: (s) => s.cswing };
  const cmp = (a, b) => { const va = val[st.key](a), vb = val[st.key](b); if (va === null && vb === null) return 0; if (va === null) return 1; if (vb === null) return -1; const r = typeof va === "string" ? va.localeCompare(vb) : va - vb; return (st.dir === "asc" ? r : -r) || a.short.localeCompare(b.short); };
  const pass = (s) => UI.sig.filter === "all" || (UI.sig.filter === "held" && s.held) || (UI.sig.filter === "nobet" && !s.held) || (UI.sig.filter.startsWith("cls:") && s.cls === UI.sig.filter.slice(4));
  for (const c of RING) {
    const items = D.signals.filter((s) => s.cls === c && pass(s)).sort(cmp);
    if (!items.length) continue;
    const tb = el("tbody");
    const nHeld = items.filter((s) => s.held).length;
    tb.append(el("tr", { class: "grp" }, el("th", { scope: "rowgroup", colspan: cols.length }, el("span", { class: "grp-name" }, swatch(CLS_KEY[c]), c, el("span", { class: "rest" }, ` · ${items.length} ${plural(items.length, "market", "markets")}, ${nHeld} held`)))));
    for (const s of items) {
      const open = UI.sig.open === s.slug;
      const h = s.held;
      const l2 = h ? `Held: ${h.dir === "long" ? "▲" : "▼"} ${posText(h)}` + (phone ? ` · leans ${lean(s.signal)}` : h.month ? ` · ${fmtMonth(h.month)}` : "") : "No bet held" + (phone ? ` · leans ${lean(s.signal)}` : "");
      const btn = el("button", { type: "button", class: "row-open", "aria-expanded": String(open), "aria-controls": "ds-" + s.slug }, el("span", { class: "nm" }, s.name), el("span", { class: "l2" }, l2));
      const tr = el("tr", { class: "row" + (open ? " open" : "") }, el("th", { scope: "row" }, btn), el("td", { class: "num" }, fmtSignal(s.signal)));
      if (!phone) tr.append(el("td", { class: "lean" }, lean(s.signal)));
      tr.append(el("td", { class: "num" }, fmtSignal(s.trend)), el("td", { class: "num" }, s.carryUsed ? fmtSignal(s.carry) : el("span", { class: "na" }, "not used")));
      if (!phone && hasSw) tr.append(el("td", { class: "num" }, s.cswing === null ? NA : fmtGBP(s.cswing)));
      tr.addEventListener("click", (e) => { if (!e.target.closest("button")) btn.click(); });
      btn.addEventListener("click", () => toggleSig(s.slug));
      tb.append(tr);
      if (open) tb.append(detailRow(d, D, h, cols.length, "signals", s));
    }
    table.append(tb);
  }
  help.append(infoDetails("What the columns mean", [
    "A holding's size follows its signal; a market with a weak signal may hold nothing.",
    el("dl", null, [
      ["Signal", "How strongly the system leans towards rising (+) or falling (−) prices, from −20 to +20."],
      ["Leans towards", "Rising or falling, or neither when the signal is between −1 and +1."],
      ["Price trend", "Whether the price has been rising or falling over recent weeks and months."],
      ["Pays to hold", "Whether holding the contract earns or costs money while prices stay still. Some markets do not use it."],
      ["One contract's typical yearly swing", "How much one contract might gain or lose in an ordinary year. A market with a weak signal and a large contract may hold none."],
    ].map(([t, x]) => [el("dt", null, t), el("dd", null, x)])),
    "Tap a market for its price chart and trades.",
  ]));
}
const lean = (v) => (!isNum(v) ? NA : Math.abs(v) < 1 ? "neither" : v > 0 ? "rising" : "falling");

// ------------------------------------------------------------------ Orders tab
function renderOrders(d, D) { guard("orders", "orders-card", () => renderOrdersInner(d, D)); }
function renderOrdersInner(d, D) {
  const days = $("order-days"), log = $("orders-log"), cap = $("orders-cap"), help = $("orders-help");
  days.replaceChildren(); log.replaceChildren(); help.replaceChildren();
  if (!D.runs.length) { cap.hidden = true; log.append(el("p", { class: "empty" }, "No orders yet. The first daily run is at about 16:05 UK time on a weekday.")); return; }
  const dates = D.days.map((x) => x.date);
  if (UI.orders.day !== "all" && !dates.includes(UI.orders.day)) UI.orders.day = "all";
  const n = (date) => D.days.find((x) => x.date === date).runs.reduce((a, r) => a + r.orders.length, 0);
  const row = el("div", { class: "ctl-row" });
  const chips = el("div", { class: "chips", role: "group", "aria-label": "Day" });
  chips.append(chipBtn("All", null, UI.orders.day === "all", () => { UI.orders.day = "all"; rerender("orders"); }));
  for (const dt of dates.slice(0, 5)) chips.append(chipBtn(fmtDate(dt), n(dt), UI.orders.day === dt, () => { UI.orders.day = dt; rerender("orders"); }));
  row.append(chips);
  if (dates.length > 5) {
    const older = dates.slice(5);
    row.append(el("div", { style: "min-width:180px" }, selectBox("orders-older", "Older", [{ id: "", label: "Choose a day" }, ...older.map((x) => ({ id: x, label: `${fmtDate(x)} (${n(x)})` }))], older.includes(UI.orders.day) ? UI.orders.day : "", (v) => { if (v) { UI.orders.day = v; rerender("orders"); } })));
  }
  days.append(row);
  const runs = D.runs.filter((r) => UI.orders.day === "all" || r.date === UI.orders.day);
  const notThrough = (o) => ["held", "notfilled", "nofill", "partly", "unknown"].includes(o.st.kind);
  const ordered = (r) => [...r.orders.filter(notThrough), ...r.orders.filter((o) => !notThrough(o))];
  const runHead = (r) => `${fmtDate(r.start)}, ${fmtTime(r.start)} · ${r.label} · ${runCountText(r.c, r.orders.length)}`;
  const qtyName = (o) => [o.action ? o.action + (o.qty !== null ? " " + fmtQty(o.qty) : "") : null, o.short].filter(Boolean).join(" · ");
  if (isPhone()) {
    const ul = el("ul", { class: "hl" });
    for (const r of runs) {
      ul.append(el("li", { class: "hl-run", role: "heading", "aria-level": "3" }, runHead(r)));
      for (const o of ordered(r)) {
        const why = plainWhy(intendedWhy(o.t.why, o.st));
        ul.append(el("li", { class: "hl-order" }, el("div", { class: "l1" }, el("span", null, qtyName(o)), el("span", { class: "st-w" }, statusNode(o, true))), why ? el("div", { class: "l2" }, why) : null));
      }
    }
    log.append(ul);
  } else {
    const table = el("table", { class: "tbl orders" }, el("caption", { class: "visually-hidden" }, "Orders, run by run, newest first"),
      el("thead", null, el("tr", null, el("th", { scope: "col" }, "Instrument"), el("th", { scope: "col" }, "Action"), el("th", { scope: "col", class: "num" }, "Quantity"), el("th", { scope: "col", class: "num" }, "Price"), el("th", { scope: "col" }, "Status"), el("th", { scope: "col" }, "What it did"))));
    for (const r of runs) {
      const tb = el("tbody");
      tb.append(el("tr", { class: "run-row" }, el("th", { scope: "rowgroup", colspan: 6 }, runHead(r))));
      for (const o of ordered(r)) {
        tb.append(el("tr", null,
          el("th", { scope: "row" }, el("span", { class: "nm" }, o.name), o.month ? el("span", { class: "l2" }, fmtMonth(o.month)) : null),
          el("td", null, o.action || NA), el("td", { class: "num" }, o.qty === null ? NA : fmtQty(o.qty)), el("td", { class: "num" }, fmtPrice(o.price)),
          el("td", null, statusNode(o, false)), el("td", { class: "why" }, plainWhy(intendedWhy(o.t.why, o.st)))));
      }
      table.append(tb);
    }
    log.append(el("div", { class: "tbl-scroll" }, table));
  }
  const shown = D.trades.length, tt = isNum(d.trades_total) ? d.trades_total : null;
  cap.hidden = false;
  cap.textContent = tt !== null && tt > shown ? `Showing the latest ${shown} of ${tt} orders (whole runs only).` : `Showing the latest ${shown} ${plural(shown, "order", "orders")}.`;
  const multi = D.days.some((x) => x.runs.length > 1);
  help.append(infoDetails("What the statuses mean", [
    multi ? "Some days have more than one run. Later runs can undo parts of earlier ones." : null,
    el("dl", null, [
      ["Filled", "The order went through at the price shown."],
      ["Held back: market closed", "The order was not sent because its market had closed. It goes at the next daily run, and is not a problem."],
      ["Not filled", "The order was sent but did not go through, for the reason given."],
      ["Partly filled", "Only part of the order went through."],
      ["Awaiting fill", "Sent, and waiting for the broker to confirm the fill."],
      ["No fill recorded", "No fill was found for the order by the next snapshot."],
    ].map(([t, x]) => [el("dt", null, t), el("dd", null, x)])),
    "Prices are in each market's own quoted units. Run labels: a set-up run built the starting positions on day 1; a daily run starts at about 16:05; a late daily run starts after 17:00.",
  ]));
}

// ------------------------------------------------------------------ Notes (v1 rendering) and About
function noteBody(html) {
  const b = el("div", { class: "log-body" });
  b.innerHTML = String(html || ""); // built from HTML-escaped text by the exporter
  for (const p of [...b.querySelectorAll("p")]) {
    const kids = [...p.childNodes].filter((k) => !(k.nodeType === 3 && !k.nodeValue.trim()));
    if (kids.length === 1 && kids[0].nodeName === "STRONG") p.replaceWith(el("h4", { class: "log-sub" }, kids[0].textContent.trim().replace(/:\s*$/, "")));
  }
  return b;
}
function renderNotes(d) {
  guard("notes", "log-entries", () => {
    const host = $("log-entries");
    host.replaceChildren();
    const log = arr(d.log).filter((e) => e && typeof e === "object" && (e.title || e.html));
    if (!log.length) { host.append(el("p", { class: "empty" }, "No notes yet. A note is written after each trading day.")); return; }
    const first = log[0];
    const art = el("article", { class: "entry" }, el("h3", null, String(first.title || "Note")));
    const body = noteBody(first.html);
    art.append(body);
    host.append(art);
    if (body.scrollHeight > 400) {
      body.classList.add("clamped");
      const btn = el("button", { type: "button", class: "btn", "aria-expanded": "false" }, "Read the whole entry");
      btn.addEventListener("click", () => {
        const open = body.classList.toggle("clamped") === false;
        btn.textContent = open ? "Show less" : "Read the whole entry";
        btn.setAttribute("aria-expanded", String(open));
        if (!open && art.getBoundingClientRect().top < 0) art.scrollIntoView({ block: "start" });
      });
      art.append(btn);
    }
    const noteDetails = (e) => { const dt = el("details", { class: "note-d" }); dt.append(el("summary", null, el("h3", { class: "note-title" }, String(e.title || "Note"))), noteBody(e.html)); return dt; };
    const rest = log.slice(1, 10);
    if (rest.length) host.append(el("div", { class: "notes-rest" }, rest.map(noteDetails)));
    if (log.length > 10) {
      const older = el("details", { class: "note-d older" });
      older.append(el("summary", null, el("span", { class: "note-title" }, `Older notes (${log.length - 10})`)));
      log.slice(10).forEach((e) => older.append(noteDetails(e)));
      host.lastChild.append(older);
    }
  });
}
function renderAbout(d) {
  const r = obj(d.risk);
  if (isNum(r.trend) && r.trend > 0) {
    $("risk-futures").textContent = Math.round(r.trend * 100) + "%";
    if (isNum(r.beta) && r.beta > 0) $("risk-total").textContent = Math.round(Math.sqrt(r.trend * r.trend + r.beta * r.beta) * 100) + "%";
  }
}

// ------------------------------------------------------------------ routing, tabs, phone bar
const TABS = ["portfolio", "performance", "risk", "signals", "orders", "notes", "about"];
const OLD = { summary: "portfolio", bets: "portfolio", status: "portfolio", doing: "portfolio", growth: "performance", how: "about" };
let CUR = { tab: null, slug: null };
let fromTabClick = false;
function parseHash() {
  let h = "";
  try { h = decodeURIComponent(location.hash.replace(/^#/, "")); } catch (e) { h = ""; }
  const parts = h.split("/");
  let tab = parts[0] || "";
  if (OLD[tab]) tab = OLD[tab];
  if (!TABS.includes(tab)) tab = "portfolio";
  const slug = parts[1] && /^[a-z0-9-]+$/.test(parts[1]) ? parts[1] : null;
  return { tab, slug };
}
const rendered = {};
const RENDER = {
  portfolio: (d, D) => { guard("holdings note", "holdings-asof", () => renderHoldingsAsof(d)); guard("glance", "glance", () => renderGlance(d, D)); guard("allocation", "alloc", () => renderAlloc(d, D)); guard("holdings", "hold-card", () => renderHoldings(d, D)); },
  performance: renderPerformance, risk: renderRisk, signals: renderSignals, orders: renderOrders,
  notes: (d) => renderNotes(d), about: (d) => guard("about", null, () => renderAbout(d)),
};
let DATA = null, DER = null;
function rerender(tab, opts) {
  if (!DATA) return;
  const y = window.scrollY;
  pendingDraw = [];
  rendered[tab] = true;
  RENDER[tab](DATA, DER);
  flushDraws();
  if (opts && opts.keepScroll) window.scrollTo(0, y);
}
function ensureRendered(tab) { if (!rendered[tab]) rerender(tab); }
function showTab(tab, clicked) {
  for (const p of document.querySelectorAll("#panels > section")) p.hidden = p.dataset.tab !== tab;
  for (const a of document.querySelectorAll(".tablist a")) {
    const on = a.dataset.tab === tab;
    a.setAttribute("aria-selected", String(on));
    if (on) a.setAttribute("aria-current", "page"); else a.removeAttribute("aria-current");
  }
  for (const a of document.querySelectorAll("#more-menu a")) { if (a.getAttribute("href") === "#" + tab) a.setAttribute("aria-current", "page"); else a.removeAttribute("aria-current"); }
  $("more-btn").classList.toggle("on", ["signals", "notes", "about"].includes(tab));
  ensureRendered(tab);
  if (clicked) {
    const panel = $("p-" + tab), h2 = panel.querySelector("h2");
    if (isPhone()) window.scrollTo(0, Math.max(0, panel.getBoundingClientRect().top + window.scrollY - 8));
    else { const nav = $("tabs"); if (nav.getBoundingClientRect().top < 0) nav.scrollIntoView({ block: "start" }); }
    if (h2) { try { h2.focus({ preventScroll: true }); } catch (e) { h2.focus(); } }
  }
}
function route() {
  const clicked = fromTabClick;
  fromTabClick = false;
  const { tab, slug } = parseHash();
  const rawTab = location.hash.replace(/^#/, "").split("/")[0];
  if (OLD[rawTab]) { try { history.replaceState(null, "", "#" + tab); } catch (e) { /* file:// */ } }
  const tabChanged = tab !== CUR.tab;
  CUR = { tab, slug };
  if (!DATA) return;
  showTab(tab, clicked && tabChanged);
  if (tab === "portfolio" || tab === "signals") {
    const st = tab === "portfolio" ? UI.hold : UI.sig;
    const valid = slug && (tab === "portfolio" ? DER.holdings.some((h) => h.slug === slug) : DER.signals.some((s) => s.slug === slug));
    const want = valid ? slug : null;
    if (st.open !== want) {
      st.open = want;
      if (tab === "portfolio" && want) UI.hold.filter = DER.holdings.some((h) => h.slug === want && passFilter(h, UI.hold.filter)) ? UI.hold.filter : "all";
      if (tab === "signals" && want) UI.sig.filter = "all";
      rerender(tab, { keepScroll: true });
    }
    if (want && !clicked) {
      const btn = document.querySelector(`#p-${tab} [aria-controls="${tab === "signals" ? "ds-" : "d-"}${want}"]`);
      const row = btn ? btn.closest("tr, li") : null;
      if (row) setTimeout(() => window.scrollTo(0, Math.max(0, row.getBoundingClientRect().top + window.scrollY - 12)), 0);
    }
  }
}
function setupNav() {
  for (const a of document.querySelectorAll(".tablist a, #more-menu a, a.jump[href='#about']")) a.addEventListener("click", () => { fromTabClick = true; closeMore(); });
  const btn = $("more-btn"), menu = $("more-menu");
  btn.addEventListener("click", (e) => { e.stopPropagation(); if (menu.hidden) openMore(); else closeMore(); });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !menu.hidden) { closeMore(); btn.focus(); } });
  document.addEventListener("pointerdown", (e) => { if (!menu.hidden && !e.target.closest("#more-menu") && !e.target.closest("#more-btn")) closeMore(); });
  $("to-top").addEventListener("click", (e) => { e.preventDefault(); window.scrollTo(0, 0); try { $("account").focus({ preventScroll: true }); } catch (x) { /* old browsers */ } });
  window.addEventListener("hashchange", route);
  window.addEventListener("popstate", route);
}
function openMore() { const menu = $("more-menu"); menu.hidden = false; $("more-btn").setAttribute("aria-expanded", "true"); const a = menu.querySelector("a"); if (a) a.focus(); }
function closeMore() { $("more-menu").hidden = true; $("more-btn").setAttribute("aria-expanded", "false"); }

// ------------------------------------------------------------------ boot
function guard(name, hostId, fn) {
  try { fn(); } catch (e) {
    console.error(name, e);
    const host = hostId ? $(hostId) : null;
    if (host) { host.hidden = false; host.replaceChildren(el("p", { class: "fail" }, FAIL)); }
  }
}
function start(d) {
  DATA = d;
  GEN_YEAR = validIso(d.generated) ? Number(d.generated.slice(0, 4)) : null;
  try { DER = derive(d); } catch (e) { console.error("derive", e); DER = emptyDerived(d); }
  const D = DER;
  guard("top", null, () => renderTop(d));
  guard("strip", "strip", () => renderStrip(d, D));
  guard("short history", null, () => renderShortHistory(d, D));
  guard("risk line", null, () => renderRiskLine(d, D));
  guard("status", "status", () => renderStatus(d, D));
  // old anchors are rewritten in place
  const raw = location.hash.replace(/^#/, "").split("/")[0];
  if (OLD[raw]) { try { history.replaceState(null, "", "#" + OLD[raw]); } catch (e) { /* file:// */ } }
  route();
  lastW = document.documentElement.clientWidth;
}
function loadFailed() {
  $("strip").replaceChildren(el("p", { class: "fail" }, "The figures could not be loaded. Try again in a few minutes."));
  for (const id of ["status", "tabs", "panels", "short-history"]) { const e = $(id); if (e) e.hidden = true; }
}
let lastW = 0, resizeTimer = null;
function onResize() {
  if (!DATA) return;
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => {
    const w = document.documentElement.clientWidth;
    if (w === lastW) return;
    lastW = w;
    for (const t of TABS) rendered[t] = false;
    if (CUR.tab) rerender(CUR.tab, { keepScroll: true });
  }, 150);
}
loadUI();
setupNav();
window.addEventListener("resize", onResize);
try { window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => { if (CUR.tab && DATA) rerender(CUR.tab, { keepScroll: true }); }); } catch (e) { /* old browsers */ }
try { if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => { if (DATA && CUR.tab) { for (const t of TABS) rendered[t] = false; rerender(CUR.tab, { keepScroll: true }); } }); } catch (e) { /* no font loading API */ }
fetch("data/dashboard.json", { cache: "no-store" })
  .then((r) => { if (!r.ok) throw new Error("HTTP " + r.status); return r.json(); })
  .then((d) => { if (!d || typeof d !== "object") throw new Error("no data"); return d; })
  .then(start, loadFailed);
