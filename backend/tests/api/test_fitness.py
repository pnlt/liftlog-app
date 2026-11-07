"""Authenticated route boundaries, body limits and published response schemas."""

from unittest.mock import AsyncMock
from uuid import uuid4

import pytest
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient

from app.api.deps import DBSession, get_current_user, get_db_session
from app.api.exception_handlers import register_exception_handlers
from app.db.models.user import User
from app.main import app
from tests.test_fitness_schemas import workout_mutation


def test_all_fitness_read_and_sync_routes_are_registered():
    paths = app.openapi()["paths"]
    for path in (
        "/users/me/training-state",
        "/users/me/settings",
        "/training-plans",
        "/training-plans/{plan_id}",
        "/exercises",
        "/exercises/{exercise_id}",
        "/workouts",
        "/workouts/{workout_id}",
        "/users/me/stats",
        "/exercises/{exercise_id}/progress",
        "/sync/mutations",
        "/sync/changes",
    ):
        assert "/api/v1" + path in paths, f"missing route {path}"


@pytest.mark.anyio
async def test_mutation_validation_uses_structured_errors_and_bounds():
    from app.api.routes.v1.fitness import router

    test_app = FastAPI()
    test_app.include_router(router)
    register_exception_handlers(test_app)
    user = User(id=uuid4(), email="route@example.com", external_user_id="user_fitness_test")
    test_app.dependency_overrides[get_current_user] = lambda: user
    test_app.dependency_overrides[get_db_session] = lambda: AsyncMock()
    async with AsyncClient(transport=ASGITransport(app=test_app), base_url="http://test") as client:
        invalid = workout_mutation()
        invalid["entityType"] = "settings"
        response = await client.post("/sync/mutations", json=invalid)
        assert response.status_code == 422
        assert response.json()["error"]["code"] == "VALIDATION_ERROR"
        large = await client.post("/sync/mutations", content=b" " * (1024 * 1024 + 1))
        assert large.status_code == 413
        assert large.json()["error"]["code"] == "PAYLOAD_TOO_LARGE"
        page = await client.get("/sync/changes?limit=201")
        assert page.status_code == 422


@pytest.mark.anyio
async def test_sync_routes_require_authentication(client):
    for path in ("/sync/changes", "/users/me/training-state", "/users/me/settings", "/workouts"):
        response = await client.get("/api/v1" + path)
        assert response.status_code == 401


@pytest.mark.anyio
async def test_transaction_commits_before_http_acknowledgment_starts():
    test_app = FastAPI()
    events = []

    async def transaction():
        yield AsyncMock()
        events.append("commit")

    @test_app.get("/transaction")
    async def transaction_route(db: DBSession):
        return {"acknowledged": True}

    test_app.dependency_overrides[get_db_session] = transaction

    async def observed_app(scope, receive, send):
        async def observed_send(message):
            if message["type"] == "http.response.start":
                events.append("response")
            await send(message)

        await test_app(scope, receive, observed_send)

    async with AsyncClient(
        transport=ASGITransport(app=observed_app), base_url="http://test"
    ) as client:
        assert (await client.get("/transaction")).status_code == 200
    assert events == ["commit", "response"]
