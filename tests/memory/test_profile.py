"""Tests for structured user profile generation."""

from __future__ import annotations

import json

from openjarvis.memory.profile import (
    PROFILE_SCHEMA_VERSION,
    build_user_profile,
    load_user_profile,
)
from openjarvis.memory.store import (
    TRUST_AUTO,
    TRUST_TRUSTED,
    TRUST_UNTRUSTED,
    Fact,
    LocalFactStore,
)


class FakeFactStore:
    def __init__(self, facts):
        self.facts = list(facts)

    def list(self):
        return list(self.facts)


def test_profile_classifies_facts_and_preserves_provenance(tmp_path):
    facts = [
        Fact(
            text="User prefers concise answers",
            source="auto",
            created_at=100.0,
            trust=TRUST_AUTO,
        ),
        Fact(
            text="User is a student",
            source="manual",
            created_at=200.0,
            trust=TRUST_TRUSTED,
        ),
    ]
    store = FakeFactStore(facts)
    destination = tmp_path / "profile.json"

    profile = build_user_profile(store, destination)

    assert profile.schema_version == PROFILE_SCHEMA_VERSION
    assert profile.source_fact_count == 2
    assert [entry.category for entry in profile.entries] == [
        "preference",
        "profile",
    ]
    assert profile.entries[0].source == "auto"
    assert profile.entries[0].trust == TRUST_AUTO
    assert profile.entries[1].source == "manual"
    assert profile.entries[1].trust == TRUST_TRUSTED
    assert all(entry.recallable for entry in profile.entries)
    assert destination.exists()


def test_untrusted_fact_is_preserved_but_not_recallable(tmp_path):
    store = FakeFactStore(
        [
            Fact(
                text="Untrusted content for review",
                source="auto",
                created_at=300.0,
                trust=TRUST_UNTRUSTED,
            )
        ]
    )

    profile = build_user_profile(store, tmp_path / "profile.json")

    assert len(profile.entries) == 1
    assert profile.entries[0].trust == TRUST_UNTRUSTED
    assert profile.entries[0].recallable is False
    assert profile.recallable_entries() == []


def test_unknown_fact_is_marked_for_review(tmp_path):
    store = FakeFactStore(
        [Fact(text="A statement with no known category", created_at=1.0)]
    )

    profile = build_user_profile(store, tmp_path / "profile.json")

    entry = profile.entries[0]
    assert entry.category == "uncategorized"
    assert entry.confidence == 0.0
    assert entry.needs_review is True


def test_profile_round_trip(tmp_path):
    destination = tmp_path / "profile.json"
    store = FakeFactStore(
        [
            Fact(
                text="User wants to learn Python",
                source="auto",
                created_at=123.0,
                trust=TRUST_AUTO,
            )
        ]
    )

    original = build_user_profile(store, destination)
    loaded = load_user_profile(destination)

    assert loaded.to_dict() == original.to_dict()


def test_source_fact_file_is_not_modified(tmp_path):
    facts_path = tmp_path / "memory_facts.jsonl"
    profile_path = tmp_path / "user_profile.json"

    source_store = LocalFactStore(facts_path)
    source_store.add("User prefers concise answers", source="auto")
    source_store.add(
        "User is a student",
        source="manual",
        trust=TRUST_TRUSTED,
    )

    before = facts_path.read_bytes()
    before_count = source_store.count()

    build_user_profile(source_store, profile_path)

    after = facts_path.read_bytes()

    assert after == before
    assert source_store.count() == before_count
    assert profile_path.exists()


def test_profile_json_contains_metadata(tmp_path):
    destination = tmp_path / "profile.json"
    store = FakeFactStore(
        [
            Fact(
                text="User has a project",
                source="test",
                created_at=42.0,
                trust=TRUST_AUTO,
            )
        ]
    )

    build_user_profile(store, destination)
    data = json.loads(destination.read_text(encoding="utf-8"))

    assert data["schema_version"] == PROFILE_SCHEMA_VERSION
    assert data["source_fact_count"] == 1
    assert data["entries"][0]["source"] == "test"
    assert data["entries"][0]["trust"] == TRUST_AUTO
    assert data["entries"][0]["category"] == "project"
