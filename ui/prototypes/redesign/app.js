// Shell, shared helpers, and chart helpers for the redesign prototype.
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const app = $("#app");

const fmt = n => (n < 0 ? "− " : "") + Math.abs(n).toLocaleString("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " €";
const fmt0 = n => (n < 0 ? "− " : "") + Math.abs(n).toLocaleString("de-DE", { maximumFractionDigits: 0 }) + " €";
const signed = n => (n >= 0 ? "+ " : "− ") + Math.abs(n).toLocaleString("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " €";
const signed0 = n => (n >= 0 ? "+ " : "− ") + Math.abs(n).toLocaleString("de-DE", { maximumFractionDigits: 0 }) + " €";
const C = c => `var(--c-${c.toLowerCase()})`;
const I = (name, extra = "") => `<i class="ti ti-${name}"${extra}></i>`;
const glyph = name => { const [c, ic] = CAT[name] || ["Other", "dots"]; return `<span class="cat" style="color:${C(c)}">${I(ic)}</span>`; };
const money = (n, income) => `<span class="amt${income ? " in" : ""}">${income ? "+ " : ""}${fmt(n)}</span>`;

// Building blocks
const ib = (icon, label, attrs = "", cls = "") => `<span class="ib ${cls}" aria-label="${label}" title="${label}" ${attrs}>${I(icon)}</span>`;
const seg = (opts, on = 0) => `<span class="seg">${opts.map((o, i) => `<span class="${i === on ? "on" : ""}">${o}</span>`).join("")}</span>`;
const mi = (label, icon, extra = "") => `<div class="mi ${extra}">${icon ? I(icon) : ""}${label}</div>`;
const menu = (items, cls = "") => `<div class="menu float ${cls}">${items.join("")}</div>`;
const more = (items, label = "More", pos = "right:0;top:32px") => `<span class="ib" data-menu aria-label="${label}" title="${label}">${I("dots")}${menu(items).replace('class="menu', `style="${pos}" class="menu`)}</span>`;
const SEP = '<div class="msep"></div>';
const bar = (left, right = "") => `<div class="bar">${left}<span class="sp"></span>${right}</div>`;
const crumb = (...parts) => `<span class="crumb">${parts.map((p, i) => i === parts.length - 1 ? `<b>${p[0]}</b>` : `<a data-go="${p[1]}">${p[0]}</a>${I("chevron-right")}`).join("")}</span>`;
const period = (label = "October 2026") => `<span class="pill">${I("chevron-left")}${label}${I("chevron-right")}</span>`;
const pill = (icon, label, cls = "") => `<span class="pill ${cls}">${I(icon)}${label}</span>`;
const strip = (items, cls = "") => `<div class="card strip ${cls}">${items.map(([l, v, d = "", vc = ""]) => `<div><div class="lab">${l}</div><div class="num ${vc}">${v}</div><div class="delta">${d}</div></div>`).join("")}</div>`;
const card = (title, { controls = "", menuItems = null, body = "", meta = "", cls = "", bodyCls = "cbody" } = {}) =>
  `<div class="card ${cls}"><div class="ch"><span class="t">${title}</span>${meta ? `<span class="meta">${meta}</span>` : ""}<span class="sp"></span>${controls}${menuItems ? more(menuItems) : ""}</div><div class="${bodyCls}">${body}</div></div>`;
const chartMenu = (extra = []) => [...extra, ...(extra.length ? [SEP] : []), mi("Show as table", "table"), mi("Open in Insights", "chart-line"), SEP, mi("Hide from dashboard", "eye-off")];
const pbar = (pct, { over = false, pace = null } = {}) => `<div class="bt"><div class="bf${over ? " over" : ""}" style="width:${Math.min(pct, 1) * 100}%"></div>${pace != null ? `<div class="pace" style="left:${pace * 100}%"></div>` : ""}</div>`;
const sw = on => `<span class="sw${on ? " on" : ""}" role="switch" aria-checked="${on}"></span>`;
const tag = t => `<span class="tag">${t}</span>`;
const chips = (tags, max) => tags.slice(0, max).map(tag).join("") + (tags.length > max ? `<span class="more">+${tags.length - max}</span>` : "");
const emptyState = (icon, text, action = "") => `<div class="empty">${I(icon)}<div>${text}</div>${action}</div>`;

// Tooltip and category focus
const tipEl = () => $("#tip");
function tip(html, ev) {
  const el = tipEl();
  if (!html) { el.classList.remove("show"); return; }
  if (app.classList.contains("priv-on")) html = html.replace(/[−+]?\s?\d[\d.,]*\s?€/g, "•••• €");
  el.innerHTML = html;
  el.classList.add("show");
  const box = app.getBoundingClientRect();
  el.style.left = Math.min(ev.clientX - box.left + 14, box.width - el.offsetWidth - 8) + "px";
  el.style.top = Math.min(ev.clientY - box.top + 14, box.height - el.offsetHeight - 8) + "px";
}
function focusCat(scope, c) { scope.classList.toggle("dim", !!c); scope.querySelectorAll("[data-cat]").forEach(el => el.classList.toggle("on", el.dataset.cat === c)); }
function hoverCats(host, text) {
  host.addEventListener("mousemove", e => {
    const el = e.target.closest("[data-cat]");
    if (!el) { focusCat(host, null); tip("", e); return; }
    focusCat(host, el.dataset.cat);
    tip(text(el), e);
  });
  host.addEventListener("mouseleave", e => { focusCat(host, null); tip("", e); });
}
function hoverTips(host, sel, text) {
  host.addEventListener("mousemove", e => { const el = e.target.closest(sel); tip(el ? text(el) : "", e); });
  host.addEventListener("mouseleave", e => tip("", e));
}

// Charts
let seq = 0;
const later = [];
function niceTicks(lo, hi, count) {
  const raw = (hi - lo) / count, mag = 10 ** Math.floor(Math.log10(raw)), step = [1, 2, 2.5, 5, 10].map(m => m * mag).find(s => s >= raw);
  const out = [];
  for (let v = Math.ceil(lo / step) * step; v <= hi; v += step) out.push(v);
  return out;
}
// cfg: labels, series [{v, color, dash, w, label}], band {lo, hi}, h, zero, mark, idle, yAxis, tip(i)
function lineChart(cfg) {
  const id = "ch" + ++seq, W = 600, H = cfg.h || 190;
  const vals = [...cfg.series.flatMap(s => s.v), ...(cfg.band ? [...cfg.band.lo, ...cfg.band.hi] : [])].filter(v => v != null);
  let lo = Math.min(...vals), hi = Math.max(...vals);
  if (cfg.zero) { lo = Math.min(lo, 0); hi = Math.max(hi, 0); }
  const pad = (hi - lo) * 0.08 || 1; lo -= pad; hi += pad;
  const n = cfg.labels.length, x = i => 8 + (i / (n - 1)) * (W - 16), y = v => 6 + (1 - (v - lo) / (hi - lo)) * (H - 12);
  const ticks = niceTicks(lo, hi, 3);
  let s = ticks.map(t => `<line x1="0" x2="${W}" y1="${y(t)}" y2="${y(t)}" style="stroke:var(--grid)" stroke-width="1" vector-effect="non-scaling-stroke"/>`).join("");
  if (cfg.zero && lo < 0) s += `<line x1="0" x2="${W}" y1="${y(0)}" y2="${y(0)}" style="stroke:var(--ink-3)" stroke-width="1" vector-effect="non-scaling-stroke"/>`;
  if (cfg.band) {
    const idx = cfg.labels.map((_, i) => i).filter(i => cfg.band.lo[i] != null);
    s += `<polygon style="fill:${cfg.band.fill || "var(--band)"}" points="${[...idx.map(i => `${x(i)},${y(cfg.band.hi[i])}`), ...idx.reverse().map(i => `${x(i)},${y(cfg.band.lo[i])}`)].join(" ")}"/>`;
  }
  if (cfg.mark != null) s += `<line x1="${x(cfg.mark)}" x2="${x(cfg.mark)}" y1="0" y2="${H}" style="stroke:var(--ink-3)" stroke-dasharray="2 3" stroke-width="1" vector-effect="non-scaling-stroke"/>`;
  for (const ser of cfg.series) {
    let run = [];
    const flush = () => { if (run.length > 1) s += `<polyline fill="none" style="stroke:${ser.color || "var(--ink)"}" stroke-width="${ser.w || 1.75}" ${ser.dash ? `stroke-dasharray="${ser.dash}"` : ""} stroke-linejoin="round" vector-effect="non-scaling-stroke" points="${run.join(" ")}"/>`; run = []; };
    ser.v.forEach((v, i) => { if (v == null) flush(); else run.push(`${x(i)},${y(v)}`); });
    flush();
  }
  s += `<line class="guide" x1="0" x2="0" y1="0" y2="${H}" style="stroke:var(--ink-3);display:none" stroke-width="1" vector-effect="non-scaling-stroke"/>`;
  const ylab = cfg.yAxis ? `<div class="yax" style="height:${H}px">${ticks.map(t => `<span class="ylab" style="top:${(y(t) / H) * 100}%">${cfg.yFmt ? cfg.yFmt(t) : fmt0(t)}</span>`).join("")}</div>` : "";
  const xlab = cfg.xEvery ? cfg.labels.map((l, i) => (i % cfg.xEvery === 0 || i === n - 1 ? `<span>${l}</span>` : "")).join("") : cfg.labels.map(l => `<span>${l}</span>`).join("");
  later.push(() => {
    const wrap = document.getElementById(id), svgBox = wrap.querySelector(".plot"), guide = wrap.querySelector(".guide");
    const dots = cfg.series.map(ser => { const d = document.createElement("div"); d.className = "dot"; d.style.background = ser.color || "var(--ink)"; d.style.display = "none"; svgBox.appendChild(d); return d; });
    const place = i => { const r = svgBox.getBoundingClientRect(); cfg.series.forEach((ser, k) => { const v = ser.v[i]; dots[k].style.display = v == null ? "none" : ""; if (v != null) { dots[k].style.left = (x(i) / W) * r.width + "px"; dots[k].style.top = (y(v) / H) * r.height + "px"; } }); };
    const idle = e => { guide.style.display = "none"; dots.forEach(d => (d.style.display = "none")); if (cfg.idle != null) place(cfg.idle); if (e) tip("", e); };
    svgBox.addEventListener("mousemove", e => {
      const r = svgBox.getBoundingClientRect(), i = Math.max(0, Math.min(n - 1, Math.round((((e.clientX - r.left) / r.width) * W - 8) / (W - 16) * (n - 1))));
      guide.style.display = ""; guide.setAttribute("x1", x(i)); guide.setAttribute("x2", x(i));
      place(i);
      tip(cfg.tip(i), e);
    });
    svgBox.addEventListener("mouseleave", idle);
    new ResizeObserver(() => idle()).observe(svgBox);
  });
  return `<div class="chart-wrap${cfg.yAxis ? " with-y" : ""}" id="${id}">${ylab}<div class="plot"><svg class="chart" style="height:${H}px" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none">${s}</svg></div><div class="xlab">${xlab}</div></div>`;
}
const legend = items => `<div class="legend">${items.map(([label, color, kind = "sq", cat]) => `<span ${cat ? `data-cat="${cat}"` : ""}><i class="${kind}" style="background:${color}"></i>${label}</span>`).join("")}</div>`;
const legendBand = label => `<span><i class="area" style="background:var(--band);box-shadow:inset 0 0 0 1px var(--grid)"></i>${label}</span>`;
function spark(v, w = 72, h = 18) {
  const lo = Math.min(...v), hi = Math.max(...v), x = i => (i / (v.length - 1)) * w, y = a => h - 2 - ((a - lo) / (hi - lo || 1)) * (h - 4);
  return `<svg class="spark" viewBox="0 0 ${w} ${h}" style="width:${w}px;height:${h}px"><polyline points="${v.map((a, i) => `${x(i)},${y(a)}`).join(" ")}"/></svg>`;
}
function donut(rows, total, center, sub) {
  const R = 70, L = 2 * Math.PI * R;
  let off = 0, arcs = "";
  for (const [c, v, color] of rows) { const len = (v / total) * L; arcs += `<circle data-cat="${c}" r="${R}" cx="90" cy="90" fill="none" style="stroke:${color}" stroke-width="22" stroke-dasharray="${Math.max(len - 1.5, 0)} ${L}" stroke-dashoffset="${-off}"/>`; off += len; }
  return `<div class="donut-wrap"><div class="donut"><svg width="180" height="180" viewBox="0 0 180 180">${arcs}</svg><div class="ctr"><div class="v">${center}</div><div class="s">${sub}</div></div></div>
    <div class="dl">${rows.map(([c, v, color]) => `<div><span data-cat="${c}"><i style="background:${color}"></i>${c}</span><span data-cat="${c}" class="a">${fmt(v)}</span><span data-cat="${c}" class="p">${Math.round((v / total) * 100)} %</span></div>`).join("")}</div></div>`;
}

// Ledger rows
const flagIcon = { receipt: "paperclip", pin: "map-pin", reimb: "arrows-exchange" };
const flagName = { receipt: "Receipt", pin: "Location", reimb: "Reimbursed" };
function ledger(rows, { sel = [], open = null } = {}) {
  let html = "", last = null;
  for (const t of rows) {
    if (t.day !== last) {
      const tot = rows.filter(x => x.day === t.day).reduce((s, x) => s + (x.income ? x.amt : -(x.net ?? x.amt)), 0);
      html += `<div class="day"><span>${t.day}</span><span class="tot">${signed(tot)}</span></div>`;
      last = t.day;
    }
    const isSel = sel.includes(t.id);
    html += `<div class="row${isSel || open === t.id ? " sel" : ""}" data-open-peek><span class="cb">${isSel ? I("check") : ""}</span>
      <span class="cat" style="color:${C(t.cat)}">${I(t.icon)}</span><span class="title">${t.title}</span>
      <span class="catname">${t.name ?? t.cat}</span><span class="tags">${chips(t.tags, 2)}</span>
      <span class="flags">${t.flags.map(f => I(flagIcon[f], ` aria-label="${flagName[f]}" title="${flagName[f]}"`)).join("")}</span>
      <span class="amt${t.income ? " in" : ""}">${t.net ? `<span class="net">net ${fmt(t.net)}</span>` : ""}${t.income ? "+ " : ""}${fmt(t.amt)}</span></div>`;
  }
  return html;
}
const peekBar = (parent, current, { actions = "", full = null } = {}) => `<div class="pk-bar"><span class="pk-crumb"><span>${parent}</span>${I("chevron-right", ' style="font-size:12px"')}<b>${current}</b></span><span class="pk-back" data-close-peek>${I("chevron-left", ' style="font-size:16px"')}${parent}</span><span class="sp"></span>${full ? ib("arrows-diagonal", "Open full view", `data-go="${full}"`, "hide-m") : ""}${actions}${ib("x", "Close", "data-close-peek", "hide-m")}</div>`;

// Pages and navigation
const PAGES = {};
const page = (id, def) => (PAGES[id] = def);
const NAV = [
  ["dashboard", "Dashboard", "layout-dashboard"], ["transactions", "Transactions", "list"], ["budgets", "Budgets", "target"],
  ["insights", "Insights", "chart-line"], ["forecast", "Forecast", "trending-up"],
];
const NAV_GROUPS = [
  ["Manage", [["recurring", "Recurring", "repeat"], ["templates", "Templates", "template"], ["rules", "Rules", "wand"], ["categories", "Categories", "category"], ["tags", "Tags", "tag"]]],
  ["Tools", [["whatif", "What If", "flask"], ["reconcile", "Reconcile", "checks"], ["reports", "Reports", "file-text"], ["digest", "Digest", "calendar-week"], ["assistant", "Assistant", "sparkles"]]],
];
const navItem = ([id, label, icon], extra = "") => `<div class="nav" data-go="${id}" data-nav="${id}">${I(icon)}${label}${extra}</div>`;
const brand = () => `<div class="brand" data-menu>${I("wallet", ' style="font-size:18px"')}Expenses${I("chevron-down")}
  ${menu([mi("Settings", "settings", 'data-go="settings"'), mi("Admin", "shield-lock", 'data-go="admin"'), SEP, mi("Sign out", "logout", 'data-go="login"')], "left").replace('class="menu', 'style="left:0;top:34px" class="menu')}</div>`;
function sidebarHTML() {
  return brand() + NAV.map(n => navItem(n) + (n[0] === "transactions" ? `<div class="nav sub" data-go="inbox" data-nav="inbox">Uncategorized<span class="count">12</span></div>` : "")).join("") +
    NAV_GROUPS.map(([g, items]) => `<div class="group${state.closed.has(g) ? " closed" : ""}" data-group="${g}"><div class="nav-group">${g}${I("chevron-down")}</div><div class="group-items">${items.map(n => navItem(n)).join("")}</div></div>`).join("");
}
const TABS = [["dashboard", "Dashboard", "layout-dashboard"], ["transactions", "Transactions", "list"], ["budgets", "Budgets", "target"], ["insights", "Insights", "chart-line"]];

const state = { page: "dashboard", t: "t-light", w: "w-desktop", o: {}, closed: new Set() };
const GLOBAL = [{ k: "t", label: "Theme", opts: [["t-light", "Light"], ["t-dark", "Dark"]] }, { k: "w", label: "Width", opts: [["w-desktop", "Desktop"], ["w-mobile", "Mobile"]] }];
const PEEK = { k: "pk", label: "Peek", opts: [["pk-closed", "Closed"], ["pk-open", "Open"]] };
const pageToggles = p => [...(p.peek ? [PEEK] : []), ...(p.toggles || [])];
const opt = k => state.o[k];

function go(id) { if (!PAGES[id]) id = "notfound"; state.page = id; state.o = {}; state.sec = null; closeDialog(); location.hash = id; render(); }
function setOpt(k, v) { if (k === "t" || k === "w") state[k] = v; else state.o[k] = v; render(); }

function renderControls(p) {
  const tg = t => `<span class="ctl"><span class="ctl-label">${t.label}</span><span class="tg" data-k="${t.k}">${t.opts.map(([v, l]) => `<button data-v="${v}" aria-pressed="${(t.k === "t" || t.k === "w" ? state[t.k] : state.o[t.k]) === v}">${l}</button>`).join("")}</span></span>`;
  const own = pageToggles(p);
  $("#controls").innerHTML = `<span class="ctl"><span class="ctl-label">Page</span><select id="pagepick">${Object.entries(PAGES).filter(([, d]) => d.title).map(([id, d]) => `<option value="${id}" ${id === state.page ? "selected" : ""}>${d.title}</option>`).join("")}</select></span>` +
    GLOBAL.map(tg).join("") + (own.length ? '<span class="div"></span>' + own.map(tg).join("") : "");
  $("#pagepick").addEventListener("change", e => go(e.target.value));
}

function render() {
  const p = PAGES[state.page];
  pageToggles(p).forEach(t => { if (!(t.k in state.o)) state.o[t.k] = t.opts[0][0]; });
  app.className = [state.t, state.w, "pg-" + state.page, ...Object.values(state.o), p.bare ? "bare" : ""].join(" ");
  $("#sidebar").innerHTML = (p.sidebar && p.sidebar()) || sidebarHTML();
  $$("[data-nav]").forEach(n => n.classList.toggle("on", n.dataset.nav === (p.nav || state.page)));
  later.length = 0;
  $("#page").innerHTML = p.render();
  later.splice(0).forEach(fn => fn());
  p.mount?.($("#page"));
  $("#tabbar").innerHTML = TABS.map(([id, l, ic]) => `<span data-go="${id}" class="${(p.nav || state.page) === id ? "on" : ""}">${I(ic)}${l}</span>`).join("") + `<span data-more-nav>${I("menu-2")}More</span>`;
  app.classList.toggle("sel-mode", !!$("#page .bulk") && opt("pk") !== "pk-open");
  renderControls(p);
}

// Dialogs (bottom sheets on mobile)
function openDialog(html, cls = "") {
  const d = $("#dialog");
  d.className = "dialog float " + cls;
  d.innerHTML = html;
  app.classList.add("dlg-open");
}
function closeDialog() { app.classList.remove("dlg-open"); }

// Global event wiring
document.addEventListener("click", e => {
  const t = e.target;
  const tgb = t.closest("#controls .tg button");
  if (tgb) { setOpt(tgb.parentElement.dataset.k, tgb.dataset.v); return; }
  const sheetOpt = t.closest("#dialog [data-opt]");
  if (sheetOpt) { closeDialog(); const [k, v] = sheetOpt.dataset.opt.split(":"); setOpt(k, v); return; }
  const grp = t.closest(".nav-group");
  if (grp) { const g = grp.parentElement.dataset.group; state.closed.has(g) ? state.closed.delete(g) : state.closed.add(g); grp.parentElement.classList.toggle("closed"); return; }
  const m = t.closest("[data-menu]");
  if (m && !t.closest(".menu")) {
    e.stopPropagation();
    const mm = m.querySelector(".menu");
    if (app.classList.contains("w-mobile")) { openDialog(`<div class="sheet-menu">${mm.innerHTML}</div>`, "narrow"); return; }
    const wasOpen = mm.classList.contains("open");
    $$(".menu.open").forEach(x => x.classList.remove("open"));
    if (!wasOpen) mm.classList.add("open");
    return;
  }
  if (t.closest("[data-more-nav]")) {
    openDialog(`<div class="sheet-menu">${[...NAV.slice(4), ...NAV_GROUPS.flatMap(g => g[1]), ["settings", "Settings", "settings"]].map(([id, l, ic]) => mi(l, ic, `data-go="${id}"`)).join("")}</div>`, "narrow");
    return;
  }
  const g = t.closest("[data-go]");
  if (g) { go(g.dataset.go); return; }
  if (t.closest("[data-close-peek]")) { setOpt("pk", "pk-closed"); return; }
  if (t.closest("[data-close-dlg]") || t.id === "scrim") { closeDialog(); return; }
  const dlg = t.closest("[data-dialog]");
  if (dlg) { const fn = PAGES[state.page].dialogs?.[dlg.dataset.dialog]; if (fn) openDialog(...[].concat(fn())); return; }
  if (t.closest("[data-open-peek]") && PAGES[state.page].peek) { setOpt("pk", "pk-open"); return; }
  const sg = t.closest(".seg span");
  if (sg && !sg.closest("[data-static]")) { sg.parentElement.querySelectorAll("span").forEach(x => x.classList.toggle("on", x === sg)); }
  if (!t.closest(".menu")) $$(".menu.open").forEach(x => x.classList.remove("open"));
});
document.addEventListener("keydown", e => {
  if (e.key !== "Escape") return;
  if (app.classList.contains("dlg-open")) closeDialog();
  else if ($(".menu.open")) $$(".menu.open").forEach(x => x.classList.remove("open"));
  else if (opt("pk") === "pk-open") setOpt("pk", "pk-closed");
});
window.addEventListener("load", () => {
  const h = location.hash.slice(1);
  state.page = PAGES[h] ? h : "dashboard";
  render();
});
