// Lightweight smoke test for post-audit changes. Stays away from Anthropic
// calls so it costs nothing and runs offline. Hits only:
// - GET /api/health
// - POST /api/chat/demoforge with bad/missing key, malformed body
// - GET /api/admin/sessions (expect 401 without auth, but verifies route exists)

const BASE = process.env.BASE ?? 'http://localhost:3001'

const out = (label, ok, extra = '') => {
  const stamp = ok ? 'PASS' : 'FAIL'
  console.log(`[${stamp}] ${label}${extra ? ' — ' + extra : ''}`)
  return ok
}

let allOk = true
const must = (cond, label, extra) => {
  const ok = !!cond
  if (!ok) allOk = false
  return out(label, ok, extra)
}

const main = async () => {
  // 1. Health
  try {
    const r = await fetch(`${BASE}/api/health`)
    const j = await r.json().catch(() => ({}))
    must(r.status === 200 && j?.ok === true, 'GET /api/health returns 200 ok:true', `status=${r.status}`)
  } catch (e) {
    must(false, 'GET /api/health reachable', e.message)
  }

  // 2. /demoforge bad key -> 401
  try {
    const r = await fetch(`${BASE}/api/chat/demoforge`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-bioloop-key': 'wrong-key' },
      body: JSON.stringify({}),
    })
    must(r.status === 401, '/demoforge rejects wrong x-bioloop-key with 401', `status=${r.status}`)
  } catch (e) {
    must(false, '/demoforge bad-key request', e.message)
  }

  // 3. /demoforge missing key -> 401
  try {
    const r = await fetch(`${BASE}/api/chat/demoforge`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    })
    must(r.status === 401, '/demoforge rejects missing x-bioloop-key with 401', `status=${r.status}`)
  } catch (e) {
    must(false, '/demoforge missing-key request', e.message)
  }

  // 4. /demoforge with valid key but malformed body -> 400 validation
  const KEY = process.env.BIOLOOP_SERVICE_KEY ?? 'local-bioloop-test-key'
  try {
    const r = await fetch(`${BASE}/api/chat/demoforge`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-bioloop-key': KEY },
      body: JSON.stringify({ demoforge_session_id: 'sess-1' }),
    })
    must(r.status === 400, '/demoforge rejects malformed body with 400', `status=${r.status}`)
  } catch (e) {
    must(false, '/demoforge malformed-body request', e.message)
  }

  // 5. /api/admin/sessions without auth -> 401 (route exists)
  try {
    const r = await fetch(`${BASE}/api/admin/sessions`)
    must(r.status === 401, '/api/admin/sessions requires admin (401 without auth)', `status=${r.status}`)
  } catch (e) {
    must(false, '/api/admin/sessions reachable', e.message)
  }

  // 6. /api/admin/sessions with limit/offset still 401 (param accepted by route)
  try {
    const r = await fetch(`${BASE}/api/admin/sessions?limit=10&offset=0`)
    must(
      r.status === 401,
      '/api/admin/sessions?limit=10&offset=0 still 401 (gate before query parse)',
      `status=${r.status}`,
    )
  } catch (e) {
    must(false, '/api/admin/sessions paginated reachable', e.message)
  }

  console.log(`\n${allOk ? 'OK' : 'SOME FAILURES'} — ${allOk ? 'all checks passed' : 'see lines above'}`)
  process.exit(allOk ? 0 : 1)
}

void main()
