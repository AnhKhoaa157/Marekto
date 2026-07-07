CREATE TABLE IF NOT EXISTS "Password_reset_otps" (
  email VARCHAR PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES "Users"(id) ON DELETE CASCADE,
  otp_hash VARCHAR NOT NULL,
  attempts INT NOT NULL DEFAULT 0,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_password_reset_otps_expires_at
  ON "Password_reset_otps"(expires_at);

INSERT INTO "Schema_migrations" (version)
VALUES ('v18_auth_password_recovery')
ON CONFLICT (version) DO NOTHING;
