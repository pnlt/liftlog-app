"""Migration checks must never target the application's database."""

import runpy
from pathlib import Path
from unittest.mock import MagicMock

import pytest
import sqlalchemy

from app.core.config import settings

MIGRATIONS = Path(__file__).with_name("test_migrations.py")


def test_migration_checks_do_not_connect_without_test_database(monkeypatch):
    monkeypatch.delenv("TEST_POSTGRES_DB", raising=False)
    create_engine = MagicMock()
    monkeypatch.setattr(sqlalchemy, "create_engine", create_engine)

    runpy.run_path(str(MIGRATIONS))

    create_engine.assert_not_called()


@pytest.mark.parametrize("database", [settings.POSTGRES_DB, "another_application"])
def test_migration_checks_reject_application_database(monkeypatch, database):
    monkeypatch.setenv("TEST_POSTGRES_DB", database)
    create_engine = MagicMock()
    monkeypatch.setattr(sqlalchemy, "create_engine", create_engine)

    with pytest.raises(ValueError, match="disposable"):
        runpy.run_path(str(MIGRATIONS))

    create_engine.assert_not_called()


@pytest.mark.parametrize(
    "method",
    [
        "test_upgrade_head",
        "test_downgrade_base",
        "test_upgrade_downgrade_cycle",
        "test_current_matches_head",
    ],
)
def test_migration_commands_use_only_disposable_database(monkeypatch, method):
    monkeypatch.setenv("TEST_POSTGRES_DB", "liftlog_migration_test")
    create_engine = MagicMock()
    monkeypatch.setattr(sqlalchemy, "create_engine", create_engine)
    namespace = runpy.run_path(str(MIGRATIONS))
    run = MagicMock(return_value=MagicMock(returncode=0, stdout="revision (head)", stderr=""))
    monkeypatch.setattr("subprocess.run", run)

    getattr(namespace["TestMigrations"](), method)()

    assert (
        sqlalchemy.engine.make_url(create_engine.call_args.args[0]).database
        == "liftlog_migration_test"
    )
    assert run.call_count > 0
    for call in run.call_args_list:
        assert call.kwargs["env"]["POSTGRES_DB"] == "liftlog_migration_test"
