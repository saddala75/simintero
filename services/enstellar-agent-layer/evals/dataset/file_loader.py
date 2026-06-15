"""FileDatasetLoader — loads EvalCases from a JSON array file."""
from __future__ import annotations

import json
from pathlib import Path

from evals.dataset.base import DatasetLoader, EvalCase


class FileDatasetLoader(DatasetLoader):
    """Load eval cases from a JSON array file.

    Accepts a path to a JSON file containing an array of EvalCase-compatible dicts.
    ``version`` is derived from the file stem (filename without extension).

    Stub for SP7 — no real cases loaded in this release.
    """

    def __init__(self, path: str) -> None:
        self._path = Path(path)

    def load(self) -> list[EvalCase]:
        with open(self._path) as f:
            data = json.load(f)
        return [EvalCase.model_validate(item) for item in data]

    @property
    def version(self) -> str:
        return self._path.stem
