"""Versioned aggregate mutations; the request session owns the atomic commit."""

import hashlib
import json
from datetime import UTC, datetime
from uuid import UUID, uuid4

from sqlalchemy.ext.asyncio import AsyncSession

from app.core.exceptions import AlreadyExistsError, AuthorizationError, ValidationError
from app.db.models.user import User
from app.repositories.fitness import FitnessRepository, change_schema, instant
from app.repositories.fitness_queries import FitnessQueries
from app.schemas.fitness import (
    ExerciseSnapshot,
    SyncAck,
    SyncMutation,
    SyncPage,
    SyncWorkout,
    TrainingState,
)


class FitnessService:
    def __init__(self, db: AsyncSession):
        self.db = db
        self.repo = FitnessRepository(db)
        self.queries = FitnessQueries(db)

    def owner(self, user: User) -> str:
        if not user.external_user_id:
            raise AuthorizationError(
                message="A delegated identity is required for fitness synchronization"
            )
        return user.external_user_id

    async def mutate(self, user: User, mutation: SyncMutation) -> SyncAck:
        owner = self.owner(user)
        # Hash the validated complete intent, including baseVersion and operation.
        body = mutation.model_dump(mode="json", by_alias=True)
        request_hash = hashlib.sha256(
            json.dumps(body, sort_keys=True, separators=(",", ":")).encode()
        ).hexdigest()
        state = await self.repo.lock_account(user.id)
        receipt = await self.repo.receipt(user.id, mutation.mutation_id)
        if receipt is not None:
            if receipt.request_hash != request_hash:
                raise AlreadyExistsError(
                    message="Mutation ID was reused with another request",
                    details={"current": None},
                    code="MUTATION_ID_REUSED",
                )
            return SyncAck.model_validate(receipt.acknowledgment)
        current = await self.repo.current(user.id, mutation.entity_type, mutation.entity_id)
        version = current.version if current else 0
        snapshot = (
            change_schema(current).model_dump(mode="json", by_alias=True) if current else None
        )
        if version != mutation.base_version:
            raise AlreadyExistsError(
                message="Aggregate version changed",
                code="SYNC_CONFLICT",
                details={"current": snapshot},
            )
        payload = mutation.payload.model_copy(deep=True)
        if isinstance(payload, SyncWorkout):
            if payload.user_id != owner:
                raise AuthorizationError(
                    message="Workout owner does not match the verified identity"
                )
            if current and current.payload.get("deletedAt") and not payload.deleted_at:
                raise AlreadyExistsError(
                    message="Deleted workouts cannot be resurrected", details={"current": snapshot}
                )
            # A first import uses base version zero and conflicts with existing data.
            # Explicit reconciliation may preserve historical children at the exact
            # current version, while the tombstone guard above still prevents revival.
            known = await self.repo.known_exercises([x.exercise_id for x in payload.exercises])
            retained = {x["id"]: x for x in current.payload["exercises"]} if current else {}
            for exercise in payload.exercises:
                if exercise.exercise_id in known:
                    continue
                previous = retained.get(str(exercise.id))
                if mutation.operation != "importLegacyWorkout" and (
                    previous is None or previous["exerciseId"] != exercise.exercise_id
                ):
                    raise ValidationError(
                        message="New workout exercises must resolve to the catalog",
                        details={"exerciseId": exercise.exercise_id},
                    )
                if exercise.exercise_snapshot is None:
                    exercise.exercise_snapshot = ExerciseSnapshot.model_validate(
                        previous.get("exerciseSnapshot")
                        if previous and previous.get("exerciseSnapshot")
                        else {"name": exercise.exercise_id, "load": "weight"}
                    )
            await self.repo.save_workout(user.id, payload, version + 1, known)
        elif isinstance(payload, TrainingState):
            await self.repo.save_training(user.id, payload, version + 1)
            user.onboarding_completed_at = instant(payload.onboarding_completed_at)
            self.db.add(user)
        else:
            await self.repo.save_settings(
                user.id, payload.model_dump(mode="json", by_alias=True), version + 1
            )
        change = await self.repo.append(
            user.id,
            state,
            mutation,
            version + 1,
            payload.model_dump(mode="json", by_alias=True),
            request_hash,
        )
        return SyncAck(mutation_id=mutation.mutation_id, change=change)

    async def changes(self, user: User, cursor: int, limit: int) -> SyncPage:
        rows = await self.repo.feed(user.id, cursor, limit)
        changes = [change_schema(row) for row in rows[:limit]]
        return SyncPage(
            changes=changes,
            next_cursor=changes[-1].revision if changes else cursor,
            has_more=len(rows) > limit,
        )

    async def set_onboarding(self, user: User, value: datetime | None) -> None:
        """The legacy setter also writes through the same locked feed transaction."""
        await self.repo.lock_account(user.id)
        current = await self.training_state(user)
        payload = current.payload.model_dump(mode="json", by_alias=True)
        if value is not None and current.payload.profile is None:
            raise ValidationError(message="Accept a training profile before completing onboarding")
        payload["onboardingCompletedAt"] = (
            value.astimezone(UTC).isoformat().replace("+00:00", "Z") if value else None
        )
        mutation = SyncMutation.model_validate(
            {
                "schemaVersion": 1,
                "mutationId": str(uuid4()),
                "entityType": "trainingState",
                "entityId": "self",
                "baseVersion": current.version,
                "operation": "upsert",
                "payload": payload,
            }
        )
        await self.mutate(user, mutation)

    async def training_state(self, user: User):
        return await self.queries.training_state(user.id, user.onboarding_completed_at)

    async def settings(self, user: User):
        return await self.queries.settings(user.id)

    async def workout(self, user: User, workout_id: UUID):
        return await self.queries.workout(user.id, workout_id)

    async def workouts(
        self,
        user: User,
        cursor: str | None,
        limit: int,
        status: str | None = None,
        include_deleted: bool = False,
    ):
        return await self.queries.workouts(user.id, cursor, limit, status, include_deleted)

    async def plans(self, user: User, cursor: str | None, limit: int):
        return await self.queries.plans(user.id, cursor, limit)

    async def plan(self, user: User, plan_id: UUID):
        return await self.queries.plan(user.id, plan_id)

    async def stats(
        self, user: User, time_zone: str, now: datetime | None = None, weeks: int = 8, goal: int = 1
    ):
        return await self.queries.stats(user.id, time_zone, now, weeks, goal)

    async def progress(
        self, user: User, exercise_id: str, time_zone: str, cursor: str | None, limit: int
    ):
        return await self.queries.progress(user.id, exercise_id, time_zone, cursor, limit)
