# Database foundation

This directory contains the local PostgreSQL/PostGIS setup used for the Phase 2 backend foundation. The files are intentionally local-demo safe and are not connected to production or external provider data yet.

`backend/app/database_schema.sql` is the complete current-schema snapshot. For an existing database, apply the numbered migration files in order.

## Local setup

1. Create a local database:

   ```bash
   createdb soilsync_dev
   ```

2. Enable PostGIS:

   ```bash
   psql -d soilsync_dev -c "CREATE EXTENSION IF NOT EXISTS postgis;"
   ```

3. Apply the numbered migrations from the repository root:

   ```bash
   .venv\Scripts\python.exe backend\database\migration_history.py --apply
   ```

   The migration manager applies files in numeric order and records each file's SHA-256 checksum in the private `soilsync_meta.migration_history` schema in the same transaction as the migration. It rejects edits to previously recorded migration files and gaps in migration history.

   For an existing database with no history table, inspect the live schema first, then reconcile it:

   ```bash
   .venv\Scripts\python.exe backend\database\migration_history.py --status
   .venv\Scripts\python.exe backend\database\migration_history.py --reconcile
   .venv\Scripts\python.exe backend\database\migration_history.py --status
   ```

   `--reconcile` does not replay SQL or claim historical execution timestamps. It verifies the tables, columns, indexes, triggers, functions, policies, and RLS declarations found in the local migration files, then records the current schema and file checksums. Review any missing-object report before proceeding. Use `--apply` for subsequent migrations.

4. Load local demo seed data:

   ```bash
   psql -d soilsync_dev -f backend/database/seed/dev_seed.sql
   psql -d soilsync_dev -f backend/database/seed/demo_dashboard_seed.sql
   psql -d soilsync_dev -f backend/database/seed/agrodealer_catalog_seed.sql
   ```

Farmer APIs require a verified Supabase bearer token and resolve the linked app profile before accessing Postgres. Farms are selected by `owner_id`; farmer-created readings and normalized measurements are inserted only for owned, ownership-approved farms; recommendations are filtered by owned farm or user; feedback is stored as append-only events tied to the authenticated user and an owned recommendation. Sync drafts and queue records are durable, owner/farm-linked rows; a draft can enter the queue only once. Officer roster reads require an active `extension_officer` profile and match every non-null county/sub-county/ward assignment, returning only minimal farmer/farm fields. Authenticated dealer catalog reads bind to the verified dealer user and exclude demo records. New farms require ownership review before reading submission or sync. Synthetic screens remain under `/api/v1/demo/`; their role selector is not authorization. `DATABASE_URL` must point to the same app database used by the Supabase profile integration; APIs return `503` rather than substitute JSON fixtures when unavailable. Dealer demo coordinates and prices are intentionally unset, and seeded products are not orderable. Apply all migrations in numerical order and all three seed files before opening the app. Migration 015 explicitly prevents authenticated users from changing their app roles or other identity fields directly through Supabase's Data API.

From `backend`, install the database driver with `python -m pip install -e ".[postgres]"` and configure `DATABASE_URL` in the workspace-root `.env` (copy `.env.example` as a template). Use the Supabase session-pooler URL for hosted development; never place the database URL or service-role key in a `VITE_` variable.

## Import the project soil dataset

The loader reads only an explicit soil-data allowlist. It does not read or insert `farmers_Name`, `telephone_No`, or free-text farm descriptions. A dry run is the default and does not connect to a database:

```bash
cd backend
python -m app.dataset_loader
```

For a database import, install the optional PostgreSQL driver, set `DATABASE_URL` in the environment, review the dry-run counts, then explicitly apply:

```bash
python -m pip install -e ".[postgres]"
python -m app.dataset_loader --apply
```

The import is one transaction, records a SHA-256 batch fingerprint, and refuses to import the same file fingerprint twice. Each analyte is stored separately with its original value text, source unit, source class, and validity; invalid analytes do not discard the rest of a sample. Lab methods are left null because the CSV does not provide a method column. Do not use its historical fertilizer text as measured crop-response outcomes.

## Backup and restore

Use filesystem-friendly dump/restore commands for local review and recovery:

```bash
pg_dump -Fc -d soilsync_dev > ./backups/soilsync_dev_$(date +%Y%m%d_%H%M%S).dump
pg_restore -d soilsync_dev ./backups/soilsync_dev_20260601_120000.dump
```

Create the backup folder first if it does not exist:

```bash
mkdir -p backups
```

## Notes

- The seed data is synthetic and should never be treated as an approved production dataset.
- Migration `002_dataset_measurements.sql` adds dataset/import provenance and normalized analyte records; `farm_id` is nullable for samples that have no verified farm link.
- Migration `003_enable_rls.sql` enables RLS on all application tables without adding client policies. This intentionally denies `anon` and `authenticated` access until authentication and row-ownership policies are implemented; backend/service-role access must remain server-side.
- Import allowlists should exclude `farmers_Name`, `telephone_No`, and free-text farm descriptions. The schema stores crop text and historical recommendation text only for reference, not as outcome labels.
- Keep invalid numeric tokens at measurement level as `source_value_text`; do not discard an otherwise usable soil sample because one analyte is invalid.
- The legacy reading-level `measurement_quality` is an aggregate (`valid`, `mixed`, or `missing`); use `soil_measurements.quality_status` for decisions about individual analytes.
- Map `id` to `source_record_id`, `lab_No`/`lab_No_Year` to lab references, `year` to `sample_year`, and county/constituency/ward/village to their corresponding fields. Preserve both original `latitude`/`longitude` and `final_Latitude`/`final_Longitude`; only populate the indexed location pair from a valid pair and record its basis in `coordinate_source`.
- Map `soil_depth_cm` to the verbatim depth label; set numeric depth bounds only when the source provides a supported mapping. Map each analyte and its paired `*_Class` field to one `soil_measurements` row, preserving the exact input header in `source_analyte` and the class in `source_quality_class`. Leave `analytical_method` null because this CSV has no method column.
- Store `crop` and `fertilizer_Recommendation` as source text for context only. Do not map recommendation text to treatment efficacy or yield outcomes.
- Project-provided soil data may inform prototype benchmarks under the project owner's stated assumption. External ISRIC records remain subject to source-specific license filtering, provenance, and agronomic review before persistence or farmer-facing use.
- Migration `007_farmer_recommendation_feedback.sql` creates append-only, RLS-enabled feedback events; writes are owner-checked by the backend and no client policies are granted.
- Migration `008_farm_ownership_review.sql` defaults farms to pending owner review; only an approved farm accepts farmer reading mutations.
- Migration `009_farmer_sync_records.sql` replaces shared runtime-state sync data with RLS-enabled, owner/farm-linked draft and queue tables. `draft_id` uniqueness makes queue retries idempotent.
- Migration `010_officer_jurisdictions.sql` stores server-managed county/sub-county/ward assignments; no client policies are added.
- Migrations `016_auth_authorization_v1.sql` and `017_user_role_identity_sync.sql` establish Auth-UUID profiles and active role records. Migrations `018_user_roles_rls_authority.sql` and `019_dealer_profile_admin_policy.sql` ensure role-sensitive RLS checks use active `user_roles`, not the compatibility `users.role` field. Migration `020_lock_down_legacy_runtime_state.sql` enables forced RLS on the legacy shared runtime-state table and removes client access.
- Migrations `021_block_spatial_ref_sys_data_api.sql` through `023_fix_request_hook_error_response.sql` install and register a PostgREST pre-request hook that rejects every Data API request whose path targets `spatial_ref_sys`. The hook leaves other Data API endpoints unchanged. This does not change the extension-owned table ACL, hide its metadata from API discovery, or govern Realtime, Storage, or direct database connections.
- For existing databases, `migration_history.py --reconcile` records verified schema presence and local checksums as `schema_reconciled`; it does not recreate or assert original execution times. Migrations applied by the manager are recorded as `executed`.
- On the configured Supabase database, `spatial_ref_sys` remains owned by `supabase_admin`, and the effective ACL still grants client write privileges. Because the configured SQL editor cannot revoke those grants, the registered pre-request hook now blocks the table endpoint instead. Verify with an anonymous GET to `/rest/v1/spatial_ref_sys?select=srid&limit=1` (expected `404`) and an unrelated Data API endpoint (expected to continue working). This hook is an API-layer guard, not a change to the underlying table privileges.
- Keep Supabase service-role credentials server-side. The Auth subject is stored as a unique UUID; only the backend may bind it after provider verification.
