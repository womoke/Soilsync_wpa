import json
import logging
import os
from pathlib import Path
from typing import Any

try:
    import psycopg
except ImportError:  # pragma: no cover
    psycopg = None  # type: ignore[assignment]

logger = logging.getLogger(__name__)


def _load_env_file() -> None:
    env_paths = (
        Path(__file__).resolve().parents[2] / ".env",
        Path(__file__).resolve().parents[1] / ".env",
    )
    for env_path in env_paths:
        if not env_path.exists():
            continue
        for raw_line in env_path.read_text(encoding="utf-8").splitlines():
            line = raw_line.strip()
            if not line or line.startswith("#"):
                continue
            if "=" not in line:
                continue
            key, value = line.split("=", 1)
            normalized_key = key.strip()
            normalized_value = value.strip().strip("\"'")
            os.environ.setdefault(normalized_key, normalized_value)


_load_env_file()


class RuntimeStateStore:
    """Persist in-memory app state across restarts using Postgres when available, with a local JSON fallback."""

    def __init__(self, path: str | Path | None = None) -> None:
        resolved_path = Path(path) if path is not None else Path(__file__).resolve().parents[1] / "data" / "runtime_state.json"
        self.path = resolved_path
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self.database_url = os.getenv("DATABASE_URL")

    def load(self) -> dict[str, dict[str, Any]]:
        db_state = self._load_from_database()
        if db_state is not None:
            return db_state
        return self._load_from_file()

    def save(
        self,
        farmers: dict[str, dict[str, Any]],
        farms: dict[str, dict[str, Any]],
        sessions: dict[str, str],
        sync_drafts: dict[str, dict[str, Any]] | None = None,
        sync_queue: dict[str, dict[str, Any]] | None = None,
    ) -> None:
        payload = {
            "farmers": farmers,
            "farms": farms,
            "sessions": sessions,
            "sync_drafts": sync_drafts or {},
            "sync_queue": sync_queue or {},
        }
        self._save_to_database(payload)
        self._save_to_file(payload)

    def _load_from_database(self) -> dict[str, dict[str, Any]] | None:
        if not self.database_url or psycopg is None:
            return None
        try:
            with psycopg.connect(self.database_url) as connection, connection.cursor() as cursor:
                cursor.execute(
                    "CREATE TABLE IF NOT EXISTS app_runtime_state (key TEXT PRIMARY KEY, value JSONB NOT NULL, updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW())"
                )
                cursor.execute(
                    "SELECT value FROM app_runtime_state WHERE key = 'soilsync_runtime_state'"
                )
                row = cursor.fetchone()
                if row is None:
                    return None
                payload = row[0]
                if not isinstance(payload, dict):
                    return None
                return {
                    "farmers": payload.get("farmers", {}) if isinstance(payload.get("farmers", {}), dict) else {},
                    "farms": payload.get("farms", {}) if isinstance(payload.get("farms", {}), dict) else {},
                    "sessions": payload.get("sessions", {}) if isinstance(payload.get("sessions", {}), dict) else {},
                    "sync_drafts": payload.get("sync_drafts", {}) if isinstance(payload.get("sync_drafts", {}), dict) else {},
                    "sync_queue": payload.get("sync_queue", {}) if isinstance(payload.get("sync_queue", {}), dict) else {},
                }
        except psycopg.Error:
            logger.warning("Runtime state database read failed; falling back to local file.")
            return None

    def _save_to_database(self, payload: dict[str, Any]) -> None:
        if not self.database_url or psycopg is None:
            return
        try:
            with psycopg.connect(self.database_url) as connection, connection.cursor() as cursor:
                cursor.execute(
                    "CREATE TABLE IF NOT EXISTS app_runtime_state (key TEXT PRIMARY KEY, value JSONB NOT NULL, updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW())"
                )
                cursor.execute(
                    "INSERT INTO app_runtime_state (key, value) VALUES ('soilsync_runtime_state', %s) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()",
                    (payload,),
                )
                connection.commit()
        except psycopg.Error:
            logger.warning("Runtime state database write failed.", exc_info=True)
            return

    def _load_from_file(self) -> dict[str, dict[str, Any]]:
        if not self.path.exists():
            return {"farmers": {}, "farms": {}, "sessions": {}, "sync_drafts": {}, "sync_queue": {}}

        try:
            payload = json.loads(self.path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            return {"farmers": {}, "farms": {}, "sessions": {}, "sync_drafts": {}, "sync_queue": {}}

        return {
            "farmers": payload.get("farmers", {}) if isinstance(payload.get("farmers", {}), dict) else {},
            "farms": payload.get("farms", {}) if isinstance(payload.get("farms", {}), dict) else {},
            "sessions": payload.get("sessions", {}) if isinstance(payload.get("sessions", {}), dict) else {},
            "sync_drafts": payload.get("sync_drafts", {}) if isinstance(payload.get("sync_drafts", {}), dict) else {},
            "sync_queue": payload.get("sync_queue", {}) if isinstance(payload.get("sync_queue", {}), dict) else {},
        }

    def _save_to_file(self, payload: dict[str, Any]) -> None:
        self.path.write_text(json.dumps(payload, indent=2, sort_keys=True), encoding="utf-8")
