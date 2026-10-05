# SoilSync Manual Workflow Test Checklist

**Purpose:** A repeatable, hands-on test of the real user journeys, starting with a local admin and then using that admin to provision the other test accounts.

**Run environment:** Local development only. Start a new run by recording the date and tester below. Do not use production accounts, real farmer information, real passwords, access tokens, or production data.

## Progress

| Phase | Status | Notes |
| --- | --- | --- |
| 0. Local test setup and admin access | Passed | User signed in and submitted an officer invitation; this confirms browser admin access. |
| 1. Admin workflow | In progress | User reported content clipping/spacing issues and expected inbox email not received; UI fixes and local email-capture explanation are being addressed. |
| 2. Extension-officer workflow | In progress | A local synthetic officer login is prepared and authenticated. Shared role-page gutters, form controls, and solid modal surfaces have been improved; user should retest the officer workflow. |
| 3. Agronomist workflow | Not started | A local approved synthetic agronomist login is prepared; pending-invitation checks remain separate. |
| 4. Farmer workflow | Not started | A local synthetic farmer and farm are prepared; verify the report after agronomist publication. |
| 5. Agrodealer workflow | Not started | Dealer account is created by the admin; use a farmer-generated order if the app supports the complete path. |

**Current phase:** 1 — Admin workflow  
**Run date:** Not started  
**Tester:** Not recorded

Status meanings: **Not started**, **In progress**, **Passed**, **Failed**, **Blocked**, or **Not applicable**. Check a box only after performing the action in the running app. A passing automated test is useful evidence, but does not count as a manual workflow pass.

## How to record results

1. Work through one phase at a time. Start at phase 0; do not skip a blocked prerequisite.
2. For each case, check the box only when the expected result is observed. If it fails, leave it unchecked and add the case ID to the issue log.
3. Record only synthetic account aliases, app-generated IDs, status codes, and non-sensitive observations outside the prepared local-login table. Never paste invitation links, tokens, production credentials, email contents containing secrets, or personal information here.
4. When reporting progress in chat, use the case IDs and a result, for example: `A-01 PASS`, `A-03 FAIL — users tab shows HTTP 403`, or `O-02 BLOCKED — no invitation email received`. The checklist and session progress tracker can then be updated together.
5. Do not continue downstream when the prerequisite data or account was not created successfully. Record the blocker and stop at that point.

## Safe test data to prepare

Use invented data throughout. Keep one consistent test county, sub-county, ward, farmer, farm, and crop across linked workflows. Use the local Supabase email-capture tool for invitation/setup links; do not send invitations to real people.

| Record | Suggested test value |
| --- | --- |
| County / sub-county / ward | Choose a valid county and its test sub-county and ward; reuse these values for the officer, farmer, and farm. |
| Farmer | `SoilSync Test Farmer` with a synthetic, local-only email alias. |
| Farm | `SoilSync Test Farm`; small acreage; one crop such as maize. |
| Extension officer | `SoilSync Test Officer`; assign the chosen jurisdiction. |
| Agronomist | `SoilSync Test Agronomist`; use a fake registration number such as `TEST-AGR-001`; select **Pending Approval** first. |
| Agrodealer | `SoilSync Test Dealer`; use an invented business name and synthetic contact. |

Avoid reusing any real person's contact information. A local mail-capture UI can display claim links: treat those links as credentials, do not paste them into this file or chat, and use them only in the local app.

### Prepared local test logins

These confirmed accounts were provisioned directly in the local Supabase Auth/database so the workflows can be tested without waiting for invitation email. Passwords are temporary local-test credentials. This checklist contains secrets: keep it local and exclude it from every commit. This does **not** complete the invitation cases below; continue using local Mailpit for those.

| Role | Local login | Temporary password | Prepared test state |
| --- | --- | --- | --- |
| Admin | `ops@example.com` | `X&6p5KlDenHThr*UO=!jLLy%` | Operations Admin; all seven local admin permissions are enabled. |
| Farmer | `test.farmer@soilsync.test` | `GGA@_rt7Agz3#S!dtOxU0XNs` | Nakuru / Njoro / Mau Narok; a 2.5-acre maize farm named `SoilSync Local Test Farm` is ownership-verified for workflow testing. |
| Agronomist | `test.agronomist@soilsync.test` | `-yU0%qi4R!O9l0D7z_J1fkWU` | Approved for Nakuru with test-only licence `TEST-AGR-001`. |
| Extension officer | `test.officer@soilsync.test` | `7#ZMHtQGF$@1UdM%4LBwLCih` | Active ward assignment for Nakuru / Njoro / Mau Narok. |

## 0. Local test setup and admin access

### Stop/go checks

- [ ] **SETUP-01** — Confirm the browser address is the local app (expected origin: `http://127.0.0.1:5173` or the configured local HTTPS equivalent), not the deployed app.
- [ ] **SETUP-02** — Confirm the frontend API proxy points to the local backend and the backend points to the local database and local Supabase Auth. Stop if any service points at production.
- [ ] **SETUP-03** — Confirm the local database migrations needed by the current app are applied and the local API health check succeeds.
- [ ] **SETUP-04** — Confirm local Supabase Auth email capture is available, so account invitations and claim links can be completed without contacting real users.
- [ ] **SETUP-05** — Find or create a dedicated local admin test account. Do not use production admin credentials locally.
- [ ] **SETUP-06** — Have an authorized local operator grant only the permissions needed for this run. Do not add an authorization bypass or change production grants.
- [ ] **SETUP-07** — Sign into the local app as the test admin and confirm the admin workspace appears. Do not use a demo role selector as proof of real admin authorization.

The admin screens use distinct least-privilege grants. For the planned checks, verify the test account has the applicable grants:

| Admin action | Required grant |
| --- | --- |
| List/manage user accounts | `manage_accounts` |
| Change user roles | `manage_roles` |
| Invite officers and manage officer assignments | `manage_officer_assignments` |
| Manage dealer approvals | `manage_dealer_approvals` |
| View audit history | `view_audit_log` |
| Grant/revoke sensitive-record support access | `support_access` |
| Edit stored system settings | `manage_settings` |

**Current local prerequisite:** The local database contains an active admin account, `ops@example.com` (`Operations Admin`), linked to a confirmed local Supabase Auth identity. All seven admin permissions are granted to this local test account only. The user has signed in and submitted an officer invite; these changes do not affect production.

**Invitation delivery note:** The local Supabase configuration has its SMTP testing service enabled. A successful invite call means the local Auth service accepted/captured an invitation; it does not deliver to external inboxes. Open [the local captured-email inbox](http://127.0.0.1:54324/) to inspect the message for the synthetic test account. Treat any setup link as a credential; do not paste it into this checklist or chat.

## 1. Admin workflow

### Sign-in, overview, and navigation

- [X] **A-01** — Sign in through the normal local authentication flow. Confirm the admin role is accepted and the admin workspace loads without a raw diagnostic/log-style message.
- [X] **A-02** — Open **Overview**. Confirm metric cards and active-permission badges load; refresh and confirm the page remains usable.
- [X] **A-03** — Open **Accounts & Roles**. Confirm the user list loads; search for a known local test account and try a role/status filter.
- [X] **A-04** — Open **Operational Health**. Confirm it loads successfully, displays database/sync/import/provider status, and does not expose farmer contact details or coordinates.
- [X] **A-05** — Open **Audit Trail**. Confirm existing privileged actions are visible after performing the relevant actions below.

### Provision the test team (to test with smtp server in production)

- [ ] **A-06** — Invite the test extension officer with the chosen county, sub-county, ward, and designation. Confirm success is reported only after the API accepts the invitation.
- [ ] **A-07** — Open the captured local invitation, set the officer's password, and sign in as that officer in a separate session/browser profile. Confirm the role and assigned jurisdiction are correct.
- [ ] **A-08** — Invite the test agronomist with the fake license number and **Pending Approval** status. Complete the captured invitation and verify the account is pending.
- [ ] **A-09** — Confirm the pending agronomist cannot claim or publish an assessment. Approve the agronomist using the admin account, then verify approved access becomes available.
- [ ] **A-10** — Invite the test agrodealer. Complete the captured invitation and verify the dealer can sign in to their own dealer workspace.
- [ ] **A-11** — Verify invitation failures are visible and do not appear as successes. If a deliberate resend/cancel check is needed, use a disposable local invitation and confirm the resulting state in the account list and audit trail.
- [ ] **A-12** — Confirm role/approval changes and invitation actions that are audited appear in **Audit Trail** with the expected actor, action, and target.

### Admin operations and boundaries

- [ ] **A-13** — In **Operational Health**, retry/refresh once and confirm the panel remains stable. A local authenticated request should succeed; an unauthenticated request should be denied rather than exposing health data.
- [ ] **A-14** — Open **System Settings**. Confirm setting labels and values are understandable. Do not treat changing a stored setting as proof that the runtime behavior changes.
- [ ] **A-15** — Confirm the settings screen explains that the currently displayed seeded settings are stored configuration and are not yet wired into runtime enforcement/delivery. Do not enable maintenance mode or SMS expecting it to change the app.
- [ ] **A-16** — If support-access validation is in scope and a known synthetic record exists, grant time-limited access with a valid justification, confirm access is scoped to that record, revoke it, and verify audit events. Do not use real farmer records.
- [ ] **A-17** — Check that an admin lacking a required permission sees a clear permission-denied message. Do this only with a separate restricted local admin; never remove permissions from the only working admin mid-run.
- [ ] **A-18** — Sign out. Confirm the local session ends and protected admin pages are no longer accessible without signing in again.

## 2. Extension-officer workflow

Use the officer invited in **A-06**. Confirm the account is approved/active and scoped to the chosen jurisdiction before continuing.

- [ ] **O-12** — When recording field data, request browser/device location with clear consent and capture the officer's current GPS coordinates automatically. Show the reported accuracy in metres, its timestamp, and a clear retry/manual-entry path if location is unavailable or permission is denied. Do not imply GPS is exact.
- [ ] **O-13** — Explain location accuracy before submission: the value is the device/browser's estimated horizontal uncertainty, not a guarantee; wait for a better fix or move to an open area when it is too large. Confirm the officer can review the coordinates and accuracy before saving.
- [ ] **O-01** — Sign in as the officer. Confirm only the assigned jurisdiction is shown; confirm navigation and the page's loading state complete normally.
- [ ] **O-02** — Check the farmer roster and ward summary. Confirm the test officer sees only assigned-area data and the UI communicates aggregation/privacy limits.
- [ ] **O-03** — Register the synthetic unclaimed farmer and test farm while recording that the farmer is present. Confirm the account is marked unclaimed and the setup/claim email is captured locally.
- [ ] **O-04** — Confirm the unclaimed farmer cannot use the normal farmer workspace or request a visit before claiming the account.
- [ ] **O-05** — Schedule a visit/update a visit status and add a field note. Confirm the changes remain visible after leaving and reopening the view.
- [ ] **O-06** — If a farmer-created request is available, claim it as this officer, verify it leaves the shared pool, release it, and confirm it returns to the same jurisdiction pool. If a second officer is available, confirm that officer can claim only after release.
- [ ] **O-07** — Record field data for the test farm using plausible synthetic values. Confirm invalid values are rejected with a useful explanation and exact coordinates are entered only in the officer workflow.
- [ ] **O-08** — Complete data collection. Confirm the unverified assessment is created and the farmer-facing state indicates it is under review; do not treat the unverified result as a final farmer report.
- [ ] **O-09** — Request agronomist review. Confirm the assessment appears in the eligible review pool. If there is no eligible agronomist for the county, record the displayed selection/empty-state behavior.
- [ ] **O-10** — If available, create and resolve a synthetic alert; confirm resolution notes/status persist.
- [ ] **O-11** — Check report export only with synthetic data. Confirm it stays within the officer's authorized area and does not reveal data from an unassigned jurisdiction.

## 3. Agronomist workflow

Use the approved test agronomist from **A-08/A-09** and the assessment submitted in **O-09**.

- [ ] **G-01** — Sign in as the approved agronomist. Confirm the pending assessment appears in the review pool with farm/county and review status.
- [ ] **G-02** — Claim the assessment. Confirm it becomes assigned to this agronomist and is no longer claimable by another agronomist.
- [ ] **G-03** — Add a collaborative review note/edit. Confirm validation and persistence after refresh.
- [ ] **G-04** — If a second agronomist is available, confirm they cannot claim or view the already-claimed assessment; release the first claim and confirm it returns to the eligible pool without losing officer edits.
- [ ] **G-05** — Review the synthetic measurements and source/provenance. Enter the fake accreditation number and publish the verified report.
- [ ] **G-06** — Confirm the report changes to verified/published and cannot be silently edited or published a second time.
- [ ] **G-07** — Confirm an unapproved agronomist cannot claim or publish, even if they can authenticate.
- [ ] **G-08** — After claiming an assessment, confirm every intended report field can be edited, validation is clear, and edits persist. Current user report: the claimed assessment opens, but the report cannot be edited.
- [ ] **G-09** — Confirm assessment/report metadata includes the available farm location, county, sub-county, ward, assessment/collection date, assessing officer, and source/review context. Hide or label unavailable values rather than inventing them.
- [ ] **G-10** — Confirm the agronomist landing view includes useful, data-backed workflow metrics and an informative empty state in addition to the assessment list; do not fabricate counts or advice.
- [ ] **G-11** — Review the assessment detail dialog for readable hierarchy, responsive layout, clear editing actions, and the agreed SoilSync theme.
- [ ] **G-12** — Confirm loading indicators replace the content they represent and do not remain visible beside an already-rendered assessment/dashboard. Check both initial load and refresh states.

## 4. Farmer workflow

Use the test farmer created in **O-03**. Complete the local claim link only after recording the initial unclaimed-state check.

- [ ] **F-01** — Open the local claim/setup message, set a password, claim the account, and sign in. Confirm unclaimed status is cleared and sign-out works.
- [ ] **F-02** — Confirm the farmer sees only their own profile/farm. Edit an allowed profile field and verify it persists; confirm role, email, and approval fields are not editable in profile settings.
- [ ] **F-03** — Request a field visit if no visit was already requested. Confirm the selected county is valid and the request becomes visible to an eligible officer.
- [ ] **F-04** — Before report publication, confirm the farmer sees an appropriate review-pending state and cannot see the unverified assessment or exact officer-captured coordinates.
- [ ] **F-05** — After **G-05**, confirm the verified report and history are visible for the correct farm, with review status and source/version context.
- [ ] **F-06** — Record recommendation feedback (viewed/followed/modified/not followed, where shown). Reload and confirm the saved selection remains.
- [ ] **F-07** — Test logout and a second login. Confirm account data reloads for this farmer and does not remain visible after logout/account switch.
- [ ] **F-08** — Confirm a farmer cannot access another farmer's farm or report by changing a URL or identifier. Use only a second synthetic account and stop if a privacy boundary appears to fail.
- [ ] **F-09** — After the agronomist publishes a verified report, confirm it appears in the farmer's account for the correct farm. Investigate and resolve any farmer-screen API HTTP 500; the verified report must not be hidden by an unrelated request failure.

### Product decision to resolve before testing farmer-entered soil measurements

The current product-reference document says farmers do not enter soil measurements or exact coordinates; the functional checklist describes farmer-submitted/corrected readings. These are conflicting requirements. Do not treat farmer-entered measurements as a pass/fail case until this policy is confirmed. Exact GPS coordinates remain an officer-only test in this run.

## 5. Agrodealer workflow

Use the dealer invited in **A-10**.

- [ ] **D-01** — Sign in as the dealer. Confirm the profile, own catalog, stock state, and privacy notice load.
- [ ] **D-02** — Update the synthetic business profile/location details and save. If location consent is offered, grant it, save coordinates only for a fictitious shop, then revoke and confirm the location is cleared.
- [ ] **D-03** — Add a clearly labelled test product with fake price/stock; confirm it appears in the dealer's catalog after refresh.
- [ ] **D-04** — Update stock and freshness; confirm out-of-stock and stale states are represented accurately.
- [ ] **D-05** — If an order created from the test farmer is available, confirm it, update its fulfillment status, and verify the farmer-facing state. Confirm dealer data includes only information needed for fulfillment.
- [ ] **D-06** — Confirm this dealer cannot access another dealer's products/orders or farmer soil data.
- [ ] **D-07** — Treat **Proximity Search Preview** as a simulation unless it demonstrably returns persisted, authorized marketplace data. Record its result, but do not mark real proximity search as implemented based on a preview.

## 6. Cross-role end-to-end completion

- [ ] **E2E-01** — Starting from admin provisioning, complete one synthetic journey: admin invites officer/agronomist/dealer → officer registers farmer/farm and completes collection → agronomist reviews and publishes → farmer views the verified report → dealer fulfills a farmer-generated order if the complete ordering path is available.
- [ ] **E2E-02** — Revisit the admin audit trail and operational health after the journey. Confirm expected actions/statuses are visible and no sensitive farmer data is exposed.
- [ ] **E2E-03** — Sign out of every test account and confirm each role's protected workspace requires a fresh authenticated session.
- [ ] **E2E-04** — Remove or deactivate only the synthetic test accounts/data using supported local admin actions. Confirm no production data was touched.

## Issue and evidence log

For every failed or blocked case, add an entry here. Keep secrets and personal information out.

| Case ID | Result | Expected | Observed | Safe evidence (status/code or synthetic record ID) | Follow-up |
| --- | --- | --- | --- | --- | --- |
| A-03 | In progress | Admin content, including both ends of wide tables, should remain usable within the viewport. | User reports left/right content extending beyond the visible screen and poor spacing. | Visual issue in local admin workspace | Retest after layout changes; horizontal overflow should stay inside the table region. |
| A-06 | In progress | Invitation is accepted and the setup message is available for the recipient. | Admin success text implied delivery; local SMTP test service captures messages instead of delivering externally. A recent invitation is present in the local email-capture service. | Supabase local email capture configured; message body/link intentionally not opened here. | Check the local captured-email inbox; use a synthetic address for remaining local tests. |
| O-UI | In progress | Extension-officer pages and forms should have responsive gutters, readable controls, and opaque dialogs. | User reports clipped margins and transparent forms in the extension-officer workflow. Shared role styling and theme-aware surface tokens have been applied; modal and field computed styles verified locally in light and dark themes. | Local `/officer`; opaque modal/fields at 390px; no horizontal page overflow at 390px or 1440px. | User to retest full officer workflow, including schedule, alert, farmer registration, and field-collection dialogs. |
| O-12/O-13 | Not started | Officer collection should capture device GPS with consent, expose its estimated uncertainty, and explain how to improve a poor fix or proceed when location is unavailable. | Current collection asks officers to provide coordinates and an uncertainty value themselves; user says that is unclear and expects automatic GPS capture. | User-observed workflow gap; no location API behavior verified yet. | Implement browser geolocation with permission/error states and an accuracy explanation; test denied/unavailable/poor-accuracy paths and manual fallback. |
| G-08 | Not started | A claimed assessment can be edited and saved by its assigned agronomist. | User reports that claiming opens the assessment but they cannot edit the report. | User-observed agronomist workflow issue. | Trace the edit controls and API save path; reproduce locally and add a regression test before fixing. |
| G-09 | Not started | Assessment/report presents available farm, jurisdiction, date, officer, and source/review metadata. | User requests location, assessor, date, county/ward, and other relevant metadata; current completeness has not been audited. | Metadata request; field availability to be checked against existing assessment data. | Map existing persisted fields to the review/report UI; do not infer or fabricate missing values. |
| G-10 | Not started | Agronomist has helpful, accurate workflow metrics and an intentional empty state beyond the review list. | User reports the screen feels blank apart from assessments. | User-observed agronomist dashboard gap. | Select metrics supported by existing APIs/data and clearly distinguish zero from unavailable/loading. |
| G-11 | Not started | Assessment dialog has clear visual hierarchy, comfortable spacing, responsive layout, and accessible controls. | User says the assessment popup/dialog does not look polished. | User-observed dialog presentation issue. | Redesign after the shared visual system work; validate keyboard, mobile, and light/dark themes. |
| G-12 | Not started | A loading indicator represents an actual loading state and replaces or clearly scopes the content still loading. | User reports some screens show a loading icon while other elements are already visible, especially in the agronomist workspace. | User-observed inconsistent loading state. | Audit page-level and section-level loading state transitions; avoid simultaneous stale/loaded content and indefinite spinners. |
| F-09 | Not started | A published verified report is visible to its owning farmer, and unrelated API failures are surfaced without hiding verified data. | User reports the farmer page shows `SoilSync API returned HTTP 500` and the agronomist-verified report is not visible. | User-observed local farmer workflow failure; affected request/response body not yet captured. | Reproduce with synthetic farmer/report; identify the exact failing endpoint and backend exception, fix the source, and verify farmer-owned report retrieval after publication. |
| UI-01 | Not started | The app presents a cohesive, polished SoilSync visual system across role workspaces while retaining the established theme colors. | User says the overall app lacks consistent design principles and creativity and should feel production-ready. | Cross-role design feedback. | Establish shared typography, spacing, surfaces, elevation, and responsive patterns; roll out by workflow and check for regressions. |

## Known scope limits for this run

- Admin system-setting records currently explain intended controls but are not wired to runtime behavior. Viewing them is testable; expecting maintenance enforcement, SMS delivery, session-timeout changes, recommendation-threshold changes, or sync-limit changes is not.
- The local admin permission prerequisite must be verified before testing admin operations. The backend permission checks are intentional and must not be bypassed to make the workflow appear successful.
- Operational health was verified against the local database after correcting its dataset display-name query. The deployed environment still needs an authorized post-deployment check.
- The proximity search view is labelled as a preview/simulation; do not report it as a live marketplace integration.
- A passing screen render or isolated automated test is not proof that an email, database mutation, role boundary, or cross-role workflow worked end to end. Verify the resulting state from the appropriate account.
