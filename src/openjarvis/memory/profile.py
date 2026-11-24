"""Structured user profile derived from persistent memory facts.

This module is deliberately separate from the fact store:
- It reads facts but never edits or deletes them.
- It preserves source and trust metadata.
- Classification is deterministic and conservative.
- Untrusted facts are retained for review but are never recallable.
"""

from __future__ import annotations

import hashlib
import json
import os
import re
import tempfile
import time
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Any

from openjarvis.core.paths import get_config_dir
from openjarvis.memory.store import FactStore

PROFILE_SCHEMA_VERSION = 1
DEFAULT_PROFILE_FILENAME = "user_profile.json"

# Ordered rules: the first matching category wins.
_CATEGORY_RULES: tuple[tuple[str, tuple[str, ...], float], ...] = (
    (
        "preference",
        (
            r"\bprefer(?:s|red|ence)?\b",
            r"\blike(?:s|d)?\b",
            r"\bdislike(?:s|d)?\b",
            r"\bavoid(?:s|ed)?\b",
            r"\bfavorite\b",
            r"\bfavourite\b",
        ),
        0.85,
    ),
    (
        "goal",
        (
            r"\bgoal\b",
            r"\bwant(?:s|ed)?\b",
            r"\baim(?:s|ed)?\b",
            r"\btarget(?:s|ed)?\b",
            r"\bplan(?:s|ned)? to\b",
            r"\bworking toward\b",
        ),
        0.85,
    ),
    (
        "project",
        (
            r"\bproject\b",
            r"\bstartup\b",
            r"\bbuilding\b",
            r"\bdeveloping\b",
            r"\bproduct\b",
            r"\binitiative\b",
        ),
        0.80,
    ),
    (
        "constraint",
        (
            r"\bconstraint\b",
            r"\bmust\b",
            r"\bcannot\b",
            r"\bcan't\b",
            r"\bunable to\b",
            r"\blimited to\b",
            r"\bbudget\b",
            r"\bavailable time\b",
        ),
        0.80,
    ),
    (
        "task",
        (
            r"\btask\b",
            r"\bto[- ]do\b",
            r"\bnext step\b",
            r"\bdeadline\b",
            r"\bneeds? to\b",
            r"\bshould\b",
        ),
        0.75,
    ),
    (
        "profile",
        (
            r"\bmy name is\b",
            r"\bi am\b",
            r"\bi'm\b",
            r"\bi live in\b",
            r"\bi work as\b",
            r"\bstudent\b",
            r"\bworks as\b",
            r"\bbased in\b",
            r"\bjob title\b",
        ),
        0.75,
    ),
)


@dataclass(slots=True)
class ProfileEntry:
    """A categorized fact with its original provenance preserved."""

    id: str
    category: str
    content: str
    source: str
    created_at: float
    trust: str
    confidence: float
    needs_review: bool
    recallable: bool


@dataclass(slots=True)
class UserProfile:
    """Versioned structured profile generated from stored facts."""

    schema_version: int
    generated_at: float
    source_fact_count: int
    entries: list[ProfileEntry]

    def to_dict(self) -> dict[str, Any]:
        return {
            "schema_version": self.schema_version,
            "generated_at": self.generated_at,
            "source_fact_count": self.source_fact_count,
            "entries": [asdict(entry) for entry in self.entries],
        }

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> UserProfile:
        if data.get("schema_version") != PROFILE_SCHEMA_VERSION:
            raise ValueError(
                f"Unsupported user profile schema version: "
                f"{data.get('schema_version')!r}"
            )

        return cls(
            schema_version=data["schema_version"],
            generated_at=float(data["generated_at"]),
            source_fact_count=int(data["source_fact_count"]),
            entries=[
                ProfileEntry(**entry)
                for entry in data.get("entries", [])
            ],
        )

    def recallable_entries(self) -> list[ProfileEntry]:
        """Return only facts whose original trust metadata permits recall."""
        return [entry for entry in self.entries if entry.recallable]


def _classify(text: str) -> tuple[str, float]:
    """Classify text using conservative keyword rules, without an LLM."""
    normalized = text.casefold()

    for category, patterns, confidence in _CATEGORY_RULES:
        if any(re.search(pattern, normalized) for pattern in patterns):
            return category, confidence

    return "uncategorized", 0.0


def _stable_fact_id(
    text: str,
    source: str,
    created_at: float,
    trust: str,
) -> str:
    """Create a stable identifier without exposing fact text in the ID."""
    raw = json.dumps(
        [text, source, created_at, trust],
        ensure_ascii=False,
        separators=(",", ":"),
    )
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


def _default_profile_path() -> Path:
    return get_config_dir() / DEFAULT_PROFILE_FILENAME


def _write_profile_atomic(profile: UserProfile, path: Path) -> None:
    """Write a profile atomically, keeping temporary files beside the target."""
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary_path: str | None = None

    try:
        with tempfile.NamedTemporaryFile(
            mode="w",
            encoding="utf-8",
            newline="\n",
            dir=path.parent,
            prefix=f".{path.name}.",
            suffix=".tmp",
            delete=False,
        ) as temporary_file:
            temporary_path = temporary_file.name
            json.dump(
                profile.to_dict(),
                temporary_file,
                ensure_ascii=False,
                indent=2,
            )
            temporary_file.write("\n")
            temporary_file.flush()
            os.fsync(temporary_file.fileno())

        os.replace(temporary_path, path)
        temporary_path = None
    finally:
        if temporary_path is not None:
            try:
                os.unlink(temporary_path)
            except FileNotFoundError:
                pass


def build_user_profile(
    fact_store: FactStore,
    path: str | Path | None = None,
) -> UserProfile:
    """Build and persist a profile without modifying the source fact store.

    All facts are represented, including quarantined facts. Their trust tier
    is preserved, and only recallable trust tiers receive ``recallable=True``.
    Untrusted content must not be passed to model context.
    """
    facts = fact_store.list()
    entries: list[ProfileEntry] = []

    for fact in facts:
        text = fact.text
        source = fact.source
        created_at = float(fact.created_at)
        trust = (fact.trust or "").strip().lower()

        category, confidence = _classify(text)
        recallable = bool(fact.trusted_for_recall)

        entries.append(
            ProfileEntry(
                id=_stable_fact_id(text, source, created_at, trust),
                category=category,
                content=text,
                source=source,
                created_at=created_at,
                trust=trust,
                confidence=confidence,
                needs_review=(category == "uncategorized"),
                recallable=recallable,
            )
        )

    profile = UserProfile(
        schema_version=PROFILE_SCHEMA_VERSION,
        generated_at=time.time(),
        source_fact_count=len(facts),
        entries=entries,
    )

    destination = Path(path) if path is not None else _default_profile_path()
    _write_profile_atomic(profile, destination)
    return profile


def load_user_profile(path: str | Path | None = None) -> UserProfile:
    """Load a previously generated structured profile."""
    source = Path(path) if path is not None else _default_profile_path()

    with source.open("r", encoding="utf-8") as profile_file:
        data = json.load(profile_file)

    if not isinstance(data, dict):
        raise ValueError("User profile document must be a JSON object")

    return UserProfile.from_dict(data)
