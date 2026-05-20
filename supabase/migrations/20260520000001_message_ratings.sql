-- Per-message thumbs ratings from users
CREATE TABLE IF NOT EXISTS public.message_ratings (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id uuid NOT NULL,
  session_id uuid NOT NULL REFERENCES public.chat_sessions(id) ON DELETE CASCADE,
  user_id    uuid NOT NULL,
  rating     smallint NOT NULL CHECK (rating IN (-1, 1)),
  note       text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (message_id, user_id)
);

CREATE INDEX IF NOT EXISTS message_ratings_session ON public.message_ratings (session_id);
CREATE INDEX IF NOT EXISTS message_ratings_message ON public.message_ratings (message_id);
