from dataclasses import dataclass
from datetime import datetime

from sqlalchemy import select
from sqlalchemy.orm import Session

from expenses.auth.security import generate_ingest_token, hash_ingest_token
from expenses.db.models import UserIngestToken


@dataclass(frozen=True)
class IssuedUserIngestToken:
    raw_token: str
    ingest_token: UserIngestToken


def issue_user_ingest_token(db: Session, user_id: int) -> IssuedUserIngestToken:
    raw_token = generate_ingest_token()
    token_hash = hash_ingest_token(raw_token)
    token_hint = raw_token[-6:]
    ingest_token = db.scalars(
        select(UserIngestToken).where(UserIngestToken.user_id == user_id)
    ).first()
    if ingest_token is None:
        ingest_token = UserIngestToken(
            user_id=user_id,
            token_hash=token_hash,
            token_hint=token_hint,
        )
        db.add(ingest_token)
    else:
        ingest_token.token_hash = token_hash
        ingest_token.token_hint = token_hint
        ingest_token.last_used_at = None
        db.add(ingest_token)
    db.flush()
    return IssuedUserIngestToken(raw_token=raw_token, ingest_token=ingest_token)


def get_user_ingest_token(db: Session, user_id: int) -> UserIngestToken | None:
    return db.scalars(
        select(UserIngestToken).where(UserIngestToken.user_id == user_id)
    ).first()


def lookup_user_ingest_token(db: Session, raw_token: str) -> UserIngestToken | None:
    if not raw_token:
        return None
    token_hash = hash_ingest_token(raw_token)
    return db.scalars(
        select(UserIngestToken).where(UserIngestToken.token_hash == token_hash)
    ).first()


def revoke_user_ingest_token(db: Session, user_id: int) -> bool:
    ingest_token = get_user_ingest_token(db, user_id)
    if ingest_token is None:
        return False
    db.delete(ingest_token)
    return True


def touch_user_ingest_token(
    ingest_token: UserIngestToken, now: datetime | None = None
) -> None:
    ingest_token.last_used_at = now or datetime.utcnow()
