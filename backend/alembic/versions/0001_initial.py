"""initial schema: users, sessions, recurring payments, occurrences, reminders, audit log

Revision ID: 0001
Revises: 
Create Date: 2026-10-23 19:50:01.211274
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = '0001'
down_revision: str | None = None
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table('users',
    sa.Column('id', sa.Integer(), nullable=False),
    sa.Column('login', sa.String(length=64), nullable=False),
    sa.Column('password_hash', sa.String(length=255), nullable=False),
    sa.Column('display_name', sa.String(length=120), nullable=False),
    sa.Column('role', sa.Enum('admin', 'user', name='user_role'), nullable=False),
    sa.Column('is_system', sa.Boolean(), server_default=sa.text('false'), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.Column('deleted_at', sa.DateTime(timezone=True), nullable=True),
    sa.PrimaryKeyConstraint('id', name=op.f('pk_users'))
    )
    op.create_index('uq_users_login_active', 'users', ['login'], unique=True, postgresql_where=sa.text('deleted_at IS NULL'))
    op.create_table('audit_log',
    sa.Column('id', sa.BigInteger(), nullable=False),
    sa.Column('at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.Column('actor_user_id', sa.Integer(), nullable=True),
    sa.Column('actor_label', sa.String(length=200), nullable=True),
    sa.Column('action', sa.String(length=64), nullable=False),
    sa.Column('entity', sa.String(length=64), nullable=True),
    sa.Column('entity_id', sa.BigInteger(), nullable=True),
    sa.Column('payload', postgresql.JSONB(astext_type=sa.Text()), nullable=True),
    sa.Column('ip', sa.String(length=64), nullable=True),
    sa.ForeignKeyConstraint(['actor_user_id'], ['users.id'], name=op.f('fk_audit_log_actor_user_id_users'), ondelete='SET NULL'),
    sa.PrimaryKeyConstraint('id', name=op.f('pk_audit_log'))
    )
    op.create_index('ix_audit_log_at', 'audit_log', ['at'], unique=False)
    op.create_table('recurring_payments',
    sa.Column('id', sa.Integer(), nullable=False),
    sa.Column('name', sa.String(length=200), nullable=False),
    sa.Column('amount', sa.Numeric(precision=14, scale=2), nullable=False),
    sa.Column('currency', sa.Enum('RUB', 'USD', 'EUR', name='currency'), nullable=False),
    sa.Column('period', sa.Enum('monthly', 'weekly', 'quarterly', 'yearly', name='payment_period'), server_default='monthly', nullable=False),
    sa.Column('first_due_date', sa.Date(), nullable=False),
    sa.Column('anchor_day', sa.SmallInteger(), nullable=False),
    sa.Column('description', sa.Text(), nullable=True),
    sa.Column('created_by', sa.Integer(), nullable=True),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.Column('deleted_at', sa.DateTime(timezone=True), nullable=True),
    sa.Column('deleted_by', sa.Integer(), nullable=True),
    sa.CheckConstraint('amount > 0', name=op.f('ck_recurring_payments_amount_positive')),
    sa.CheckConstraint('anchor_day BETWEEN 1 AND 31', name=op.f('ck_recurring_payments_anchor_day_range')),
    sa.ForeignKeyConstraint(['created_by'], ['users.id'], name=op.f('fk_recurring_payments_created_by_users'), ondelete='SET NULL'),
    sa.ForeignKeyConstraint(['deleted_by'], ['users.id'], name=op.f('fk_recurring_payments_deleted_by_users'), ondelete='SET NULL'),
    sa.PrimaryKeyConstraint('id', name=op.f('pk_recurring_payments'))
    )
    op.create_table('sessions',
    sa.Column('id', sa.Integer(), nullable=False),
    sa.Column('user_id', sa.Integer(), nullable=False),
    sa.Column('token_hash', sa.String(length=64), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.Column('expires_at', sa.DateTime(timezone=True), nullable=False),
    sa.Column('revoked_at', sa.DateTime(timezone=True), nullable=True),
    sa.Column('user_agent', sa.String(length=400), nullable=True),
    sa.Column('ip', sa.String(length=64), nullable=True),
    sa.ForeignKeyConstraint(['user_id'], ['users.id'], name=op.f('fk_sessions_user_id_users'), ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id', name=op.f('pk_sessions')),
    sa.UniqueConstraint('token_hash', name=op.f('uq_sessions_token_hash'))
    )
    op.create_index(op.f('ix_sessions_user_id'), 'sessions', ['user_id'], unique=False)
    op.create_table('payment_occurrences',
    sa.Column('id', sa.Integer(), nullable=False),
    sa.Column('recurring_payment_id', sa.Integer(), nullable=False),
    sa.Column('seq', sa.Integer(), nullable=False),
    sa.Column('due_date', sa.Date(), nullable=False),
    sa.Column('amount', sa.Numeric(precision=14, scale=2), nullable=False),
    sa.Column('currency', sa.Enum('RUB', 'USD', 'EUR', name='currency'), nullable=False),
    sa.Column('status', sa.Enum('unpaid', 'paid', name='occurrence_status'), server_default='unpaid', nullable=False),
    sa.Column('paid_at', sa.Date(), nullable=True),
    sa.Column('paid_by_user_id', sa.Integer(), nullable=True),
    sa.Column('paid_by_label', sa.String(length=200), nullable=True),
    sa.Column('note', sa.Text(), nullable=True),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.CheckConstraint("(status = 'paid') = (paid_at IS NOT NULL)", name=op.f('ck_payment_occurrences_paid_at_matches_status')),
    sa.CheckConstraint('amount > 0', name=op.f('ck_payment_occurrences_amount_positive')),
    sa.ForeignKeyConstraint(['paid_by_user_id'], ['users.id'], name=op.f('fk_payment_occurrences_paid_by_user_id_users'), ondelete='SET NULL'),
    sa.ForeignKeyConstraint(['recurring_payment_id'], ['recurring_payments.id'], name=op.f('fk_payment_occurrences_recurring_payment_id_recurring_payments'), ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id', name=op.f('pk_payment_occurrences')),
    sa.UniqueConstraint('recurring_payment_id', 'due_date', name='uq_payment_occurrences_payment_due_date'),
    sa.UniqueConstraint('recurring_payment_id', 'seq', name='uq_payment_occurrences_payment_seq')
    )
    op.create_index('ix_payment_occurrences_due_date', 'payment_occurrences', ['due_date'], unique=False)
    op.create_table('reminders',
    sa.Column('id', sa.Integer(), nullable=False),
    sa.Column('occurrence_id', sa.Integer(), nullable=False),
    sa.Column('channel', sa.Enum('telegram', 'email', 'webhook', 'console', name='reminder_channel'), nullable=False),
    sa.Column('kind', sa.Enum('upcoming', 'overdue', name='reminder_kind'), server_default='upcoming', nullable=False),
    sa.Column('status', sa.Enum('pending', 'sent', 'failed', 'cancelled', name='reminder_status'), server_default='pending', nullable=False),
    sa.Column('attempts', sa.Integer(), server_default='0', nullable=False),
    sa.Column('last_error', sa.Text(), nullable=True),
    sa.Column('next_attempt_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.Column('sent_at', sa.DateTime(timezone=True), nullable=True),
    sa.Column('external_id', sa.String(length=64), nullable=True),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.ForeignKeyConstraint(['occurrence_id'], ['payment_occurrences.id'], name=op.f('fk_reminders_occurrence_id_payment_occurrences'), ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id', name=op.f('pk_reminders')),
    sa.UniqueConstraint('occurrence_id', 'channel', 'kind', name='uq_reminders_occurrence_channel_kind')
    )
    op.create_index('ix_reminders_status_next_attempt', 'reminders', ['status', 'next_attempt_at'], unique=False)


def downgrade() -> None:
    op.drop_index('ix_reminders_status_next_attempt', table_name='reminders')
    op.drop_table('reminders')
    op.drop_index('ix_payment_occurrences_due_date', table_name='payment_occurrences')
    op.drop_table('payment_occurrences')
    op.drop_index(op.f('ix_sessions_user_id'), table_name='sessions')
    op.drop_table('sessions')
    op.drop_table('recurring_payments')
    op.drop_index('ix_audit_log_at', table_name='audit_log')
    op.drop_table('audit_log')
    op.drop_index('uq_users_login_active', table_name='users', postgresql_where=sa.text('deleted_at IS NULL'))
    op.drop_table('users')
    for enum_name in (
        'reminder_status', 'reminder_kind', 'reminder_channel', 'occurrence_status',
        'payment_period', 'currency', 'user_role',
    ):
        sa.Enum(name=enum_name).drop(op.get_bind(), checkfirst=True)
