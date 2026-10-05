# SoilSync Workshop UX and Presentation Checklist

This checklist addresses the workshop experience: role-specific destinations, a polished first impression, and clear but unobtrusive disclosure when records are synthetic. It does not claim production readiness or replace the technical and data-approval gates in the functional checklist.

## 1. Separate Role Destinations

- [x] Choose a deliberate entry experience: a public welcome page with clear role destinations, or a default farmer experience with a separate workshop entry point.
- [x] Give each role a stable, directly addressable destination, for example `/farmer`, `/officer`, `/dealer`, and `/admin`.
- [x] Make each destination render that role's own navigation, title, actions, and content; changing roles must not be a state-only swap that leaves the user on an unrelated section.
- [x] Remove the four-role switcher from normal role workspaces. If useful during a facilitated workshop, put role switching on a distinct presenter/workshop page rather than in the everyday app header.
- [x] Make each role destination work when opened directly or refreshed, and provide a clear way back to the welcome/workshop entry.
- [x] Separate demo personas from authenticated account portals. Never imply that selecting a demo persona signs in or grants real permissions.
- [x] Show role-specific sign-in or access guidance only when opening authenticated account workflows; make unavailable sign-in configuration understandable rather than exposing a broken portal.

## 2. Make Synthetic Data Disclosure Clear, Not Repetitive

- [ ] Replace repeated “demo”, “prototype”, and “synthetic preview” copy in global navigation and routine panel headings with one restrained, persistent workshop-data indicator.
- [ ] Preserve data provenance at the point it matters: mark synthetic records in record/source details, and keep a concise disclosure on screens showing synthetic soil readings, recommendations, people, inventory, or orders.
- [ ] Clearly distinguish workshop examples from actual farmer, laboratory, provider, and dealer data. Do not label seeded values as verified, measured, or live.
- [ ] Keep a short, visible caveat wherever recommendations appear: workshop guidance is illustrative and is not agronomic advice.
- [ ] Ensure error, empty, loading, and offline states do not turn missing backend data into plausible-looking records or imply that a synthetic example was saved.

## 3. Deliver a Polished First Impression

- [ ] Add a concise welcome/entry page that explains SoilSync in plain language and gives visitors an obvious next action.
- [ ] Use consistent role names, page titles, button labels, navigation, spacing, typography, icon style, and status colors across all role areas.
- [ ] Remove development-facing language, placeholder content, dead links, duplicated labels, and controls that do not work in the workshop scenario.
- [ ] Give each role view a useful initial state with representative workshop content, clear priorities, and at least one demonstrable action.
- [ ] Make responsive layouts usable on projector/laptop and mobile-sized screens; verify contrast, visible keyboard focus, keyboard navigation, and accessible names.
- [ ] Keep the theme control and other shared navigation consistent, predictable, and unobtrusive.

## 4. Make the Workshop Reliable

- [ ] Provide a repeatable, isolated workshop dataset and a one-step way to load/reset it without connecting to or modifying a production database.
- [ ] Make all planned workshop scenarios available even when external providers or a hosted database are offline; show a clear connection state instead of silently substituting records.
- [ ] Verify the farmer, extension-officer, agrodealer, and admin journeys from their own entry destinations using only explicitly synthetic accounts and records.
- [ ] Test role-specific direct links, reloads, back navigation, denied access, and the transition between public workshop examples and authenticated portals.
- [ ] Add a presenter run-through covering the intended path, expected data labels, reset/recovery steps, and a fallback if a service is unavailable.

## 5. Workshop Acceptance

- [ ] A first-time visitor can identify how to enter each role area without seeing four role controls embedded in every workspace.
- [ ] Each role has a distinct URL, layout/navigation context, and relevant actions; refreshing the URL keeps the visitor in that role area.
- [ ] The app looks like one cohesive product rather than a demo dashboard, while a visitor can still tell which records are synthetic.
- [ ] No synthetic record, recommendation, login, save, provider status, or marketplace action is represented as real or verified.
- [ ] The complete workshop walkthrough succeeds with the backend available and with it unavailable, using the documented behavior for each case.
- [ ] Frontend tests cover entry navigation, role destinations, synthetic-data disclosures, direct-link/reload behavior, and workshop fallback states.
