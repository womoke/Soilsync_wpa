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

The backend restores the default administrative permission set to accounts with an active `admin` assignment in `user_roles`, reactivating and removing expiry from existing default permission rows. The legacy `users.role` field is not used to determine admin access. To provision a system owner, configure `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` for the intended Supabase project, then run the script from `backend`. Use `--invite` to send an email invitation without handling the account password:

```powershell
..\.venv\Scripts\python.exe database\scripts\create_initial_admin.py --email admin@example.org --name "System Administrator" --invite
```

The script creates or reuses the matching Supabase Auth identity, links or repairs its `users` profile as `admin`, assigns the active `admin` role using the Auth UUID, and grants permissions using the app-profile UUID. Without `--invite`, a new account is created with a password entered through a secure prompt; existing Auth accounts are promoted without prompting for or changing their password. Invitation links redirect to `/reset-password?invite=1` on the SoilSync Vercel site by default. Set `AUTH_INVITE_REDIRECT_URL` on Render and in local environments to override that callback, and allowlist the exact URL in Supabase Auth URL Configuration. Verify the target project and email before running it: an existing Auth identity for that email will be promoted to admin.

From `backend`, install the database driver with `python -m pip install -e ".[postgres]"` and configure `DATABASE_URL` in the workspace-root `.env` (copy `.env.example` as a template). For local Supabase, use the ignored workspace-root `.env.local`; the backend and migration manager load it before `.env`, while explicitly exported environment variables retain highest priority. Verify the target before running `--apply` or `--reconcile`. Use the Supabase session-pooler URL for hosted development; never place the database URL or service-role key in a `VITE_` variable.

## Retired project soil dataset

The rights for `soil_data_all.csv` have not been confirmed. Do not import, redistribute,
or use it for recommendations. The legacy importer is disabled; its CSV audit mode
does not write to the database.

Before any cleanup, run the read-only inventory against a staging copy or restored
backup:

```powershell
.\.venv\Scripts\python.exe scripts\audit_retired_soil_data.py
```

Run it from the repository root with the staging `DATABASE_URL` set in the process
environment or in the workspace-root `.env` file. An explicit process variable
takes precedence; the audit intentionally does not load `.env.local`. The script
opens a read-only transaction and reports affected
readings, assessments and published reports, ward-summary and officer-export
impact, plus per-table row counts that
migration `032` would delete or rename (including cascade effects and readings
that could block provenance deletion). It intentionally omits farmer names and
coordinates. Save and review the output before proceeding.

Migration `033_quarantine_retired_soil_readings.sql` adds exclusion metadata and
quarantines legacy-provider and demo readings without deleting them. Validate it
against staging and verify the inventory and downstream views before deploying
application code that reads `excluded_at`. The retained demo seed remains
available only to the explicit demo-reading endpoint; operational queries still
exclude it.

Migration `034_soil_estimate_snapshots_and_measurement_quality.sql` adds the
dataset-version snapshot, measurement uncertainty/depth/transformation metadata,
and the per-reading estimate-request audit table. It does not fetch or store
third-party estimates by itself; iSDA integration remains a separate, consent-
gated work package.

Migration `035_officer_location_consent.sql` adds an audit record for the
farmer's consent to store exact farm coordinates, including the officer who
recorded it, wording version, scope, notes, and timestamp. Field collection
rejects missing consent and writes the consent record before updating farm
coordinates, in the same transaction. The current consent scope is storage
only; no permission to send coordinates to an external soil service is implied
or recorded.

Migration `036_farm_location_history.sql` records the prior and replacement
coordinates when a consented officer collection changes a farm's location. The
history write, storage-consent record, and farm update occur in one transaction;
unchanged coordinates do not create a history row. The table has RLS enabled and
is not exposed through farmer or officer read APIs.

Migration `037_isda_snapshot_persistence.sql` adds provenance links between a
measured field reading, its explicit third-party-consent record, the request
audit row, and a separate `ISDA_SOIL` estimate snapshot. The backend has
non-network persistence helpers for pending, successful, and failed requests;
successful estimates remain marked `estimated` and are excluded from measured
field-data cohorts. Request creation requires consent specifically scoped to
third-party soil-service coordinate sharing, and the caller must supply
policy-rounded coordinates and dataset/license/attribution metadata. The
scaffolding checks those metadata fields are present but does not independently
verify the values.
No API route or job invokes these helpers or the iSDA client. Do not enable live
requests or apply this migration until D1, D2, D7, and D15 are resolved and the
ordered migration staging/backup gate is satisfied.

Officer report exports omit farmer names and are suppressed unless the selected
scope includes valid field measurements from at least three distinct farmers.
The ward-summary endpoint uses the same minimum cohort threshold.

Migration `032_retire_project_soil_dataset.sql` is destructive and was applied
to production after a verified encrypted backup was restored and the migration
sequence was rehearsed locally. Before application, the audit found 75,500
project-source readings, 884,674 measurements, 75,500 provenance rows and one
import batch to be removed; one dataset registry row was renamed. The local
rehearsal matched those counts. Post-migration read-only verification found no
remaining project-source readings or dataset keys; migration `033` quarantined
one demo reading. There were no affected assessments or published reports.
The encrypted backup is stored outside the repository under the current user's
Documents backup folder; its AES-256-GCM key is protected with Windows DPAPI
for that user. Database cleanup does not remove copies from repository history,
deployment artifacts, or retained backups; handle those separately under
applicable rights and retention requirements.

Migrations `031` through `037` are recorded in production and their checksums
match the local files. Confirm that the backend release containing the related
application changes is deployed before relying on the new schema-dependent
paths. The migration manager applies pending migrations in numeric order
without prompting, so review the full pending sequence before using `--apply`
against any hosted database.

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
- The retired project dataset is not approved for prototype or production use. External ISRIC records remain subject to source-specific license filtering, provenance, and agronomic review before persistence or farmer-facing use.
- Migration `007_farmer_recommendation_feedback.sql` creates append-only, RLS-enabled feedback events; writes are owner-checked by the backend and no client policies are granted.
- Migration `008_farm_ownership_review.sql` defaults farms to pending owner review; only an approved farm accepts farmer reading mutations.
- Migration `009_farmer_sync_records.sql` replaces shared runtime-state sync data with RLS-enabled, owner/farm-linked draft and queue tables. `draft_id` uniqueness makes queue retries idempotent.
- Migration `010_officer_jurisdictions.sql` stores server-managed county/sub-county/ward assignments; no client policies are added.
- Migrations `016_auth_authorization_v1.sql` and `017_user_role_identity_sync.sql` establish Auth-UUID profiles and active role records. Migrations `018_user_roles_rls_authority.sql` and `019_dealer_profile_admin_policy.sql` ensure role-sensitive RLS checks use active `user_roles`, not the compatibility `users.role` field. Migration `020_lock_down_legacy_runtime_state.sql` enables forced RLS on the legacy shared runtime-state table and removes client access.
- Migration `029_role_workflow_reliability.sql` repairs agronomist activation state, permits the unclaimed farmer lifecycle state, deduplicates pending farm visits before enforcing one open request per farm, and adds a retryable queue for deleting expired Supabase Auth identities.
- Migration `030_self_service_profile_permissions.sql` prevents direct client updates to profile rows; signed-in users edit only their name and phone through the authenticated backend, while location attributes remain server-managed.
- Migrations `021_block_spatial_ref_sys_data_api.sql` through `023_fix_request_hook_error_response.sql` install and register a PostgREST pre-request hook that rejects every Data API request whose path targets `spatial_ref_sys`. The hook leaves other Data API endpoints unchanged. This does not change the extension-owned table ACL, hide its metadata from API discovery, or govern Realtime, Storage, or direct database connections.
- For existing databases, `migration_history.py --reconcile` records verified schema presence and local checksums as `schema_reconciled`; it does not recreate or assert original execution times. Migrations applied by the manager are recorded as `executed`.
- On the configured Supabase database, `spatial_ref_sys` remains owned by `supabase_admin`, and the effective ACL still grants client write privileges. Because the configured SQL editor cannot revoke those grants, the registered pre-request hook now blocks the table endpoint instead. Verify with an anonymous GET to `/rest/v1/spatial_ref_sys?select=srid&limit=1` (expected `404`) and an unrelated Data API endpoint (expected to continue working). This hook is an API-layer guard, not a change to the underlying table privileges.
- Keep Supabase service-role credentials server-side. The Auth subject is stored as a unique UUID; only the backend may bind it after provider verification.
