ALTER TABLE app_users ADD COLUMN IF NOT EXISTS must_change_password BOOLEAN NOT NULL DEFAULT FALSE;
CREATE INDEX IF NOT EXISTS idx_audit_logs_created_at ON audit_logs(created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_audit_logs_action ON audit_logs(action);
-- The bundled demonstration accounts should replace their published demo passwords on first use.
UPDATE app_users SET must_change_password = TRUE
WHERE id IN ('ADM001', 'TCH001', 'STU001')
  AND email IN ('admin@demo.com', 'teacher@demo.com', 'student@demo.com');
