ALTER TABLE "accounts" ADD COLUMN IF NOT EXISTS "apple_sub" text;

CREATE UNIQUE INDEX IF NOT EXISTS "accounts_apple_sub_unique"
  ON "accounts" ("apple_sub");

CREATE TABLE IF NOT EXISTS "apple_auth_nonces" (
  "nonce_hash" text PRIMARY KEY NOT NULL,
  "expires_at" timestamp with time zone NOT NULL,
  "consumed_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "apple_auth_nonces_expires"
  ON "apple_auth_nonces" ("expires_at");

-- Pre-authentication challenges have no account owner. Deny all direct
-- row-level access; the Neon table owner used by the API bypasses this policy.
ALTER TABLE "apple_auth_nonces" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "apple_auth_nonces_deny_direct" ON "apple_auth_nonces";
CREATE POLICY "apple_auth_nonces_deny_direct"
  ON "apple_auth_nonces"
  FOR ALL
  USING (false)
  WITH CHECK (false);
