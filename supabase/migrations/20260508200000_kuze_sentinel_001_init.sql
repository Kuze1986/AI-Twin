-- kuze_sentinel_001_init.sql
-- Phase 1: Database Layer + Constitution V.1 Seed
-- Creates tables for Kuze Sentinel runtime enforcement and observatory

-- Violation log (every check that fires writes here)
CREATE TABLE IF NOT EXISTS kuze.violation_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  occurred_at timestamptz NOT NULL DEFAULT now(),
  rule_violated text NOT NULL,
  severity text NOT NULL CHECK (severity IN ('hard', 'soft')),
  proposed_output text NOT NULL,
  trigger_context jsonb NOT NULL DEFAULT '{}'::jsonb,
  resolution text NOT NULL CHECK (resolution IN
    ('refused', 'regenerated', 'escalated', 'sent_after_override')),
  final_output text,
  recipient_context text,
  mode text,
  reviewed_by_brandon boolean DEFAULT false,
  reviewed_at timestamptz,
  brandon_note text
);

CREATE INDEX IF NOT EXISTS idx_violation_log_occurred ON kuze.violation_log(occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_violation_log_severity ON kuze.violation_log(severity);
CREATE INDEX IF NOT EXISTS idx_violation_log_rule ON kuze.violation_log(rule_violated);

-- Pattern alerts (detector output)
CREATE TABLE IF NOT EXISTS kuze.pattern_alerts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  detected_at timestamptz NOT NULL DEFAULT now(),
  pattern_type text NOT NULL,
  description text NOT NULL,
  triggering_violations uuid[] NOT NULL,
  severity text NOT NULL,
  acknowledged boolean DEFAULT false,
  acknowledged_at timestamptz
);

CREATE INDEX IF NOT EXISTS idx_pattern_alerts_detected ON kuze.pattern_alerts(detected_at DESC);
CREATE INDEX IF NOT EXISTS idx_pattern_alerts_unack ON kuze.pattern_alerts(acknowledged)
  WHERE acknowledged = false;

-- Approved pricing table (referenced by pricing validator)
CREATE TABLE IF NOT EXISTS kuze.approved_pricing (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product text NOT NULL,
  tier text NOT NULL,
  price_amount numeric NOT NULL,
  price_unit text NOT NULL,
  effective_from date NOT NULL,
  effective_until date,
  authorized_by text NOT NULL
);

-- Competitor list (configurable, used by competitor validator)
CREATE TABLE IF NOT EXISTS kuze.competitor_list (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL UNIQUE,
  added_at timestamptz DEFAULT now(),
  active boolean DEFAULT true
);

-- Customer service interactions log (from Operating Parameters)
CREATE TABLE IF NOT EXISTS kuze.cs_interactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  occurred_at timestamptz DEFAULT now(),
  tier_classified text NOT NULL,
  tier_final text NOT NULL,
  channel text,
  contact_id uuid,
  contact_identifier text,
  full_transcript jsonb NOT NULL,
  resolution text,
  escalation_trigger text,
  reviewed_by_brandon boolean DEFAULT false,
  brandon_note text
);

CREATE INDEX IF NOT EXISTS idx_cs_interactions_occurred ON kuze.cs_interactions(occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_cs_interactions_tier ON kuze.cs_interactions(tier_final);

-- Operating parameters table (amendable governance values separate from constitution)
CREATE TABLE IF NOT EXISTS kuze.operating_parameters (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  section text NOT NULL,
  section_name text NOT NULL,
  version text NOT NULL DEFAULT 'V.1',
  content jsonb NOT NULL,
  amended_at timestamptz DEFAULT now(),
  amended_by text DEFAULT 'brandon_alexander',
  is_active boolean DEFAULT true
);

CREATE INDEX IF NOT EXISTS idx_operating_params_section ON kuze.operating_parameters(section);
CREATE INDEX IF NOT EXISTS idx_operating_params_active ON kuze.operating_parameters(is_active) WHERE is_active = true;
