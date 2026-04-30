"""
Utility functions for Alembic migrations.

Keep this clean and isolated. Do NOT import Transformer Lab stuff in here.
"""

import sqlalchemy as sa


def table_exists(connection, table_name: str) -> bool:
    """
    Check if a table exists in the database.

    Supports SQLite, PostgreSQL, and a generic case for
    other SQL databases via information_schema.

    Args:
        connection: The database connection from op.get_bind()
        table_name: The name of the table to check

    Returns:
        bool: True if table exists, False otherwise
    """
    dialect_name = connection.dialect.name

    if dialect_name == "sqlite":
        # SQLite-specific query
        result = connection.execute(
            sa.text("SELECT name FROM sqlite_master WHERE type='table' AND name=:name"), {"name": table_name}
        )
    elif dialect_name == "postgresql":
        # PostgreSQL-specific query
        result = connection.execute(
            sa.text("SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename=:name"),
            {"name": table_name},
        )
    else:
        # Fallback to standard information_schema (works for most databases)
        result = connection.execute(
            sa.text(
                "SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_name=:name"
            ),
            {"name": table_name},
        )

    return result.fetchone() is not None


def has_column(connection, table_name: str, column_name: str) -> bool:
    """
    Check if a column exists on a table.

    Uses SQLAlchemy's Inspector API so this works across SQLite, PostgreSQL,
    and any other dialect Alembic supports.

    Args:
        connection: The database connection from op.get_bind()
        table_name: The name of the table
        column_name: The name of the column to check

    Returns:
        bool: True if the column exists, False otherwise (including when the
        table itself does not exist).
    """
    inspector = sa.inspect(connection)
    if not inspector.has_table(table_name):
        return False
    return any(col["name"] == column_name for col in inspector.get_columns(table_name))


def has_index(connection, table_name: str, index_name: str) -> bool:
    """
    Check if an index exists on a table.

    Uses SQLAlchemy's Inspector API so this works across SQLite, PostgreSQL,
    and any other dialect Alembic supports. Also looks at unique constraints
    since some dialects (notably SQLite) expose unique constraints as indexes
    while others (Postgres) surface them separately.

    Args:
        connection: The database connection from op.get_bind()
        table_name: The name of the table
        index_name: The name of the index to check

    Returns:
        bool: True if the index exists, False otherwise (including when the
        table itself does not exist).
    """
    inspector = sa.inspect(connection)
    if not inspector.has_table(table_name):
        return False
    if any(idx["name"] == index_name for idx in inspector.get_indexes(table_name)):
        return True
    # Postgres reports named unique constraints separately from indexes.
    return any(uc.get("name") == index_name for uc in inspector.get_unique_constraints(table_name))
