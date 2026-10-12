// Recurring, Templates, Rules, Categories, Tags, tag detail.
const viewSeg = (k, opts) => `<span class="seg" data-static>${opts.map(([v, l]) => `<span class="${opt(k) === v ? "on" : ""}" data-opt="${k}:${v}">${l}</span>`).join("")}</span>`;
// Sort menu: keys, then two direction items named for the active key. Each key remembers its own direction.
const SORT_DIRS = { spent: ["Lowest first", "Highest first"], usage: ["Lowest first", "Highest first"], name: ["A to Z", "Z to A"], created: ["Oldest first", "Newest first"] };
const SORT_DEFAULT = { spent: "desc", usage: "desc", name: "asc", created: "asc" };
const sortState = (p, keys) => { const key = opt(`${p}sort`) || keys[0][0]; return [key, opt(`${p}dir-${key}`) || SORT_DEFAULT[key]]; };
const sortMenu = (p, keys) => {
  const [key, dir] = sortState(p, keys);
  const items = [...keys.map(([k, l]) => `<div class="mi" data-opt="${p}sort:${k}">${l}${k === key ? I("check") : ""}</div>`), SEP,
    ...["asc", "desc"].map((d, i) => `<div class="mi" data-opt="${p}dir-${key}:${d}">${SORT_DIRS[key][i]}${d === dir ? I("check") : ""}</div>`)];
  return `<span class="pill" data-menu>${I(dir === "asc" ? "sort-ascending" : "sort-descending")}${keys.find(([k]) => k === key)[1]}${menu(items).replace('class="menu', 'style="right:0;top:30px" class="menu')}</span>`;
};
const wireOpts = root => $$("[data-opt]", root).forEach(el => el.addEventListener("click", e => { e.stopPropagation(); const [k, v] = el.dataset.opt.split(":"); setOpt(k, v); }));
const lrow = (cols, cells, { sel = false, cls = "", attrs = "data-open-peek" } = {}) => `<div class="lrow ${cls}${sel ? " sel" : ""}" ${attrs} style="grid-template-columns:${cols}">${cells.join("")}</div>`;
const cell = (html, cls = "") => `<span class="cell ${cls}">${html}</span>`;
const pv = (label, value, cls = "") => `<span class="pl">${label}</span><span class="pv ${cls}">${value}</span>`;
const subList = rows => `<div class="card sub">${rows.join("")}</div>`;

const REC = [
  ["Housing", "Rent", "Every month", "1 Nov", "Auto", 1250], ["Utilities", "Stadtwerke München", "Every month", "20 Nov", "Auto", 78],
  ["Transport", "MVV monthly pass", "Every month", "20 Nov", "Auto", 63], ["Insurance", "Liability insurance", "Every year", "1 Mar", "Manual", 64.8],
  ["Subscriptions", "Spotify Family", "Every month", "13 Nov", "Auto", 17.99], ["Subscriptions", "iCloud+ 200 GB", "Every month", "4 Nov", "Auto", 2.99],
  ["Health", "Gym membership", "Every 4 weeks", "28 Oct", "Manual", 39.9],
];
const recPeek = audit => `<aside class="peek">${peekBar("Recurring", "Spotify Family", { full: "rechistory", actions: more([mi("Post now", "player-play"), SEP, mi("Delete rule", "trash", "danger")]) })}
  <div class="pk-body"><div class="pk-title">Spotify Family</div><div class="pk-amt">17,99 € <span class="faint" style="font-size:15px;font-weight:400">every month</span></div>
    <div class="props">${pv("Type", "Expense", "ed")}${pv("Category", glyph("Subscriptions") + "Subscriptions", "ed")}${pv("Repeats", "Every month on the 13th", "ed")}${pv("Starts", "13 Mar 2023", "ed")}${pv("Ends", "Never", "ed faint")}${pv("Post", sw(true) + "Automatically")}${pv("Weekends", sw(false) + "Allowed")}</div>
    ${audit ? `<div class="pk-sec">Cost</div><div class="props">${pv("Per day", "0,59 €", "tab")}${pv("Per year", "215,88 €", "tab")}${pv("5 years", "1.079,40 €", "tab")}</div>` : ""}
    <div class="pk-sec">Upcoming</div><div class="dates">${["13 Nov", "13 Dec", "13 Jan", "13 Feb"].map(d => `<span class="tag">${d}</span>`).join("")}</div>
    <div class="pk-sec">Posted<span class="sp"></span><span class="link" data-go="rechistory">All 31</span></div>${subList([["13 Oct 2026"], ["13 Sep 2026"], ["13 Aug 2026"]].map(([d]) => lrow("minmax(0,1fr) auto", [cell(d, "muted"), money(17.99)], { attrs: "" })))}
  </div></aside>`;

page("recurring", {
  title: "Recurring", peek: true,
  toggles: [{ k: "rv", label: "View", opts: [["rv-commit", "Commitments"], ["rv-audit", "Audit"]] }],
  dialogs: {
    add: () => [`<div class="dg-top">${seg(["Expense", "Income"])}<span class="sp"></span>${ib("x", "Close", "data-close-dlg")}</div>
        <div class="dg-amt"><span class="caret-i"></span><span class="ph">0,00 €</span></div><div class="dg-title ph">Name</div>
        <div class="dg-chips">${pill("category", "Category")}${pill("repeat", "Every month")}${pill("calendar", "From 1 Nov 2026")}${pill("calendar-off", "No end")}<span class="pill set">${I("bolt")}Post automatically</span>${pill("calendar-x", "Skip weekends")}</div>
        <div class="dg-chips muted" style="gap:10px">Next ${["1 Nov", "1 Dec", "1 Jan", "1 Feb"].join(" · ")}</div>
        <div class="dg-foot"><span class="sp"></span><span class="btn btn-ghost" data-close-dlg>Cancel</span><span class="btn btn-primary">Add rule</span></div>`, ""],
  },
  render() {
    const audit = opt("rv") === "rv-audit", open = opt("pk") === "pk-open";
    const head = bar("Recurring", `<span class="btn btn-primary" data-dialog="add">${I("plus")}Add<span class="hide-m"> rule</span></span>`) + `<div class="viewrow">${viewSeg("rv", [["rv-commit", "Commitments"], ["rv-audit", "Audit"]])}</div>`;
    const monthly = REC.map(r => [r[0], r[1], r[2].includes("year") ? r[5] / 12 : r[2].includes("4 weeks") ? (r[5] * 13) / 12 : r[5]]);
    const mt = monthly.reduce((s, r) => s + r[2], 0);
    if (audit) {
      return head + `<div class="split"><div class="content" style="padding:0;flex:1">
        ${strip([["Per month", fmt(mt), "7 expense rules"], ["Per year", fmt(mt * 12), ""], ["Over 5 years", fmt0(mt * 60), ""]], "c3")}
        ${card("Annual mix", { menuItems: [mi("Show as table", "table")], body: donut(monthly.slice(0, 6).map(([c, n, v]) => [n, v * 12, C(CAT[c][0])]), mt * 12, fmt0(mt * 12), "per year") })}
        <div class="list" style="flex:none"><div class="lhead audgrid"><span></span><span>Rule</span><span class="hide-m">Repeats</span><span class="hide-m">Next</span><span class="r">Per month</span><span class="r hide-m">Per year</span><span class="r hide-m">5 years</span></div>
          ${REC.map((r, i) => lrow("", [glyph(r[0]), cell(r[1], "strong"), cell(r[2], "muted hide-m"), cell(r[3], "muted hide-m"), cell(fmt(monthly[i][2]), "r tab"), cell(fmt0(monthly[i][2] * 12), "r tab muted hide-m"), cell(fmt0(monthly[i][2] * 60), "r tab muted hide-m")], { sel: open && i === 4, cls: "audgrid" })).join("")}</div>
      </div>${recPeek(true)}</div>`;
    }
    return head + `<div class="split"><div class="content" style="padding:0;flex:1">
      ${strip([["Income per month", "+ 4.300,00 €", "1 rule", "in"], ["Expenses per month", fmt(mt), "7 rules"], ["Covered", "294 %", "+ 2.839 € left per month"]], "c3")}
      <div class="list" style="flex:none">
        <div class="day flush"><span>Expenses</span><span class="tot">${fmt(mt)} per month</span></div>
        ${REC.map((r, i) => lrow("", [glyph(r[0]), cell(r[1], "strong"), cell(r[0], "muted hide-m"), cell(r[2], "muted hide-m"), cell(`Next ${r[3]}`, "muted"), cell(r[4] === "Auto" ? I("bolt", ' title="Posts automatically"') : "", "faint hide-m"), money(r[5])], { sel: open && i === 4, cls: "recgrid" })).join("")}
        <div class="day flush"><span>Income</span><span class="tot">+ 4.300,00 € per month</span></div>
        ${lrow("", [glyph("Salary"), cell("Salary", "strong"), cell("Salary", "muted hide-m"), cell("Every month", "muted hide-m"), cell("Next 1 Nov", "muted"), cell(I("bolt"), "faint hide-m"), money(4300, true)], { cls: "recgrid" })}
      </div></div>${recPeek(false)}</div>`;
  },
  mount: wireOpts,
});

page("rechistory", {
  title: "Recurring history", nav: "recurring",
  render: () => bar(crumb(["Recurring", "recurring"], ["Spotify Family"]), more([mi("Delete rule", "trash", "danger")])) +
    `<div class="content">${strip([["Amount", "17,99 €", "every month"], ["Next", "13 Nov 2026", "since 13 Mar 2023"], ["Posting", "Automatic", "no end date"], ["Posted", "31", "558,69 € in total"]])}
    <div class="list" style="flex:none">${["13 Oct 2026", "13 Sep 2026", "13 Aug 2026", "13 Jul 2026", "13 Jun 2026", "13 May 2026"].map(d => lrow("100px 18px minmax(0,1fr) auto", [cell(d, "muted"), glyph("Subscriptions"), cell("Spotify Family"), money(17.99)], { attrs: 'data-go="txfull"' })).join("")}</div></div>`,
});

page("templates", {
  title: "Templates", peek: true,
  render() {
    const rows = [["Groceries", "Edeka", "Edeka Schwabing", ["Essential"], null], ["Restaurants", "Lunch", "Lunch", [], 12.5], ["Transport", "MVV ticket", "MVV single ticket", ["Commute"], 3.7], ["Subscriptions", "Spotify", "Spotify Family", ["Recurring"], 17.99], ["Groceries", "Bakery", "Bäckerei Ziegler", ["Essential"], null], ["Salary", "Freelance invoice", "Invoice", ["Work"], null]];
    return bar("Templates", `<span class="btn btn-primary">${I("plus")}Add<span class="hide-m"> template</span></span>`) +
      `<div class="split"><div class="list">${rows.map(([c, n, t, tg, a], i) => lrow("", [`<span class="grip">${I("grip-vertical")}</span>`, glyph(c), cell(n, "strong"), cell(t, "muted hide-m"), `<span class="tags hide-m">${chips(tg, 2)}</span>`, a ? money(a, c === "Salary") : cell("Variable", "r faint")], { sel: opt("pk") === "pk-open" && i === 0, cls: "tplgrid" })).join("")}</div>
      <aside class="peek">${peekBar("Templates", "Edeka", { actions: more([mi("Delete template", "trash", "danger")]) })}<div class="pk-body"><div class="pk-title">Edeka</div>
        <div class="props">${pv("Type", "Expense", "ed")}${pv("Category", glyph("Groceries") + "Groceries", "ed")}${pv("Amount", "Variable", "ed faint")}${pv("Title", "Edeka Schwabing", "ed")}${pv("Tags", tag("Essential"))}</div></div></aside></div>`;
  },
});

page("rules", {
  title: "Rules", peek: true,
  toggles: [{ k: "rs", label: "Suggestions", opts: [["rs-on", "Shown"], ["rs-off", "None"]] }],
  render() {
    const open = opt("pk") === "pk-open";
    const rules = [[10, "Edeka and REWE", 'Title contains "edeka"', "Groceries", "+ Essential", true], [20, "Deutsche Bahn", 'Title starts with "DB "', "Travel", "", true], [50, "Coffee", 'Title matches "caf(e|é)"', "Restaurants", "", true], [100, "Small Amazon orders", 'Title contains "amazon" · at most 30 €', "Shopping", "", false], [100, "Work travel", 'Title contains "conference"', null, "+ Work, Reimbursable", true]];
    const sugg = [["Title contains \"rossmann\"", "Drugstore", "94 %"], ["Title contains \"aral\"", "Transport", "88 %"]];
    return bar("Rules", `<span class="btn btn-primary">${I("plus")}Add<span class="hide-m"> rule</span></span>` + more([mi("Find rule suggestions", "sparkles")])) +
      `<div class="split"><div class="content" style="padding:0;flex:1">
        ${opt("rs") === "rs-on" ? `<div class="list" style="flex:none"><div class="day flush"><span>Suggestions</span><span></span></div>${sugg.map(([w, c, conf]) => lrow("", [`<span class="cat faint">${I("sparkles")}</span>`, cell(w), cell(glyph(c) + c, "thenc"), cell(conf, "r tab faint"), `<span class="acts hide-m">${ib("check", "Accept")}${ib("x", "Reject")}</span>`], { cls: "sugggrid" })).join("")}</div>` : ""}
        <div class="list" style="flex:none"><div class="lhead rulegrid"><span class="r">#</span><span>Name</span><span class="hide-m">When</span><span>Then</span><span></span></div>
          ${rules.map(([p, n, w, c, t, on], i) => lrow("", [cell(p, "r tab faint"), cell(n, "strong"), cell(w, "muted hide-m"), cell((c ? glyph(c) + c : `<span class="faint">Keep category</span>`) + (t ? ` <span class="faint">${t}</span>` : ""), "thenc"), cell(on ? "" : "Off", "faint r")], { sel: open && i === 0, cls: "rulegrid" + (on ? "" : " dim-row") })).join("")}</div>
      </div>
      <aside class="peek">${peekBar("Rules", "Edeka and REWE", { actions: more([mi("Delete rule", "trash", "danger")]) })}<div class="pk-body"><div class="pk-title">Edeka and REWE</div>
        <div class="props" style="margin-top:8px">${pv("Enabled", sw(true))}${pv("Priority", "10", "ed tab")}</div>
        <div class="pk-sec">When</div><div class="props">${pv("Type", "Any", "ed")}${pv("Title", 'contains "edeka"', "ed")}${pv("Amount", "Any", "ed faint")}</div>
        <div class="pk-sec">Then</div><div class="props">${pv("Category", glyph("Groceries") + "Groceries", "ed")}${pv("Add tags", tag("Essential"))}${pv("Budgets", "Included", "ed faint")}</div>
        <div class="pk-sec">Matches<span class="sp"></span><span class="faint">12 recent</span></div>${subList([["Edeka Schwabing", 47.38, "Groceries"], ["EDEKA Center", 82.1, "Uncategorized"], ["Edeka Hbf", 9.4, "Uncategorized"]].map(([t, a, b]) => lrow("minmax(0,1fr) auto auto", [cell(t), cell(b === "Groceries" ? "" : `<span class="faint">${b} →</span> Groceries`, "muted"), money(a)], { attrs: "" })))}
      </div></aside></div>`;
  },
});

const CATS_EXP = [["Housing", 3], ["Groceries", 31], ["Restaurants", 14], ["Shopping", 9], ["Drugstore", 6], ["Travel", 4], ["Utilities", 2], ["Transport", 5], ["Home", 2], ["Subscriptions", 4], ["Insurance", 0]];
page("categories", {
  title: "Categories", peek: true,
  mount: wireOpts,
  dialogs: {
    merge: () => [`<div class="dg-top"><span class="t">Merge Restaurants</span><span class="sp"></span>${ib("x", "Close", "data-close-dlg")}</div>
      <div class="dg-body"><div class="form"><span class="fl">Into</span><span class="input">${glyph("Groceries")}Food and dining${I("chevron-down", ' style="margin-left:auto"')}</span></div>
      <div class="props wide" style="margin-top:12px">${pv("Transactions", "142", "tab")}${pv("Recurring rules", "0", "tab faint")}${pv("Rule actions", "2", "tab")}${pv("Budgets", "1 plan, 1 adjustment", "tab")}</div></div>
      <div class="warn">Restaurants is archived after the merge.</div>
      <div class="dg-foot"><span class="sp"></span><span class="btn btn-ghost" data-close-dlg>Cancel</span><span class="btn btn-primary">Merge</span></div>`, "narrow"],
  },
  render() {
    const open = opt("pk") === "pk-open";
    const row = ([n, u], i, arch) => lrow("", [glyph(n), cell(n, "strong"), cell(arch ? "Archived 3 Mar" : `${u} uses`, "muted r tab")], { sel: open && !arch && i === 2, cls: "catgrid" + (arch ? " dim-row" : "") });
    return bar("Categories", `<span class="btn btn-primary">${I("plus")}Add<span class="hide-m"> category</span></span>`) +
      `<div class="viewrow">${periodCtl("This month")}<span class="sp"></span>${sortMenu("c", [["usage", "Usage"], ["name", "Name"]])}</div>
      <div class="split"><div class="list">
        <div class="day flush"><span>Expenses</span><span class="tot">11</span></div>${CATS_EXP.map((r, i) => row(r, i)).join("")}
        <div class="day flush"><span>Income</span><span class="tot">3</span></div>${[["Salary", 1], ["Reimbursement", 2], ["Interest", 1]].map((r, i) => row(r, 99)).join("")}
        <div class="day flush"><span>Archived</span><span class="tot">2</span></div>${[["Health", 0], ["Other", 0]].map((r, i) => row(r, i, true)).join("")}
      </div>
      <aside class="peek">${peekBar("Categories", "Restaurants", { actions: more([mi("Merge into…", "arrow-merge", 'data-dialog="merge"'), mi("Archive", "archive"), SEP, mi("Delete", "trash", "danger")]) })}<div class="pk-body">
        <div class="pk-title" style="display:flex;align-items:center;gap:8px">${glyph("Restaurants")}Restaurants</div>
        <div class="props" style="margin-top:8px">${pv("Type", "Expense")}${pv("Icon", glyph("Restaurants") + "Fork and knife", "ed")}${pv("Order", "3", "ed tab")}${pv("This month", "14 uses · 238,00 €", "tab")}</div>
        <div class="pk-sec">Recent<span class="sp"></span><span class="link" data-go="transactions">All 142</span></div>${subList(T.filter(t => t.cat === "Restaurants").concat([{ title: "Café Luitpold", amt: 8.4 }, { title: "Pizzeria Bella", amt: 63 }]).map(t => lrow("minmax(0,1fr) auto", [cell(t.title), money(t.amt)], { attrs: "" })))}
      </div></aside></div>`;
  },
});

// [name, uses, auto-add, excluded from budgets, expenses, income] for the selected period, then created date
const TAGROWS = [["Essential", 61, "", false, 2184.3, 0, "2025-01-12"], ["Household", 24, "", false, 1126.45, 0, "2025-01-19"], ["Japan 2026", 38, "Auto 1 – 20 Apr · ended", true, 1640, 0, "2026-02-21"], ["Q4 offsite", 3, "Auto 2 – 4 Nov · upcoming", false, 486, 0, "2026-09-30"], ["Work", 12, "", false, 418.6, 380, "2025-11-02"], ["Shared", 9, "", false, 612.4, 236, "2025-08-14"], ["Reimbursable", 6, "", false, 254.9, 0, "2026-01-08"], ["Recurring", 18, "", false, 1398, 0, "2025-02-03"]];
const TAG_CMP = { spent: (a, b) => a[4] - b[4], usage: (a, b) => a[1] - b[1], name: (a, b) => a[0].localeCompare(b[0]), created: (a, b) => a[6].localeCompare(b[6]) };
const TAG_SORTS = [["spent", "Spent"], ["usage", "Usage"], ["name", "Name"], ["created", "Date created"]];
// Expenses in ink; income, when present, as a smaller + figure before it (only income: the + figure alone).
const tagAmt = (spent, income) => spent ? `<span class="amt">${income ? `<span class="net" style="color:var(--income)">+ ${fmt(income)}</span>` : ""}${fmt(spent)}</span>` : money(income, true);
page("tags", {
  title: "Tags", peek: true,
  mount: wireOpts,
  render() {
    const open = opt("pk") === "pk-open", [key, dir] = sortState("t", TAG_SORTS);
    return bar("Tags", `<span class="btn btn-primary">${I("plus")}Add<span class="hide-m"> tag</span></span>`) +
      `<div class="viewrow">${periodCtl("All time")}<span class="sp"></span>${sortMenu("t", TAG_SORTS)}</div>
      <div class="split"><div class="list">
        <div class="day flush"><span>Active</span><span class="tot">${TAGROWS.length}</span></div>
        ${[...TAGROWS].sort((a, b) => (dir === "asc" ? 1 : -1) * TAG_CMP[key](a, b)).map(([n, u, auto, ex, sp, inc], i) => lrow("", [cell(tag(n)), cell(auto, "muted hide-m"), cell(ex ? I("target-off", ' title="Excluded from budgets"') : "", "faint"), cell(`${u} uses`, "muted r tab hide-m"), cell(tagAmt(sp, inc), "r")], { sel: open && n === "Japan 2026", cls: "taggrid" })).join("")}
        <div class="day flush"><span>Archived</span><span class="tot">1</span></div>${lrow("", [cell(tag("Berlin 2025")), cell("Archived 12 Jan", "muted hide-m"), "<span></span>", cell("21 uses", "muted r tab hide-m"), cell(tagAmt(912.35, 0), "r")], { cls: "taggrid dim-row" })}
      </div>
      <aside class="peek">${peekBar("Tags", "Japan 2026", { full: "tagdetail", actions: more([mi("Merge into…", "arrow-merge"), mi("Archive", "archive"), SEP, mi("Delete", "trash", "danger")]) })}<div class="pk-body">
        <div class="pk-title">Japan 2026</div><div class="pk-amt">1.640,00 € <span class="faint" style="font-size:15px;font-weight:400">spent</span></div>
        <div class="props">${pv("Budgets", sw(false) + "Excluded")}${pv("Filter menus", sw(true) + "Shown")}${pv("Auto-add", "1 Apr – 20 Apr 2026", "ed")}${pv("Uses", "38", "tab")}${pv("Created", "21 Feb 2026")}</div>
        <div class="pk-sec">Recent<span class="sp"></span><span class="link" data-go="tagdetail">All 38</span></div>${subList([["Travel", "JAL Tokyo → Munich", 612], ["Travel", "Ryokan Kyoto", 284], ["Restaurants", "Ichiran Shibuya", 14.2]].map(([c, t, a]) => lrow("18px minmax(0,1fr) auto", [glyph(c), cell(t), money(a)], { attrs: "" })))}
      </div></aside></div>`;
  },
});

page("tagdetail", {
  title: "Tag (full)", nav: "tags",
  render() {
    const rows = [["Travel", "JAL Tokyo → Munich", "Sun 19 Apr", 612], ["Travel", "Ryokan Kyoto, 2 nights", "Thu 16 Apr", 284], ["Travel", "JR Pass 14 days", "Thu 2 Apr", 402], ["Restaurants", "Ichiran Shibuya", "Fri 3 Apr", 14.2], ["Shopping", "Tokyu Hands", "Sat 4 Apr", 46.8]];
    return bar(crumb(["Tags", "tags"], ["Japan 2026"]), more([mi("Merge into…", "arrow-merge"), mi("Archive", "archive"), SEP, mi("Delete", "trash", "danger")])) +
      `<div class="viewrow">${periodCtl("All time")}</div><div class="content">
      <div class="card strip c3"><div><div class="lab">Expenses</div><div class="num">1.640,00 €</div>${spark([0, 402, 470, 520, 804, 1028, 1640])}</div><div><div class="lab">Income</div><div class="num">0,00 €</div>${spark([0, 0, 0, 0, 0, 0, 0])}</div><div><div class="lab">Balance</div><div class="num">− 1.640,00 €</div>${spark([0, -402, -470, -520, -804, -1028, -1640])}</div></div>
      <div class="grid2"><div class="list" style="flex:none">${rows.map(([c, t, d, a]) => lrow("18px minmax(0,1fr) 90px auto", [glyph(c), cell(t, "strong"), cell(d, "muted"), money(a)], { attrs: 'data-go="txfull"' })).join("")}</div>
        <div style="display:grid;gap:8px;align-content:start">${card("Settings", { body: `<div class="props">${pv("Budgets", sw(false) + "Excluded")}${pv("Filter menus", sw(true) + "Shown")}${pv("Auto-add", "1 Apr – 20 Apr 2026", "ed")}</div>` })}
        ${card("Expenses", { body: donut([["Travel", 1298, C("Travel")], ["Restaurants", 218, C("Restaurants")], ["Shopping", 124, C("Shopping")]], 1640, "1.640 €", "Japan 2026") })}</div></div></div>`;
  },
});
