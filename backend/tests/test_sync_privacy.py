"""Sync failure diagnostics must not serialize private aggregate snapshots."""

import json
import logging

import pytest
from sqlalchemy.exc import DBAPIError
from starlette.requests import Request

from app.api.exception_handlers import app_exception_handler
from app.core.exceptions import AlreadyExistsError
from app.db.session import get_db_context, get_worker_db_context


@pytest.mark.anyio
async def test_conflict_snapshot_is_returned_to_caller_but_excluded_from_log_metadata(caplog):
    private = "private-profile-measurements"
    request = Request(
        {"type": "http", "method": "POST", "path": "/api/v1/sync/mutations", "headers": []}
    )
    details = {"current": {"profile": {"name": private, "weightKg": 75}}}
    error = AlreadyExistsError(message="Aggregate version changed", details=details)
    with caplog.at_level(logging.WARNING, logger="app.api.exception_handlers"):
        response = await app_exception_handler(request, error)
    assert json.loads(response.body)["error"]["details"] == details
    records = [record for record in caplog.records if record.name == "app.api.exception_handlers"]
    assert records
    assert all("details" not in record.__dict__ for record in records)
    assert private not in caplog.text


@pytest.mark.anyio
@pytest.mark.parametrize("context", [get_db_context, get_worker_db_context])
async def test_database_failure_trace_omits_bound_private_values(context, caplog):
    private = "private-workout-and-profile-json"
    with caplog.at_level(logging.ERROR, logger="app.db.session"), pytest.raises(DBAPIError):
        async with context() as session:
            # Exercise the real engine/session diagnostics policy without a DB connection.
            raise DBAPIError(
                "INSERT INTO fitness (...) VALUES (...)",
                {"payload": private},
                Exception("permission denied"),
                hide_parameters=session.bind.sync_engine.hide_parameters,
            )
    assert "permission denied" in caplog.text
    assert private not in caplog.text
