"""Canonical fitness storage and durable, account-ordered synchronization records."""

from datetime import datetime
from typing import Any
from uuid import UUID

from sqlalchemy import (
    BigInteger,
    Boolean,
    CheckConstraint,
    DateTime,
    Float,
    ForeignKey,
    Index,
    Integer,
    String,
    UniqueConstraint,
    func,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.dialects.postgresql import UUID as PGUUID
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class CatalogRelease(Base):
    __tablename__ = "catalog_releases"
    revision: Mapped[str] = mapped_column(String(100), primary_key=True)
    attribution: Mapped[str] = mapped_column(JSONB, nullable=False)
    published_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )


class CatalogExercise(Base):
    __tablename__ = "exercises"
    id: Mapped[str] = mapped_column(String(255), primary_key=True)
    payload: Mapped[dict[str, Any]] = mapped_column(JSONB, nullable=False)


class CatalogReleaseItem(Base):
    __tablename__ = "catalog_release_items"
    revision: Mapped[str] = mapped_column(ForeignKey("catalog_releases.revision"), primary_key=True)
    exercise_id: Mapped[str] = mapped_column(ForeignKey("exercises.id"), primary_key=True)
    payload: Mapped[dict[str, Any]] = mapped_column(JSONB, nullable=False)


class ProfileRevision(Base):
    __tablename__ = "profile_revisions"
    id: Mapped[UUID] = mapped_column(PGUUID(as_uuid=True), primary_key=True)
    user_id: Mapped[UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    payload: Mapped[dict[str, Any]] = mapped_column(JSONB, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class TrainingPlan(Base):
    __tablename__ = "training_plans"
    id: Mapped[UUID] = mapped_column(PGUUID(as_uuid=True), primary_key=True)
    user_id: Mapped[UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    profile_revision_id: Mapped[UUID] = mapped_column(ForeignKey("profile_revisions.id"))
    payload: Mapped[dict[str, Any]] = mapped_column(JSONB, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)


class TrainingStateRecord(Base):
    __tablename__ = "training_state"
    __table_args__ = (CheckConstraint("version > 0", name="positive_version"),)
    user_id: Mapped[UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), primary_key=True
    )
    version: Mapped[int] = mapped_column(BigInteger, nullable=False)
    profile_revision_id: Mapped[UUID | None] = mapped_column(ForeignKey("profile_revisions.id"))
    plan_id: Mapped[UUID | None] = mapped_column(ForeignKey("training_plans.id"))
    payload: Mapped[dict[str, Any]] = mapped_column(JSONB, nullable=False)


class UserSettingsRecord(Base):
    __tablename__ = "user_settings"
    __table_args__ = (CheckConstraint("version > 0", name="positive_version"),)
    user_id: Mapped[UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), primary_key=True
    )
    version: Mapped[int] = mapped_column(BigInteger, nullable=False)
    payload: Mapped[dict[str, Any]] = mapped_column(JSONB, nullable=False)


class WorkoutSessionRecord(Base):
    __tablename__ = "workout_sessions"
    __table_args__ = (
        CheckConstraint("version > 0", name="positive_version"),
        Index("workout_sessions_owner_started_idx", "user_id", "started_at", "id"),
    )
    id: Mapped[UUID] = mapped_column(PGUUID(as_uuid=True), primary_key=True)
    user_id: Mapped[UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    version: Mapped[int] = mapped_column(BigInteger, nullable=False)
    started_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    ended_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    note: Mapped[str | None] = mapped_column(String(2000))
    payload: Mapped[dict[str, Any]] = mapped_column(JSONB, nullable=False)


class WorkoutChildIdentity(Base):
    """Retain identity reservations after an item is removed from a snapshot."""

    __tablename__ = "workout_child_identities"
    id: Mapped[UUID] = mapped_column(PGUUID(as_uuid=True), primary_key=True)
    workout_id: Mapped[UUID] = mapped_column(ForeignKey("workout_sessions.id", ondelete="CASCADE"))
    kind: Mapped[str] = mapped_column(String(20), nullable=False)
    # Set IDs must also remain attached to their original exercise.
    parent_id: Mapped[UUID] = mapped_column(PGUUID(as_uuid=True), nullable=False)


class WorkoutExerciseRecord(Base):
    __tablename__ = "workout_exercises"
    __table_args__ = (
        UniqueConstraint("workout_id", "position"),
        CheckConstraint("position >= 0", name="nonnegative_position"),
    )
    id: Mapped[UUID] = mapped_column(PGUUID(as_uuid=True), primary_key=True)
    workout_id: Mapped[UUID] = mapped_column(
        ForeignKey("workout_sessions.id", ondelete="CASCADE"), index=True
    )
    exercise_id: Mapped[str] = mapped_column(String(255), nullable=False, index=True)
    catalog_exercise_id: Mapped[str | None] = mapped_column(ForeignKey("exercises.id"))
    position: Mapped[int] = mapped_column(Integer, nullable=False)
    note: Mapped[str | None] = mapped_column(String(2000))
    exercise_snapshot: Mapped[dict[str, Any] | None] = mapped_column(JSONB)


class WorkoutSetRecord(Base):
    __tablename__ = "workout_sets"
    __table_args__ = (
        UniqueConstraint("workout_exercise_id", "position"),
        CheckConstraint("position >= 0", name="nonnegative_position"),
        CheckConstraint("kg IS NULL OR kg >= 0", name="nonnegative_kg"),
        CheckConstraint("reps IS NULL OR reps >= 0", name="nonnegative_reps"),
    )
    id: Mapped[UUID] = mapped_column(PGUUID(as_uuid=True), primary_key=True)
    workout_exercise_id: Mapped[UUID] = mapped_column(
        ForeignKey("workout_exercises.id", ondelete="CASCADE"), index=True
    )
    position: Mapped[int] = mapped_column(Integer, nullable=False)
    kg: Mapped[float | None] = mapped_column(Float)
    reps: Mapped[int | None] = mapped_column(Integer)
    is_warmup: Mapped[bool] = mapped_column(Boolean, nullable=False)
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class UserSyncState(Base):
    __tablename__ = "user_sync_state"
    __table_args__ = (CheckConstraint("revision >= 0", name="nonnegative_revision"),)
    user_id: Mapped[UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), primary_key=True
    )
    revision: Mapped[int] = mapped_column(BigInteger, nullable=False, default=0)


class SyncChangeRecord(Base):
    __tablename__ = "sync_changes"
    __table_args__ = (
        UniqueConstraint("user_id", "mutation_id"),
        CheckConstraint("revision > 0 AND version > 0", name="positive_versions"),
        Index("sync_changes_aggregate_idx", "user_id", "entity_type", "entity_id", "version"),
    )
    user_id: Mapped[UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), primary_key=True
    )
    revision: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    mutation_id: Mapped[UUID] = mapped_column(PGUUID(as_uuid=True), nullable=False)
    entity_type: Mapped[str] = mapped_column(String(30), nullable=False)
    entity_id: Mapped[str] = mapped_column(String(255), nullable=False)
    version: Mapped[int] = mapped_column(BigInteger, nullable=False)
    operation: Mapped[str] = mapped_column(String(20), nullable=False)
    payload: Mapped[dict[str, Any]] = mapped_column(JSONB, nullable=False)


class SyncMutationReceipt(Base):
    __tablename__ = "sync_mutations"
    user_id: Mapped[UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), primary_key=True
    )
    mutation_id: Mapped[UUID] = mapped_column(PGUUID(as_uuid=True), primary_key=True)
    request_hash: Mapped[str] = mapped_column(String(64), nullable=False)
    acknowledgment: Mapped[dict[str, Any]] = mapped_column(JSONB, nullable=False)


FITNESS_TABLES = [
    CatalogRelease.__table__,
    CatalogExercise.__table__,
    CatalogReleaseItem.__table__,
    ProfileRevision.__table__,
    TrainingPlan.__table__,
    TrainingStateRecord.__table__,
    UserSettingsRecord.__table__,
    WorkoutSessionRecord.__table__,
    WorkoutChildIdentity.__table__,
    WorkoutExerciseRecord.__table__,
    WorkoutSetRecord.__table__,
    UserSyncState.__table__,
    SyncChangeRecord.__table__,
    SyncMutationReceipt.__table__,
]
