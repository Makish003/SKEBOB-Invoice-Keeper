"""Разбор настроек окружения."""

import pytest

from app.core.config import Settings


@pytest.mark.parametrize(
    ("raw", "ids"),
    [
        ("", ()),
        ("-100777", ("-100777",)),
        ("652749973, 1042611273, -5268841572", ("652749973", "1042611273", "-5268841572")),
        (" 1 ;2  3,, ", ("1", "2", "3")),
        ("1, 1", ("1",)),
    ],
)
def test_telegram_chat_id_accepts_a_list(raw: str, ids: tuple[str, ...]) -> None:
    assert Settings(telegram_chat_id=raw).telegram_chat_ids == ids
