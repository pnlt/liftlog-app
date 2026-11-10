"""Strict camelCase boundaries shared with packages/contracts/src/sync.ts."""

import re
from datetime import datetime
from typing import Annotated, Literal, Self
from urllib.parse import urlparse
from uuid import UUID
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from pydantic import (
    AfterValidator,
    BaseModel,
    ConfigDict,
    Field,
    StrictBool,
    StrictFloat,
    StrictInt,
    StringConstraints,
    field_validator,
    model_validator,
)
from pydantic.alias_generators import to_camel


def utc_instant(value: str) -> str:
    if not re.fullmatch(r"\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?Z", value):
        raise ValueError("Expected a UTC ISO instant ending in Z")
    datetime.fromisoformat(value)
    return value


Instant = Annotated[str, AfterValidator(utc_instant)]
Position = Annotated[StrictInt, Field(ge=0, le=1_000_000)]
Nonnegative = Annotated[StrictInt, Field(ge=0)]
Positive = Annotated[StrictInt, Field(gt=0)]
Load = Literal["weight", "bodyweight", "time"]
Equipment = Literal[
    "barbell",
    "dumbbell",
    "kettlebell",
    "bench",
    "rack",
    "cable",
    "machine",
    "pullupBar",
    "band",
    "bodyweight",
]
Muscle = Literal[
    "chest",
    "lats",
    "upperBack",
    "traps",
    "shoulders",
    "biceps",
    "triceps",
    "forearms",
    "abs",
    "obliques",
    "lowerBack",
    "glutes",
    "quads",
    "hamstrings",
    "calves",
]


class WireModel(BaseModel):
    model_config = ConfigDict(
        alias_generator=to_camel,
        populate_by_name=True,
        extra="forbid",
        allow_inf_nan=False,
    )


class ExerciseSnapshot(WireModel):
    name: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=200)]
    load: Load


class WorkoutSet(WireModel):
    id: UUID
    position: Position
    kg: Annotated[StrictFloat, Field(ge=0, le=10_000)] | None
    reps: Position | None
    is_warmup: StrictBool
    completed_at: Instant | None


class WorkoutExercise(WireModel):
    id: UUID
    exercise_id: str = Field(min_length=1, max_length=255)
    position: Position
    note: str | None = Field(max_length=2000)
    sets: list[WorkoutSet] = Field(max_length=200)
    exercise_snapshot: ExerciseSnapshot | None = Field(default=None, exclude_if=lambda x: x is None)

    @field_validator("exercise_snapshot", mode="before")
    @classmethod
    def optional_snapshot_is_not_null(cls, value):
        if value is None:
            raise ValueError("Omit an absent exerciseSnapshot instead of null")
        return value


class SyncWorkout(WireModel):
    id: UUID
    user_id: str = Field(min_length=1, max_length=255)
    started_at: Instant
    ended_at: Instant | None
    note: str | None = Field(max_length=2000)
    exercises: list[WorkoutExercise] = Field(max_length=100)
    updated_at: Instant
    deleted_at: Instant | None

    @model_validator(mode="after")
    def unique_children(self) -> Self:
        ids: set[UUID] = set()
        positions: set[int] = set()
        for exercise in self.exercises:
            if exercise.id in ids or exercise.position in positions:
                raise ValueError("Duplicate exercise ID or position")
            ids.add(exercise.id)
            positions.add(exercise.position)
            set_positions: set[int] = set()
            for item in exercise.sets:
                if item.id in ids or item.position in set_positions:
                    raise ValueError("Duplicate set ID or position")
                ids.add(item.id)
                set_positions.add(item.position)
        if self.ended_at and datetime.fromisoformat(self.ended_at) < datetime.fromisoformat(
            self.started_at
        ):
            raise ValueError("Session ends before it starts")
        return self


class UserProfile(WireModel):
    name: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=40)]
    sex: Literal["male", "female"]
    age: Annotated[StrictInt, Field(ge=13, le=100)]
    height_cm: StrictFloat = Field(ge=120, le=230)
    weight_kg: StrictFloat = Field(ge=30, le=300)
    goal: Literal["loseFat", "buildMuscle", "getStronger", "stayFit"]
    experience: Literal["new", "beginner", "intermediate", "advanced"]
    days_per_week: Annotated[StrictInt, Field(ge=1, le=7)]
    session_minutes: Annotated[StrictInt, Field(ge=15, le=180)]
    place: Literal["gym", "home", "bodyweight"]
    activity: Literal["desk", "onFeet", "physical"]
    pace: Literal["steady", "standard", "fast"]
    updated_at: Instant


class PlanSummary(WireModel):
    phase: Literal["cut", "recomp", "maintain", "leanBulk"]
    bmr: StrictFloat = Field(gt=0)
    tdee: StrictFloat = Field(gt=0)
    calories: StrictFloat = Field(ge=0)
    protein_g: StrictFloat = Field(ge=0)
    fat_g: StrictFloat = Field(ge=0)
    carbs_g: StrictFloat = Field(ge=0)
    water_ml: StrictFloat = Field(ge=0)
    weekly_change_kg: StrictFloat
    split: Literal["fullBody", "upperLower", "pushPullLegs", "hybrid"]
    sets_per_muscle: Positive
    exercises_per_session: Positive
    rep_range: tuple[Positive, Positive]
    rest_seconds: Annotated[StrictInt, Field(ge=0, le=600)]
    equipment: list[Equipment]
    bmi: StrictFloat = Field(gt=0)


class LegacyPlanSnapshot(WireModel):
    id: UUID
    kind: Literal["legacySummary"]
    calculation_version: Literal["1"]
    profile_revision_id: UUID
    created_at: Instant
    result: PlanSummary


class TrainingState(WireModel):
    profile_revision_id: UUID | None
    profile: UserProfile | None
    plan: LegacyPlanSnapshot | None
    onboarding_completed_at: Instant | None

    @model_validator(mode="after")
    def consistent_profile(self) -> Self:
        if (self.profile is None) != (self.profile_revision_id is None):
            raise ValueError("Profile revision is required with profile")
        if self.plan and (
            not self.profile or self.plan.profile_revision_id != self.profile_revision_id
        ):
            raise ValueError("Plan belongs to another profile revision")
        if self.onboarding_completed_at and not self.profile:
            raise ValueError("Completed onboarding requires a profile")
        return self


class SyncedSettings(WireModel):
    unit: Literal["kg", "lb"]
    rest_seconds: Annotated[StrictInt, Field(ge=0, le=600)]
    demo_style: Literal["art", "photo"]
    time_zone: str = Field(min_length=1, max_length=100)

    @field_validator("time_zone")
    @classmethod
    def known_zone(cls, value: str) -> str:
        try:
            ZoneInfo(value)
        except (ZoneInfoNotFoundError, ValueError):
            raise ValueError("Unknown time zone") from None
        return value


SyncPayload = SyncWorkout | TrainingState | SyncedSettings
EntityType = Literal["workout", "trainingState", "settings"]


class SyncMutation(WireModel):
    schema_version: Literal[1]
    mutation_id: UUID
    entity_type: EntityType
    entity_id: str
    base_version: Nonnegative
    operation: Literal["upsert", "delete", "importLegacyWorkout"]
    payload: SyncPayload

    @field_validator("schema_version", mode="before")
    @classmethod
    def exact_schema_version(cls, value):
        if type(value) is not int or value != 1:
            raise ValueError("Unsupported schema version")
        return value

    @model_validator(mode="after")
    def matching_payload(self) -> Self:
        if self.entity_type == "workout":
            if not isinstance(self.payload, SyncWorkout) or self.entity_id != str(self.payload.id):
                raise ValueError("Workout payload/ID mismatch")
            if self.operation == "delete" and self.payload.deleted_at is None:
                raise ValueError("Deletion needs a tombstone")
        elif self.entity_id != "self" or self.operation != "upsert":
            raise ValueError("Singletons only support upsert of self")
        elif self.entity_type == "settings" and not isinstance(self.payload, SyncedSettings):
            raise ValueError("Settings payload mismatch")
        elif self.entity_type == "trainingState" and not isinstance(self.payload, TrainingState):
            raise ValueError("Training state payload mismatch")
        return self


class SyncChange(WireModel):
    revision: Positive
    mutation_id: UUID
    entity_type: EntityType
    entity_id: str
    version: Positive
    operation: Literal["upsert", "delete"]
    payload: SyncPayload

    @model_validator(mode="after")
    def consistent_change(self) -> Self:
        SyncMutation(
            schema_version=1,
            mutation_id=self.mutation_id,
            entity_type=self.entity_type,
            entity_id=self.entity_id,
            base_version=0,
            operation=self.operation,
            payload=self.payload,
        )
        if isinstance(self.payload, SyncWorkout) and (
            (self.operation == "delete") != (self.payload.deleted_at is not None)
        ):
            raise ValueError("Inconsistent workout change")
        return self


class SyncAck(WireModel):
    mutation_id: UUID
    change: SyncChange


class SyncPage(WireModel):
    changes: list[SyncChange] = Field(max_length=200)
    next_cursor: Nonnegative
    has_more: StrictBool

    @model_validator(mode="after")
    def ordered_page(self) -> Self:
        previous = 0
        for change in self.changes:
            if change.revision <= previous or change.revision > self.next_cursor:
                raise ValueError("Invalid change cursor ordering")
            previous = change.revision
        if self.has_more and not self.changes:
            raise ValueError("An empty page cannot advance")
        return self


class Exercise(WireModel):
    id: str = Field(min_length=1, max_length=255)
    name: str = Field(min_length=1)
    primary_muscles: list[Muscle] = Field(min_length=1)
    secondary_muscles: list[Muscle] = Field(default_factory=list)
    equipment: list[Equipment] = Field(min_length=1)
    load: Load
    instructions: list[Annotated[str, Field(min_length=1)]] = Field(default_factory=list)
    tips: list[Annotated[str, Field(min_length=1)]] = Field(default_factory=list)
    image_url: str | None = None
    frames: list[str] = Field(default_factory=list)
    video_url: str | None = None
    updated_at: Instant

    @field_validator("image_url", "video_url")
    @classmethod
    def valid_url(cls, value: str | None) -> str | None:
        if value is not None and not urlparse(value).scheme:
            raise ValueError("Expected an absolute URL")
        return value

    @field_validator("frames")
    @classmethod
    def valid_frames(cls, values: list[str]) -> list[str]:
        for value in values:
            cls.valid_url(value)
        return values


class CatalogPage(WireModel):
    revision: str
    items: list[Exercise] = Field(max_length=200)
    next_cursor: str | None


class VersionedTrainingState(WireModel):
    version: Nonnegative
    payload: TrainingState


class VersionedSettings(WireModel):
    version: Nonnegative
    payload: SyncedSettings


class WorkoutPage(WireModel):
    items: list[SyncChange]
    next_cursor: str | None


class PlanPage(WireModel):
    items: list[LegacyPlanSnapshot]
    next_cursor: str | None


class WeekBucket(WireModel):
    week_start: Instant
    sessions: Nonnegative
    volume_kg: StrictFloat


class WeeklyProgress(WireModel):
    done: Nonnegative
    goal: Positive
    met: StrictBool


class FitnessStats(WireModel):
    time_zone: str
    completed_workouts: Nonnegative
    completed_sets: Nonnegative
    volume_kg: StrictFloat
    this_week_workouts: Nonnegative
    weekly_buckets: list[WeekBucket]
    week_streak: Nonnegative
    weekly_progress: WeeklyProgress


class ProgressPoint(WireModel):
    workout_id: UUID
    started_at: Instant
    ended_at: Instant
    completed_sets: Nonnegative
    volume_kg: StrictFloat
    best_kg: StrictFloat | None
    best_reps: int | None
    e1rm: StrictFloat | None = Field(alias="e1rm")


class ProgressPage(WireModel):
    exercise_id: str
    time_zone: str
    items: list[ProgressPoint]
    next_cursor: str | None
