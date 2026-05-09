# Phase 2 Verification Steps

## Files Modified

1. **server/src/promptBuilder.ts**
   - Added Supabase client initialization
   - Added OperatingParameterRow interface
   - Added loadOperatingParameters() async function
   - Changed buildSystemPrompt to async
   - Integrated operating parameters loading into system prompt assembly

2. **server/src/routes/chat.ts**
   - Updated buildSystemPrompt call to await
   - Added validator imports
   - Integrated validator execution after AI response generation
   - Added regeneration logic for hard violations
   - Added second-pass review for sensitive outputs
   - Added violation logging for both hard and soft violations

3. **server/src/validators/index.ts** (NEW)
   - Implemented pricing validator
   - Implemented competitor validator
   - Implemented commitment validator
   - Implemented model-disclosure validator
   - Implemented runValidators() orchestration function
   - Implemented logViolation() for kuze.violation_log
   - Implemented regenerateWithCorrection() for safe completion
   - Implemented requiresSecondPassReview() for sensitive content detection
   - Implemented secondPassReview() placeholder function

## Six-Point Gate Verification Checklist

### 1. Code compiles without errors

**Verification:**
```bash
cd "c:\Users\Administrator\Documents\Nexus Apps\AI-Twin\server"
npm run build
```

**Expected Result:** No TypeScript compilation errors (pre-existing lint errors about @types/node and @supabase/supabase-js are expected and unrelated to Phase 2)

### 2. Validators are correctly exported and importable

**Verification:**
```bash
cd "c:\Users\Administrator\Documents\Nexus Apps\AI-Twin\server"
node -e "const v = require('./dist/validators/index.js'); console.log('runValidators:', typeof v.runValidators); console.log('logViolation:', typeof v.logViolation);"
```

**Expected Result:** Both functions are defined (not undefined)

### 3. promptBuilder loads operating_parameters from database

**Verification:**
Run a test chat request and check that the system prompt includes operating parameters block.

**Expected Result:** System prompt contains "OPERATIONAL PARAMETERS (binding, current as of last amendment):" section

### 4. Validators run on output and log violations

**Verification:**
Test with output that triggers a hard violation (e.g., mention pricing not in approved_pricing table).

**Expected Result:**
- Violation is logged in kuze.violation_log
- Client receives violation notification
- Output is refused or regenerated

### 5. Regeneration path works for hard violations

**Verification:**
Test with output that triggers a hard violation but can be corrected.

**Expected Result:**
- Original output is rejected
- Regeneration is attempted with correction instruction
- If regeneration passes, it is streamed to client
- Resolution in violation_log is 'regenerated'

### 6. Second-pass review detects sensitive content

**Verification:**
Test with output containing sensitive keywords (contract, legal, patent, etc.).

**Expected Result:**
- Second-pass review is triggered
- Console logs "Sensitive content detected - would require human review in production"
- Output is approved but logged

## Schema Changes

No new schema changes in Phase 2. Uses tables created in Phase 1:
- kuze.violation_log (for logging)
- kuze.approved_pricing (referenced by pricing validator)
- kuze.competitor_list (referenced by competitor validator)
- kuze.operating_parameters (loaded by promptBuilder)

## New Environment Variables

None added in Phase 2. Uses existing:
- SUPABASE_URL
- SUPABASE_SERVICE_ROLE_KEY
- ANTHROPIC_MODEL

## Open Questions for Brandon

1. **Second-pass review integration:** The current second-pass review is a placeholder that logs sensitive content. Should this integrate with Ilita for value alignment checks, or require human approval for certain categories?

2. **Escalation path:** The escalation path (notifying Brandon/Ben) is not yet implemented. Should this be added as a completion path for certain violation types?

3. **Regeneration retry limit:** Currently, regeneration is attempted once. Should there be multiple retry attempts with different correction strategies?

4. **Soft violation handling:** Soft violations are currently logged but still sent to the client. Should soft violations trigger a warning to the user or be handled differently?

## Known Issues

- Pre-existing lint errors about missing @types/node and @supabase/supabase-js type definitions (unrelated to Phase 2)
- regenerateWithCorrection uses process.env.ANTHROPIC_MODEL which may not be available in all contexts
- Second-pass review is a placeholder implementation
