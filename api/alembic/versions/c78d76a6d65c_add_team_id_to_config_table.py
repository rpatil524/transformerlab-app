"""add_team_id_to_config_table

Revision ID: c78d76a6d65c
Revises: 1f7cb465d15a
Create Date: 2025-12-04 11:23:22.165544

"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

from transformerlab.db.migration_utils import has_column, has_index


# revision identifiers, used by Alembic.
revision: str = "c78d76a6d65c"
down_revision: Union[str, Sequence[str], None] = "1f7cb465d15a"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    connection = op.get_bind()

    # Add columns (outside batch mode to avoid circular dependency).
    # Guard each step with an explicit existence check so the migration
    # is idempotent on databases that may already have some of these
    # objects (e.g. an older DB created before Alembic started tracking).
    if not has_column(connection, "config", "user_id"):
        op.add_column("config", sa.Column("user_id", sa.String(), nullable=True))
    if not has_column(connection, "config", "team_id"):
        op.add_column("config", sa.Column("team_id", sa.String(), nullable=True))

    # Replace the old UNIQUE index on (key) with a non-unique index so that
    # duplicate keys are allowed across different (user_id, team_id) scopes.
    if has_index(connection, "config", "ix_config_key"):
        op.drop_index("ix_config_key", table_name="config")
    op.create_index("ix_config_key", "config", ["key"], unique=False)

    if not has_index(connection, "config", "ix_config_user_id"):
        op.create_index("ix_config_user_id", "config", ["user_id"], unique=False)
    if not has_index(connection, "config", "ix_config_team_id"):
        op.create_index("ix_config_team_id", "config", ["team_id"], unique=False)

    # Composite uniqueness on (user_id, team_id, key). We use a unique index
    # rather than op.create_unique_constraint because SQLite does not support
    # ALTER TABLE ADD CONSTRAINT (it raises NotImplementedError). A unique
    # index has the same semantics on both dialects.
    if not has_index(connection, "config", "uq_config_user_team_key"):
        op.create_index("uq_config_user_team_key", "config", ["user_id", "team_id", "key"], unique=True)

    # Migrate existing configs to admin user's first team
    # Note: Don't call connection.commit() - Alembic manages transactions

    # Find admin user's first team
    users_teams = sa.table("users_teams", sa.column("user_id"), sa.column("team_id"))
    users = sa.table("user", sa.column("id"), sa.column("email"))

    admin_team_result = connection.execute(
        sa.select(users_teams.c.team_id)
        .select_from(users_teams.join(users, users_teams.c.user_id == users.c.id))
        .where(users.c.email == "admin@example.com")
        .limit(1)
    )
    admin_team_row = admin_team_result.fetchone()

    if admin_team_row:
        admin_team_id = admin_team_row[0]
        # Update all existing configs (where team_id is NULL) to use admin team
        config_table = sa.table("config", sa.column("team_id"))
        connection.execute(
            sa.update(config_table).where(config_table.c.team_id.is_(None)).values(team_id=admin_team_id)
        )
        print(f"✅ Migrated existing configs to team {admin_team_id}")
    else:
        # If no admin team found, try to get any user's first team
        any_team_result = connection.execute(sa.select(users_teams.c.team_id).limit(1))
        any_team_row = any_team_result.fetchone()
        if any_team_row:
            any_team_id = any_team_row[0]
            config_table = sa.table("config", sa.column("team_id"))
            connection.execute(
                sa.update(config_table).where(config_table.c.team_id.is_(None)).values(team_id=any_team_id)
            )
            print(f"✅ Migrated existing configs to team {any_team_id}")
        else:
            # No teams found, delete existing configs
            config_table = sa.table("config", sa.column("team_id"))
            deleted_count = connection.execute(sa.delete(config_table).where(config_table.c.team_id.is_(None))).rowcount
            print(f"⚠️  No teams found, deleted {deleted_count} config entries")
    # ### end Alembic commands ###


def downgrade() -> None:
    """Downgrade schema."""
    connection = op.get_bind()

    # Drop unique index and indexes added by upgrade(), if present.
    # upgrade() creates uq_config_user_team_key as a unique index (see comment
    # there); drop it the same way for symmetry and SQLite compatibility.
    if has_index(connection, "config", "uq_config_user_team_key"):
        op.drop_index("uq_config_user_team_key", table_name="config")
    if has_index(connection, "config", "ix_config_team_id"):
        op.drop_index("ix_config_team_id", table_name="config")
    if has_index(connection, "config", "ix_config_user_id"):
        op.drop_index("ix_config_user_id", table_name="config")
    if has_index(connection, "config", "ix_config_key"):
        op.drop_index("ix_config_key", table_name="config")

    # SQLite < 3.35.0 doesn't support DROP COLUMN, so recreate the table.
    # PostgreSQL (and modern SQLite) support DROP COLUMN directly — but since
    # this branch runs on all SQLite versions we keep the recreate path here
    # for compatibility.
    if connection.dialect.name == "sqlite":
        connection.execute(
            sa.text("""
                CREATE TABLE config_new (
                    id INTEGER NOT NULL PRIMARY KEY,
                    key VARCHAR NOT NULL,
                    value VARCHAR
                )
            """)
        )
        connection.execute(sa.text("INSERT INTO config_new (id, key, value) SELECT id, key, value FROM config"))
        connection.execute(sa.text("DROP TABLE config"))
        connection.execute(sa.text("ALTER TABLE config_new RENAME TO config"))
    else:
        if has_column(connection, "config", "team_id"):
            op.drop_column("config", "team_id")
        if has_column(connection, "config", "user_id"):
            op.drop_column("config", "user_id")

    # Recreate the original unique index on key.
    if not has_index(connection, "config", "ix_config_key"):
        op.create_index("ix_config_key", "config", ["key"], unique=True)
    # ### end Alembic commands ###
