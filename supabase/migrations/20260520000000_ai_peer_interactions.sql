-- AI peer interaction log: exchanges between Kuze and sibling AIs (Ilita, Stele)
CREATE TABLE IF NOT EXISTS kuze.ai_peer_interactions (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  peer_name   text NOT NULL CHECK (peer_name IN ('ilita', 'stele')),
  direction   text NOT NULL CHECK (direction IN ('inbound', 'outbound')),
  content     text NOT NULL,
  exchange_id uuid NOT NULL,
  summary     text,
  weight      float NOT NULL DEFAULT 0.7 CHECK (weight >= 0 AND weight <= 1),
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ai_peer_interactions_peer_created
  ON kuze.ai_peer_interactions (peer_name, created_at DESC);

CREATE INDEX IF NOT EXISTS ai_peer_interactions_exchange
  ON kuze.ai_peer_interactions (exchange_id);
