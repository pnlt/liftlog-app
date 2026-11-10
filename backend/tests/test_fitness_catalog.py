"""Release validation is independent of publishing a catalog transaction."""

import importlib.util
from pathlib import Path

import pytest
from pydantic import ValidationError


def test_catalog_release_validates_all_items_and_duplicate_ids_before_publishing():
    assert importlib.util.find_spec("app.schemas.fitness_catalog") is not None
    from app.schemas.fitness_catalog import CatalogArtifact

    item = {
        "id": "source:squat",
        "name": "Squat",
        "primaryMuscles": ["quads"],
        "equipment": ["barbell"],
        "load": "weight",
        "updatedAt": "2026-11-06T00:00:00Z",
        "imageUrl": "https://example.com/squat.jpg",
    }
    artifact = {"revision": "bundled-test", "attribution": "Bundled source", "items": [item]}
    assert CatalogArtifact.model_validate(artifact).items[0].id == "source:squat"
    artifact["items"].append(item.copy())
    with pytest.raises(ValidationError):
        CatalogArtifact.model_validate(artifact)
    artifact["items"] = [{**item, "imageUrl": "invalid-url"}]
    with pytest.raises(ValidationError):
        CatalogArtifact.model_validate(artifact)


def test_bundled_server_artifact_is_complete_and_validated_for_fresh_checkout():
    from app.schemas.fitness_catalog import CatalogArtifact

    path = Path(__file__).parents[1] / "data/exercise-catalog.json"
    artifact = CatalogArtifact.model_validate_json(path.read_bytes())
    by_id = {exercise.id: exercise for exercise in artifact.items}
    assert "bench-press" in by_id and "db-row" in by_id
    assert any(key.startswith("fedb-") for key in by_id)
    assert "CC BY-SA 4.0" in artifact.attribution
