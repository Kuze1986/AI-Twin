-- Kuze Operational Layer — Phase 1
-- Tool-use layer: every tool call (input, output, duration, error) is logged here
-- before the response is delivered. No silent failures, everything logged (spec §1.6).
-- RLS is enabled from the start (service-role-only, like the rest of the kuze schema).
--
-- Read-only data access for the tools is granted to a separate `kuze_readonly` Postgres
-- role (NOT created here — CREATE ROLE is privileged and needs a secret password).
-- Provision it out-of-band, then point SHIFT_READONLY_DATABASE_URL at it:
--
--   CREATE ROLE kuze_readonly LOGIN PASSWORD '<from env>';
--   GRANT USAGE ON SCHEMA shift TO kuze_readonly;
--   GRANT SELECT ON ALL TABLES IN SCHEMA shift TO kuze_readonly;
--   ALTER DEFAULT PRIVILEGES IN SCHEMA shift GRANT SELECT ON TABLES TO kuze_readonly;
--   ALTER ROLE kuze_readonly SET statement_timeout = '5s';

CREATE SCHEMA IF NOT EXISTS kuze;

CREATE TABLE IF NOT EXISTS kuze.tool_call_log (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at  timestamptz NOT NULL DEFAULT now(),
  session_id  uuid,
  user_id     uuid,
  mode        text,
  tool_name   text NOT NULL,
  input       jsonb NOT NULL,
  ok          boolean NOT NULL,
  output      jsonb,                -- truncated to 16KB; {"truncated": true, "bytes": n} beyond
  error       text,
  duration_ms integer NOT NULL
);

CREATE INDEX IF NOT EXISTS tool_call_log_created
  ON kuze.tool_call_log (created_at DESC);
CREATE INDEX IF NOT EXISTS tool_call_log_tool_created
  ON kuze.tool_call_log (tool_name, created_at DESC);

ALTER TABLE kuze.tool_call_log ENABLE ROW LEVEL SECURITY;
