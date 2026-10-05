"""Inspect, reconcile, and apply the numbered PostgreSQL migrations."""

from __future__ import annotations

import argparse
import hashlib
import os
import re
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Any
from urllib.parse import urlparse

try:
    import psycopg
except ImportError as exc:  # pragma: no cover
    raise SystemExit(
        'Install the backend PostgreSQL extra: python -m pip install -e ".[postgres]"'
    ) from exc


ROOT = Path(__file__).resolve().parents[2]
MIGRATIONS_DIR = Path(__file__).resolve().parent / "migrations"
HISTORY_TABLE = "soilsync_meta.migration_history"


@dataclass(frozen=True)
class Migration:
    version: str
    name: str
    path: Path
    sql: str
    checksum: str


def _load_env_file() -> None:
    for env_file in (ROOT / ".env.local", ROOT / ".env"):
        if not env_file.is_file():
            continue
        for raw_line in env_file.read_text(encoding="utf-8").splitlines():
            line = raw_line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, value = line.split("=", 1)
            os.environ.setdefault(key.strip(), value.strip().strip('"').strip("'"))


def _database_url() -> str:
    _load_env_file()
    url = os.environ.get("DATABASE_URL", "").strip()
    if not url:
        raise RuntimeError("DATABASE_URL is not configured.")

    supabase_url = os.environ.get("SUPABASE_URL", "").strip()
    project_match = re.fullmatch(
        r"https://([a-z0-9]+)\.supabase\.co/?", supabase_url, flags=re.IGNORECASE
    )
    if project_match:
        project_ref = project_match.group(1).lower()
        parsed = urlparse(url)
        if project_ref not in (parsed.username or "").lower() and project_ref not in (
            parsed.hostname or ""
        ).lower():
            raise RuntimeError(
                "DATABASE_URL and SUPABASE_URL do not appear to target the same project."
            )
    return url


def _load_migrations() -> list[Migration]:
    migrations: list[Migration] = []
    for path in sorted(MIGRATIONS_DIR.glob("[0-9][0-9][0-9]_*.sql")):
        sql = path.read_text(encoding="utf-8")
        version, name = path.stem.split("_", 1)
        migrations.append(
            Migration(
                version=version,
                name=name,
                path=path,
                sql=sql,
                checksum=hashlib.sha256(sql.encode("utf-8")).hexdigest(),
            )
        )
    if not migrations:
        raise RuntimeError(f"No numbered SQL migrations found in {MIGRATIONS_DIR}.")
    return migrations


def _bootstrap_history(connection: psycopg.Connection[Any]) -> None:
    connection.execute("CREATE SCHEMA IF NOT EXISTS soilsync_meta")
    connection.execute(
        "REVOKE ALL ON SCHEMA soilsync_meta FROM PUBLIC, anon, authenticated"
    )
    connection.execute(
        f"""
        CREATE TABLE IF NOT EXISTS {HISTORY_TABLE} (
            version TEXT PRIMARY KEY,
            migration_name TEXT NOT NULL,
            checksum_sha256 TEXT NOT NULL
                CHECK (checksum_sha256 ~ '^[0-9a-f]{{64}}$'),
            recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            recorded_by TEXT NOT NULL DEFAULT CURRENT_USER,
            method TEXT NOT NULL CHECK (
                method IN ('executed', 'schema_reconciled')
            )
        )
        """
    )


def _history_exists(connection: psycopg.Connection[Any]) -> bool:
    row = connection.execute("SELECT to_regclass(%s)", (HISTORY_TABLE,)).fetchone()
    return bool(row and row[0])


def _has_application_schema(connection: psycopg.Connection[Any]) -> bool:
    row = connection.execute(
        """
        SELECT EXISTS (
            SELECT 1
            FROM information_schema.tables
            WHERE table_schema = 'public'
              AND table_type = 'BASE TABLE'
        )
        """
    ).fetchone()
    return bool(row and row[0])


def _read_history(connection: psycopg.Connection[Any]) -> dict[str, dict[str, str]]:
    if not _history_exists(connection):
        return {}
    rows = connection.execute(
        f"""
        SELECT version, migration_name, checksum_sha256, method
        FROM {HISTORY_TABLE}
        ORDER BY version
        """
    ).fetchall()
    return {
        version: {
            "name": name,
            "checksum": checksum,
            "method": method,
        }
        for version, name, checksum, method in rows
    }


def _validate_schema(
    connection: psycopg.Connection[Any], migrations: list[Migration]
) -> list[str]:
    missing: list[str] = []
    tables = {
        row[0]
        for row in connection.execute(
            """
            SELECT table_name FROM information_schema.tables
            WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
            """
        ).fetchall()
    }
    columns = {
        (table, column)
        for table, column in connection.execute(
            """
            SELECT table_name, column_name FROM information_schema.columns
            WHERE table_schema = 'public'
            """
        ).fetchall()
    }
    indexes = {
        row[0]
        for row in connection.execute(
            "SELECT indexname FROM pg_indexes WHERE schemaname = 'public'"
        ).fetchall()
    }
    triggers = {
        row[0]
        for row in connection.execute(
            "SELECT tgname FROM pg_trigger WHERE NOT tgisinternal"
        ).fetchall()
    }
    policies = {
        (table, policy)
        for table, policy in connection.execute(
            "SELECT tablename, policyname FROM pg_policies WHERE schemaname = 'public'"
        ).fetchall()
    }
    functions = {
        row[0]
        for row in connection.execute(
            """
            SELECT p.proname FROM pg_proc p
            JOIN pg_namespace n ON n.oid = p.pronamespace
            WHERE n.nspname = 'public'
            """
        ).fetchall()
    }
    rls_tables = {
        row[0]
        for row in connection.execute(
            """
            SELECT c.relname FROM pg_class c
            JOIN pg_namespace n ON n.oid = c.relnamespace
            WHERE n.nspname = 'public' AND c.relrowsecurity
            """
        ).fetchall()
    }

    for migration in migrations:
        sql = migration.sql
        for table in re.findall(
            r"\bCREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?"
            r"(?:public\.)?([a-z_]\w*)",
            sql,
            flags=re.IGNORECASE,
        ):
            if table.lower() not in tables:
                missing.append(f"{migration.version}: table public.{table}")
        for index in re.findall(
            r"\bCREATE\s+(?:UNIQUE\s+)?INDEX\s+(?:IF\s+NOT\s+EXISTS\s+)?"
            r"([a-z_]\w*)",
            sql,
            flags=re.IGNORECASE,
        ):
            if index.lower() not in indexes:
                missing.append(f"{migration.version}: index {index}")
        for trigger in re.findall(
            r"\bCREATE\s+TRIGGER\s+([a-z_]\w*)",
            sql,
            flags=re.IGNORECASE,
        ):
            if trigger.lower() not in triggers:
                missing.append(f"{migration.version}: trigger {trigger}")
        for function in re.findall(
            r"\bCREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+"
            r"(?:public\.)?([a-z_]\w*)\s*\(",
            sql,
            flags=re.IGNORECASE,
        ):
            if function.lower() not in functions:
                missing.append(f"{migration.version}: function public.{function}")
        for policy, table in re.findall(
            r"\bCREATE\s+POLICY\s+([a-z_]\w*)\s+ON\s+"
            r"(?:public\.)?([a-z_]\w*)",
            sql,
            flags=re.IGNORECASE,
        ):
            if (table.lower(), policy.lower()) not in policies:
                missing.append(f"{migration.version}: policy {table}.{policy}")
        for statement in re.findall(
            r"\bALTER\s+TABLE\s+(?:public\.)?([a-z_]\w*)\b(.*?);",
            sql,
            flags=re.IGNORECASE | re.DOTALL,
        ):
            table, actions = statement
            for column in re.findall(
                r"\bADD\s+COLUMN\s+(?:IF\s+NOT\s+EXISTS\s+)?([a-z_]\w*)",
                actions,
                flags=re.IGNORECASE,
            ):
                if (table.lower(), column.lower()) not in columns:
                    missing.append(f"{migration.version}: column {table}.{column}")
            if re.search(r"\bENABLE\s+ROW\s+LEVEL\s+SECURITY\b", actions, re.I):
                if table.lower() not in rls_tables:
                    missing.append(f"{migration.version}: RLS enabled on {table}")
    return list(dict.fromkeys(missing))


def _print_status(connection: psycopg.Connection[Any], migrations: list[Migration]) -> int:
    if not _history_exists(connection):
        print("Migration history is not initialized.")
        print(f"Local numbered SQL migrations: {len(migrations)}")
        return 1 if _has_application_schema(connection) else 0

    history = _read_history(connection)
    failed = False
    for migration in migrations:
        record = history.get(migration.version)
        if record is None:
            state = "PENDING"
        elif (
            record["name"] != migration.name
            or record["checksum"] != migration.checksum
        ):
            state = "CHECKSUM MISMATCH"
            failed = True
        else:
            state = f"recorded ({record['method']})"
        print(f"{migration.version} {migration.name}: {state}")

    local_versions = {migration.version for migration in migrations}
    unknown = sorted(set(history) - local_versions)
    for version in unknown:
        print(f"{version}: history record has no local migration file")
        failed = True
    return 1 if failed else 0


def _reconcile(connection: psycopg.Connection[Any], migrations: list[Migration]) -> int:
    if not _has_application_schema(connection):
        raise RuntimeError(
            "The database has no application schema; use --apply on an empty database."
        )
    missing = _validate_schema(connection, migrations)
    if missing:
        raise RuntimeError(
            "Schema reconciliation failed; missing objects:\n  - " + "\n  - ".join(missing)
        )

    history = _read_history(connection)
    local_versions = {migration.version for migration in migrations}
    unknown = sorted(set(history) - local_versions)
    if unknown:
        raise RuntimeError(
            "History has migration versions with no local file: " + ", ".join(unknown)
        )

    with connection.transaction():
        for migration in migrations:
            record = history.get(migration.version)
            if record:
                if (
                    record["name"] != migration.name
                    or record["checksum"] != migration.checksum
                ):
                    raise RuntimeError(
                        f"Migration {migration.version} differs from its existing history record."
                    )
                continue
            connection.execute(
                f"""
                INSERT INTO {HISTORY_TABLE}
                    (version, migration_name, checksum_sha256, method)
                VALUES (%s, %s, %s, 'schema_reconciled')
                """,
                (migration.version, migration.name, migration.checksum),
            )
    print(f"Reconciled {len(migrations) - len(history)} migrations against the live schema.")
    print("Records are marked schema_reconciled, not as historical execution timestamps.")
    return 0


def _strip_transaction_wrapper(sql: str, version: str) -> str:
    without_begin, begin_count = re.subn(
        r"\A(?:(?:--[^\r\n]*(?:\r?\n|\Z))|/\*.*?\*/|\s)*BEGIN\s*;\s*",
        "",
        sql,
        count=1,
        flags=re.IGNORECASE | re.DOTALL,
    )
    without_commit, commit_count = re.subn(
        r"\s*COMMIT\s*;\s*\Z",
        "",
        without_begin,
        count=1,
        flags=re.IGNORECASE,
    )
    if begin_count != 1 or commit_count != 1:
        raise RuntimeError(
            f"Migration {version} must have a single outer BEGIN/COMMIT transaction."
        )
    return without_commit


def _apply(connection: psycopg.Connection[Any], migrations: list[Migration]) -> int:
    history = _read_history(connection)
    if not history and _has_application_schema(connection):
        raise RuntimeError(
            "This database already has application tables but no migration history. "
            "Run --reconcile after reviewing the live schema; refusing to replay old migrations."
        )

    missing_seen = False
    for migration in migrations:
        record = history.get(migration.version)
        if record:
            if record["name"] != migration.name or record["checksum"] != migration.checksum:
                raise RuntimeError(
                    f"Migration {migration.version} changed after it was recorded; "
                    "create a new migration instead of editing an applied file."
                )
            if missing_seen:
                raise RuntimeError(
                    f"History has a gap before recorded migration {migration.version}."
                )
            continue

        missing_seen = True
        body = _strip_transaction_wrapper(migration.sql, migration.version)
        with connection.transaction():
            connection.execute(body, prepare=False)
            connection.execute(
                f"""
                INSERT INTO {HISTORY_TABLE}
                    (version, migration_name, checksum_sha256, method)
                VALUES (%s, %s, %s, 'executed')
                """,
                (migration.version, migration.name, migration.checksum),
            )
        print(f"Applied migration {migration.version} ({migration.name}).")
    if not missing_seen:
        print("All local migrations are already applied and checksums match.")
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    mode = parser.add_mutually_exclusive_group(required=True)
    mode.add_argument("--status", action="store_true", help="Compare local files to database history.")
    mode.add_argument(
        "--reconcile",
        action="store_true",
        help="Record existing migrations only after verifying their declared schema objects.",
    )
    mode.add_argument("--apply", action="store_true", help="Apply pending migrations in order.")
    args = parser.parse_args()

    migrations = _load_migrations()
    try:
        url = _database_url()
        with psycopg.connect(url, connect_timeout=15, sslmode="prefer") as connection:
            if not _history_exists(connection):
                if args.status:
                    return _print_status(connection, migrations)
                _bootstrap_history(connection)
                connection.commit()
            if args.status:
                return _print_status(connection, migrations)
            if args.reconcile:
                return _reconcile(connection, migrations)
            return _apply(connection, migrations)
    except Exception as exc:
        print(f"Migration operation failed: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
