CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS "Schema_migrations" (
  version VARCHAR PRIMARY KEY,
  applied_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS "Users" (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email VARCHAR UNIQUE NOT NULL,
  password_hash VARCHAR NOT NULL,
  role VARCHAR NOT NULL,
  first_name VARCHAR,
  last_name VARCHAR,
  phone VARCHAR,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT users_role_allowed CHECK (role IN ('admin', 'user'))
);

CREATE TABLE IF NOT EXISTS "Workspaces" (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR NOT NULL,
  owner_id UUID REFERENCES "Users"(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS "Workspace_members" (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES "Workspaces"(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES "Users"(id) ON DELETE CASCADE,
  role VARCHAR NOT NULL,
  joined_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (workspace_id, user_id),
  CONSTRAINT workspace_members_role_allowed CHECK (role IN ('owner', 'member'))
);

CREATE TABLE IF NOT EXISTS "User_entitlements" (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL UNIQUE REFERENCES "Users"(id) ON DELETE CASCADE,
  plan_code VARCHAR NOT NULL DEFAULT 'free',
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS "Workspace_subscriptions" (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL UNIQUE REFERENCES "Workspaces"(id) ON DELETE CASCADE,
  plan_code VARCHAR NOT NULL DEFAULT 'free',
  status VARCHAR NOT NULL DEFAULT 'active',
  current_period_start TIMESTAMPTZ,
  current_period_end TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS "Registration_otps" (
  email VARCHAR PRIMARY KEY,
  password_hash VARCHAR NOT NULL,
  workspace_name VARCHAR,
  otp_hash VARCHAR NOT NULL,
  attempts INT NOT NULL DEFAULT 0,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS "Contacts" (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES "Workspaces"(id) ON DELETE CASCADE,
  email VARCHAR NOT NULL,
  first_name VARCHAR,
  last_name VARCHAR,
  phone VARCHAR,
  properties JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT contacts_workspace_email_unique UNIQUE (workspace_id, email)
);

CREATE TABLE IF NOT EXISTS "Lists" (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES "Workspaces"(id) ON DELETE CASCADE,
  name VARCHAR NOT NULL,
  description TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS "Contact_list_relation" (
  workspace_id UUID NOT NULL REFERENCES "Workspaces"(id) ON DELETE CASCADE,
  contact_id UUID NOT NULL REFERENCES "Contacts"(id) ON DELETE CASCADE,
  list_id UUID NOT NULL REFERENCES "Lists"(id) ON DELETE CASCADE,
  added_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (contact_id, list_id)
);

CREATE TABLE IF NOT EXISTS "Templates" (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES "Workspaces"(id) ON DELETE CASCADE,
  title VARCHAR,
  content TEXT,
  name VARCHAR NOT NULL DEFAULT '',
  body_html TEXT NOT NULL DEFAULT '',
  body_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS "Campaigns" (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES "Workspaces"(id) ON DELETE CASCADE,
  template_id UUID REFERENCES "Templates"(id) ON DELETE SET NULL,
  name VARCHAR NOT NULL,
  status VARCHAR NOT NULL DEFAULT 'draft',
  target_filters JSONB NOT NULL DEFAULT '{}'::jsonb,
  ai_personalization_enabled BOOLEAN NOT NULL DEFAULT false,
  ai_context JSONB NOT NULL DEFAULT '{}'::jsonb,
  run_at TIMESTAMPTZ,
  scheduled_at TIMESTAMPTZ,
  processing_started_at TIMESTAMPTZ,
  failure_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT campaigns_status_check
    CHECK (status IN ('draft', 'pending', 'processing', 'sent', 'failed'))
);

CREATE TABLE IF NOT EXISTS "Email_logs" (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES "Workspaces"(id) ON DELETE CASCADE,
  campaign_id UUID REFERENCES "Campaigns"(id) ON DELETE SET NULL,
  contact_id UUID REFERENCES "Contacts"(id) ON DELETE SET NULL,
  status VARCHAR NOT NULL DEFAULT 'sent',
  error_message TEXT,
  personalization_source VARCHAR(32),
  personalization_error TEXT,
  sent_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS "Ai_outputs" (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES "Workspaces"(id) ON DELETE CASCADE,
  feature VARCHAR NOT NULL,
  input_hash VARCHAR NOT NULL,
  input_text TEXT NOT NULL,
  output_json JSONB NOT NULL,
  provider VARCHAR NOT NULL,
  model VARCHAR NOT NULL,
  status VARCHAR NOT NULL DEFAULT 'generated',
  created_by UUID REFERENCES "Users"(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT ai_outputs_status_check
    CHECK (status IN ('generated', 'approved', 'stale'))
);

CREATE TABLE IF NOT EXISTS "Usage_counters" (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES "Workspaces"(id) ON DELETE CASCADE,
  user_id UUID REFERENCES "Users"(id) ON DELETE SET NULL,
  usage_key VARCHAR NOT NULL,
  period_start DATE NOT NULL,
  used_count INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT usage_counters_used_count_nonnegative CHECK (used_count >= 0),
  UNIQUE NULLS NOT DISTINCT (workspace_id, user_id, usage_key, period_start)
);

CREATE TABLE IF NOT EXISTS "Admin_audit_logs" (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_user_id UUID NOT NULL REFERENCES "Users"(id) ON DELETE CASCADE,
  action VARCHAR NOT NULL,
  target_type VARCHAR NOT NULL,
  target_id UUID,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS "Workspace_invites" (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES "Workspaces"(id) ON DELETE CASCADE,
  token_hash VARCHAR UNIQUE NOT NULL,
  created_by_user_id UUID NOT NULL REFERENCES "Users"(id) ON DELETE CASCADE,
  expires_at TIMESTAMPTZ NOT NULL,
  revoked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS "Workspace_audit_logs" (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES "Workspaces"(id) ON DELETE CASCADE,
  actor_user_id UUID REFERENCES "Users"(id) ON DELETE SET NULL,
  target_type VARCHAR NOT NULL,
  target_id UUID,
  action VARCHAR NOT NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_workspaces_owner_id ON "Workspaces"(owner_id);
CREATE INDEX IF NOT EXISTS idx_workspace_members_workspace_id ON "Workspace_members"(workspace_id);
CREATE INDEX IF NOT EXISTS idx_workspace_members_user_id ON "Workspace_members"(user_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_user_entitlements_user_id_unique ON "User_entitlements"(user_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_workspace_subscriptions_workspace_id_unique ON "Workspace_subscriptions"(workspace_id);
CREATE INDEX IF NOT EXISTS idx_registration_otps_expires_at ON "Registration_otps"(expires_at);
CREATE INDEX IF NOT EXISTS idx_contacts_workspace_id ON "Contacts"(workspace_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_contacts_workspace_email_unique ON "Contacts"(workspace_id, email);
CREATE UNIQUE INDEX IF NOT EXISTS idx_contacts_workspace_id_id_unique ON "Contacts"(workspace_id, id);
CREATE INDEX IF NOT EXISTS idx_lists_workspace_id ON "Lists"(workspace_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_lists_workspace_id_id_unique ON "Lists"(workspace_id, id);
CREATE INDEX IF NOT EXISTS idx_contact_list_relation_list_id ON "Contact_list_relation"(list_id);
CREATE INDEX IF NOT EXISTS idx_contact_list_relation_workspace_id ON "Contact_list_relation"(workspace_id);
CREATE INDEX IF NOT EXISTS idx_templates_workspace_id ON "Templates"(workspace_id);
CREATE INDEX IF NOT EXISTS idx_campaigns_workspace_id ON "Campaigns"(workspace_id);
CREATE INDEX IF NOT EXISTS idx_campaigns_due ON "Campaigns"(workspace_id, status, run_at);
CREATE INDEX IF NOT EXISTS idx_campaigns_template_id ON "Campaigns"(template_id);
CREATE INDEX IF NOT EXISTS idx_email_logs_workspace_id ON "Email_logs"(workspace_id);
CREATE INDEX IF NOT EXISTS idx_email_logs_campaign_id ON "Email_logs"(campaign_id);
CREATE INDEX IF NOT EXISTS idx_email_logs_contact_id ON "Email_logs"(contact_id);
CREATE INDEX IF NOT EXISTS idx_contacts_properties_gin ON "Contacts" USING GIN (properties);
CREATE INDEX IF NOT EXISTS idx_campaigns_target_filters_gin ON "Campaigns" USING GIN (target_filters);
CREATE INDEX IF NOT EXISTS idx_ai_outputs_workspace_feature ON "Ai_outputs"(workspace_id, feature);
CREATE UNIQUE INDEX IF NOT EXISTS idx_ai_outputs_workspace_feature_input_hash_unique
  ON "Ai_outputs"(workspace_id, feature, input_hash);
CREATE INDEX IF NOT EXISTS idx_ai_outputs_output_json_gin ON "Ai_outputs" USING GIN (output_json);
CREATE INDEX IF NOT EXISTS idx_usage_counters_workspace_key_period
  ON "Usage_counters"(workspace_id, usage_key, period_start);
CREATE INDEX IF NOT EXISTS idx_admin_audit_logs_admin_user_id ON "Admin_audit_logs"(admin_user_id);
CREATE INDEX IF NOT EXISTS idx_admin_audit_logs_created_at ON "Admin_audit_logs"(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_workspace_invites_workspace_id ON "Workspace_invites"(workspace_id);
CREATE INDEX IF NOT EXISTS idx_workspace_invites_token_hash ON "Workspace_invites"(token_hash);
CREATE INDEX IF NOT EXISTS idx_workspace_audit_logs_workspace_id_created_at
  ON "Workspace_audit_logs"(workspace_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_workspace_audit_logs_actor_user_id ON "Workspace_audit_logs"(actor_user_id);

DO $do$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'contact_list_relation_contact_workspace_fk'
  ) THEN
    ALTER TABLE "Contact_list_relation"
      ADD CONSTRAINT contact_list_relation_contact_workspace_fk
      FOREIGN KEY (workspace_id, contact_id)
      REFERENCES "Contacts"(workspace_id, id) ON DELETE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'contact_list_relation_list_workspace_fk'
  ) THEN
    ALTER TABLE "Contact_list_relation"
      ADD CONSTRAINT contact_list_relation_list_workspace_fk
      FOREIGN KEY (workspace_id, list_id)
      REFERENCES "Lists"(workspace_id, id) ON DELETE CASCADE;
  END IF;
END
$do$;

ALTER TABLE "Contacts" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Contacts" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS contacts_workspace_isolation ON "Contacts";
CREATE POLICY contacts_workspace_isolation ON "Contacts"
  USING (workspace_id::text = NULLIF(current_setting('app.current_workspace_id', true), ''))
  WITH CHECK (workspace_id::text = NULLIF(current_setting('app.current_workspace_id', true), ''));

ALTER TABLE "Lists" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Lists" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS lists_workspace_isolation ON "Lists";
CREATE POLICY lists_workspace_isolation ON "Lists"
  USING (workspace_id::text = NULLIF(current_setting('app.current_workspace_id', true), ''))
  WITH CHECK (workspace_id::text = NULLIF(current_setting('app.current_workspace_id', true), ''));

ALTER TABLE "Contact_list_relation" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Contact_list_relation" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS contact_list_relation_workspace_isolation ON "Contact_list_relation";
CREATE POLICY contact_list_relation_workspace_isolation ON "Contact_list_relation"
  USING (workspace_id::text = NULLIF(current_setting('app.current_workspace_id', true), ''))
  WITH CHECK (workspace_id::text = NULLIF(current_setting('app.current_workspace_id', true), ''));

ALTER TABLE "Templates" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Templates" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS templates_workspace_isolation ON "Templates";
CREATE POLICY templates_workspace_isolation ON "Templates"
  USING (workspace_id::text = NULLIF(current_setting('app.current_workspace_id', true), ''))
  WITH CHECK (workspace_id::text = NULLIF(current_setting('app.current_workspace_id', true), ''));

ALTER TABLE "Campaigns" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Campaigns" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS campaigns_workspace_isolation ON "Campaigns";
CREATE POLICY campaigns_workspace_isolation ON "Campaigns"
  USING (workspace_id::text = NULLIF(current_setting('app.current_workspace_id', true), ''))
  WITH CHECK (workspace_id::text = NULLIF(current_setting('app.current_workspace_id', true), ''));

ALTER TABLE "Email_logs" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Email_logs" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS email_logs_workspace_isolation ON "Email_logs";
CREATE POLICY email_logs_workspace_isolation ON "Email_logs"
  USING (workspace_id::text = NULLIF(current_setting('app.current_workspace_id', true), ''))
  WITH CHECK (workspace_id::text = NULLIF(current_setting('app.current_workspace_id', true), ''));

ALTER TABLE "Ai_outputs" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Ai_outputs" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS ai_outputs_workspace_isolation ON "Ai_outputs";
CREATE POLICY ai_outputs_workspace_isolation ON "Ai_outputs"
  USING (workspace_id::text = NULLIF(current_setting('app.current_workspace_id', true), ''))
  WITH CHECK (workspace_id::text = NULLIF(current_setting('app.current_workspace_id', true), ''));

INSERT INTO "Schema_migrations" (version)
VALUES ('v15_limits_entitlements')
ON CONFLICT (version) DO NOTHING;
