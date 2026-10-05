# SoilSync product reference

**Specification:** User roles and workflows, reference brief v5  
**Document status:** Product baseline for continued development; not a production-readiness sign-off  
**Last updated:** 2026-10-03  
**Authority:** The user-provided v5 brief is the target behavior. The implementation notes below describe known repository and Supabase state and do not override that target.

This document consolidates the product requirements, what is already known about the SoilSync application, the important differences between the current implementation and the target, and a practical order for completing development. Update it when product decisions or verified implementation evidence change.

## 1. Product goal

SoilSync helps farmers request field visits, receive agronomist-reviewed soil reports, and find relevant in-stock agricultural products. Extension officers collect field data, agronomists review assessments, agrodealers fulfill order requests, and admins operate the system.

The application must keep field-collected facts, machine-generated assessment, human edits, and published report distinguishable. A recommendation is not a verified report until an approved agronomist completes review and publishes it.

## 2. Roles and account creation

### Farmer

- A farmer may self-register, or an extension officer may register the farmer while the farmer is present.
- Email is required in this version.
- Self-registration creates a farmer account. Officer registration creates an **unclaimed** farmer account and sends a secure account-claim message by email.
- An unclaimed farmer follows the same first-access pattern as invited staff: use a one-time secure link, set a password, and claim the account. Do not email a reusable or plaintext password.
- A farmer manages their profile and language preference, adds farms, requests visits, views verified reports and history, receives product suggestions, and places order requests.

### Unclaimed farmer accounts

- **Day 0:** the officer creates the account and any allowed initial farm information.
- **Days 1–6:** send exactly one reminder every 24 hours, by in-app notification and email: six reminders total.
- **Day 7:** delete the unclaimed account and all farm information entered as part of its creation.
- No visit request can be submitted and no farmer edits are allowed until the account is claimed. Consequently, no other farmer activity should exist to retain when this deletion runs.
- A claim stops reminders and prevents scheduled deletion. Account creation, reminders, claim, and deletion must be auditable.
- The one-week deletion is the first retention rule. Broader production retention policy remains deferred.

### Extension officer

- Only an admin creates the account. The officer receives a one-time secure email invitation, sets a password at first access, and completes setup.
- Setup confirms the officer profile and the county and sub-county served.
- An officer may register a farmer and farm while the farmer is present, coordinate a visit, capture exact farm coordinates, collect soil properties, complete collection, request agronomist review, discuss/edit an assessment with the agronomist, and flag suspicious results.
- Officers can work only on field visits they have claimed. Officers may release a claimed visit to its county pool.
- Officers can see an unverified assessment only for a visit they claimed, including while the assessment is in the review workflow.

### Agronomist

- Only an admin creates the account. The agronomist receives a one-time secure email invitation and sets a password on first access.
- The admin pre-fills the agronomist's details. The agronomist confirms or corrects those details during setup.
- Agronomists must be licensed or approved under the policy defined by the service. The system must represent approval status and prevent unapproved accounts from claiming or approving assessments.
- An agronomist may claim multiple assessments, but a given assessment has exactly one agronomist owner at a time. The first successful claim wins atomically.
- A claimant can release an assessment to the same county pool. Officer edits survive release and subsequent claims.
- Agronomists review assessments with the claiming officer, edit or approve them, publish verified reports, review recommendation rules before activation, and handle flagged cases.

### Agrodealer

- Only an admin creates the account. The dealer receives a one-time secure email invitation and sets a password on first access.
- The dealer sets up a business profile: business name, location, counties served, contacts, and mode of operation (pickup, delivery, or both).
- The dealer manages products and stock. Products appear without admin approval in this version.
- The dealer receives order requests, confirms them, and updates fulfillment status. Dealers see only their own orders and only the information needed to fulfill them; they do not see farm soil data.

### Admin

- Admins create and manage accounts and roles, and resend or reset one-time credentials.
- Admins manage counties, sub-counties, crops, product categories, and other reference data.
- Admins manage source datasets, licensing/attribution, imports, system metrics, audit logs, error reports, backups, exports, and deletion requests.
- **Available** currently means any active account in the system. It is not a workload, online-presence, or capacity indicator.

### Credentials and invitation policy

The secure target is a one-time invitation/claim link that lets the recipient set their own password. Never send a permanent password in email. This is compatible with the current Supabase invitation/password-setup implementation. The app must support resending or resetting a credential for an existing pending account, invalidate superseded links as appropriate, and report delivery failures instead of claiming success.

Email is required for this version. Farmer phone-only enrollment, OTP, MFA, and a separate verification feature for officer-registered farmers are explicitly deferred to a later version. This does not imply that unverified email addresses may be used to link an account to an existing identity.

## 3. Farmer workflow

1. Register or sign in, complete the profile, and choose a language preference.
2. Add one or more farms with name, county, sub-county, size, and crops.
3. Do not enter soil measurements or exact coordinates as a farmer.
4. A farm without a visit request is **incomplete**. Explain that a field visit is needed and send an in-app and email reminder every 24 hours. Stop farm-incomplete reminders as soon as the farmer requests a visit.
5. When requesting a visit, choose only a county with at least one active extension officer. Notify every eligible officer in the selected county.
6. If there are no counties with officers, show an explicit empty state explaining that no officer is available in the relevant county; do not show an unusable empty selector.
7. See accurate farm coordinates only after an officer captures them.
8. Never see the unverified assessment. When an officer completes data collection, show the farmer that information is being reviewed and will be available after review. This message is triggered by **data-collection completion**, not by the later review-request action.
9. Receive and view the immutable verified report once an agronomist publishes it. View reports and history by farm and season, plus a dashboard of farms and soil indicators.
10. Receive eligible product suggestions generated from the verified report and place order requests.

## 4. Extension-officer workflow

### Visit request pool

- A farmer's request is broadcast to all eligible officers in the selected county.
- The first officer to claim it owns the visit. Claiming is atomic; it disappears from every other officer's queue.
- The owner may release it. It returns to the same county pool and becomes claimable by another eligible officer.
- While unclaimed, send one in-app and email reminder every 24 hours to officers in the request county or sub-county. Reminders stop only on claim and restart after release.
- The officer schedules the visit and updates its status.

### Data collection

- Open the farm from the claimed request.
- Capture exact coordinates and soil properties; only an authorized officer may submit or change these during collection.
- Mark collection complete. This creates/starts the unverified assessment and sends the farmer the "being reviewed" notification.
- The officer can view the resulting unverified assessment for their own claimed visit.

### Agronomist review

- Request agronomist review after data collection.
- If agronomists serve the farm's county, notify every eligible agronomist in that county.
- If none serves that county, select a county from only the counties that have agronomists and notify every eligible agronomist in the selected county. Do not directly assign one agronomist.
- If there are no counties with agronomists, show a clear empty-state message.
- Meet with the claiming agronomist, discuss the assessment, and edit it before it is finalized. Preserve the officer's edits if the agronomist releases the assessment.

### Other tasks

- Register farmers and farms on their behalf with the farmer present.
- Flag results that look wrong.
- View a dashboard of field visits, assessments, and follow-ups.

## 5. Agronomist workflow

- Receive review-required notifications for the agronomist's county, or the county selected by the officer when there is no local agronomist.
- Claim assessments from a shared queue. Enforce one active agronomist per assessment with a database-safe atomic operation.
- Once claimed, prevent all other agronomists from reading the assessment or the associated soil-property details. The assigned officer and claiming agronomist are the only people who can see an unverified assessment.
- Release a claim back to the same county pool. Notify eligible agronomists again; keep officer edits.
- Hold multiple distinct assessments concurrently.
- Meet with the officer; inspect the unverified assessment and its source data; edit or approve; then publish the verified report.
- Review and approve recommendation rules before they go live. Handle flagged assessments through an audited workflow.

## 6. Agrodealer workflow

- Maintain business profile, service counties, contacts, and pickup/delivery mode.
- Create and update products with name, nutrient or purpose, price, unit, and stock.
- Products are visible without admin approval in this version. Availability and stock freshness must still be represented honestly.
- Receive order requests, confirm them, and update order status.
- See only the order information needed to fulfill the request. Do not expose farm coordinates, soil properties, unverified assessments, or farmer data unrelated to fulfillment.

## 7. Admin workflow

- Create farmer claims, officer, agronomist, and agrodealer accounts as specified above; assign server-controlled roles and prefilled data.
- Resend or reset one-time credentials for an existing account, with secure expiry and audit events.
- Manage service reference data: counties, sub-counties, crops, product categories, and related controlled lists.
- Manage dataset/provider enablement, license and attribution text, import status, and provenance policy.
- Operate imports and reject records with missing or disallowed licenses.
- Monitor system metrics, audit logs, errors, failed notifications, scheduled jobs, and integration health.
- Manage backups, exports, and approved deletion requests. Apply access controls and audit sensitive operations.

## 8. Farm, assessment, and report state

The farm/visit/review workflow progresses through these states:

1. **Registered**
2. **Incomplete** — no visit requested
3. **Visit requested**
4. **Visit claimed** — returns to Visit requested if released
5. **Data collection completed** — generates the unverified assessment and sends the farmer the "being reviewed" message
6. **Review requested**
7. **Claimed by an agronomist** — returns to Review requested if released
8. **Under review**
9. **Verified report published**
10. **Product suggestions available**

The queue/assignment workflow status is not a third report state. Reports have exactly two states:

- **Unverified:** original recommendation-engine output plus clearly separated officer/agronomist edits. It is explicitly not a final report, requires review by a licensed or approved agronomist, and is visible only to the officer and current claiming agronomist.
- **Verified:** the agronomist-reviewed report, published to the farmer once. It is immutable after publication; corrections, if later required by policy, must not silently revise the published report.

Retain the engine's original output independently from subsequent edits. Keep an audit trail of generated output, rule/version and input provenance, every edit, claim/release, approval, and publication.

### Recommendation engine and agronomic intelligence specifications

To progress from the prototype threshold comparisons to a verified agronomic decision-support platform, the recommendation engine must fulfill the following technical and agronomic requirements:

1. **Crop-Specific Agronomic Rules and Nutrient Response Matrices**:
   - The engine must maintain validated agronomic threshold tables for priority Kenyan crop categories (e.g., maize, potatoes, tea, coffee, beans/legumes, brassicas/vegetables).
   - Interpret key soil indicators against crop-specific demand curves:
     - **Soil pH**: Target ranges (e.g., 5.8–6.5 for maize; 5.0–5.8 for Irish potatoes; 4.5–5.5 for tea); triggers for agricultural lime ($CaCO_3$) or dolomitic lime.
     - **Total Nitrogen (N)**: Vegetative demand, basal vs. top-dressing split requirements (e.g., at planting and knee-high 4–6 weeks post-emergence).
     - **Available Phosphorus (P, Olsen/Bray)**: Root establishment requirements, basal placement rates.
     - **Exchangeable Potassium (K)**: Grain filling and disease resistance requirements.
     - **Total Organic Carbon (SOC)**: Soil structure and biological activity thresholds, triggering farmyard manure, compost, or residue retention recommendations.
     - **Cation Exchange Capacity (CEC) & Electrical Conductivity (EC)**: Buffering capacity and salinity/sodicity indicators where measured.

2. **Agro-Ecological Zone (AEZ) & Soil-Type Calibration**:
   - Soil behavior in Kenya varies dramatically across agro-ecological zones (e.g., highly weathered, acidic volcanic nitisols and andosols of the Central Highlands and Rift Valley vs. sandy ferralsols in coastal zones vs. heavy black cotton vertisols in lowlands).
   - The engine must calibrate recommendations using the farm's county, sub-county, and ward ecological context, incorporating established guidelines (such as Kenya Agricultural and Livestock Research Organization — KALRO soil fertility maps and fertilizer use recommendations).
   - Liming calculations must estimate lime requirement ($t/ha$) to raise pH to the target range based on soil texture class and organic matter buffer capacity.

3. **Dynamic Assessment Generation Pipeline**:
   - The engine must be invoked automatically by the backend upon the `data_collection_completed` event triggered by the extension officer.
   - **Input Payload**: Validated officer-collected soil measurements, farm acreage, target crop, geographic coordinates (county/sub-county/ward), and field history/notes.
   - **Output Structure**: A deterministic, versioned, unverified assessment document containing:
     - `engine_version` (e.g., `kalro-rules-v2.1`) and execution timestamp.
     - Diagnosed soil health status (categorized as deficient, optimal, or excessive per analyte).
     - Actionable prescriptions per hectare ($kg/ha$ or $t/ha$) and scaled to total farm acreage.
     - Split application timing, application method (e.g., band placement, broadcasting, incorporation), and moisture/weather prerequisites.
     - Soil health rehabilitation guidance (organic matter management, green manure, crop rotation).
     - Pre-review disclaimer and agronomist sign-off block.

4. **Input Matching Bridge to Agrodealer Catalogs**:
   - The recommendation engine must output standardized elemental and functional input requirements (e.g., `Elemental_P: 40 kg/ha`, `Elemental_N: 60 kg/ha`, `Lime_CaCO3: 1.5 t/ha`).
   - A catalog-matching service translates these requirements into commercially available input formulations:
     - Basal planting fertilizers: DAP (18-46-0), TSP (0-46-0), NPK blends (e.g., 23:23:0, 17:17:17).
     - Top-dressing fertilizers: CAN (26% N), Urea (46% N), Ammonium Sulphate.
     - Soil conditioning: Agricultural Lime, Dolomitic Lime, Organic compost.
   - Product suggestions remain locked until report verification and are filtered by regional dealer stocks, proximity, and non-endorsement policy.

5. **Audited Multi-Tier Review and Human-in-the-Loop Governance**:
   - **Tier 1 (Engine Output)**: Stored immutably as the automated baseline.
   - **Tier 2 (Collaborative Draft)**: Assigned extension officer and claiming agronomist can discuss, add field context (e.g., local slope, waterlogging, farmer capital limits), and adjust dosages. Every modification records the author, previous value, new value, and agronomic rationale.
   - **Tier 3 (Verified Report)**: Only an approved/licensed agronomist can execute final publication. The publication locks the report, generates a tamper-evident audit record, records the agronomist's credentials, and notifies the farmer.

## 9. Product suggestions, orders, and payments

### Product suggestions

- Generate suggestions only from a verified report that identifies a nutrient need.
- Include only in-stock products from dealers serving the farm's location.
- Rank by: (1) distance, (2) stock that addresses the farm's needs, then (3) price.
- Use officer-captured farm coordinates and the dealer profile location for distance. Never substitute a county centroid for a farm coordinate.
- Display the dealer's pickup/delivery mode and availability/freshness information.
- Recommendations are not paid placement or an endorsement of a commercial brand.

### Orders

- Provide a cart/order-request flow, dealer confirmation, and order status tracking.
- Payments are **not** handled in SoilSync for this version. The customer and dealer arrange payment outside the app.
- Do not collect or imply a payment, escrow, or payment-completion state in the app.

## 10. Notifications and reminders

All 24-hour reminders below are delivered both in-app and by email. Define delivery as durable queued work with retry, deduplication, delivery status, and an audit trail; a provider outage must not silently erase a notification.

| Recipient | Trigger | Cadence and stop condition |
| --- | --- | --- |
| Farmer | Farm is incomplete (no visit requested) | Every 24 hours; stop when a visit is requested |
| Officers in the request county/sub-county | Visit request is unclaimed | Every 24 hours; stop on claim; restart if released |
| Officer-registered farmer | Account is unclaimed | Day 0 creation; reminders on days 1–6 every 24 hours; stop on claim; delete on day 7 |

Other notifications:

- **Farmer:** visit scheduled, data collection completed / being reviewed, verified report ready, and order updates.
- **Officer:** new visit request, agronomist review meeting planned or completed, and relevant assignment updates.
- **Agronomist:** review required, claim/release changes, and relevant flagged cases.
- **Admin:** invitation/delivery failures, unclaimed-account deletion outcomes, job failures, and operational alerts.

Avoid duplicate reminders around claim/release races. A claim must stop the old request's reminders; a release starts a new unclaimed interval without duplicating already-sent reminders for the previous interval.

## 11. Access-control rules

- Role assignment and permissions are resolved by the server from authenticated identity and database records, never from a client-selected role.
- Farmers cannot set farm coordinates or soil values.
- Officers can capture coordinates and soil measurements only for visits they have claimed and are authorized to work.
- A visit has at most one active officer claim. A review has at most one active agronomist claim.
- Only the assigned officer and current claiming agronomist can access an unverified assessment and its soil-property information.
- Farmers see verified reports only; dealers see their own orders and only fulfillment data.
- Enforce permissions at API and database boundaries, not merely by hiding screens or buttons.
- Releasing an assignment returns it to the right county pool and preserves assessment edits and audit history.

## 12. Data-source and licensing requirements

- Label every external/reference dataset value shown to users as an **estimate** and include attribution, a license link, and a note when SoilSync transformed the value.
- Store applicable license metadata with every imported record. Reject WoSIS records unless their license field is CC-BY.
- The rights status of `soil_data_all.csv` is unresolved. Keep it behind a swappable provider/data-source interface and out of public builds and farmer-facing recommendations until the rights and data quality are approved.
- Officer-collected measurements are project-generated and are not subject to external dataset licenses. Preserve provenance showing who collected the data and when.
- Validate external data rights, source, measurement method, units, depth, geography, uncertainty, and transformation before use.
- Production retention, Supabase region, and data-protection decisions for farmer data remain deferred, except that unclaimed-account deletion after one week is required now.

Known source-data facts from the repository audit: `soil_data_all.csv` has 75,500 rows and 75 columns; its depth labels are mixed (including categorical values such as `top`, `sub`, and `top+sub`); only 0.9% of rows have original coordinate pairs; and its historical recommendation text is not measured treatment or yield outcome. See [DATA_AUDIT.md](./DATA_AUDIT.md). Do not interpret the CSV audit as permission to use or publish this data.

## 13. What is already known about the app

This is the current baseline from repository inspection and earlier implementation/testing. "Present" does not mean live production behavior is verified.

### Technical architecture and auth

- Frontend: React, TypeScript, and Vite PWA.
- Backend: FastAPI/Python, PostgreSQL/PostGIS, and Supabase Auth.
- Supabase Auth currently uses email/password in the app's shared sign-in/registration flow. Self-registration is intended to grant farmer access only; staff/dealer access is server-assigned.
- Server-side profiles/roles, authentication linking, route guards, farmer onboarding, password reset/update UI, admin screens, and role-specific account screens exist.
- Invitation/password setup currently uses a secure Supabase email invite link. Admin officer and agrodealer invitations, password selection, and server-side invitation activation were implemented.
- Migration `024_admin_account_invitations.sql` has been applied to the configured Supabase database and verified in migration history. Its invitation table has RLS enabled, no `anon`/`authenticated` table access, and `service_role` access.
- Migration 024 currently supports extension-officer and agrodealer invitation roles. Agronomist invitations and officer-created farmer claim accounts are not yet included in this invitation model.
- Resending invitations for an already-existing Auth user is not implemented. Site URL, redirect allowlist, email template/SMTP, and a real invite-and-claim journey still require live verification.
- Email confirmation was disabled for the current testing rollout. The new product brief requires email addresses; it does not require adding farmer SMS/OTP or MFA now. Keep safe verified-identity requirements for linking existing profiles.
- A previous auth-state race fix and related route/onboarding tests were implemented. Treat current real-user login and setup as needing a fresh end-to-end check after the latest app changes.

### Current role experiences and data foundations

- Farmer, extension-officer, agrodealer, and admin screens/components exist. An agronomist workspace and agronomist role flow have not been established by the known implementation.
- Farmer farm/profile/onboarding, reading/recommendation/history concepts, and dashboard components exist. The present data model includes farmer-writable soil readings and farm coordinate columns; that conflicts with v5's strict rule that only officers capture soil values and exact farm coordinates. Hide/remove the farmer write paths and enforce the new rule in backend/database before treating this workflow as compliant.
- Officer jurisdictions and a database-backed officer visit/alert workflow exist, including scheduling and updating visits. The current `officer_visits` model is scheduled/assigned (`officer_user_id`) rather than the v5 shared request pool with atomic claim/release. It does not establish the required county broadcast, exclusive claim, release/re-notification, or data-collection-to-assessment pipeline.
- Agrodealer profiles, product catalog, stock freshness, location consent/search concepts, and marketplace-order tables/API/UI exist. The present marketplace workflow includes terms, payment-like pricing fields, cancellation/dispute states and other older scope; reconcile it to v5's external payment arrangement and simple cart → order request → dealer confirmation → status tracking. The current invite process seeds an initial business profile, but does not prove the complete required service-county and operation-mode onboarding.
- Admin account/role, audit, operational-health, import/status, and support-access concepts exist. Audit the live controls against the exact v5 account, credential-resend, licensing rejection, backup/export, and deletion responsibilities.
- PostgreSQL migrations are numbered through 024. Migration 024 is applied to the configured database. Earlier baseline migrations 001–017 were recorded as schema-reconciled after checking the existing schema, not as proof of their original historical execution; 018–024 are recorded as executed.
- A PostgREST pre-request hook blocks Data API access to `spatial_ref_sys`; this is separate from the product workflows and does not change extension-table ownership.

### Known implementation and documentation conflicts

Several older checklists describe phone OTP, staff MFA, production-ready auth, or workflow completion that does not match the currently implemented email/password behavior or the v5 product requirements. Use this v5 document as the product target. Before relying on old checkmarks, inspect the route, API, database enforcement, tests, and live behavior. Reconcile [FUNCTIONAL_APP_CHECKLIST.md](./FUNCTIONAL_APP_CHECKLIST.md), [AUTH_AUTHORIZATION_PLAN.md](./AUTH_AUTHORIZATION_PLAN.md), and [PRODUCT_IMPLEMENTATION_PLAN.md](./PRODUCT_IMPLEMENTATION_PLAN.md) as those areas are audited.

## 14. Main gaps between the known baseline and v5

The following are known work items, not claims that a feature is impossible or entirely absent:

1. **Account lifecycle:** officer-created farmer accounts, claim-link/password flow for farmers, six reminders, automatic day-seven deletion including initial farm data, invitation resend/reset, and agronomist admin provisioning.
2. **Agronomist:** role and approval state, profile-confirmation setup, workspace, county coverage, shared review queue, atomic claim/release, multi-assessment ownership, review editing, rule approval, and flags.
3. **Visit queue:** farmer visit requests; county eligibility; broadcast notifications; atomic officer claim/release; repeated reminders; schedules/statuses bound to the claim.
4. **Field collection, recommendation engine, and assessment:** officer-only coordinates and soil entry; collection-complete event; dynamic recommendation engine execution with crop-specific response matrices and AEZ soil-acidity calibration; commercial product translation bridge; original immutable output with rule versioning; explicit unverified state; edit history; farmer "being reviewed" notification; review dispatch.
5. **Reports:** strict unverified/verified separation, officer/current-agronomist-only access to unverified data, agronomist approval, one-time publication, and immutable verified report history by season.
6. **Farmer experience:** enforce no soil/coordinate entry, farm-incomplete reminders, officer-only county list and empty state, accurate captured location, verified reports, history, and dashboard.
7. **Product matching/orders:** derive needs only from verified reports; filter by in-stock and service county; rank and explain distance/stock/price; surface fulfillment mode; align order states to v5 and explicitly keep payment external.
8. **Notifications/jobs:** durable email + in-app event delivery, retries/deduplication, 24-hour scheduling, stop/restart semantics, and operational visibility.
9. **Admin and reference data:** agronomist/officer/dealer/farmer-account lifecycle management, reference tables, strict license rejection, and operational support for queues, deletion, and exports.
10. **Authorization and privacy:** implement new ownership/claim gates at every API and DB access path, especially for coordinates, soil values, unverified assessments, and dealer order views.
11. **Data rights:** keep `soil_data_all.csv` excluded from public builds and recommendations until rights are resolved; implement record-level license checks and source attribution.
12. **Live acceptance:** test real email links, routing, reminders, claims under concurrency, deletion, role access, and complete journeys on a non-production Supabase project.

## 15. Recommended implementation sequence

Complete each phase with tests and acceptance evidence before moving the related workflow into user-facing production.

### Phase 0 — Lock the v5 contract and reconcile existing behavior

- Treat this reference as the target; make a route/control/API/data inventory for each role.
- Identify every existing feature that conflicts (especially farmer soil/coordinate editing, old visit assignment behavior, old order/payment states, and stale auth claims).
- Record exact database/API owners for each transition and identify which existing tables can safely support the new lifecycle.
- Define the admin agronomist approval criteria and exact reference-data source for county/sub-county/crop catalogs.
- Preserve external payment as an explicit out-of-system boundary.

**Exit:** one accepted state machine, privacy matrix, event/notification contract, and testable acceptance matrix.

### Phase 1 — Identity and account lifecycle

- Keep email/password and farmer self-registration.
- Add admin provisioning for agronomists, secure claim setup for officer-registered farmers, password setup, pending/active/suspended states, and resend/reset controls.
- Ensure farmers cannot claim another person's account by knowing an email address alone.
- Implement Day 0–6 reminder and Day 7 atomic deletion, cascading initial farm data and recording a non-sensitive audit outcome.
- Build idempotent job execution and test timezone/clock boundaries, claim-vs-delete race, delivery failure, retries, and duplicate delivery.

**Exit:** tested farmer self-register, officer register-and-claim, staff/dealer/agronomist invite and setup, resend/reset, and unclaimed deletion journeys.

**Repository status (2026-10-05):** Officer-assisted farmer registration, Supabase claim invitations, agronomist provisioning/approval, and the farmer farm-creation boundary are implemented. The reminder worker now requests a Supabase Auth recovery email that returns to the claim/password-setup flow; reminder state is recorded only after Supabase accepts the request. An hourly GitHub Actions workflow invokes reminders and Day-7 cleanup using a server-side job token. Live SMTP delivery, redirect allow-listing, GitHub secrets, and the full day-7 journey still require deployment configuration and staged verification; do not mark the account acceptance items complete based only on unit tests.

### Phase 2 — Locations, county pools, and notification foundation

- Maintain canonical county/sub-county reference records and active coverage for officers and approved agronomists.
- Implement queryable eligible-county lists and explicit empty states.
- Add durable in-app notification records plus email delivery status/retry handling.
- Implement pool membership, county broadcast, 24-hour reminders, and claim/release event semantics for visits and reviews.

**Exit:** eligible recipients and reminder stop/restart behavior are correct under claim/release races and delivery retries.

### Phase 3 — Farmer farms and officer field visits

- Enforce farm creation fields and incomplete state.
- Remove farmer ability to submit soil values or exact coordinates from UI, API, and database write policies.
- Create visit requests and atomically claim/release them.
- Bind scheduling and field collection to the one claiming officer; validate county and farm ownership at each transition.
- Capture exact coordinates and soil properties under officer authorization only.

**Exit:** farmers can create farms/request visits; only the winning officer can schedule and collect; rejected users cannot bypass UI restrictions.

### Phase 4 — Recommendation engine, review, and verified publication

- Implement crop-specific nutrient response tables (KALRO guidelines for maize, potatoes, tea, coffee, vegetables) and regional AEZ soil-acidity/liming calculations.
- Automatically execute the recommendation engine on data-collection completion, computing both per-hectare and scaled farm-acreage prescriptions.
- Keep engine baseline output immutable and store officer/agronomist adjustments separately with provenance and audit history.
- Map elemental nutrient requirements to commercial agrodealer fertilizer formulations (DAP, CAN, Urea, NPK, Lime).
- Enforce the two report states and unverified visibility rule (restricted to assigned officer and claiming agronomist).
- Dispatch county-based reviews, support atomic agronomist claim/release and multiple distinct claims, preserve officer edits, and prevent all other agronomists from reading claimed inputs.
- Support agronomist review/approval and immutable one-time publication.
- Trigger farmer "being reviewed" notification at collection completion and "verified report ready" at publication.
- Require agronomist approval and versioning for recommendation rules before activation.

**Exit:** full collect → assess → claim → collaborate → approve → publish path passes agronomic sanity, access-control, and immutability tests.

### Phase 5 — Product matching and order requests

- Compute needs from verified reports only.
- Filter by stock and dealer service coverage; use captured farm coordinates and dealer location; apply the defined ranking.
- Align dealer profiles with counties served and pickup/delivery modes.
- Implement cart, request, dealer confirmation, and tracking without payment processing or misleading payment state.
- Restrict dealer reads to their own fulfillment information.

**Exit:** integration tests demonstrate correct eligibility/ranking and no dealer access to farm soil data.

### Phase 6 — Admin operations, licensing, reliability, and release

- Complete reference-data, account/role, credential, import-license, audit, error, backup/export, and deletion operations.
- Resolve or continue to exclude the CSV's rights status; test rejection of missing/disallowed licenses, including non-CC-BY WoSIS records.
- Add dashboards and alerts for scheduled job failures, notification failures, stuck claims, and unclaimed-account deletions.
- Run full regression and access-control tests plus staged live email journeys.
- Review security, privacy, backups, recovery, and production retention/data-region decisions before production launch.

**Exit:** every enabled user-facing action is durable and observed; production deployment is not approved solely by automated unit tests.

## 16. Acceptance checklist

### Accounts

- [ ] Farmer can self-register with required email and cannot select a privileged role.
- [ ] Officer registers a farmer while present; farmer receives a secure claim link, sets a password, and claims the account.
- [ ] Unclaimed reminders occur once on days 1–6; claim stops reminders.
- [ ] On day 7, an unclaimed account and all farm data entered at creation are deleted; no visit or edits could have been attached.
- [ ] Officer, agronomist, and dealer can only be created by an admin, get secure setup links, set a password, and complete their defined setup.
- [ ] Existing pending invitations can be resent/reset safely; failures are visible and auditable.
- [ ] Agronomist approval is required before claiming or approving an assessment.

### Farmer and officer visits

- [ ] Farmer can add farm details but cannot write coordinates or soil values through UI, direct API, or database access.
- [ ] A farm without a requested visit is marked incomplete and has 24-hour app/email reminders; a visit request stops them.
- [ ] Farmer county selection contains only counties with officers and has a useful no-officer empty state.
- [ ] All eligible officers are notified; simultaneous claims produce one owner only.
- [ ] A claim removes the request from all other queues; release returns it to the same pool and restarts reminders.
- [ ] Only the claiming officer can schedule/update/collect; exact location and soil entry are officer-only.

### Assessment and agronomist review

- [ ] Collection completion starts dynamic assessment generation and sends the farmer the "being reviewed" message immediately.
- [ ] Recommendation engine evaluates crop-specific nutrient response matrices and AEZ soil-acidity/liming thresholds.
- [ ] Output includes both per-hectare dosages and scaled total farm acreage requirements with split application timing.
- [ ] Elemental nutrient recommendations map to commercial fertilizer and amendment classes for agrodealer catalog matching.
- [ ] Engine output is clearly unverified/not final and stored separately from edits with provenance and audit trail.
- [ ] Only the assigned officer and current claiming agronomist can access unverified assessment and associated soil data.
- [ ] Agronomist county selection/notification follows the local-then-fallback rules and has a no-agronomist empty state.
- [ ] Atomic claims allow one agronomist per assessment and multiple assessments per agronomist.
- [ ] Release returns work to the same pool and preserves officer edits.
- [ ] Agronomist approval creates exactly one immutable verified report visible to the farmer.

### Products and operations

- [ ] Suggestions come only from verified-report nutrient needs and in-stock products serving the farm's location.
- [ ] Ranking is distance, matching stock, then price; mode of operation is visible.
- [ ] Orders can be requested, confirmed, and tracked; payment is clearly outside the system.
- [ ] Dealers see only their own order fulfillment details, not farm soil/location or unneeded farmer data.
- [ ] Missing/disallowed dataset licenses are rejected; each accepted imported record keeps its source/license/attribution metadata.
- [ ] Job, email, and in-app notification errors are observable and retriable without duplicate business actions.
- [ ] Every role's direct API access is tested as well as its visible UI.

## 17. Important implementation notes

- Use transactions and database constraints/locking for exclusive claims, activation, and day-seven deletion. A frontend check is not sufficient.
- Use server timestamps for 24-hour schedules and persist delivery/claim interval state so a restart does not reset or duplicate reminders.
- Model visit and review work-queue status separately from report state. The report itself remains exactly unverified or verified.
- Do not overwrite engine output when an officer or agronomist edits an assessment.
- Ensure officer edits persist across agronomist release/reclaim; record actor, timestamp, before/after or equivalent versioned patch.
- Store coordinates with explicit role authorization, purpose, source, and audit trail. Do not show coordinates to farmers until officer capture and do not expose them to dealers.
- Prefer durable notification/outbox processing over synchronous email-only behavior. Email provider success and app-level notification creation are separately observable.
- Make automatic deletion idempotent and ensure it cannot delete a claimed account due to a delayed reminder job.
- Do not use synthetic/demo records as successful production fallbacks.
- Keep secrets server-side. The Supabase service-role key and database connection string must never be exposed to the frontend.
- Recommendation engine rules must be deterministic and fully auditable: given the same soil measurements, crop, and location, the engine must produce identical baseline outputs.
- Version agronomic rule sets explicitly (e.g. `kalro-maize-v1.0`). Any rule update requires agronomist sign-off and must never retroactively alter previously generated assessment records.
- Product translation must decouple elemental nutrient needs from specific commercial brands: provide category and formulation mappings (e.g., Nitrogen top-dressing -> CAN 26%) rather than hardcoded brand preferences.

## 18. Related project references

- [Authentication and authorization plan](./AUTH_AUTHORIZATION_PLAN.md)
- [Product implementation plan](./PRODUCT_IMPLEMENTATION_PLAN.md)
- [Functional app checklist](./FUNCTIONAL_APP_CHECKLIST.md)
- [Data audit](./DATA_AUDIT.md)
- [Admin invitation migration](./backend/database/migrations/024_admin_account_invitations.sql)
