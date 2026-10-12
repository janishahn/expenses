// Budgets, Forecast, What If.
const monthPicker = label => `<span class="pill" data-menu>${I("chevron-left")}<span>${label}</span>${I("chevron-right")}<div class="menu float left mpick" style="left:0;top:30px"><div class="mp-year">${ib("chevron-left", "Previous year")}<b>2026</b>${ib("chevron-right", "Next year")}</div><div class="mp-grid">${["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"].map(m => `<span class="${m === "Oct" ? "on" : ""}">${m}</span>`).join("")}</div></div></span>`;

const BUD_ANNUAL = [{ cat: "Travel", spent: 1292, limit: 2500 }, { cat: "Home", spent: 1310, limit: 1200 }];
const budRow = (b, { sel = false, annual = false } = {}) => {
  const over = b.spent > b.limit;
  return `<div class="lrow budrow${sel ? " sel" : ""}" data-open-peek>${glyph(b.cat)}<span class="cell" style="font-weight:500">${b.cat}${b.usual ? `<span class="faint" style="font-weight:400"> · adjusted</span>` : ""}</span>
    ${pbar(b.spent / b.limit, { over, pace: annual ? null : PACE })}<span class="cell r tab muted hide-m">${fmt0(b.spent)} of ${fmt0(b.limit)}</span>
    <span class="cell r tab">${over ? `<span class="over" style="font-weight:500">${fmt0(b.spent - b.limit)} over</span>` : `${fmt0(b.limit - b.spent)} left`}</span></div>`;
};
// Cumulative spend by day for the overall budget
const DAYS = Array.from({ length: 31 }, (_, i) => String(i + 1));
const cum = (seed, total, upto) => { let s = 0; return DAYS.map((_, i) => { if (i >= upto) return null; s += (total / upto) * (0.55 + ((Math.sin(i * seed) + 1) / 2) * 0.9); return Math.round(s); }); };
const ACT = cum(1.7, 1531, 22), PREV = cum(2.3, 2290, 31), IDEAL = DAYS.map((_, i) => Math.round((2500 * (i + 1)) / 31));

page("budgets", {
  title: "Budgets", peek: true,
  toggles: [{ k: "bst", label: "Data", opts: [["bst-full", "Budgets set"], ["bst-empty", "Empty month"]] }],
  dialogs: {
    add: () => [`<div class="dg-top">${seg(["Monthly", "Annual"])}<span class="sp"></span>${ib("x", "Close", "data-close-dlg")}</div>
      <div class="dg-amt"><span class="caret-i"></span><span class="ph">0,00 €</span><span class="faint" style="font-size:15px;font-weight:400"> per month</span></div>
      <div class="dg-chips" style="padding-top:12px">${pill("category", "All expense categories")}${pill("calendar", "From Oct 2026")}${pill("calendar-off", "No end")}</div>
      <div class="dg-foot"><span class="sp"></span><span class="btn btn-ghost" data-close-dlg>Cancel</span><span class="btn btn-primary">Add budget</span></div>`, "narrow"],
  },
  render() {
    const head = bar("Budgets", `<span class="btn btn-primary" data-dialog="add">${I("plus")}Add<span class="hide-m"> budget</span></span>` + more([mi("Show ended and future budgets", "history")]));
    const view = `<div class="viewrow">${monthPicker("October 2026")}<span class="btn btn-ghost">Today</span></div>`;
    if (opt("bst") === "bst-empty") return head + view + `<div class="content"><div class="card">${emptyState("target", "No budgets for October", `<span class="btn btn-quiet" data-dialog="add">${I("plus")}Add budget</span>`)}</div></div>`;
    const open = opt("pk") === "pk-open";
    const chart = lineChart({
      labels: DAYS, h: 150, mark: 21, xEvery: 5,
      series: [{ v: IDEAL, color: "var(--ink-3)", dash: "4 4", w: 1.25 }, { v: ACT }],
      tip: i => `Day ${i + 1} · ideal <b>${fmt0(IDEAL[i])}</b>${ACT[i] != null ? ` · actual <b>${fmt0(ACT[i])}</b>` : ""}`,
    });
    const peekChart = lineChart({
      labels: DAYS, h: 110, mark: 21, xEvery: 10,
      series: [{ v: DAYS.map((_, i) => Math.round((250 * (i + 1)) / 31)), color: "var(--ink-3)", dash: "4 4", w: 1.25 }, { v: cum(0.9, 249, 22) }],
      tip: i => `Day ${i + 1}`,
    });
    return head + view + `<div class="split"><div class="content" style="padding:0;flex:1">
        ${strip([["Overall budget", "2.500,00 €", "All expense categories"], ["Spent", "1.531,30 €", "61 % used"], ["Left", "968,70 €", "107,63 € per day"], ["Projected", "2.158,00 €", "on pace · 0,86×"]])}
        ${card("Overall pace", { menuItems: [mi("Compare previous month", "history"), SEP, mi("Edit overall budget", "pencil")], body: chart + `<div class="legend"><span><i class="line" style="background:var(--ink)"></i>Actual</span><span><i class="line" style="background:repeating-linear-gradient(90deg,var(--ink-3) 0 4px,transparent 4px 7px)"></i>Even pace</span></div>` })}
        <div class="list" style="flex:none">
          <div class="day flush"><span>Monthly</span><span class="tot">1.251 of 1.610 €</span></div>
          ${BUDGETS.map((b, i) => budRow(b, { sel: open && i === 1 })).join("")}
          <div class="day flush"><span>Annual · 2026</span><span class="tot">2.602 of 3.700 €</span></div>
          ${BUD_ANNUAL.map(b => budRow(b, { annual: true })).join("")}
        </div>
      </div>
      <aside class="peek">${peekBar("Budgets", "Restaurants", { actions: more([mi("Reset to usual 200 €", "arrow-back-up"), SEP, mi("Remove October budget", "trash", "danger")]) })}
        <div class="pk-body">
          <div class="pk-title" style="display:flex;align-items:center;gap:8px">${glyph("Restaurants")}Restaurants</div>
          <div class="pk-amt">249,00 € <span class="faint" style="font-size:15px;font-weight:400">of 250,00 €</span></div>
          <div class="props">
            <span class="pl">Amount</span><span class="pv ed">250,00 € <span class="faint">· usually 200,00 €</span></span>
            <span class="pl">Applies to</span><span class="pv ed" data-menu>Only October${menu([mi("Only October" + I("check")), mi("October and later")], "left").replace('class="menu', 'style="left:0;top:32px" class="menu')}</span>
            <span class="pl">Repeats</span><span class="pv">Every month</span>
            <span class="pl">Started</span><span class="pv">Jan 2026</span>
            <span class="pl">Projected</span><span class="pv over tab">339,00 €</span>
            <span class="pl">Allowance</span><span class="pv tab">0,11 € per day</span>
          </div>
          <div class="pk-sec">Pace</div>${peekChart}
          <div class="pk-sec">Top spending days</div>
          <div class="card sub">${[["Thu 22 Oct", "Ramen Kazu", 96], ["Sat 10 Oct", "Café Luitpold, Pizzeria Bella", 71.4], ["Fri 2 Oct", "Lunch with Maren", 38.5]].map(([d, t, a]) => `<div class="lrow" style="grid-template-columns:80px minmax(0,1fr) auto"><span class="muted">${d}</span><span class="cell">${t}</span>${money(a)}</div>`).join("")}</div>
        </div></aside></div>`;
  },
  mount(root) { hoverTips(root, ".budrow .bt", el => { const n = el.closest(".budrow").querySelector(".cell").firstChild.textContent; const b = [...BUDGETS, ...BUD_ANNUAL].find(x => x.cat === n); return `${b.cat} <b>${fmt(b.spent)}</b> of ${fmt0(b.limit)}`; }); },
});

const FC = { labels: ["Now", "Nov", "Dec", "Jan 27", "Feb", "Mar", "Apr"], exp: [28008, 28620, 28910, 29880, 30540, 31120, 31690], rec: [28008, 28950, 29620, 30900, 31890, 32800, 33750], lo: [28008, 27980, 27720, 28160, 28330, 28420, 28510], hi: [28008, 29240, 30080, 31560, 32700, 33790, 34850] };
const FC_ROWS = [["Nov 2026", 4314, 3702], ["Dec 2026", 4314, 4024], ["Jan 2027", 5284, 4314], ["Feb 2027", 4314, 3654], ["Mar 2027", 4314, 3734], ["Apr 2027", 4314, 3744]];

page("forecast", {
  title: "Forecast", peek: true,
  render() {
    const open = opt("pk") === "pk-open";
    const chart = lineChart({
      labels: FC.labels, h: 220, yAxis: true, mark: 0, idle: 0,
      series: [{ v: FC.rec, color: "var(--ink-3)", dash: "4 4", w: 1.25 }, { v: FC.exp }],
      band: { lo: FC.lo, hi: FC.hi },
      tip: i => i === 0 ? `Now <b>${fmt(FC.exp[0])}</b>` : `${FC.labels[i]} · expected <b>${fmt0(FC.exp[i])}</b> · 80% range ${fmt0(FC.lo[i])} – ${fmt0(FC.hi[i])} · recurring only ${fmt0(FC.rec[i])}`,
    });
    return bar("Forecast", `<span class="btn btn-ghost" data-go="whatif">${I("flask")}What if</span>`) +
      `<div class="viewrow">${seg(["3 months", "6 months", "12 months"], 1)}${seg(["Recurring only", "With estimates"], 1)}</div>
      <div class="split"><div class="content" style="padding:0;flex:1">
        ${strip([["Balance in Apr 2027", "31.690,00 €", "80% range 28.510 – 34.850 €"], ["Average monthly net", "+ 614,00 €", "recent median spending", "in"], ["Below zero", "Not expected", "not within the 80% range"]], "c3")}
        ${card("Balance", { controls: ib("info-circle", "Seasonal median of 30 months of history. Includes 412 € still expected this month."), menuItems: [mi("Show as table", "table")], body: chart + `<div class="legend"><span><i class="line" style="background:var(--ink)"></i>Expected</span><span><i class="line" style="background:repeating-linear-gradient(90deg,var(--ink-3) 0 4px,transparent 4px 7px)"></i>Recurring only</span>${legendBand("80% range")}</div>` })}
        <div class="list" style="flex:none">
          <div class="lhead fcgrid"><span>Month</span><span class="r hide-m">Income</span><span class="r hide-m">Expenses</span><span class="r">End balance</span><span class="r hide-m">80% range</span></div>
          ${FC_ROWS.map(([m, inc, ex], i) => `<div class="lrow fcgrid${open && i === 0 ? " sel" : ""}" data-open-peek><span class="cell" style="font-weight:500">${m}</span><span class="cell r tab in hide-m">+ ${fmt0(inc)}</span><span class="cell r tab hide-m">${fmt0(ex)}</span><span class="cell r tab" style="font-weight:500">${fmt0(FC.exp[i + 1])}</span><span class="cell r tab muted hide-m">${fmt0(FC.lo[i + 1])} – ${fmt0(FC.hi[i + 1])}</span></div>`).join("")}
        </div>
      </div>
      <aside class="peek">${peekBar("Forecast", "November 2026")}
        <div class="pk-body"><div class="pk-title">November 2026</div><div class="pk-amt">28.620,00 €</div>
          <div class="props"><span class="pl">80% range</span><span class="pv tab">27.980 – 29.240 €</span><span class="pl">Lowest</span><span class="pv tab">27.640 €</span><span class="pl">Income</span><span class="pv tab in">+ 4.314,00 €</span><span class="pl">Expenses</span><span class="pv tab">3.702,00 €</span></div>
          <div class="pk-sec">Recurring</div><div class="card sub">${[["Salary", "Salary", 4300, true], ["Housing", "Rent", 1250], ["Utilities", "Stadtwerke München", 78], ["Transport", "MVV monthly pass", 63], ["Subscriptions", "Spotify Family", 17.99]].map(([c, t, a, inc]) => `<div class="lrow" style="grid-template-columns:18px minmax(0,1fr) auto">${glyph(c)}<span class="cell">${t}</span>${money(a, inc)}</div>`).join("")}</div>
          <div class="pk-sec">Estimated</div><div class="card sub">${[["Groceries", 425], ["Restaurants", 248], ["Shopping", 205], ["Travel", 180], ["Other", 140]].map(([c, a]) => `<div class="lrow" style="grid-template-columns:18px minmax(0,1fr) auto">${glyph(c)}<span class="cell">${c}</span>${money(a)}</div>`).join("")}</div>
          <div class="pk-sec">One-time</div><div class="faint" style="padding:4px 0">None</div>
        </div></aside></div>`;
  },
});

const WI = { months: ["Nov", "Dec", "Jan", "Feb", "Mar", "Apr"], adj: [
  ["Cancel Spotify Family", "circle-minus", [18, 18, 18, 18, 18, 18]],
  ["Restaurants at 180 € per month", "adjustments", [70, 70, 70, 70, 70, 70]],
  ["Salary 4.500 € from Nov", "pencil", [200, 200, 200, 200, 200, 200]],
  ["Laptop repair in Jan", "calendar-event", [0, 0, -420, 0, 0, 0]],
] };
page("whatif", {
  title: "What If",
  toggles: [{ k: "wif", label: "Adjustment form", opts: [["wif-closed", "Closed"], ["wif-open", "Open"]] }],
  render() {
    const impact = WI.months.map((_, i) => WI.adj.reduce((s, a) => s + a[2][i], 0));
    const cumi = impact.reduce((acc, v) => [...acc, (acc.at(-1) || 0) + v], []);
    const scen = FC.exp.map((v, i) => (i === 0 ? v : v + cumi[i - 1]));
    const chart = lineChart({
      labels: FC.labels, h: 200, yAxis: true,
      series: [{ v: FC.exp, color: "var(--ink-3)", dash: "4 4", w: 1.25 }, { v: scen }],
      band: { lo: FC.exp, hi: scen },
      tip: i => `${FC.labels[i]} · scenario <b>${fmt0(scen[i])}</b> · baseline ${fmt0(FC.exp[i])} · ${signed0(scen[i] - FC.exp[i])}`,
    });
    const form = opt("wif") === "wif-open" ? `<div class="wif-form"><div class="form"><span class="fl">Type</span><span class="input">Adjust category estimate${I("chevron-down", ' style="margin-left:auto"')}</span><span class="fl">Category</span><span class="input">${glyph("Groceries")}Groceries</span><span class="fl">Per month</span><span class="input"><span class="tab">380,00 €</span></span></div><div style="display:flex;gap:6px;justify-content:flex-end;margin-top:10px"><span class="btn btn-ghost">Cancel</span><span class="btn btn-primary">Add</span></div></div>` : "";
    return bar("What If", more([mi("Clear all adjustments", "eraser", "danger")])) +
      `<div class="viewrow">${seg(["3 months", "6 months", "12 months"], 1)}${seg(["Recurring only", "With estimates"], 1)}</div>
      <div class="split wif"><div class="content" style="padding:0;flex:1">
        ${strip([["Baseline in Apr", "31.690,00 €", "current rules and spending"], ["Scenario in Apr", fmt(scen.at(-1)), "after 4 adjustments"], ["Difference", signed(cumi.at(-1)), "over 6 months", "in"]], "c3")}
        ${card("Balance", { menuItems: [mi("Show as table", "table")], body: chart + `<div class="legend"><span><i class="line" style="background:var(--ink)"></i>Scenario</span><span><i class="line" style="background:repeating-linear-gradient(90deg,var(--ink-3) 0 4px,transparent 4px 7px)"></i>Baseline</span>${legendBand("Difference")}</div>` })}
        <div class="list" style="flex:none"><div class="lhead wigrid"><span>Adjustment</span>${WI.months.map(m => `<span class="r hide-m">${m}</span>`).join("")}<span class="r">Total</span></div>
          ${WI.adj.map(([n, , v]) => `<div class="lrow wigrid"><span class="cell">${n}</span>${v.map(x => `<span class="cell r tab hide-m ${x > 0 ? "in" : x < 0 ? "" : "faint"}">${x ? signed0(x) : "–"}</span>`).join("")}<span class="cell r tab" style="font-weight:500">${signed0(v.reduce((a, b) => a + b, 0))}</span></div>`).join("")}
          <div class="lrow wigrid" style="font-weight:600"><span class="cell">Total</span>${impact.map(x => `<span class="cell r tab hide-m">${signed0(x)}</span>`).join("")}<span class="cell r tab in">${signed0(cumi.at(-1))}</span></div></div>
      </div>
      <aside class="card adjust"><div class="ch"><span class="t">Adjustments</span><span class="meta">4</span><span class="sp"></span><span class="btn btn-quiet" data-menu>${I("plus")}Add${menu([mi("Remove a recurring rule", "circle-minus"), mi("Add a recurring rule", "circle-plus"), mi("Change a recurring rule", "pencil"), mi("One-time event", "calendar-event"), mi("Category estimate", "adjustments")]).replace('class="menu', 'style="right:0;top:32px" class="menu')}</span></div>
        ${form}<div style="padding:0 0 8px">${WI.adj.map(([n, ic]) => `<div class="lrow" style="grid-template-columns:18px minmax(0,1fr) 28px"><span class="cat faint">${I(ic)}</span><span class="cell">${n}</span>${ib("x", "Remove adjustment")}</div>`).join("")}</div></aside></div>`;
  },
});
