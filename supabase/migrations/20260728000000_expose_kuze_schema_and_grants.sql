-- Expose `kuze` to PostgREST and grant service_role access (ilita pattern).
-- Without this, supabase-js `.schema('kuze')` returns: Invalid schema: kuze
--
-- NOTE: On shared nexus-core, also ensure authenticator pgrst.db_schemas includes `kuze`.
-- This migration is idempotent for grants; the ALTER ROLE line must list the full current
-- schema set for the project (do not drop other product schemas).

ALTER ROLE authenticator SET pgrst.db_schemas =
  'public, graphql_public, shift, scripta, keystone, nexus, bioloop, ilita, aeon, aegis, kuze';

REVOKE USAGE ON SCHEMA kuze FROM anon;
REVOKE USAGE ON SCHEMA kuze FROM authenticated;
GRANT USAGE ON SCHEMA kuze TO service_role;

GRANT ALL ON ALL TABLES IN SCHEMA kuze TO service_role;
GRANT ALL ON ALL SEQUENCES IN SCHEMA kuze TO service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA kuze GRANT ALL ON TABLES TO service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA kuze GRANT ALL ON SEQUENCES TO service_role;

NOTIFY pgrst, 'reload config';
