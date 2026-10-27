# CampusSync setup guide

## Requirements
- Windows 10/11, Node.js 22+ (tested in this environment: Node 22.16.0; the frontend test script uses Node type stripping), npm.
- PostgreSQL 14+ running locally or a reachable PostgreSQL instance.
- Browser camera access requires `localhost` or HTTPS.
- The face recognition model files are copied from `@vladmandic/face-api` during install/postinstall. If install cannot download packages, camera recognition models will not be available.

## Frontend-only demo mode
1. Open PowerShell in the project root.
2. Run `npm install`.
3. Run `npm run dev`.
4. Open `http://localhost:5173`.
5. The frontend-only demo accounts are shown on the login page / in `src/lib/users.ts`. In this mode, attendance sync is explicitly simulated and not stored in a shared database.

## PostgreSQL backend mode
1. Install/start PostgreSQL and create a database:
   ```sql
   CREATE DATABASE campussync;
   ```
2. Copy backend environment template:
   ```powershell
   Copy-Item server\.env.example server\.env
   ```
3. Edit `server\.env` and set `DATABASE_URL`, `JWT_SECRET` (32+ characters), and optionally `CORS_ORIGIN`. Example:
   `DATABASE_URL=postgresql://postgres:YOUR_PASSWORD@localhost:5432/campussync`
4. Install both dependency sets:
   ```powershell
   npm install
   npm run api:install
   ```
5. Apply migrations and seed demo users/roster:
   ```powershell
   npm run api:migrate
   npm run api:seed
   ```
   Migrations are versioned and are not destructive; do not use a demo database for real personal data.
6. Copy root `.env.example` to `.env`, then set:
   `VITE_API_URL=http://localhost:4000`
7. Start the API in terminal 1:
   ```powershell
   npm run api:dev
   ```
8. Start the frontend in terminal 2:
   ```powershell
   npm run dev
   ```
9. Verify API health at `http://localhost:4000/health`; a healthy response includes `"status":"ok"` and `"database":"connected"`.
10. Login uses server-side bcrypt password verification and a short-lived JWT. On the first backend migration, the bundled demo accounts require a password change. Sign in using the temporary demo credentials below, then choose a private password of at least 12 characters before continuing. The seeded demo credentials are:
    - Student: `student@demo.com` / `Student123`
    - Teacher: `teacher@demo.com` / `Teacher123`
    - Admin: `admin@demo.com` / `Admin123`

The seed script creates only the demo login accounts above. Other seeded roster students and the second teacher have no documented usable login password.

## Tests
- Frontend: `npm test`
- Frontend production build: `npm run build`
- Backend static/schema checks: `npm run api:test`
- Backend migration: `npm run api:migrate` (requires running PostgreSQL).
- Backend seed: `npm run api:seed` (requires migrations and running PostgreSQL).

## Security and deployment
- Never commit `.env` files or real credentials. `.env.example` contains placeholders only.
- Use a strong private `JWT_SECRET`; keep PostgreSQL off public networks unless appropriately secured.
- Set `CORS_ORIGIN` to the exact frontend origin(s).
- Use HTTPS in deployed environments. Browser face templates are still stored in IndexedDB on the device; they are not uploaded to the backend or encrypted by this implementation.
- Demo seed passwords are for local demonstration only and must be changed before any real deployment.
- The backend currently persists attendance records/sessions, but other dashboard features (fees, feedback submission, biometric enrollment) remain local or not fully integrated. No real payment gateway or liveness detection is included.

## Windows quick start
1. Install Node.js 22+ and PostgreSQL 14+.
2. Double-click `SETUP_WINDOWS.bat` (first run needs internet access to download npm dependencies).
3. Edit `server\.env` with your PostgreSQL connection and a private 32+ character `JWT_SECRET`.
4. In PowerShell from the project folder, run `npm run api:migrate` and `npm run api:seed`.
5. Edit root `.env` and set `VITE_API_URL=http://localhost:4000`.
6. Double-click `START_CAMPUSSYNC.bat`.

## Added security and administration features
- User directory is server-paginated (10 accounts per page), with server-side search, role and active-status filters.
- New accounts can sign in with the password set by the administrator. Admins can reset another active account password; the new password is stored as a bcrypt hash. Passwords are never stored in plaintext.
- Admins can view a searchable, filterable, paginated audit trail from the database. Password values are never written to audit events.
- A new versioned migration adds the password-change flag and audit indexes. Run `npm run api:migrate` once after updating; do not manually edit the database schema.
- The refreshed interface uses a modern indigo/slate visual theme and responsive user/audit panels.

## Added feature: Smart Risk Radar
The admin and teacher dashboards include a Risk Radar panel when the backend is enabled. It queries stored attendance and lists students below 75%, with counts and subject context. It is an early-warning indicator, not an automated disciplinary decision. Demo seeding inserts a small, clearly fictional history to demonstrate the query. The report can be queried directly at `GET /reports/risk-radar`.

Additional backend endpoints include admin user directory/create/deactivate/update, subject creation, timetable reads/upserts, student fee reads/admin fee recording, feedback submission/aggregates, notifications, and face-consent metadata. Fee recording is not payment processing. Consent metadata does not upload or store biometric templates.


## Enable the database-backed student manager
1. In the project root, copy `.env.example` to `.env`.
2. Ensure the root `.env` contains `VITE_API_URL=http://localhost:4000`. This is separate from `server/.env`, which contains `DATABASE_URL` and `JWT_SECRET`.
3. Restart the frontend (`npm run dev`) after changing `.env`.
4. Sign in with an active administrator account and open **Student Management** on the Admin dashboard.
5. Open **User Management** to create, edit, disable/reactivate, and reset accounts for students, teachers, and admins. Share the initial password privately and use a strong, unique password. Use the **Audit log viewer** shortcut to review system events.

Student-management endpoints require an administrator bearer token. Disabling is a soft delete to preserve attendance and fee history. The seed script has been adjusted so rerunning it does not reset or reactivate an existing demo login.


## Enhanced admin timetable and password behavior

- After updating the project, run `npm run api:migrate`. Migration `004_disable_repeated_password_prompt.sql` clears stale forced-password-change flags for existing accounts. New accounts and admin password resets no longer force a password-change screen. Passwords remain hashed with bcrypt; use strong, unique passwords and share them privately.
- In the Admin dashboard, use **Teacher timetable & class assignment** to select an active teacher, choose or create a subject, then set class/group, section, weekday, start/end time and room. Saving a slot assigns that subject to the teacher in the database. Overlapping time slots for the same teacher or class/section are rejected.
- Teachers in backend mode see their saved weekly timetable and can mark attendance for active students matching the slot's class/group and section. Attendance is queued locally first; use **Synchronization** to upload records. The Admin **Attendance history** button reads paginated records from PostgreSQL.
- Attendance analytics and Risk Radar are retained from the original project and currently use its browser-side attendance model; the separate Attendance history view is the database-backed record viewer.
