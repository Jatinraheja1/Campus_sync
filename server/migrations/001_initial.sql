CREATE TABLE IF NOT EXISTS app_users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  full_name TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('student','teacher','admin')),
  password_hash TEXT NOT NULL,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS students (
  id TEXT PRIMARY KEY REFERENCES app_users(id) ON DELETE RESTRICT,
  section TEXT NOT NULL,
  class_group TEXT NOT NULL DEFAULT 'B.Tech CSE, Year 2'
);
CREATE TABLE IF NOT EXISTS teachers (
  id TEXT PRIMARY KEY REFERENCES app_users(id) ON DELETE RESTRICT
);
CREATE TABLE IF NOT EXISTS subjects (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  teacher_id TEXT REFERENCES teachers(id) ON DELETE RESTRICT
);
CREATE TABLE IF NOT EXISTS teacher_subjects (
  teacher_id TEXT NOT NULL REFERENCES teachers(id) ON DELETE CASCADE,
  subject_id TEXT NOT NULL REFERENCES subjects(id) ON DELETE CASCADE,
  PRIMARY KEY (teacher_id, subject_id)
);
CREATE TABLE IF NOT EXISTS attendance_sessions (
  id TEXT PRIMARY KEY,
  class_group TEXT NOT NULL,
  section TEXT NOT NULL,
  subject_id TEXT NOT NULL REFERENCES subjects(id) ON DELETE RESTRICT,
  session_date DATE NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('scheduled','finalized','cancelled')),
  sync_status TEXT NOT NULL CHECK (sync_status IN ('Pending Sync','Synced','Sync Failed')),
  created_at TIMESTAMPTZ NOT NULL,
  finalized_at TIMESTAMPTZ,
  finalized_by TEXT,
  cancelled_at TIMESTAMPTZ,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  UNIQUE(section, subject_id, session_date)
);
CREATE TABLE IF NOT EXISTS attendance_records (
  id TEXT PRIMARY KEY,
  student_id TEXT NOT NULL REFERENCES students(id) ON DELETE RESTRICT,
  student_name TEXT NOT NULL,
  subject_id TEXT NOT NULL REFERENCES subjects(id) ON DELETE RESTRICT,
  subject_name TEXT NOT NULL,
  class_group TEXT NOT NULL,
  section TEXT NOT NULL,
  attendance_date DATE NOT NULL,
  recorded_at TIMESTAMPTZ NOT NULL,
  marked_by TEXT NOT NULL,
  attendance TEXT NOT NULL CHECK (attendance IN ('Present','Absent')),
  source TEXT NOT NULL CHECK (source IN ('manual','face')),
  match_score DOUBLE PRECISION CHECK (match_score IS NULL OR (match_score >= 0 AND match_score <= 1)),
  sync_status TEXT NOT NULL CHECK (sync_status IN ('Pending Sync','Synced','Sync Failed')),
  session_id TEXT NOT NULL REFERENCES attendance_sessions(id) ON DELETE RESTRICT,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  UNIQUE(student_id, session_id)
);
CREATE INDEX IF NOT EXISTS idx_attendance_records_student_date ON attendance_records(student_id, attendance_date DESC);
CREATE INDEX IF NOT EXISTS idx_attendance_records_subject_date ON attendance_records(subject_id, attendance_date DESC);
CREATE TABLE IF NOT EXISTS feedback (
  id BIGSERIAL PRIMARY KEY,
  student_id TEXT NOT NULL REFERENCES students(id) ON DELETE RESTRICT,
  teacher_id TEXT REFERENCES teachers(id) ON DELETE RESTRICT,
  subject_id TEXT REFERENCES subjects(id) ON DELETE RESTRICT,
  rating SMALLINT NOT NULL CHECK (rating BETWEEN 1 AND 5),
  comments TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS fee_records (
  id TEXT PRIMARY KEY,
  student_id TEXT NOT NULL REFERENCES students(id) ON DELETE RESTRICT,
  amount_paise BIGINT NOT NULL CHECK (amount_paise >= 0),
  status TEXT NOT NULL CHECK (status IN ('due','recorded','paid','waived')),
  payment_reference TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS audit_logs (
  id BIGSERIAL PRIMARY KEY,
  actor_id TEXT REFERENCES app_users(id) ON DELETE SET NULL,
  action TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT,
  details JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
