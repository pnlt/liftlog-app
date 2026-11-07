"""Clerk session tokens need not carry an email claim."""

from datetime import UTC, datetime
from unittest.mock import AsyncMock, MagicMock
from uuid import uuid4

import pytest
from httpx import AsyncClient

from app.api import deps
from app.core.config import settings
from app.db.models.user import User
from app.main import app
from app.services.user import UserService


@pytest.mark.anyio
@pytest.mark.parametrize("path", ["auth/me", "users/me"])
@pytest.mark.parametrize("email", [None, "member@example.com"])
async def test_clerk_session_user_response(
    client: AsyncClient,
    monkeypatch: pytest.MonkeyPatch,
    path: str,
    email: str | None,
) -> None:
    payload = {"sub": "user_clerk_123"}
    if email is not None:
        payload["email"] = email
    monkeypatch.setattr(deps, "verify_idp_token", lambda _token: payload)

    async def provision(external_user_id: str, email: str, full_name: str | None) -> User:
        return User(
            id=uuid4(),
            external_user_id=external_user_id,
            email=email,
            full_name=full_name,
            is_active=True,
            role="user",
            created_at=datetime.now(UTC),
        )

    service = MagicMock(spec=UserService)
    service.get_or_create_from_idp = AsyncMock(side_effect=provision)

    async def user_service() -> UserService:
        return service

    app.dependency_overrides[deps.get_user_service] = user_service
    response = await client.get(
        f"{settings.API_V1_STR}/{path}",
        headers={"Authorization": "Bearer clerk-session"},
    )

    assert response.status_code == 200
    assert response.json()["email"] == (email or "user_clerk_123@idp.example.com")
