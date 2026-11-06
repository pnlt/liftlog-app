"""Migration tests — verify Alembic upgrade/downgrade cycle.

These tests ensure that:
1. All migrations can be applied (upgrade head)
2. All migrations can be rolled back (downgrade base)
3. The upgrade/downgrade cycle is idempotent
"""

import os
import subprocess
import sys

import pytest

from app.core.config import settings


def _migration_environment() -> dict[str, str] | None:
    database = os.environ.get("TEST_POSTGRES_DB")
    if not database:
        return None
    if database == settings.POSTGRES_DB or not database.endswith("_test"):
        raise ValueError(
            "TEST_POSTGRES_DB must name a disposable database ending in '_test', "
            "different from POSTGRES_DB"
        )
    return {**os.environ, "POSTGRES_DB": database}


_test_environment = _migration_environment()


def _db_available() -> bool:
    """Return True if the database answers a connection.

    Checked directly rather than through `alembic current`: that also fails on
    a broken migration chain, which would then skip these tests as "no
    database" instead of failing them.
    """
    if _test_environment is None:
        return False

    from sqlalchemy import create_engine
    from sqlalchemy.exc import OperationalError

    test_settings = settings.model_copy(update={"POSTGRES_DB": _test_environment["POSTGRES_DB"]})
    engine = create_engine(test_settings.DATABASE_URL_SYNC, connect_args={"connect_timeout": 5})
    try:
        with engine.connect():
            return True
    except OperationalError:
        return False
    finally:
        engine.dispose()


pytestmark = pytest.mark.skipif(
    not _db_available(),
    reason="Set TEST_POSTGRES_DB to a reachable disposable database ending in '_test'",
)


class TestMigrations:
    """Test Alembic migration integrity."""

    def test_upgrade_head(self):
        """Test that all migrations can be applied successfully."""
        result = subprocess.run(
            [sys.executable, "-m", "alembic", "upgrade", "head"],
            capture_output=True,
            text=True,
            cwd=".",
            env=_test_environment,
        )
        assert result.returncode == 0, f"Migration upgrade failed:\n{result.stderr}"

    def test_downgrade_base(self):
        """Test that all migrations can be rolled back."""
        # First upgrade to head
        up = subprocess.run(
            [sys.executable, "-m", "alembic", "upgrade", "head"],
            capture_output=True,
            text=True,
            cwd=".",
            env=_test_environment,
        )
        assert up.returncode == 0, f"Migration upgrade failed:\n{up.stderr}"

        # Then downgrade to base
        down = subprocess.run(
            [sys.executable, "-m", "alembic", "downgrade", "base"],
            capture_output=True,
            text=True,
            cwd=".",
            env=_test_environment,
        )
        assert down.returncode == 0, f"Migration downgrade failed:\n{down.stderr}"

    def test_upgrade_downgrade_cycle(self):
        """Test that upgrade → downgrade → upgrade produces consistent state."""
        for cmd in ["upgrade head", "downgrade base", "upgrade head"]:
            action, target = cmd.split()
            result = subprocess.run(
                [sys.executable, "-m", "alembic", action, target],
                capture_output=True,
                text=True,
                cwd=".",
                env=_test_environment,
            )
            assert result.returncode == 0, f"alembic {cmd} failed:\n{result.stderr}"

    def test_current_matches_head(self):
        """Test that current migration revision matches head after upgrade."""
        # Upgrade to head first
        up = subprocess.run(
            [sys.executable, "-m", "alembic", "upgrade", "head"],
            capture_output=True,
            text=True,
            cwd=".",
            env=_test_environment,
        )
        assert up.returncode == 0, f"Migration upgrade failed:\n{up.stderr}"

        # Check if there are any migration revisions
        heads = subprocess.run(
            [sys.executable, "-m", "alembic", "heads"],
            capture_output=True,
            text=True,
            cwd=".",
            env=_test_environment,
        )
        assert heads.returncode == 0

        if not heads.stdout.strip():
            pytest.skip("No migration revisions found — nothing to verify")

        # Check current
        result = subprocess.run(
            [sys.executable, "-m", "alembic", "current"],
            capture_output=True,
            text=True,
            cwd=".",
            env=_test_environment,
        )
        assert result.returncode == 0
        assert "(head)" in result.stdout, (
            f"Current revision is not at head:\nstdout: {result.stdout}\nstderr: {result.stderr}"
        )
