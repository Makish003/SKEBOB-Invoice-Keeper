"""reminders.remind_on: overdue reminders at most once a day (FR-B10, ADR-019)

Revision ID: 0004
Revises: 0003
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0004"
down_revision: str | None = "0003"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("reminders", sa.Column("remind_on", sa.Date(), nullable=True))
    op.execute(
        "UPDATE reminders r SET remind_on = o.due_date FROM payment_occurrences o WHERE o.id = r.occurrence_id"
    )
    op.alter_column("reminders", "remind_on", nullable=False)
    op.drop_constraint("uq_reminders_occurrence_channel_kind", "reminders", type_="unique")
    op.create_unique_constraint(
        "uq_reminders_occurrence_channel_kind_day", "reminders", ["occurrence_id", "channel", "kind", "remind_on"]
    )


def downgrade() -> None:
    op.execute("DELETE FROM reminders WHERE kind = 'overdue'")
    op.drop_constraint("uq_reminders_occurrence_channel_kind_day", "reminders", type_="unique")
    op.create_unique_constraint(
        "uq_reminders_occurrence_channel_kind", "reminders", ["occurrence_id", "channel", "kind"]
    )
    op.drop_column("reminders", "remind_on")
