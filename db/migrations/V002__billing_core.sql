ALTER TABLE "Workspace_subscriptions"
  ADD COLUMN IF NOT EXISTS provider VARCHAR,
  ADD COLUMN IF NOT EXISTS provider_customer_id VARCHAR,
  ADD COLUMN IF NOT EXISTS provider_subscription_id VARCHAR,
  ADD COLUMN IF NOT EXISTS provider_price_id VARCHAR,
  ADD COLUMN IF NOT EXISTS cancel_at_period_end BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS last_webhook_event_id VARCHAR,
  ADD COLUMN IF NOT EXISTS metadata JSONB NOT NULL DEFAULT '{}'::jsonb;

CREATE TABLE IF NOT EXISTS "Billing_plans" (
  plan_code VARCHAR PRIMARY KEY,
  name VARCHAR NOT NULL,
  description TEXT NOT NULL,
  monthly_amount_cents INT NOT NULL DEFAULT 0,
  currency VARCHAR NOT NULL DEFAULT 'vnd',
  checkout_enabled BOOLEAN NOT NULL DEFAULT false,
  limits JSONB NOT NULL DEFAULT '{}'::jsonb,
  features JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT billing_plans_code_check CHECK (plan_code IN ('free', 'pro', 'team')),
  CONSTRAINT billing_plans_amount_nonnegative CHECK (monthly_amount_cents >= 0),
  CONSTRAINT billing_plans_limits_object CHECK (jsonb_typeof(limits) = 'object'),
  CONSTRAINT billing_plans_features_array CHECK (jsonb_typeof(features) = 'array')
);

INSERT INTO "Billing_plans"
  (plan_code, name, description, monthly_amount_cents, currency, checkout_enabled, limits, features)
VALUES
  (
    'free',
    'Free',
    'Best for trying Marekto with one small workspace.',
    0,
    'vnd',
    false,
    '{"user.owned_workspaces":1,"workspace.members":3,"ai.campaign_builder":20,"ai.segmentation":50,"ai.personalization_recipients":100,"contact_intelligence.rows":500}'::jsonb,
    '["1 owned workspace","3 workspace members","20 AI campaign-builder runs/month","50 AI segmentation runs/month","500 contact-intelligence rows/month"]'::jsonb
  ),
  (
    'pro',
    'Pro',
    'Recommended for active teams running real campaigns.',
    99000,
    'vnd',
    true,
    '{"user.owned_workspaces":3,"workspace.members":10,"ai.campaign_builder":200,"ai.segmentation":500,"ai.personalization_recipients":2000,"contact_intelligence.rows":10000}'::jsonb,
    '["3 owned workspaces","Up to 10 workspace members","200 AI campaign-builder runs/month","500 AI segmentation runs/month","2,000 AI personalized recipients/month","10,000 contact-intelligence rows/month"]'::jsonb
  ),
  (
    'team',
    'Team',
    'For larger teams that need heavier collaboration and AI usage.',
    299000,
    'vnd',
    true,
    '{"user.owned_workspaces":10,"workspace.members":25,"ai.campaign_builder":1000,"ai.segmentation":2500,"ai.personalization_recipients":10000,"contact_intelligence.rows":50000}'::jsonb,
    '["10 owned workspaces","Up to 25 workspace members","1,000 AI campaign-builder runs/month","2,500 AI segmentation runs/month","10,000 AI personalized recipients/month","50,000 contact-intelligence rows/month"]'::jsonb
  )
ON CONFLICT (plan_code) DO NOTHING;

CREATE TABLE IF NOT EXISTS "Payment_orders" (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES "Workspaces"(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES "Users"(id) ON DELETE CASCADE,
  plan_code VARCHAR NOT NULL,
  provider VARCHAR NOT NULL,
  provider_order_id VARCHAR,
  checkout_url TEXT,
  amount_cents INT NOT NULL,
  currency VARCHAR NOT NULL DEFAULT 'vnd',
  status VARCHAR NOT NULL DEFAULT 'pending',
  expires_at TIMESTAMPTZ,
  paid_at TIMESTAMPTZ,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT payment_orders_plan_check CHECK (plan_code IN ('pro', 'team')),
  CONSTRAINT payment_orders_status_check
    CHECK (status IN ('pending', 'paid', 'expired', 'failed', 'canceled')),
  CONSTRAINT payment_orders_amount_nonnegative CHECK (amount_cents >= 0)
);

CREATE TABLE IF NOT EXISTS "Billing_events" (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider VARCHAR NOT NULL,
  provider_event_id VARCHAR NOT NULL,
  event_type VARCHAR NOT NULL,
  workspace_id UUID REFERENCES "Workspaces"(id) ON DELETE SET NULL,
  payment_order_id UUID REFERENCES "Payment_orders"(id) ON DELETE SET NULL,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  processed_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (provider, provider_event_id)
);

CREATE INDEX IF NOT EXISTS idx_workspace_subscriptions_provider_subscription
  ON "Workspace_subscriptions"(provider, provider_subscription_id);
CREATE INDEX IF NOT EXISTS idx_workspace_subscriptions_last_webhook_event
  ON "Workspace_subscriptions"(last_webhook_event_id);
CREATE INDEX IF NOT EXISTS idx_payment_orders_workspace_created
  ON "Payment_orders"(workspace_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_payment_orders_provider_order
  ON "Payment_orders"(provider, provider_order_id);
CREATE INDEX IF NOT EXISTS idx_billing_events_workspace_created
  ON "Billing_events"(workspace_id, created_at DESC);
