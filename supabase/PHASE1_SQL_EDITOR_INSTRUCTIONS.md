# Phase 1 SQL Editor Execution Instructions

## Migration Execution

Since the Supabase CLI requires Docker which is not available in this environment, execute the migration via the Supabase SQL Editor.

### Step 1: Access SQL Editor

1. Navigate to: https://supabase.com/dashboard/project/yrvdxofquvprklzsxoav/sql
2. This opens the SQL Editor for the Keystone project (nexus-core)

### Step 2: Execute Migration

1. Copy the contents of: `supabase/migrations/20260508200000_kuze_sentinel_001_init.sql`
2. Paste into the SQL Editor
3. Click "Run" or press Ctrl+Enter
4. Verify success - should show "Success" with no errors

The migration creates:
- `kuze.violation_log` - Runtime enforcement violation tracking
- `kuze.pattern_alerts` - Pattern detection alerts
- `kuze.approved_pricing` - Approved pricing reference table
- `kuze.competitor_list` - Competitor watchlist
- `kuze.cs_interactions` - Customer service interaction logging
- `kuze.operating_parameters` - Amendable governance values

### Step 3: Execute Constitution Seed

1. Copy the contents of: `supabase/seed_kuze_constitution_v1.sql`
2. Paste into the SQL Editor
3. Click "Run" or press Ctrl+Enter
4. Verify success - should show "Success. 1 row affected"

This adds:
- Bridge context block referencing Operating Parameters
- 9 Constitution V.1 context blocks to identity_profile
- Increments version to 2
- Preserves V.0 in identity_profile_history

### Step 4: Enable Realtime

1. Navigate to: https://supabase.com/dashboard/project/yrvdxofquvprklzsxoav/database/replication
2. Click "Add a new table"
3. For `kuze.violation_log`:
   - Select schema: `kuze`
   - Select table: `violation_log`
   - Enable Realtime
   - Click "Confirm"
4. Repeat for `kuze.pattern_alerts`

### Step 5: Verification

Run these verification queries in the SQL Editor:

```sql
-- Check tables exist
SELECT table_name 
FROM information_schema.tables 
WHERE table_schema = 'kuze' 
  AND table_name IN ('violation_log', 'pattern_alerts', 'approved_pricing', 'competitor_list', 'cs_interactions', 'operating_parameters');

-- Check constitution context blocks
SELECT id, title 
FROM kuze.identity_profile, 
  jsonb_array_elements(context_blocks) as ctx 
WHERE twin_name = 'Kuze' 
  AND ctx->>'id' LIKE 'constitution_%';

-- Check operating parameters reference
SELECT id, title 
FROM kuze.identity_profile, 
  jsonb_array_elements(context_blocks) as ctx 
WHERE twin_name = 'Kuze' 
  AND ctx->>'id' = 'operating_parameters_ref';

-- Check V.0 preserved in history
SELECT twin_name, version, created_at 
FROM kuze.identity_profile_history 
WHERE twin_name = 'Kuze' 
ORDER BY created_at DESC;

-- Check Realtime enabled
SELECT * FROM pg_publication_tables WHERE pubname = 'supabase_realtime';
```

Expected results:
- 6 tables in kuze schema
- 9 constitution context blocks
- 1 operating_parameters_ref context block
- At least 1 row in identity_profile_history with version = 1
- Rows for kuze.violation_log and kuze.pattern_alerts in realtime publication
