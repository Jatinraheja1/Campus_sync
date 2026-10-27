# CampusSync — Smart Campus Management with AI Scheduling

React + TypeScript + Vite + React Router. Builds on the v2 role-based app (Student / Teacher / Administrator).

## Install and run
```
npm install     # also copies the face model files into public/models (postinstall)
npm run dev
```
Open http://localhost:5173 (camera access works on `localhost` or HTTPS only).


## CampusSync AI features

### Admin: AI Timetable & Recovery Center
- **Generate timetable:** enter class group, section, subject, teacher, sessions per week, duration and room. The constraint solver schedules Monday–Friday between 09:00 and 17:00 (12:00–13:00 lunch break).
- **Replace previewed section only:** existing slots for the requested class group + section are replaced only after the admin approves. Other active timetable entries remain fixed.
- **Independent validation:** checks teacher, section and room overlaps before a preview can be applied.
- **Minimum-disruption recovery:** simulate a teacher absence (choose a qualified substitute) or room outage (enter an available replacement room). The system finds a valid plan, shows before/after changes, and applies only after confirmation.
- If constraints cannot be satisfied, the API returns an error rather than applying an invalid timetable.

### Role-based CampusSync Assistant
The floating **Ask AI** assistant appears on signed-in dashboards:
- Students can ask about their own timetable and recorded attendance.
- Teachers can ask about their timetable and assigned-subject attendance summary.
- Admins can ask about schedule validation and system-level counts.
- The server scopes retrieved data by the authenticated role. Chat requests never change timetable data.

The assistant uses a safe, grounded local response mode by default. To enable natural-language LLM responses, set `OPENAI_API_KEY` in `server/.env` and optionally set `OPENAI_MODEL` (default `gpt-4o-mini`). Keep the key on the server only; never put it in frontend `.env`. Scheduling, validation and recovery do not require an LLM API key.

### Test the new scheduling logic
```powershell
npm run api:test
node --test server/tests/ai.test.js
npm run build
```

Scheduling assumptions/limits: the current generator uses a fixed weekday/time grid, does not yet maintain a separate room inventory or per-teacher availability calendar, and treats other existing timetable slots as fixed. The recovery tool asks the admin to select a qualified substitute or provide a replacement room. These assumptions are explicit in the UI and can be expanded as more scheduling data is added.


Demo logins (frontend-only, NOT secure): student@demo.com / Student123, teacher@demo.com / Teacher123, admin@demo.com / Admin123.

## What is new
**Administrator: Face enrollment** (bottom of the admin dashboard)
- Pick an existing student (no new accounts), tick the consent box, capture or upload a face photo, save sample.
- Exactly one clear face is required (size, detection confidence and sharpness are checked). Up to 3 samples per student.
- Only a 128-number face descriptor is stored (IndexedDB). The photo is discarded immediately.
- Status per student, add sample, and delete enrollment (with confirmation). Consent time and recording staff member are stored.

**Teacher: Capture whole class** (first tab on the teacher dashboard; manual marking is still available)
1. Choose Class, Section, Subject and Attendance date. Start the camera (or upload a photo) and capture the class.
2. **Recognize students**: faces are detected (SSD MobileNetV1), aligned (68 landmarks) and turned into descriptors
   (FaceRecognitionNet). Descriptors are compared with enrolled students of the selected section by Euclidean distance.
3. Each face becomes **Matched**, **Needs Review** (too small, blurry, low confidence, weak, ambiguous between two
   students, or the same student matched twice) or **Unrecognized**. Students without a face are **Not Detected — Unconfirmed**.
4. Review: reassign any face to the right student, then mark each student Present or Absent. Nothing is saved until you press
   **Save confirmed records**. Students you do not mark are left unrecorded (never auto-absent).
5. Records are saved as **Pending Sync**. Duplicates (same student + subject + date) are skipped.

**Student:** read-only personal history with Present / Absent (confirmed) / sync status, subject, section and date.

## Offline behaviour
- Models are plain files in `public/models`, loaded from the app's own origin. Detection and matching run in the browser
  (TensorFlow.js, WebGL with CPU fallback). No cloud recognition API is used.
- Enrollments (IndexedDB) and attendance (localStorage) persist across refresh.
- `public/sw.js` (registered in production builds) caches the app and models after one online visit. For a fully offline
  demo: `npm run build && npm run preview`, open it once online, then go offline.
  With `npm run dev` the app works offline as long as the dev server on your own machine is running.

## Synchronization (honest status)
Records always start as **Pending Sync**; a record becomes **Synced** only after the sync step succeeds.
- **No backend configured (default):** sync is a clearly labelled frontend simulation. It uploads nothing.
- **Backend configured:** copy `.env.example` to `.env` and set `VITE_API_URL=https://your-server/api`. Sync then does
  `POST {VITE_API_URL}/attendance` per record with header `Idempotency-Key: <record id>` and the record JSON as body.
  HTTP 2xx or 409 (already stored) = Synced; anything else = Sync Failed, the record is kept and can be retried.
  Sync also runs automatically when the connection returns. Add auth headers in `src/lib/api.ts`.

## Limitations and responsibilities
- The model is a general-purpose, browser-sized network. Accuracy drops with small/distant faces, angles, masks, shadows
  and blur. Large photos are scanned in overlapping regions, which is slower on weak devices. Similar-looking people can be
  confused, so ambiguous cases are flagged, never guessed. Match score is (1 - distance), not a probability.
  Thresholds are in `src/lib/recognition.ts` (strictness slider default 0.5) and need tuning with your camera and classroom.
- Face data is biometric personal data. Get informed consent and college/legal authorization first.
- IndexedDB/localStorage are not secure storage; any teacher browser using face matching holds the enrolled descriptors.
  A production system should keep descriptors server-side (encrypted, access-controlled, audited) and match there or ship
  only the section roster's templates to the device. Sign-in here is frontend-only and not secure.

## Test with your own faces
The sample students are fictional. Edit `STUDENTS` in `src/lib/users.ts` (keep ids/sections consistent) or enroll your own
face under a sample student for testing, then capture or upload a photo that contains that face.

## Structure (new or changed files)
```
src/lib/face.ts            model loading, detection, thumbnails, sharpness
src/lib/recognition.ts     matching + Matched / Needs Review / Unrecognized logic
src/lib/faceStore.ts       IndexedDB enrollments
src/lib/api.ts             backend integration point
src/components/CameraCapture.tsx, ClassCapturePanel.tsx, FaceEnrollmentPanel.tsx
src/context/AttendanceContext.tsx   shared records, duplicate prevention, sync
scripts/copy-models.mjs, public/sw.js
```


## Attendance analytics (added in this version)
**Student:** Attendance Overview (overall %, classes conducted / attended / missed, number of subjects) at the top, then Subject-Wise Attendance (table with progress bars, stacks into cards on phones) and a filterable history (subject, date range, current semester).
**Teacher:** new "Class sessions" tab: pick section, subject and date, see the session state, **Finalize** or **Cancel** it, see classes conducted and each student's attended / conducted / %. "Mark manually" now also has **Mark absent**.
**Administrator:** "Attendance analytics settings" (minimum attendance %, semester dates, student enrollment dates), then section, subject-wise and per-student summaries and an individual student report.

### Formulas
- Subject % = attended in subject / conducted in subject x 100
- Overall % = SUM(attended) / SUM(conducted) x 100 over the subjects (weighted, never the average of subject percentages: 9/10 and 20/30 gives 29/40 = 72.50%, not 78.33%)
- Missed = confirmed Absent records. Zero classes shows "No attendance data available" / "No classes yet" (no division by zero). Percentages are shown with 2 decimals.

### What counts (rules)
- A **class session** = one section + subject + date, with a deterministic id `SES-{section}-{subject}-{date}`; a second one cannot exist (retries and other devices map to the same id).
- Teachers save records into a draft session. **Finalize** needs every enrolled student marked Present or Absent, then locks the session. Finalizing is the only thing that makes a class "conducted"; edits and sync retries never add one.
- A session counts only when it is finalized, **not cancelled**, the session is **Synced** and **all its records are Synced**. Pending / failed records and unfinalized drafts are shown in history as "Pending. Not counted" but never counted.
- Students are counted only for sessions on or after their enrollment date (admin setting; empty = from the first class).
- The minimum attendance is configured by the administrator; if empty, no warning is shown. Warnings are text + icon, not just colour.

### Data and sync
Attendance is stored under `smartattend.attendance.v3` (`records` + `sessions`). Data saved by the previous version is migrated automatically: a legacy session is finalized only if every student of that section has a record, otherwise it stays an uncounted draft. "Reset demo data" (admin) restores sample history (8 classes per subject and section, one cancelled, one late joiner). Sessions sync after their records: `POST {VITE_API_URL}/sessions` with `Idempotency-Key: <session id>`.
**There is no real backend by default**, so analytics are based on local prototype data in this browser and are not shared across devices (a note says so on every analytics screen).

### Tests
`npm test` (Node 22.6+) runs `tests/analytics.test.ts`: percentages, weighting, cancelled / pending exclusion, duplicate delivery, filters, zero classes, late joiners, thresholds, finalize rules.


## Optional PostgreSQL backend (added)

The browser-only mode remains available when `VITE_API_URL` is blank. To enable real backend authentication and attendance/session synchronization, use the Express API in `server/`.

### Quick start (Windows PowerShell)
1. Install PostgreSQL and create an empty database named `campussync`.
2. In `server/`, copy `.env.example` to `.env`, set `DATABASE_URL`, and set `JWT_SECRET` to a random secret of at least 32 characters.
3. From the project root run:
   ```powershell
   npm install
   npm run api:install
   npm run api:migrate
   npm run api:seed
   ```
4. Set `VITE_API_URL=http://localhost:4000` in the root `.env` file.
5. In one terminal run `npm run api:dev`; in another run `npm run dev`.
6. Open `http://localhost:5173`. Backend mode checks login against PostgreSQL. Demo accounts are seeded by the script.

The API currently provides secure login/current-user routes, health/database status, authorized attendance and session synchronization, student roster listing for teacher/admin, assigned subject listing, personal/role-filtered attendance reads, and attendance summary reports. It is a focused backend integration for the supplied app, not yet a full replacement of every local dashboard data source. Read `PROJECT_SETUP.md`, `API_DOCUMENTATION.md`, and `TEST_REPORT.md` before presenting it as production-ready.


## Security and admin improvements in this build
- Server-side pagination and filters for the user directory.
- Admin audit-log viewer with search, action filter, event details, and pagination.
- Passwords are hashed with bcrypt; new account and reset passwords require at least 12 characters.
- Admin password reset for other active users without a repeated forced-change prompt.
- Existing installations use migration 004 to clear stale forced-password-change flags.
- Updated responsive indigo/slate UI styling.

For setup and migration instructions, see `PROJECT_SETUP.md`. Never distribute `.env` files or use demo credentials in a public deployment.


## Recent enhancements

- Admin-managed teacher timetable slots with subject assignment, overlap checks, edit/remove controls, and audit events.
- Backend teacher workspace that reads the assigned timetable and active roster before marking attendance.
- Admin attendance history is available through a dedicated dashboard shortcut and supports server-side search and pagination.
- Repeated forced password-change prompts are disabled by migration `004_disable_repeated_password_prompt.sql`; password hashes, authenticated routes and admin reset controls remain.
- Admin analytics, attendance history and audit logs are hidden until opened from their dedicated shortcuts.

After applying this version to an existing installation, run `npm run api:migrate` once to apply migration 004.
