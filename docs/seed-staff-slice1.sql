-- ─────────────────────────────────────────────────────────────
-- GYM Tracker — Slice 1 staff seed (coach messaging)
-- Run this in the Neon SQL editor AFTER `drizzle-kit push` has created the
-- new tables. Replace the two email literals below with real accounts.
--   COACH_EMAIL  = the existing account to make Greece (the coach/staff)
--   CLIENT_EMAIL = an existing Elite user to assign to that coach
-- Everything keys on accounts.id (NOT the legacy profiles.id).
-- ─────────────────────────────────────────────────────────────

-- (a) Make an existing account a COACH (staff). Presence of this row = staff.
INSERT INTO admins (account_id, role)
SELECT id, 'coach' FROM accounts WHERE email = 'COACH_EMAIL'
ON CONFLICT (account_id) DO UPDATE SET role = EXCLUDED.role;

-- (b) Upsert the public coach profile for that account.
INSERT INTO coach_profiles (account_id, display_name, bio, accepting_clients, reply_window_hours, is_active)
SELECT id, 'Greece', 'GM Method head coach.', true, 24, true
FROM accounts WHERE email = 'COACH_EMAIL'
ON CONFLICT (account_id) DO UPDATE
  SET display_name = EXCLUDED.display_name,
      bio         = EXCLUDED.bio,
      is_active   = EXCLUDED.is_active;

-- (c) Assign a client to the coach (active). id defaults to crypto.randomUUID()
-- in app code, which raw SQL doesn't run, so we supply gen_random_uuid().
INSERT INTO coach_assignments (id, coach_id, user_id, status, assigned_by)
SELECT gen_random_uuid()::text, c.id, u.id, 'active', c.id
FROM accounts c, accounts u
WHERE c.email = 'COACH_EMAIL' AND u.email = 'CLIENT_EMAIL'
ON CONFLICT (coach_id, user_id) DO UPDATE SET status = 'active';
