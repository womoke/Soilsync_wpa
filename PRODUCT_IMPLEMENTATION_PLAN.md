# SoilSync Product Implementation Plan

**Status:** In progress. This plan is not a production-readiness sign-off.

## Activity Progress

| Activity | Status | Evidence / remaining work |
| --- | --- | --- |
| Link authenticated role sessions to server-assigned profiles | Complete for profile linking and role verification | Farmer profile linking was already present. Officer, agrodealer, and admin sessions now call `/api/v1/auth/link` and only enable protected account data after the expected server role is confirmed. Frontend tests: 54 passed; backend tests: 62 passed; Ruff, frontend ESLint, changed-file formatting, and production build passed. |
| Provide a shared email/password sign-in and registration entry | Complete for the application flow | `/` and `/welcome` show the same sign-in/register form. The verified server profile controls routing; self-registration creates farmer access only, while existing assigned staff roles remain server-controlled. Verified by 56 frontend tests and targeted backend identity-link tests. |
| Remove manual token-entry controls from normal user interfaces | Complete for non-test builds | Developer token forms are compiled only in test mode. All ordinary account forms use email/password. |

**Current auth status:** Shared email/password sign-in and registration, server-assigned role routing, verified-email farmer profile creation, and farmer email/password access are implemented. Live identity-provider configuration, email confirmation settings, password recovery, and end-to-end verification remain outstanding. RLS policy coverage, administrator MFA, and abuse controls require a separate security-hardening pass. This is progress, not a production-readiness claim.

## Product Goal

Deliver a cohesive, usable SoilSync application in which each person signs in through the appropriate account flow, sees only the workspace and data allowed by their authenticated role, and can complete every enabled workflow. Synthetic records may support development and demonstrations, but they must be clearly identifiable in provenance and must never be presented as verified field data.

There will be no workshop walkthrough, role impersonation selector, or role switching in ordinary app navigation. A person's role comes from their verified server-side account, not from a URL parameter or client-side choice.

## Current Baseline and Constraints

- The frontend has farmer, extension-officer, agrodealer, and admin experiences, plus separate authenticated account components. The application entry now provides one email/password login and registration flow and routes by the server-linked role.
- Self-registration creates a farmer profile only after Supabase verifies the email. Staff/dealer/admin access remains based on a preassigned server-side profile; role choice is not accepted from the client.
- Backend protected routes resolve a Supabase-authenticated identity and database profile role. The public register and login API placeholders return HTTP 501; the frontend Supabase client must perform normal authentication directly.
- The backend still reports `demoMode: true` for the existing product APIs. In non-test builds the root opens the shared account screen, and demo records are requested only in the test-only workshop route; live sign-in depends on configured Supabase Auth.
- The source CSV has 75,500 records, inconsistent depth labels, missing/invalid measurements, sparse coordinates, and historical recommendation text. Those text values are not measured treatment or harvest outcomes.
- The project has provider adapters for SoilGrids and WoSIS, but provider eligibility, record licensing, compatible methods/depths, and operational use must be verified before provider data influences farmer guidance.
- Existing theme tokens already establish cream/white surfaces, gold accents, navy/blue text, green/red statuses, and a midnight dark theme. The remaining stylesheet also contains starter-template defaults that conflict with the product theme.
- The earlier [implementation roadmap](./IMPLEMENTATION_ROADMAP.md), [functional checklist](./FUNCTIONAL_APP_CHECKLIST.md), and [provider tracker](./provider_approval_tracker.md) contain useful work and evidence, but some checked claims conflict with current code and runtime behavior. Audit and reconcile them rather than treating every checkmark as verified.

## Product Rules

1. **Authenticate first; resolve role on the server.** Login does not let a person choose a role. The verified profile determines the destination and available actions.
2. **No false completeness.** A feature is either implemented and usable, or it is clearly unavailable/not offered. No dead controls, invented success states, or silent fixture fallbacks.
3. **Synthetic is a data attribute, not the whole product identity.** Avoid repeating “demo” in every heading. Show unobtrusive source/provenance labels where a record or decision is displayed and make synthetic status discoverable.
4. **Recommendations need an evidence-based first release.** Build a real, transparent, data-informed agronomy engine with explicit source, unit, depth, method, crop, geography, uncertainty, and rule-version handling. Do not call a model trained on historical recommendation prose a validated predictive model.
5. **No unsupported dosage.** Actionable rates, timing, and safety instructions require documented agronomist approval. Until then, the engine may provide reviewed soil-condition interpretations, explain evidence and data gaps, and state when it cannot make a recommendation.
6. **Keep SoilSync's visual identity.** Refine the existing cream, white, gold, navy, and midnight palette; do not introduce an unrelated brand palette.

## Phase 0 — Reconcile Scope and Define Acceptance

**Exit criteria:** One agreed account policy, enabled-feature inventory, data contract, recommendation scope, and acceptance matrix.

- [ ] Compare each marked-complete item in the functional checklist and existing roadmap to its implementation, current runtime, and test evidence. Correct stale or unsupported claims.
- [ ] Inventory every user-facing route, portal, form, button, API call, and role permission as implemented, incomplete, or intentionally out of scope.
- [x] Set the initial account policy: email/password for all roles; self-registration creates farmer profiles only; staff/dealer/admin roles must already be assigned to the server-side profile.
- [ ] Keep privileged roles closed: officers/admins are provisioned by an administrator; agrodealer applications remain pending until approval (no self-selected role).
- [ ] Assess password/email-signup abuse controls (rate limits and CAPTCHA where appropriate). MFA is intentionally deferred for the current MVP per product decision.
- [ ] Verify database-side authorization for every table: users cannot write roles; ownership and officer-region policies are enforced by RLS rather than UI visibility.
- [ ] Confirm which identity provider project, callback URLs, email confirmation/delivery, password recovery, MFA settings, and account invitations are available for local/staging use.
- [ ] Document the authority for role assignment and role changes; user-supplied roles never grant access.
- [ ] Define which data sources are permitted in development, internal evaluation, and farmer-facing operation, and name who approves each transition.
- [ ] Define the first recommendation product: initial crops/regions, supported measurements, permissible outputs, excluded use cases, and human review boundary.
- [ ] Establish measurable acceptance tests for login-to-role routing, each enabled workflow, data provenance, recommendation behavior, accessibility, and outage states.

## Phase 1 — Identity, Authenticated Routing, and Role Isolation

**Depends on:** Phase 0 account policy and accessible identity-provider configuration.

- [x] Make the entry route a professional sign-in/registration experience, not a farmer dashboard with a role picker.
- [x] Implement email/password sign-in for all roles and farmer self-registration; staff/dealer/admin sessions resolve only to preassigned server-side profiles.
- [x] Remove manual bearer-token inputs from normal user interfaces. Keep test credentials and token injection confined to automated tests/developer tooling.
- [x] On successful authentication, fetch the linked app profile and route by its server-resolved role to `/farmer`, `/officer`, `/dealer`, or `/admin`.
- [x] Link restored staff and dealer Supabase sessions to the server-side app profile and verify the returned role before enabling protected workspace data; farmer account linking was already present. Verified with frontend role-linking tests and backend auth API tests.
- [ ] Protect direct URLs and refreshes: unauthenticated users go to sign-in; inactive/unlinked users receive a useful account-state message; wrong-role access is denied server-side and returns to the authorized workspace.
- [ ] Keep role changes and account administration in authorized admin workflows. Do not provide user-facing role impersonation or client-only role switching.
- [ ] Make logout revoke the current provider session and clear app state. Handle expired sessions and account switching without displaying cached data from the previous identity.
- [ ] Provide real, non-production test accounts for every role in isolated local/staging identity infrastructure; never create public hard-coded demo passwords.
- [ ] Test each role's sign-in, recovery/denial state, direct URL, refresh, logout, account switch, expiry, and cross-role API denial.
- [ ] Verify that public registration cannot assign or modify roles, privileged accounts require administrator provisioning, and agrodealer applications cannot access dealer functions before approval.

**Acceptance:** Each role enters through its normal sign-in process, lands on the correct role-specific page, cannot access another role's functions, and remains in the correct state after refresh.

## Phase 2 — Functional Role Workspaces and Honest Feature Boundaries

**Depends on:** Phase 1 identity and authorization.

- [ ] Create one role-specific app shell per authorized role, with consistent navigation, account identity, page titles, notifications, and logout.
- [ ] Remove demo persona buttons and role-switching controls from ordinary navigation. Do not add a workshop-tour substitute.
- [ ] Audit the current farmer workflow: farm selection and ownership state, reading creation/history, source and quality display, recommendations, feedback, offline drafts, retry, and sync status.
- [ ] Audit the officer workflow: assigned jurisdictions, minimum necessary roster data, visits, alerts, ward summaries, and approved exports.
- [ ] Audit the dealer workflow: own profile, listing and stock management, location consent, search, order availability, and actual order state transitions.
- [ ] Audit the admin workflow: account lifecycle, permissions, audited changes, operational status, and scoped support access.
- [ ] For each role, connect enabled controls end-to-end to authorized APIs and durable storage, with validation, loading/empty/error/success states, and recovery paths.
- [ ] Hide or clearly disable features that are not implemented or configured. Do not show controls that imply an action succeeded when the API did not persist it.
- [ ] Identify every synthetic seed and synthetic account as such in underlying records and in a quiet, consistent source/provenance treatment; do not put a generic demo banner on every page.
- [ ] Ensure database/provider outages never cause silent substitution with synthetic records, and never make unavailable data appear current.

**Acceptance:** Every visible primary action has a working, tested outcome; every record identifies its source and quality; unavailable features and data are represented honestly.

## Phase 3 — Source-Quality and Agronomy Data Pipeline

**Depends on:** Phase 0 usage decisions; provider-specific rights approval before external records are retained or reused.

- [ ] Reconcile the current imported dataset and schema state from the documented 75,500-row import; verify source fingerprint, reconciliation totals, duplicates, rejected values, and provenance in the target environment.
- [ ] Keep the raw source immutable and internal. Maintain validated normalized features separately with source record ID, dataset version, original value/unit, normalized value/unit, location basis/uncertainty, sample date, depth label/bounds, method, quality, and license/attribution metadata.
- [ ] Parse strict numeric formats; quarantine invalid tokens and implausible values with reasons rather than silently coercing them.
- [ ] Preserve depth labels such as `top`, `sub`, and `top+sub`; only assign interval compatibility from an approved mapping.
- [ ] Approve an authoritative administrative-area crosswalk for the source's county labels. Do not infer farm coordinates from county names or centroids.
- [ ] Separate measured lab/profile observations from SoilGrids estimates. Preserve uncertainty, map depth, version, spatial resolution, retrieval time, and attribution for estimates.
- [ ] Admit WoSIS records only after checking each record's license, method, depth, provenance, and intended use; exclude unknown/ineligible records.
- [ ] Prevent duplicated/overlapping SoilGrids and WoSIS evidence from being counted as independent observations.
- [ ] Exclude names, phone numbers, and unnecessary personal identifiers from the recommendation-training/reference dataset.
- [ ] Build repeatable ingestion, schema validation, lineage reports, duplicate handling, provider freshness, bounded retries, and auditable correction/re-import procedures.

**Acceptance:** A reviewer can trace every eligible recommendation feature to its source and transformation, and reproduce the eligible input cohort from a recorded dataset/provider version.

## Phase 4 — Build the Real Recommendation Engine

**Depends on:** Phase 3 compatible, traceable data; agronomist-approved interpretation criteria before actionable outputs.

### 4.1 Evidence-backed baseline

- [ ] Replace fixed demo fallback values and generic deficiency comparisons with a backend recommendation service over validated, compatible measurements.
- [ ] Define versioned agronomic rules by analyte, crop, geography, analytical method, depth interval, units, and applicable guidance source. Use authoritative published/agronomic references selected and reviewed by a qualified agronomist.
- [ ] Use the project soil dataset to measure feature distributions, missingness, valid ranges, regional/crop coverage, and compatible cohort reference ranges; do not treat its historical fertilizer text as successful treatment or yield outcomes.
- [ ] Use SoilGrids only as clearly labeled estimated background context, with conservative spatial/depth compatibility. Use eligible WoSIS observations as attributed reference observations, not as treatment outcomes.
- [ ] Implement explicit eligibility and abstention logic: missing/invalid/incompatible/out-of-range data, poor location confidence, unsupported crop/region/method, or conflicting evidence returns “insufficient evidence / lab or officer review,” not an invented rate.
- [ ] Return structured evidence: interpretation, contributing measurements, source and quality, comparison/rule, known limitations, uncertainty/confidence basis, rule version, and review/approval status.
- [ ] Keep fertilizer product suggestions, rates, timing, and safety instructions disabled until separately signed off for the exact rule/crop/region and documented input conditions.
- [ ] Store each recommendation with the input snapshot/reference IDs, engine/rule version, generation time, and review history so it can be reproduced and audited.
- [ ] Test decision boundaries, unit conversions, missing/invalid inputs, method/depth mismatches, estimated-versus-measured handling, provider absence, unsupported contexts, and consistency across repeated runs.

### 4.2 Outcome data and predictive model (later gate)

- [ ] Design consented field data collection for treatment applied, product/nutrient, rate, timing, crop/variety, season, management, rainfall/irrigation, baseline soil, and measured yield/harvest outcomes.
- [ ] Define outcome quality controls, provenance, missingness, data rights, retention, farmer consent, and independent agronomy review.
- [ ] Establish spatially and temporally grouped train/validation/test cohorts to prevent location, farm, season, and duplicate-profile leakage.
- [ ] Compare candidate models against the reviewed rule baseline; report coverage, calibration, uncertainty, subgroup performance, and failure modes.
- [ ] Do not label a model “trained”, “predictive”, or “effective” unless it uses eligible measured outcomes and passes the agreed validation and agronomist gates.
- [ ] Deploy any model behind versioning, monitoring, rollback, drift checks, human review, and an approved pilot; rules/abstention remain the safe fallback.

**Recommendation launch gate:** A real evidence-backed interpretation engine may be released before a learned yield-response model, but only outputs individually approved for the evidence and intended context may be actionable. Where that approval or compatible evidence is absent, show a useful explanation and next step without pretending a prescription is known.

## Phase 5 — Professional Product Design

**Can proceed alongside Phases 1–4, but must use their real authenticated states and data contracts.**

- [ ] Establish reusable design tokens from the existing brand: warm cream page background, white surfaces, restrained gold actions/highlights, navy text/navigation, accessible status colors, and optional midnight-blue dark mode.
- [ ] Remove starter-template styles and conflicting system dark-mode overrides; make the chosen app theme deterministic and ensure every component uses the shared tokens.
- [ ] Create a consistent authenticated shell with restrained header, clear role/workspace identity, consistent sidebar or mobile navigation, page hierarchy, and account menu.
- [ ] Refine typography, spacing, cards, forms, tables, badges, empty/error/loading states, and confirmation patterns for a calm, credible agricultural-data product.
- [ ] Use a concise source/record badge and provenance details instead of repeated “demo/prototype” marketing copy. Retain prominent synthetic identification at the affected record and a concise non-advice label wherever recommendations are not approved.
- [ ] Use role-specific copy and only show metrics/actions supported by real API results.
- [ ] Test desktop, tablet/mobile, projection-friendly readability, keyboard-only operation, screen readers, contrast, focus, reduced motion, and zoom.
- [ ] Add visual regression or reviewed screenshots for each role's core pages and light/dark themes.

**Acceptance:** The four workspaces look like one finished product in the established color system, while data origin, uncertainty, and account identity remain understandable.

## Phase 6 — Reliability, Security, and Release Validation

**Depends on:** Enabled role workflows and selected recommendation scope.

- [ ] Configure separate local, test, and staging environments; keep service-role/database credentials server-side and isolated from frontend builds.
- [ ] Apply and verify migrations, RLS, role/ownership/jurisdiction checks, and append-only audit controls against the actual target schema.
- [ ] Add actionable operational logging, health/readiness checks, provider/database status, error reporting, rate limits, and sensitive-data redaction.
- [ ] Verify migrations and seeds are repeatable and do not destroy user or workshop/test data unexpectedly.
- [ ] Run automated unit, API authorization, frontend integration, end-to-end authentication, recommendation contract, accessibility, lint, format, and production build checks.
- [ ] Verify backup and restore in an isolated environment, and define data retention, recovery objectives, rollback, and incident contacts.
- [ ] Test behavior during expired sessions, database outage, provider outage, malformed provider data, stale measurements, offline use, queue conflicts, and interrupted writes.
- [ ] Conduct a focused security review before any real personal/farm data or public hosting.
- [ ] Document deployment configuration and operational handoff; do not call local Vite or a local API a deployment.

**Release gates:**

- **Functional pilot:** authenticated role routing and selected workflows work end-to-end in isolated staging; synthetic and measured/estimated data are distinguished.
- **Farmer-facing recommendation pilot:** data-source permissions and attribution are documented; engine inputs/abstentions are traceable; exact actionable rules and language are agronomist-approved; evaluation and human-review operations are in place.
- **Predictive model release:** outcome data, grouped holdout validation, uncertainty/performance gates, monitoring, and explicit product/agronomy approval are complete.
- **Public production:** security, privacy, retention, backup/restore, hosting, monitoring, recovery, and operational ownership are approved and exercised.

## First Implementation Increment

After this plan is approved, implement the work in this order:

1. Reconcile the current behavior and checklist claims; agree account flows and the enabled initial feature set.
2. Replace the role-switching landing experience with normal sign-in, server-resolved role routing, distinct protected workspaces, and no manual-token login UI.
3. Make the selected role's existing core workflow genuinely usable end-to-end, starting with farmer account and readings; only expose other role actions that pass the same end-to-end bar.
4. Build the validated dataset feature pipeline and agronomist-reviewed, evidence-backed rule engine; defer outcome-predictive ML until labeled outcomes exist.
5. Apply the shared design system and professional visual pass to the authenticated role shells and workflows.
6. Validate the selected release gates in staging and update the functional checklist only with evidence.

No dates are committed in this plan. Scope, data approvals, identity-provider access, and agronomy review are dependencies to confirm before estimation.
