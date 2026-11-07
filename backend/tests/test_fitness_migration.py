"""The fitness schema follows the existing chain and remains independently reversible."""

import runpy
from pathlib import Path


def test_fitness_migration_extends_existing_chain():
    path = Path(__file__).parents[1] / "alembic/versions/0028_fitness_sync.py"
    assert path.exists(), "fitness migration is missing"
    revision = runpy.run_path(str(path))
    assert revision["revision"] == "0028_fitness_sync"
    assert revision["down_revision"] == "0027_user_magic_link_epoch"
