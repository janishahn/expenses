"""Seed the local SQLite DB with realistic mock data for development.

Usage:
    uv run mock-db [--yes]

If the database already contains data, prompts for confirmation before
overwriting.  Pass --yes (or -y) to skip the prompt.
"""

import argparse
import hashlib
import shutil
import sqlite3
import sys
from datetime import date, datetime, time, timedelta
from decimal import Decimal
from io import BytesIO
from pathlib import Path

from sqlalchemy.orm import Session


# ── helpers ──────────────────────────────────────────────────────────────────


def db_path_from_url(url: str) -> Path | None:
    for prefix in ("sqlite+pysqlite:///", "sqlite:///"):
        if url.startswith(prefix):
            return Path(url[len(prefix) :])
    return None


def db_is_empty(db_path: Path) -> bool:
    if not db_path.exists() or db_path.stat().st_size == 0:
        return True
    con = sqlite3.connect(str(db_path))
    try:
        count = con.execute(
            "select count(*) from sqlite_master"
            " where type='table' and name not like 'sqlite_%'"
        ).fetchone()[0]
        return count == 0
    finally:
        con.close()


def _run_migrations(root_dir: Path) -> None:
    from alembic import command as alembic_command
    from alembic.config import Config

    from expenses.core.config import get_settings

    cfg = Config(str(root_dir / "alembic.ini"))
    cfg.set_main_option("sqlalchemy.url", get_settings().database_url)
    alembic_command.upgrade(cfg, "head")


# ── seeding ───────────────────────────────────────────────────────────────────


def _seed(session: Session) -> None:
    from expenses.auth.security import hash_password
    from expenses.db.models import (
        BankStatementRow,
        BudgetFrequency,
        CurrencyCode,
        IntervalUnit,
        MonthDayPolicy,
        RuleMatchType,
        Transaction,
        TransactionType,
        User,
    )
    from expenses.schemas import (
        BalanceAnchorIn,
        BudgetOverrideIn,
        BudgetTemplateIn,
        CategoryIn,
        DurablePurchaseIn,
        RecurringRuleIn,
        RuleIn,
        TransactionIn,
        TransactionTemplateIn,
    )
    from expenses.services.bank_reconciliation import COMMERZBANK_CSV_SOURCE
    from expenses.services.main import (
        BalanceAnchorService,
        BudgetService,
        CategoryService,
        DurablePurchaseService,
        RecurringRuleService,
        ReimbursementService,
        ReceiptAttachmentService,
        RuleService,
        TagService,
        TransactionTemplateService,
        TransactionService,
    )

    today = date.today()

    session.add(
        User(
            id=1,
            username="test",
            password_hash=hash_password("test"),
            is_admin=True,
        )
    )
    session.flush()

    # ── categories ────────────────────────────────────────────────────────────
    cat_svc = CategoryService(session)

    expense_cat_names = [
        "Housing",
        "Food & Groceries",
        "Restaurants",
        "Transport",
        "Subscriptions",
        "Healthcare",
        "Shopping",
        "Entertainment",
        "Travel",
        "Utilities",
    ]
    income_cat_names = ["Salary", "Freelance", "Other Income"]

    expense_cats: dict[str, int] = {}
    for i, name in enumerate(expense_cat_names):
        cat = cat_svc.create(
            CategoryIn(name=name, type=TransactionType.expense, order=i)
        )
        expense_cats[name] = cat.id

    income_cats: dict[str, int] = {}
    for i, name in enumerate(income_cat_names):
        cat = cat_svc.create(
            CategoryIn(name=name, type=TransactionType.income, order=i)
        )
        income_cats[name] = cat.id

    # ── tags ──────────────────────────────────────────────────────────────────
    tag_svc = TagService(session)
    tags_spec: list[tuple[str, bool]] = [
        ("Work", False),
        ("Personal", False),
        ("Reimbursable", False),
        ("Travel", False),
        ("Streaming", False),
        ("Commute", False),
        ("Essential", False),
        ("Health", False),
        ("Family", False),
        ("Vacation", False),
        ("Online", False),
        (
            "Recurring",
            True,
        ),  # hidden from budget – exercises is_hidden_from_budget flag
    ]
    for name, hidden in tags_spec:
        tag_svc.create(name, is_hidden_from_budget=hidden)

    # ── auto-categorisation rules ─────────────────────────────────────────────
    rule_svc = RuleService(session)
    for rule_data in [
        RuleIn(
            name="Netflix → Subscriptions",
            enabled=True,
            priority=10,
            match_type=RuleMatchType.contains,
            match_value="netflix",
            transaction_type=TransactionType.expense,
            set_category_id=expense_cats["Subscriptions"],
            add_tags=["Streaming"],
        ),
        RuleIn(
            name="Spotify → Subscriptions",
            enabled=True,
            priority=10,
            match_type=RuleMatchType.contains,
            match_value="spotify",
            transaction_type=TransactionType.expense,
            set_category_id=expense_cats["Subscriptions"],
            add_tags=["Streaming"],
        ),
        RuleIn(
            name="Uber / Bolt → Transport",
            enabled=True,
            priority=20,
            match_type=RuleMatchType.regex,
            match_value=r"uber|bolt",
            transaction_type=TransactionType.expense,
            set_category_id=expense_cats["Transport"],
            add_tags=["Commute"],
        ),
        RuleIn(
            name="Amazon → Shopping",
            enabled=True,
            priority=30,
            match_type=RuleMatchType.contains,
            match_value="amazon",
            transaction_type=TransactionType.expense,
            set_category_id=expense_cats["Shopping"],
            add_tags=["Online"],
        ),
        RuleIn(
            name="Supermarket → Food & Groceries",
            enabled=True,
            priority=40,
            match_type=RuleMatchType.regex,
            match_value=r"rewe|lidl|aldi",
            transaction_type=TransactionType.expense,
            set_category_id=expense_cats["Food & Groceries"],
            add_tags=[],
        ),
    ]:
        rule_svc.create(rule_data)

    # ── recurring rules ───────────────────────────────────────────────────────
    # next_occurrence is placed in the coming month so the scheduler does not
    # immediately auto-post anything on the first `uv run dev` startup.
    rec_svc = RecurringRuleService(session)
    next_month = (today.replace(day=28) + timedelta(days=4)).replace(day=1)
    prev_year = today.year if today.month > 1 else today.year - 1
    prev_month = today.month - 1 if today.month > 1 else 12

    for rule_data in [
        RecurringRuleIn(
            name="Monthly Salary",
            type=TransactionType.income,
            currency_code=CurrencyCode.eur,
            amount_cents=320_000,
            category_id=income_cats["Salary"],
            anchor_date=date(prev_year, prev_month, 1),
            interval_unit=IntervalUnit.month,
            interval_count=1,
            next_occurrence=next_month,
            end_date=None,
            auto_post=True,
            skip_weekends=False,
            month_day_policy=MonthDayPolicy.snap_to_end,
        ),
        RecurringRuleIn(
            name="Monthly Rent",
            type=TransactionType.expense,
            currency_code=CurrencyCode.eur,
            amount_cents=95_000,
            category_id=expense_cats["Housing"],
            anchor_date=date(prev_year, prev_month, 1),
            interval_unit=IntervalUnit.month,
            interval_count=1,
            next_occurrence=next_month,
            end_date=None,
            auto_post=True,
            skip_weekends=False,
            month_day_policy=MonthDayPolicy.snap_to_end,
        ),
        RecurringRuleIn(
            name="Netflix",
            type=TransactionType.expense,
            currency_code=CurrencyCode.eur,
            amount_cents=1_799,
            category_id=expense_cats["Subscriptions"],
            anchor_date=date(prev_year, prev_month, 15),
            interval_unit=IntervalUnit.month,
            interval_count=1,
            next_occurrence=next_month.replace(day=15),
            end_date=None,
            auto_post=True,
            skip_weekends=False,
            month_day_policy=MonthDayPolicy.snap_to_end,
        ),
        RecurringRuleIn(
            name="Spotify",
            type=TransactionType.expense,
            currency_code=CurrencyCode.eur,
            amount_cents=1_099,
            category_id=expense_cats["Subscriptions"],
            anchor_date=date(prev_year, prev_month, 10),
            interval_unit=IntervalUnit.month,
            interval_count=1,
            next_occurrence=next_month.replace(day=10),
            end_date=None,
            auto_post=True,
            skip_weekends=False,
            month_day_policy=MonthDayPolicy.snap_to_end,
        ),
        RecurringRuleIn(
            name="Gym",
            type=TransactionType.expense,
            currency_code=CurrencyCode.eur,
            amount_cents=3_000,
            category_id=expense_cats["Healthcare"],
            anchor_date=date(prev_year, prev_month, 5),
            interval_unit=IntervalUnit.month,
            interval_count=1,
            next_occurrence=next_month.replace(day=5),
            end_date=None,
            auto_post=True,
            skip_weekends=False,
            month_day_policy=MonthDayPolicy.snap_to_end,
        ),
    ]:
        rec_svc.create(rule_data)

    # ── transactions (12 months) ──────────────────────────────────────────────
    txn_svc = TransactionService(session)

    current_month = today.replace(day=1)

    def add_months(month_start: date, delta: int) -> date:
        year = month_start.year + (month_start.month - 1 + delta) // 12
        month = (month_start.month - 1 + delta) % 12 + 1
        return date(year, month, 1)

    def txn_date(month_start: date, day: int) -> date:
        latest_day = (
            min(today.day, 28)
            if month_start.year == today.year and month_start.month == today.month
            else 28
        )
        return date(month_start.year, month_start.month, min(day, latest_day))

    seeded_expense_txns: list[Transaction] = []
    receipt_examples: list[tuple[Transaction, str, str, list[tuple[str, int]]]] = []
    matched_salary_txn: Transaction | None = None
    suggested_grocery_txn: Transaction | None = None

    def create_txn(
        *,
        month_start: date,
        day: int,
        hour: int,
        minute: int,
        txn_type: TransactionType,
        amount_cents: int,
        category_id: int,
        title: str,
        tags: list[str] | None = None,
        description: str | None = None,
        latitude: Decimal | None = None,
        longitude: Decimal | None = None,
        is_reimbursement: bool = False,
    ) -> Transaction:
        actual_date = txn_date(month_start, day)
        txn = txn_svc.create(
            TransactionIn(
                date=actual_date,
                occurred_at=datetime.combine(actual_date, time(hour, minute)),
                type=txn_type,
                is_reimbursement=is_reimbursement,
                amount_cents=amount_cents,
                category_id=category_id,
                title=title,
                description=description,
                latitude=latitude,
                longitude=longitude,
                tags=tags or [],
            )
        )
        if txn_type == TransactionType.expense:
            seeded_expense_txns.append(txn)
        return txn

    first_month = add_months(current_month, -11)
    for offset in range(12):
        month_start = add_months(first_month, offset)
        month_number = offset + 1

        salary_txn = create_txn(
            month_start=month_start,
            day=1,
            hour=8,
            minute=30,
            txn_type=TransactionType.income,
            amount_cents=425_000 + (offset % 3) * 2_500,
            category_id=income_cats["Salary"],
            title="Salary transfer - ACME GmbH",
            tags=[],
        )
        if month_start == current_month:
            matched_salary_txn = salary_txn

        if offset % 3 == 1:
            create_txn(
                month_start=month_start,
                day=16,
                hour=10,
                minute=15,
                txn_type=TransactionType.income,
                amount_cents=62_000 + offset * 1_500,
                category_id=income_cats["Freelance"],
                title="Freelance invoice paid",
                tags=["Work"],
            )
        if offset % 4 == 2:
            create_txn(
                month_start=month_start,
                day=24,
                hour=17,
                minute=45,
                txn_type=TransactionType.income,
                amount_cents=11_000 + offset * 750,
                category_id=income_cats["Other Income"],
                title="Sold household item",
                tags=["Personal"],
            )

        create_txn(
            month_start=month_start,
            day=2,
            hour=9,
            minute=0,
            txn_type=TransactionType.expense,
            amount_cents=125_000,
            category_id=expense_cats["Housing"],
            title="Rent - Sonnenallee apartment",
            tags=["Essential", "Recurring"],
        )
        create_txn(
            month_start=month_start,
            day=4,
            hour=7,
            minute=45,
            txn_type=TransactionType.expense,
            amount_cents=8_200 + (offset % 3) * 350,
            category_id=expense_cats["Utilities"],
            title="Electricity bill",
            tags=["Essential", "Recurring"],
        )
        create_txn(
            month_start=month_start,
            day=5,
            hour=7,
            minute=50,
            txn_type=TransactionType.expense,
            amount_cents=3_999,
            category_id=expense_cats["Utilities"],
            title="Internet bill",
            tags=["Essential", "Recurring"],
        )
        create_txn(
            month_start=month_start,
            day=7,
            hour=8,
            minute=5,
            txn_type=TransactionType.expense,
            amount_cents=1_499,
            category_id=expense_cats["Utilities"],
            title="Phone plan",
            tags=["Essential", "Recurring"],
        )
        create_txn(
            month_start=month_start,
            day=12,
            hour=8,
            minute=10,
            txn_type=TransactionType.expense,
            amount_cents=1_650,
            category_id=expense_cats["Utilities"],
            title="Home insurance",
            tags=["Essential", "Recurring"],
        )

        for day, title, amount in [
            (3, "Rewe weekly shop", 8_200 + month_number * 45),
            (9, "Lidl grocery run", 6_850 + (offset % 2) * 600),
            (15, "Edeka household restock", 9_400 + (offset % 4) * 350),
            (21, "Aldi grocery run", 7_200 + (offset % 3) * 420),
            (27, "Farmers market", 4_800 + (offset % 5) * 250),
        ]:
            txn = create_txn(
                month_start=month_start,
                day=day,
                hour=18,
                minute=(day * 3) % 60,
                txn_type=TransactionType.expense,
                amount_cents=amount,
                category_id=expense_cats["Food & Groceries"],
                title=title,
                tags=["Essential"],
            )
            if month_start == current_month and title == "Rewe weekly shop":
                suggested_grocery_txn = txn
            if offset in {2, 7, 11} and title == "Edeka household restock":
                receipt_examples.append(
                    (
                        txn,
                        f"groceries-{month_start:%Y-%m}.png",
                        "Edeka mock receipt",
                        [
                            ("Fruit and vegetables", amount // 3),
                            ("Pantry staples", amount // 3),
                            ("Household items", amount - (amount // 3) * 2),
                        ],
                    )
                )

        for day, title, amount in [
            (6, "Morning coffee", 390 + (offset % 2) * 40),
            (8, "Lunch near office", 1_450 + (offset % 4) * 120),
            (13, "Dinner with friends", 4_600 + (offset % 3) * 550),
            (18, "Pizza delivery", 2_850 + (offset % 5) * 160),
            (23, "Weekend brunch", 3_400 + (offset % 3) * 300),
            (26, "Thai food takeaway", 2_950 + (offset % 2) * 250),
        ]:
            create_txn(
                month_start=month_start,
                day=day,
                hour=12 if "Lunch" in title else 19,
                minute=(day * 5) % 60,
                txn_type=TransactionType.expense,
                amount_cents=amount,
                category_id=expense_cats["Restaurants"],
                title=title,
                tags=["Personal"],
            )

        for day, title, amount in [
            (3, "Deutschlandticket", 5_800),
            (11, "Bolt ride home", 1_650 + (offset % 4) * 180),
            (20, "Bike repair and parts", 3_200 + (offset % 3) * 350),
        ]:
            create_txn(
                month_start=month_start,
                day=day,
                hour=17,
                minute=(day * 7) % 60,
                txn_type=TransactionType.expense,
                amount_cents=amount,
                category_id=expense_cats["Transport"],
                title=title,
                tags=["Commute"],
            )

        for day, title, amount in [
            (10, "Spotify subscription", 1_099),
            (12, "iCloud+", 299),
            (15, "Netflix subscription", 1_799),
            (19, "Amazon Prime", 899),
        ]:
            create_txn(
                month_start=month_start,
                day=day,
                hour=6,
                minute=(day * 2) % 60,
                txn_type=TransactionType.expense,
                amount_cents=amount,
                category_id=expense_cats["Subscriptions"],
                title=title,
                tags=["Streaming", "Recurring"],
            )

        create_txn(
            month_start=month_start,
            day=5,
            hour=8,
            minute=0,
            txn_type=TransactionType.expense,
            amount_cents=3_000,
            category_id=expense_cats["Healthcare"],
            title="Gym membership",
            tags=["Health", "Recurring"],
        )
        if offset % 2 == 0:
            create_txn(
                month_start=month_start,
                day=22,
                hour=13,
                minute=20,
                txn_type=TransactionType.expense,
                amount_cents=1_850 + offset * 60,
                category_id=expense_cats["Healthcare"],
                title="Pharmacy",
                tags=["Health"],
            )

        for day, title, amount, tags in [
            (6, "Amazon household supplies", 4_200 + (offset % 4) * 380, ["Online"]),
            (14, "Clothing basics", 6_900 + (offset % 3) * 500, ["Personal"]),
            (25, "Hardware store", 3_800 + (offset % 5) * 450, ["Personal"]),
        ]:
            create_txn(
                month_start=month_start,
                day=day,
                hour=16,
                minute=(day * 11) % 60,
                txn_type=TransactionType.expense,
                amount_cents=amount,
                category_id=expense_cats["Shopping"],
                title=title,
                tags=tags,
            )

        for day, title, amount in [
            (9, "Cinema tickets", 2_600 + (offset % 2) * 500),
            (17, "Books and magazines", 2_300 + (offset % 3) * 300),
        ]:
            create_txn(
                month_start=month_start,
                day=day,
                hour=20,
                minute=(day * 13) % 60,
                txn_type=TransactionType.expense,
                amount_cents=amount,
                category_id=expense_cats["Entertainment"],
                title=title,
                tags=["Personal"],
            )

        travel_amount = 4_900 + (offset % 4) * 750
        travel_title = "Regional train weekend trip"
        travel_tags = ["Travel"]
        if offset in {1, 6, 10}:
            travel_amount = 24_000 + offset * 1_200
            travel_title = "Weekend hotel booking"
            travel_tags = ["Travel", "Vacation"]
        travel_txn = create_txn(
            month_start=month_start,
            day=24,
            hour=11,
            minute=35,
            txn_type=TransactionType.expense,
            amount_cents=travel_amount,
            category_id=expense_cats["Travel"],
            title=travel_title,
            tags=travel_tags,
        )
        if offset in {6, 10}:
            receipt_examples.append(
                (
                    travel_txn,
                    f"travel-{month_start:%Y-%m}.png",
                    "Hotel mock receipt",
                    [
                        ("Room", travel_amount - 3_500),
                        ("City tax", 1_200),
                        ("Breakfast", 2_300),
                    ],
                )
            )

    # ── soft-delete a handful of transactions ─────────────────────────────────
    for index in (7, 73, 141, 209, 277):
        if index >= len(seeded_expense_txns):
            continue
        txn = seeded_expense_txns[index]
        txn_svc.soft_delete(txn.id)

    # ── reimbursement example ─────────────────────────────────────────────────
    # One fully-linked expense → reimbursement income pair for this month.
    expense_day = min(today.day, 10)
    income_day = min(today.day, 20)
    reimb_expense = txn_svc.create(
        TransactionIn(
            date=today.replace(day=expense_day),
            occurred_at=datetime.combine(today.replace(day=expense_day), time(14, 30)),
            type=TransactionType.expense,
            amount_cents=15_000,
            category_id=expense_cats["Travel"],
            title="Work conference travel (reimbursable)",
            description=(
                "Client trip to Berlin.\n\n"
                "- train tickets\n"
                "- hotel\n"
                "- submitted for reimbursement"
            ),
            tags=["Work", "Reimbursable"],
        )
    )
    reimb_income = txn_svc.create(
        TransactionIn(
            date=today.replace(day=income_day),
            occurred_at=datetime.combine(today.replace(day=income_day), time(10, 0)),
            type=TransactionType.income,
            is_reimbursement=True,
            amount_cents=15_000,
            category_id=income_cats["Other Income"],
            title="Conference travel reimbursement from employer",
            description=(
                "Matched against the original travel expense.\n\n"
                "> Paid via monthly payroll adjustment."
            ),
            tags=["Work"],
        )
    )
    ReimbursementService(session).upsert_allocation(
        reimbursement_transaction_id=reimb_income.id,
        expense_transaction_id=reimb_expense.id,
        amount_cents=15_000,
    )
    receipt_examples.append(
        (
            reimb_expense,
            "work-conference-travel.png",
            "Conference travel mock receipt",
            [
                ("Train tickets", 7_200),
                ("Hotel", 6_800),
                ("Local transport", 1_000),
            ],
        )
    )

    # ── receipt image attachments ────────────────────────────────────────────
    def render_mock_receipt_png(
        merchant: str,
        txn: Transaction,
        line_items: list[tuple[str, int]],
    ) -> bytes:
        from PIL import Image, ImageDraw

        image = Image.new("RGB", (640, 880), "white")
        draw = ImageDraw.Draw(image)
        draw.rectangle((0, 0, 640, 120), fill=(28, 37, 46))
        draw.text((44, 34), "MOCK RECEIPT", fill="white")
        draw.text((44, 72), merchant, fill=(221, 228, 236))
        draw.text((44, 150), txn.date.isoformat(), fill=(28, 37, 46))
        draw.text((44, 185), txn.title or "Expense", fill=(28, 37, 46))
        y = 260
        for label, amount in line_items:
            draw.text((44, y), label, fill=(28, 37, 46))
            draw.text((470, y), f"EUR {amount / 100:.2f}", fill=(28, 37, 46))
            y += 46
        draw.line((44, y + 16, 596, y + 16), fill=(158, 169, 181), width=2)
        draw.text((44, y + 48), "Total", fill=(28, 37, 46))
        draw.text((470, y + 48), f"EUR {txn.amount_cents / 100:.2f}", fill=(28, 37, 46))
        draw.text(
            (44, 790),
            "Generated sample image for local development.",
            fill=(93, 103, 114),
        )
        draw.text((44, 825), "Not a real merchant receipt.", fill=(93, 103, 114))

        buffer = BytesIO()
        image.save(buffer, format="PNG", optimize=True)
        return buffer.getvalue()

    attachment_svc = ReceiptAttachmentService(session)
    mock_receipts_dir = attachment_svc.path_for_storage_key("mock")
    if mock_receipts_dir.exists():
        shutil.rmtree(mock_receipts_dir)
    for txn, filename, merchant, line_items in receipt_examples:
        storage_key = f"mock/txn_{txn.id}/{filename}"
        content = render_mock_receipt_png(merchant, txn, line_items)
        path = attachment_svc.path_for_storage_key(storage_key)
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(content)
        attachment_svc.create_metadata(
            transaction_id=txn.id,
            storage_key=storage_key,
            original_filename=filename,
            mime_type="image/png",
            size_bytes=len(content),
            sha256_hex=hashlib.sha256(content).hexdigest(),
        )

    # ── bank reconciliation examples ─────────────────────────────────────────
    assert matched_salary_txn is not None
    assert suggested_grocery_txn is not None

    def bank_hash(label: str) -> str:
        return hashlib.sha256(label.encode("utf-8")).hexdigest()

    bank_rows = [
        BankStatementRow(
            user_id=1,
            source=COMMERZBANK_CSV_SOURCE,
            account_label="Checking account",
            booking_date=matched_salary_txn.date,
            value_date=matched_salary_txn.date,
            amount_cents=matched_salary_txn.amount_cents,
            currency="EUR",
            payee="ACME GmbH",
            booking_text="SEPA credit transfer",
            purpose="Salary",
            raw_description="ACME GmbH salary transfer",
            import_hash=bank_hash(f"salary-{matched_salary_txn.id}"),
            matched_transaction_id=matched_salary_txn.id,
        ),
        BankStatementRow(
            user_id=1,
            source=COMMERZBANK_CSV_SOURCE,
            account_label="Checking account",
            booking_date=suggested_grocery_txn.date,
            value_date=suggested_grocery_txn.date,
            amount_cents=-suggested_grocery_txn.amount_cents,
            currency="EUR",
            payee="REWE Markt GmbH",
            booking_text="Card payment",
            purpose="Groceries",
            raw_description="REWE weekly shop card payment",
            import_hash=bank_hash(f"rewe-{suggested_grocery_txn.id}"),
        ),
        BankStatementRow(
            user_id=1,
            source=COMMERZBANK_CSV_SOURCE,
            account_label="Checking account",
            booking_date=txn_date(current_month, 13),
            value_date=txn_date(current_month, 13),
            amount_cents=-8_888,
            currency="EUR",
            payee="Unknown merchant",
            booking_text="Card payment",
            purpose="Needs manual category",
            raw_description="Unknown merchant card payment",
            import_hash=bank_hash(f"missing-{today.isoformat()}"),
        ),
        BankStatementRow(
            user_id=1,
            source=COMMERZBANK_CSV_SOURCE,
            account_label="Checking account",
            booking_date=txn_date(current_month, 14),
            value_date=txn_date(current_month, 14),
            amount_cents=-4_321,
            currency="EUR",
            payee="Reviewed example",
            booking_text="Card payment",
            purpose="Intentionally marked reviewed",
            raw_description="Reviewed bank row without expense transaction",
            import_hash=bank_hash(f"reviewed-{today.isoformat()}"),
            reviewed_at=datetime.combine(txn_date(current_month, 15), time(9, 0)),
        ),
    ]
    session.add_all(bank_rows)
    session.commit()

    # ── location-tagged transactions ────────────────────────────────────────
    for (
        days_ago,
        hour,
        minute,
        cat_name,
        amount_cents,
        title,
        tags,
        latitude,
        longitude,
    ) in [
        (
            2,
            8,
            20,
            "Restaurants",
            420,
            "Coffee near Berlin Hauptbahnhof",
            ["Personal"],
            Decimal("52.525084"),
            Decimal("13.369402"),
        ),
        (
            4,
            18,
            45,
            "Restaurants",
            3_850,
            "Dinner in Kreuzberg",
            ["Personal"],
            Decimal("52.498600"),
            Decimal("13.403400"),
        ),
        (
            6,
            9,
            5,
            "Transport",
            1_099,
            "BVG top-up at Alexanderplatz",
            ["Commute"],
            Decimal("52.521918"),
            Decimal("13.413215"),
        ),
        (
            11,
            12,
            35,
            "Restaurants",
            2_480,
            "Lunch at Marienplatz",
            ["Personal"],
            Decimal("48.137393"),
            Decimal("11.575448"),
        ),
        (
            16,
            17,
            10,
            "Transport",
            390,
            "U-Bahn ticket at Sendlinger Tor",
            ["Commute"],
            Decimal("48.133991"),
            Decimal("11.566546"),
        ),
        (
            23,
            20,
            15,
            "Travel",
            12_900,
            "Hotel near München Hbf",
            ["Travel", "Vacation"],
            Decimal("48.140229"),
            Decimal("11.558335"),
        ),
    ]:
        txn_date = today - timedelta(days=days_ago)
        txn_svc.create(
            TransactionIn(
                date=txn_date,
                occurred_at=datetime.combine(txn_date, time(hour, minute)),
                type=TransactionType.expense,
                amount_cents=amount_cents,
                category_id=expense_cats[cat_name],
                title=title,
                latitude=latitude,
                longitude=longitude,
                tags=tags,
            )
        )

    # ── quick-add templates ──────────────────────────────────────────────────
    template_svc = TransactionTemplateService(session)
    for template in [
        TransactionTemplateIn(
            name="Morning coffee",
            type=TransactionType.expense,
            category_id=expense_cats["Restaurants"],
            default_amount_cents=350,
            title="Coffee to go",
            tags=["Personal"],
        ),
        TransactionTemplateIn(
            name="Weekly groceries",
            type=TransactionType.expense,
            category_id=expense_cats["Food & Groceries"],
            default_amount_cents=None,
            title="Supermarket",
            tags=["Essential"],
        ),
        TransactionTemplateIn(
            name="Commute ticket",
            type=TransactionType.expense,
            category_id=expense_cats["Transport"],
            default_amount_cents=320,
            title="Local transport",
            tags=["Commute"],
        ),
        TransactionTemplateIn(
            name="Freelance invoice paid",
            type=TransactionType.income,
            category_id=income_cats["Freelance"],
            default_amount_cents=None,
            title="Client payment",
            tags=["Work"],
        ),
    ]:
        template_svc.create(template)

    # ── durable purchase examples ────────────────────────────────────────────
    laptop_txn = txn_svc.create(
        TransactionIn(
            date=today - timedelta(days=142),
            occurred_at=datetime.combine(today - timedelta(days=142), time(11, 15)),
            type=TransactionType.expense,
            amount_cents=120_000,
            category_id=expense_cats["Shopping"],
            title="MacBook Pro 14",
            description=(
                "Replacement work machine.\n\n"
                "**Specs**\n"
                "- 14-inch display\n"
                "- 1TB SSD\n"
                "- Apple silicon\n\n"
                "[Warranty](https://example.com/warranty)"
            ),
            tags=["Work"],
        )
    )
    DurablePurchaseService(session).upsert(
        laptop_txn.id,
        DurablePurchaseIn(
            expected_lifespan_days=730,
            acquired_on=today - timedelta(days=142),
        ),
    )
    chair_txn = txn_svc.create(
        TransactionIn(
            date=today - timedelta(days=980),
            occurred_at=datetime.combine(today - timedelta(days=980), time(16, 45)),
            type=TransactionType.expense,
            amount_cents=42_000,
            category_id=expense_cats["Shopping"],
            title="Ergonomic office chair",
            description=(
                "Daily workstation chair.\n\n"
                "- lumbar support\n"
                "- fully amortized in the dashboard seed state"
            ),
            tags=["Work"],
        )
    )
    DurablePurchaseService(session).upsert(
        chair_txn.id,
        DurablePurchaseIn(
            expected_lifespan_days=730,
            acquired_on=today - timedelta(days=980),
        ),
    )

    # ── balance anchor ────────────────────────────────────────────────────────
    # Pre-dates all seeded transactions so the running-balance report has a
    # clean starting point.
    oldest_seeded_transaction = (
        session.query(Transaction)
        .order_by(Transaction.occurred_at.asc(), Transaction.id.asc())
        .first()
    )
    assert oldest_seeded_transaction is not None
    anchor_dt = oldest_seeded_transaction.occurred_at - timedelta(days=3)
    BalanceAnchorService(session).create(
        BalanceAnchorIn(
            as_of_at=anchor_dt,
            balance_cents=500_000,
            note="Opening balance (mock data)",
        )
    )

    # ── budgets ───────────────────────────────────────────────────────────────
    budget_svc = BudgetService(session)
    budget_start = date(today.year - 1, 1, 1)

    # Overall monthly budget
    budget_svc.upsert_template(
        BudgetTemplateIn(
            frequency=BudgetFrequency.monthly,
            category_id=None,
            amount_cents=250_000,
            starts_on=budget_start,
        )
    )

    # Per-category monthly budgets
    for cat_name, amount in [
        ("Food & Groceries", 45_000),
        ("Restaurants", 20_000),
        ("Transport", 15_000),
        ("Entertainment", 15_000),
        ("Shopping", 40_000),
        ("Travel", 80_000),
    ]:
        budget_svc.upsert_template(
            BudgetTemplateIn(
                frequency=BudgetFrequency.monthly,
                category_id=expense_cats[cat_name],
                amount_cents=amount,
                starts_on=budget_start,
            )
        )

    # Current-month override: bumped grocery budget (exercises the overrides UI)
    budget_svc.upsert_override(
        BudgetOverrideIn(
            year=today.year,
            month=today.month,
            category_id=expense_cats["Food & Groceries"],
            amount_cents=60_000,
        )
    )


# ── public entry points ───────────────────────────────────────────────────────


def seed(yes: bool = False) -> int:
    """Create schema and seed mock data. Returns 0 on success, non-zero on abort."""
    root_dir = Path(__file__).resolve().parents[3]

    from expenses.core.config import get_settings

    settings = get_settings()
    db_path = db_path_from_url(settings.database_url)

    if db_path is None:
        print(
            f"Non-SQLite database URL configured ({settings.database_url}),"
            " cannot create mock DB.",
            file=sys.stderr,
        )
        return 1

    if not db_is_empty(db_path):
        if not yes:
            try:
                answer = (
                    input(
                        f"DB already exists at {db_path} and contains data.\n"
                        "Overwrite? [y/N] "
                    )
                    .strip()
                    .lower()
                )
            except EOFError:
                answer = "n"
            if answer not in ("y", "yes"):
                print("Aborted. Existing database left untouched.")
                return 0
        # Delete existing file and WAL/SHM companions
        for suffix in ("", "-wal", "-shm"):
            p = Path(str(db_path) + suffix)
            if p.exists():
                p.unlink()
        print(f"Deleted {db_path}")
    else:
        db_path.parent.mkdir(parents=True, exist_ok=True)

    print("Running migrations…")
    _run_migrations(root_dir)
    print("Schema ready.")

    print("Seeding mock data…")
    from expenses.db.session import SessionLocal

    session = SessionLocal()
    try:
        _seed(session)
    finally:
        session.close()

    print(
        f"Done. Mock database created at {db_path}\n"
        "  → ~390–430 semi-realistic transactions across 12 months\n"
        "  → 10 expense categories, 3 income categories\n"
        "  → 6 transactions with stored coordinates around Berlin and Munich\n"
        "  → 12 tags, 5 auto-categorisation rules\n"
        "  → 5 recurring rules (next due next month)\n"
        "  → budgets, a balance anchor, templates, and two durable purchases\n"
        "  → linked reimbursement example and soft-deleted transaction sample\n"
        "  → generated PNG receipt attachments and bank reconciliation examples"
    )
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Create a local SQLite DB populated with realistic mock data."
    )
    parser.add_argument(
        "--yes",
        "-y",
        action="store_true",
        help="Overwrite existing database without prompting.",
    )
    args = parser.parse_args()
    return seed(yes=args.yes)


if __name__ == "__main__":
    raise SystemExit(main())
