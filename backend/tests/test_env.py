import os
from pathlib import Path

from app.env import _load_env_paths
from database import migration_history


def test_local_env_file_precedes_default_env_file(tmp_path: Path, monkeypatch) -> None:
    local_env = tmp_path / ".env.local"
    default_env = tmp_path / ".env"
    local_env.write_text(
        "DATABASE_URL=postgresql://127.0.0.1:54322/postgres\nSUPABASE_URL=http://127.0.0.1:54321\n",
        encoding="utf-8",
    )
    default_env.write_text(
        "DATABASE_URL=postgresql://db.example.test:5432/postgres\n"
        "SUPABASE_URL=https://project.example.test\n"
        "FALLBACK_VALUE=from-default\n",
        encoding="utf-8",
    )
    monkeypatch.delenv("DATABASE_URL", raising=False)
    monkeypatch.delenv("SUPABASE_URL", raising=False)
    monkeypatch.delenv("FALLBACK_VALUE", raising=False)

    _load_env_paths((local_env, default_env))

    assert os.environ["DATABASE_URL"] == "postgresql://127.0.0.1:54322/postgres"
    assert os.environ["SUPABASE_URL"] == "http://127.0.0.1:54321"
    assert os.environ["FALLBACK_VALUE"] == "from-default"


def test_migration_manager_prefers_local_env_file(tmp_path: Path, monkeypatch) -> None:
    local_env = tmp_path / ".env.local"
    default_env = tmp_path / ".env"
    local_env.write_text(
        "DATABASE_URL=postgresql://127.0.0.1:54322/postgres\n",
        encoding="utf-8",
    )
    default_env.write_text(
        "DATABASE_URL=postgresql://db.example.test:5432/postgres\n",
        encoding="utf-8",
    )
    monkeypatch.setattr(migration_history, "ROOT", tmp_path)
    monkeypatch.delenv("DATABASE_URL", raising=False)

    migration_history._load_env_file()

    assert os.environ["DATABASE_URL"] == "postgresql://127.0.0.1:54322/postgres"
