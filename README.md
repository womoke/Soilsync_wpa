# SoilSync AI

SoilSync AI is an installable PWA prototype for farmer soil records and agronomic guidance. The demo reading is synthetic. The demo recommendation endpoint currently derives provisional comparison benchmarks from aggregate values in the project-provided CSV; it does not return source rows and is not a trained or validated model. Its comparisons are not location-, depth-, or method-specific and are not farmer-ready fertilizer advice.

## Local Development

Requirements: Python 3.14.2, Node.js 24, and npm 11 are the versions currently verified in this workspace. The frontend lockfile records the installed frontend dependency versions.

### Secure local staging setup

Generate a trusted localhost certificate for the staging app and then run Vite in HTTPS mode:

```powershell
Push-Location .\frontend
npm run cert:generate
npm run dev:staging
```

This serves the app on `https://localhost:5173/` and uses a self-signed certificate stored in `frontend/certs/localhost-cert.pem`. The first run may require trusting the certificate in the current Windows user store.

```powershell
powershell.exe -ExecutionPolicy Bypass -Command "& { certutil -user -addstore Root '.\frontend\certs\localhost-cert.pem' }"
```

Install the backend once, from the workspace root:

```powershell
python -m venv .venv
Push-Location .\backend
..\.venv\Scripts\python.exe -m pip install -e ".[dev]"
Pop-Location
```

Start the API in one terminal:

```powershell
Push-Location .\backend
..\.venv\Scripts\python.exe -m uvicorn app.main:app --reload --host 127.0.0.1 --port 8000
```

Start the frontend in another terminal; Vite proxies `/api` to the local API:

```powershell
Push-Location .\frontend
npm install
npm run dev
```

The API exposes `GET /health` and `GET /api/v1/demo/soil-reading`. The demo response is marked `DEMO`, contains synthetic illustrative measurements, and must never be presented as a laboratory result.

Frontend checks, run from `frontend/`:

```powershell
npm test
npm run lint
npm run format:check
npm run build
```

Backend checks, run from `backend/`:

```powershell
..\.venv\Scripts\python.exe -m pytest
..\.venv\Scripts\python.exe -m ruff check .
```

## Unclaimed Farmer Account Lifecycle

Configure Supabase Auth SMTP delivery and set `FARMER_CLAIM_REDIRECT_URL` to the deployed app's `/reset-password?claim=1` URL. Add that exact URL to the Supabase Auth redirect allow-list. Reminder emails use Supabase's password-recovery email template; following the secure recovery link lets the farmer set a password and claim the account.

The GitHub Actions workflow `.github/workflows/unclaimed-account-lifecycle.yml` runs hourly and invokes both the reminder and Day-7 cleanup jobs. Configure repository secrets `SOILSYNC_API_URL` (the deployed API base URL) and `UNCLAIMED_LIFECYCLE_JOB_TOKEN`. Set the same strong random token as `UNCLAIMED_LIFECYCLE_JOB_TOKEN` in the API environment. The jobs also remain available to admins through the API; a failed Supabase Auth email request returns an error and does not increment the reminder count or create an in-app reminder. This confirms Auth accepted the send request, not final inbox delivery.

## Data Audit

From the workspace root, regenerate the aggregate-only source profile with:

```powershell
python .\scripts\audit_soil_csv.py --output .\DATA_AUDIT.md
```

The source CSV is intentionally excluded from Git. Prototype use is assumed by the project owner; this is not a public-license finding or supplier attribution. Do not expose raw records or enable production storage/redistribution until applicable terms and restrictions are documented internally. See [DATA_AUDIT.md](DATA_AUDIT.md) and [IMPLEMENTATION_ROADMAP.md](IMPLEMENTATION_ROADMAP.md).

## Current Status

- Farmer overview, theme preference, API loading/fallback states, and local-only reading preview are implemented in the frontend.
- Versioned soil-reading and recommendation interfaces are defined in `frontend/src/types/soil.ts`; the API validates and serves a matching synthetic record.
- The FastAPI service now exposes health and config routes, versioned endpoints, and request validation for preview submissions while keeping the app in synthetic demo mode.
- A repeatable import summary command for the project-provided soil CSV is available in the backend ingestion utility; it audits numeric validity, county coverage, and row acceptance without storing or exposing source values.
- Persistent farmer records, PWA service worker/install manifest, and external soil-data adapters are still not implemented yet.
- Recommendation thresholds and rates remain pending qualified agronomic review.