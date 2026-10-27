# CampusSync project analysis

## Phase 1 findings (inspected from the supplied ZIP)
- Root project directory: `smartattend/`.
- Frontend: React 18 + TypeScript + Vite 5, React Router 6, Lucide React.
- Existing pages: Landing, Login, StudentDashboard, TeacherDashboard, AdminDashboard, NotFound.
- Existing camera/face workflow: browser-side `@vladmandic/face-api`; descriptors are held in IndexedDB; matching/review logic is in `src/lib/recognition.ts`.
- Existing attendance state: `src/context/AttendanceContext.tsx` persists records and sessions to localStorage, with deterministic session IDs and duplicate checks. The existing UI uploads records to `POST /attendance` and sessions to `POST /sessions` when `VITE_API_URL` is configured.
- Existing login is frontend-only (`src/context/AuthContext.tsx`) and the README explicitly warns that it is not secure.
- No backend, PostgreSQL schema, migrations, lockfile, or preinstalled model files were present in the ZIP. `scripts/copy-models.mjs` copies model files from the npm dependency after install.
- Existing package scripts: `dev`, `build`, `preview`, `copy-models`, `postinstall`, `predev`, `prebuild`, `test`.
- Current backend integration contract is record/session sync only. The full student/teacher/admin dashboards and analytics remain primarily local prototype features.
- Environment: Node.js is available. PostgreSQL service availability and camera hardware/browser interaction cannot be assumed; those checks are recorded separately in the test report.

## Implementation plan
1. Add an Express + PostgreSQL backend with migrations, demo seed script, JWT authentication, role-aware access, validation, health endpoints, and idempotent attendance/session endpoints compatible with the current frontend contract.
2. Add optional server authentication to the existing login flow when `VITE_API_URL` is configured, preserving the offline/demo login when no backend is configured. Send the bearer token with attendance/session sync.
3. Add automated backend tests that can run without a live PostgreSQL service for validation and route behavior where possible; run frontend tests/build if dependencies can be installed.
4. Document setup, API contract, test evidence and limitations. Package the complete source in a new ZIP, excluding secrets, caches and `node_modules`.


## AI enhancement update
- Added admin-only APIs for timetable validation, generation preview/apply, and disruption recovery preview/apply.
- Added a role-authenticated `/ai/chat` endpoint; student and teacher data queries are scoped to their account/assignments, while admin context includes timetable validation and system counts.
- Added frontend `AIControlCenter` and `CampusChatbot` components.
- The AI scheduling implementation is a deterministic constraint solver rather than a free-form LLM. The optional LLM is used only for chat language generation, with data limited to the current role's retrieved context.
