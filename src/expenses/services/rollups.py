from datetime import date

from sqlalchemy import delete, func, select
from sqlalchemy.orm import Session, aliased

from expenses.db.models import (
    MonthlyRollup,
    ReimbursementAllocation,
    Transaction,
    TransactionType,
)


def _month_start(year: int, month: int) -> date:
    return date(year, month, 1)


def _month_end(year: int, month: int) -> date:
    if month == 12:
        return date(year + 1, 1, 1) - date.resolution
    return date(year, month + 1, 1) - date.resolution


def recompute_monthly_rollup(
    session: Session, user_id: int, year: int, month: int
) -> None:
    start = _month_start(year, month)
    end = _month_end(year, month)

    income = int(
        session.execute(
            select(func.coalesce(func.sum(Transaction.amount_cents), 0)).where(
                Transaction.user_id == user_id,
                Transaction.deleted_at.is_(None),
                Transaction.type == TransactionType.income,
                Transaction.is_reimbursement.is_(False),
                Transaction.date.between(start, end),
            )
        ).scalar_one()
        or 0
    )

    expense_gross = int(
        session.execute(
            select(func.coalesce(func.sum(Transaction.amount_cents), 0)).where(
                Transaction.user_id == user_id,
                Transaction.deleted_at.is_(None),
                Transaction.type == TransactionType.expense,
                Transaction.date.between(start, end),
            )
        ).scalar_one()
        or 0
    )

    ExpenseTxn = aliased(Transaction)
    ReimbursementTxn = aliased(Transaction)
    reimbursed = int(
        session.execute(
            select(func.coalesce(func.sum(ReimbursementAllocation.amount_cents), 0))
            .join(
                ExpenseTxn,
                ReimbursementAllocation.expense_transaction_id == ExpenseTxn.id,
            )
            .join(
                ReimbursementTxn,
                ReimbursementAllocation.reimbursement_transaction_id
                == ReimbursementTxn.id,
            )
            .where(
                ReimbursementAllocation.user_id == user_id,
                ExpenseTxn.user_id == user_id,
                ReimbursementTxn.user_id == user_id,
                ExpenseTxn.deleted_at.is_(None),
                ExpenseTxn.type == TransactionType.expense,
                ExpenseTxn.date.between(start, end),
                ReimbursementTxn.deleted_at.is_(None),
                ReimbursementTxn.type == TransactionType.income,
                ReimbursementTxn.is_reimbursement.is_(True),
            )
        ).scalar_one()
        or 0
    )

    expenses = max(0, expense_gross - reimbursed)

    rollup = session.scalar(
        select(MonthlyRollup).where(
            MonthlyRollup.user_id == user_id,
            MonthlyRollup.year == year,
            MonthlyRollup.month == month,
        )
    )
    if income == 0 and expenses == 0:
        if rollup:
            session.delete(rollup)
        return

    if not rollup:
        rollup = MonthlyRollup(
            user_id=user_id,
            year=year,
            month=month,
            income_cents=0,
            expense_cents=0,
        )
        session.add(rollup)
        session.flush()

    rollup.income_cents = income
    rollup.expense_cents = expenses


def recompute_monthly_rollup_for_date(
    session: Session, user_id: int, txn_date: date
) -> None:
    recompute_monthly_rollup(session, user_id, txn_date.year, txn_date.month)


def rebuild_monthly_rollups(session: Session, user_id: int) -> None:
    session.execute(delete(MonthlyRollup).where(MonthlyRollup.user_id == user_id))
    session.flush()

    year = func.strftime("%Y", Transaction.date).label("year")
    month = func.strftime("%m", Transaction.date).label("month")
    keys = session.execute(
        select(year, month)
        .where(Transaction.user_id == user_id, Transaction.deleted_at.is_(None))
        .group_by(year, month)
    ).all()

    for row in keys:
        y = int(row.year)
        m = int(row.month)
        recompute_monthly_rollup(session, user_id, y, m)

    session.commit()
