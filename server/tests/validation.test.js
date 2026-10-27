import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
const migration = await readFile(new URL('../migrations/001_initial.sql', import.meta.url),'utf8');
const api = await readFile(new URL('../src/index.js', import.meta.url),'utf8');
test('schema contains unique attendance protection and referential integrity',()=>{
 assert.match(migration,/UNIQUE\(student_id, session_id\)/);
 assert.match(migration,/REFERENCES attendance_sessions\(id\)/);
 assert.match(migration,/CHECK \(attendance IN \('Present','Absent'\)\)/);
});
test('API validates records, requires authentication and restricts write roles',()=>{
 assert.match(api,/recordSchema=z\.object/);
 assert.match(api,/authenticate,allow\('teacher','admin'\)/);
 assert.match(api,/ON CONFLICT DO NOTHING RETURNING id/);
 assert.match(api,/Student section does not match attendance record/);
});
test('API has health, login, role-filtered subjects and report endpoints',()=>{
 assert.match(api,/app\.get\('\/health'/);
 assert.match(api,/app\.post\('\/auth\/login'/);
 assert.match(api,/app\.get\('\/subjects'/);
 assert.match(api,/app\.get\('\/reports\/attendance'/);
});
test('second migration includes timetable, notifications and consent metadata', async()=>{
 const extra = await readFile(new URL('../migrations/002_campus_features.sql', import.meta.url),'utf8');
 assert.match(extra,/CREATE TABLE IF NOT EXISTS timetable_entries/);
 assert.match(extra,/CREATE TABLE IF NOT EXISTS user_notifications/);
 assert.match(extra,/CREATE TABLE IF NOT EXISTS face_enrollment_consents/);
});
test('API exposes risk radar and protects admin/fee/feedback endpoints',()=>{
 assert.match(api,/app\.get\('\/reports\/risk-radar'/);
 assert.match(api,/app\.post\('\/admin\/users',authenticate,allow\('admin'\)/);
 assert.match(api,/app\.post\('\/fees',authenticate,allow\('admin'\)/);
 assert.match(api,/app\.post\('\/feedback',authenticate,allow\('student'\)/);
});

test('admin student management routes are protected and support soft disable',()=>{
 assert.match(api,/app\.get\('\/admin\/students',authenticate,allow\('admin'\)/);
 assert.match(api,/app\.post\('\/admin\/students',authenticate,allow\('admin'\)/);
 assert.match(api,/app\.patch\('\/admin\/students\/:id',authenticate,allow\('admin'\)/);
 assert.match(api,/app\.delete\('\/admin\/students\/:id',authenticate,allow\('admin'\)/);
 assert.match(api,/preserveRelatedRecords:true/);
});
test('seed does not reactivate demo accounts on rerun',async()=>{
 const seed = await readFile(new URL('../src/seed.js', import.meta.url),'utf8');
 assert.match(seed,/ON CONFLICT\(id\) DO NOTHING/);
 assert.doesNotMatch(seed,/active=TRUE/);
});

test('security migration adds forced password change and audit indexes',async()=>{
 const security=await readFile(new URL('../migrations/003_security_admin_tools.sql',import.meta.url),'utf8');
 assert.match(security,/ADD COLUMN IF NOT EXISTS must_change_password BOOLEAN NOT NULL DEFAULT FALSE/);
 assert.match(security,/idx_audit_logs_created_at/);
 assert.match(security,/must_change_password = TRUE/);
});
test('first-login password change and admin reset are protected and audited',async()=>{
 assert.match(api,/app\.post\('\/auth\/change-password',authenticate/);
 assert.match(api,/app\.post\('\/admin\/users\/:id\/reset-password',authenticate,allow\('admin'\)/);
 assert.match(api,/user\.password_reset/);
 const auth=await readFile(new URL('../src/auth.js',import.meta.url),'utf8');
 assert.match(auth,/user\.must_change_password && !\['\/auth\/change-password','\/auth\/me','\/auth\/logout'\]/);
});
test('audit log viewer endpoint is admin-only and server-paginated',()=>{
 assert.match(api,/app\.get\('\/admin\/audit-logs',authenticate,allow\('admin'\)/);
 assert.match(api,/LIMIT \$3 OFFSET \$4/);
 assert.match(api,/ORDER BY al\.created_at DESC,al\.id DESC/);
});

test('admin timetable workflow assigns teacher subjects and records timetable changes', async()=>{
 assert.match(api,/app\.post\('\/admin\/timetable', authenticate, allow\('admin'\)/);
 assert.match(api,/INSERT INTO teacher_subjects\(teacher_id,subject_id\) VALUES\(\$1,\$2\) ON CONFLICT DO NOTHING/);
 assert.match(api,/timetable\.upserted/);
 assert.match(api,/app\.delete\('\/admin\/timetable\/:id',authenticate,allow\('admin'\)/);
 const migration4 = await readFile(new URL('../migrations/004_disable_repeated_password_prompt.sql', import.meta.url),'utf8');
 assert.match(migration4,/UPDATE app_users SET must_change_password = FALSE/);
});

test('new account creation and password reset no longer force a repeated password-change prompt',()=>{
 assert.match(api,/password_hash,must_change_password\) VALUES\(\$1,\$2,\$3,\$4,\$5,FALSE\)/);
 assert.match(api,/SET password_hash=\$2,must_change_password=FALSE WHERE id=\$1/);
});

test('admin attendance history is database-backed, searchable and paginated',()=>{
 assert.match(api,/app\.get\('\/admin\/attendance',authenticate,allow\('admin'\)/);
 assert.match(api,/LIMIT \$2 OFFSET \$3/);
 assert.match(api,/student_name ILIKE/);
});

test('teacher attendance uploads require an active timetable slot for the class and section',()=>{
 assert.match(api,/No active timetable slot assigns this subject to your selected class and section/);
 assert.match(api,/FROM timetable_entries WHERE active=TRUE AND teacher_id=\$1 AND subject_id=\$2 AND section=\$3 AND class_group=\$4/);
});
