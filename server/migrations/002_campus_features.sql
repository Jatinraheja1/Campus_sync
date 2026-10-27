CREATE TABLE IF NOT EXISTS timetable_entries (
 id TEXT PRIMARY KEY,
 class_group TEXT NOT NULL,
 section TEXT NOT NULL,
 subject_id TEXT NOT NULL REFERENCES subjects(id) ON DELETE RESTRICT,
 teacher_id TEXT NOT NULL REFERENCES teachers(id) ON DELETE RESTRICT,
 weekday SMALLINT NOT NULL CHECK (weekday BETWEEN 0 AND 6),
 starts_at TIME NOT NULL,
 ends_at TIME NOT NULL,
 room TEXT NOT NULL DEFAULT '',
 active BOOLEAN NOT NULL DEFAULT TRUE,
 CHECK (ends_at > starts_at)
);
CREATE INDEX IF NOT EXISTS idx_timetable_section_day ON timetable_entries(section, weekday, starts_at);
CREATE TABLE IF NOT EXISTS user_notifications (
 id BIGSERIAL PRIMARY KEY,
 user_id TEXT NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
 title TEXT NOT NULL,
 message TEXT NOT NULL,
 read_at TIMESTAMPTZ,
 created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_notifications_user_date ON user_notifications(user_id, created_at DESC);
CREATE TABLE IF NOT EXISTS face_enrollment_consents (
 student_id TEXT PRIMARY KEY REFERENCES students(id) ON DELETE CASCADE,
 consented_at TIMESTAMPTZ NOT NULL,
 revoked_at TIMESTAMPTZ,
 model_version TEXT NOT NULL,
 device_reference TEXT
);
