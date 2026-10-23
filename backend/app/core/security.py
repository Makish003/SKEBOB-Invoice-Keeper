"""Пароли (argon2) и токены сессий (в БД хранится только sha256 токена)."""

import hashlib
import hmac
import secrets

from argon2 import PasswordHasher
from argon2.exceptions import InvalidHashError, VerificationError

_hasher = PasswordHasher()


def hash_password(password: str) -> str:
    return _hasher.hash(password)


def verify_password(password_hash: str, password: str) -> bool:
    try:
        return _hasher.verify(password_hash, password)
    except (VerificationError, InvalidHashError):
        return False


def new_session_token() -> str:
    return secrets.token_urlsafe(32)


def hash_token(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def sign(secret: str, message: str, length: int = 16) -> str:
    """Короткая HMAC-подпись (для callback-данных Telegram)."""
    return hmac.new(secret.encode(), message.encode(), hashlib.sha256).hexdigest()[:length]


def verify_signature(secret: str, message: str, signature: str, length: int = 16) -> bool:
    return hmac.compare_digest(sign(secret, message, length), signature)
