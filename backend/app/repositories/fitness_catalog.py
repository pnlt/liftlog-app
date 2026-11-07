"""Atomic immutable catalog releases and release-pinned reads."""

from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.exceptions import AlreadyExistsError, BadRequestError, NotFoundError
from app.db.models.fitness import CatalogExercise, CatalogRelease, CatalogReleaseItem
from app.schemas.fitness import CatalogPage, Exercise
from app.schemas.fitness_catalog import CatalogArtifact


class CatalogRepository:
    def __init__(self, db: AsyncSession):
        self.db = db

    async def publish(self, artifact: CatalogArtifact) -> str:
        # The unique release insert serializes concurrent imports of this revision.
        inserted = await self.db.scalar(
            insert(CatalogRelease)
            .values(
                revision=artifact.revision,
                attribution=artifact.attribution,
            )
            .on_conflict_do_nothing(index_elements=["revision"])
            .returning(CatalogRelease.revision)
        )
        if inserted is None:
            existing = await self.db.get(CatalogRelease, artifact.revision)
            rows = list(
                (
                    await self.db.scalars(
                        select(CatalogReleaseItem).where(
                            CatalogReleaseItem.revision == artifact.revision,
                        )
                    )
                ).all()
            )
            actual = {row.exercise_id: row.payload for row in rows}
            expected = {
                item.id: item.model_dump(mode="json", by_alias=True) for item in artifact.items
            }
            if (
                existing is None
                or existing.attribution != artifact.attribution
                or actual != expected
            ):
                raise AlreadyExistsError(message="Catalog revisions are immutable")
            return artifact.revision
        for item in artifact.items:
            payload = item.model_dump(mode="json", by_alias=True)
            # Retired IDs are never deleted; a known old workout stays resolvable.
            await self.db.execute(
                insert(CatalogExercise)
                .values(id=item.id, payload=payload)
                .on_conflict_do_update(index_elements=["id"], set_={"payload": payload})
            )
            self.db.add(
                CatalogReleaseItem(revision=artifact.revision, exercise_id=item.id, payload=payload)
            )
        await self.db.flush()
        return artifact.revision

    async def release(self, revision: str | None) -> str:
        if revision is not None:
            row = await self.db.get(CatalogRelease, revision)
        else:
            row = await self.db.scalar(
                select(CatalogRelease)
                .order_by(
                    CatalogRelease.published_at.desc(),
                    CatalogRelease.revision.desc(),
                )
                .limit(1)
            )
        if row is None:
            raise NotFoundError(message="Catalog release not found")
        return row.revision

    async def page(
        self,
        revision: str | None,
        cursor: str | None,
        limit: int,
        search: str | None,
        muscle: str | None,
        equipment: str | None,
        load: str | None,
    ) -> CatalogPage:
        if cursor is not None and revision is None:
            raise BadRequestError(message="Catalog pagination requires a pinned revision")
        pinned = await self.release(revision)
        query = select(CatalogReleaseItem).where(CatalogReleaseItem.revision == pinned)
        if cursor is not None:
            query = query.where(CatalogReleaseItem.exercise_id > cursor)
        if search:
            query = query.where(
                CatalogReleaseItem.payload["name"].astext.ilike(
                    "%"
                    + search.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
                    + "%",
                    escape="\\",
                )
            )
        if muscle:
            query = query.where(CatalogReleaseItem.payload["primaryMuscles"].contains([muscle]))
        if equipment:
            query = query.where(CatalogReleaseItem.payload["equipment"].contains([equipment]))
        if load:
            query = query.where(CatalogReleaseItem.payload["load"].astext == load)
        rows = list(
            (
                await self.db.scalars(
                    query.order_by(CatalogReleaseItem.exercise_id).limit(limit + 1)
                )
            ).all()
        )
        return CatalogPage(
            revision=pinned,
            items=[row.payload for row in rows[:limit]],
            next_cursor=rows[limit - 1].exercise_id if len(rows) > limit else None,
        )

    async def exercise(self, exercise_id: str, revision: str | None) -> Exercise:
        if revision is None:
            row = await self.db.get(CatalogExercise, exercise_id)
        else:
            await self.release(revision)
            row = await self.db.get(CatalogReleaseItem, (revision, exercise_id))
        if row is None:
            raise NotFoundError(message="Exercise not found")
        return Exercise.model_validate(row.payload)
