from datetime import date, datetime, timedelta

import pytest
from sqlalchemy import create_engine, select
from sqlalchemy.orm import Session

from expenses.db.models import (
    AutoCategorizationPreference,
    Category,
    RuleMatchType,
    Transaction,
    TransactionClassificationEvent,
    TransactionType,
    User,
)
from expenses.db.session import Base
from expenses.schemas import CategoryIn, IngestTransactionIn, RuleIn, TransactionIn
from expenses.services import (
    CategoryService,
    IngestService,
    RuleService,
    TransactionService,
)
from expenses.services import auto_categorization as categorization
from expenses.services.category_model import Example, load_model, train


@pytest.fixture
def history(tmp_path):
    engine = create_engine(f"sqlite:///{tmp_path / 'categories.db'}")
    Base.metadata.create_all(engine)
    with Session(engine) as session:
        session.add_all(
            [User(id=i, username=f"user{i}", password_hash="unused") for i in (1, 2)]
        )
        session.commit()
        categories = CategoryService(session, user_id=1)
        bakery = categories.create(
            CategoryIn(name="Bakery", type=TransactionType.expense)
        )
        transit = categories.create(
            CategoryIn(name="Transit", type=TransactionType.expense)
        )
        categories.get_or_create_uncategorized(TransactionType.expense)
        for index in range(90):
            when = datetime(2026, 1, 1) + timedelta(days=index)
            session.add(
                Transaction(
                    user_id=1,
                    date=when.date(),
                    occurred_at=when,
                    title="Corner bakery" if index % 2 else "City metro",
                    amount_cents=500 if index % 2 else 340,
                    type=TransactionType.expense,
                    category_id=bakery.id if index % 2 else transit.id,
                )
            )
        session.add(AutoCategorizationPreference(user_id=1, enabled=True))
        session.commit()
        yield session, bakery.id, transit.id
    engine.dispose()
    load_model.cache_clear()


def expense(category_id=None, title="Corner bakery", amount_cents=500):
    return TransactionIn(
        date=date(2026, 10, 11),
        occurred_at=datetime(2026, 10, 11, 12),
        type=TransactionType.expense,
        category_id=category_id,
        title=title,
        amount_cents=amount_cents,
        tags=[],
    )


def test_trains_persists_and_categorizes_without_changing_history(history):
    session, bakery, _ = history
    categorization.train_user(session.get_bind(), 1)
    session.expire_all()
    settings = categorization.settings_for(session, 1)
    assert settings.training_status == "ready"
    assert settings.threshold == 0.8
    load_model.cache_clear()  # A restart can load the saved model without fitting.
    txn = TransactionService(session, 1).create(expense())
    assert txn.category_id == bakery
    assert txn.auto_category_confidence >= 0.8
    event = session.scalar(
        select(TransactionClassificationEvent).where(
            TransactionClassificationEvent.transaction_id == txn.id
        )
    )
    assert event.source == "auto_category"
    assert len(categorization.training_rows(session, 1)) == 90
    assert all(
        row.auto_category_confidence is None
        for row in session.scalars(select(Transaction).where(Transaction.id < txn.id))
    )


def test_manual_categories_rules_and_threshold_take_priority(history):
    session, bakery, transit = history
    categorization.train_user(session.get_bind(), 1)
    service = TransactionService(session, 1)
    manual = service.create(expense(transit))
    assert manual.category_id == transit
    assert manual.auto_category_confidence is None
    rule_service = RuleService(session, 1)
    rule = rule_service.create(
        RuleIn(
            name="Bakery rule",
            match_type=RuleMatchType.contains,
            match_value="bakery",
            set_category_id=transit,
        )
    )
    ruled = service.create(expense())
    assert ruled.category_id == transit
    assert ruled.auto_category_confidence is None
    rule_service.delete(rule.id)
    uncategorized = CategoryService(session, 1).get_or_create_uncategorized(
        TransactionType.expense
    )
    rule = rule_service.create(
        RuleIn(
            name="Leave bakery for review",
            match_type=RuleMatchType.contains,
            match_value="bakery",
            set_category_id=uncategorized.id,
        )
    )
    assert service.create(expense()).category_id == uncategorized.id
    rule_service.delete(rule.id)
    rule_service.create(
        RuleIn(
            name="Tag only",
            match_type=RuleMatchType.contains,
            match_value="bakery",
            add_tags=["Lunch"],
        )
    )
    tagged = service.create(expense())
    assert tagged.category_id == bakery
    assert [tag.name for tag in tagged.tags] == ["Lunch"]
    preference = session.get(AutoCategorizationPreference, 1)
    preference.threshold = 1.0
    session.commit()
    # A mixed neighbor query has confidence strictly below 1.
    uncertain = service.create(
        expense(title="Corner bakery City metro", amount_cents=410)
    )
    assert uncertain.category.name == "Uncategorized"
    assert uncertain.auto_category_confidence is None


@pytest.mark.parametrize(
    ("title", "category", "expected_category", "resolution"),
    [
        ("Corner bakery", None, "Bakery", "auto_category"),
        ("Corner bakery", "Uncategorized", "Bakery", "auto_category"),
        ("Corner bakery", "Transit", "Transit", "exact"),
        ("zzzzzzzz", None, "Uncategorized", "uncategorized"),
    ],
)
def test_ingest_distinguishes_automatic_category_resolution(
    history, title, category, expected_category, resolution
):
    session, _, _ = history
    categorization.train_user(session.get_bind(), 1)
    txn = (
        IngestService(session, 1)
        .ingest_expense(
            IngestTransactionIn(amount_cents=500, title=title, category=category)
        )
        .transaction
    )
    assert txn.category.name == expected_category
    assert txn._ingest_log_fields["category_resolution"] == resolution
    assert (txn.auto_category_confidence is not None) == (resolution == "auto_category")


def test_corrections_stick_and_unrelated_edits_do_not_confirm_predictions(history):
    session, bakery, transit = history
    categorization.train_user(session.get_bind(), 1)
    service = TransactionService(session, 1)
    txn = service.create(expense())
    assert len(categorization.training_rows(session, 1)) == 90
    service.update(txn.id, expense(bakery, "Corner bakery lunch"))
    assert txn.auto_category_confidence is not None
    assert len(categorization.training_rows(session, 1)) == 90
    service.update(txn.id, expense(transit))
    assert txn.category_id == transit
    assert txn.auto_category_confidence is None
    assert len(categorization.training_rows(session, 1)) == 91
    service.update(txn.id, expense())
    assert txn.category.name == "Uncategorized"
    assert txn.auto_category_confidence is None


def test_unknown_titles_disabled_users_and_unusable_categories_abstain(history):
    session, bakery, _ = history
    categorization.train_user(session.get_bind(), 1)
    service = TransactionService(session, 1)
    assert service.create(expense(title="zzzzzzzz")).category.name == "Uncategorized"
    assert (
        TransactionService(session, 2).create(expense()).category.name
        == "Uncategorized"
    )
    assert categorization.training_rows(session, 2) == []
    preference = session.get(AutoCategorizationPreference, 1)
    preference.enabled = False
    session.commit()
    assert service.create(expense()).category.name == "Uncategorized"
    preference.enabled = True
    session.get(Category, bakery).archived_at = datetime.utcnow()
    session.commit()
    assert service.create(expense()).category.name == "Uncategorized"
    session.get(Category, bakery).archived_at = None
    preference.model_json = "broken model"
    session.commit()
    assert service.create(expense()).category.name == "Uncategorized"


def test_weekly_retraining_only_when_due_enabled_and_history_changed(history):
    session, bakery, _ = history
    categorization.train_due_users(session.get_bind())
    session.expire_all()
    preference = session.get(AutoCategorizationPreference, 1)
    trained_at = preference.trained_at
    fingerprint = preference.training_fingerprint
    TransactionService(session, 1).create(expense(bakery))
    categorization.train_due_users(session.get_bind())
    session.expire_all()
    assert preference.trained_at == trained_at
    preference.checked_at = datetime.utcnow() - timedelta(days=8)
    preference.enabled = False
    session.commit()
    categorization.train_due_users(session.get_bind())
    session.expire_all()
    assert preference.trained_at == trained_at
    preference.enabled = True
    session.commit()
    categorization.train_due_users(session.get_bind())
    session.expire_all()
    assert preference.training_fingerprint != fingerprint
    assert preference.trained_at > trained_at
    trained_at = preference.trained_at
    preference.checked_at = datetime.utcnow() - timedelta(days=8)
    session.commit()
    categorization.train_due_users(session.get_bind())
    session.expire_all()
    assert preference.trained_at == trained_at
    assert preference.checked_at > trained_at


def test_failed_retraining_keeps_old_model_and_interrupted_job_recovers(
    history, monkeypatch
):
    session, bakery, _ = history
    categorization.train_user(session.get_bind(), 1)
    session.expire_all()
    preference = session.get(AutoCategorizationPreference, 1)
    artifact = preference.model_json
    TransactionService(session, 1).create(expense(bakery))
    with monkeypatch.context() as patch:

        def fail(_rows):
            raise RuntimeError("Training failed")

        patch.setattr(categorization, "train", fail)
        categorization.train_user(session.get_bind(), 1)
    session.expire_all()
    assert preference.training_status == "failed"
    assert preference.model_json == artifact
    assert TransactionService(session, 1).create(expense()).category_id == bakery
    preference.training_status = "training"  # Saved before a process restart.
    session.commit()
    categorization.train_due_users(session.get_bind())
    session.expire_all()
    assert preference.training_status == "ready"
    assert preference.model_json != artifact


def test_calibration_uses_later_examples_and_optional_location():
    rows = [
        Example("Bakery" if i % 2 else "Metro", 500, None, None, i % 2 + 1)
        for i in range(90)
    ]
    assert train(rows[:59]) is None
    model = train(rows)
    assert model is not None
    prediction = model.predict(Example("Bakery", 500, 52.5, 13.4, 0))
    assert prediction.category_id == 2
    assert prediction.eligible
    assert 0.8 <= prediction.confidence <= 1
    # Conflicting later labels must reduce confidence, not calibrate on the
    # final model's self-matches (which would hide those mistakes).
    noisy = rows[:60] + [
        Example(row.title, 500, None, None, 3 - row.category_id) for row in rows[60:]
    ]
    noisy_model = train(noisy)
    assert noisy_model is not None
    assert noisy_model.temperature > model.temperature


def test_settings_enable_trains_in_background_and_is_user_scoped(
    api_client, csrf_headers
):
    original = api_client.get("/api/settings").json()["auto_categorization"]
    assert original == {
        "enabled": False,
        "threshold": 0.8,
        "training_status": "untrained",
        "trained_at": None,
    }
    assert (
        api_client.put(
            "/api/settings/auto-categorization", json={"enabled": True}
        ).status_code
        == 400
    )
    assert (
        api_client.put(
            "/api/settings/auto-categorization",
            headers=csrf_headers,
            json={"enabled": True, "threshold": 1.1},
        ).status_code
        == 422
    )
    response = api_client.put(
        "/api/settings/auto-categorization",
        headers=csrf_headers,
        json={"enabled": True, "threshold": 0.8},
    )
    assert response.status_code == 200
    assert response.json()["training_status"] == "training"
    assert (
        api_client.get("/api/settings").json()["auto_categorization"]["training_status"]
        == "insufficient_data"
    )
    response = api_client.put(
        "/api/settings/auto-categorization",
        headers=csrf_headers,
        json={"enabled": False, "threshold": 0.9},
    )
    assert response.json()["threshold"] == 0.9
    api_client.post("/api/auth/logout", headers=csrf_headers)
    response = api_client.post(
        "/api/auth/signup", json={"username": "second", "password": "pw-12345"}
    )
    assert response.status_code == 200
    response = api_client.post(
        "/api/auth/login", json={"username": "second", "password": "pw-12345"}
    )
    assert response.status_code == 200
    assert api_client.get("/api/settings").json()["auto_categorization"] == original
