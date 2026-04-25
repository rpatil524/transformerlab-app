"""Regression tests for api/alembic/env.py.

These tests guard against the configparser interpolation bug that caused
`alembic upgrade` to crash on production when a Postgres password contained
characters that `urllib.parse.quote_plus` percent-encodes (e.g. `}`, `?`,
`!`, `{` -> `%7D`, `%3F`, `%21`, `%7B`).

The failure looked like::

    ValueError: invalid interpolation syntax in
    'postgresql+asyncpg://user:a%7Db%3Fc@host/db' at position N

It was triggered because env.py used to call
`config.set_main_option("sqlalchemy.url", DATABASE_URL)`, and Alembic's
Config object is backed by `configparser`, which treats `%` as the start of
an interpolation token. CI never caught it because the postgres workflow
uses a plain password (`testpass`) that has no characters needing encoding.
"""

import importlib
import os
import subprocess
import sys
import textwrap
from pathlib import Path


# Path to the `api` directory containing alembic.ini and the alembic/ tree.
API_DIR = Path(__file__).resolve().parents[2]
ALEMBIC_INI = API_DIR / "alembic.ini"


def _run_alembic_offline(env: dict) -> subprocess.CompletedProcess:
    """Invoke `alembic upgrade head --sql` in a subprocess.

    Offline mode emits SQL to stdout and never opens a DB connection, so we
    can exercise env.py against a synthetic Postgres DSN without standing up
    a database. We use a subprocess so the test is hermetic — it doesn't
    contaminate the test process's import of `transformerlab.db.constants`.
    """
    return subprocess.run(
        [sys.executable, "-m", "alembic", "-c", str(ALEMBIC_INI), "upgrade", "head", "--sql"],
        cwd=API_DIR,
        env=env,
        capture_output=True,
        text=True,
        timeout=120,
    )


def test_env_handles_percent_encoded_password_in_database_url():
    """env.py must not feed a `%`-containing DSN into configparser.

    A real RDS-generated password with special characters (`}?!{`) becomes
    `%7D%3F%21%7B` after `quote_plus`. If env.py routes that through
    `config.set_main_option("sqlalchemy.url", ...)`, configparser raises
    `ValueError: invalid interpolation syntax`. This test sets a password
    with those characters and asserts env.py loads cleanly in offline mode.
    """
    env = os.environ.copy()
    env.update(
        {
            "DATABASE_HOST": "fake-host.example.com",
            "DATABASE_PORT": "5432",
            "DATABASE_DB": "fakedb",
            "DATABASE_USER": "fakeuser",
            # Includes every character class that broke prod: `}`, `?`, `!`, `{`.
            "DATABASE_PASSWORD": "s32}-M0X?S!D{6Lej",
        }
    )

    result = _run_alembic_offline(env)

    # The specific regression we're guarding against: configparser
    # interpolation error on `%` while loading env.py. We do NOT check the
    # exit code because Alembic's offline (`--sql`) mode can fail later for
    # unrelated reasons (some migrations call `connection.execute(...)`
    # which has no connection in offline mode). What matters is that env.py
    # loaded successfully — i.e. the interpolation error is gone.
    assert "invalid interpolation syntax" not in result.stderr, (
        "env.py is feeding the DATABASE_URL through configparser, which "
        "cannot handle percent-encoded passwords. "
        f"stderr:\n{result.stderr}"
    )

    # Sanity check: env.py must have at least loaded far enough to begin
    # migration generation. If it crashed during load, we'd see neither the
    # alembic startup banner nor any "Running upgrade" log line.
    assert "Context impl" in result.stderr, (
        f"env.py did not finish loading. stdout:\n{result.stdout}\nstderr:\n{result.stderr}"
    )


def test_database_url_is_percent_encoded_for_special_passwords(monkeypatch):
    """Confirm db.constants still URL-encodes the password.

    This locks in the c7fe52e fix: passwords with reserved URL characters
    must be `quote_plus`-encoded before being substituted into the DSN, so
    that SQLAlchemy's URL parser doesn't mis-read `?` as a query delimiter
    or `@` as the userinfo separator.
    """
    monkeypatch.setenv("DATABASE_HOST", "fake-host.example.com")
    monkeypatch.setenv("DATABASE_PORT", "5432")
    monkeypatch.setenv("DATABASE_DB", "fakedb")
    monkeypatch.setenv("DATABASE_USER", "fakeuser")
    monkeypatch.setenv("DATABASE_PASSWORD", "a}b?c!d{e")

    # Force a fresh evaluation of constants.py against the patched env.
    import transformerlab.db.constants as constants

    constants = importlib.reload(constants)

    # Reserved characters must be percent-encoded; raw forms must not appear
    # in the password segment of the DSN.
    expected_encoded = "a%7Db%3Fc%21d%7Be"
    assert expected_encoded in constants.DATABASE_URL, (
        f"Password was not percent-encoded. DATABASE_URL={constants.DATABASE_URL}"
    )

    # Also confirm env.py would receive a `%`-containing URL — the exact
    # condition the offline test above exercises end-to-end.
    assert "%" in constants.DATABASE_URL.split("@", 1)[0]

    # Document the failure mode: configparser cannot accept this URL via
    # set_main_option. If this assertion ever fails, configparser changed
    # its interpolation behavior and our env.py workaround can be revisited.
    from configparser import ConfigParser

    cp = ConfigParser()
    cp.add_section("alembic")
    try:
        cp.set("alembic", "sqlalchemy.url", constants.DATABASE_URL)
    except ValueError as e:
        assert "invalid interpolation syntax" in str(e)
    else:
        # If configparser accepts it, our env.py workaround is no longer
        # strictly needed — but the test still passes. Leave a breadcrumb.
        # (Intentionally not failing here.)
        _ = textwrap.dedent  # keep import used; no-op
