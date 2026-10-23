"""budgets: planned spending per year/month and currency (FR-B9)

Revision ID: 0003
Revises: 0002
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0003"
down_revision: str | None = "0002"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    currency = postgresql.ENUM("RUB", "USD", "EUR", name="currency", create_type=False)
    op.create_table(
        "budgets",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("year", sa.SmallInteger(), nullable=False),
        sa.Column("month", sa.SmallInteger(), nullable=True),
        sa.Column("currency", currency, nullable=False),
        sa.Column("amount", sa.Numeric(precision=14, scale=2), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.CheckConstraint("amount > 0", name=op.f("ck_budgets_amount_positive")),
        sa.CheckConstraint("month IS NULL OR month BETWEEN 1 AND 12", name=op.f("ck_budgets_month_range")),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_budgets")),
    )
    op.create_index(
        "uq_budgets_year_month_currency",
        "budgets",
        ["year", sa.text("coalesce(month, 0)"), "currency"],
        unique=True,
    )


def downgrade() -> None:
    op.drop_index("uq_budgets_year_month_currency", table_name="budgets")
    op.drop_table("budgets")
