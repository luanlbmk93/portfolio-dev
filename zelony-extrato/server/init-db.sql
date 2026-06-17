CREATE SCHEMA IF NOT EXISTS auth;

CREATE TABLE IF NOT EXISTS auth.users (
  id UUID PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  encrypted_password TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS platform_users (
  id UUID PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  role TEXT NOT NULL DEFAULT 'analyst',
  must_change_password BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS platform_audit_logs (
  id BIGSERIAL PRIMARY KEY,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  actor_email TEXT NOT NULL,
  actor_role TEXT,
  action TEXT NOT NULL,
  statement_owner TEXT,
  details JSONB NOT NULL DEFAULT '{}'::jsonb,
  ip TEXT,
  user_agent TEXT
);

CREATE INDEX IF NOT EXISTS idx_platform_audit_logs_created_at
  ON platform_audit_logs (created_at DESC);

CREATE INDEX IF NOT EXISTS idx_platform_audit_logs_actor_email
  ON platform_audit_logs (actor_email);

CREATE INDEX IF NOT EXISTS idx_platform_users_role
  ON platform_users (role);
