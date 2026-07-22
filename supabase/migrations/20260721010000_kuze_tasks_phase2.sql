-- Kuze task engine — Phase 2
-- A queue Kuze drains to run work for The Shift (outreach campaigns, follow-ups).
-- Campaign drafts still flow into the Phase 1 approval inbox — cold outreach never auto-sends.
-- RLS is enabled from the start (service-role-only, like the rest of the kuze schema).

CREATE SCHEMA IF NOT EXISTS kuze;

CREATE TABLE IF NOT EXISTS kuze.tasks (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title         text NOT NULL,
  type          text NOT NULL CHECK (type IN ('outreach_campaign', 'follow_up', 'custom')),
  goal          text NOT NULL,
  status        text NOT NULL DEFAULT 'queued'
                  CHECK (status IN ('queued', 'running', 'awaiting_approval', 'completed', 'failed', 'cancelled')),
  source        text NOT NULL DEFAULT 'admin' CHECK (source IN ('admin', 'chat')),
  payload       jsonb NOT NULL DEFAULT '{}'::jsonb,
  result        jsonb,
  error         text,
  scheduled_for timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS tasks_status_created
  ON kuze.tasks (status, created_at);

-- One work unit per lead/recipient inside a task.
CREATE TABLE IF NOT EXISTS kuze.task_items (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id          uuid NOT NULL REFERENCES kuze.tasks (id) ON DELETE CASCADE,
  contact_email    text NOT NULL,
  contact_name     text,
  contact_company  text,
  status           text NOT NULL DEFAULT 'pending'
                     CHECK (status IN ('pending', 'drafted', 'sent', 'skipped', 'failed')),
  draft_message_id uuid REFERENCES kuze.email_messages (id) ON DELETE SET NULL,
  error            text,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS task_items_task_status
  ON kuze.task_items (task_id, status);

ALTER TABLE kuze.tasks      ENABLE ROW LEVEL SECURITY;
ALTER TABLE kuze.task_items ENABLE ROW LEVEL SECURITY;
