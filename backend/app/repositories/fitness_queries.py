"""Owned, paginated canonical reads and aggregates over normalized workouts."""

import base64
import json
from datetime import UTC, datetime, timedelta
from uuid import UUID
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from sqlalchemy import Date, and_, case, cast, func, select, tuple_
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.exceptions import BadRequestError, NotFoundError
from app.db.models.fitness import (
    SyncChangeRecord,
    TrainingPlan,
    TrainingStateRecord,
    UserSettingsRecord,
    WorkoutExerciseRecord,
    WorkoutSessionRecord,
    WorkoutSetRecord,
)
from app.repositories.fitness import change_schema
from app.schemas.fitness import (
    FitnessStats,
    LegacyPlanSnapshot,
    PlanPage,
    ProgressPage,
    ProgressPoint,
    SyncWorkout,
    TrainingState,
    VersionedSettings,
    VersionedTrainingState,
    WeekBucket,
    WeeklyProgress,
    WorkoutPage,
)


def zone(value: str) -> ZoneInfo:
    try:
        return ZoneInfo(value)
    except (ZoneInfoNotFoundError, ValueError):
        raise BadRequestError(message="Unknown time zone") from None


def encode_cursor(date: datetime, identifier: UUID) -> str:
    return base64.urlsafe_b64encode(
        json.dumps([date.isoformat(), str(identifier)]).encode()
    ).decode()


def utc_stamp(value: datetime | None) -> str:
    if value is None:
        raise ValueError("Expected a completed workout timestamp")
    return value.astimezone(UTC).isoformat().replace("+00:00", "Z")


def decode_cursor(value: str) -> tuple[datetime, UUID]:
    try:
        if len(value) > 300:
            raise ValueError
        date, identifier = json.loads(base64.b64decode(value, altchars=b"-_", validate=True))
        parsed = datetime.fromisoformat(date)
        if parsed.tzinfo is None:
            raise ValueError
        return parsed, UUID(identifier)
    except (ValueError, TypeError, KeyError, UnicodeError):
        raise BadRequestError(message="Invalid pagination cursor") from None


class FitnessQueries:
    def __init__(self, db: AsyncSession):
        self.db = db

    async def training_state(
        self, user_id: UUID, onboarding: datetime | None
    ) -> VersionedTrainingState:
        row = await self.db.get(TrainingStateRecord, user_id)
        # Template users can have onboarding set before this migration. No profile
        # can be inferred from it; bootstrap still exposes that historical flag.
        return VersionedTrainingState(
            version=row.version if row else 0,
            payload=row.payload
            if row
            else TrainingState(
                profile_revision_id=None,
                profile=None,
                plan=None,
                onboarding_completed_at=None,
            ),
        )

    async def settings(self, user_id: UUID) -> VersionedSettings:
        row = await self.db.get(UserSettingsRecord, user_id)
        return VersionedSettings(
            version=row.version if row else 0,
            payload=row.payload
            if row
            else {
                "unit": "kg",
                "restSeconds": 90,
                "demoStyle": "art",
                "timeZone": "UTC",
            },
        )

    def workout_change_query(self, user_id: UUID):
        return (
            select(SyncChangeRecord)
            .join(
                WorkoutSessionRecord,
                and_(
                    SyncChangeRecord.entity_type == "workout",
                    SyncChangeRecord.entity_id
                    == func.cast(WorkoutSessionRecord.id, SyncChangeRecord.entity_id.type),
                    SyncChangeRecord.version == WorkoutSessionRecord.version,
                    SyncChangeRecord.user_id == WorkoutSessionRecord.user_id,
                ),
            )
            .where(WorkoutSessionRecord.user_id == user_id)
        )

    async def workout(self, user_id: UUID, workout_id: UUID):
        row = await self.db.scalar(
            self.workout_change_query(user_id).where(WorkoutSessionRecord.id == workout_id)
        )
        if row is None:
            raise NotFoundError(message="Workout not found")
        return change_schema(row)

    async def workouts(
        self,
        user_id: UUID,
        cursor: str | None,
        limit: int,
        status: str | None,
        include_deleted: bool,
    ) -> WorkoutPage:
        query = self.workout_change_query(user_id)
        if not include_deleted:
            query = query.where(WorkoutSessionRecord.deleted_at.is_(None))
        if status == "open":
            query = query.where(WorkoutSessionRecord.ended_at.is_(None))
        elif status == "completed":
            query = query.where(WorkoutSessionRecord.ended_at.is_not(None))
        if cursor:
            query = query.where(
                tuple_(WorkoutSessionRecord.started_at, WorkoutSessionRecord.id)
                < decode_cursor(cursor)
            )
        rows = list(
            (
                await self.db.scalars(
                    query.order_by(
                        WorkoutSessionRecord.started_at.desc(),
                        WorkoutSessionRecord.id.desc(),
                    ).limit(limit + 1)
                )
            ).all()
        )
        items = [change_schema(row) for row in rows[:limit]]
        next_cursor = None
        if len(rows) > limit:
            last = SyncWorkout.model_validate(rows[limit - 1].payload)
            next_cursor = encode_cursor(datetime.fromisoformat(last.started_at), last.id)
        return WorkoutPage(items=items, next_cursor=next_cursor)

    async def plans(self, user_id: UUID, cursor: str | None, limit: int) -> PlanPage:
        query = select(TrainingPlan).where(TrainingPlan.user_id == user_id)
        if cursor:
            query = query.where(
                tuple_(TrainingPlan.created_at, TrainingPlan.id) < decode_cursor(cursor)
            )
        rows = list(
            (
                await self.db.scalars(
                    query.order_by(
                        TrainingPlan.created_at.desc(),
                        TrainingPlan.id.desc(),
                    ).limit(limit + 1)
                )
            ).all()
        )
        return PlanPage(
            items=[row.payload for row in rows[:limit]],
            next_cursor=encode_cursor(rows[limit - 1].created_at, rows[limit - 1].id)
            if len(rows) > limit
            else None,
        )

    async def plan(self, user_id: UUID, plan_id: UUID) -> LegacyPlanSnapshot:
        row = await self.db.scalar(
            select(TrainingPlan).where(TrainingPlan.id == plan_id, TrainingPlan.user_id == user_id)
        )
        if row is None:
            raise NotFoundError(message="Training plan not found")
        return LegacyPlanSnapshot.model_validate(row.payload)

    def completed_sessions(self, user_id: UUID):
        return (
            WorkoutSessionRecord.user_id == user_id,
            WorkoutSessionRecord.ended_at.is_not(None),
            WorkoutSessionRecord.deleted_at.is_(None),
        )

    def completed_sets(self, user_id: UUID):
        return (
            select(WorkoutSetRecord)
            .join(WorkoutExerciseRecord)
            .join(WorkoutSessionRecord)
            .where(
                *self.completed_sessions(user_id),
                WorkoutSetRecord.completed_at.is_not(None),
                WorkoutSetRecord.is_warmup.is_(False),
            )
        )

    async def stats(
        self, user_id: UUID, time_zone: str, now: datetime | None, weeks: int = 8, goal: int = 1
    ) -> FitnessStats:
        display_zone = zone(time_zone)
        today = (now or datetime.now(UTC)).astimezone(display_zone)
        monday = (today - timedelta(days=today.weekday())).replace(
            hour=0, minute=0, second=0, microsecond=0
        )
        # Summarize each completed session first so its exercises/sets cannot
        # multiply session counts. Group by the local calendar, including DST.
        session_totals = (
            select(
                WorkoutSessionRecord.id,
                WorkoutSessionRecord.started_at,
                func.coalesce(
                    func.sum(
                        case(
                            (
                                and_(
                                    WorkoutSetRecord.completed_at.is_not(None),
                                    WorkoutSetRecord.is_warmup.is_(False),
                                ),
                                WorkoutSetRecord.kg * WorkoutSetRecord.reps,
                            ),
                            else_=0,
                        )
                    ),
                    0,
                ).label("volume"),
            )
            .select_from(WorkoutSessionRecord)
            .outerjoin(WorkoutExerciseRecord)
            .outerjoin(WorkoutSetRecord)
            .where(
                *self.completed_sessions(user_id),
            )
            .group_by(WorkoutSessionRecord.id)
            .subquery()
        )
        local_start = func.timezone(time_zone, session_totals.c.started_at)
        local_week = func.date_trunc("week", local_start)
        rows = (
            await self.db.execute(
                select(
                    local_week,
                    func.count(),
                    func.sum(session_totals.c.volume),
                    func.count(func.distinct(cast(local_start, Date))),
                ).group_by(local_week)
            )
        ).all()
        by_week = {row[0].date(): row for row in rows}
        current_week = by_week.get(monday.date())
        done = current_week[3] if current_week else 0
        streak = int(done >= goal)
        prior = monday - timedelta(days=7)
        while prior.date() in by_week and by_week[prior.date()][3] >= goal:
            streak += 1
            prior -= timedelta(days=7)
        buckets = []
        for offset in reversed(range(weeks)):
            start = monday - timedelta(days=7 * offset)
            row = by_week.get(start.date())
            buckets.append(
                WeekBucket(
                    week_start=start.astimezone(UTC).isoformat().replace("+00:00", "Z"),
                    sessions=row[1] if row else 0,
                    volume_kg=row[2] if row else 0,
                )
            )
        sets = self.completed_sets(user_id).subquery()
        count, volume = (
            await self.db.execute(
                select(
                    func.count(),
                    func.coalesce(func.sum(sets.c.kg * sets.c.reps), 0),
                ).select_from(sets)
            )
        ).one()
        return FitnessStats(
            time_zone=time_zone,
            completed_workouts=sum(row[1] for row in rows),
            completed_sets=count,
            volume_kg=volume,
            this_week_workouts=current_week[1] if current_week else 0,
            weekly_buckets=buckets,
            week_streak=streak,
            weekly_progress=WeeklyProgress(done=done, goal=goal, met=done >= goal),
        )

    async def progress(
        self, user_id: UUID, exercise_id: str, time_zone: str, cursor: str | None, limit: int
    ) -> ProgressPage:
        zone(time_zone)
        query = (
            select(
                WorkoutSessionRecord.id,
                WorkoutSessionRecord.ended_at,
                func.count(WorkoutSetRecord.id),
                func.coalesce(func.sum(WorkoutSetRecord.kg * WorkoutSetRecord.reps), 0),
                func.max(WorkoutSetRecord.kg),
                func.max(WorkoutSetRecord.reps),
                WorkoutSessionRecord.started_at,
                func.max(
                    case(
                        (
                            and_(WorkoutSetRecord.kg > 0, WorkoutSetRecord.reps > 0),
                            WorkoutSetRecord.kg * (1 + WorkoutSetRecord.reps / 30),
                        ),
                        else_=None,
                    )
                ),
            )
            .select_from(WorkoutSessionRecord)
            .join(WorkoutExerciseRecord)
            .join(WorkoutSetRecord)
            .where(
                *self.completed_sessions(user_id),
                WorkoutExerciseRecord.exercise_id == exercise_id,
                WorkoutSetRecord.completed_at.is_not(None),
                WorkoutSetRecord.is_warmup.is_(False),
            )
        )
        if cursor:
            query = query.where(
                tuple_(WorkoutSessionRecord.started_at, WorkoutSessionRecord.id)
                < decode_cursor(cursor)
            )
        rows = list(
            (
                await self.db.execute(
                    query.group_by(WorkoutSessionRecord.id)
                    .order_by(
                        WorkoutSessionRecord.started_at.desc(), WorkoutSessionRecord.id.desc()
                    )
                    .limit(limit + 1)
                )
            ).all()
        )
        return ProgressPage(
            exercise_id=exercise_id,
            time_zone=time_zone,
            items=[
                ProgressPoint(
                    workout_id=row[0],
                    started_at=row[6].astimezone(UTC).isoformat().replace("+00:00", "Z"),
                    ended_at=utc_stamp(row[1]),
                    completed_sets=row[2],
                    volume_kg=row[3],
                    best_kg=row[4],
                    best_reps=row[5],
                    e1rm=row[7],
                )
                for row in rows[:limit]
            ],
            next_cursor=encode_cursor(rows[limit - 1][6], rows[limit - 1][0])
            if len(rows) > limit
            else None,
        )
