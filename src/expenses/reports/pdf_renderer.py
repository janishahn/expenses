from datetime import date, datetime
from html import escape
from typing import cast

from expenses.db.models import TransactionType
from expenses.schemas import ReportOptions


def _format_currency(cents: int, include_cents: bool) -> str:
    if include_cents:
        return f"{cents / 100:,.2f}".replace(",", " ").replace(".", ",")
    return f"{cents / 100:,.0f}".replace(",", " ")


def _format_eurodate(value: date | datetime) -> str:
    return value.strftime("%d.%m.%Y")


def _format_eurodatetime(value: datetime) -> str:
    return value.strftime("%d.%m.%Y %H:%M")


def render_report_html(data: dict[str, object]) -> str:
    options = cast(ReportOptions, data["options"])
    period = data["period"]
    generated_at = data.get("generated_at")
    app_version = str(data.get("app_version") or "unknown")
    include_cents = options.include_cents

    title_period = f"{_format_eurodate(period.start)} - {_format_eurodate(period.end)}"
    filtered_suffix = (
        " · Filtered" if options.transaction_type or options.category_ids else ""
    )
    bar_palette = [
        "#2563eb",
        "#0ea5e9",
        "#14b8a6",
        "#22c55e",
        "#a855f7",
        "#f97316",
        "#ef4444",
        "#6366f1",
    ]

    parts = [
        "<!DOCTYPE html><html><head><meta charset='utf-8'>"
        "<meta name='viewport' content='width=device-width, initial-scale=1'>"
        "<style>"
        "@page{size:A4;margin:14mm 12mm 14mm;}"
        "body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif;margin:0;color:#0f172a;background:#f8fafc;}"
        "main.report{background:#ffffff;border:1px solid #e2e8f0;border-radius:14px;padding:20px 20px 22px;box-shadow:0 10px 30px rgba(15,23,42,0.06);}"
        "h1{margin:0;font-size:31px;line-height:1.12;letter-spacing:-0.02em;color:#0f172a;}"
        "h2{margin:0;font-size:20px;line-height:1.2;letter-spacing:-0.01em;color:#0f172a;}"
        "p,td,th,li{font-size:12px;line-height:1.45;}"
        ".report-header{display:flex;justify-content:space-between;align-items:flex-start;gap:14px;padding:0 0 16px;border-bottom:1px solid #e2e8f0;}"
        ".eyebrow{display:inline-block;padding:2px 8px;border-radius:999px;background:#e2e8f0;color:#334155;font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:0.12em;margin-bottom:7px;}"
        ".period{margin:8px 0 0;color:#334155;font-size:13px;font-weight:600;}"
        ".meta-stack{display:flex;flex-direction:column;gap:6px;align-items:flex-end;}"
        ".meta-pill{padding:4px 10px;border-radius:999px;background:#f1f5f9;color:#475569;font-size:10px;font-weight:600;white-space:nowrap;}"
        ".section{margin-top:18px;}"
        ".panel{border:1px solid #e2e8f0;border-radius:12px;padding:14px 14px 12px;background:#ffffff;}"
        ".section-head{display:flex;justify-content:space-between;align-items:baseline;gap:8px;margin-bottom:10px;}"
        ".section-sub{color:#64748b;font-size:11px;}"
        ".notes-copy{margin:0;color:#334155;white-space:pre-wrap;}"
        ".kpi-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px;}"
        ".kpi-card{border:1px solid #dbe3ee;border-radius:10px;padding:11px 11px 10px;background:linear-gradient(180deg,#ffffff 0%,#f8fafc 100%);}"
        ".kpi-label{font-size:10px;color:#64748b;font-weight:700;text-transform:uppercase;letter-spacing:0.08em;margin-bottom:4px;}"
        ".kpi-value{font-size:21px;font-weight:800;letter-spacing:-0.02em;line-height:1.15;}"
        ".positive{color:#166534;}"
        ".negative{color:#b91c1c;}"
        ".table-wrap{border:1px solid #e2e8f0;border-radius:10px;overflow:hidden;}"
        "table{width:100%;border-collapse:collapse;}"
        "thead th{text-align:left;color:#475569;background:#f8fafc;border-bottom:1px solid #e2e8f0;padding:8px 9px;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:0.06em;}"
        "tbody td{border-bottom:1px solid #edf2f7;padding:7px 9px;vertical-align:top;font-size:11.5px;}"
        "tbody tr:nth-child(2n){background:#fbfdff;}"
        "tbody tr:last-child td{border-bottom:none;}"
        ".right{text-align:right;white-space:nowrap;}"
        ".muted{color:#64748b;}"
        ".pill{display:inline-block;padding:3px 8px;border-radius:999px;font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:0.07em;}"
        ".pill-income{background:#dcfce7;color:#166534;border:1px solid #bbf7d0;}"
        ".pill-expense{background:#fee2e2;color:#b91c1c;border:1px solid #fecaca;}"
        ".split{display:grid;grid-template-columns:1.1fr 1fr;gap:12px;align-items:start;}"
        ".bar-list{border:1px solid #e2e8f0;border-radius:10px;padding:10px;background:#fcfdff;}"
        ".bar-row{margin:0 0 9px;}"
        ".bar-row:last-child{margin-bottom:0;}"
        ".bar-top{display:flex;justify-content:space-between;align-items:center;gap:8px;margin-bottom:4px;}"
        ".bar-name{font-weight:600;color:#1e293b;font-size:11.5px;}"
        ".bar-meta{color:#64748b;font-size:10.5px;}"
        ".bar-amount{font-weight:700;color:#0f172a;font-size:11.5px;}"
        ".bar-track{height:9px;background:#e2e8f0;border-radius:999px;overflow:hidden;box-shadow:inset 0 1px 1px rgba(15,23,42,0.08);}"
        ".bar-fill{height:100%;border-radius:999px;}"
        ".mono{font-variant-numeric:tabular-nums;}"
        ".footer{margin-top:14px;padding-top:8px;border-top:1px solid #edf2f7;color:#94a3b8;font-size:9.5px;text-align:right;}"
        "@media print{body{background:#fff}main.report{border:none;border-radius:0;box-shadow:none;padding:0}.section,.panel,.table-wrap,.bar-list{break-inside:avoid}}"
        "</style></head><body><main class='report'>"
    ]

    parts.append("<header class='report-header'>")
    parts.append("<div>")
    parts.append("<div class='eyebrow'>Financial Report</div>")
    parts.append("<h1>Expense Report</h1>")
    parts.append(f"<p class='period mono'>{title_period}{filtered_suffix}</p>")
    parts.append("</div>")
    parts.append("<div class='meta-stack'>")
    if generated_at:
        parts.append(
            f"<div class='meta-pill mono'>Generated {_format_eurodatetime(generated_at)}</div>"
        )
    if app_version != "unknown":
        parts.append(f"<div class='meta-pill'>Version {escape(app_version)}</div>")
    parts.append("</div>")
    parts.append("</header>")

    if options.notes:
        parts.append("<section class='section panel'>")
        parts.append(
            "<div class='section-head'><h2>Notes</h2><span class='section-sub'>Included in report metadata</span></div>"
        )
        parts.append(f"<p class='notes-copy'>{escape(options.notes)}</p>")
        parts.append("</section>")

    summary = data.get("summary")
    if summary:
        net_change = int(summary["net_change"])
        closing_balance = summary.get("closing_balance")
        parts.append("<section class='section panel'>")
        parts.append(
            "<div class='section-head'><h2>Summary</h2><span class='section-sub'>Core period performance</span></div>"
        )
        parts.append("<div class='kpi-grid'>")
        parts.append(
            "<div class='kpi-card'><div class='kpi-label'>Total Income</div>"
            f"<div class='kpi-value positive mono'>{_format_currency(int(summary['total_income']), include_cents)} €</div></div>"
        )
        parts.append(
            "<div class='kpi-card'><div class='kpi-label'>Total Expenses</div>"
            f"<div class='kpi-value negative mono'>{_format_currency(int(summary['total_expenses']), include_cents)} €</div></div>"
        )
        parts.append(
            "<div class='kpi-card'><div class='kpi-label'>Net Change</div>"
            f"<div class='kpi-value {'positive' if net_change >= 0 else 'negative'} mono'>{_format_currency(net_change, include_cents)} €</div></div>"
        )
        if closing_balance is not None:
            closing_cents = int(closing_balance)
            parts.append(
                "<div class='kpi-card'><div class='kpi-label'>Closing Balance</div>"
                f"<div class='kpi-value {'positive' if closing_cents >= 0 else 'negative'} mono'>{_format_currency(closing_cents, include_cents)} €</div></div>"
            )
        parts.append("</div></section>")

    category_breakdown = data.get("category_breakdown")
    if category_breakdown:
        parts.append("<section class='section panel'>")
        parts.append(
            "<div class='section-head'><h2>Category Breakdown</h2><span class='section-sub'>Share by category</span></div>"
        )
        parts.append("<div class='split'>")
        parts.append("<div class='bar-list'>")
        for index, row in enumerate(category_breakdown):
            percent = float(row["percent"])
            color = bar_palette[index % len(bar_palette)]
            parts.append(
                "<div class='bar-row'>"
                "<div class='bar-top'>"
                f"<div class='bar-name'>{escape(str(row['name']))} <span class='bar-meta mono'>({percent:.1f}%)</span></div>"
                f"<div class='bar-amount mono'>{_format_currency(int(row['amount_cents']), include_cents)} €</div>"
                "</div>"
                "<div class='bar-track'><div class='bar-fill' style='width:"
                f"{percent:.1f}%;background:{color};'></div></div>"
                "</div>"
            )
        parts.append("</div>")
        parts.append(
            "<div class='table-wrap'><table><thead><tr><th>Category</th><th class='right'>Amount</th><th class='right'>Share</th></tr></thead><tbody>"
        )
        for row in category_breakdown:
            parts.append(
                "<tr>"
                f"<td>{escape(str(row['name']))}</td>"
                f"<td class='right mono'>{_format_currency(int(row['amount_cents']), include_cents)} €</td>"
                f"<td class='right mono'>{float(row['percent']):.1f}%</td>"
                "</tr>"
            )
        parts.append("</tbody></table></div>")
        parts.append("</div></section>")

    top_categories = data.get("top_categories")
    if top_categories:
        parts.append("<section class='section panel'>")
        parts.append(
            "<div class='section-head'><h2>Top Categories</h2><span class='section-sub'>Highest contributors in period</span></div>"
        )
        parts.append(
            "<div class='table-wrap'><table><thead><tr><th>Category</th><th class='right'>Amount</th><th class='right'>Share</th></tr></thead><tbody>"
        )
        for row in top_categories:
            parts.append(
                "<tr>"
                f"<td>{escape(str(row['name']))}</td>"
                f"<td class='right mono'>{_format_currency(int(row['amount_cents']), include_cents)} €</td>"
                f"<td class='right mono'>{float(row['percent']):.1f}%</td>"
                "</tr>"
            )
        parts.append("</tbody></table></div></section>")

    trend = data.get("trend")
    if trend:
        parts.append("<section class='section panel'>")
        parts.append(
            "<div class='section-head'><h2>Trend</h2><span class='section-sub'>Daily net movement</span></div>"
        )
        parts.append(
            "<div class='table-wrap'><table><thead><tr><th>Date</th><th class='right'>Amount</th></tr></thead><tbody>"
        )
        for row in trend:
            parts.append(
                "<tr>"
                f"<td>{_format_eurodate(row['date'])}</td>"
                f"<td class='right mono'>{_format_currency(int(row['amount_cents']), include_cents)} €</td>"
                "</tr>"
            )
        parts.append("</tbody></table></div></section>")

    recent_transactions = data.get("recent_transactions")
    if recent_transactions:
        parts.append("<section class='section panel'>")
        parts.append(
            "<div class='section-head'><h2>Transactions</h2><span class='section-sub'>Detailed ledger slice</span></div>"
        )
        parts.append("<div class='table-wrap'><table><thead><tr>")
        parts.append(
            "<th>Date</th><th>Type</th><th>Category</th><th>Title</th><th class='right'>Amount</th>"
        )
        if options.show_running_balance:
            parts.append("<th class='right'>Running</th>")
        parts.append("</tr></thead><tbody>")
        if options.show_running_balance and "opening_balance_cents" in data:
            opening = int(data["opening_balance_cents"])
            colspan = 6
            parts.append(
                f"<tr><td colspan='{colspan}'><strong>Opening balance:</strong> <span class='mono'>{_format_currency(opening, include_cents)} €</span></td></tr>"
            )
        for txn in recent_transactions:
            is_income = txn.type == TransactionType.income
            type_label = (
                "reimbursement"
                if is_income and bool(txn.is_reimbursement)
                else txn.type.value
            )
            type_badge = "pill-income" if is_income else "pill-expense"
            amount = int(txn.amount_cents)
            amount_text = f"{'+' if is_income else '-'}{_format_currency(amount, include_cents)} €"
            parts.append("<tr>")
            parts.append(f"<td>{_format_eurodatetime(txn.occurred_at)}</td>")
            parts.append(
                f"<td><span class='pill {type_badge}'>{escape(type_label)}</span></td>"
            )
            parts.append(
                f"<td>{escape(txn.category.name if txn.category else 'Uncategorized')}</td>"
            )
            parts.append(f"<td>{escape(txn.title or '-')}</td>")
            parts.append(
                f"<td class='right {'positive' if is_income else 'negative'} mono'>{amount_text}</td>"
            )
            if options.show_running_balance:
                running_balance = int(txn.running_balance_cents)
                parts.append(
                    f"<td class='right {'positive' if running_balance >= 0 else 'negative'} mono'>{_format_currency(running_balance, include_cents)} €</td>"
                )
            parts.append("</tr>")
        parts.append("</tbody></table></div></section>")

    category_subtotals = data.get("category_subtotals")
    if category_subtotals:
        parts.append("<section class='section panel'>")
        parts.append(
            "<div class='section-head'><h2>Category Subtotals</h2><span class='section-sub'>Aggregated within selected transactions</span></div>"
        )
        parts.append(
            "<div class='table-wrap'><table><thead><tr><th>Category</th><th>Type</th><th class='right'>Amount</th></tr></thead><tbody>"
        )
        for row in category_subtotals:
            row_type = cast(TransactionType, row["type"]).value
            parts.append(
                "<tr>"
                f"<td>{escape(str(row['name']))}</td>"
                f"<td>{escape(row_type)}</td>"
                f"<td class='right mono'>{_format_currency(int(row['amount_cents']), include_cents)} €</td>"
                "</tr>"
            )
        parts.append("</tbody></table></div></section>")

    recurring_upcoming = data.get("recurring_upcoming")
    if recurring_upcoming:
        parts.append("<section class='section panel'>")
        parts.append(
            "<div class='section-head'><h2>Upcoming Recurring</h2><span class='section-sub'>Next 30 days</span></div>"
        )
        parts.append(
            "<div class='table-wrap'><table><thead><tr><th>Name</th><th>Type</th><th class='right'>Amount</th><th>Next occurrence</th><th>Interval</th></tr></thead><tbody>"
        )
        for rule in recurring_upcoming:
            parts.append(
                "<tr>"
                f"<td>{escape(rule.name or 'Untitled')}</td>"
                f"<td>{escape(rule.type.value)}</td>"
                f"<td class='right mono'>{_format_currency(int(rule.amount_cents), include_cents)} €</td>"
                f"<td>{_format_eurodate(rule.next_occurrence)}</td>"
                f"<td>{rule.interval_count} {escape(rule.interval_unit.value)}</td>"
                "</tr>"
            )
        parts.append("</tbody></table></div></section>")

    parts.append("<div class='footer'>Expense Report · Generated by expenses</div>")
    parts.append("</main></body></html>")
    return "".join(parts)
