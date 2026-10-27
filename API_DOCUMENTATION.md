# API documentation

Base URL for local development: `http://localhost:4000`. JSON is used for requests and responses. Protected endpoints require `Authorization: Bearer <JWT>`. Tokens expire after 8 hours. `VITE_API_URL` should contain the base URL, with no `/api` suffix.

| Method | Endpoint | Auth | Purpose |
|---|---|---|---|
| GET | `/health` | Public | API and PostgreSQL health check |
| POST | `/auth/login` | Public, rate-limited | Verify `{ role, identifier, password }`; returns `{ token, user }` |
| GET | `/auth/me` | Any signed-in user | Return current user |
| POST | `/auth/logout` | Any signed-in user | Client should discard its token; server returns 204 |
| POST | `/attendance` | Teacher/Admin | Store one confirmed attendance record; duplicate returns 409 |
| POST | `/sessions` | Teacher/Admin | Store/update one deterministic class session; duplicate/locked session returns 409 |
| GET | `/attendance/me` | Any signed-in user | Student's own history, teacher's assigned-subject history, or admin history |
| GET | `/students?section=A&search=Rahul&limit=50&offset=0` | Teacher/Admin | Search roster |
| GET | `/subjects` | Any signed-in user | Subjects; teacher sees assigned subjects only |
| GET | `/reports/attendance?subjectId=CS101&section=A&from=2026-01-01&to=2026-12-31` | Teacher/Admin | Recorded Present/Absent aggregate report |

## Attendance request
`POST /attendance` accepts the current frontend `AttendanceRecord` shape:
```json
{
  "id": "REC-unique-id",
  "studentId": "STU001",
  "studentName": "Rahul Sharma",
  "classId": "CS101",
  "className": "Data Structures",
  "classGroup": "B.Tech CSE, Year 2",
  "section": "A",
  "date": "2026-10-13",
  "timestamp": "2026-10-13T09:30:00.000Z",
  "markedBy": "Dr. Anita Rao",
  "attendance": "Present",
  "source": "manual",
  "status": "Pending Sync",
  "sessionId": "SES-A-CS101-2026-10-13"
}
```
`matchScore` is optional and must be between 0 and 1. The server checks the authenticated teacher's subject assignment, student existence and section, and database uniqueness. The server stores the authenticated teacher's name rather than trusting `markedBy`.

## Session request
`POST /sessions` accepts the current frontend `ClassSession` shape: `id`, `classGroup`, `section`, `subjectId`, `date`, `status`, `syncStatus`, `createdAt`, and optional `finalizedAt`, `finalizedBy`, `cancelledAt`. The server records the authenticated user's name as `finalized_by`. An initial attendance record can create a scheduled session; the subsequent session sync updates that scheduled row. Existing locked sessions are not overwritten.

## Error behavior
- `400`: invalid input or invalid filters.
- `401`: missing/invalid/expired token.
- `403`: insufficient role or teacher not assigned to subject / section mismatch.
- `404`: unknown route.
- `409`: duplicate record or already-created/locked session.
- `500`: generic server error; private error details are logged server-side only.

## Current scope
This API does not yet expose full CRUD endpoints for all admin pages, fee/payment processing, feedback submission, notifications, face enrollment, or server-side biometric matching. Face matching stays in the existing browser code and still requires teacher review before marking attendance. Do not treat a recorded fee as a processed payment.

## Additional routes

| Method | Endpoint | Access | Purpose |
|---|---|---|---|
| GET | `/admin/users?role=&search=&limit=&offset=` | Admin | Search/paginate users |
| POST | `/admin/users` | Admin | Create user and student/teacher profile; password min 12 chars |
| PATCH | `/admin/users/:id` | Admin | Update name/email or deactivate account |
| POST | `/admin/subjects` | Admin | Create subject and optional teacher assignment |
| GET | `/timetable?section=` | Authenticated | Read permitted timetable entries |
| POST | `/timetable` | Admin | Create/update timetable entry |
| GET | `/fees/me` | Student/Admin | Read own fees or admin fee ledger |
| POST | `/fees` | Admin | Record fee status (not a real payment) |
| POST | `/feedback` | Student | Submit 1–5 rating and comments |
| GET | `/feedback/analytics?teacherId=` | Teacher/Admin | Aggregated rating statistics |
| GET | `/notifications` | Authenticated | Read own notifications |
| POST | `/notifications` | Admin | Send a notification to a user |
| PATCH | `/notifications/:id/read` | Authenticated | Mark own notification read |
| POST | `/face-enrollment/consent` | Student | Grant/revoke consent metadata; no biometric template upload |
| GET | `/face-enrollment/status` | Student/Admin | Read enrollment consent metadata |
| GET | `/reports/risk-radar?subjectId=` | Teacher/Admin | Attendance-risk report for below-75% records |

JSON validation errors return HTTP 400; unauthenticated calls return 401; forbidden role/ownership access returns 403; conflicts such as duplicate attendance return 409. All routes require the API's configured JWT except `/health` and `/auth/login`.


## Administrator student management
All routes below require a valid bearer token for an `admin` user.

- `GET /admin/students` — list active students. Add `?includeInactive=true` to include disabled accounts.
- `POST /admin/students` — create a student using `{ "id", "name", "email", "section", "classGroup", "password" }`. Passwords are hashed on the server.
- `PATCH /admin/students/:id` — update `name`, `email`, `section`, `classGroup`, or `active`.
- `DELETE /admin/students/:id` — disable sign-in without deleting the student row or related attendance/fee/feedback history.

Student changes are written to the audit log. Copy `.env.example` to `.env` at the project root and set `VITE_API_URL=http://localhost:4000` for the frontend to use these routes; restart Vite after changing it.

## Enhanced timetable and attendance history endpoints

### `POST /admin/timetable` (admin only)
Creates or updates a weekly timetable slot and ensures the selected teacher is assigned to the subject. Body fields: `id`, `classGroup`, `section`, `subjectId`, optional `subjectName` when creating a subject, `teacherId`, `weekday` (0=Sunday through 6=Saturday), `startsAt`, `endsAt`, and optional `room`. Conflicting time slots for the same teacher or class/section are rejected.

### `DELETE /admin/timetable/:id` (admin only)
Soft-disables a timetable slot and records the change in the audit log. Existing attendance records are retained.

### `GET /admin/attendance` (admin only)
Returns database-backed attendance history with optional `search`, `limit` (1–100) and `offset` parameters. The response includes `records`, `total`, `limit` and `offset` for pagination. Search matches student, student ID, subject or teacher.

Teachers can fetch their active assigned schedule through `GET /timetable`; in backend mode the teacher dashboard uses those slots and active students from `GET /students` for manual attendance. The server rejects teacher attendance uploads that do not match an active timetable assignment for the same subject, class group and section.
