-- Existing accounts should not be trapped in repeated forced password changes.
-- Passwords remain hashed, and administrators can still reset them when needed.
UPDATE app_users SET must_change_password = FALSE WHERE must_change_password = TRUE;
