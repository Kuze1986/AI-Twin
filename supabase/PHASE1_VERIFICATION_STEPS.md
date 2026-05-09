# Phase 1 Verification Steps

## Before Running Verification

Ensure you have:
1. Run the migration: `supabase db execute --file supabase/migrations/20260508200000_kuze_sentinel_001_init.sql`
2. Run the constitution seed: `supabase db execute --file supabase/seed_kuze_constitution_v1.sql`
3. Enabled Realtime on the required tables (see REALTIME_ENABLEMENT_INSTRUCTIONS.md)

## Six-Point Gate Verification Checklist

### 1. Migration runs cleanly on a fresh nexus-core branch

**Verification Command:**
```bash
supabase db execute --file supabase/migrations/20260508200000_kuze_sentinel_001_init.sql
```

**Expected Result:** No errors, all tables created successfully

### 2. All 4 tables exist with correct constraints + indexes

**Verification Query:**
```sql
-- Check tables exist
SELECT table_name 
FROM information_schema.tables 
WHERE table_schema = 'kuze' 
  AND table_name IN ('violation_log', 'pattern_alerts', 'approved_pricing', 'competitor_list', 'cs_interactions');

-- Check constraints on violation_log
SELECT conname, contype 
FROM pg_constraint 
WHERE conrelid = 'kuze.violation_log'::regclass;

-- Check indexes on violation_log
SELECT indexname 
FROM pg_indexes 
WHERE tablename = 'violation_log' 
  AND schemaname = 'kuze';
```

**Expected Result:**
- All 5 tables exist (violation_log, pattern_alerts, approved_pricing, competitor_list, cs_interactions)
- violation_log has CHECK constraints on severity and resolution
- All indexes exist as specified in migration

### 3. Realtime is enabled on violation_log and pattern_alerts

**Verification Query:**
```sql
SELECT * FROM pg_publication_tables WHERE pubname = 'supabase_realtime';
```

**Expected Result:** Rows for kuze.violation_log and kuze.pattern_alerts

**Alternative:** Verify via Supabase Dashboard → Database → Replication

### 4. Constitution V.1 visible via SELECT on identity_profile

**Verification Query:**
```sql
SELECT twin_name, version, updated_at, 
  jsonb_array_length(context_blocks) as context_count
FROM kuze.identity_profile 
WHERE twin_name = 'Kuze';

-- Check for constitution context blocks
SELECT id, title 
FROM kuze.identity_profile, 
  jsonb_array_elements(context_blocks) as ctx 
WHERE twin_name = 'Kuze' 
  AND ctx->>'id' LIKE 'constitution_%';
```

**Expected Result:**
- twin_name = 'Kuze'
- version = 2
- updated_at = current timestamp
- 9 constitution context blocks present (constitution_identity, constitution_hierarchy, etc.)

### 5. V.0 preserved in identity_profile_history

**Verification Query:**
```sql
SELECT twin_name, version, created_at 
FROM kuze.identity_profile_history 
WHERE twin_name = 'Kuze' 
ORDER BY created_at DESC;
```

**Expected Result:** At least one row with version = 1 (V.0 preserved)

### 6. promptBuilder returns V.1 content when called

**Verification:** This requires running the Kuze service and calling the promptBuilder endpoint. Verify that the constitution context blocks are included in the system prompt.

## Schema Changes

**New Tables:**
- `kuze.violation_log` - Runtime enforcement violation tracking
- `kuze.pattern_alerts` - Pattern detection alerts
- `kuze.approved_pricing` - Approved pricing reference table
- `kuze.competitor_list` - Competitor watchlist
- `kuze.cs_interactions` - Customer service interaction logging

**Modified Tables:**
- `kuze.identity_profile` - Added 9 constitution context blocks, version incremented to 2

## New Environment Variables

None added in Phase 1.

## Open Questions for Brandon

1. **Constitution sections:** The spec mentioned 15 constitution sections, but the provided document has 9 sections (I-IX). Should I use the 9 sections provided, or are there additional sections expected?

2. **Constitution file location:** The spec mentions the constitution should be at `/docs/kuze-constitution-v1.md`. Should I create this file in the repo for reference?

3. **Operating Parameters:** Should the Operating Parameters V.1 document also be seeded as context blocks, or is it separate from the constitution context?
