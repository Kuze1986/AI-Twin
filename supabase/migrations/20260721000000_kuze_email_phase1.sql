-- Kuze email channel — Phase 1
-- Inbound mailbox ingestion + human-approved outbound drafts for kuze@bioloopnexus.com.
-- All tables live in the `kuze` schema alongside Sentinel and peer data.

CREATE SCHEMA IF NOT EXISTS kuze;

-- Contacts drive warm/cold classification and the suppression state machine.
CREATE TABLE IF NOT EXISTS kuze.email_contacts (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email             text NOT NULL UNIQUE,
  name              text,
  company           text,
  relationship      text NOT NULL DEFAULT 'cold' CHECK (relationship IN ('known', 'lead', 'cold')),
  status            text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suppressed', 'unsubscribed')),
  notes             text,
  first_seen_at     timestamptz NOT NULL DEFAULT now(),
  last_contacted_at timestamptz,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS email_contacts_email_lower
  ON kuze.email_contacts (lower(email));

-- One row per conversation, keyed by normalized subject / References root.
CREATE TABLE IF NOT EXISTS kuze.email_threads (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  thread_key      text NOT NULL UNIQUE,
  subject         text,
  contact_email   text,
  classification  text NOT NULL DEFAULT 'cold' CHECK (classification IN ('warm', 'cold', 'known')),
  last_message_at timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS email_threads_last_message
  ON kuze.email_threads (last_message_at DESC NULLS LAST);

-- Every inbound message and every outbound draft/sent message.
CREATE TABLE IF NOT EXISTS kuze.email_messages (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  thread_id           uuid REFERENCES kuze.email_threads (id) ON DELETE SET NULL,
  direction           text NOT NULL CHECK (direction IN ('inbound', 'outbound')),
  status              text NOT NULL DEFAULT 'received'
                        CHECK (status IN ('received', 'draft', 'pending_approval', 'sent', 'failed', 'suppressed', 'discarded')),
  message_id          text,
  in_reply_to         text,
  imap_uid            bigint,
  from_addr           text,
  to_addr             text,
  cc_addr             text,
  subject             text,
  body_text           text,
  body_html           text,
  snippet             text,
  classification      text,
  sentinel_resolution text,
  error               text,
  created_at          timestamptz NOT NULL DEFAULT now(),
  sent_at             timestamptz
);

-- Dedupe inbound ingestion on RFC-5322 Message-ID.
CREATE UNIQUE INDEX IF NOT EXISTS email_messages_message_id_uniq
  ON kuze.email_messages (message_id)
  WHERE message_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS email_messages_thread_created
  ON kuze.email_messages (thread_id, created_at);

CREATE INDEX IF NOT EXISTS email_messages_status_created
  ON kuze.email_messages (status, created_at DESC);

-- Hard suppression list (unsubscribe / bounce) for addresses without a full contact.
CREATE TABLE IF NOT EXISTS kuze.email_suppression (
  email      text PRIMARY KEY,
  reason     text NOT NULL DEFAULT 'unsubscribe',
  created_at timestamptz NOT NULL DEFAULT now()
);
