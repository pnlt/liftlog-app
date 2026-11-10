"""Validate and publish the reproducible combined bundled catalog."""

import asyncio
from pathlib import Path

import click

from app.commands import command
from app.db.session import get_db_context
from app.repositories.fitness_catalog import CatalogRepository
from app.schemas.fitness_catalog import CatalogArtifact


@command("import-catalog", help="Publish a validated immutable exercise catalog release")
@click.argument(
    "artifact_path",
    type=click.Path(exists=True, path_type=Path),
    default=str(Path(__file__).resolve().parents[2] / "data/exercise-catalog.json"),
)
def import_catalog(artifact_path: Path) -> None:
    artifact = CatalogArtifact.model_validate_json(artifact_path.read_bytes())

    async def publish() -> None:
        async with get_db_context() as db:
            revision = await CatalogRepository(db).publish(artifact)
        click.echo(f"Published {len(artifact.items)} exercises in catalog {revision}")

    asyncio.run(publish())
