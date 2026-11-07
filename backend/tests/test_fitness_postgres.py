"""Actual PostgreSQL transactions; never substitute SQLite or mocked row locks.

Run with FITNESS_TEST_DATABASE_URL=postgresql+asyncpg://.../liftlog_test.
Only a disposable database whose name ends in _test is accepted. Each test gets
its own schema; no tables outside that schema are dropped.
"""

import asyncio
import importlib.util
import os
from copy import deepcopy
from datetime import UTC, datetime
from uuid import uuid4

import pytest
from sqlalchemy import func, select, text
from sqlalchemy.engine import make_url
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.core.exceptions import AlreadyExistsError, AuthorizationError, ValidationError
from tests.test_fitness_schemas import training_state, workout_mutation


def test_canonical_sync_implementation_exists():
    assert importlib.util.find_spec("app.services.fitness") is not None, "canonical sync is missing"
    assert importlib.util.find_spec("app.db.models.fitness") is not None


@pytest.fixture
async def pg():
    url = os.getenv("FITNESS_TEST_DATABASE_URL")
    if not url:
        pytest.skip("FITNESS_TEST_DATABASE_URL is required for actual PostgreSQL tests")
    parsed = make_url(url)
    if not parsed.database or not parsed.database.endswith("_test"):
        pytest.fail("FITNESS_TEST_DATABASE_URL must select a disposable *_test database")
    from app.db.base import Base
    from app.db.models.fitness import FITNESS_TABLES
    from app.db.models.user import User

    schema_name = "fitness_" + uuid4().hex
    admin = create_async_engine(url)
    async with admin.begin() as conn:
        await conn.execute(text(f'CREATE SCHEMA "{schema_name}"'))
    engine = create_async_engine(
        url, connect_args={"server_settings": {"search_path": schema_name}}
    )
    async with engine.begin() as conn:
        await conn.run_sync(
            lambda c: Base.metadata.create_all(c, tables=[User.__table__, *FITNESS_TABLES])
        )
    factory = async_sessionmaker(engine, expire_on_commit=False)
    user = User(id=uuid4(), email=f"{uuid4()}@example.com", external_user_id="user_fitness_test")
    other = User(id=uuid4(), email=f"{uuid4()}@example.com", external_user_id="user_other")
    async with factory.begin() as db:
        db.add_all([user, other])
    try:
        yield factory, user, other
    finally:
        await engine.dispose()
        async with admin.begin() as conn:
            await conn.execute(text(f'DROP SCHEMA "{schema_name}" CASCADE'))
        await admin.dispose()


async def accept(factory, user, mutation):
    from app.schemas.fitness import SyncMutation
    from app.services.fitness import FitnessService

    async with factory.begin() as db:
        return await FitnessService(db).mutate(user, SyncMutation.model_validate(mutation))


@pytest.mark.anyio
async def test_concurrent_identical_retries_have_one_receipt_and_feed_entry(pg):
    from app.db.models.fitness import SyncChangeRecord, SyncMutationReceipt, WorkoutSetRecord

    factory, user, _ = pg
    mutation = workout_mutation()
    mutation["operation"] = "importLegacyWorkout"
    a, b = await asyncio.gather(accept(factory, user, mutation), accept(factory, user, mutation))
    assert a.model_dump() == b.model_dump()
    async with factory() as db:
        for model in (SyncChangeRecord, SyncMutationReceipt, WorkoutSetRecord):
            assert await db.scalar(select(func.count()).select_from(model)) == 1
    changed = deepcopy(mutation)
    changed["payload"]["note"] = "different request with same mutation id"
    with pytest.raises(AlreadyExistsError):
        await accept(factory, user, changed)


@pytest.mark.anyio
async def test_expected_version_tombstones_and_owned_workout_reads(pg):
    from app.services.fitness import FitnessService

    factory, user, other = pg
    mutation = workout_mutation()
    mutation["operation"] = "importLegacyWorkout"
    first = await accept(factory, user, mutation)
    stale = deepcopy(mutation)
    stale["mutationId"] = str(uuid4())
    with pytest.raises(AlreadyExistsError) as error:
        await accept(factory, user, stale)
    assert error.value.details["current"]["version"] == 1
    stolen = deepcopy(mutation)
    stolen["mutationId"] = str(uuid4())
    with pytest.raises(AuthorizationError):
        await accept(factory, other, stolen)
    deleted = deepcopy(mutation)
    deleted.update(mutationId=str(uuid4()), baseVersion=1, operation="delete")
    deleted["payload"]["deletedAt"] = "2026-11-02T00:00:00Z"
    assert (await accept(factory, user, deleted)).change.operation == "delete"
    resurrection = deepcopy(mutation)
    resurrection.update(mutationId=str(uuid4()), baseVersion=2)
    with pytest.raises(AlreadyExistsError):
        await accept(factory, user, resurrection)
    async with factory() as db:
        svc = FitnessService(db)
        assert (await svc.changes(other, 0, 200)).changes == []
        page = await svc.changes(user, 0, 1)
        assert page.has_more and page.next_cursor == first.change.revision
        page2 = await svc.changes(user, page.next_cursor, 1)
        assert page2.changes[0].operation == "delete"
        assert not page2.has_more


@pytest.mark.anyio
async def test_per_account_lock_orders_commits_and_rollback_leaves_no_gap(pg):
    from app.schemas.fitness import SyncMutation
    from app.services.fitness import FitnessService

    factory, user, other = pg
    one = workout_mutation()
    one["operation"] = "importLegacyWorkout"
    two = workout_mutation()
    two["operation"] = "importLegacyWorkout"
    async with factory() as first_db:
        first = await FitnessService(first_db).mutate(user, SyncMutation.model_validate(one))
        task = asyncio.create_task(accept(factory, user, two))
        # A separate user's transaction must proceed while this account is locked.
        other_mutation = workout_mutation()
        other_mutation["operation"] = "importLegacyWorkout"
        other_mutation["payload"]["userId"] = other.external_user_id
        await asyncio.wait_for(accept(factory, other, other_mutation), timeout=5)
        await asyncio.sleep(0.05)
        assert not task.done(), "same-account writer passed an uncommitted row lock"
        async with factory() as observer:
            assert (await FitnessService(observer).changes(user, 0, 200)).changes == []
        await first_db.rollback()
        second = await asyncio.wait_for(task, timeout=5)
    assert first.change.revision == second.change.revision == 1
    async with factory() as db:
        page = await FitnessService(db).changes(user, 0, 200)
        assert [str(x.mutation_id) for x in page.changes] == [two["mutationId"]]


@pytest.mark.anyio
async def test_unknown_legacy_exercise_does_not_publish_catalog_and_cannot_be_added(pg):
    from app.db.models.fitness import CatalogExercise, WorkoutExerciseRecord

    factory, user, _ = pg
    mutation = workout_mutation()
    with pytest.raises(ValidationError):
        await accept(factory, user, mutation)
    mutation["operation"] = "importLegacyWorkout"
    mutation["payload"]["exercises"][0]["exerciseSnapshot"] = {
        "name": "Old squat",
        "load": "weight",
    }
    await accept(factory, user, mutation)
    async with factory() as db:
        assert await db.scalar(select(func.count()).select_from(CatalogExercise)) == 0
        item = (await db.scalars(select(WorkoutExerciseRecord))).one()
        assert item.exercise_id == "barbell-squat" and item.catalog_exercise_id is None
        assert item.exercise_snapshot["name"] == "Old squat"
    mutation.update(mutationId=str(uuid4()), baseVersion=1, operation="upsert")
    mutation["payload"]["note"] = "edit retained legacy exercise"
    await accept(factory, user, mutation)
    mutation.update(mutationId=str(uuid4()), baseVersion=2)
    item = deepcopy(mutation["payload"]["exercises"][0])
    item.update(id=str(uuid4()), position=1)
    item["sets"] = []
    mutation["payload"]["exercises"].append(item)
    with pytest.raises(ValidationError):
        await accept(factory, user, mutation)


@pytest.mark.anyio
async def test_profile_plan_atomicity_immutability_and_derived_progress(pg):
    from app.db.models.fitness import ProfileRevision, TrainingPlan
    from app.schemas.fitness import TrainingState
    from app.services.fitness import FitnessService

    factory, user, _ = pg
    state = training_state()
    TrainingState.model_validate(state)
    mutation = {
        "schemaVersion": 1,
        "mutationId": str(uuid4()),
        "entityType": "trainingState",
        "entityId": "self",
        "baseVersion": 0,
        "operation": "upsert",
        "payload": state,
    }
    await accept(factory, user, mutation)
    changed = deepcopy(mutation)
    changed.update(mutationId=str(uuid4()), baseVersion=1)
    changed["payload"]["profile"]["name"] = "must require a new revision"
    with pytest.raises(AlreadyExistsError):
        await accept(factory, user, changed)
    async with factory() as db:
        assert await db.scalar(select(func.count()).select_from(ProfileRevision)) == 1
        assert await db.scalar(select(func.count()).select_from(TrainingPlan)) == 1
        current = await FitnessService(db).training_state(user)
        assert current.version == 1
    workout = workout_mutation()
    workout["operation"] = "importLegacyWorkout"
    await accept(factory, user, workout)
    async with factory() as db:
        svc = FitnessService(db)
        stats = await svc.stats(user, "Asia/Ho_Chi_Minh", datetime(2026, 11, 2, tzinfo=UTC))
        assert stats.completed_workouts == stats.completed_sets == 1
        assert stats.volume_kg == 400
        progress = await svc.progress(user, "barbell-squat", "UTC", None, 200)
        assert progress.items[0].best_kg == 80
        assert progress.items[0].e1rm == pytest.approx(80 * (1 + 5 / 30))


@pytest.mark.anyio
async def test_removed_child_identity_cannot_move_to_another_workout_or_exercise(pg):
    from app.db.models.fitness import SyncChangeRecord, WorkoutChildIdentity

    factory, user, _ = pg
    original = workout_mutation()
    original["operation"] = "importLegacyWorkout"
    await accept(factory, user, original)
    removed = deepcopy(original)
    removed.update(mutationId=str(uuid4()), baseVersion=1, operation="upsert")
    removed["payload"]["exercises"] = []
    await accept(factory, user, removed)
    another = workout_mutation()
    another["operation"] = "importLegacyWorkout"
    another["payload"]["exercises"] = deepcopy(original["payload"]["exercises"])
    with pytest.raises(AlreadyExistsError):
        await accept(factory, user, another)
    async with factory() as db:
        assert await db.scalar(select(func.count()).select_from(SyncChangeRecord)) == 2
        assert await db.scalar(select(func.count()).select_from(WorkoutChildIdentity)) == 2
    restored = deepcopy(original)
    restored.update(mutationId=str(uuid4()), baseVersion=2, operation="upsert")
    # Removed unknown legacy items cannot be newly attached by an ordinary write.
    with pytest.raises(ValidationError):
        await accept(factory, user, restored)


@pytest.mark.anyio
async def test_successful_commit_order_is_visible_before_later_cursor(pg):
    from app.schemas.fitness import SyncMutation
    from app.services.fitness import FitnessService

    factory, user, _ = pg
    first = workout_mutation()
    first["operation"] = "importLegacyWorkout"
    second = workout_mutation()
    second["operation"] = "importLegacyWorkout"
    async with factory() as db:
        a = await FitnessService(db).mutate(user, SyncMutation.model_validate(first))
        waiting = asyncio.create_task(accept(factory, user, second))
        await asyncio.sleep(0.05)
        assert not waiting.done()
        await db.commit()
        b = await asyncio.wait_for(waiting, 5)
    assert [a.change.revision, b.change.revision] == [1, 2]
    async with factory() as db:
        page = await FitnessService(db).changes(user, 0, 200)
        assert [str(change.mutation_id) for change in page.changes] == [
            first["mutationId"],
            second["mutationId"],
        ]


@pytest.mark.anyio
async def test_pinned_catalog_releases_preserve_retired_records_and_attribution(pg):
    from pathlib import Path

    from app.repositories.fitness_catalog import CatalogRepository
    from app.schemas.fitness_catalog import CatalogArtifact

    factory, _, _ = pg
    artifact = CatalogArtifact.model_validate_json(
        (Path(__file__).parents[1] / "data/exercise-catalog.json").read_bytes()
    )
    artifact.items = sorted(artifact.items, key=lambda item: item.id)[:3]
    async with factory.begin() as db:
        assert await CatalogRepository(db).publish(artifact) == artifact.revision
    async with factory.begin() as db:
        repo = CatalogRepository(db)
        assert await repo.publish(artifact) == artifact.revision
        first_page = await repo.page(None, None, 1, None, None, None, None)
        assert first_page.revision == artifact.revision and first_page.next_cursor
    newer = artifact.model_copy(deep=True)
    newer.revision = "newer-test-release"
    newer.items = newer.items[1:]
    newer.items[0].name = "Updated catalog title"
    async with factory.begin() as db:
        repo = CatalogRepository(db)
        await repo.publish(newer)
    async with factory() as db:
        repo = CatalogRepository(db)
        pinned = await repo.page(
            first_page.revision, first_page.next_cursor, 200, None, None, None, None
        )
        assert pinned.items[0].name != "Updated catalog title"
        latest = await repo.page(None, None, 200, None, None, None, None)
        assert latest.revision == newer.revision
        retired = await repo.exercise(artifact.items[0].id, None)
        assert retired.id == artifact.items[0].id
    changed_same_revision = artifact.model_copy(deep=True)
    changed_same_revision.attribution = "different source credits"
    with pytest.raises(AlreadyExistsError):
        async with factory.begin() as db:
            await CatalogRepository(db).publish(changed_same_revision)


@pytest.mark.anyio
async def test_read_routes_restore_owned_aggregates_and_week_timezone(pg):
    from pathlib import Path

    from fastapi import FastAPI
    from httpx import ASGITransport, AsyncClient

    from app.api.deps import get_current_user, get_db_session
    from app.api.exception_handlers import register_exception_handlers
    from app.api.routes.v1.fitness import router
    from app.repositories.fitness_catalog import CatalogRepository
    from app.schemas.fitness_catalog import CatalogArtifact
    from app.services.fitness import FitnessService

    factory, user, other = pg
    test_app = FastAPI()
    test_app.include_router(router)
    register_exception_handlers(test_app)

    async def current_user():
        return user

    async def session():
        async with factory.begin() as db:
            yield db

    test_app.dependency_overrides[get_current_user] = current_user
    test_app.dependency_overrides[get_db_session] = session
    artifact = CatalogArtifact.model_validate_json(
        (Path(__file__).parents[1] / "data/exercise-catalog.json").read_bytes()
    )
    artifact.items = artifact.items[:3]
    async with factory.begin() as db:
        await CatalogRepository(db).publish(artifact)
    state = training_state()
    async with AsyncClient(transport=ASGITransport(app=test_app), base_url="http://test") as client:
        for path in ("/users/me/training-state", "/users/me/settings"):
            response = await client.get(path)
            assert response.status_code == 200 and response.json()["version"] == 0
        training = {
            "schemaVersion": 1,
            "mutationId": str(uuid4()),
            "entityType": "trainingState",
            "entityId": "self",
            "baseVersion": 0,
            "operation": "upsert",
            "payload": state,
        }
        response = await client.post("/sync/mutations", json=training)
        assert response.status_code == 200, response.text
        response = await client.get("/users/me/training-state")
        assert response.json()["payload"] == state
        assert (await client.get("/training-plans")).json()["items"] == [state["plan"]]
        assert (await client.get("/training-plans/" + state["plan"]["id"])).json() == state["plan"]
        settings = {
            **training,
            "mutationId": str(uuid4()),
            "entityType": "settings",
            "payload": {
                "unit": "lb",
                "restSeconds": 120,
                "demoStyle": "photo",
                "timeZone": "America/New_York",
            },
        }
        assert (await client.post("/sync/mutations", json=settings)).status_code == 200
        assert (await client.get("/users/me/settings")).json()["payload"] == settings["payload"]
        mutation = workout_mutation()
        mutation["payload"]["exercises"][0]["exerciseId"] = artifact.items[0].id
        # Monday 00:30 UTC is still Sunday in New York.
        mutation["payload"].update(startedAt="2026-11-02T00:10:00Z", endedAt="2026-11-02T00:30:00Z")
        response = await client.post("/sync/mutations", json=mutation)
        assert response.status_code == 200, response.text
        workout_id = mutation["entityId"]
        detail = await client.get("/workouts/" + workout_id)
        assert detail.json()["payload"] == mutation["payload"]
        assert len((await client.get("/workouts?status=completed")).json()["items"]) == 1
        assert (await client.get("/workouts?status=open")).json()["items"] == []
        second_workout = workout_mutation()
        second_workout["operation"] = "importLegacyWorkout"
        await accept(factory, user, second_workout)
        first_page = (await client.get("/workouts?limit=1")).json()
        assert first_page["nextCursor"]
        second_page = (
            await client.get("/workouts", params={"limit": 1, "cursor": first_page["nextCursor"]})
        ).json()
        assert second_page["items"][0]["entityId"] != first_page["items"][0]["entityId"]
        assert (await client.get("/workouts?cursor=malformed")).status_code == 400
        catalog = (await client.get("/exercises?limit=1")).json()
        assert catalog["revision"] == artifact.revision
        assert (await client.get("/exercises/" + artifact.items[0].id)).status_code == 200
        progress = await client.get(
            "/exercises/" + artifact.items[0].id + "/progress?timeZone=America/New_York"
        )
        assert progress.status_code == 200 and progress.json()["items"][0]["volumeKg"] == 400
        assert (await client.get("/users/me/stats?timeZone=Unknown/Zone")).status_code == 400
        async with factory() as db:
            now = datetime(2026, 11, 2, 12, tzinfo=UTC)
            utc = await FitnessService(db).stats(user, "UTC", now)
            new_york = await FitnessService(db).stats(user, "America/New_York", now)
            assert utc.this_week_workouts == 1 and new_york.this_week_workouts == 0
        user = other
        assert (await client.get("/workouts/" + workout_id)).status_code == 404
        assert (await client.get("/training-plans/" + state["plan"]["id"])).status_code == 404
        assert (await client.get("/training-plans")).json()["items"] == []
        assert (await client.get("/workouts")).json()["items"] == []


@pytest.mark.anyio
async def test_week_buckets_and_streak_use_distinct_local_days_across_dst(pg):
    from app.services.fitness import FitnessService

    factory, user, _ = pg
    starts = [
        "2026-11-09T14:00:00Z",
        "2026-11-09T15:00:00Z",
        "2026-11-02T14:00:00Z",
        "2026-11-05T14:00:00Z",
        "2026-10-26T14:00:00Z",
        "2026-10-28T14:00:00Z",
        "2026-10-19T14:00:00Z",
    ]
    for start in starts:
        mutation = workout_mutation()
        mutation["operation"] = "importLegacyWorkout"
        mutation["payload"].update(startedAt=start, endedAt=start, updatedAt=start)
        await accept(factory, user, mutation)
    async with factory() as db:
        now = datetime(2026, 11, 9, 18, tzinfo=UTC)
        stats = await FitnessService(db).stats(user, "America/New_York", now, weeks=3, goal=2)
        assert stats.week_streak == 2
        assert stats.weekly_progress.model_dump() == {"done": 1, "goal": 2, "met": False}
        assert [
            (week.week_start, week.sessions, week.volume_kg) for week in stats.weekly_buckets
        ] == [
            ("2026-10-26T04:00:00Z", 2, 800),
            ("2026-11-02T05:00:00Z", 2, 800),
            ("2026-11-09T05:00:00Z", 2, 800),
        ]
        assert stats.this_week_workouts == 2 and stats.completed_workouts == 7


@pytest.mark.anyio
async def test_collided_legacy_import_requires_current_version_for_explicit_resolution(pg):
    from app.services.fitness import FitnessService

    factory, user, _ = pg
    original = workout_mutation()
    original["operation"] = "importLegacyWorkout"
    await accept(factory, user, original)

    local = deepcopy(original)
    local["mutationId"] = str(uuid4())
    local["payload"]["note"] = "Explicitly keep this local historical snapshot"
    historical_item = {
        "id": str(uuid4()),
        "exerciseId": "unknown-historical-movement",
        "position": 1,
        "note": "Preserve legacy metadata",
        "sets": [],
        "exerciseSnapshot": {"name": "Historical movement", "load": "bodyweight"},
    }
    local["payload"]["exercises"].append(historical_item)
    with pytest.raises(AlreadyExistsError) as collision:
        await accept(factory, user, local)
    assert collision.value.details["current"]["version"] == 1

    # User reconciliation freezes a new intent against the displayed server
    # version, retaining the import operation for unknown historical children.
    resolution = deepcopy(local)
    resolution.update(mutationId=str(uuid4()), baseVersion=1)
    ack = await accept(factory, user, resolution)
    assert ack.change.version == 2
    assert ack.change.payload.exercises[1].exercise_snapshot.name == "Historical movement"
    assert ack.change.payload.exercises[1].exercise_id == "unknown-historical-movement"
    assert (await accept(factory, user, resolution)).model_dump() == ack.model_dump()

    stale = deepcopy(resolution)
    stale["mutationId"] = str(uuid4())
    with pytest.raises(AlreadyExistsError) as conflict:
        await accept(factory, user, stale)
    assert conflict.value.details["current"]["version"] == 2

    deleted = deepcopy(resolution)
    deleted.update(mutationId=str(uuid4()), baseVersion=2, operation="delete")
    deleted["payload"]["deletedAt"] = "2026-11-03T00:00:00Z"
    await accept(factory, user, deleted)
    resurrection = deepcopy(resolution)
    resurrection.update(mutationId=str(uuid4()), baseVersion=3)
    with pytest.raises(AlreadyExistsError) as tombstone:
        await accept(factory, user, resurrection)
    assert tombstone.value.details["current"]["operation"] == "delete"
    async with factory() as db:
        page = await FitnessService(db).changes(user, 0, 200)
        assert [change.version for change in page.changes] == [1, 2, 3]
