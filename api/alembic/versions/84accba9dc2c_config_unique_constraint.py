"""config_unique_constraint

Revision ID: 84accba9dc2c
Revises: a1b2c3d4e5f6
Create Date: 2026-03-16 08:44:38.324374

Remove UNIQUE("key") from config table so the same key can exist per (user_id, team_id).
SQLite cannot drop column constraints, so we recreate the table without UNIQUE("key").

"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "84accba9dc2c"
down_revision: Union[str, Sequence[str], None] = "a1b2c3d4e5f6"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Remove UNIQUE(key) constraint from config by recreating the table."""
    connection = op.get_bind()
    dialect = connection.dialect.name

    if dialect == "sqlite":
        # SQLite cannot ALTER TABLE DROP CONSTRAINT, so we recreate the table.
        connection.execute(
            sa.text("""
                CREATE TABLE config_new (
                    id INTEGER NOT NULL,
                    "key" VARCHAR NOT NULL,
                    value VARCHAR,
                    user_id VARCHAR,
                    team_id VARCHAR,
                    PRIMARY KEY (id)
                )
            """)
        )
        connection.execute(
            sa.text(
                "INSERT INTO config_new (id, key, value, user_id, team_id) "
                "SELECT id, key, value, user_id, team_id FROM config"
            )
        )
        connection.execute(sa.text("DROP TABLE config"))
        connection.execute(sa.text("ALTER TABLE config_new RENAME TO config"))

        # Recreate indexes (they were dropped with the table)
        op.create_index("ix_config_key", "config", ["key"], unique=False)
        op.create_index("ix_config_user_id", "config", ["user_id"], unique=False)
        op.create_index("ix_config_team_id", "config", ["team_id"], unique=False)
        connection.execute(sa.text("CREATE UNIQUE INDEX uq_config_user_team_key ON config(user_id, team_id, key)"))
    else:
        # Postgres: ALTER TABLE DROP CONSTRAINT is supported, so no table recreation is needed.
        # By the time this migration runs, the earlier migration c78d76a6d65c has already:
        #   - recreated ix_config_key as a non-unique index
        #   - added ix_config_user_id / ix_config_team_id
        #   - added the composite unique constraint uq_config_user_team_key
        # The only leftover from the initial migration's sa.UniqueConstraint("key") is the
        # Postgres-auto-named "config_key_key" constraint — drop it so duplicate keys are
        # allowed across different (user_id, team_id) scopes.
        op.drop_constraint("config_key_key", "config", type_="unique")


def downgrade() -> None:
    """Restore UNIQUE(key) on config (recreate table with original constraint)."""
    connection = op.get_bind()

    connection.execute(
        sa.text("""
            CREATE TABLE config_old (
                id INTEGER NOT NULL,
                "key" VARCHAR NOT NULL,
                value VARCHAR,
                user_id VARCHAR,
                team_id VARCHAR,
                PRIMARY KEY (id),
                UNIQUE ("key")
            )
        """)
    )
    connection.execute(
        sa.text(
            "INSERT OR IGNORE INTO config_old (id, key, value, user_id, team_id) "
            "SELECT id, key, value, user_id, team_id FROM config"
        )
    )
    connection.execute(sa.text("DROP TABLE config"))
    connection.execute(sa.text("ALTER TABLE config_old RENAME TO config"))

    op.create_index("ix_config_key", "config", ["key"], unique=False)
    op.create_index("ix_config_user_id", "config", ["user_id"], unique=False)
    op.create_index("ix_config_team_id", "config", ["team_id"], unique=False)
    connection.execute(sa.text("CREATE UNIQUE INDEX uq_config_user_team_key ON config(user_id, team_id, key)"))
