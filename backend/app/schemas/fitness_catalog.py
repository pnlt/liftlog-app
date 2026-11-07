"""Validated reproducible catalog import artifact."""

from typing import Self

from pydantic import Field, model_validator

from app.schemas.fitness import Exercise, WireModel


class CatalogArtifact(WireModel):
    revision: str = Field(min_length=1, max_length=100)
    attribution: str = Field(min_length=1)
    items: list[Exercise] = Field(min_length=1, max_length=100_000)

    @model_validator(mode="after")
    def unique_ids(self) -> Self:
        if len({item.id for item in self.items}) != len(self.items):
            raise ValueError("Catalog IDs must be unique")
        return self
