"""support_tickets: user requests to the admin with files and payment periods (ADR-029)

Revision ID: 0005
Revises: 0004
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0005"
down_revision: str | None = "0004"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "support_tickets",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("author_id", sa.Integer(), nullable=False),
        sa.Column(
            "topic", sa.Enum("question", "bug", "payment", "access", "other", name="ticket_topic"), nullable=False
        ),
        sa.Column("description", sa.Text(), nullable=False),
        sa.Column(
            "status",
            sa.Enum("open", "in_progress", "resolved", name="ticket_status"),
            server_default="open",
            nullable=False,
        ),
        sa.Column("admin_reply", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(
            ["author_id"], ["users.id"], name=op.f("fk_support_tickets_author_id_users"), ondelete="CASCADE"
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_support_tickets")),
    )
    op.create_index(op.f("ix_support_tickets_author_id"), "support_tickets", ["author_id"])
    op.create_index("ix_support_tickets_status_created_at", "support_tickets", ["status", "created_at"])

    op.create_table(
        "ticket_attachments",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("ticket_id", sa.Integer(), nullable=False),
        sa.Column("file_name", sa.String(length=255), nullable=False),
        sa.Column("file_key", sa.String(length=64), nullable=False),
        sa.Column("content_type", sa.String(length=64), nullable=False),
        sa.Column("size", sa.Integer(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(
            ["ticket_id"],
            ["support_tickets.id"],
            name=op.f("fk_ticket_attachments_ticket_id_support_tickets"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_ticket_attachments")),
    )
    op.create_index(op.f("ix_ticket_attachments_ticket_id"), "ticket_attachments", ["ticket_id"])

    op.create_table(
        "support_ticket_payments",
        sa.Column("ticket_id", sa.Integer(), nullable=False),
        sa.Column("occurrence_id", sa.Integer(), nullable=False),
        sa.ForeignKeyConstraint(
            ["ticket_id"],
            ["support_tickets.id"],
            name=op.f("fk_support_ticket_payments_ticket_id_support_tickets"),
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["occurrence_id"],
            ["payment_occurrences.id"],
            name=op.f("fk_support_ticket_payments_occurrence_id_payment_occurrences"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("ticket_id", "occurrence_id", name=op.f("pk_support_ticket_payments")),
    )


def downgrade() -> None:
    op.drop_table("support_ticket_payments")
    op.drop_table("ticket_attachments")
    op.drop_table("support_tickets")
    for enum_name in ("ticket_status", "ticket_topic"):
        sa.Enum(name=enum_name).drop(op.get_bind(), checkfirst=True)
