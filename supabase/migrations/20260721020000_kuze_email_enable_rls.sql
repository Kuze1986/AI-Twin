-- Enable RLS on the Phase 1 email tables (Phase 2 task tables already ship with it on).
-- These are service-role-only tables: the Railway backend uses SUPABASE_SERVICE_ROLE_KEY,
-- which bypasses RLS. Enabling RLS with no policies blocks the anon/authenticated roles,
-- matching every other table in the kuze schema.
ALTER TABLE kuze.email_suppression ENABLE ROW LEVEL SECURITY;
ALTER TABLE kuze.email_messages   ENABLE ROW LEVEL SECURITY;
ALTER TABLE kuze.email_contacts   ENABLE ROW LEVEL SECURITY;
ALTER TABLE kuze.email_threads    ENABLE ROW LEVEL SECURITY;
