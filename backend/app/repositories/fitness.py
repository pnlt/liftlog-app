"""PostgreSQL persistence primitives. Callers own transaction completion."""

from datetime import datetime
from typing import Any
from uuid import UUID

from sqlalchemy import delete, select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.exceptions import AlreadyExistsError, AuthorizationError
from app.db.models.fitness import (
    CatalogExercise,
    ProfileRevision,
    SyncChangeRecord,
    SyncMutationReceipt,
    TrainingPlan,
    TrainingStateRecord,
    UserSettingsRecord,
    UserSyncState,
    WorkoutChildIdentity,
    WorkoutExerciseRecord,
    WorkoutSessionRecord,
    WorkoutSetRecord,
)
from app.schemas.fitness import SyncChange, SyncMutation, SyncWorkout, TrainingState


def instant(value: str | None) -> datetime | None:
    return datetime.fromisoformat(value) if value else None


def change_schema(row: SyncChangeRecord) -> SyncChange:
    return SyncChange.model_validate(
        {
            "revision": row.revision,
            "mutationId": row.mutation_id,
            "entityType": row.entity_type,
            "entityId": row.entity_id,
            "version": row.version,
            "operation": row.operation,
            "payload": row.payload,
        }
    )


class FitnessRepository:
    def __init__(self, db: AsyncSession):
        self.db = db

    async def lock_account(self, user_id: UUID) -> UserSyncState:
        # ON CONFLICT handles the first two concurrent requests for a new account.
        # This row lock is held by the request transaction until commit/rollback.
        await self.db.execute(
            insert(UserSyncState)
            .values(user_id=user_id, revision=0)
            .on_conflict_do_nothing(index_elements=["user_id"])
        )
        result = await self.db.execute(
            select(UserSyncState)
            .where(UserSyncState.user_id == user_id)
            .with_for_update()
            .execution_options(populate_existing=True)
        )
        return result.scalar_one()

    async def receipt(self, user_id: UUID, mutation_id: UUID) -> SyncMutationReceipt | None:
        return await self.db.get(SyncMutationReceipt, (user_id, mutation_id))

    async def current(
        self, user_id: UUID, entity_type: str, entity_id: str
    ) -> SyncChangeRecord | None:
        return await self.db.scalar(
            select(SyncChangeRecord)
            .where(
                SyncChangeRecord.user_id == user_id,
                SyncChangeRecord.entity_type == entity_type,
                SyncChangeRecord.entity_id == entity_id,
            )
            .order_by(SyncChangeRecord.version.desc())
            .limit(1)
        )

    async def feed(self, user_id: UUID, cursor: int, limit: int) -> list[SyncChangeRecord]:
        return list(
            (
                await self.db.scalars(
                    select(SyncChangeRecord)
                    .where(
                        SyncChangeRecord.user_id == user_id,
                        SyncChangeRecord.revision > cursor,
                    )
                    .order_by(SyncChangeRecord.revision)
                    .limit(limit + 1)
                )
            ).all()
        )

    async def append(
        self,
        user_id: UUID,
        state: UserSyncState,
        mutation: SyncMutation,
        version: int,
        payload: dict[str, Any],
        request_hash: str,
    ) -> SyncChange:
        state.revision += 1
        row = SyncChangeRecord(
            user_id=user_id,
            revision=state.revision,
            mutation_id=mutation.mutation_id,
            entity_type=mutation.entity_type,
            entity_id=mutation.entity_id,
            version=version,
            operation="delete"
            if mutation.entity_type == "workout" and payload["deletedAt"]
            else "upsert",
            payload=payload,
        )
        change = change_schema(row)
        self.db.add(row)
        self.db.add(
            SyncMutationReceipt(
                user_id=user_id,
                mutation_id=mutation.mutation_id,
                request_hash=request_hash,
                acknowledgment={
                    "mutationId": str(mutation.mutation_id),
                    "change": change.model_dump(mode="json", by_alias=True),
                },
            )
        )
        await self.db.flush()
        return change

    async def reserve_child(
        self, child_id: UUID, workout_id: UUID, parent_id: UUID, kind: str
    ) -> None:
        await self.db.execute(
            insert(WorkoutChildIdentity)
            .values(
                id=child_id,
                workout_id=workout_id,
                parent_id=parent_id,
                kind=kind,
            )
            .on_conflict_do_nothing(index_elements=["id"])
        )
        reservation = await self.db.get(WorkoutChildIdentity, child_id)
        if reservation is None or (
            reservation.workout_id,
            reservation.parent_id,
            reservation.kind,
        ) != (
            workout_id,
            parent_id,
            kind,
        ):
            raise AlreadyExistsError(
                message="Child ID already belongs to another parent", details={"current": None}
            )

    async def save_workout(
        self, user_id: UUID, workout: SyncWorkout, version: int, known: set[str]
    ) -> None:
        payload = workout.model_dump(mode="json", by_alias=True)
        values = {
            "id": workout.id,
            "user_id": user_id,
            "version": version,
            "payload": payload,
            "started_at": instant(workout.started_at),
            "ended_at": instant(workout.ended_at),
            "updated_at": instant(workout.updated_at),
            "deleted_at": instant(workout.deleted_at),
            "note": workout.note,
        }
        await self.db.execute(
            insert(WorkoutSessionRecord)
            .values(**values)
            .on_conflict_do_nothing(index_elements=["id"])
        )
        row = await self.db.get(WorkoutSessionRecord, workout.id)
        if row is None or row.user_id != user_id:
            raise AuthorizationError(message="Workout ID belongs to another account")
        for key, value in values.items():
            setattr(row, key, value)
        await self.db.flush()
        # Identity reservations persist, even for removed exercise/set rows.
        await self.db.execute(
            delete(WorkoutExerciseRecord).where(WorkoutExerciseRecord.workout_id == workout.id)
        )
        for exercise in workout.exercises:
            await self.reserve_child(exercise.id, workout.id, workout.id, "exercise")
            self.db.add(
                WorkoutExerciseRecord(
                    id=exercise.id,
                    workout_id=workout.id,
                    exercise_id=exercise.exercise_id,
                    catalog_exercise_id=exercise.exercise_id
                    if exercise.exercise_id in known
                    else None,
                    position=exercise.position,
                    note=exercise.note,
                    exercise_snapshot=exercise.exercise_snapshot.model_dump()
                    if exercise.exercise_snapshot
                    else None,
                )
            )
            await self.db.flush()
            for item in exercise.sets:
                await self.reserve_child(item.id, workout.id, exercise.id, "set")
                self.db.add(
                    WorkoutSetRecord(
                        id=item.id,
                        workout_exercise_id=exercise.id,
                        position=item.position,
                        kg=item.kg,
                        reps=item.reps,
                        is_warmup=item.is_warmup,
                        completed_at=instant(item.completed_at),
                    )
                )
        await self.db.flush()

    async def known_exercises(self, exercise_ids: list[str]) -> set[str]:
        if not exercise_ids:
            return set()
        return set(
            (
                await self.db.scalars(
                    select(CatalogExercise.id).where(
                        CatalogExercise.id.in_(exercise_ids),
                    )
                )
            ).all()
        )

    async def immutable(
        self, model: type[ProfileRevision] | type[TrainingPlan], values: dict[str, Any]
    ) -> None:
        await self.db.execute(
            insert(model).values(**values).on_conflict_do_nothing(index_elements=["id"])
        )
        row = await self.db.get(model, values["id"])
        if row is None or row.user_id != values["user_id"] or row.payload != values["payload"]:
            raise AlreadyExistsError(
                message="Accepted profile/plan IDs are immutable", details={"current": None}
            )

    async def save_training(self, user_id: UUID, value: TrainingState, version: int) -> None:
        if value.profile is not None:
            await self.immutable(
                ProfileRevision,
                {
                    "id": value.profile_revision_id,
                    "user_id": user_id,
                    "payload": value.profile.model_dump(mode="json", by_alias=True),
                },
            )
        if value.plan is not None:
            await self.immutable(
                TrainingPlan,
                {
                    "id": value.plan.id,
                    "user_id": user_id,
                    "profile_revision_id": value.profile_revision_id,
                    "payload": value.plan.model_dump(mode="json", by_alias=True),
                    "created_at": instant(value.plan.created_at),
                },
            )
        row = await self.db.get(TrainingStateRecord, user_id)
        if row is None:
            row = TrainingStateRecord(user_id=user_id)
            self.db.add(row)
        row.version = version
        row.profile_revision_id = value.profile_revision_id
        row.plan_id = value.plan.id if value.plan else None
        row.payload = value.model_dump(mode="json", by_alias=True)
        await self.db.flush()

    async def save_settings(self, user_id: UUID, payload: dict[str, Any], version: int) -> None:
        row = await self.db.get(UserSettingsRecord, user_id)
        if row is None:
            row = UserSettingsRecord(user_id=user_id)
            self.db.add(row)
        row.version = version
        row.payload = payload
        await self.db.flush()
