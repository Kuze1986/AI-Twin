-- AI Twin: initial schema (Phase 1 — global long-term memory only)

-- Identity (single logical twin; one row expected in Phase 1)
CREATE TABLE public.identity_profile (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  twin_name TEXT NOT NULL,
  persona_prompt TEXT NOT NULL,
  context_blocks JSONB NOT NULL DEFAULT '[]'::jsonb,
  behavioral_rules JSONB NOT NULL DEFAULT '{}'::jsonb,
  style_fingerprint JSONB,
  version INT NOT NULL DEFAULT 1,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE public.identity_profile_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  identity_profile_id UUID NOT NULL REFERENCES public.identity_profile(id) ON DELETE CASCADE,
  persona_prompt TEXT NOT NULL,
  context_blocks JSONB NOT NULL DEFAULT '[]'::jsonb,
  behavioral_rules JSONB NOT NULL DEFAULT '{}'::jsonb,
  version INT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL
);

CREATE TABLE public.mode_config (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  mode TEXT NOT NULL UNIQUE,
  system_injection TEXT NOT NULL DEFAULT '',
  context_block_tag TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE public.chat_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  mode TEXT NOT NULL DEFAULT 'default',
  title TEXT,
  last_activity_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  consolidated_at TIMESTAMPTZ,
  flagged_for_memory BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE public.twin_memory (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID NOT NULL REFERENCES public.chat_sessions(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
  content TEXT NOT NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE public.long_term_memory_global (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  category TEXT NOT NULL CHECK (category IN (
    'relationship', 'preference', 'decision', 'fact', 'context'
  )),
  summary TEXT NOT NULL,
  source_session_id UUID REFERENCES public.chat_sessions(id) ON DELETE SET NULL,
  weight DOUBLE PRECISION NOT NULL DEFAULT 1.0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_ltm_global_weight_created ON public.long_term_memory_global (
  weight DESC NULLS LAST,
  created_at DESC
);

CREATE INDEX idx_chat_sessions_user_activity ON public.chat_sessions (user_id, last_activity_at);

CREATE INDEX idx_twin_memory_session_created ON public.twin_memory (session_id, created_at);

-- RLS: user-scoped tables
ALTER TABLE public.chat_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.twin_memory ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own sessions"
  ON public.chat_sessions
  FOR ALL
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users manage own twin_memory"
  ON public.twin_memory
  FOR ALL
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- Lock down sensitive tables from direct client access (service role bypasses RLS)
ALTER TABLE public.identity_profile ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.identity_profile_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mode_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.long_term_memory_global ENABLE ROW LEVEL SECURITY;

CREATE POLICY "No direct identity read for anon"
  ON public.identity_profile FOR SELECT TO anon USING (false);

CREATE POLICY "No direct identity write for anon"
  ON public.identity_profile FOR ALL TO anon USING (false) WITH CHECK (false);

CREATE POLICY "Authenticated no direct identity"
  ON public.identity_profile FOR ALL TO authenticated USING (false) WITH CHECK (false);

CREATE POLICY "No history direct"
  ON public.identity_profile_history FOR ALL TO authenticated USING (false) WITH CHECK (false);

CREATE POLICY "No history anon"
  ON public.identity_profile_history FOR ALL TO anon USING (false) WITH CHECK (false);

CREATE POLICY "No mode_config direct"
  ON public.mode_config FOR ALL TO authenticated USING (false) WITH CHECK (false);

CREATE POLICY "No mode_config anon"
  ON public.mode_config FOR ALL TO anon USING (false) WITH CHECK (false);

CREATE POLICY "No ltm direct auth"
  ON public.long_term_memory_global FOR ALL TO authenticated USING (false) WITH CHECK (false);

CREATE POLICY "No ltm anon"
  ON public.long_term_memory_global FOR ALL TO anon USING (false) WITH CHECK (false);
