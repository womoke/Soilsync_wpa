# Authentication flow notes

## Current flow

1. The frontend creates a Supabase Auth client using `VITE_SUPABASE_URL` and
   `VITE_SUPABASE_ANON_KEY`. The client uses PKCE, automatic token refresh,
   callback detection, and does not persist sessions across browser restarts.
2. Email/password sign-in, public sign-up, password recovery, password changes,
   and invite acceptance are initiated from the frontend with Supabase Auth.
   Recovery and invitation links return to `/reset-password`.
3. After a user signs in, the frontend sends the Supabase access token to
   `POST /api/v1/auth/link`. The backend validates the token and verified
   identity, links that identity to the app profile and roles, and returns an
   active application role. The frontend routes the user to that role's
   workspace. Users without an active role are not routed into a workspace.
4. For administrator-provisioned accounts, the backend creates a Supabase Auth
   invitation and records the app-side invitation and preassigned role. The
   invitee follows the email link, chooses a password, and the frontend calls
   `POST /api/v1/auth/invitations/activate` to activate the invitation and role.
5. Password recovery calls Supabase's `resetPasswordForEmail`; setting a new
   password calls `updateUser`. Farmer claim emails also use Supabase Auth's
   reset-password email flow, with a separate claim callback.

## Email delivery boundary

The repository does not implement Gmail or Resend as an email sender.
Authentication and invitation emails are requested through Supabase Auth;
delivery-provider credentials/configuration belong to the Supabase project.
The local `supabase/config.toml` SMTP section is commented example
configuration, so it does not establish which SMTP provider the deployed
project currently uses. Backend invitation links use
`AUTH_INVITE_REDIRECT_URL`; farmer claim links use
`FARMER_CLAIM_REDIRECT_URL`.

## Issue to verify

The admin resend-invitation endpoint currently updates the recorded invitation
timestamp and audit log and returns a successful "resent" result, but the
implementation shown in `backend/app/database.py` does not send another
Supabase Auth email. The frontend therefore may report success without an
email being sent. Confirm this behavior in testing before changing it.

## Testing checkpoint

Understanding recorded before running authentication tests or changing
authentication behavior.

- Frontend: `AuthEntry`, `AuthContext`, and auth API tests passed (26 tests).
- Backend: identity lifecycle tests passed (14 tests).
- These automated tests do not verify delivery through the deployed email
  provider. A live email delivery check requires access to the configured
  Supabase project and its SMTP/provider settings; those settings are not
  present in this repository.

## Password reset failure and fix

The frontend uses Supabase PKCE and requests password reset links from the
browser. Supabase's PKCE callback needs the code verifier created when the
reset was requested; the verifier must be available in the same browser/device
when the email link is opened. The client had `persistSession: false`, which
prevented the verifier from surviving a page reload or the return from email.
The client now persists auth state so the PKCE callback can exchange the code
for a recovery session. Password setup/reset also requires a matching
confirmation password. Both account-registration surfaces—the shared auth
screen and the farmer workspace—also require matching password confirmation.
Password-only fields in admin/staff sign-in and admin re-authentication are
login verification fields, not new-password forms.

Focused password reset and PKCE tests pass (15 tests), and the frontend
production build succeeds. After deploying this change, request a fresh
password reset email and open its link in the same browser profile/device in
which the request was made; older links may not have a saved verifier.

The user subsequently reported that a reset worked in a new browser session.
After submitting the new password, the form clears and the app routes to the
authenticated workspace after a short delay. This matches the current flow:
the frontend updates the password, then verifies/links the Supabase session
with the backend and routes using the returned application role. This live
result is user-reported, not independently observed in the browser.

## Admin account deletion

The admin user-management action now permanently deletes the selected account
instead of suspending it. The admin must re-authenticate and type the account's
email to confirm. The backend prevents self-deletion and deletion of the last
active admin, disables app access first, deletes the Supabase Auth identity,
anonymizes audit-history references/details, and then deletes the application
user and its cascading linked data.

Apply `backend/database/migrations/031_permanent_user_deletion.sql` before
deploying the backend. It permits the deleted user's audit references to be
anonymized (including both the app-user and Supabase Auth IDs) while keeping
the audit log append-only for other updates/deletes, and changes the
unclaimed-account officer reference so it cannot block a permanent deletion.
If Supabase Auth deletion fails after app access is disabled, the endpoint
reports a retryable error; a later retry completes the cleanup. The backend
and frontend tests pass, but the migration still needs to be applied and
verified against the deployed PostgreSQL database.
