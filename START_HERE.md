# CampusSync enhanced project — start here

## Before starting
1. Install Node.js 22 or newer and PostgreSQL.
2. Copy `.env.example` to `.env` in this folder.
3. Copy `server/.env.example` to `server/.env` and set the real PostgreSQL password/database name plus a private random `JWT_SECRET` (32+ characters).
4. Keep `.env` files private; do not upload them or send them in chat.

## Install and run
Open PowerShell in this folder (the folder containing `package.json`):

```powershell
npm install
npm run api:install
npm run api:migrate
```

Run the API and frontend in separate terminals:

```powershell
npm run api:dev
```

```powershell
npm run dev
```

Open the local URL printed by Vite (normally `http://localhost:5173`). For a fresh demo database only, run `npm run api:seed` after migrations. Do not reseed an existing database unless you specifically want demo data.

## Set up a teacher's timetable
1. Sign in as admin.
2. Create an active teacher in **User Management** if one does not exist.
3. In **Teacher timetable & class assignment**, choose that teacher, choose an existing subject or create a new one, then enter class/group, section, weekday, start/end time and room.
4. Save the slot. It assigns the subject to the teacher and appears in the teacher's weekly timetable.
5. Create students with the same class/group and section values. The teacher's manual attendance roster is filtered to that class and section.
6. Mark attendance and press **Sync pending items**. The server checks the teacher's active timetable assignment before accepting records.

## Password prompt change
Migration `004_disable_repeated_password_prompt.sql` clears old forced-password-change flags. New accounts and administrator password resets no longer force a password-renewal screen. Passwords remain bcrypt-hashed and require at least 12 characters. Share initial/reset passwords privately and use strong, unique values.

## Admin dashboard shortcuts
Attendance analytics, attendance history and audit logs are hidden by default and open through their dedicated buttons. Attendance history reads paginated records from PostgreSQL; the retained legacy analytics/risk radar uses the original browser-side attendance model.

## Honest test status
The backend JavaScript syntax check and automated source/contract tests pass in the packaging environment. The 14 existing analytics tests pass. Dependency installation timed out in this environment, so a complete Vite production build and live PostgreSQL end-to-end test could not be performed here. On your computer, verify with:

```powershell
npm run build
npm run api:test
```
