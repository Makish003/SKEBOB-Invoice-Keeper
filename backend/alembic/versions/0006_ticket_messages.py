"""ticket_messages: every support ticket is a chat; admin_reply moves into the thread (ADR-030)

Revision ID: 0006
Revises: 0005
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0006"
down_revision: str | None = "0005"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_TIMESTAMPS = ("last_message_at", "last_author_message_at", "author_read_at")


def upgrade() -> None:
    op.create_table(
        "ticket_messages",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("ticket_id", sa.Integer(), nullable=False),
        sa.Column("author_id", sa.Integer(), nullable=False),
        sa.Column("body", sa.Text(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(
            ["ticket_id"],
            ["support_tickets.id"],
            name=op.f("fk_ticket_messages_ticket_id_support_tickets"),
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["author_id"], ["users.id"], name=op.f("fk_ticket_messages_author_id_users"), ondelete="CASCADE"
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_ticket_messages")),
    )
    op.create_index(op.f("ix_ticket_messages_ticket_id"), "ticket_messages", ["ticket_id"])

    op.add_column("ticket_attachments", sa.Column("message_id", sa.Integer(), nullable=True))
    op.create_foreign_key(
        op.f("fk_ticket_attachments_message_id_ticket_messages"),
        "ticket_attachments",
        "ticket_messages",
        ["message_id"],
        ["id"],
        ondelete="CASCADE",
    )
    op.create_index(op.f("ix_ticket_attachments_message_id"), "ticket_attachments", ["message_id"])

    for column in _TIMESTAMPS:
        op.add_column("support_tickets", sa.Column(column, sa.DateTime(timezone=True), nullable=True))
    op.add_column("support_tickets", sa.Column("last_admin_message_at", sa.DateTime(timezone=True), nullable=True))
    op.add_column("support_tickets", sa.Column("admin_read_at", sa.DateTime(timezone=True), nullable=True))
    op.execute(
        "UPDATE support_tickets SET last_message_at = created_at, last_author_message_at = created_at, "
        "author_read_at = created_at"
    )
    # Ответ администратора становится сообщением в чате от имени администратора из .env (кто ответил, не хранилось).
    op.execute(
        """
        WITH admin AS (SELECT id FROM users WHERE role = 'admin' ORDER BY is_system DESC, id LIMIT 1)
        INSERT INTO ticket_messages (ticket_id, author_id, body, created_at)
        SELECT t.id, admin.id, t.admin_reply, t.updated_at FROM support_tickets t, admin WHERE t.admin_reply IS NOT NULL
        """
    )
    op.execute(
        "UPDATE support_tickets SET last_admin_message_at = updated_at, last_message_at = updated_at "
        "WHERE admin_reply IS NOT NULL"
    )
    for column in _TIMESTAMPS:
        op.alter_column("support_tickets", column, nullable=False, server_default=sa.text("now()"))
    op.create_index("ix_support_tickets_last_message_at", "support_tickets", ["last_message_at"])
    op.drop_column("support_tickets", "admin_reply")


def downgrade() -> None:
    op.add_column("support_tickets", sa.Column("admin_reply", sa.Text(), nullable=True))
    op.execute(
        """
        UPDATE support_tickets t SET admin_reply = m.body FROM (
            SELECT DISTINCT ON (ticket_id) ticket_id, body FROM ticket_messages
            WHERE author_id <> (SELECT author_id FROM support_tickets s WHERE s.id = ticket_messages.ticket_id)
            ORDER BY ticket_id, id DESC
        ) m WHERE m.ticket_id = t.id
        """
    )
    op.drop_index("ix_support_tickets_last_message_at", table_name="support_tickets")
    for column in (*_TIMESTAMPS, "last_admin_message_at", "admin_read_at"):
        op.drop_column("support_tickets", column)
    op.execute("DELETE FROM ticket_attachments WHERE message_id IS NOT NULL")
    op.drop_index(op.f("ix_ticket_attachments_message_id"), table_name="ticket_attachments")
    op.drop_constraint(
        op.f("fk_ticket_attachments_message_id_ticket_messages"), "ticket_attachments", type_="foreignkey"
    )
    op.drop_column("ticket_attachments", "message_id")
    op.drop_table("ticket_messages")
