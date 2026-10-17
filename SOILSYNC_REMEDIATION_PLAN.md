# SoilSync Remediation Plan: iSDA (API + stored snapshot) and rules-engine hardening

Audience: GitHub Copilot and the developers reviewing its work.
Status: draft v2 for implementation. Written from `models.py`, `recommendations.py`, `database.py`, migration `007` and the product description. Still NOT reviewed (marked VERIFY): `ExtensionOfficerAccount.tsx`, `AgronomistAccount.tsx`, `SOILSYNC_PRODUCT_REFERENCE_V5.md`, API route files, and migrations other than `007`.

v3 change: iSDAsoil Terms of Use and the CC BY 4.0 deed reviewed; attribution, change-marking, non-endorsement and disclaimer requirements added (WP4.8, WP4.10, section 4a, D1, D15).

v2 change: the `database.py` review added gaps G21-G33 and a new work package, **WP11 (publication integrity)**. Several of these are more urgent than the iSDA work. See section 5.

---

## 0. Ground rules (read first)

1. **Do not invent agronomic content.** No new thresholds, rates, lime formulas, county factors, accepted-method lists, or plausibility bounds may be made up. Where a value is needed and none exists, add a clearly named config entry with `status: "UNVERIFIED"` and a `TODO(agronomist)` comment. Existing numbers stay as they are until an agronomist signs off (see section 7, decisions).
2. **Do not assume the iSDA API response shape.** Inspect the `/layers` metadata response and recorded fixtures first. Write the parser against the real response. Do not hardcode units, depths or transforms from memory.
3. **Read before editing.** VERIFY: `ExtensionOfficerAccount.tsx`, `AgronomistAccount.tsx`, `SOILSYNC_PRODUCT_REFERENCE_V5.md`, the API route files that call the `database.py` functions named below, the schema for `soil_readings`, `soil_measurements`, `agronomic_assessments`, `recommendations`, `source_datasets`, `source_import_batches`, and any consumer of `generate_agronomic_assessment` output (backend and TS types). Function names in this plan refer to `database.py`.
4. **Small PRs, one work package each**, each with tests. No change should alter published report contents retroactively.
5. **Never call iSDA from the client.** Server-side only. iSDA credentials and tokens come from environment/secret storage, never from source or logs.
6. **Never log raw farm coordinates** in application logs. Store them only in the designated tables.

## 1. Decisions already made

| Decision | Detail |
|---|---|
| Engine type | Stay **rule-based**. No model is trained now. A model is considered only after linked treatment-and-outcome data exists (WP9). |
| iSDA role | iSDA values are **modelled estimates**: stored and displayed as such, used for diagnosis and context, **never for application quantities**. |
| Access pattern | **Call the iSDA API once per reading, server-side, and persist the returned values as a snapshot.** Do not re-fetch for display. No bulk mirror of rasters for now. |
| Review vs outcome | Officer flags and agronomist edits are stored as **reviewed judgments**. They are never treated as evidence that advice worked. |

Re-evaluate a local clipped raster copy if: API terms or rate limits block us, the service is unreliable, radius sampling (WP4.6) is required, or consent cannot cover sending coordinates to a third party.

## 2. Gap register

| ID | Gap | Evidence | WP |
|---|---|---|---|
| G1 | Engine ignores quality status, unit, method, uncertainty; estimates would be treated like lab values | `_measurement_map()` keeps only `.value`; `generate_agronomic_assessment` takes `dict[str, float \| None]` | WP5 |
| G2 | No iSDA provider; analyte names bake in method (`olsen_phosphorus`, `exchangeable_potassium`) so iSDA P/K would be mislabeled | `SoilDataProvider`, `SoilAnalyte` in `models.py` | WP2 |
| G3 | Data from the invalid source may still exist in storage, aggregates, exports, benchmarks or published reports | Legacy providers in `SoilDataProvider` (`PROJECT_SOIL_DATASET`, `ISRIC_*`); VERIFY `database.py` | WP1 |
| G4 | Unknown crop silently falls back to the maize profile and is reported as maize | `CROP_AGRONOMIC_PROFILES.get(crop_key, ...["maize"])` | WP6 |
| G5 | Missing county becomes Nyeri (highest buffer factor); 19 of 47 counties covered; default zone text claims local calibration | `county_clean = ... else "nyeri"`, `COUNTY_AEZ_FACTORS`, `DEFAULT_AEZ` | WP6 |
| G6 | N top-dress prescribed whenever a total-N value exists, even when status is "optimal"; interpretation text contradicts status; starter N unused; DAP N not credited | Section 4 of `generate_agronomic_assessment` | WP6 |
| G7 | K rate: basis unlabeled (K vs K2O), same rate regardless of deficit, no bag count | `k_req_kg_ha` use in section 6 | WP6 |
| G8 | Lime requirement is a county-factor heuristic (`deficit * buffer_factor`, cap 5 t/ha) | Section 2 | WP6 |
| G9 | Unsupported claims in output text ("up to 60% of applied P locked", "Al/Fe toxicity active") | Section 2 advisory/diagnosis strings | WP6 |
| G10 | "KALRO" provenance asserted in names and disclaimer with no source links; version strings inconsistent (`kalro-rules-v2.1` vs "V5 Specification") | Module comments, `engineVersion`, `disclaimer` | WP7 |
| G11 | `aiAdvisoryNotes` are template strings, not AI; echoes free-text `field_notes` | Output dict | WP6 |
| G12 | `OfficerFieldCollectionRequest` lacks top <= bottom depth check (farmer model has it) | `models.py` | WP2 |
| G13 | Olsen P targets (20-30 mg/kg) may be too high; unverified | `CROP_AGRONOMIC_PROFILES` | WP7 (agronomist) |
| G14 | No consent coverage for transmitting coordinates to a third party | Consent recorded for saving coordinates only | WP4 |
| G15 | Farm `crops` is free text up to 300 chars; no crop normalization or multi-crop handling | `FarmerFarmCreateRequest.crops` | WP6 |
| G16 | Review workflow cannot tell the agronomist the data tier; officer "flag" workflow may not be implemented | VERIFY TSX files and V5 reference | WP8 |
| G17 | Farmer report does not disclose modelled data or iSDA attribution | VERIFY report rendering | WP8 |
| G18 | No linked treatment-and-harvest records; feedback (viewed/followed/modified/not-followed) cannot show what worked | Migration `007`, `RecommendationFeedbackRequest` | WP9 |
| G19 | Agronomist edits not clearly separated as reviewed judgments | `AssessmentAdjustment` storage VERIFY | WP8, WP9 |
| G20 | No tests for conversions, tiers, fallbacks | No test files supplied | WP10 |
| G21 | **Fallback licence number on published reports.** If the agronomist supplies none, the report is published with `"KALRO/AGR-KE-VERIFIED"`, and the certification text says "Certified by Licensed Agronomist ... KALRO/AGR-KE" | `publish_verified_assessment`; `AssessmentPublishRequest.license_number` is optional | WP11 |
| G22 | **Unverified recommendations may be visible to farmers.** `load_farmer_recommendations` has no `review_status` filter, and feedback can be recorded on `pending_review` rows. The verified-report endpoint hides unverified assessments, so the two paths disagree | `load_farmer_recommendations`, `create_farmer_recommendation_feedback`; VERIFY whether the UI filters | WP11 |
| G23 | **DB-level defaults duplicate the engine's silent fallbacks:** county `or "Nyeri"`, crops `or "maize"`, acreage `1.0`, primary crop = text before the first comma. The assessment row stores the defaulted county, and agronomist routing matches `a.county ILIKE ap.county`, so a farm with no county lands in Nyeri's review pool | `record_officer_field_collection`, `load_unverified_assessments`, `claim_agronomic_assessment` | WP6 |
| G24 | **Method and quality are fabricated at write time:** `analytical_method` defaults to `"Field Kit / Sensor"`, `quality_status` to `"valid"`, reading quality is hardcoded `"valid"`, while the request model defaults quality to `"sample"`. The engine receives only `{analyte: value}` | `record_officer_field_collection`, `FarmerSoilMeasurementInput` | WP3, WP5 |
| G25 | **Consent is not enforced here.** The function overwrites the farm's exact latitude/longitude on every collection; `OfficerFieldCollectionRequest` has no consent field, and the only consent code in `database.py` is for dealers | `record_officer_field_collection`, `models.py` | WP4, WP11 |
| G26 | **Agronomist edits are not applied consistently.** `publish_verified_assessment` applies edits only to `diagnoses` and `prescriptions` fields (`ratePerHa`, `ratePerAcre`, `applicationTiming`, `interpretation`). `totalFarmPrescription`, `commercialInputs[].totalBagsNeeded` and `splitSchedule` text are not recomputed, so a published report can contradict itself. The `recommendations` rows (what farmers query, and what feedback attaches to) keep the original engine rates | `publish_verified_assessment` | WP11 |
| G27 | **Inputs are not stored with the assessment.** `engine_baseline` holds only the engine output, not the input values, tiers or rule version, so an assessment cannot be reproduced or audited | `record_officer_field_collection` | WP5 |
| G28 | **Ward summaries and exports ignore data origin and quality.** They count and export all readings and measurements, including `DEMO_SEED` and any legacy-provider rows. `aggregationLimits` states small cohorts (<3) are protected, but the SQL does not suppress them. Exports include farmer and farm names | `load_officer_ward_summaries`, `export_officer_report` | WP1, WP11 |
| G29 | **Admin health page reports static "healthy" status** for ISRIC SoilGrids, WoSIS and Supabase without checking them, and has no entry for iSDA | `load_admin_operational_health` | WP4, WP10 |
| G30 | **Uncertainty is never loaded.** All loaders return `"uncertainty": None`; `soil_measurements` appears to have no uncertainty or depth-layer columns (VERIFY schema) | `load_*_soil_readings`, `load_officer_farm_readings` | WP2 |
| G31 | **Feedback links only to `recommendations.id`**, not to the verified report, the specific prescription, or what was applied | Migration `007`, `recommendation_feedback` | WP9 |
| G32 | **The old import pipeline still exists** (`source_datasets`, `source_import_batches`); the bad dataset's rows may be traceable through it | `load_admin_operational_health` | WP1 |
| G33 | **Outbound network calls would run inside an open DB transaction** if iSDA were called from `record_officer_field_collection` as written (one connection context covers insert, engine call and alerts) | `record_officer_field_collection` | WP4 |

## 3. Work packages

Order: **WP11 items 1-2 (urgent) -> WP0 -> WP1 -> WP2/WP3 -> WP4 -> WP5 -> WP6/WP7 -> WP11 remainder + WP8 -> WP10 throughout -> WP9 (design early, build after launch).**

### WP0. Ground-truth discovery (no code changes)

**Status: COMPLETE** (`discovery_notes.md`). Findings that change later work: assessments use officer-entered measurements, not the former dataset; the form's location consent is persisted for coordinate storage only; migration `032` has been applied to production and the project-source readings were removed. A post-migration audit found one demo reading quarantined and no affected assessments or published reports. Open questions remain on measurement methods, the officer-flag workflow, and whether officer edits should affect published reports (see D13).

- `database.py` and migration `007` are already reviewed (findings are G21-G33). Produce `docs/discovery_notes.md` covering what is still unknown: where measured values originate for officers (form fields, any lab/kit workflow), where and how farmer coordinate consent is captured and enforced (the route layer or the TSX; it is not in `database.py`), whether the farmer UI filters `pending_review` recommendations, the exact `soil_readings` / `soil_measurements` / `source_*` schemas, which TS types mirror the assessment output, and how `reading_source` relates to `source_provider`.
- List every reader of `PROJECT_SOIL_DATASET`, `ISRIC_WOSIS`, `ISRIC_SOILGRIDS`, `DEMO` and of the old CSV or its derived benchmarks.
- **Acceptance:** each VERIFY item in this plan is resolved or restated as a concrete open question.

### WP1. Quarantine data from the invalid source (G3)

0. **Migration `032`:** reviewed and applied to production after a verified encrypted local backup and a successful restore/rehearsal against a local copy. Production pre-migration impact matched the local rehearsal: 75,500 project-source readings, 884,674 measurements, 75,500 provenance rows, and one import batch removed; one dataset registry row renamed; zero dependent assessments/recommendations/feedback and zero blocking provenance references. A post-migration read-only audit found zero remaining project-source readings or dataset keys, one demo reading quarantined by `033`, and zero affected assessments or published reports.
1. Write a read-only audit script/query listing readings, assessments, published reports, aggregates (`load_officer_ward_summaries`), and exports (`export_officer_report`) that depend on legacy data. Identify legacy rows through **both** `soil_readings.reading_source` and `source_provider`, plus `source_dataset_id` / `source_record_id` joined to `source_datasets` and `source_import_batches`. Include `DEMO_SEED` rows.
2. Add a migration: `excluded_reason` and `excluded_at` on readings (or an equivalent flag). Mark legacy-provider and `DEMO` rows as excluded.
3. Exclude excluded rows from: assessment generation, `load_officer_ward_summaries`, `export_officer_report`, `load_officer_farm_readings`, farmer-facing loaders, and any benchmarks. Add a provider/quality filter to the summary and export SQL even for non-legacy data (G28), and implement the <3 cohort suppression that `aggregationLimits` already promises.
4. Keep legacy provider literals readable but **reject them on new writes** (new request validators).
5. For already-published reports built on affected data: do not auto-edit them. Produce a list for admin/agronomist review (decision D8).
- **Acceptance:** audit output attached to the PR; tests show excluded readings never appear in summaries, exports, or new assessments.

**Implementation status: IN PROGRESS; cleanup migrations applied to production.** The read-only audit script, quarantine migration, reader/export filters, minimum-cohort suppression, and retired-provider write guards are implemented and covered by backend tests. A verified encrypted local backup was restored and migrations `031`–`037` were rehearsed successfully on the local copy before production application. Production pre-change counts matched the rehearsal. Migrations `032` and `033` are applied in production: zero project-source readings/dataset keys remain, one demo reading is quarantined, and no affected assessments or published reports remain. Application deployment of the corresponding reader/export filters is not verified; confirm the backend release before treating the application work as complete.

### WP2. Schema and contract changes (G2, G12)

**Implementation status: IN PROGRESS; migration `034` applied to production.** Measurement metadata persistence/loading, the versioned soil-reading contract, provider/analyte updates, and validator tests are in place. Migrations `031`–`037` were applied successfully to a local restored copy and then production; production history and migration checksums were verified read-only through `037`, and the expected metadata columns are present. Application deployment of the related code is not verified. Current local backend verification after the scaffolding work: 219 tests passed; Ruff passed.

1. `SoilDataProvider`: add `ISDA_SOIL`.
2. `SoilAnalyte`: add `extractable_phosphorus` and `extractable_potassium` for non-Olsen / non-exchangeable-K measurements. `olsen_phosphorus` and `exchangeable_potassium` then mean exactly those methods. Check DB constraints/enums and TS types for these literals.
3. Add `OfficerFieldCollectionRequest` validator: `top_cm <= bottom_cm` (match the farmer model).
4. Extend `SoilSource`/`SoilMeasurement` usage so iSDA readings carry: `dataset_id`, dataset version, `retrieved_at`, `license`, `attribution` (config value, see WP4), `analytical_method`, depth layer, `uncertainty` (with `interval_level`).
5. `soil_readings` already has `source_dataset_id`, `source_record_id`, `source_license`, `source_attribution`, `source_retrieved_at`. Use them for iSDA provenance. Add the missing measurement-level columns (uncertainty lower/upper/level, depth layer, raw value and unit; VERIFY existing columns first) and **update every loader** (`load_farmer_soil_readings`, `load_officer_farm_readings`, `load_demo_soil_reading`) to return `uncertainty` instead of hardcoded `None` (G30).
6. New persistence for the snapshot and request log (names indicative; follow repo conventions):
   - `soil_estimate_requests`: reading_id, request time, status (`ok`/`failed`/`pending`), http status, rounded coordinates used, layers requested, error text (no keys).
   - Estimates stored as ordinary measurements with `quality_status="estimated"`, plus the extra provenance above.
7. Contract version: bump `contract_version` handling so old clients/tests do not silently break (`Literal[1]` -> support 1 and 2 if the contract changes shape).
- **Acceptance:** migration applies and rolls back; validators covered by tests; TS types regenerated or updated.

### WP3. Normalization and units (G1, G2)

**Implementation status: IN PROGRESS.** The shared normalizer and focused
conversion/rejection tests are implemented. Plausibility bounds intentionally
remain `UNVERIFIED` with no numeric thresholds until an agronomist signs off;
accepted analytical methods and material depth mismatch remain decision D4.

Create one tested module (e.g. `app/soil/normalize.py`) used by everything else.

- Canonical units: pH in water, total N %, organic carbon %, Olsen P mg/kg, exchangeable K cmol/kg.
- Conversions: g/kg -> % is /10. K mg/kg -> cmol/kg is /391 (K only). Treat meq/100 g as equal to cmol/kg. Any other unit: reject with a clear error, never guess.
- Officer/farmer input: `source_unit` must be in an allowed list per analyte; convert to canonical or mark `invalid_source_value`.
- **Remove the fabricated defaults in `record_officer_field_collection`** (G24): no default `analytical_method` (`"Field Kit / Sensor"`), no default `quality_status` of `"valid"` (the request model's `"sample"` default and the DB default disagree), no empty-string `source_unit`, and compute reading quality from the measurements instead of hardcoding `"valid"`. Missing method means unknown method, which the engine treats as not method-matched (WP5).
- Plausibility bounds per analyte as config with `UNVERIFIED` status (agronomist to confirm); out-of-range values get quality `invalid_source_value`, not silent acceptance.
- Depth rule: officer samples 0-20 cm by default. If the sample depth is materially different from the iSDA layer, mark the iSDA estimate `unsupported_depth_or_method` rather than using it (threshold of "materially" is decision D4).
- **Acceptance:** table-driven unit tests for every conversion and rejection path.

### WP4. iSDA integration (API + snapshot) (G14)

**Implementation status: IN PROGRESS — gated, non-network persistence scaffolding; migration `037` applied to production.** The existing v2 client remains disabled by default. Database helpers create a pending request only when an explicit matching consent record includes the third-party soil-service scope, store success as a separate provenance-linked `ISDA_SOIL` reading with `quality_status="estimated"`, and record failures using bounded error codes. Production migration history and schema were verified read-only through `037`. Focused persistence tests use mocked DB cursors and the existing contract fixture only; no live iSDA API call was made. No route/job calls the client or persistence helpers. D1, D2, D7, and D15 remain gates; no iSDA request is authorized for real farmer data.

0. **Contract (verified from the iSDAsoil v2 OpenAPI spec; see section 4a).** Use **v2 only**. The v1 endpoints are marked deprecated and use API keys, so do not build on them. Save the spec JSON (`https://api.isda-africa.com/isdasoil/v2/openapi.json`) in the repo, then record real `/layers` and `/soilproperty` responses for 3-4 Kenyan test points (different zones, one near a water body or edge) as test fixtures. Still unresolved and not in the spec: **rate limits, whether results may be stored, the exact attribution wording, and the extraction method behind `phosphorous_extractable` / `potassium_extractable`** (check the `description` fields in the `/layers` response, then iSDA's terms or contact `info@isda-africa.com`). Registration is required (account with email and password) before any call; create a dedicated service account (D1).
   - Fallback if the API is unsuitable: iSDA layers are also published on AWS S3, and Digital Earth Africa serves some of them (bedrock depth, bulk density, total carbon, clay, sand, silt per its docs). Confirm which of the five needed variables are covered before relying on that route.
1. **Client** (`app/services/isda_client.py`): httpx, timeouts, bounded retries with backoff, client-side rate limiting. **Auth:** `POST https://api.isda-africa.com/isdasoil/v2/login` with form-encoded `username` and `password` returns a JWT that **expires after 1 hour**. Cache the token in memory with its issue time, refresh shortly before expiry and on a 401, and make login single-flight so concurrent requests don't each log in. Send `Authorization: Bearer <token>` on `/soilproperty`. The spec lists no security on `/layers`, so fetch it unauthenticated, cache it, and refresh periodically. (The spec's path is `/login`; the docs' curl uses `/isdasoil/v2/login`. Use the docs' URL and confirm against a live call.)
2. **Parser:** `GET /isdasoil/v2/soilproperty?lat=&lon=&depth=&property=` (note the parameter names are `lat` and `lon`; both are required and exclusive of +/-90 and +/-180). The response is `{property: {<name>: [SoilData]}}`, where each `SoilData` has `value {unit, type, value}`, `depth {value, unit}` and `uncertainty` (a list, a single object, or null) made of `confidence_interval` (a string percentage), `lower_bound` and `upper_bound`. Therefore: use the **unit returned by the API** (do not assume units), use the **returned bounds** as the stored interval and keep `confidence_interval` as `interval_level` (parse the string defensively), and treat `value` as possibly non-numeric (`string`/`null`) and reject anything that does not parse. Request `depth=0-20` for officer samples taken at 0-20 cm. Handle null uncertainty (means the product wasn't ML-predicted) by storing no interval and treating the value as lower confidence. Convert to canonical units via WP3. Map names per section 4a.
3. **When called:** server-side after collection is saved. The mobile client never calls iSDA. Offline drafts (`SyncDraft`) submit normally; the backend fetches on arrival. **Do not call iSDA inside the `record_officer_field_collection` transaction** (G33): commit the reading first, then fetch, then write the estimate rows and generate the assessment in a second step (or a queued job), so a slow or failing API cannot hold a transaction open or lose the officer's data.
4. **Failure handling:** if the API fails, record `pending`/`failed` in the request log, generate the assessment without estimates, and retry in a background job; when a retry succeeds, regenerate the **unverified** assessment only if it has not been claimed by an agronomist (never change one under review).
5. **Caching:** key on cell-level rounded location + layer + depth + dataset version. Cache entries must still be copied into each reading's own snapshot.
6. **Optional (behind a flag, decision D6):** when `location_uncertainty_m` exceeds one pixel, sample a small pattern of points within the radius and combine mean and spread into the stored interval.
7. **Privacy and consent:** outbound coordinate precision configurable (default to be decided, D7). Migration `035` and the field-collection path now persist and enforce the farmer's consent to store exact coordinates, including the officer, farmer, visit, wording version, scope, notes, and timestamp. That scope does **not** authorize sharing coordinates with a third party. D2 remains open: approve specific third-party consent wording and storage; until then, no iSDA request may be made. Outbound coordinate precision also remains subject to D7.
8. **Attribution (CC BY 4.0 requirements, see section 4a):** every place that shows or exports an iSDA-derived value must carry (a) the creator's name, Innovative Solutions for Decision Agriculture Ltd (iSDA), (b) a link to the material (iSDAsoil site), (c) a license notice with a link to CC BY 4.0, (d) a notice that the material comes without warranty and is based on automated mapping that can contain errors and artifacts, (e) a statement that values were **modified** (e.g. unit conversion, rounding, selection of a depth layer), and (f) nothing that suggests iSDA endorses SoilSync or its advice. Keep the text in one config value `ISDA_ATTRIBUTION_TEXT` (required; startup fails if empty). Draft wording for human approval is in section 4a. Add a copyright notice only if iSDA publishes one; do not invent it.
9. **Monitoring:** counters for calls, failures, cache hits, latency; alert when approaching documented limits. Replace the hardcoded "healthy" provider list in `load_admin_operational_health` with real checks, add iSDA, and drop providers that are no longer used (G29).
10. **Terms hygiene:** save a dated copy of the iSDAsoil Terms of Use and the CC BY 4.0 deed under `docs/third_party/`, and record the date reviewed. The terms say they may be amended and that users should check them on each use, so add a recurring manual review (e.g. quarterly) to the ops checklist. The terms also say availability is not guaranteed and access may be withdrawn or restricted, so the snapshot-plus-graceful-degradation design is a requirement, not a nice-to-have.
- **Acceptance:** tests use recorded fixtures only (no live calls in CI); a failed call never blocks collection; no coordinates or keys in logs; snapshot is reproducible from the DB alone.

### WP5. Engine refactor with data tiers (G1)

1. Replace the `dict[str, float | None]` input with a typed structure per analyte: canonical value, tier, provider, method, unit, interval, reading/depth reference. Build it from the reading in one function (replacing `_measurement_map`).
2. Tier rules:
   - **MEASURED:** quality `valid`, provider is a measured source (officer/farmer collection), analyte method matches the analyte definition (and the accepted-method list, D4).
   - **ESTIMATED:** provider `ISDA_SOIL`, quality `estimated`.
   - **UNUSABLE:** missing, `invalid_source_value`, `unsupported_depth_or_method`, excluded, or out of plausible range. Listed in output, never silently dropped.
3. Behaviour by tier:

   | Rule | MEASURED | ESTIMATED | UNUSABLE |
   |---|---|---|---|
   | Diagnosis vs target | full | "indicative", shows interval; "borderline" if the interval straddles the threshold | skipped, listed |
   | Lime, DAP, CAN, MOP, manure quantities and bag counts | allowed | **suppressed**; show direction and a "confirm with lab test" action | none |
   | P and K | Olsen / exchangeable-K thresholds only with matching method | never compared with Olsen / exchangeable-K thresholds | none |

4. **Persist the inputs** (G27): store the typed input list, tiers, register version and iSDA snapshot references inside `engine_baseline` (or a sibling column) so every assessment is reproducible. Output additions: `dataQuality` summary (counts per tier), per-diagnosis `tier`, `inputs` with provenance (provider, method, depth, retrieved/collected date, interval), `reportBasis` (`measured` / `mixed` / `estimated_only`), `rulesRegisterVersion`.
5. Keep output keys the TS code already uses; additions only. Update TS types.
- **Acceptance:** golden-case tests for each tier and mixed readings; a test proving no application quantity is ever emitted from ESTIMATED input.

### WP6. Rule fixes that do not need new agronomic numbers (G4-G9, G11, G15)

1. **Crop:** add `resolve_crop()` that normalizes free text (case, plurals, known synonyms for existing profiles only). Unknown or ambiguous crop -> engine returns `status: "unsupported_crop"`, no crop-specific targets or prescriptions, and a message. Never fall back to maize. `database.py` currently takes the text before the first comma as the primary crop; replace that with an explicit primary-crop choice by the officer for the visit, stored on the assessment.
2. **County and DB defaults (G23):** remove the `"Nyeri"` default **in both `generate_agronomic_assessment` and `record_officer_field_collection`** (`farm_county = ... or "Nyeri"`). Also remove the silent `"maize"` crop default and the `1.0` acreage default there. If county, crop or acreage is missing, refuse to generate prescriptions, say which field is missing, and do not store a made-up county on `agronomic_assessments` (it drives agronomist pool routing); route such assessments to an admin/unassigned queue instead (VERIFY intended behavior). Normalize county names (case, apostrophes, spacing). Missing or unknown county -> `DEFAULT_AEZ` marked `"zone_source": "default_not_calibrated"`; reword the advisory note so it never claims local calibration when the default is used. Do not add new counties or factors (agronomist data needed).
3. **Nitrogen:** make the status and text consistent. Do not say "requires top-dressing" when status is "optimal". Pending agronomist decision D3, label the CAN prescription as `baseline_crop_n` instead of tying it to the soil N value. Surface starter N and DAP's N contribution as a note, not a recalculation.
4. **Potassium:** add an explicit `nutrient_basis` (K or K2O) field to the profile with `UNVERIFIED` status; convert to product kg with named constants; add total-farm and bag counts like other prescriptions. No change to the numeric rate until D3.
5. **Lime:** keep the current formula, but label it `heuristic_pending_method` in output; introduce a `LimeRequirementMethod` interface so an agronomist-approved method can replace it. Quantities only from MEASURED pH. Do **not** implement an Al-saturation/eCEC method until one is approved.
6. **Text claims:** remove or source the "up to 60% locked" and "Aluminum/Iron toxicity... active" statements; phrase as general risk ("acidity can reduce phosphorus availability") unless a citation is added to the register.
7. **Rename `aiAdvisoryNotes`** to `advisoryNotes` (keep an alias for the TS client for one release). Escape/sanitize echoed `field_notes` and label them "Officer notes".
- **Acceptance:** each item has a regression test; unsupported crop and missing county have explicit tests.

### WP7. Rules register and provenance (G10, G13)

1. Move profiles and county/AEZ data into a data file (YAML/JSON) loaded by the engine. Each value carries: `value`, `unit`, `method`, `source` (citation or `NONE`), `status` (`UNVERIFIED`/`VERIFIED`), `reviewed_by`, `reviewed_at`.
2. Engine output includes `rulesRegisterVersion` and flags if any rule used has `status != VERIFIED`. The agronomist UI shows this.
3. Remove "KALRO" naming from `engineVersion`, docstrings and the disclaimer wherever the register shows `source: NONE`. Use a neutral name and a single version scheme (e.g. `rules-vX.Y`, bumped on every register change).
4. Add a CI check that fails if a rule has `status: VERIFIED` with no `source`.
5. Hand-off list for the agronomist: Olsen P targets (G13), SOC targets and which SOC method they assume, K basis, N policy, lime method, county/AEZ factors.
- **Acceptance:** behaviour unchanged by the move (snapshot tests on current outputs); all values initially `UNVERIFIED` except those with a real citation supplied by a human.

### WP8. Officer and agronomist workflow, farmer report (G16, G17, G19)

VERIFY the current TSX before designing; reuse existing components.

- **Officer view:** show the data tier and provenance on the unverified assessment. Add a structured flag per analyte or diagnosis (reason code + note). Store as `assessment_flags` (assessment, officer, target, reason, note, status, timestamps). A flag on an estimated value creates a "lab sample needed" task for the visit.
- **Agronomist view:** show tier, interval and register status beside every diagnosis; show open officer flags. Publishing an `estimated_only` assessment is allowed only as an *indicative* report; any override of a gating rule requires a recorded reason.
- **Edits:** officer and agronomist edits are already stored separately (`officer_edits`, `agronomist_edits` JSONB arrays, append-only). Keep that separation, label them `reviewed_judgment` in any export or analytics view, and add a guard and test that nothing treats them as outcomes. Consider moving them to a queryable table later; not required now.
- **Farmer report:** state when values are modelled estimates, show the full `ISDA_ATTRIBUTION_TEXT` (including the changes-made, no-warranty and non-endorsement parts), and never describe estimates as lab results or as iSDA's advice.
- **Acceptance:** UI shows the new fields; publish flow enforces the rules above; tests cover the gating and flag creation.

### WP9. Outcome capture (G18) — design now, build after launch

This does **not** train a model. It starts collecting what a future model would need.

1. Produce an ERD and migration proposal first (review before building). Entities, linked to `reading_id` and `assessment_id`:
   - plot/season (crop, variety, planting date, season, treatment vs comparison flag)
   - application (product, quantity, unit, date) — what was actually applied
   - follow-up measurement (same method/depth/date fields as readings)
   - harvest outcome (yield, area, date)
2. Migration `007` created an append-only `recommendation_feedback` (user, `recommendation_id`, response, timestamp) with RLS. Do not alter it. Add new tables linked to the **assessment and the specific published prescription** (not only `recommendations.id`), and link feedback events to an application record. First fix G26 so the `recommendations` rows match the published report; otherwise feedback attaches to numbers the farmer was never told. Preserve the "server writes must verify ownership" rule from `007` in every new write path.
3. Add explicit farmer consent covering storage **and** use in model training/evaluation, stored with timestamp and wording version.
4. Define go/no-go criteria for any model (decision D9): minimum linked records, more than one season, and a baseline to beat. The rules engine is the baseline.
- **Acceptance:** ERD approved by a human; no model code merged.

### WP10. Tests, validation, monitoring (G20)

- Unit tests: conversions, tiers, gating, crop/county handling, register checks.
- Regression/snapshot tests for current engine outputs (they protect against accidental change; they are **not** agronomic truth). Expected outputs for new golden cases are approved by an agronomist before being treated as correct.
- Local validation study (human-run): for a sample of farms across the main zones, collect a lab sample beside the iSDA estimate. Store pairs. Report bias and spread per variable and depth. Use the result to set borderline margins and decide which variables may support stronger statements.
- Optional benchmark (only if D14 allows): for the validation farms, run iSDA's Virtual Agronomist nutrient plan on the same field and crop and compare with this engine's output. Differences are review prompts for the agronomist, not evidence about which is right, and nothing from it is shown to farmers or stored in reports without terms that permit it.
- Dashboards: share of assessments by tier, iSDA call failure rate, agronomist edit rate per rule (rule-quality signal, not outcome), officer flag rate.

### WP11. Publication integrity and farmer exposure (G21, G22, G25, G26, G28)

Do this before or alongside WP1. These are live-system risks that do not depend on iSDA.

1. **Licence number (G21):** remove the `"KALRO/AGR-KE-VERIFIED"` fallback and the hardcoded "KALRO/AGR-KE" in the certification text. Publishing requires a licence number: either from the request, or (preferred) from the agronomist's approved profile (`agronomist_profiles`; the invite flow already captures `licence_number`; VERIFY column). Reject publish if none exists. Certification text uses the real licence only. Add a test that publishing without one fails.
2. **Farmer visibility (G22):** restrict `load_farmer_recommendations` to `review_status = 'approved'` (or whatever the V5 reference specifies; VERIFY), and make `create_farmer_recommendation_feedback` reject non-approved recommendations. Check the farmer UI for the same assumption.
3. **Edit consistency (G26):** when applying agronomist adjustments, recompute dependent fields (`ratePerAcre`/`ratePerHa` pair, `totalFarmPrescription`, matching `commercialInputs[].totalBagsNeeded`, and `splitSchedule` text) or, if recomputation is out of scope, show a clear "edited by agronomist; totals not recalculated" flag and block publish until the agronomist confirms. Also update the `recommendations` rows from the published prescriptions so the farmer-facing list matches the report. Test: edit a rate, publish, and assert every place that shows a quantity agrees.
   **Implementation status:** implemented locally. Rate edits now recalculate the paired rate, farm total, matching bag count and schedule action; publication synchronizes farmer-facing recommendations and generates the alert summary from the prescriptions included. The focused publish regression test covers these outputs. This is not a database deployment.
4. **Publish message:** the alert text promises "lime, basal fertilizer, and topdressing schedules have been certified" regardless of content. Generate it from the prescriptions actually published.
5. **Consent (G25):** implement the stored consent record from WP4.7 and enforce it in `record_officer_field_collection` before the coordinate `UPDATE farms`. Also stop overwriting an existing farm's coordinates silently; keep history or require confirmation (VERIFY intended behavior).
   **Implementation status:** storage consent remains required; replaced coordinate pairs are recorded with the visit and officer in `farm_location_history` in the same transaction. Migrations `035` and `036` are applied to production. This consent covers coordinate storage only, not third-party transmission.
6. **Exports and summaries (G28):** after WP1's filters, review whether `export_officer_report` should include `farmerName` at all (the disclaimer lists excluded fields but not names; this is a privacy decision, D10). Any export that contains iSDA-derived values must carry the same attribution text (CC BY applies to redistribution), for example as a header field in the JSON/CSV.
   **Decision and implementation status:** D10 resolved with the user: omit farmer names and suppress exports below three distinct farmers with valid field measurements. Both controls are implemented locally in the database export path and response type; they are not a database deployment.
- **Acceptance:** tests for each item; no published report can exist without a real licence number; farmers cannot see or give feedback on unapproved recommendations.

## 4a. Verified iSDAsoil v2 contract (from the OpenAPI spec)

| iSDAsoil `property` | SoilSync analyte | Notes |
|---|---|---|
| `ph` | `soil_ph` | Check the `/layers` description for the pH medium before comparing with target ranges |
| `nitrogen_total` | `total_nitrogen` | Convert from the returned unit to % |
| `carbon_organic` | `organic_carbon` | Convert from the returned unit to %; check the method note in `/layers` |
| `phosphorous_extractable` (sic) | `extractable_phosphorus` | Not Olsen unless `/layers` or iSDA says so. Do not map to `olsen_phosphorus` |
| `potassium_extractable` | `extractable_potassium` | Not exchangeable K unless iSDA says so |

Other available properties, **context only for now** (they could later inform a lime method, WP6.5, once an agronomist approves one): `aluminium_extractable`, `cation_exchange_capacity`, `clay_content`, `sand_content`, `silt_content`, `texture_class`, `bulk_density`, `bedrock_depth`, `stone_content`, `calcium_extractable`, `magnesium_extractable`.

Allowed `depth` values: `0-20`, `20-50`, `0-50`, `0-200`, `0`. The API license is CC BY 4.0 (attribution required); terms of use are separate and still to be read (D1).

### iSDAsoil terms and license (reviewed)

What the documents say (my reading, not legal advice):

- **License:** the API spec states CC BY 4.0. That license allows copying, redistribution and adapting the data for any purpose, including commercial, provided you give appropriate credit, link to the license, **indicate that changes were made**, and do not suggest the licensor endorses you. You may not add legal terms or technical measures that restrict what the license permits. Nothing in the pasted terms restricts storing the returned values.
- **No reliance:** the Terms of Use say the content is not advice to rely on, that the maps come from automated techniques and "errors and artifacts" can occur, and that no warranty is given. This matches the tier design: estimates never drive quantities and always go through the agronomist.
- **Availability:** free of charge, no guarantee of availability, and iSDA may suspend, withdraw or restrict access.
- **Liability:** for a **business user** iSDA excludes liability for loss, including loss of profits and reliance on content. Those risks sit with SoilSync. For a **consumer user** the terms allow only domestic and private use and bar commercial or business use, so register the iSDA account as an organization, not an individual (D15).
- **Incorporated documents:** the terms also bind you to iSDA's general Terms of Use and Privacy and Cookie Policy, which I have not seen.
- **Not covered by anything I have read:** API rate limits or fair-use rules, any API-specific conditions at registration, any published copyright notice or preferred citation, and the Virtual Agronomist API's terms.

Draft attribution text for approval (adjust after the open items above are settled):

> Soil estimates in this report come from iSDAsoil, made available by Innovative Solutions for Decision Agriculture Ltd (iSDA) under CC BY 4.0 (https://creativecommons.org/licenses/by/4.0/). Source: https://www.isda-africa.com/isdasoil. SoilSync modified the values (unit conversion and depth-layer selection). iSDAsoil is based on automated mapping, may contain errors, and is provided without warranty. iSDA does not endorse SoilSync or this assessment.

### iSDA Virtual Agronomist API (separate product, evaluate only)

iSDA also publishes a Virtual Agronomist API (`/virtual-agronomist/v1`, same login pattern, 1-hour JWT) with per-crop nutrient-plan endpoints for about 27 crops (maize, Irish potato, tea, coffee, common bean, cabbage, tomato, sorghum, wheat, cassava and others). It returns fertiliser, lime and manure plans. I could not read its input and output schemas. Treat it as a **possible benchmark**, not a data source or replacement for the rules engine: it is a third-party black box, its terms for storing, displaying and building on its advice are unknown, and the agronomist review and your own cited rules register still apply. See D14 and WP10.

## 4. Data contract for an iSDA estimate (reference)

Stored per analyte per reading: canonical value, raw value and raw unit, canonical unit, interval (lower, upper, `interval_level`), layer name, depth layer (and top/bottom cm), dataset id and version, `retrieved_at`, coordinates used (rounded), license, attribution, analytical method as reported by iSDA, `quality_status = "estimated"`, provider `ISDA_SOIL`. Also store a `transformations` list per measurement (for example `unit_conversion:g/kg->%`, `depth_layer:0-20`, `rounded:2dp`) so the "changes were made" statement required by CC BY can be generated from data rather than hardcoded.

Mapping: pH, total N, organic carbon use the existing analytes with provider `ISDA_SOIL`. Extractable P and K use `extractable_phosphorus` / `extractable_potassium`.

## 5. Suggested PR sequence

0. **Urgent hotfix PR:** WP11.1 (licence fallback) and WP11.2 (farmer visibility of unapproved recommendations), plus removing the `"Nyeri"` county default in `record_officer_field_collection` (WP6.2). Small, independent of iSDA.
0b. **Consent PR (before any iSDA call ships):** storage consent and location history are implemented, and migrations `035`–`037` are applied to production. The officer form sends affirmative storage consent and notes; the API validates them; the backend records a scoped audit row before updating coordinates (`035`) and preserves replaced coordinate pairs (`036`). This authorizes storage only. Separate third-party consent wording remains blocked on D2; migration `037` supplies non-network persistence scaffolding only. No iSDA request is authorized for real farmer data.
1. WP0 notes + WP1 audit/quarantine and the new-write rejection of legacy providers
2. WP2 + WP3 (schema, normalization)
3. WP4 (iSDA client, snapshot, consent, attribution)
4. WP5 (tiers)
5. WP6 (rule fixes, remaining items)
6. WP7 (register)
7. WP11 remainder + WP8 (workflow, report)
8. WP10 alongside each PR; validation study runs in parallel
9. WP9 design review, then build

## 6. Definition of done (overall)

- No application quantity can be produced from a modelled, unusable, or method-mismatched value.
- No silent fallbacks for crop or county.
- Every rule value has provenance and a verification status visible to the agronomist.
- Every iSDA-derived number in a report is traceable to a stored snapshot and carries attribution.
- Legacy-source data cannot enter assessments, summaries, or exports.
- Review edits are stored as judgments; outcome capture is designed and consented before any model work.
- No report can be published without a real licence number; farmers only see approved advice; published quantities agree everywhere they appear.
- Exact coordinates are stored and sent to third parties only with recorded consent.

## 7. Open decisions (need a human; Copilot must not decide)

| ID | Decision | Owner |
|---|---|---|
| D1 | **Partly resolved.** Terms of Use and CC BY 4.0 reviewed (section 4a): storing and adapting the data looks permitted with attribution and change-marking. Still open: iSDA service account (v2 uses email/password login, 1-hour JWT), rate limits or fair-use rules, the general Terms of Use and Privacy Policy, any preferred citation or copyright notice, and the P/K extraction methods. Ask iSDA (info@isda-africa.com) to confirm in writing that storing results per reading and showing them in a commercial extension product is acceptable at the expected volume. Have counsel confirm commercial use | Product/legal |
| D2 | Consent wording and storage for sending coordinates to iSDA | Product/legal |
| D3 | Agronomist sign-off: Olsen P targets, SOC targets and method, N policy (baseline vs soil-based), K basis and rates, lime method, AEZ factors | Agronomist |
| D4 | Accepted lab-method list per analyte; what counts as a "material" depth mismatch | Agronomist |
| D5 | How officers obtain measured values today (lab, kit, none) | Operations |
| D6 | Whether to enable radius sampling | Engineering/agronomist |
| D7 | Outbound coordinate precision | Engineering/privacy |
| D8 | Handling of already-published reports built on invalid data | Admin/agronomists |
| D9 | Go/no-go criteria for any future model | Product/data lead |
| D10 | Whether officer exports may include farmer names; whether to enforce the <3 cohort rule as described | Product/privacy |
| D11 | Source of the licence number at publish (profile vs. request) and what happens to reports already published with the fallback licence | Admin/legal |
| D12 | Where unassigned assessments go when county is missing (admin queue vs. blocked at collection) | Operations |
| D13 | Should officer edits change published report content? My recommendation: no. Officer input stays as context and flags; only the claiming agronomist's edits alter published numbers (today `publish_verified_assessment` applies only `agronomist_edits` and includes `officer_edits` as raw context). Confirm against V5 and make the UI say so | Product/agronomist |
| D14 | Whether to evaluate iSDA's Virtual Agronomist API as a benchmark: obtain its terms (storage, display, derived use, attribution) and its schemas; no production use until decided | Product/legal/agronomist |
| D15 | Register the iSDA account under the organization (business user), not an individual, because the consumer terms bar commercial use; decide who owns the account and the credentials | Product/legal |