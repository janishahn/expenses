// Dashboard, Transactions, transaction full view, Uncategorized, Trash.
const periodCtl = (label = "October 2026", opts = ["This month", "Last month", "All time"]) =>
  `<span class="pill" data-menu>${I("chevron-left")}<span>${label}</span>${I("chevron-right")}${menu([...opts.map((o, i) => mi(o, "", i === 0 ? "" : "")), SEP, mi("Custom range…", "calendar")], "left").replace('class="menu', 'style="left:0;top:30px" class="menu')}</span>`;
const filterPill = (label = "Filter", icon = "filter") => `<span class="pill" data-menu>${I(icon)}${label}${menu([`<div class="mhead">Tags</div>`, `<div style="padding:2px 4px 6px">${seg(["Only include", "Exclude"])}</div>`, ...TAGS.slice(0, 6).map(t => mi(`<span class="cbx"></span>${t}`))]).replace('class="menu', 'style="right:0;top:30px" class="menu')}</span>`;
const PV = v => `<span class="pv-mask">${v}</span>`;

page("dashboard", {
  title: "Dashboard",
  toggles: [{ k: "priv", label: "Amounts", opts: [["priv-off", "Shown"], ["priv-on", "Hidden"]] }],
  render() {
    const cats = Object.keys(SPEND), totals = MONTHS6.map((_, i) => cats.reduce((s, c) => s + SPEND[c][i], 0)), max = Math.max(...totals);
    const oct = cats.map(c => [c, SPEND[c][5], C(c)]), octTot = oct.reduce((s, r) => s + r[1], 0);
    const hidden = opt("priv") === "priv-on";
    const balance = lineChart({
      labels: BAL.labels, h: 180, mark: 5, idle: 5,
      series: [{ v: BAL.actual }, { v: BAL.likely, color: "var(--ink-3)", dash: "4 4" }],
      band: { lo: BAL.p10, hi: BAL.p90 },
      tip: i => hidden ? `${BAL.labels[i]}` : BAL.actual[i] != null && i !== 5 ? `${BAL.labels[i]} <b>${fmt(BAL.actual[i])}</b>`
        : i === 5 ? `Today <b>${fmt(BAL.actual[i])}</b>` : `${BAL.labels[i]} · likely <b>${fmt0(BAL.likely[i])}</b> · 80% range ${fmt0(BAL.p10[i])} – ${fmt0(BAL.p90[i])}`,
    });
    return bar("Dashboard", ib(hidden ? "eye" : "eye-off", hidden ? "Show amounts" : "Hide amounts", `data-priv`)) +
      `<div class="viewrow">${periodCtl()}<span class="sp"></span>${filterPill()}</div>
      <div class="content">
        ${strip([["Balance", PV("28.008,00 €"), "as of today"], ["Cash in", PV("4.346,20 €"), "−930 vs Sep"], ["Spent", PV("2.567,93 €"), "−299 vs Sep"], ["Net", PV("+ 1.778,27 €"), "−631 vs Sep", "in"], ["Budget pace", "0,61×", PV("1.531 of 2.500 € projected")]], "c5")}
        <div class="grid2">
          ${card("Balance", { meta: hidden ? "" : "likely 31.690 € in Apr", menuItems: [mi("Show forecast range", "chart-area", ""), SEP, mi("Show as table", "table"), mi("Open in Forecast", "trending-up", 'data-go="forecast"'), SEP, mi("Hide from dashboard", "eye-off")].map((m, i) => i === 0 ? m.replace("</div>", I("check") + "</div>") : m),
            body: balance + `<div class="legend"><span><i class="line" style="background:var(--ink)"></i>Actual</span><span><i class="line" style="background:repeating-linear-gradient(90deg,var(--ink-3) 0 4px,transparent 4px 7px)"></i>Likely</span>${legendBand("80% range")}</div>` })}
          ${card("Recent", { controls: ib("arrow-right", "Open transactions", 'data-go="transactions"'), bodyCls: "", body: `<div style="padding-bottom:6px">${T.slice(0, 7).map(t => `<div class="rrow" data-go="transactions"><span class="cat" style="color:${C(t.cat)}">${I(t.icon)}</span><span class="tt">${t.title}</span>${PV(money(t.amt, t.income))}</div>`).join("")}</div>` })}
        </div>
        ${card("Spending by category", { controls: seg(["6M", "12M"]), menuItems: chartMenu(),
          body: `<div class="bands" id="bands">${[5, 4, 3, 2, 1, 0].map(i => `<span class="m">${MONTHS6[i]}</span><div class="track">${cats.filter(c => SPEND[c][i] > 0).map(c => `<span data-cat="${c}" data-i="${i}" style="width:${(SPEND[c][i] / max) * 100}%;background:${C(c)}"></span>`).join("")}</div><span class="tot">${PV(fmt(totals[i]))}</span>`).join("")}</div>
            ${legend(cats.map(c => [c, C(c), "sq", c]))}` })}
        <div class="grid2b">
          ${card("Category share", { controls: seg(["Expenses", "Income"]), menuItems: chartMenu(), body: donut(oct, octTot, PV(fmt0(octTot)), "October") })}
          ${card("Budgets", { controls: ib("arrow-right", "Open budgets", 'data-go="budgets"'), body: `<div class="bud">${BUDGETS.map(b => `${glyph(b.cat)}<span>${b.cat}</span>${pbar(b.spent / b.limit, { over: b.spent > b.limit, pace: PACE }).replace('class="bt"', `class="bt" data-b="${b.cat}"`)}<span class="bv">${b.spent > b.limit ? `<span class="o">${PV(fmt0(b.spent - b.limit))} over</span>` : `<b>${PV(fmt0(b.limit - b.spent))}</b> left`}</span>`).join("")}</div>` })}
        </div>
        ${card("Durable purchases", { menuItems: [mi("Show fully amortized (3)", "circle-check")], bodyCls: "", body: `<div style="padding:0 0 8px">${[
          ["Home", "IKEA Kallax shelf and 4 boxes", 214.96, 0.29, 0.04, "22 of 730 days"],
          ["Shopping", "MacBook Air 13\"", 1499, 1.37, 0.42, "460 of 1.095 days"],
          ["Travel", "Osprey travel backpack", 189, 0.1, 0.61, "1.120 of 1.825 days"],
        ].map(([c, t, a, d, p, days]) => `<div class="lrow" style="grid-template-columns:18px minmax(0,1fr) 120px minmax(80px,160px) 110px"><span class="cat" style="color:${C(c)}">${I(CAT[c][1])}</span><span class="cell">${t}</span><span class="cell r tab muted">${PV(fmt(d))}/day</span>${pbar(p)}<span class="cell r tab muted">${days}</span></div>`).join("")}</div>` })}
      </div>`;
  },
  mount(root) {
    $("[data-priv]", root).addEventListener("click", () => setOpt("priv", opt("priv") === "priv-on" ? "priv-off" : "priv-on"));
    const host = $("#bands", root).closest(".cbody");
    hoverCats(host, el => el.dataset.i ? `${MONTHS6[el.dataset.i]} · ${el.dataset.cat} <b>${fmt(SPEND[el.dataset.cat][el.dataset.i])}</b>` : `${el.dataset.cat} · 6 months <b>${fmt(SPEND[el.dataset.cat].reduce((a, b) => a + b, 0))}</b>`);
    hoverCats($(".donut-wrap", root).closest(".cbody"), el => `${el.dataset.cat} <b>${fmt(SPEND[el.dataset.cat][5])}</b> · ${signed0(SPEND[el.dataset.cat][5] - SPEND[el.dataset.cat][4])} vs Sep`);
    hoverTips($(".bud", root), "[data-b]", el => { const b = BUDGETS.find(x => x.cat === el.dataset.b); return `${b.cat} <b>${fmt(b.spent)}</b> of ${fmt0(b.limit)} · pace ${fmt0(b.limit * PACE)}`; });
  },
});

const addDialog = () => [`<div class="dg-top">${seg(["Expense", "Income"])}<span class="sp"></span>${ib("x", "Close", "data-close-dlg")}</div>
  <div class="tpl-row">${[["Groceries", "Edeka"], ["Restaurants", "Lunch"], ["Transport", "MVV ticket"], ["Subscriptions", "Spotify"], ["Groceries", "Bakery"]].map(([c, n]) => `<span class="pill">${glyph(c)}${n}</span>`).join("")}<span class="btn btn-ghost" data-go="templates">Manage</span></div>
  <div class="dg-amt"><span class="caret-i"></span><span class="ph">0,00 €</span></div>
  <div class="dg-title ph">Title</div>
  <div class="dg-chips">${pill("calendar", "Today, 14:32")}${pill("category", "Category")}${pill("tag", "Tags")}${pill("map-pin", "Location")}${pill("paperclip", "Receipt")}</div>
  <div class="dg-notes ph">Notes</div>
  <div class="dg-foot">${sw(false)}<span class="muted">Add another</span><span class="sp"></span><span class="btn btn-ghost" data-close-dlg>Cancel</span><span class="btn btn-primary">Add transaction</span></div>`, ""];

// Receipt art: stand-ins for uploaded files. Images keep their own colors in dark mode.
const svgImg = (w, h, body, alt) => `<img alt="${alt}" width="${w}" height="${h}" src="data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}">${body}</svg>`)}">`;
function slip(lines, w) {
  let y = 36, out = "";
  const L = 22, R = w - 22;
  for (const [k, a, b, bold] of lines) {
    if (k === "gap") { y += 9; continue; }
    if (k === "rule") { out += `<line x1="${L}" x2="${R}" y1="${y - 5}" y2="${y - 5}" stroke="#2a2a28" stroke-dasharray="3 3" stroke-width=".8"/>`; y += 11; continue; }
    if (k === "qr") {
      let cells = "", s = 7;
      for (let r = 0; r < 21; r++) for (let c = 0; c < 21; c++) {
        const fr = r < 7 ? r : r > 13 ? r - 14 : -1, fc = c < 7 ? c : c > 13 ? c - 14 : -1;
        const on = fr >= 0 && fc >= 0 && !(r > 13 && c > 13)
          ? fr % 6 === 0 || fc % 6 === 0 || (fr > 1 && fr < 5 && fc > 1 && fc < 5)
          : (s = (s * 73 + 11) % 101) % 3 === 0;
        if (on) cells += `<rect x="${w / 2 - 31.5 + c * 3}" y="${y + r * 3}" width="3" height="3"/>`;
      }
      out += `<g fill="#2a2a28">${cells}</g>`; y += 78; continue;
    }
    const fs = k === "h" ? 16 : 10.5, fw = bold || k === "h" ? ' font-weight="700"' : "";
    if (k === "c" || k === "h") out += `<text x="${w / 2}" y="${y}" font-size="${fs}" text-anchor="middle"${fw}>${a}</text>`;
    else out += `<text x="${L}" y="${y}" font-size="${fs}"${fw}>${a}</text>${b ? `<text x="${R}" y="${y}" font-size="${fs}" text-anchor="end"${fw}>${b}</text>` : ""}`;
    y += k === "h" ? 22 : 16;
  }
  return { body: `<g font-family="Menlo, Consolas, monospace" fill="#2a2a28">${out}</g>`, h: y + 18 };
}
const RECEIPT = slip([["h", "RAMEN KAZU"], ["c", "Leopoldstraße 52 · 80802 München"], ["c", "Tel. 089 3398 1720"], ["gap"],
  ["lr", "Tisch 7", "22.10.2026 20:15"], ["lr", "Bon 4182", "Bed. Yuki"], ["rule"],
  ["lr", "1 Tonkotsu Ramen", "16,50"], ["lr", "1 Shoyu Ramen", "15,90"], ["lr", "1 Miso Ramen", "15,90"], ["lr", "2 Gyoza", "13,00"], ["lr", "3 Asahi 0,33 l", "16,50"], ["lr", "1 Edamame", "6,50"], ["rule"],
  ["lr", "Zwischensumme", "84,30"], ["lr", "Trinkgeld", "11,70"], ["lr", "SUMME EUR", "96,00", true], ["rule"],
  ["lr", "Kartenzahlung VISA", "96,00"], ["l", "**** **** **** 4417"], ["gap"], ["lr", "MwSt 19 %", "13,46"], ["lr", "Netto", "70,84"], ["gap"],
  ["l", "TSE-Transaktion 18342"], ["l", "Start 2026-10-22T20:14:51"], ["l", "Ende  2026-10-22T20:15:09"], ["l", "Seriennr. 4f1c…9a02"], ["gap"], ["qr"],
  ["c", "Vielen Dank für Ihren Besuch!"]], 280);
const CARDSLIP = slip([["c", "Ramen Kazu"], ["c", "Leopoldstraße 52"], ["c", "80802 München"], ["gap"],
  ["lr", "Datum", "22.10.2026"], ["lr", "Uhrzeit", "20:17:03"], ["lr", "Terminal-ID", "69412207"], ["lr", "TA-Nr.", "004182"], ["gap"],
  ["h", "Kartenzahlung"], ["c", "kontaktlos"], ["lr", "VISA", "**** 4417"], ["rule"], ["lr", "BETRAG EUR", "96,00", true], ["rule"],
  ["c", "Zahlung erfolgt"], ["gap"], ["c", "Kundenbeleg"]], 260);
const pdfRow = (y, cells, bold = "") => cells.map(([x, t, a]) => `<text x="${x}" y="${y}"${a ? ' text-anchor="end"' : ""}${bold}>${t}</text>`).join("");
const RFILES = {
  scan: { name: "ramen-kazu-receipt.jpg", size: "412 KB", w: 280, h: RECEIPT.h,
    img: svgImg(280, RECEIPT.h, `<rect width="280" height="${RECEIPT.h}" fill="#fbfaf6"/>${RECEIPT.body}`, "Receipt from Ramen Kazu") },
  photo: { name: "IMG_4182.jpg", size: "2.1 MB", w: 640, h: 480,
    img: svgImg(640, 480, `<defs><linearGradient id="wd" x2="1" y2="1"><stop offset="0" stop-color="#9c8469"/><stop offset="1" stop-color="#6c5844"/></linearGradient><radialGradient id="vg"><stop offset=".55" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity=".28"/></radialGradient><filter id="bl"><feGaussianBlur stdDeviation="7"/></filter></defs>
      <rect width="640" height="480" fill="url(#wd)"/>${[40, 105, 190, 260, 330, 410].map(y => `<path d="M0 ${y} C200 ${y + 14} 420 ${y - 12} 640 ${y + 6}" stroke="#3b2c1e" stroke-opacity=".12" stroke-width="2" fill="none"/>`).join("")}
      <circle cx="575" cy="70" r="74" fill="#d8d2c6"/><circle cx="575" cy="70" r="58" fill="none" stroke="#bdb5a6" stroke-width="2"/>
      <g transform="translate(318 244) rotate(-6) scale(.76) translate(-140 ${-RECEIPT.h / 2})"><rect x="8" y="12" width="280" height="${RECEIPT.h}" fill="#000" opacity=".4" filter="url(#bl)"/><rect width="280" height="${RECEIPT.h}" fill="#f4f2ec"/>${RECEIPT.body}</g>
      <rect width="640" height="480" fill="url(#vg)"/>`, "Photo of the Ramen Kazu receipt on a table") },
  pdf: { name: "rechnung-2026-10-0412.pdf", size: "86 KB", w: 420, h: 594, pdf: true,
    img: svgImg(420, 594, `<rect width="420" height="594" fill="#fff"/><g font-family="Helvetica, Arial, sans-serif" fill="#222" font-size="8.5">
      <text x="36" y="58" font-size="16" font-weight="700">Ramen Kazu GmbH</text><text x="36" y="74" fill="#777" font-size="7.5">Leopoldstraße 52 · 80802 München · USt-IdNr. DE318274650</text>
      ${pdfRow(128, [[36, "Rechnungsnr."], [130, "2026-10-0412"]])}${pdfRow(142, [[36, "Datum"], [130, "22.10.2026"]])}${pdfRow(156, [[36, "Tisch"], [130, "7"]])}
      <text x="36" y="206" font-size="18" font-weight="700">Rechnung</text><line x1="36" x2="384" y1="226" y2="226" stroke="#222"/>
      ${pdfRow(242, [[36, "Menge"], [80, "Bezeichnung"], [384, "Betrag", 1]], ' font-weight="700"')}
      ${[["1", "Tonkotsu Ramen", "16,50"], ["1", "Shoyu Ramen", "15,90"], ["1", "Miso Ramen", "15,90"], ["2", "Gyoza", "13,00"], ["3", "Asahi 0,33 l", "16,50"], ["1", "Edamame", "6,50"]].map(([q, t, a], i) => pdfRow(264 + i * 18, [[36, q], [80, t], [384, a, 1]])).join("")}
      <line x1="36" x2="384" y1="378" y2="378" stroke="#ccc"/>${pdfRow(396, [[250, "Zwischensumme"], [384, "84,30", 1]])}${pdfRow(412, [[250, "Trinkgeld"], [384, "11,70", 1]])}${pdfRow(432, [[250, "Gesamt EUR"], [384, "96,00", 1]], ' font-weight="700" font-size="10"')}${pdfRow(450, [[250, "enthält MwSt 19 %"], [384, "13,46", 1]], ' fill="#777"')}
      <text x="36" y="520" fill="#777" font-size="7.5">Bezahlt mit VISA **** 4417 am 22.10.2026. Vielen Dank für Ihren Besuch.</text><text x="36" y="560" fill="#999" font-size="7">Amtsgericht München HRB 245 117 · Geschäftsführung: K. Watanabe</text></g>`, "Invoice from Ramen Kazu, page 1") },
  slip: { name: "kartenbeleg.jpg", size: "188 KB", w: 260, h: CARDSLIP.h,
    img: svgImg(260, CARDSLIP.h, `<rect width="260" height="${CARDSLIP.h}" fill="#f7f6f1"/>${CARDSLIP.body}`, "Card payment slip from Ramen Kazu") },
};
const RSETS = { "rc-portrait": [RFILES.scan], "rc-wide": [RFILES.photo], "rc-pdf": [RFILES.pdf], "rc-two": [RFILES.scan, RFILES.slip], "rc-none": [] };
const mapArt = () => `<div class="map"><svg viewBox="0 0 640 320" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
  <path d="M440 -10 H660 V330 H470 Q445 230 458 150 Q470 60 440 -10Z" style="fill:color-mix(in srgb, var(--c-groceries) 16%, var(--day))"/><ellipse cx="560" cy="200" rx="36" ry="18" style="fill:color-mix(in srgb, var(--c-travel) 24%, var(--day))"/>
  <g fill="none" stroke="var(--sheet)" stroke-linecap="round"><path d="M320 -10V330" stroke-width="12"/><path d="M-10 70H430M-10 168H452M-10 262H462" stroke-width="7"/><path d="M150 -10V330M230 -10V330M390 -10V330" stroke-width="5"/><path d="M-10 300L260 110" stroke-width="7"/></g>
  <g font-size="10" fill="var(--ink-3)"><text transform="translate(336 240) rotate(-90)">Leopoldstraße</text><text x="500" y="110">Englischer Garten</text></g>
  <g transform="translate(320 160)"><ellipse cy="1" rx="7" ry="2.5" fill="rgb(0 0 0 / 0.2)"/><path d="M0 0C-3-8-11-13-11-22A11 11 0 1 1 11-22C11-13 3-8 0 0Z" fill="var(--ink)"/><circle cy="-22" r="4" fill="var(--sheet)"/></g>
</svg><span class="map-attr">© OpenStreetMap</span></div>`;
const FILE_MENU = () => more([mi("Download", "download"), mi("Replace", "replace"), SEP, mi("Remove", "trash", "danger")]);
const fileThumb = f => f.pdf ? I("file-type-pdf") : f.img;
// Receipts section: a capped preview of the first file; an empty section is one drop row.
const receipts = files => {
  const mob = state.w === "w-mobile";
  if (!files.length) return `<div class="pk-sec">Receipts</div><div class="drop sm">${I(mob ? "camera" : "upload")}${mob ? "Add a receipt" : `<span>Drop a receipt or <span class="link">choose a file</span></span>`}</div>`;
  const head = `<div class="pk-sec">Receipts<span class="sp"></span>${files.length > 1 ? `<span class="muted tab">1 of ${files.length}</span>` : ""}${ib("upload", "Add receipt")}</div>`;
  return head + `<div class="rprev" data-dialog="receipt" style="--ar:${files[0].w}/${files[0].h}">${files[0].img}</div>
    <div class="rcap"><span class="nm">${files[0].name}</span><span class="sz">${files[0].size}</span>${FILE_MENU()}</div>
    ${files.length > 1 ? `<div class="rstrip">${files.map((f, i) => `<span class="rf-th${i ? "" : " on"}" title="${f.name}">${fileThumb(f)}</span>`).join("")}</div>` : ""}`;
};
const location_ = () => `<div class="pk-sec">Location</div>${mapArt()}`;
const rviewer = files => [`<div class="vw-bar">${I(files[0].pdf ? "file-type-pdf" : "photo", ' style="color:var(--ink-3)"')}<span class="nm">${files[0].name}</span><span class="sz">${files[0].size}</span><span class="sp"></span>${files.length > 1 ? `<span class="muted tab">1 of ${files.length}</span>${ib("chevron-left", "Previous file")}${ib("chevron-right", "Next file")}<span class="vw-div"></span>` : ""}${ib("zoom-out", "Zoom out")}<span class="btn btn-ghost tab">Fit</span>${ib("zoom-in", "Zoom in")}${ib("download", "Download")}${ib("x", "Close", "data-close-dlg")}</div><div class="vw-stage">${files[0].img}</div>`, "viewer"];

// Bank provenance: shown only on transactions matched to, or created from, a statement row.
const bankRow = d => `<span class="pl">Bank</span><span class="pv"><span class="link-tx" data-go="reconcile">${I("building-bank", ' style="color:var(--ink-3)"')}Girokonto · booked ${d}</span></span>`;
const txPeek = () => `<aside class="peek">${peekBar("Transactions", "Ramen Kazu", { full: "txfull", actions: more([mi("Duplicate", "copy"), mi("Copy link", "link"), SEP, mi("Delete", "trash", "danger")]) })}
  <div class="pk-body">
    <div class="pk-title ed">Ramen Kazu — dinner with Lena and Tom</div>
    <div class="pk-amt ed">96,00 €</div>
    <div class="props">
      <span class="pl">Type</span><span class="pv ed">Expense</span>
      <span class="pl">Date</span><span class="pv ed">Thu 22 Oct 2026, 20:15</span>
      <span class="pl">Category</span><span class="pv ed" data-menu>${glyph("Restaurants")}Restaurants
        <div class="menu float combo"><div class="q">${I("search", ' style="color:var(--ink-3)"')}Re<span class="caret"></span></div>${mi(glyph("Restaurants") + "Restaurants" + I("check"))}${mi(glyph("Reimbursement") + "Reimbursement")}${mi(glyph("Housing") + "Rent and housing")}</div></span>
      <span class="pl">Tags</span><span class="pv">${tag("Personal")}${tag("Shared")}${ib("plus", "Add tag", 'style="width:22px;height:22px;font-size:13px"')}</span>
      <span class="pl">Location</span><span class="pv ed">${I("map-pin", ' style="color:var(--ink-3)"')}48.161200, 11.585600</span>
      <span class="pl">Reimbursed</span><span class="pv"><span class="linkrec">${I("arrow-back-up", ' style="color:var(--income)"')}Lena — her share of ramen<span class="amt in">+ 32,00 €</span></span></span>
      <span class="pl">Net</span><span class="pv tab" style="font-weight:600">64,00 €</span>
      <span class="pl">Durable</span><span class="pv ed faint">Not tracked</span>
      ${bankRow("22 Oct")}
    </div>
    <div class="pk-sec">Notes</div>
    <div class="notes ed">Split three ways. Tom pays back next week.</div>
    ${location_()}
    ${receipts([RFILES.scan])}
  </div></aside>`;

page("transactions", {
  title: "Transactions", peek: true,
  toggles: [{ k: "sel", label: "Selection", opts: [["sel-two", "Two rows"], ["sel-none", "None"]] }, { k: "flt", label: "Filters", opts: [["flt-none", "None"], ["flt-set", "Active"]] }],
  dialogs: { add: addDialog, receipt: () => rviewer([RFILES.scan]) },
  render() {
    const open = opt("pk") === "pk-open", sel = !open && opt("sel") === "sel-two" ? [3, 4] : [];
    const filters = opt("flt") === "flt-set"
      ? `<span class="pill set">${I("category")}Groceries<span class="x">${I("x")}</span></span><span class="pill set">${I("tag")}Only: Essential<span class="x">${I("x")}</span></span><span class="btn btn-ghost hide-m">Clear</span>`
      : `<span class="pill hide-m">${I("arrows-sort")}Type</span><span class="pill hide-m">${I("category")}Category</span><span class="pill hide-m">${I("tag")}Tag</span>`;
    return bar("Transactions", ib("search", "Search") + `<span class="btn btn-primary" data-dialog="add">${I("plus")}<span>Add<span class="hide-m"> transaction</span></span></span>` + more([mi("Trash", "trash", 'data-go="trash"'), mi("Export CSV", "download")])) +
      `<div class="viewrow">${periodCtl()}${filters}<span class="sp"></span><span class="pill show-m">${I("filter")}Filter</span></div>
      <div class="split"><div class="list${sel.length ? " has-sel" : ""}">${ledger(T, { sel, open: open ? 1 : null })}<div class="lfoot">1–50 of 214${ib("chevron-left", "Previous page")}${ib("chevron-right", "Next page")}</div></div>${txPeek()}</div>
      ${sel.length ? `<div class="bulk float"><span class="n" data-menu>2 selected ${I("chevron-down", ' style="font-size:12px;color:var(--ink-3)"')}${menu([mi("Select all 214 matching", "checks"), mi("Clear selection", "x")]).replace('class="menu', 'style="left:0;bottom:36px;transform-origin:bottom left" class="menu')}</span><span class="btn">${I("category")}<span class="hide-m">Category</span></span><span class="btn" data-menu>${I("tag")}<span class="hide-m">Tags</span>${menu([mi("Add tags", "plus"), mi("Remove tags", "minus"), mi("Replace tags", "replace"), mi("Clear tags", "eraser")]).replace('class="menu', 'style="left:0;bottom:36px;transform-origin:bottom left" class="menu')}</span><span class="btn">${I("trash")}<span class="hide-m">Delete</span></span>${ib("x", "Clear selection")}</div>` : ""}`;
  },
});

page("txfull", {
  title: "Transaction (full)", nav: "transactions",
  toggles: [{ k: "kind", label: "Record", opts: [["kind-exp", "Expense"], ["kind-reimb", "Reimbursement income"]] },
    { k: "rc", label: "Receipt", opts: [["rc-none", "None"], ["rc-portrait", "Portrait scan"], ["rc-wide", "Wide photo"], ["rc-pdf", "PDF"], ["rc-two", "Two files"]] },
    { k: "loc", label: "Location", opts: [["loc-set", "Set"], ["loc-none", "None"]] }],
  dialogs: { receipt: () => rviewer(RSETS[opt("rc")]) },
  render() {
    const reimb = opt("kind") === "kind-reimb", files = reimb ? [] : RSETS[opt("rc")];
    const head = reimb
      ? `<div class="pk-title ed" style="font-size:20px">Lena — her share of ramen</div><div class="pk-amt ed in">+ 32,00 €</div>`
      : `<div class="pk-title ed" style="font-size:20px">Ramen Kazu — dinner with Lena and Tom</div><div class="pk-amt ed">96,00 €</div>`;
    const body = reimb
      ? `<div class="pk-sec">Notes</div><div class="notes ed ph">Add notes</div>
        <div class="pk-sec">Allocated to<span class="sp"></span><span class="muted tab">32,00 € of 32,00 €</span></div>
        <div class="card sub"><div class="lrow" style="grid-template-columns:18px minmax(0,1fr) auto 28px">${glyph("Restaurants")}<span class="cell">Ramen Kazu — dinner with Lena and Tom <span class="faint">· 22 Oct</span></span><span class="amt">32,00 €</span>${ib("x", "Remove allocation")}</div></div>
        <div class="pk-sec">Allocate to an expense</div>
        <div class="input">${I("search")}<span class="ph">Ramen</span></div>
        <div class="card sub" style="margin-top:8px">${[["Restaurants", "Ramen Kazu — dinner with Lena and Tom", "22 Oct", "64,00 € left"], ["Restaurants", "Ramen Ichiraku", "3 Sep", "41,50 € left"]].map(([c, t, d, left], i) => `<div class="lrow" style="grid-template-columns:18px minmax(0,1fr) auto auto">${glyph(c)}<span class="cell">${t} <span class="faint">· ${d}</span></span><span class="muted tab">${left}</span>${i === 0 ? `<span style="display:flex;gap:4px;align-items:center"><span class="input" style="width:90px;height:26px"><span class="tab">21,33 €</span></span><span class="btn btn-ghost">½</span><span class="btn btn-ghost">⅓</span><span class="btn btn-quiet">Allocate</span></span>` : `<span></span>`}</div>`).join("")}</div>`
      : `<div class="pk-sec">Notes</div><div class="notes ed">Split three ways. <b>Tom</b> pays back next week.</div>
        <div class="pk-sec">Reimbursements<span class="sp"></span><span class="btn btn-ghost">${I("plus")}Link</span></div>
        <div class="card sub"><div class="lrow" style="grid-template-columns:18px minmax(0,1fr) auto 28px">${glyph("Reimbursement")}<span class="cell">Lena — her share of ramen <span class="faint">· 22 Oct</span></span><span class="amt in">+ 32,00 €</span>${ib("x", "Remove allocation")}</div></div>`;
    const props = reimb
      ? `<span class="pl">Type</span><span class="pv ed">Income</span><span class="pl">Date</span><span class="pv ed">Thu 22 Oct 2026, 21:02</span><span class="pl">Category</span><span class="pv ed">${glyph("Reimbursement")}Reimbursement</span><span class="pl">Tags</span><span class="pv">${tag("Shared")}</span><span class="pl">Reimbursement</span><span class="pv">${sw(true)}</span><span class="pl">Remaining</span><span class="pv tab">0,00 €</span>${bankRow("22 Oct")}`
      : `<span class="pl">Type</span><span class="pv ed">Expense</span><span class="pl">Date</span><span class="pv ed">Thu 22 Oct 2026, 20:15</span><span class="pl">Category</span><span class="pv ed">${glyph("Restaurants")}Restaurants</span><span class="pl">Tags</span><span class="pv">${tag("Personal")}${tag("Shared")}</span><span class="pl">Reimbursed</span><span class="pv tab in">+ 32,00 €</span><span class="pl">Net</span><span class="pv tab" style="font-weight:600">64,00 €</span><span class="pl">Durable</span><span class="pv ed faint">Not tracked</span><span class="pl">Location</span>${opt("loc") === "loc-set" ? `<span class="pv ed">48.161200, 11.585600</span>` : `<span class="pv ed faint">None</span>`}${bankRow("22 Oct")}`;
    const side = (!reimb && opt("loc") === "loc-set" ? location_() : "") + receipts(files);
    return bar(crumb(["Transactions", "transactions"], [reimb ? "Lena — her share of ramen" : "Ramen Kazu"]), more([mi("Copy link", "link"), SEP, mi("Delete", "trash", "danger")])) +
      (state.w === "w-mobile"
        ? `<div class="full"><div class="card full-main">${head}<div class="props">${props}</div>${body}${side}</div></div>`
        : `<div class="full"><div class="card full-main">${head}<div class="props">${props}</div>${body}</div><div class="card full-side">${side}</div></div>`);
  },
});

page("inbox", {
  title: "Uncategorized", nav: "inbox", peek: true,
  toggles: [{ k: "ac", label: "Automatic categorization", opts: [["ac-on", "On"], ["ac-off", "Off"]] }],
  render() {
    const on = opt("ac") === "ac-on", open = opt("pk") === "pk-open";
    const rows = [
      ["Amazon.de Marketplace", "Wed 21 Oct", 34.99, "Shopping", 72],
      ["PAYPAL *STEAM GAMES", "Tue 20 Oct", 19.99, "Subscriptions", 41],
      ["Kiosk am Hauptbahnhof", "Tue 20 Oct", 6.4, null],
      ["Aral Tankstelle", "Mon 19 Oct", 72.18, "Transport", 77],
      ["dm-drogerie markt", "Sat 17 Oct", 23.55, "Drugstore", 64],
      ["Überweisung M. Weber", "Fri 16 Oct", 50, null, null, true],
    ];
    const grid = on ? "inbgrid" : "inbgrid-off";
    const pick = `<span class="pill">${I("category")}Category</span>`;
    const row = ([t, d, a, s, c, inc], i) => {
      const sugg = on && s;
      return `<div class="lrow ${grid}${open && i === 0 ? " sel" : ""}" data-open-peek><span class="cbx hide-m"></span>${sugg ? glyph(s) : `<span class="cat faint">${I("help-circle")}</span>`}<span class="cell strong">${t}</span><span class="cell muted hide-m">${d}</span>` +
        (sugg ? `<span class="hide-m"><span class="pill" aria-label="Suggested category ${s}, change">${glyph(s)}${s}</span></span><span class="conf" aria-label="${c} % confidence">${c} %</span><span class="acts hide-m">${ib("check", "Accept")}${ib("x", "Reject")}</span>`
          : `<span class="hide-m">${pick}</span>${on ? `<span class="conf"></span><span class="hide-m"></span>` : ""}`) + money(a, inc) + `</div>`;
    };
    const head = `<div class="lhead ${grid}"><span class="hide-m"></span><span></span><span>Title</span><span class="hide-m">Date</span><span class="hide-m">${on ? "Suggestion" : "Category"}</span>${on ? `<span class="r">Confidence</span><span class="hide-m"></span>` : ""}<span class="r">Amount</span></div>`;
    const sugg = on ? `<div class="sugg-box"><div class="muted" style="font-size:12.5px">Suggestion</div><div style="display:flex;align-items:center;gap:6px;margin:6px 0 2px">${glyph("Shopping")}<b>Shopping</b><span class="sp"></span><span class="tab">72 % confidence</span></div>
          <div style="display:flex;gap:6px;margin-top:12px"><span class="btn btn-primary">${I("check")}Accept</span><span class="btn btn-quiet">Reject</span></div></div>` : "";
    return bar(crumb(["Transactions", "transactions"], ["Uncategorized"])) +
      `<div class="viewrow">${periodCtl("All time")}<span class="input hide-m" style="width:260px;height:26px">${I("search")}<span class="ph">Search</span></span></div>
      <div class="split"><div class="list">${head}${rows.map(row).join("")}<div class="lfoot">1–6 of 12${ib("chevron-left", "Previous page")}${ib("chevron-right", "Next page")}</div></div>
      <aside class="peek">${peekBar("Uncategorized", "Amazon.de Marketplace", { full: "txfull" })}<div class="pk-body"><div class="pk-title">Amazon.de Marketplace</div><div class="pk-amt">34,99 €</div>
        ${sugg}
        <div class="props" style="margin-top:14px"><span class="pl">Date</span><span class="pv">Wed 21 Oct 2026, 09:12</span><span class="pl">Category</span><span class="pv ed faint">Uncategorized</span><span class="pl">Tags</span><span class="pv faint">None</span></div></div></aside></div>`;
  },
});

page("trash", {
  title: "Trash", nav: "transactions",
  render() {
    const rows = [["Groceries", "Edeka Schwabing", "Groceries", "Deleted 21 Oct", 12.4], ["Restaurants", "Duplicate — Ramen Kazu", "Restaurants", "Deleted 22 Oct", 96], ["Transport", "MVV single ticket", "Transport", "Deleted 3 Oct", 3.7]];
    return bar(crumb(["Transactions", "transactions"], ["Trash"])) +
      `<div class="content"><div class="list" style="flex:none">${rows.map(([c, t, cn, d, a], i) => `<div class="lrow${i < 2 ? " sel" : ""}" style="grid-template-columns:14px 18px minmax(0,1fr) 120px 110px 90px"><span class="cbx${i < 2 ? " on" : ""}">${i < 2 ? I("check") : ""}</span>${glyph(c)}<span class="cell" style="font-weight:500">${t}</span><span class="cell muted hide-m">${cn}</span><span class="cell muted">${d}</span>${money(a)}</div>`).join("")}</div></div>
      <div class="bulk float"><span class="n">2 selected</span><span class="btn">${I("restore")}Restore</span><span class="btn btn-danger" data-dialog="purge">${I("trash-x")}Delete forever</span>${ib("x", "Clear selection")}</div>`;
  },
  dialogs: { purge: () => [`<div class="dg-top"><span class="t">Delete 2 transactions forever?</span></div><div class="warn">This cannot be undone.</div><div class="dg-foot"><span class="sp"></span><span class="btn btn-ghost" data-close-dlg>Cancel</span><span class="btn btn-danger-fill">Delete forever</span></div>`, "narrow"] },
});
