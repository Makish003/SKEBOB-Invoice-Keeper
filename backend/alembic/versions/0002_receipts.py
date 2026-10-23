"""receipts: link or file attached to a payment occurrence (FR-B8)

Revision ID: 0002
Revises: 0001
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0002"
down_revision: str | None = "0001"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("payment_occurrences", sa.Column("receipt_url", sa.String(length=1000), nullable=True))
    op.add_column("payment_occurrences", sa.Column("receipt_file_name", sa.String(length=255), nullable=True))
    op.add_column("payment_occurrences", sa.Column("receipt_file_key", sa.String(length=64), nullable=True))
    op.add_column("payment_occurrences", sa.Column("receipt_content_type", sa.String(length=64), nullable=True))


def downgrade() -> None:
    for column in ("receipt_content_type", "receipt_file_key", "receipt_file_name", "receipt_url"):
        op.drop_column("payment_occurrences", column)
