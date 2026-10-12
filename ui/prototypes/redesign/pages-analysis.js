// Insights, Digest, Reports, Assistant.
const M12 = ["Nov", "Dec", "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct"];
const INC12 = [4300, 5270, 4300, 4300, 4320, 4300, 4310, 4300, 4300, 4300, 5230, 4346];
const EXP12 = [2710, 3480, 2390, 2240, 2610, 2550, 2457, 2379, 2967, 2568, 2867, 2568];


// Proposal data. Category columns add up to EXP12; Oct is the month in progress.
const CAT12 = {
  Housing: Array(12).fill(1250),
  Groceries: [430, 520, 395, 380, 410, 418, 441, 402, 430, 398, 455, 412],
  Shopping: [310, 720, 140, 120, 180, 160, 220, 145, 160, 310, 190, 257],
  Restaurants: [248, 330, 180, 196, 240, 226, 226, 212, 280, 249, 301, 238],
  Travel: [90, 260, 0, 0, 210, 180, 0, 40, 610, 92, 420, 130],
  Other: [227, 239, 264, 139, 171, 173, 179, 189, 96, 128, 110, 140],
  Utilities: [92, 98, 98, 92, 86, 80, 78, 78, 78, 78, 78, 78],
  Transport: Array(12).fill(63),
};
const TAG12 = {
  Essential: [1820, 1930, 1790, 1760, 1800, 1795, 1810, 1772, 1790, 1774, 1830, 1790],
  Household: [180, 420, 150, 140, 170, 160, 190, 150, 170, 260, 180, 240],
  "Japan 2026": [0, 0, 0, 0, 120, 90, 0, 0, 980, 0, 360, 0],
  Shared: [140, 260, 90, 110, 150, 120, 130, 110, 190, 150, 210, 128],
  Work: [60, 0, 40, 30, 90, 70, 20, 40, 110, 30, 140, 90],
};
// Income columns add up to INC12.
const INCCAT12 = {
  Salary: [4300, 5270, 4300, 4300, 4300, 4300, 4300, 4300, 4300, 4300, 4300, 4300],
  Reimbursement: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 930, 32],
  Interest: [0, 0, 0, 0, 20, 0, 10, 0, 0, 0, 0, 14],
};
const REC12 = M12.map((_, i) => (i === 4 ? 1517 : 1452));
// [category, monthly limit, spending per month, first month with this budget]
const BUD12 = [["Groceries", 600, CAT12.Groceries, 0], ["Restaurants", 250, CAT12.Restaurants, 2], ["Shopping", 300, CAT12.Shopping, 0], ["Travel", 250, CAT12.Travel, 0], ["Utilities", 90, CAT12.Utilities, 0], ["Subscriptions", 120, [96, 96, 110, 104, 104, 112, 118, 118, 118, 121, 126, 140], 0]];
const DOW = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
// Spending per day without recurring, 53 weeks ending in the current week.
const DAILY = (() => {
  let seed = 11;
  const r = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const today = new Date(2026, 9, 22), start = new Date(today);
  start.setDate(start.getDate() - ((today.getDay() + 6) % 7) - 52 * 7);
  const known = { "21 Oct": 323.31, "22 Oct": 84.18, "20 Oct": 0 }, out = [];
  for (let i = 0; i < 53 * 7; i++) {
    const d = new Date(start); d.setDate(start.getDate() + i);
    const wd = (d.getDay() + 6) % 7, m = d.getMonth(), day = d.getDate(), label = d.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" });
    let v = null;
    if (d <= today) {
      v = r() < 0.27 ? 0 : [14, 12, 16, 18, 27, 44, 31][wd] * (0.35 + r() * 1.5);
      if (r() < 0.035) v += 70 + r() * 140;
      if (m === 11 && day < 24) v += 15 + r() * 45;
      if ((m === 6 && day >= 10 && day <= 17) || (m === 8 && day >= 18 && day <= 22)) v += 50 + r() * 90;
      const k = `${day} ${d.toLocaleString("en", { month: "short" })}`;
      if (d.getFullYear() === 2026 && k in known) v = known[k];
      v = Math.round(v * 100) / 100;
    }
    out.push({ d, wd, v, label });
  }
  return out;
})();
const pct = p => (Math.round(p * 100) === 0 ? "0 %" : `${p > 0 ? "+" : "−"} ${Math.abs(Math.round(p * 100))} %`);
const sum = a => a.reduce((x, y) => x + y, 0);
const monthHead = tail => `<span></span>${M12.map(m => `<span class="hm-h" data-i="${m[0]}">${m}</span>`).join("")}${tail}`;

function heatmap(rows) {
  // Oct is in progress: it is marked, excluded from the row scale, and compared with nothing.
  // Rows with spending in fewer than 6 full months are irregular and show no change.
  return `<div class="hm tt-host">${monthHead(`<span class="hm-h r">Total</span><span class="hm-h r hide-m">Sep vs avg</span>`)}${rows.map(([name, label, vals, col]) => {
    const full = vals.slice(0, 11), lo = Math.min(...full), hi = Math.max(...full), avg = sum(full) / 11, regular = full.filter(v => v).length >= 6;
    const shade = v => (hi > lo ? Math.round(10 + 65 * Math.min(1, Math.max(0, (v - lo) / (hi - lo)))) : 16);
    return `<span class="hm-n">${label}</span>${vals.map((v, i) => `<span class="hm-c${v ? "" : " z"}${i === 11 ? " now" : ""}" data-go="transactions" style="${v ? `background:color-mix(in srgb, ${col} ${shade(v)}%, var(--sheet))` : ""}" data-tt="${name} · ${M12[i]}${i === 11 ? " so far" : ""} <b>${fmt0(v)}</b>${i === 11 || !regular ? "" : ` · ${pct((v - avg) / avg)} vs average`}"></span>`).join("")}<span class="hm-t">${fmt0(sum(vals))}</span><span class="hm-d hide-m">${regular ? pct((vals[10] - avg) / avg) : "–"}</span>`;
  }).join("")}</div><div class="scale"><span>Lowest</span>${[10, 26, 42, 58, 75].map(p => `<i style="background:color-mix(in srgb, var(--ink-2) ${p}%, var(--sheet))"></i>`).join("")}<span>Highest month in each row</span><i class="now"></i><span>In progress</span></div>`;
}

function stackedCols() {
  const H = 150, top = Math.max(...EXP12) * 1.06, ticks = niceTicks(0, top, 4);
  return `<div class="chart-wrap with-y"><div class="yax" style="height:${H}px">${ticks.map(t => `<span class="ylab" style="top:${(1 - t / top) * 100}%">${fmt0(t)}</span>`).join("")}</div>
    <div class="plot" style="height:${H}px">${ticks.map(t => `<i class="gl" style="bottom:${(t / top) * 100}%"></i>`).join("")}<div class="vbars stk tt-host" style="height:${H}px">${M12.map((m, i) => `<div data-tt="${m} · recurring <b>${fmt0(REC12[i])}</b> · other <b>${fmt0(EXP12[i] - REC12[i])}</b>"><span style="height:${((EXP12[i] - REC12[i]) / top) * 100}%;background:var(--ink-2)"></span><span style="height:${(REC12[i] / top) * 100}%;background:var(--rec)"></span></div>`).join("")}</div></div>
    <div class="xlab cols">${M12.map(m => `<span data-i="${m[0]}">${m}</span>`).join("")}</div></div>`;
}

function rhythm() {
  const lv = v => (v === 0 ? 0 : v < 25 ? 1 : v < 60 ? 2 : v < 120 ? 3 : 4);
  const months = [];
  for (let w = 0; w < 53; w++) { const f = DAILY.slice(w * 7, w * 7 + 7).find(x => x.d.getDate() === 1); if (f) months.push(`<span style="grid-column:${w + 1} / span 4">${f.d.toLocaleString("en", { month: "short" })}</span>`); }
  const past = DAILY.filter(x => x.v != null), avg = DOW.map((_, i) => { const ds = past.filter(x => x.wd === i); return sum(ds.map(x => x.v)) / ds.length; }), amax = Math.max(...avg);
  const weekend = sum(past.filter(x => x.wd > 4).map(x => x.v)) / sum(past.map(x => x.v));
  return `<div class="rhythm"><div>
      <div class="cal-wrap"><div class="cal-days"><span></span><span>Mon</span><span></span><span>Wed</span><span></span><span>Fri</span><span></span><span></span></div>
        <div class="cal-scroll"><div class="cal-in"><div class="cal-m">${months.join("")}</div><div class="cal tt-host">${DAILY.map(x => (x.v == null ? `<i class="fut"></i>` : `<i class="l${lv(x.v)}" data-go="transactions" data-tt="${x.label} · <b>${x.v ? fmt(x.v) : "nothing"}</b>"></i>`)).join("")}</div></div></div></div>
      <div class="scale">${["None", "Under 25 €", "25–60 €", "60–120 €", "120 € or more"].map((l, i) => `<i class="l${i}"></i><span>${l}</span>`).join("")}</div></div>
    <div class="wkp"><div class="wkp-h"><span class="muted">Average by weekday</span><span class="sp"></span><span>Weekends <b class="tab">${Math.round(weekend * 100)} %</b></span></div>
      <div class="wkd tt-host">${avg.map((v, i) => `<div data-tt="${DOW[i]} · average <b>${fmt(v)}</b>"><span class="${i > 4 ? "we" : ""}" style="height:${(v / amax) * 100}%"></span></div>`).join("")}</div>
      <div class="wkd-l">${"MTWTFSS".split("").map(l => `<span>${l}</span>`).join("")}</div></div></div>`;
}

function budgetHistory() {
  return `<div class="hm brec tt-host">${monthHead(`<span class="hm-h r">Within</span>`)}${BUD12.map(([c, lim, vals, from]) => {
    let ok = 0, n = 0;
    const cells = vals.map((v, i) => {
      if (i < from) return `<span class="bc na" data-tt="${c} · ${M12[i]} · no budget"></span>`;
      const now = i === 11, spent = now ? BUDGETS.find(b => b.cat === c).spent : v, p = spent / lim, over = p > 1;
      if (!now) { n++; if (!over) ok++; }
      return `<span class="bc${over ? " over" : ""}${now ? " now" : ""}" data-go="budgets" data-tt="${c} · ${M12[i]}${now ? " so far" : ""} <b>${fmt0(spent)}</b> of ${fmt0(lim)} · ${Math.round(p * 100)} %"></span>`;
    }).join("");
    return `<span class="hm-n">${glyph(c)}${c}</span>${cells}<span class="hm-t">${ok} of ${n}</span>`;
  }).join("")}</div><div class="scale"><i class="ok"></i><span>Within</span><i class="over"></i><span>Over</span><i class="now"></i><span>In progress</span><i class="na"></i><span>No budget</span></div>`;
}

function insightsProposal() {
  const inc = sum(INC12), exp = sum(EXP12), rec = sum(REC12), mode = opt("ihm") || "cats";
  const sorted = o => Object.entries(o).sort((a, b) => sum(b[1]) - sum(a[1]));
  const rows = mode === "tags" ? sorted(TAG12).map(([t, v]) => [t, tag(t), v, "var(--ink-2)"])
    : sorted(mode === "income" ? INCCAT12 : CAT12).map(([c, v]) => [c, glyph(c) + c, v, C(CAT[c][0])]);
  const rowSeg = `<span class="seg" data-static>${[["cats", "Expenses"], ["income", "Income"], ["tags", "Tags"]].map(([v, l]) => `<span class="${mode === v ? "on" : ""}" data-opt="ihm:${v}">${l}</span>`).join("")}</span>`;
  return `<div class="content">
    ${strip([["Income", fmt0(inc), "12 months"], ["Spent", fmt0(exp), `${fmt0(exp / 12)} per month`], ["Saved", fmt0(inc - exp), `${Math.round(((inc - exp) / inc) * 100)} % of income`], ["Recurring", `${Math.round((rec / exp) * 100)} %`, `of spending · ${fmt0(rec / 12)} per month`]])}
    <div class="grid2b">
      ${card("Income and expenses", { meta: `${Math.round(((inc - exp) / inc) * 100)} % saved`, menuItems: [mi("Show as table", "table")], body: lineChart({ labels: M12, h: 150, yAxis: true, band: { lo: EXP12, hi: INC12, fill: "var(--saved)" }, series: [{ v: INC12, color: "var(--income)" }, { v: EXP12 }], tip: i => `${M12[i]} · income <b>${fmt0(INC12[i])}</b> · expenses <b>${fmt0(EXP12[i])}</b> · saved <b>${fmt0(INC12[i] - EXP12[i])}</b> (${Math.round(((INC12[i] - EXP12[i]) / INC12[i]) * 100)} %)` }) + legend([["Income", "var(--income)", "line"], ["Expenses", "var(--ink)", "line"], ["Saved", "var(--saved)", "area"]]) })}
      ${card("Recurring and other spending", { meta: `${Math.round((rec / exp) * 100)} % recurring`, menuItems: [mi("Show as table", "table")], body: stackedCols() + legend([["Recurring", "var(--rec)"], ["Other", "var(--ink-2)"]]) })}
    </div>
    ${card("By month", { controls: rowSeg, menuItems: [mi("Show as table", "table")], body: heatmap(rows) })}
    ${card("Daily spending", { meta: "without recurring", menuItems: [mi("Include recurring", "repeat"), SEP, mi("Show as table", "table")], body: rhythm() })}
    ${card("Budget history", { controls: ib("arrow-right", "Open budgets", 'data-go="budgets"'), menuItems: [mi("Show as table", "table")], body: budgetHistory() })}
  </div>`;
}

page("insights", {
  title: "Insights",
  render() {
    return bar("Insights") + `<div class="viewrow">${periodCtl("Last 12 months", ["Last 12 months", "This month", "Last month", "All time"])}<span class="sp"></span>${filterPill()}</div>` + insightsProposal();
  },
  mount(root) {
    $$("[data-opt]", root).forEach(el => el.addEventListener("click", () => { const [k, v] = el.dataset.opt.split(":"); setOpt(k, v); }));
    $$(".tt-host", root).forEach(h => hoverTips(h, "[data-tt]", el => el.dataset.tt));
  },
});

page("digest", {
  title: "Digest",
  render() {
    const week = [["Groceries", 142.3], ["Restaurants", 118.4], ["Travel", 89.9], ["Shopping", 61], ["Transport", 63], ["Other", 137.8]], wt = week.reduce((s, r) => s + r[1], 0);
    return bar("Digest") + `<div class="viewrow">${period("12 – 18 Oct 2026")}</div>
      <div class="content">
        ${strip([["Spent", "612,40 €", "23 transactions"], ["vs last week", "+ 84,10 €", "528,30 € last week"], ["vs 4-week average", "− 41,60 €", "654,00 € average"], ["Budgets on pace", "4 of 6", "2 over pace"]])}
        ${card("Week", { body: `<div class="track" style="height:18px" id="wk">${week.map(([c, v]) => `<span data-cat="${c}" style="width:${(v / wt) * 100}%;background:${C(c)}"></span>`).join("")}</div>
          <div class="dl" style="margin-top:12px">${week.map(([c, v]) => `<div><span data-cat="${c}"><i style="background:${C(c)}"></i>${c}</span><span data-cat="${c}" class="a">${fmt(v)}</span><span data-cat="${c}" class="p">${Math.round((v / wt) * 100)} %</span></div>`).join("")}</div>` })}
        <div class="grid2b">
          ${card("Top categories", { bodyCls: "", body: `<div style="padding:0 0 10px">${week.slice(0, 5).map(([c, v], i) => `<div class="lrow" style="grid-template-columns:18px 96px minmax(0,1fr) 84px 96px" data-go="transactions">${glyph(c)}<span class="cell">${c}</span>${pbar(v / 142.3)}<span class="cell r tab">${fmt0(v)}</span><span class="cell r tab faint">${i === 1 ? `<span style="color:var(--ink)">${I("arrow-up-right")}</span> ` : ""}avg ${fmt0([120, 61, 140, 74, 63][i])}</span></div>`).join("")}</div>` })}
          ${card("Budgets", { controls: ib("arrow-right", "Open budgets", 'data-go="budgets"'), body: `<div class="bud">${BUDGETS.map(b => `${glyph(b.cat)}<span>${b.cat}</span>${pbar(b.spent / b.limit, { over: b.spent > b.limit, pace: PACE })}<span class="bv">${b.spent > b.limit ? `<span class="o">${fmt0(b.spent - b.limit)} over</span>` : `<b>${fmt0(b.limit - b.spent)}</b> left`}</span>`).join("")}</div>` })}
        </div>
        <div class="grid2b">
          ${card("Unusual", { bodyCls: "", body: `<div style="padding:0 0 8px">${[["Restaurants", "Ramen Kazu — dinner with Lena and Tom", "avg 32 €", 96], ["Home", "IKEA Brunnthal — Kallax shelf", "avg 48 €", 214.96]].map(([c, t, a, v]) => `<div class="rrow" style="grid-template-columns:18px minmax(0,1fr) auto auto" data-go="txfull">${glyph(c)}<span class="tt">${t}</span><span class="faint tab">${a}</span>${money(v)}</div>`).join("")}</div>` })}
          ${card("Auto-posted", { bodyCls: "", body: `<div style="padding:0 0 8px">${[["Subscriptions", "Spotify Family", "Tue 13 Oct", 17.99], ["Utilities", "Stadtwerke München", "Wed 14 Oct", 78]].map(([c, t, d, v]) => `<div class="rrow" style="grid-template-columns:18px minmax(0,1fr) auto auto" data-go="recurring">${glyph(c)}<span class="tt">${t}</span><span class="faint">${d}</span>${money(v)}</div>`).join("")}</div>` })}
        </div>
      </div>`;
  },
  mount(root) { hoverCats($("#wk", root).closest(".cbody"), el => `${el.dataset.cat} <b>${$(`.dl .a[data-cat="${el.dataset.cat}"]`, root).textContent}</b>`); },
});

page("reports", {
  title: "Reports",
  toggles: [{ k: "rst", label: "State", opts: [["rst-ready", "Ready"], ["rst-done", "Generated"]] }],
  render() {
    const box = n => `<span class="cbx${n ? " on" : ""}">${n ? I("check") : ""}</span>`;
    return bar("Reports", `<span class="btn btn-primary">${I("file-download")}Generate PDF</span>`) +
      `<div class="content"><div class="card form-card cols">
        ${opt("rst") === "rst-done" ? `<div class="file" style="margin-bottom:8px">${I("file-type-pdf", ' style="color:var(--ink-3)"')}expense_report_2026-10.pdf<span class="sp"></span><span class="sz">Generated 14:32</span><span class="btn btn-ghost">${I("download")}Download</span></div>` : ""}
        <div class="fc-a props wide">
          <span class="pl">Date range</span><span class="pv ed">${I("calendar", ' style="color:var(--ink-3)"')}1 Oct 2026 – 31 Oct 2026</span>
          <span class="pl">Type</span><span class="pv">${seg(["All", "Income", "Expense"])}</span>
          <span class="pl">Sort</span><span class="pv ed">Newest first</span>
          <span class="pl">Running balance</span><span class="pv">${sw(false)}</span>
          <span class="pl">Category subtotals</span><span class="pv">${sw(true)}</span>
          <span class="pl">Cents in tables</span><span class="pv">${sw(true)}</span>
        </div>
        <div class="fc-b"><div class="pk-sec">Sections</div>
        <div class="checks">${[["Summary", 1], ["Category breakdown", 1], ["Top categories", 0], ["Trend", 0], ["Transactions", 1], ["Upcoming recurring", 0]].map(([l, n]) => `<span class="chk">${box(n)}${l}</span>`).join("")}</div></div>
        <div class="fc-c"><div class="pk-sec">Scope</div>
        <div class="props wide">
          <span class="pl">Categories</span><span class="pv">${seg(["All", "Selected"])}</span>
          <span class="pl">Tags</span><span class="pv">${seg(["All", "Only include", "Exclude"])}</span>
        </div></div>
        <div class="fc-d"><div class="pk-sec">Notes</div>
        <div class="notes ed ph" style="min-height:64px">Prepared for the 2026 tax return</div></div>
      </div></div>`;
  },
});

page("assistant", {
  title: "Assistant",
  toggles: [{ k: "as", label: "Thread", opts: [["as-chat", "Conversation"], ["as-run", "Answering"], ["as-empty", "Empty"]] }],
  render() {
    const user = q => `<div class="msg-u"><div class="bubble">${q}</div></div>`;
    const tools = `<div class="tools" data-menu-free><span class="tool-sum">${I("list-search")}Reviewed 3 ledger views${I("chevron-right")}</span>
      <div class="tool-list"><div>${I("circle-check", ' style="color:var(--income)"')}Spending overview <span class="faint">1 Sep – 30 Sep</span></div><div>${I("circle-check", ' style="color:var(--income)"')}Spending overview <span class="faint">1 Oct – 22 Oct</span></div><div>${I("circle-check", ' style="color:var(--income)"')}Spending breakdown <span class="faint">by category</span></div></div></div>`;
    const answer = `<div class="msg-a">${tools}<div class="md"><p>You spent <b>2.567,93 €</b> so far in October, <b>299 € less</b> than the same point in September.</p>
      <table><thead><tr><th>Category</th><th>Sep</th><th>Oct</th><th>Change</th></tr></thead><tbody><tr><td>Travel</td><td>420 €</td><td>130 €</td><td>− 290 €</td></tr><tr><td>Restaurants</td><td>301 €</td><td>238 €</td><td>− 63 €</td></tr><tr><td>Shopping</td><td>190 €</td><td>257 €</td><td>+ 67 €</td></tr></tbody></table>
      <p>Most of the drop is travel: September had the Berlin trip.</p></div><div class="msg-actions">${ib("copy", "Copy response")}</div></div>`;
    const thread = opt("as") === "as-empty"
      ? `<div class="as-empty"><div style="font-weight:600;font-size:15px">Ask about your spending</div><div class="prompts">${["How much did I spend last month?", "What were my top categories this month?", "Compare this month with last month", "Find my largest expenses this month"].map(p => `<span class="pill">${p}</span>`).join("")}</div></div>`
      : user("Compare this month's spending to last month") + (opt("as") === "as-run" ? `<div class="msg-a"><div class="progress"><span class="pulse"></span>Comparing periods…</div></div>` : answer);
    const running = opt("as") === "as-run";
    return bar("Assistant", `<a class="btn btn-ghost hide-m">ChatGPT plan${I("arrow-up-right")}</a>` + ib("edit", "New chat")) +
      `<div class="as-wrap"><div class="thread">${thread}</div><div class="composer"><div class="cmp">${opt("as") === "as-empty" ? "" : ""}<span class="ph">Ask about your spending</span><span class="sp"></span><span class="send${running ? " stop" : ""}" aria-label="${running ? "Stop" : "Send"}" title="${running ? "Stop" : "Send"}">${I(running ? "player-stop-filled" : "arrow-up")}</span></div></div></div>`;
  },
  mount(root) { $$(".tool-sum", root).forEach(el => el.addEventListener("click", () => el.parentElement.classList.toggle("open"))); },
});
