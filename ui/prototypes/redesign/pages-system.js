// Settings and Admin, Reconcile, sign-in, not found.
const SET_NAV = [
  ["Account", [["account", "Account", "user"], ["appearance", "Appearance", "palette"]]],
  ["Data", [["categorization", "Categorization", "category"], ["ai", "AI", "sparkles"], ["snapshots", "Balance snapshots", "scale"], ["data", "Import and export", "arrows-transfer-down"]]],
  ["Server", [["health", "Health", "activity"], ["maintenance", "Maintenance", "tool"], ["usage", "Assistant usage", "chart-bar"], ["logs", "Logs", "file-search"], ["system", "System", "info-circle"]]],
];
const SERVER = ["health", "maintenance", "usage", "logs", "system"];
const setNav = sec => SET_NAV.map(([g, items]) => `<div class="nav-group" style="cursor:default">${g}</div>${items.map(([id, l, ic]) => `<div class="nav${id === sec ? " on" : ""}" data-sec="${id}">${I(ic)}${l}</div>`).join("")}`).join("");
const srow = (label, value) => `<div class="srow"><div class="sl">${label}</div><div class="sv">${value}</div></div>`;
const btnq = (label, icon = "", cls = "btn-quiet", attrs = "") => `<span class="btn ${cls}" ${attrs}>${icon ? I(icon) : ""}${label}</span>`;
const selectPill = v => `<span class="input" style="height:28px;min-width:0">${v}${I("chevron-down", ' style="margin-left:auto;font-size:13px"')}</span>`;

function settingsBody(sec) {
  if (SERVER.includes(sec) && opt("adm") === "adm-locked") {
    return `<div class="card" style="max-width:420px;justify-self:center;width:100%;margin-top:8vh"><div class="cbody" style="padding:20px">
      <div style="font-weight:600;font-size:15px;margin-bottom:12px">Enter your password</div><div class="input focus" style="margin-bottom:12px"><span class="ph">Password</span></div>
      <div style="display:flex;gap:8px;justify-content:flex-end">${btnq("Cancel", "", "btn-ghost", 'data-sec="account"')}<span class="btn btn-primary">Unlock</span></div></div></div>`;
  }
  const S = {
    account: () => card("Profile", { bodyCls: "", body: srow("Username", "janis") + srow("Session", btnq("Sign out", "logout", "btn-quiet", 'data-go="login"')) }) +
      card("Ingest token", { bodyCls: "", body: srow(`Token ending in 3f9a <span class="faint">· used 2 Oct, 14:20</span>`, btnq("Rotate") + btnq("Revoke", "", "btn-ghost btn-danger", 'data-dialog="revoke"')) }),
    categorization: () => {
      const st = opt("acs");
      const status = {
        "acs-ready": `<span class="status ok">${I("circle-check")}Active · trained 11 Oct, 03:10</span>`,
        "acs-training": `<span class="status">${I("loader-2")}Training</span>`,
        "acs-short": `<span class="status">${I("alert-circle")}Not enough history · needs 60 categorized expenses in 2 categories</span>`,
        "acs-failed": `<span class="status bad">${I("alert-triangle")}Training failed · using the model from 4 Oct</span>`,
        "acs-off": "",
      }[st];
      return card("Automatic categorization", { bodyCls: "", body: srow("Categorize new expenses", sw(st !== "acs-off")) + (status ? `<div class="srow"><div class="sl">${status}</div></div>` : "") +
        srow("Minimum confidence", `<span class="input tab" style="width:84px;height:28px">80<span class="faint" style="margin-left:auto">%</span></span>`) });
    },
    appearance: () => card("Appearance", { bodyCls: "", body: srow("Theme", seg(["System", "Light", "Dark"])) }),
    ai: () => card("ChatGPT", { bodyCls: "", body: srow(`Connected as you@example.com`, `<a class="btn btn-ghost">Usage${I("arrow-up-right")}</a>` + btnq("Reconnect") + btnq("Disconnect", "", "btn-ghost btn-danger")) }) +
      card("Features", { controls: btnq("Refresh models", "refresh", "btn-ghost"), bodyCls: "", body: `<div class="lhead aigrid"><span>Feature</span><span>Provider</span><span>Model</span><span>Thinking</span></div>` +
        [["Rule suggestions", "Local / API", "Server default (qwen3-8b)", "Low"], ["Spending analysis", "ChatGPT plan", "gpt-6.1-sol", "Medium"]].map(([f, p, m, t]) => `<div class="lrow aigrid" style="cursor:default"><span class="cell">${f}</span>${selectPill(p)}${selectPill(m)}${selectPill(t)}</div>`).join("") + `<div style="height:8px"></div>` }),
    snapshots: () => card("Balance snapshots", { meta: "current 28.008,00 €", controls: btnq("Add snapshot", "plus", "btn-quiet", 'data-dialog="snap"'), bodyCls: "", body: `<div style="padding-bottom:8px">${[["1 Jan 2026, 00:00", 21412.55, "Bank statement"], ["1 Jan 2025, 00:00", 15980.1, ""]].map(([w, b, n]) => `<div class="lrow" style="grid-template-columns:160px 120px minmax(0,1fr)"><span class="cell">${w}</span><span class="cell r tab">${fmt(b)}</span><span class="cell muted">${n}</span></div>`).join("")}</div>` }),
    data: () => card("Export", { bodyCls: "", body: srow("Transactions as CSV", btnq("Download", "download")) + srow("Portable archive", btnq("Download", "download")) }) +
      card("Import CSV", { body: `<div class="drop">${I("upload")}<span>Drop a CSV file or <span class="link">choose one</span></span></div>` }),
    health: () => `<div class="card strip">${[["CPU temperature", "52 °C"], ["Load", "0,42"], ["Memory", "1,9 of 3,8 GB"], ["Disk", "41 of 58 GB"]].map(([l, v]) => `<div><div class="lab">${l}</div><div class="num" style="font-size:19px">${v}</div></div>`).join("")}</div>` +
      card("Status", { bodyCls: "", body: srow("Raspberry Pi", `<span class="status ok">${I("circle-check")}Healthy</span>`) + srow("Storage", `<span class="muted">Database 412 MB · Receipts 2,1 GB · Other 38,5 GB</span>`) }),
    maintenance: () => card("Maintenance", { bodyCls: "", body: srow("Database backup", btnq("Download", "download")) + srow("Rebuild monthly totals", btnq("Rebuild", "", "btn-quiet", 'data-dialog="rebuild"')) + srow("Post overdue recurring transactions", btnq("Run")) + srow("Legacy SQLite import", btnq("Open", "arrow-right")) }) +
      card("Purge deleted transactions", { bodyCls: "", body: srow(`Older than <span class="input tab" style="display:inline-flex;width:56px;height:26px;margin:0 6px">30</span> days`, btnq("Purge", "", "btn-ghost btn-danger", 'data-dialog="purge"')) }),
    usage: () => `<div style="display:flex">${seg(["Week", "Month", "All time"], 1)}</div>` + strip([["Cost", "4,12 $", "0,09 $ per chat"], ["Tokens", "1,8 M", "1,1 M cached · 210 k reasoning"], ["Chats", "46", "44 completed · 2 failed"], ["Per chat", "39 k tokens", "8.400 ms p95"]]),
    logs: () => `<div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap"><span class="input" style="width:280px">${I("search")}<span class="ph">request id, event, text</span></span>${seg(["Errors", "Ingest", "Imports", "Scheduler", "All"])}</div>
      <div class="list" style="flex:none">${[["14:32:08", "ERROR", "llm.request_failed", "/api/assistant/stream"], ["13:05:41", "ERROR", "ingest.parse_error", "/api/ingest"], ["09:00:00", "WARN", "scheduler.catchup_overdue", ""], ["08:12:19", "ERROR", "auth.elevation_failed", "/api/admin/elevate"]].map(([t, l, e, p], i) => `<div class="lrow loggrid${i === 0 ? " sel" : ""}"><span class="cell tab muted">${t}</span><span class="cell ${l === "ERROR" ? "over" : "muted"}">${l === "ERROR" ? "Error" : "Warning"}</span><span class="cell">${e}</span><span class="cell muted hide-m">${p}</span></div>`).join("")}<div class="lfoot"><span class="btn btn-ghost">Load older</span></div></div>`,
    system: () => card("System", { body: `<div class="props wide">${[["Version", "0.5.3"], ["Environment", "production"], ["Database", "/data/expenses.db · 412 MB"], ["Modified", "22 Oct 2026, 14:31"], ["Logs", "/data/logs · 18 MB · 7 files"]].map(([l, v]) => pv(l, v)).join("")}</div>` }),
  };
  return S[sec]();
}
const SEC_TITLE = Object.fromEntries(SET_NAV.flatMap(g => g[1]).map(([id, l]) => [id, l]));
const settingsDef = def => ({
  title: def === "health" ? "Admin" : "Settings",
  toggles: [{ k: "acs", label: "Categorization", opts: [["acs-ready", "Active"], ["acs-training", "Training"], ["acs-short", "Not enough history"], ["acs-failed", "Failed"], ["acs-off", "Off"]] }, { k: "adm", label: "Admin access", opts: [["adm-open", "Unlocked"], ["adm-locked", "Locked"]] }],
  sidebar: () => state.w !== "w-mobile" ? `<div class="brand" data-go="dashboard" style="font-weight:500;color:var(--ink-2)">${I("chevron-left")}Back to app</div>${setNav(state.sec || def)}` : null,
  dialogs: {
    revoke: () => [`<div class="dg-top"><span class="t">Revoke the ingest token?</span></div><div class="warn">Clients that use it stop working.</div><div class="dg-foot"><span class="sp"></span>${btnq("Cancel", "", "btn-ghost", "data-close-dlg")}<span class="btn btn-danger-fill">Revoke</span></div>`, "narrow"],
    purge: () => [`<div class="dg-top"><span class="t">Purge 18 deleted transactions?</span></div><div class="warn">Deleted more than 30 days ago. This cannot be undone.</div><div class="dg-foot"><span class="sp"></span>${btnq("Cancel", "", "btn-ghost", "data-close-dlg")}<span class="btn btn-danger-fill">Purge</span></div>`, "narrow"],
    rebuild: () => [`<div class="dg-top"><span class="t">Rebuild monthly totals now?</span></div><div class="dg-foot"><span class="sp"></span>${btnq("Cancel", "", "btn-ghost", "data-close-dlg")}<span class="btn btn-primary">Rebuild</span></div>`, "narrow"],
    snap: () => [`<div class="dg-top"><span class="t">Add snapshot</span><span class="sp"></span>${ib("x", "Close", "data-close-dlg")}</div><div class="dg-body"><div class="form"><span class="fl">As of</span><span class="input">22 Oct 2026, 14:30</span><span class="fl">Balance</span><span class="input"><span class="ph tab">0,00 €</span></span><span class="fl">Note</span><span class="input"><span class="ph">Bank statement</span></span></div></div><div class="dg-foot"><span class="sp"></span>${btnq("Cancel", "", "btn-ghost", "data-close-dlg")}<span class="btn btn-primary">Save</span></div>`, "narrow"],
  },
  render() {
    const sec = state.sec || def;
    const body = `<div class="sbody">${settingsBody(sec)}</div>`;
    if (state.w !== "w-mobile") return bar(SEC_TITLE[sec]) + `<div class="content set-content">${body}</div>`;
    return bar(def === "health" ? "Admin" : "Settings") + `<div class="settings"><nav class="snav">${setNav(sec)}</nav>${body}</div>`;
  },
  mount(root) {
    $$("[data-sec]").forEach(el => el.addEventListener("click", e => { e.stopPropagation(); state.sec = el.dataset.sec; render(); }));
  },
});
page("settings", settingsDef("account"));
page("admin", settingsDef("health"));

// Reconcile: rows from imported bank statements, checked one by one against tracked transactions.
// Totals are never compared: one statement covers one account, and the app may track several.
const RC_REASONS = [["Cash withdrawal", "cash"], ["Transfer between my accounts", "arrows-exchange"], ["Not something I track", "eye-off"]];
const RC_OPEN = [
  { st: "sug", payee: "EDEKA SCHWABING MUENCHEN", d: "22 Oct", a: -47.38, purpose: "Kartenzahlung 2026-10-22T18:04 Debitk.7 VISA", cands: [["Groceries", "Edeka Schwabing", "same day", 47.38]] },
  { st: "sug", payee: "DB VERTRIEB GMBH", d: "19 Oct", a: -89.9, purpose: "Lastschrift DB Fernverkehr Auftrag 7Q4K2M", cands: [["Travel", "DB ICE 1003 München → Berlin", "2 days earlier", 89.9]] },
  { st: "amb", payee: "PAYPAL EUROPE S.A.R.L.", d: "21 Oct", a: -34.99, purpose: "Lastschrift PayPal 1043229871 PP.4417", cands: [["Shopping", "Amazon.de Marketplace", "same day", 34.99], ["Shopping", "Zalando", "2 days earlier", 34.99], ["Subscriptions", "Steam", "4 days earlier", 34.99]] },
  { st: "mis", payee: "CAFE LUITPOLD", d: "20 Oct", a: -9.8, purpose: "Kartenzahlung 2026-10-20T10:12 Debitk.7 VISA", near: ["Restaurants", "Café Luitpold", "same day", 8.4] },
  { st: "mis", payee: "KIOSK HBF", d: "20 Oct", a: -6.4, purpose: "Kartenzahlung 2026-10-20T07:48 Debitk.7 VISA" },
  { st: "mis", payee: "BARGELDAUSZAHLUNG GA 4711", d: "18 Oct", a: -200, purpose: "Auszahlung Geldautomat 4711 Sparkasse" },
  { st: "mis", payee: "ZINSEN", d: "30 Sep", a: 14.2, purpose: "Abschluss Zinsen 3. Quartal" },
];
const RC_DONE = [
  { out: "match", payee: "RAMEN KAZU", d: "22 Oct", a: -96, tx: ["Restaurants", "Ramen Kazu — dinner with Lena and Tom"] },
  { out: "match", payee: "LENA WEBER", d: "22 Oct", a: 32, tx: ["Reimbursement", "Lena — her share of ramen"] },
  { out: "ign", payee: "UEBERTRAG AUF TAGESGELD", d: "21 Oct", a: -500, why: "Transfer between my accounts" },
  { out: "new", payee: "APOTHEKE AM ELISABETHPLATZ", d: "19 Oct", a: -12.95, tx: ["Drugstore", "Apotheke am Elisabethplatz"] },
  { out: "ign", payee: "BARGELDAUSZAHLUNG GA 0815", d: "15 Oct", a: -100, why: "Cash withdrawal" },
  { out: "match", payee: "SPOTIFY AB", d: "15 Oct", a: -17.99, tx: ["Subscriptions", "Spotify"] },
  { out: "ign", payee: "ENTGELT KONTOFUEHRUNG", d: "30 Sep", a: -4.9, why: "Not something I track" },
];
const RC_ST = { sug: ["circle-dashed-check", "Suggested match"], amb: ["git-fork", "Several matches"], mis: ["circle-dashed", "No match"] };
const RC_OUT = { match: ["link", "Matched"], new: ["circle-plus", "Created"], ign: ["eye-off", "Ignored"] };
const RC_TOAST = { "toast-match": "Matched with Edeka Schwabing", "toast-all": "Matched 2 rows", "toast-new": "Created Cafe Luitpold", "toast-ign": "Ignored · Cash withdrawal", "toast-reopen": "Moved back to review" };
const rcAmt = a => `<span class="amt${a > 0 ? " in" : ""}">${a > 0 ? "+ " : ""}${fmt(Math.abs(a))}</span>`;
const rcIgnore = (pos = "right:0;top:32px") => `<span class="btn btn-ghost" data-menu>Ignore${I("chevron-down", ' style="font-size:12px;color:var(--ink-3)"')}${menu([
  ...RC_REASONS.map(([l, ic]) => `<div class="mi" data-opt="toast:toast-ign">${I(ic)}${l}</div>`), SEP, `<div class="mi" data-dialog="ignore">${I("pencil")}Other reason…</div>`]).replace('class="menu', `style="${pos}" class="menu`)}</span>`;
const rcRow = () => RC_OPEN[state.rcRow ?? 0];

page("reconcile", {
  title: "Reconcile", peek: true,
  toggles: [{ k: "rcv", label: "View", opts: [["rcv-open", "To review"], ["rcv-done", "Resolved"]] },
    { k: "rcs", label: "Queue", opts: [["rcs-rows", "Open rows"], ["rcs-clear", "All resolved"], ["rcs-first", "First use"]] },
    { k: "imf", label: "Import file", opts: [["imf-ok", "Valid"], ["imf-err", "Has errors"]] },
    { k: "toast", label: "Toast", opts: [["toast-off", "Hidden"], ["toast-match", "Matched"], ["toast-all", "Matched all"], ["toast-new", "Created"], ["toast-ign", "Ignored"]] }],
  dialogs: {
    imp: () => [`<div class="dg-top"><span class="t">Import statement</span><span class="sp"></span>${ib("x", "Close", "data-close-dlg")}</div>
      <div class="dg-body"><div class="form"><span class="fl">Account</span>${selectPill("Girokonto")}<span class="fl">Format</span><span>Commerzbank CSV</span>
        <span class="fl">File</span><div class="drop sm" data-dialog="impPrev">${I("upload")}<span>Drop a CSV file or <span class="link">choose one</span></span></div></div></div>
      <div class="dg-foot"><span class="sp"></span>${btnq("Cancel", "", "btn-ghost", "data-close-dlg")}<span class="btn btn-primary" aria-disabled="true">Import</span></div>`, "narrow"],
    impPrev: () => {
      const err = opt("imf") === "imf-err";
      const file = `<span class="rc-file">${I("file-spreadsheet")}<span class="nm">Umsaetze_Girokonto_2026-10-22.csv</span><span class="link" data-dialog="imp">Change</span></span>`;
      const form = `<div class="form"><span class="fl">Account</span><span>Girokonto</span><span class="fl">File</span>${file}${err ? "" : `<span class="fl">Rows</span><span class="tab">142 · 12 Sep – 22 Oct 2026</span><span class="fl">New</span><span class="tab">124 <span class="muted">· 18 already imported</span></span>`}</div>`;
      const extra = err
        ? `<div class="rc-err">${I("alert-triangle")}<span>Row 37: “31.09.2026” is not a valid date.</span></div>`
        : `<div class="card sub" style="margin-top:12px">${[["22 Oct", "EDEKA SCHWABING MUENCHEN", -47.38], ["21 Oct", "PAYPAL EUROPE S.A.R.L.", -34.99], ["21 Oct", "UEBERTRAG AUF TAGESGELD", -500]].map(([d, t, a]) => lrow("56px minmax(0,1fr) auto", [cell(d, "muted tab"), cell(t), rcAmt(a)], { attrs: "" })).join("")}</div><div class="faint" style="padding-top:4px">121 more rows</div>`;
      return [`<div class="dg-top"><span class="t">Import statement</span><span class="sp"></span>${ib("x", "Close", "data-close-dlg")}</div><div class="dg-body">${form}${extra}</div>
        <div class="dg-foot"><span class="sp"></span>${btnq("Cancel", "", "btn-ghost", "data-close-dlg")}${err ? `<span class="btn btn-primary" data-dialog="imp">Choose another file</span>` : `<span class="btn btn-primary" data-close-dlg>Import 124 rows</span>`}</div>`, "narrow"];
    },
    create: () => {
      const r = rcRow().st === "mis" ? rcRow() : RC_OPEN[3], inc = r.a > 0;
      return [`<div class="dg-top">${seg(["Expense", "Income"], inc ? 1 : 0)}<span class="sp"></span>${ib("x", "Close", "data-close-dlg")}</div>
        <div class="dg-amt${inc ? " in" : ""}">${inc ? "+ " : ""}${fmt(Math.abs(r.a))}</div>
        <div class="dg-title">${r.payee}</div>
        <div class="dg-chips">${pill("calendar", `${r.d} 2026`)}${pill("category", "Category")}${pill("tag", "Tags")}${pill("map-pin", "Location")}${pill("paperclip", "Receipt")}</div>
        <div class="dg-notes ph">Notes</div>
        <div class="dg-foot"><span class="sp"></span><span class="btn btn-ghost" data-close-dlg>Cancel</span><span class="btn btn-primary" data-close-dlg>Create and match</span></div>`, ""];
    },
    ignore: () => [`<div class="dg-top"><span class="t">Ignore ${rcRow().payee}</span></div><div class="dg-body"><div class="input focus"><span class="caret-i"></span><span class="ph">Reason</span></div></div>
      <div class="dg-foot"><span class="sp"></span>${btnq("Cancel", "", "btn-ghost", "data-close-dlg")}<span class="btn btn-primary" data-close-dlg>Ignore</span></div>`, "narrow"],
    reopen: () => [`<div class="dg-top"><span class="t">Reopen this row?</span></div><div class="warn">The transaction “Apotheke am Elisabethplatz” was created from it.</div>
      <div class="dg-foot"><span class="sp"></span>${btnq("Cancel", "", "btn-ghost", "data-close-dlg")}${btnq("Move transaction to Trash", "", "btn-quiet", "data-close-dlg")}<span class="btn btn-primary" data-close-dlg>Keep transaction</span></div>`, "narrow"],
  },
  render() {
    const open = opt("pk") === "pk-open", done = opt("rcv") === "rcv-done", qs = opt("rcs");
    const rows = qs === "rcs-rows" ? RC_OPEN : [];
    const hist = qs === "rcs-first" ? [] : RC_DONE;
    const acct = `<span class="pill" data-menu>${I("building-bank")}All accounts${menu([`<div class="mi">All accounts${I("check")}</div>`, `<div class="mi">Girokonto</div>`, `<div class="mi">Tagesgeld</div>`]).replace('class="menu', 'style="left:0;top:30px" class="menu left')}</span>`;
    const outcome = `<span class="pill" data-menu aria-label="Outcome" title="Outcome">${I("filter")}<span class="hide-m">All outcomes</span>${menu([`<div class="mi">All outcomes${I("check")}</div>`, ...Object.values(RC_OUT).map(([ic, l]) => `<div class="mi">${I(ic)}${l}</div>`)]).replace('class="menu', 'style="left:0;top:30px" class="menu left')}</span>`;
    const view = `<div class="viewrow">${viewSeg("rcv", [["rcv-open", `To review${rows.length ? ` <span class="tab muted">${rows.length}</span>` : ""}`], ["rcv-done", "Resolved"]])}${qs === "rcs-first" ? "" : acct}${done ? outcome : ""}<span class="sp"></span>${qs === "rcs-first" ? "" : `<span class="muted hide-m">Last import 22 Oct · Girokonto</span>`}</div>`;
    const head = bar("Reconcile", `<span class="btn btn-primary" data-dialog="imp">${I("upload")}Import<span class="hide-m"> statement</span></span>`) + view;
    const toast = opt("toast") !== "toast-off" ? `<div class="toast float">${RC_TOAST[opt("toast")]}<span class="btn btn-quiet">Undo</span></div>` : "";
    const empty = (icon, text, action) => head + `<div class="content"><div class="card">${emptyState(icon, text, action)}</div></div>` + toast;
    if (qs === "rcs-first") return empty("building-bank", "Import a bank statement to check it against your transactions", btnq("Import statement", "upload", "btn-quiet", 'data-dialog="imp"'));

    if (done) {
      const sel = state.rcDone ?? 0, r = hist[sel];
      const outCell = h => h.out === "ign" ? `<span class="muted">Ignored · ${h.why}</span>` : `${glyph(h.tx[0])}${h.tx[1]}`;
      const peek = `<aside class="peek">${peekBar("Reconcile", r.payee)}<div class="pk-body"><div class="pk-title">${r.payee}</div><div class="pk-amt${r.a > 0 ? " in" : ""}">${r.a > 0 ? "+ " : ""}${fmt(Math.abs(r.a))}</div>
        <div class="props">${pv("Booked", `${r.d} 2026`)}${pv("Account", "Girokonto")}${pv("Outcome", `${I(RC_OUT[r.out][0], ' style="color:var(--ink-3)"')}${RC_OUT[r.out][1]}`)}${r.out === "ign" ? pv("Reason", r.why) : pv("Transaction", `<span class="link-tx" data-go="txfull">${glyph(r.tx[0])}${r.tx[1]}</span>`)}${pv("Resolved", "22 Oct 2026, 18:40")}</div>
        <div style="display:flex;gap:6px;margin-top:16px">${r.out === "new" ? btnq("Reopen", "arrow-back-up", "btn-quiet", 'data-dialog="reopen"') : btnq("Reopen", "arrow-back-up", "btn-quiet", 'data-opt="toast:toast-reopen"')}</div></div></aside>`;
      return head + `<div class="split"><div class="list">
        ${hist.map((h, i) => `<div class="lrow recogrid-i${open && i === sel ? " sel" : ""}" data-open-peek data-rc-done="${i}"><span class="cat faint" title="${RC_OUT[h.out][1]}">${I(RC_OUT[h.out][0])}</span><span class="cell strong">${h.payee}</span><span class="cell muted hide-m">${h.d}</span><span class="cell hide-m">${outCell(h)}</span><span class="hide-m"></span>${rcAmt(h.a)}</div>`).join("")}
        <div class="lfoot">1–50 of 196${ib("chevron-left", "Previous page")}${ib("chevron-right", "Next page")}</div></div>${peek}</div>` + toast;
    }

    if (!rows.length) return empty("circle-check", "Nothing to review", btnq("Show resolved", "", "btn-quiet", 'data-opt="rcv:rcv-done"'));
    const sel = state.rcRow ?? 0, r = rows[sel];
    const matchCell = o => o.st === "sug" ? `${glyph(o.cands[0][0])}${o.cands[0][1]} <span class="faint">· ${o.cands[0][2]}</span>`
      : o.st === "amb" ? `<span class="muted">${o.cands.length} possible matches</span>` : `<span class="faint">No transaction with this amount</span>`;
    const rowActs = o => rcIgnore() + (o.st === "sug" ? btnq("Match", "", "btn-quiet", 'data-opt="toast:toast-match"') : o.st === "amb" ? btnq("Choose", "") : btnq("Create…", "", "btn-quiet", 'data-dialog="create"'));
    const band = st => {
      const list = rows.map((o, i) => [o, i]).filter(([o]) => o.st === st);
      return `<div class="day flush"><span>${RC_ST[st][1]} <span class="tab faint">${list.length}</span></span>${st === "sug" ? `<span class="btn btn-ghost" data-opt="toast:toast-all">${I("checks")}Match all</span>` : "<span></span>"}</div>` +
        list.map(([o, i]) => `<div class="lrow recogrid-i${open && i === sel ? " sel" : ""}" data-open-peek data-rc="${i}"><span class="cat faint" title="${RC_ST[o.st][1]}">${I(RC_ST[o.st][0])}</span><span class="cell strong">${o.payee}</span><span class="cell muted hide-m">${o.d}</span><span class="cell hide-m">${matchCell(o)}</span><span class="acts hide-m">${rowActs(o)}</span>${rcAmt(o.a)}</div>`).join("");
    };
    const radio = ([c, t, dd, a], on) => lrow("16px 18px minmax(0,1fr) auto", [`<span class="radio${on ? " on" : ""}"></span>`, glyph(c), cell(`${t} <span class="faint">· ${dd}</span>`), money(a, r.a > 0)], { attrs: "" });
    const hasCands = r.st !== "mis" || !!r.near, canMatch = r.st === "sug" || !!r.near;
    const cands = r.st === "mis"
      ? (r.near
        ? `<div class="input" style="margin-bottom:8px">${I("search")}Luitpold</div>${subList([radio(r.near, true)])}<div class="rc-adj">${sw(true)}<span>Set the amount to ${fmt(Math.abs(r.a))}</span><span class="sp"></span><span class="muted tab">was ${fmt(r.near[3])}</span></div>`
        : `<div class="muted" style="padding:2px 0 10px">No transaction with ${fmt(Math.abs(r.a))} within 5 days.</div><div class="input">${I("search")}<span class="ph">Find a transaction</span></div>`)
      : subList(r.cands.map((c, i) => radio(c, r.st === "sug" && i === 0))) + `<div class="input" style="margin-top:8px">${I("search")}<span class="ph">Find another transaction</span></div>`;
    const peek = `<aside class="peek">${peekBar("Reconcile", r.payee)}<div class="pk-body"><div class="pk-title">${r.payee}</div><div class="pk-amt${r.a > 0 ? " in" : ""}">${r.a > 0 ? "+ " : ""}${fmt(Math.abs(r.a))}</div>
      <div class="props">${pv("Booked", `${r.d} 2026`)}${pv("Account", "Girokonto")}${pv("Purpose", r.purpose)}</div>
      <div class="pk-sec">Match</div>${cands}
      <div style="display:flex;gap:6px;margin-top:16px"><span class="btn ${hasCands ? "btn-primary" : "btn-quiet"}"${canMatch ? ' data-opt="toast:toast-match"' : ' aria-disabled="true"'}>Match</span><span class="btn ${hasCands ? "btn-quiet" : "btn-primary"}" data-dialog="create">Create…</span><span class="sp"></span>${rcIgnore()}</div>
    </div></aside>`;
    return head + `<div class="split"><div class="list">${["sug", "amb", "mis"].map(band).join("")}</div>${peek}</div>` + toast;
  },
  mount(root) {
    wireOpts(root);
    $$("[data-rc]", root).forEach(el => el.addEventListener("click", () => { state.rcRow = +el.dataset.rc; }));
    $$("[data-rc-done]", root).forEach(el => el.addEventListener("click", () => { state.rcDone = +el.dataset.rcDone; }));
  },
});

page("login", {
  title: "Sign in", bare: true,
  toggles: [{ k: "auth", label: "Screen", opts: [["auth-in", "Sign in"], ["auth-up", "Create account"], ["auth-setup", "First setup"]] }],
  render() {
    const m = opt("auth");
    const title = { "auth-in": "Sign in", "auth-up": "Create account", "auth-setup": "Create the admin account" }[m];
    const fields = ["Username", ...(m === "auth-setup" ? ["Setup token"] : []), "Password"];
    return `<div class="auth"><div class="brand" style="cursor:default;margin:0 auto 18px">${I("wallet", ' style="font-size:18px"')}Expenses</div>
      <div class="card auth-card"><div style="font-weight:600;font-size:15px;margin-bottom:14px">${title}</div>
        ${fields.map((f, i) => `<label class="auth-l">${f}</label><div class="input${i === 0 ? " focus" : ""}" style="margin-bottom:12px">${i === 0 ? `<span class="caret-i"></span>` : ""}</div>`).join("")}
        <span class="btn btn-primary" style="width:100%;justify-content:center;height:32px;margin-top:4px">${m === "auth-in" ? "Sign in" : "Create account"}</span></div>
      <div style="text-align:center;margin-top:12px">${m === "auth-in" ? `<span class="btn btn-ghost" data-opt-auth="auth-up">Create account</span>` : m === "auth-up" ? `<span class="btn btn-ghost" data-opt-auth="auth-in">Sign in instead</span>` : ""}</div></div>`;
  },
  mount(root) { $$("[data-opt-auth]", root).forEach(el => el.addEventListener("click", () => setOpt("auth", el.dataset.optAuth))); },
});

// 404: a spending calendar fills in week by week; the busiest days spell 404. The only decorative motion in the app.
const NF_PATH = "/budgets/2025-13";
const NF_FONT = { 4: ["101", "101", "111", "001", "001"], 0: ["111", "101", "101", "101", "111"] };
const nfCal = () => {
  const on = new Set();
  [[3, 4], [7, 0], [11, 4]].forEach(([c0, d]) => NF_FONT[d].forEach((row, y) => [...row].forEach((b, x) => b === "1" && on.add(`${c0 + x},${y + 1}`))));
  let seed = 11;
  const rnd = () => (seed = (seed * 9301 + 49297) % 233280) / 233280;
  const cells = [];
  for (let c = 0; c < 17; c++) for (let r = 0; r < 7; r++) {
    const hit = on.has(`${c},${r}`), v = rnd();
    const inside = c >= 3 && c <= 13 && r >= 1 && r <= 5;
    const lvl = hit ? (v > 0.12 ? 4 : 3) : inside ? (v < 0.88 ? 0 : 1) : v < 0.55 ? 0 : v < 0.93 ? 1 : 2;
    const tw = !hit && lvl > 0 && rnd() < 0.3;
    cells.push(`<i class="l${lvl}${tw ? " tw" : ""}${c === 16 && r === 4 ? " today" : ""}" style="--c:${c};--r:${r}"></i>`);
  }
  return `<div class="nf-art nf-cal"><div class="nf-months">${[["Jul", 0], ["Aug", 4], ["Sep", 9], ["Oct", 13]].map(([m, c]) => `<span style="--c:${c}">${m}</span>`).join("")}</div>
    <div class="nf-days">${[["Mon", 1], ["Wed", 3], ["Fri", 5]].map(([d, r]) => `<span style="--r:${r}">${d}</span>`).join("")}</div>
    <div class="nf-grid">${cells.join("")}</div>
    <div class="nf-legend">Less${[0, 1, 2, 3, 4].map(l => `<i class="l${l}"></i>`).join("")}More</div></div>`;
};
page("notfound", {
  title: "Not found", bare: true,
  toggles: [{ k: "nfm", label: "Motion", opts: [["nfm-full", "Full"], ["nfm-reduced", "Reduced"]] }],
  render: () => `<div class="nf"><div class="brand" style="cursor:default">${I("wallet", ' style="font-size:18px"')}Expenses</div>
    <div class="nf-stage" aria-hidden="true">${nfCal()}</div>
    <div class="nf-t">This page does not exist</div><div class="nf-p">${NF_PATH}</div>
    <span class="btn btn-primary" data-go="dashboard">Go to dashboard</span></div>`,
});
