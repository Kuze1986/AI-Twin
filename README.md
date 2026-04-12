# AI Twin

Full-stack application that mirrors a **specific person’s** voice, values, decision logic, and domain knowledge — not a generic chatbot. Stack: **React + Vite + Tailwind**, **Express (TypeScript)**, **Anthropic Claude**, **Supabase (Postgres + Auth)**, deployable to **Railway**.

## Prerequisites

- Node.js 20+
- A [Supabase](https://supabase.com) project
- An [Anthropic](https://www.anthropic.com) API key

## 1. Supabase setup

1. Create a project and note **Project URL**, **anon key**, and **service role** key (server only).
2. Run SQL migrations (Supabase SQL Editor or CLI):

   - Apply the file [`supabase/migrations/20260106000000_initial.sql`](supabase/migrations/20260106000000_initial.sql).

3. **Optional — Kuze production identity:** After migrations, run [`supabase/seed_kuze_identity.sql`](supabase/seed_kuze_identity.sql) in the SQL Editor (or `supabase db execute` with your project). That script **deletes existing `identity_profile` rows** (including any row created by `npm run seed`) and inserts the Kuze row so the app has a single canonical identity. If you use Kuze SQL, you can still run `npm run seed` afterward for `mode_config` upserts only — the script skips inserting identity when a row already exists — or run the Kuze SQL last so it remains the active row.

4. Enable **Email** auth (magic link and/or email/password) under Authentication → Providers.

## 2. Environment

Copy [`.env.example`](.env.example) to `.env` at the **repository root** (Vite is configured to read env from here).

| Variable | Where |
|----------|--------|
| `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` | Server + seed |
| `ANTHROPIC_API_KEY`, `ANTHROPIC_MODEL` | Server |
| `SESSION_SECRET`, `ADMIN_PASSWORD` | Server (admin cookie login) |
| `CORS_ORIGIN` | Browser origin (e.g. `http://localhost:5173` or your Railway URL) |
| `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` | Client (build-time) |

Optional tuning:

- `MAX_HISTORY_TOKENS` (default `3000`) — session history budget for Claude (rough token estimate: ~4 characters per token).
- `CONSOLIDATION_INTERVAL_MS` — how often the server scans for stale sessions (default 60s).
- `INACTIVITY_MS` — inactivity before **automatic long-term memory consolidation** (default 5 minutes).

## 3. Seed demo identity

```bash
npm install
npm run seed
```

Creates a demo `identity_profile` (if none exists) and upserts `mode_config` rows. Requires `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` in `.env`. For the Kuze identity instead, apply [`supabase/seed_kuze_identity.sql`](supabase/seed_kuze_identity.sql) after migrations (see **Supabase setup** above); you can still run `npm run seed` afterward to refresh `mode_config` without replacing Kuze. After modifying mode tags or `context_block_tag` in `scripts/seed.ts`, run `npm run seed` to upsert `mode_config` to Supabase. To refresh `identity_profile.context_blocks`, re-apply the Kuze SQL seed in the SQL Editor or edit identity in **Admin → Identity** (`npm run seed` skips identity insert when a row already exists).

## 4. Development

```bash
npm run dev
```

- SPA: [http://localhost:5173](http://localhost:5173) (proxies `/api` → Express).
- API: [http://localhost:3001](http://localhost:3001).

Sign up / sign in via Supabase on `/login`, then chat on `/`. Admin UI: `/admin/login` (password = `ADMIN_PASSWORD`), then `/admin/...`.

## 5. Prompt assembly (order)

On every chat request the **system** string is built in this order:

1. `persona_prompt` (first — personality is never left to model defaults)
2. Mode injection from `mode_config`
3. `behavioral_rules` (JSON)
4. Filtered `context_blocks` (by optional mode tag)
5. Top 10 `long_term_memory_global` rows by weight (then recency)
6. **Separate** `STYLE_FINGERPRINT` block from calibration JSON
7. Optional `context_override` from the API

Session turns are injected after that, **oldest-first truncated** to `MAX_HISTORY_TOKENS`.

## 6. Modes

| Mode | Intent |
|------|--------|
| `default` | Normal twin conversation |
| `sales` | Sales-agent posture; optional tag filters blocks (e.g. `sales`) |
| `ops` | Operations / decisions |
| `outreach` | Cold or warm outreach drafts |
| `debrief` | Review or critique a situation or document |

Customize injections under **Admin → Modes**.

## 7. Style calibration (walkthrough)

1. Open **Admin → Calibration**.
2. Paste samples or upload `.txt` / `.md`.
3. **Run analysis** — Claude returns a structured JSON fingerprint.
4. Review the JSON, then **Approve & save fingerprint** — stored on `identity_profile.style_fingerprint` **without** overwriting `persona_prompt`. The runtime always injects it as its own block.

## 8. Memory

- **Short-term:** `twin_memory` per session (user + assistant turns).
- **Long-term (Phase 1):** `long_term_memory_global` — shared twin-level facts. After **5 minutes** without activity, a background job consolidates the session transcript via Claude and inserts summaries.
- **Phase 2:** per-user `long_term_memory` table (not created in Phase 1).

## 9. Production / Railway

1. Set all env vars in Railway (including `NODE_ENV=production`, `CORS_ORIGIN` to your deployed site origin).
2. Build and start:

   ```bash
   npm run build
   npm run start
   ```

   Express serves the built SPA from `client/dist` and APIs under `/api`.

3. Prefer **one instance** for the consolidation timer; for multiple instances use an external scheduler or advisory locks (see code comments).

## 10. API summary

- `POST /api/chat` — Bearer Supabase JWT; SSE stream; creates session if `session_id` omitted.
- `POST /api/sessions`, `GET /api/sessions/:id/messages` — session helpers.
- `GET /api/public/identity` — public twin name.
- `POST /api/admin/login` — admin cookie session.
- Admin CRUD under `/api/admin/*` (identity, modes, LTM, sessions, calibrate).

---

For Phase 2, add `long_term_memory_user` with `user_id` and merge top-N global + top-M user entries in the prompt builder.
