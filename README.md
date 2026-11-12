# Backend
First run: `cp backend/.env.example backend/.env` and set `PDP_DATABASE_URL` and `PDP_JWT_SECRET`.

MacOS:`source .venv/bin/activate && uvicorn app.main:app --reload`

Windows: `.\.venv\Scripts\Activate.ps1 && uvicorn app.main:app --reload`

# Frontend
`npm run dev`

# Signing in (PDP-251)
Every page and API needs a signed-in user. A fresh database seeds one Super Admin (every permission):
`admin@solutionadvisor.com.au` with the first-use password from `PDP_BOOTSTRAP_SUPERADMIN_PASSWORD`
(see `backend/app/config.py`). It must change its password on first sign-in; after that,
invite other users from Admin > Users. The platform sends no email: an invitation or
password-reset link is shown to the administrator once, to pass on by hand, and expires
(`PDP_INVITATION_DAYS`, `PDP_PASSWORD_RESET_HOURS`).

# Tests
Backend: `cd backend && PDP_DATABASE_URL=postgresql://postgres:password@localhost:5433/pdp_test pytest`

Frontend smoke (needs the backend on :8000):
`cd frontend && PDP_SMOKE_EMAIL=<admin account> PDP_SMOKE_PASSWORD=<its password> npm run test:smoke`
The account must hold the Admin role and must not be waiting on a first-use password change.
