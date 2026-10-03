"""Encrypted, per-user credentials on the user's self-hosted runtime.

Tokens never enter browser storage or the application database. The encryption
key can be mounted separately from the data volume. File locks serialize rotating
refresh tokens across workers, including disconnect and reconnect operations.
"""

from __future__ import annotations

import asyncio
from contextlib import asynccontextmanager
import fcntl
import json
import os
from pathlib import Path
import tempfile
import time
from uuid import uuid4

from cryptography.fernet import Fernet, InvalidToken

from expenses.ai.client import LLMDisabledError
from expenses.core.config import get_settings


def _private_dir() -> Path:
    path = get_settings().data_dir / "secrets" / "chatgpt"
    path.mkdir(parents=True, exist_ok=True, mode=0o700)
    path.chmod(0o700)
    return path


def _create_once(path: Path, value: bytes) -> bytes:
    path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    if path.exists():
        return path.read_bytes().strip()
    fd, temporary = tempfile.mkstemp(dir=path.parent, prefix=".secret-")
    try:
        with os.fdopen(fd, "wb") as file:
            file.write(value)
            file.flush()
            os.fsync(file.fileno())
        try:
            os.link(temporary, path)
        except FileExistsError:
            return path.read_bytes().strip()
        return value
    finally:
        Path(temporary).unlink(missing_ok=True)


def _cipher() -> Fernet:
    configured = os.getenv("EXPENSES_AI_CREDENTIAL_KEY_FILE")
    path = Path(configured) if configured else _private_dir() / "encryption.key"
    key = (
        path.read_bytes().strip()
        if configured
        else _create_once(path, Fernet.generate_key())
    )
    return Fernet(key)


def encrypt(value: dict) -> str:
    return _cipher().encrypt(json.dumps(value).encode()).decode()


def decrypt(value: str) -> dict:
    try:
        return json.loads(_cipher().decrypt(value.encode()))
    except (InvalidToken, ValueError, OSError) as exc:
        raise LLMDisabledError(
            "ChatGPT credentials could not be unlocked. Check the server credential key."
        ) from exc


def host_id() -> str:
    return _create_once(
        _private_dir() / "host-id", f"urn:uuid:{uuid4()}".encode()
    ).decode()


def load(user_id: int) -> dict | None:
    path = _private_dir() / f"{int(user_id)}.enc"
    return decrypt(path.read_text()) if path.exists() else None


def save(user_id: int, value: dict) -> None:
    encrypted = encrypt(value)
    directory = _private_dir()
    fd, temporary = tempfile.mkstemp(dir=directory, prefix=".credentials-")
    try:
        with os.fdopen(fd, "w") as file:
            file.write(encrypted)
            file.flush()
            os.fsync(file.fileno())
        os.replace(temporary, directory / f"{int(user_id)}.enc")
    finally:
        Path(temporary).unlink(missing_ok=True)


@asynccontextmanager
async def locked(user_id: int):
    fd = os.open(_private_dir() / f"{int(user_id)}.lock", os.O_CREAT | os.O_RDWR, 0o600)
    deadline = time.monotonic() + 45
    try:
        while True:
            try:
                fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
                break
            except BlockingIOError:
                if time.monotonic() >= deadline:
                    raise LLMDisabledError(
                        "ChatGPT connection is busy. Try again shortly."
                    )
                await asyncio.sleep(0.05)
        yield
    finally:
        os.close(fd)
