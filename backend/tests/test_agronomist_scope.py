from typing import Any, Self

from app import database


class MockCursor:
    def __init__(self) -> None:
        self.query = ""
        self.params: tuple[Any, ...] | None = None

    def __enter__(self) -> Self:
        return self

    def __exit__(self, exc_type, exc_val, exc_tb) -> None:
        return None

    def execute(self, query: str, params: tuple[Any, ...] | None = None) -> None:
        self.query = " ".join(query.lower().split())
        self.params = params

    def fetchall(self) -> list[dict[str, Any]]:
        return []

    def fetchone(self) -> dict[str, Any] | None:
        return None


class MockConnection:
    def __init__(self, cursor: MockCursor) -> None:
        self.mock_cursor = cursor

    def __enter__(self) -> Self:
        return self

    def __exit__(self, exc_type, exc_val, exc_tb) -> None:
        return None

    def cursor(self) -> MockCursor:
        return self.mock_cursor


def test_agronomist_assessment_pool_requires_approved_assigned_county(
    monkeypatch,
) -> None:
    cursor = MockCursor()
    monkeypatch.setattr(database, "_connect", lambda: MockConnection(cursor))

    result = database.load_unverified_assessments(
        user_id="agronomist-1",
        role="agronomist",
        county="Nakuru",
    )

    assert result == []
    assert "join agronomist_profiles as ap on ap.user_id = %s" in cursor.query
    assert "ap.approval_status = 'approved'" in cursor.query
    assert "a.county ilike ap.county" in cursor.query
    assert "(%s::text is null or a.county ilike %s)" in cursor.query
    assert cursor.params == ("agronomist-1", "Nakuru", "Nakuru")


def test_agronomist_claim_requires_approved_profile_in_assessment_county(
    monkeypatch,
) -> None:
    cursor = MockCursor()
    monkeypatch.setattr(database, "_connect", lambda: MockConnection(cursor))

    result = database.claim_agronomic_assessment(
        agronomist_user_id="agronomist-1",
        assessment_id="assessment-1",
    )

    assert result is None
    assert "exists (" in cursor.query
    assert "from agronomist_profiles as ap" in cursor.query
    assert "ap.approval_status = 'approved'" in cursor.query
    assert "a.county ilike ap.county" in cursor.query
    assert cursor.params == (
        "agronomist-1",
        "assessment-1",
        "agronomist-1",
        "agronomist-1",
    )
