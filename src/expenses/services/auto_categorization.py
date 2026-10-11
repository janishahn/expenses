"""Per-user local models, background training and create-only categorization."""

import hashlib
import json
import logging
from dataclasses import asdict
from datetime import datetime, timedelta
from threading import Lock

from sqlalchemy import func, select
from sqlalchemy.engine import Connection, Engine
from sqlalchemy.orm import Session

from expenses.db.models import (
    AutoCategorizationPreference,
    Category,
    Transaction,
    TransactionType,
)
from expenses.schemas import AutoCategorizationSettingsOut
from expenses.services.category_model import MAX_HISTORY, Example, load_model, train

logger = logging.getLogger(__name__)
_training_lock = Lock()


def settings_for(session: Session, user_id: int) -> AutoCategorizationSettingsOut:
    preference = session.get(AutoCategorizationPreference, user_id)
    if preference is None:
        return AutoCategorizationSettingsOut()
    return AutoCategorizationSettingsOut.model_validate(
        preference, from_attributes=True
    )


def training_rows(session: Session, user_id: int) -> list[Example]:
    rows = session.execute(
        select(
            Transaction.title,
            Transaction.amount_cents,
            Transaction.latitude,
            Transaction.longitude,
            Transaction.category_id,
        )
        .join(Category, Transaction.category_id == Category.id)
        .where(
            Transaction.user_id == user_id,
            Category.user_id == user_id,
            Transaction.type == TransactionType.expense,
            Category.type == TransactionType.expense,
            Transaction.deleted_at.is_(None),
            Transaction.origin_rule_id.is_(None),
            Transaction.auto_category_confidence.is_(None),
            Category.archived_at.is_(None),
            func.lower(Category.name) != "uncategorized",
            func.length(func.trim(Transaction.title)) > 0,
        )
        .order_by(Transaction.created_at.desc(), Transaction.id.desc())
        .limit(MAX_HISTORY)
    ).all()
    return [
        Example(
            title=row.title,
            amount_cents=row.amount_cents,
            latitude=float(row.latitude) if row.latitude is not None else None,
            longitude=float(row.longitude) if row.longitude is not None else None,
            category_id=row.category_id,
        )
        for row in reversed(rows)
    ]


def train_user(bind: Engine | Connection, user_id: int) -> None:
    # Serialize fits so simultaneous enables cannot multiply peak RAM on the Pi.
    with _training_lock:
        try:
            with Session(bind) as session:
                preference = session.get(AutoCategorizationPreference, user_id)
                if preference is None or not preference.enabled:
                    return
                rows = training_rows(session, user_id)
                fingerprint = hashlib.sha256(
                    json.dumps([asdict(row) for row in rows], sort_keys=True).encode()
                ).hexdigest()
                if fingerprint == preference.training_fingerprint:
                    preference.checked_at = datetime.utcnow()
                    preference.training_status = (
                        "ready" if preference.trained_at else "insufficient_data"
                    )
                    session.commit()
                    return
                preference.training_status = "training"
                session.commit()

            model = train(rows)
            with Session(bind) as session:
                preference = session.get(AutoCategorizationPreference, user_id)
                if preference is None:
                    return
                preference.checked_at = datetime.utcnow()
                if model is None:
                    preference.training_status = "insufficient_data"
                else:
                    preference.training_fingerprint = fingerprint
                    # Commit the artifact and timestamp together; readers continue
                    # using the previous model until this transaction succeeds.
                    preference.model_json = model.model_dump_json()
                    preference.trained_at = datetime.utcnow()
                    preference.training_status = "ready"
                session.commit()
        except Exception:
            logger.exception("Local category training failed for user %s", user_id)
            with Session(bind) as session:
                preference = session.get(AutoCategorizationPreference, user_id)
                if preference is not None:
                    preference.training_status = "failed"
                    preference.checked_at = datetime.utcnow()
                    session.commit()


def train_due_users(bind: Engine | Connection) -> None:
    with Session(bind) as session:
        due = datetime.utcnow() - timedelta(days=7)
        user_ids = session.scalars(
            select(AutoCategorizationPreference.user_id).where(
                AutoCategorizationPreference.enabled.is_(True),
                (AutoCategorizationPreference.checked_at.is_(None))
                | (AutoCategorizationPreference.checked_at <= due)
                | (AutoCategorizationPreference.training_status == "training"),
            )
        ).all()
    for user_id in user_ids:
        train_user(bind, user_id)


def apply_prediction(session: Session, txn: Transaction) -> bool:
    if (
        txn.type != TransactionType.expense
        or txn.origin_rule_id
        or not (txn.title or "").strip()
    ):
        return False
    # RuleService can change category_id without refreshing the relationship.
    category = session.get(Category, txn.category_id)
    if category is None or category.name.lower() != "uncategorized":
        return False
    preference = session.get(AutoCategorizationPreference, txn.user_id)
    if preference is None or not preference.enabled or not preference.model_json:
        return False
    try:
        prediction = load_model(preference.model_json).predict(
            Example(
                title=txn.title,
                amount_cents=txn.amount_cents,
                latitude=float(txn.latitude) if txn.latitude is not None else None,
                longitude=float(txn.longitude) if txn.longitude is not None else None,
                category_id=txn.category_id,
            )
        )
    except (ValueError, ArithmeticError, IndexError, KeyError):
        logger.exception("Local category prediction failed for user %s", txn.user_id)
        return False
    if not prediction.eligible or prediction.confidence < preference.threshold:
        return False
    predicted = session.get(Category, prediction.category_id)
    if (
        predicted is None
        or predicted.user_id != txn.user_id
        or predicted.type != txn.type
        or predicted.archived_at is not None
        or predicted.name.lower() == "uncategorized"
    ):
        return False
    txn.category = predicted
    txn.auto_category_confidence = prediction.confidence
    return True
