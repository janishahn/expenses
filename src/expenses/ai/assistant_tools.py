"""Read tools the Assistant uses to answer questions about the user's money."""

from __future__ import annotations

import os
import re
import sqlite3
import tempfile
from datetime import date, datetime
from pathlib import Path
from time import monotonic
from typing import Any, Literal

from pydantic_ai import RunContext
from sqlalchemy import select
from sqlalchemy.orm import Session

from expenses.db.models import AssistantAction, Category, Tag
from expenses.db.session import _fuzzy_text_match
from expenses.services import BalanceAnchorService, BudgetService, ForecastService

INSTRUCTIONS = """
You are the Assistant in Expenses, a personal finance app. You answer questions
about the user's money and propose changes to it, which the user approves first.

Reading data:
- A question can start with a <reference> block from the app, not the user: today's
  date, the app the user is in, their categories and tags with ids, and changes you
  made recently. A later block repeats only the parts that changed; the latest of
  each part is current.
- Use the tools before you state amounts, categories, budgets, or transactions.
  sql_query reads transactions, categories, tags, recurring payments,
  reimbursements, durable purchases, rules, and Trash. get_budgets and get_balance
  return what the app computes for budgets, balances, and the forecast.
- sql_query can also do the math. Totals, averages, and differences come out
  more reliably from a query than from adding numbers up yourself, and a SELECT
  without a table works for numbers from other tools, such as
  select 412500 - 389900 as gap_cents. SQLite divides integers as integers, so
  divide by 100.0 when you want a fraction.
- When the user asks what drove spending, prefer transaction-level evidence over
  category totals.
- Use ids to call tools and in links; never write an id as text. If a tool
  returns ok: false, fix the call when you can; otherwise explain the limitation
  and ask for what is missing instead of guessing.

Amounts:
- Amounts in tool arguments and in fields that end in _cents are integer euro
  cents: 123456 means 1 234,56 €. Give cents when you propose an amount.
- A tool result shows each _cents amount again as text, under the same name
  without _cents: net_cents 123456 comes with net "1 234,56". Write amounts from
  that text, never from the cents.
- Expenses are net: a reimbursement allocated to an expense lowers that expense.
  Reimbursements are not income.
- Write amounts the way the app does: a space between thousands, a comma before
  the cents, and the euro sign after the number, for example 1 234,56 €. Do not use
  dollars unless a transaction says it was in USD.

Changing data:
- Propose a change with propose_change only when the user asks for one. Find the
  exact rows with sql_query first, and ask when the request is ambiguous.
- A proposal shows the user an approval card and ends your turn; nothing changes
  until they approve it. Do not describe the change as done or repeat the card.
- Propose one change at a time. The result tells you whether the user approved it
  (status applied), dismissed it, or the data changed meanwhile (status conflict).
  Confirm an applied change in one short sentence.
- Nothing you change is lost for good: Trash keeps trashed transactions, archived
  categories and tags keep their transactions, and kind undo with an action_id
  reverses a change you made.
- You cannot change the amount or date of an existing transaction, create, rename,
  or merge categories, edit rules, restore from Trash, or change settings. Say
  where in the app the user can do it.

The app:
- Dashboard: an overview of the balance, spending, and budgets.
- Transactions: the ledger. Open a transaction to edit its amount, date, or notes.
  Trash opens from the menu on Transactions; restore transactions there.
- Uncategorized: transactions waiting for a category, listed only when there are
  some.
- Budgets: monthly budgets and their progress. Insights: spending charts and
  trends. Forecast: the projected balance.
- Manage: Recurring (recurring payments and income), Templates (saved transactions
  for quick entry), Rules (automatic categories and tags), Categories, and Tags.
- Tools: What If (forecast scenarios), Reconcile (match a bank statement), Reports,
  Digest (a weekly summary), and Assistant.
- Settings: Account, Appearance, Categorization (automatic categorization),
  Assistant (how long chats are kept), Balance snapshots (the real account balance
  on a date), and Import and export.
- Link a page when you point the user to it: [Budgets](page:budgets). Pages:
  dashboard, transactions, uncategorized, trash, budgets, insights, forecast,
  recurring, templates, rules, categories, tags, what-if, reconcile, reports,
  digest, settings.

Output rules:
- Keep answers compact: one short paragraph, then a bullet list when useful.
- List transactions or changes as bullets, not tables. Use a markdown table only
  when the user asks for one.
- When you name a transaction a tool returned, link its title with its id so the
  user can open it: [Lunch](transaction:123). Link only ids a tool returned.
- Before calling tools you may say in one short sentence what you are checking.
  Start the final answer with the answer itself.
- Never use emoji.
""".strip()

REFERENCE_START = "<reference>"
REFERENCE_END = "</reference>"
REFERENCE_SECTION = re.compile(r"<(\w+)>\n(.*?)\n</\1>", re.DOTALL)


def reference_block(sections: dict[str, str]) -> str:
    """The block that starts a question, one tagged part per section."""
    return "\n".join(
        [
            REFERENCE_START,
            *(f"<{name}>\n{text}\n</{name}>" for name, text in sections.items()),
            REFERENCE_END,
        ]
    )


# Prompt space for the category and tag lists stays bounded.
CATALOG_LIMIT = 200
RECENT_ACTIONS = 10

AssistantClient = Literal["web", "ios"]

CLIENT_LINES: dict[AssistantClient, str] = {
    "web": "The user is in the web app. On a computer, the sidebar lists every page "
    "and Settings is in the Expenses menu at its top. On a phone, the tab bar shows "
    "Dashboard, Transactions, Budgets, and Insights, and its More menu holds the "
    "other pages and Settings.",
    "ios": "The user is in the iOS app. Its tabs are Dashboard, Transactions, "
    "Budgets, Insights, and More. More lists Forecast, Uncategorized, the Manage and "
    "Tools pages, and Settings.",
}

SQL_ROWS = 100
SQL_SECONDS = 2
SQL_TEXT = 300

# What sql_query reads: one user's rows, copied so a query reaches nothing else.
SQL_TABLES = {
    "transactions": """
        select t.id, t.date,
            case when t.type = 'expense' then 'expense'
                when t.is_reimbursement then 'reimbursement' else 'income' end as kind,
            t.title, t.description, t.category_id, c.name as category,
            t.amount_cents, coalesce(r.cents, 0) as reimbursed_cents,
            max(0, t.amount_cents - coalesce(r.cents, 0)) as net_cents,
            t.source_currency_code as original_currency,
            t.source_amount_cents as original_amount_cents,
            t.origin_rule_id as recurring_id
        from transactions t
        join categories c on c.id = t.category_id
        left join (
            select a.expense_transaction_id as id, sum(a.amount_cents) as cents
            from reimbursement_allocations a
            join transactions p on p.id = a.reimbursement_transaction_id
            where a.user_id = :user and p.deleted_at is null and p.type = 'income'
                and p.is_reimbursement
            group by a.expense_transaction_id
        ) r on r.id = t.id and t.type = 'expense'
        where t.user_id = :user and t.deleted_at is null
    """,
    "trash": """
        select t.id, t.date,
            case when t.type = 'expense' then 'expense'
                when t.is_reimbursement then 'reimbursement' else 'income' end as kind,
            t.title, c.name as category, t.amount_cents, t.deleted_at
        from transactions t
        join categories c on c.id = t.category_id
        where t.user_id = :user and t.deleted_at is not null
    """,
    "transaction_tags": """
        select tt.transaction_id, tt.tag_id, g.name as tag
        from transaction_tags tt
        join tags g on g.id = tt.tag_id
        join transactions t on t.id = tt.transaction_id
        where t.user_id = :user and t.deleted_at is null
    """,
    "categories": """
        select id, name, type as kind, archived_at is not null as archived
        from categories where user_id = :user
    """,
    "tags": """
        select id, name, is_hidden_from_budget as hidden_from_budget,
            archived_at is not null as archived
        from tags where user_id = :user
    """,
    "reimbursement_allocations": """
        select a.reimbursement_transaction_id as reimbursement_id,
            a.expense_transaction_id as expense_id, a.amount_cents
        from reimbursement_allocations a
        join transactions p on p.id = a.reimbursement_transaction_id
        join transactions e on e.id = a.expense_transaction_id
        where a.user_id = :user and p.deleted_at is null and e.deleted_at is null
    """,
    "recurring": """
        select r.id, coalesce(r.name, c.name) as name, r.type as kind,
            r.amount_cents, r.currency_code as currency, r.category_id,
            r.interval_count, r.interval_unit, r.anchor_date,
            r.next_occurrence as next_date, r.end_date, r.auto_post
        from recurring_rules r
        join categories c on c.id = r.category_id
        where r.user_id = :user
    """,
    "durable_purchases": """
        select d.transaction_id, d.expected_lifespan_days as lifespan_days,
            d.acquired_on
        from durable_purchases d
        join transactions t on t.id = d.transaction_id
        where d.user_id = :user and t.deleted_at is null
    """,
    "rules": """
        select id, name, enabled, priority, match_type, match_value,
            transaction_type, min_amount_cents, max_amount_cents, set_category_id,
            add_tags_json as add_tags, budget_exclude_tag_id
        from rules where user_id = :user
    """,
}


def _invalid(status: str, message: str) -> dict[str, Any]:
    return {"ok": False, "status": status, "message": message}


def _read_only(action: int, *_: object) -> int:
    if action in (
        sqlite3.SQLITE_SELECT,
        sqlite3.SQLITE_READ,
        sqlite3.SQLITE_FUNCTION,
        sqlite3.SQLITE_RECURSIVE,
    ):
        return sqlite3.SQLITE_OK
    return sqlite3.SQLITE_DENY


def _fuzzy(text: str | None, query: str | None) -> int:
    return _fuzzy_text_match(query or "", text, None)


def _cell(value: object) -> object:
    if isinstance(value, bytes):
        return f"<{len(value)} bytes>"
    if isinstance(value, str) and len(value) > SQL_TEXT:
        return value[:SQL_TEXT] + "…"
    return value


class AssistantReader:
    """Read-only queries over one user's data, shaped for the model."""

    def __init__(
        self,
        session: Session,
        *,
        user_id: int,
        now: datetime,
        client: AssistantClient,
    ) -> None:
        self.session = session
        self.user_id = user_id
        self.now = now
        self.today = now.date()
        self.client = client
        self._sql: sqlite3.Connection | None = None
        self._sql_path: Path | None = None

    def close(self) -> None:
        if self._sql is not None:
            self._sql.close()
            self._sql = None
        if self._sql_path is not None:
            self._sql_path.unlink(missing_ok=True)
            self._sql_path = None

    def reference(self) -> dict[str, str]:
        """The date, client, categories, tags, and recent changes the model needs to
        call tools, by section."""
        categories = self.session.scalars(
            select(Category)
            .where(Category.user_id == self.user_id)
            .order_by(Category.archived_at.is_not(None), Category.type, Category.order)
            .limit(CATALOG_LIMIT)
        ).all()
        tags = self.session.scalars(
            select(Tag)
            .where(Tag.user_id == self.user_id)
            .order_by(Tag.archived_at.is_not(None), Tag.name)
            .limit(CATALOG_LIMIT)
        ).all()
        sections = {
            "date": f"Today is {self.today:%A}, {self.today.isoformat()}. Resolve "
            "relative periods such as this month or last week from this date.",
            "client": CLIENT_LINES[self.client],
            "categories": "\n".join(
                [
                    "Categories (id: name, type):",
                    *(
                        f"- {category.id}: {category.name}, {category.type.value}"
                        + (", archived" if category.archived_at else "")
                        for category in categories
                    ),
                ]
            ),
            "tags": "\n".join(
                [
                    "Tags (id: name):",
                    *(
                        [
                            f"- {tag.id}: {tag.name}"
                            + (", archived" if tag.archived_at else "")
                            for tag in tags
                        ]
                        or ["- none"]
                    ),
                ]
            ),
        }
        actions = self.session.scalars(
            select(AssistantAction)
            .where(
                AssistantAction.user_id == self.user_id,
                AssistantAction.status.in_(("applied", "undone")),
            )
            .order_by(AssistantAction.decided_at.desc())
            .limit(RECENT_ACTIONS)
        ).all()
        # Always present, so an emptied list replaces the one the model saw before.
        sections["changes"] = "\n".join(
            [
                "Changes you made recently (action_id: summary, date):",
                *(
                    [
                        f"- {action.id}: {action.summary}, {action.decided_at:%Y-%m-%d}"
                        + (", undone" if action.status == "undone" else "")
                        for action in actions
                    ]
                    or ["- none"]
                ),
            ]
        )
        return sections

    def _sql_copy(self) -> sqlite3.Connection:
        """The user's rows in a private temporary database, copied once per turn and
        deleted by close()."""
        if self._sql is not None:
            return self._sql
        # On disk, the copy holds only SQLite's page cache in memory, however large
        # the ledger is.
        handle, name = tempfile.mkstemp(prefix="expenses_assistant_", suffix=".db")
        os.close(handle)
        self._sql_path = Path(name)
        # SQLite copies the rows itself, many times faster than Python can. A pooled
        # connection of its own has no open transaction that would block DETACH.
        pooled = self.session.get_bind().raw_connection()
        try:
            source = pooled.driver_connection
            source.execute("attach ? as assistant_copy", (name,))
            try:
                # The copy never outlives the turn, so it needs no journal or fsync.
                source.execute("pragma assistant_copy.journal_mode = off")
                source.execute("pragma assistant_copy.synchronous = off")
                # One transaction, so every table shows the ledger at the same moment.
                source.execute("begin")
                for table, query in SQL_TABLES.items():
                    source.execute(
                        f"create table assistant_copy.{table} as {query}",
                        {"user": self.user_id},
                    )
                source.execute("commit")
            finally:
                if source.in_transaction:
                    source.rollback()
                source.execute("detach assistant_copy")
        finally:
            pooled.close()
        copy = sqlite3.connect(
            f"{self._sql_path.as_uri()}?mode=ro", uri=True, check_same_thread=False
        )
        copy.create_function("fuzzy", 2, _fuzzy, deterministic=True)
        copy.setconfig(sqlite3.SQLITE_DBCONFIG_DEFENSIVE, True)
        copy.setconfig(sqlite3.SQLITE_DBCONFIG_TRUSTED_SCHEMA, False)
        copy.setlimit(sqlite3.SQLITE_LIMIT_LENGTH, 1_000_000)
        copy.setlimit(sqlite3.SQLITE_LIMIT_SQL_LENGTH, 20_000)
        copy.set_authorizer(_read_only)
        self._sql = copy
        return copy

    def sql_query(self, *, sql: str) -> dict[str, Any]:
        connection = self._sql_copy()
        deadline = monotonic() + SQL_SECONDS
        connection.set_progress_handler(lambda: monotonic() > deadline, 10_000)
        try:
            cursor = connection.execute(sql)
            rows = cursor.fetchmany(SQL_ROWS + 1)
            columns = [column[0] for column in cursor.description or []]
            cursor.close()
        except sqlite3.Error as exc:
            message = str(exc)
            if message == "interrupted":
                message = (
                    f"The query ran longer than {SQL_SECONDS} seconds. "
                    "Filter or aggregate more."
                )
            elif message == "not authorized":
                message = "Only a SELECT can run; it can't change data or settings."
            return _invalid("invalid_sql", message)
        amounts = {
            index for index, name in enumerate(columns) if name.endswith("_cents")
        }
        shown_rows = []
        for row in rows[:SQL_ROWS]:
            shown = []
            for index, value in enumerate(row):
                shown.append(_cell(value))
                if index in amounts:
                    # Model-written SQL can put anything in a column it names _cents.
                    shown.append(
                        _amount(value) if isinstance(value, int | float) else None
                    )
            shown_rows.append(shown)
        result: dict[str, Any] = {
            "ok": True,
            "columns": [
                shown
                for index, name in enumerate(columns)
                for shown in (
                    (name, name.removesuffix("_cents")) if index in amounts else (name,)
                )
            ],
            "rows": shown_rows,
        }
        if len(rows) > SQL_ROWS:
            result["more"] = True
        return result

    def get_budgets(
        self, *, year: int, month: int, category_id: int | None = None
    ) -> dict[str, Any]:
        if month < 1 or month > 12:
            return _invalid("invalid_month", "month must be between 1 and 12")
        budget_service = BudgetService(self.session, self.user_id)
        progress = budget_service.progress_for_month(year, month, as_of=self.today)
        budgets = []
        for budget in budget_service.effective_budgets_for_month(year, month):
            if category_id is not None and budget.scope_category_id != category_id:
                continue
            budgets.append(
                {
                    "scope_category_id": budget.scope_category_id,
                    "scope_label": budget.scope_label,
                    "amount_cents": budget.amount_cents,
                    "source": budget.source,
                    **progress.get(budget.scope_category_id, {}),
                }
            )
        return with_amounts(
            {
                "ok": True,
                "year": year,
                "month": month,
                "as_of": self.today.isoformat(),
                "budgets": budgets,
            }
        )

    def get_balance(
        self, *, months_back: int, months_ahead: Literal[0, 3, 6, 12]
    ) -> dict[str, Any]:
        result: dict[str, Any] = {"ok": True}
        if months_back > 0:
            history = BalanceAnchorService(
                self.session, self.user_id
            ).month_end_history(
                months=min(months_back, 60), now=self.now.replace(tzinfo=None)
            )
            result["history"] = [
                {
                    "month": f"{start.year:04d}-{start.month:02d}",
                    "end_balance_cents": balance,
                }
                for start, balance in history
            ]
        if months_ahead:
            forecast = ForecastService(self.session, self.user_id).forecast(
                horizon=months_ahead, mode="full"
            )
            result["forecast"] = {
                "start_balance_cents": forecast["start_balance_cents"],
                "method": forecast["model"]["method"],
                "summary": forecast["summary"],
                "months": [
                    {
                        "month": month["month"],
                        "income_cents": month["projected_income_cents"],
                        "expense_cents": month["projected_expenses_cents"],
                        "net_cents": month["projected_net_cents"],
                        "end_balance_cents": month["end_balance_cents"],
                        "end_balance_p10_cents": month["end_balance_p10_cents"],
                        "end_balance_p90_cents": month["end_balance_p90_cents"],
                        "minimum_balance_cents": month["minimum_balance_cents"],
                    }
                    for month in forecast["months"]
                ],
            }
        return with_amounts(result)


def sql_query(ctx: RunContext[AssistantReader], label: str, sql: str) -> dict[str, Any]:
    """Run one read-only SQLite SELECT over the user's data. Returns up to 100 rows;
    `more` means there are others, so aggregate in SQL or page with LIMIT and OFFSET.

    Tables. Dates are YYYY-MM-DD text, every *_cents column is an integer amount in
    euro cents (123456 is 1 234,56 €), and flags are 1 or 0. In the result, each
    column whose name ends in _cents is followed by the same amount as text, so end
    the name of a computed amount in _cents too: sum(net_cents) as spent_cents.
    - transactions: id, date, kind (expense, income, or reimbursement), title,
      description, category_id, category, amount_cents, reimbursed_cents,
      net_cents, original_currency, original_amount_cents, recurring_id. net_cents
      is what an expense cost after reimbursements; use it for spending.
      original_currency is USD when the user paid in dollars. Trash is not here.
    - trash: id, date, kind, title, category, amount_cents, deleted_at.
    - transaction_tags: transaction_id, tag_id, tag.
    - categories: id, name, kind (expense or income), archived.
    - tags: id, name, hidden_from_budget, archived.
    - reimbursement_allocations: reimbursement_id, expense_id, amount_cents.
    - recurring: id, name, kind, amount_cents (in currency), currency (EUR or USD),
      category_id, interval_count, interval_unit (day, week, month, or year),
      anchor_date, next_date, end_date (the last date it may occur), auto_post.
    - durable_purchases: transaction_id, lifespan_days, acquired_on.
    - rules: id, name, enabled, priority, match_type (contains, equals,
      starts_with, or regex), match_value, transaction_type, min_amount_cents,
      max_amount_cents, set_category_id, add_tags (a JSON list),
      budget_exclude_tag_id.
    fuzzy(text, query) is 1 when text matches query the way the app's search does,
    tolerating typos.

    Args:
        label: What the query finds, in a few words the user sees, such as
            Spending by category, May 2026.
        sql: One SELECT statement.
    """
    return ctx.deps.sql_query(sql=sql)


def get_budgets(
    ctx: RunContext[AssistantReader],
    year: int,
    month: int,
    category_id: int | None = None,
) -> dict[str, Any]:
    """Monthly budgets with spent, remaining, and projected spending for a month,
    in euro cents."""
    return ctx.deps.get_budgets(year=year, month=month, category_id=category_id)


def get_balance(
    ctx: RunContext[AssistantReader],
    months_back: int = 12,
    months_ahead: Literal[0, 3, 6, 12] = 0,
) -> dict[str, Any]:
    """The account balance at the end of recent months and, with months_ahead, the
    forecast: projected income, expenses, and end balance with a p10 to p90 range.
    Amounts are euro cents.

    Args:
        months_back: Recent months of actual balances, up to 60; 0 for none.
        months_ahead: Months to forecast; 0 for none.
    """
    return ctx.deps.get_balance(months_back=months_back, months_ahead=months_ahead)


TOOLS = [sql_query, get_budgets, get_balance]

CHANGE_LABELS = {
    "create_transactions": "New transactions",
    "edit_transactions": "Transaction changes",
    "trash_transactions": "Transactions for Trash",
    "allocate_reimbursement": "Reimbursement allocation",
    "set_budgets": "Budget changes",
    "remove_budgets": "Budget removal",
    "archive": "Archiving",
    "end_recurring": "End of recurring payments",
    "undo": "Undo",
}


def _eur(cents: int) -> str:
    """Formats cents like the app: 1 234,56 €."""
    sign = "-" if cents < 0 else ""
    euros = f"{abs(cents) // 100:,}".replace(",", " ")
    return f"{sign}{euros},{abs(cents) % 100:02d} €"


def _amount(cents: int | float) -> str:
    """Cents as the model writes them, without the currency: 1 234,56."""
    cents = round(cents)
    sign = "-" if cents < 0 else ""
    units = f"{abs(cents) // 100:,}".replace(",", " ")
    return f"{sign}{units},{abs(cents) % 100:02d}"


def with_amounts(value: Any) -> Any:
    """Puts the text of each *_cents number in a tool result beside it, such as net
    "19,00" beside net_cents 1900, so the model quotes amounts instead of converting
    cents."""
    if isinstance(value, list):
        return [with_amounts(item) for item in value]
    if not isinstance(value, dict):
        return value
    shown = {}
    for key, item in value.items():
        shown[key] = with_amounts(item)
        if key.endswith("_cents") and isinstance(item, int | float):
            shown[key.removesuffix("_cents")] = _amount(item)
    return shown


def tool_label(tool_name: str, args: dict[str, Any]) -> str:
    """What a tool step says it looks at, from the model's arguments."""
    match tool_name:
        case "sql_query":
            return str(args.get("label") or "Query")[:80]
        case "get_budgets":
            try:
                return (
                    f"Budgets, {date(int(args['year']), int(args['month']), 1):%b %Y}"
                )
            except (KeyError, TypeError, ValueError):
                return "Budgets"
        case "get_balance":
            back = args.get("months_back", 12)
            ahead = args.get("months_ahead", 0)
            if not ahead:
                return f"Balance, last {back} months"
            if not back:
                return f"Forecast, next {ahead} months"
            return f"Balance, last {back} and next {ahead} months"
        case "propose_change":
            change = args.get("change")
            kind = change.get("kind") if isinstance(change, dict) else None
            return CHANGE_LABELS.get(kind, "Change")
        case _:
            return tool_name


def tool_detail(tool_name: str, content: dict[str, Any]) -> str | None:
    """One line on what a tool found."""
    match tool_name:
        case "sql_query":
            count = len(content["rows"])
            if content.get("more"):
                return f"{count}+ rows"
            if count == 0:
                return "No rows"
            return "1 row" if count == 1 else f"{count} rows"
        case "get_budgets":
            budgets = content["budgets"]
            if not budgets:
                return "No budgets set"
            detail = "1 budget" if len(budgets) == 1 else f"{len(budgets)} budgets"
            over = sum(1 for row in budgets if int(row["remaining_cents"]) < 0)
            return f"{detail} · {over} over" if over else detail
        case "get_balance":
            if months := content.get("forecast", {}).get("months"):
                return (
                    f"{_eur(months[-1]['end_balance_cents'])} by {months[-1]['month']}"
                )
            if history := content.get("history"):
                return f"Now {_eur(history[-1]['end_balance_cents'])}"
            return "No balance yet"
        case _:
            return None
