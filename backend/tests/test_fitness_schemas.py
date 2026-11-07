"""Wire validation deliberately mirrors the shared TypeScript sync boundary."""

import importlib.util
import json
from copy import deepcopy
from pathlib import Path
from uuid import uuid4

import pytest
from pydantic import ValidationError


def workout_mutation():
    workout_id = str(uuid4())
    return {
        "schemaVersion": 1,
        "mutationId": str(uuid4()),
        "entityType": "workout",
        "entityId": workout_id,
        "baseVersion": 0,
        "operation": "upsert",
        "payload": {
            "id": workout_id,
            "userId": "user_fitness_test",
            "startedAt": "2026-11-01T12:00:00Z",
            "endedAt": "2026-11-01T13:00:00Z",
            "updatedAt": "2026-11-01T13:00:00Z",
            "deletedAt": None,
            "note": "Preserve this note",
            "exercises": [
                {
                    "id": str(uuid4()),
                    "exerciseId": "barbell-squat",
                    "position": 0,
                    "note": None,
                    "sets": [
                        {
                            "id": str(uuid4()),
                            "position": 0,
                            "kg": 80,
                            "reps": 5,
                            "isWarmup": False,
                            "completedAt": "2026-11-01T12:30:00Z",
                        }
                    ],
                }
            ],
        },
    }


def schema():
    assert importlib.util.find_spec("app.schemas.fitness") is not None, "sync schema is missing"
    from app.schemas.fitness import SyncMutation

    return SyncMutation


def test_workout_round_trips_camel_case_and_utc():
    mutation = workout_mutation()
    assert schema().model_validate(mutation).model_dump(mode="json", by_alias=True) == mutation


@pytest.mark.parametrize(
    "change",
    [
        lambda m: m.update(entityType="settings"),
        lambda m: m.update(operation="delete"),
        lambda m: m.update(extra=True),
        lambda m: m["payload"].update(startedAt="2026-11-01T12:00:00+07:00"),
        lambda m: m["payload"]["exercises"].append(deepcopy(m["payload"]["exercises"][0])),
        lambda m: m["payload"]["exercises"][0]["sets"].append(
            deepcopy(m["payload"]["exercises"][0]["sets"][0])
        ),
        lambda m: m["payload"].update(id=str(uuid4())),
        lambda m: m.update(baseVersion=True),
        lambda m: m["payload"]["exercises"][0].update(exerciseSnapshot=None),
    ],
)
def test_rejects_invalid_envelopes_and_duplicate_children(change):
    mutation = workout_mutation()
    change(mutation)
    with pytest.raises(ValidationError):
        schema().model_validate(mutation)


def test_settings_rejects_illegal_delete_and_unknown_timezone():
    mutation = workout_mutation()
    mutation.update(
        entityType="settings",
        entityId="self",
        payload={
            "unit": "kg",
            "restSeconds": 90,
            "demoStyle": "art",
            "timeZone": "Asia/Ho_Chi_Minh",
        },
    )
    schema().model_validate(mutation)
    mutation["operation"] = "delete"
    with pytest.raises(ValidationError):
        schema().model_validate(mutation)
    mutation["operation"] = "upsert"
    mutation["payload"]["timeZone"] = "Unknown/Place"
    with pytest.raises(ValidationError):
        schema().model_validate(mutation)


def training_state():
    revision_id = str(uuid4())
    return {
        "profileRevisionId": revision_id,
        "profile": {
            "name": "Lifter",
            "sex": "male",
            "age": 30,
            "heightCm": 180,
            "weightKg": 80,
            "goal": "buildMuscle",
            "experience": "beginner",
            "daysPerWeek": 3,
            "sessionMinutes": 60,
            "place": "gym",
            "activity": "desk",
            "pace": "standard",
            "updatedAt": "2026-11-01T00:00:00Z",
        },
        "plan": {
            "id": str(uuid4()),
            "kind": "legacySummary",
            "calculationVersion": "1",
            "profileRevisionId": revision_id,
            "createdAt": "2026-11-01T00:00:00Z",
            "result": {
                "phase": "leanBulk",
                "bmr": 1800,
                "tdee": 2400,
                "calories": 2600,
                "proteinG": 145,
                "fatG": 70,
                "carbsG": 300,
                "waterMl": 3000,
                "weeklyChangeKg": 0.2,
                "split": "fullBody",
                "setsPerMuscle": 10,
                "exercisesPerSession": 6,
                "repRange": [6, 12],
                "restSeconds": 90,
                "equipment": ["barbell", "bodyweight"],
                "bmi": 24.7,
            },
        },
        "onboardingCompletedAt": "2026-11-01T00:00:00Z",
    }


def test_shared_typescript_workout_fixture_and_profile_plan_compatibility():
    fixture = json.loads(
        (Path(__file__).parents[2] / "frontend/packages/contracts/fixtures/sync.json").read_text()
    )
    assert schema().model_validate(fixture).model_dump(mode="json", by_alias=True) == fixture
    from app.schemas.fitness import TrainingState

    state = training_state()
    assert TrainingState.model_validate(state).model_dump(mode="json", by_alias=True) == state
    state["plan"]["profileRevisionId"] = str(uuid4())
    with pytest.raises(ValidationError):
        TrainingState.model_validate(state)


@pytest.mark.parametrize(
    "change",
    [
        lambda m: m.update(schemaVersion=True),
        lambda m: m["payload"]["exercises"][0]["sets"][0].update(kg="80"),
        lambda m: m["payload"]["exercises"][0]["sets"][0].update(kg=True),
    ],
)
def test_wire_numbers_do_not_coerce_strings_or_booleans(change):
    mutation = workout_mutation()
    change(mutation)
    with pytest.raises(ValidationError):
        schema().model_validate(mutation)


def test_change_and_feed_schema_reject_inconsistent_payloads_and_cursor_order():
    from app.schemas.fitness import SyncChange, SyncPage

    mutation = workout_mutation()
    change = {
        key: value for key, value in mutation.items() if key not in {"schemaVersion", "baseVersion"}
    }
    change.update(revision=1, version=1)
    SyncChange.model_validate(change)
    invalid = {**change, "operation": "delete"}
    with pytest.raises(ValidationError):
        SyncChange.model_validate(invalid)
    with pytest.raises(ValidationError):
        SyncPage.model_validate({"changes": [change, change], "nextCursor": 1, "hasMore": False})


def test_progress_preserves_existing_e1rm_wire_spelling():
    from app.schemas.fitness import ProgressPoint

    point = ProgressPoint(
        workout_id=uuid4(),
        started_at="2026-11-01T12:00:00Z",
        ended_at="2026-11-01T13:00:00Z",
        completed_sets=1,
        volume_kg=400,
        best_kg=80,
        best_reps=5,
        e1rm=80 * (1 + 5 / 30),
    )
    assert "e1rm" in point.model_dump(mode="json", by_alias=True)
