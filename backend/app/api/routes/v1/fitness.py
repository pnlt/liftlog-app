"""Authenticated canonical fitness reads and retry-safe aggregate mutations."""

from typing import Annotated, Literal
from uuid import UUID

from fastapi import APIRouter, Query, Request
from fastapi.exceptions import RequestValidationError
from fastapi.routing import APIRoute
from pydantic import ValidationError as PydanticValidationError

from app.api.deps import CurrentUser, DBSession
from app.core.exceptions import AppException, ValidationError
from app.repositories.fitness_catalog import CatalogRepository
from app.schemas.fitness import (
    CatalogPage,
    Equipment,
    Exercise,
    FitnessStats,
    LegacyPlanSnapshot,
    Load,
    Muscle,
    PlanPage,
    ProgressPage,
    SyncAck,
    SyncChange,
    SyncMutation,
    SyncPage,
    VersionedSettings,
    VersionedTrainingState,
    WorkoutPage,
)
from app.services.fitness import FitnessService

MAX_MUTATION_BYTES = 1024 * 1024


class FitnessRoute(APIRoute):
    def get_route_handler(self):
        original = super().get_route_handler()

        async def structured_validation(request: Request):
            try:
                return await original(request)
            except RequestValidationError as exc:
                raise ValidationError(
                    details={
                        "fields": [
                            {"loc": list(error["loc"]), "msg": error["msg"], "type": error["type"]}
                            for error in exc.errors()
                        ]
                    }
                ) from None

        return structured_validation


router = APIRouter(route_class=FitnessRoute)
Limit = Annotated[int, Query(ge=1, le=200)]
Cursor = Annotated[str | None, Query(max_length=300)]
Revision = Annotated[str | None, Query(min_length=1, max_length=100)]


@router.post(
    "/sync/mutations",
    response_model=SyncAck,
    openapi_extra={
        "requestBody": {
            "required": True,
            "content": {
                "application/json": {"schema": SyncMutation.model_json_schema(by_alias=True)}
            },
        }
    },
)
async def mutate(request: Request, user: CurrentUser, db: DBSession):
    data = bytearray()
    async for chunk in request.stream():
        data.extend(chunk)
        if len(data) > MAX_MUTATION_BYTES:
            error = AppException(message="Mutation exceeds 1 MiB", code="PAYLOAD_TOO_LARGE")
            error.status_code = 413
            raise error
    try:
        mutation = SyncMutation.model_validate_json(data, by_alias=True, by_name=False)
    except PydanticValidationError as exc:
        raise ValidationError(
            details={
                "fields": exc.errors(include_context=False, include_url=False, include_input=False)
            }
        ) from None
    return await FitnessService(db).mutate(user, mutation)


@router.get("/sync/changes", response_model=SyncPage)
async def changes(
    user: CurrentUser, db: DBSession, cursor: Annotated[int, Query(ge=0)] = 0, limit: Limit = 200
):
    return await FitnessService(db).changes(user, cursor, limit)


@router.get("/users/me/training-state", response_model=VersionedTrainingState)
async def training_state(user: CurrentUser, db: DBSession):
    return await FitnessService(db).training_state(user)


@router.get("/users/me/settings", response_model=VersionedSettings)
async def settings(user: CurrentUser, db: DBSession):
    return await FitnessService(db).settings(user)


@router.get("/training-plans", response_model=PlanPage)
async def plans(user: CurrentUser, db: DBSession, cursor: Cursor = None, limit: Limit = 50):
    return await FitnessService(db).plans(user, cursor, limit)


@router.get("/training-plans/{plan_id}", response_model=LegacyPlanSnapshot)
async def plan(plan_id: UUID, user: CurrentUser, db: DBSession):
    return await FitnessService(db).plan(user, plan_id)


@router.get("/workouts", response_model=WorkoutPage)
async def workouts(
    user: CurrentUser,
    db: DBSession,
    cursor: Cursor = None,
    limit: Limit = 50,
    status: Literal["open", "completed"] | None = None,
    include_deleted: Annotated[bool, Query(alias="includeDeleted")] = False,
):
    return await FitnessService(db).workouts(user, cursor, limit, status, include_deleted)


@router.get("/workouts/{workout_id}", response_model=SyncChange)
async def workout(workout_id: UUID, user: CurrentUser, db: DBSession):
    return await FitnessService(db).workout(user, workout_id)


@router.get("/users/me/stats", response_model=FitnessStats)
async def stats(
    user: CurrentUser,
    db: DBSession,
    time_zone: Annotated[str, Query(alias="timeZone", min_length=1, max_length=100)] = "UTC",
    weeks: Annotated[int, Query(ge=1, le=104)] = 8,
    goal: Annotated[int, Query(ge=1, le=7)] = 1,
):
    return await FitnessService(db).stats(user, time_zone, weeks=weeks, goal=goal)


@router.get("/exercises/{exercise_id}/progress", response_model=ProgressPage)
async def progress(
    exercise_id: str,
    user: CurrentUser,
    db: DBSession,
    cursor: Cursor = None,
    limit: Limit = 50,
    time_zone: Annotated[str, Query(alias="timeZone", min_length=1, max_length=100)] = "UTC",
):
    return await FitnessService(db).progress(user, exercise_id, time_zone, cursor, limit)


@router.get("/exercises", response_model=CatalogPage)
async def exercises(
    db: DBSession,
    revision: Revision = None,
    cursor: Cursor = None,
    limit: Limit = 100,
    search: Annotated[str | None, Query(max_length=200)] = None,
    muscle: Muscle | None = None,
    equipment: Equipment | None = None,
    load: Load | None = None,
):
    return await CatalogRepository(db).page(
        revision, cursor, limit, search, muscle, equipment, load
    )


@router.get("/exercises/{exercise_id}", response_model=Exercise)
async def exercise(exercise_id: str, db: DBSession, revision: Revision = None):
    return await CatalogRepository(db).exercise(exercise_id, revision)
