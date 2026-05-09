# Supabase Realtime Enablement Instructions

## Required Tables

Enable Supabase Realtime on the following tables in the `kuze` schema:

1. `kuze.violation_log`
2. `kuze.pattern_alerts`

## Steps to Enable Realtime

### Via Supabase Dashboard

1. Navigate to your Supabase project: https://supabase.com/dashboard
2. Select the `nexus-core` project
3. Go to **Database** → **Replication**
4. Click **Add a new table**
5. For each table:
   - Select the `kuze` schema
   - Choose the table: `violation_log`
   - Enable **Realtime**
   - Click **Confirm**
6. Repeat for `pattern_alerts`

### Via SQL (Alternative)

```sql
-- Enable Realtime on violation_log
ALTER PUBLICATION supabase_realtime ADD TABLE kuze.violation_log;

-- Enable Realtime on pattern_alerts
ALTER PUBLICATION supabase_realtime ADD TABLE kuze.pattern_alerts;
```

## Verification

After enabling Realtime, verify by running:

```sql
-- Check which tables are in the realtime publication
SELECT * FROM pg_publication_tables WHERE pubname = 'supabase_realtime';
```

Expected output should include:
- `kuze.violation_log`
- `kuze.pattern_alerts`

## Important Notes

- Realtime must be enabled **after** running the migration
- Do not enable RLS on these tables yet (separate hardening pass)
- Realtime is required for the Sentinel Panel UI to receive live updates
