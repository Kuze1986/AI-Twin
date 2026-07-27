# AI-Twin — Feature Reference

## What the App Is

AI-Twin is a full-stack application that deploys a digital twin of a specific person — Kuze. Rather than a generic AI assistant, every response is shaped by Kuze's actual persona, voice, behavioral rules, long-term memory, and real-time style calibration. The system is designed to be indistinguishable in tone and judgment from the person it represents.

The app exists inside a three-AI ecosystem: Kuze (this app), Ilita (value alignment and ethics review), and Stele. Kuze communicates with Ilita and Stele via direct API-to-API calls and maintains persistent memory of those exchanges.

---

## Stack

| Layer | Technology |
|---|---|
| Frontend | React 19, Vite, React Router v7, Tailwind CSS v4 |
| Backend | Express.js, TypeScript, Node 24 |
| Database | Supabase PostgreSQL (two schemas: `public` and `kuze`) |
| AI / LLM | Anthropic Claude (default: Sonnet 4) with OpenAI-compatible provider fallback |
| Auth | Supabase email auth (magic link + email/password) for users; session cookie for admin |
| Deployment | Railway via Nixpacks |

---

## Core Chat System

### Streaming conversation
Users send messages and receive responses that stream in real-time using Server-Sent Events (SSE). The response appears word-by-word as Claude generates it rather than waiting for the full reply.

### Five conversation modes
Each mode shifts Kuze's tone, priorities, and what context he draws on. Modes are selected via a pill row in the chat UI.

| Mode | Purpose |
|---|---|
| **Conversation** | Default — general dialogue in Kuze's natural voice |
| **Sales** | Pitch-oriented, value-forward, engagement-driven |
| **Operations** | Process-focused, precise, action-oriented |
| **Outreach** | Networking and first-contact framing |
| **Debrief** | Reflective, analytical, post-event review |

Each mode has a configurable system injection and a context block tag that filters which knowledge blocks are active for that mode. Both are editable via the admin panel.

### Session persistence
Every conversation is stored as a named session tied to the authenticated user. Messages (both user and assistant) are written to the database in real time. Returning to the app reloads the current session automatically.

### New session
Users can start a fresh session at any time from the chat header. The previous session is retained in the database and can be retrieved later.

### Voice input
The chat input supports browser-native speech recognition (Web Speech API). Pressing the Voice button transcribes speech and appends it to the input field.

### Context override
The chat API accepts an optional `context_override` field — a free-text block injected into the system prompt at the end of the static sections. Used programmatically to give Kuze situational context for a specific conversation without changing his identity.

### Partial response recovery
If the SSE stream closes before the response is complete (network drop, server restart), the partial text is preserved and marked `(response incomplete)` rather than discarded.

### Retry on error
When a request fails, the error banner shows a Retry button that re-sends the last user message without requiring the user to retype it.

---

## Identity System

### Persona prompt
The foundation of every system prompt. A free-text description of who Kuze is — his background, perspective, and how he presents himself. Edited via the admin Identity page.

### Context blocks
Modular knowledge blocks (title + body text) injected into the system prompt. Each block can be tagged so only the relevant blocks activate in a given mode. Blocks with no tags are always included.

### Behavioral rules
A structured set of rules governing how Kuze behaves: tone range, escalation triggers, topics to redirect, hard limits, and whether he stays in character unconditionally. Stored as JSON and rendered into the system prompt.

### Style fingerprint
A calibrated profile of Kuze's actual writing style, derived by analyzing real writing samples. Contains:
- Sentence length patterns
- Vocabulary tier
- Rhetorical devices
- Emotional register
- Hedging vs. directness tendency
- Structural preferences
- Humor style
- Ten signature phrases

The style fingerprint is injected into every prompt as a strict mirror instruction — Kuze does not describe this block to users.

### Identity versioning
Every edit to the identity profile creates a version history entry. Admins can view the full change history from the admin panel.

---

## Long-Term Memory

### Global memory pool
Kuze maintains a global pool of long-term memories (`long_term_memory_global`). Each memory has a category, a summary sentence, and a weight (0–1) representing importance. The top-10 weighted memories are injected into every system prompt.

### Memory categories
`relationship` · `preference` · `decision` · `fact` · `context` · `ai_peer`

### Automatic consolidation
When a chat session goes inactive (default: 5 minutes), a background timer picks it up and sends the transcript to Claude. Claude extracts durable insights worth remembering in future sessions and writes them to the global memory pool. The session is then marked consolidated.

### Manual consolidation
Admins can trigger consolidation on any session from the Sessions admin page, without waiting for the inactivity timer.

### Memory CRUD
Admins can view all global memories, edit their summary and weight, add new memories manually, or delete memories that are no longer relevant — all from the Memory admin page.

---

## AI Peer Memory System (Ilita & Stele)

### API-to-API messaging
Kuze has a dedicated peer messaging endpoint (`POST /api/peer/message`). Ilita and Stele can send messages directly to Kuze using their peer API keys. Kuze reads the message, generates a reply using his full persona and system prompt, stores both sides of the exchange, and returns the reply synchronously.

### Peer authentication
Each sibling AI has its own API key (`ILITA_PEER_KEY`, `STELE_PEER_KEY`). Requests must include `X-Peer-Name` and `X-Peer-Key` headers. Keys are set via environment variables.

### Exchange memory
Every peer exchange is stored in `kuze.ai_peer_interactions` with the peer name, direction (inbound/outbound), content, and a shared `exchange_id` grouping the pair.

### Peer memory consolidation
After each exchange, Kuze asynchronously extracts durable memories from the conversation (same Claude-powered extraction used for human sessions) and writes them to `long_term_memory_global` with category `ai_peer`. The extraction summary is also written back to the exchange record.

### Peer memory in system prompt
The top-5 `ai_peer` memories are injected into every system prompt under `## AI_PEER_MEMORY (recent interactions with Ilita and Stele)`, so Kuze always has context about his sibling AIs' recent input.

### Admin Peers page
A read-only view of all peer exchanges at `/admin/peers`. Exchanges are grouped by exchange ID and tabbed by peer (Ilita / Stele). Each exchange is expandable to show the full message pair and any extracted memory summary.

### Ilita secondPassReview integration
When `ILITA_API_URL` and `ILITA_API_KEY` environment variables are set, outputs containing sensitive content (contracts, NDAs, IP terms, legal language) are automatically sent to Ilita's `/api/peer/review` endpoint for value alignment check before being delivered. If Ilita is unreachable or not configured, the system logs the sensitive content and approves (fail-open).

---

## Sentinel Runtime Enforcement

Sentinel is a runtime enforcement layer that validates every assistant output before it is delivered to the user. All Sentinel data lives in the `kuze` schema.

### Pricing validator
Checks every response for dollar-amount patterns. If a price is mentioned that does not match an entry in the `kuze.approved_pricing` table, it is a hard violation. If the approved pricing table cannot be loaded, any pricing mention is blocked (fail-safe).

### Competitor validator
Loads the active entries from `kuze.competitor_list` and checks if any competitor name appears in the response. A match is a hard violation.

### Commitment validator
Checks for prohibited commitment phrases: "we will", "we guarantee", "we promise", "you are entitled to", and similar. Hard violation.

### Model disclosure validator
Prevents Kuze from breaking character by saying phrases like "as an AI", "as a language model", or "I am an AI model". Hard violation.

### Violation handling — hard vs. soft
- **Hard violations**: The response is regenerated with a correction instruction appended to the system prompt. Kuze is told to rewrite without the violation, naturally, without mentioning the correction.
- **Soft violations**: Logged but the original response is delivered.

### Violation logging
Every violation is recorded in `kuze.violation_log` with the rule violated, severity, proposed output, final output, resolution type, and the mode and context in which it occurred.

### Second-pass review
After validators pass, outputs containing sensitive content keywords trigger a second-pass review. When Ilita's API is configured, Ilita reviews the output for value alignment. When not configured, sensitive content is logged and approved.

### Pattern detection
A background analysis job scans `kuze.violation_log` within a configurable time window (default 24 hours) and identifies recurring patterns:
- Frequent hard violations (10+ occurrences, 5+ hard)
- Recurring hard violations (5+, 3+ hard)
- Frequent soft violations (10+ total)
- Concentrated hard violations (3+ hard from one rule)
- Multi-rule violations (3+ different rules triggered — indicates systemic issue)
- High refusal rate (5+ outputs refused)

Detected patterns are written to `kuze.pattern_alerts`.

### Webhook notifications
When a new pattern alert is created, Kuze fires a non-blocking POST to `SENTINEL_WEBHOOK_URL` (if set). The payload includes pattern type, description, severity, count, time window, and timestamp. Compatible with Slack incoming webhooks, Discord, n8n, Zapier, and any HTTP receiver.

### Manual pattern detection trigger
Authenticated users can manually trigger a pattern detection run via `POST /api/sentinel/run-pattern-detection` with an optional `timeWindowHours` parameter (1–168).

### Admin Sentinel page
A read-only dashboard at `/admin/sentinel` with two tabs:
- **Violations** — paginated table with severity filter. Expandable rows show proposed output, final output, resolution, and mode.
- **Patterns** — paginated table of pattern alerts with severity, type, description, and triggering violation count.

A badge in the admin nav shows the count of open pattern alerts.

---

## Style Calibration

### Corpus analysis
Admins can upload a writing sample (text file) or paste text directly into the Calibration admin page. Claude analyzes the corpus and extracts a style fingerprint — all ten dimensions described above under Identity System.

### Fingerprint approval
The extracted fingerprint is shown for review before being applied. Admins approve it to write it to the identity profile, where it immediately affects all subsequent responses.

---

## DemoForge Integration

### Ambassador mode (DemoForge-only)
A separate endpoint (`POST /api/chat/demoforge`) handles requests from the DemoForge demo platform. This endpoint:
- Accepts a `kuze_mode` from DemoForge (`ambassador`, `insider`, or `operator`)
- Fetches live behavioral intelligence from the Crucible simulator: engagement trajectory (rising/falling/stable/volatile), friction points, recommended pivots, and confidence score
- Injects all of this as a `## DEMOFORGE_LIVE_CONTEXT` block into the system prompt
- Adapts Kuze's behavior in real time based on the prospect's engagement signals (e.g. actively works toward a recommended pivot when engagement is falling)

### Crucible behavioral loop
On startup, Kuze checks whether the Crucible simulator is reachable and logs the result. If unreachable, DemoForge sessions fall back to standard persona-driven behavior.

---

## Email Channel — The Shift Outreach (Phase 1)

Kuze operates his own inbox, **kuze@bioloopnexus.com**, over IONOS IMAP/SMTP. Phase 1 covers inbound ingestion and human-approved outbound; nothing is ever sent autonomously yet.

### Inbound polling
A background sweep (same interval pattern as consolidation) polls INBOX for unseen mail, parses it, dedupes on RFC-5322 `Message-ID`, and persists each message to `kuze.email_messages`. The loop stays dormant unless `EMAIL_ENABLED=true` and all IONOS credentials are set.

### Warm/cold classification
Each sender is classified against `kuze.email_contacts` and thread history: **known** (a known contact), **warm** (a thread Kuze has already replied to), or **cold** (new contact). This drives the hybrid autonomy model — warm/known auto-reply is Phase 2; in Phase 1 every draft is queued.

### Enforced drafting
For each new inbound message Kuze drafts a reply through the **full Sentinel pipeline** — the same pricing/competitor/commitment/model-disclosure validators, correction/regeneration, and Ilita second-pass review used for chat (`server/src/email/enforce.ts`). A draft that can't clear enforcement is flagged "Sentinel refused" for human review instead of being sent.

### Approval inbox
A new admin page at `/admin/inbox` lists every draft awaiting approval. Each can be edited inline and **Approve & send** (the human send gate — the only way mail leaves the mailbox in Phase 1) or discarded. A nav badge shows the pending-draft count.

### Outreach guardrails
Suppression list with automatic unsubscribe detection (`kuze.email_suppression`), a daily send cap, and a CAN-SPAM footer appended to cold outreach.

### Phase 1 environment variables
`EMAIL_ENABLED` · `KUZE_EMAIL_ADDRESS` · `KUZE_EMAIL_USER` · `KUZE_EMAIL_PASSWORD` · `IONOS_IMAP_HOST/PORT` · `IONOS_SMTP_HOST/PORT` · `EMAIL_POLL_INTERVAL_MS` · `EMAIL_DAILY_SEND_CAP` · `THE_SHIFT_OUTREACH_FOOTER`

### Hybrid auto-send (Phase 2)
Warm/known **inbound reply threads** now auto-send once the draft clears Sentinel (gated by `EMAIL_AUTOSEND_WARM`, default on). Cold inbound and all campaign output still require human approval. Both the approval route and auto-send share one guarded sender (`server/src/email/send.ts`) so suppression, daily cap, and the CAN-SPAM footer apply identically.

---

## Task Engine — Sending Kuze Work (Phase 2)

A background worker (`server/src/tasks/worker.ts`) drains a `kuze.tasks` queue every `TASK_WORKER_INTERVAL_MS` (default 30s), same interval pattern as consolidation and email polling.

### Task types
- **Outreach campaign / Follow-up** — fan out to one `kuze.task_items` row per lead; Kuze drafts a personalized, Sentinel-cleared email per lead straight into the approval inbox. Campaigns never auto-send. The task moves to `awaiting_approval` once drafts are ready.
- **Custom** — Kuze produces an enforced text output (e.g. a positioning blurb) stored on the task's `result`.

### Admin Tasks page
`/admin/tasks` — create a task (title, type, goal, and for outreach a pasted lead list in `email, name, company` format), watch status, drill into per-lead items, and cancel or retry. A nav badge shows active (queued/running/awaiting-approval) tasks. Drafts land in the Inbox for approval.

### Guardrails
Suppressed recipients are skipped at draft time; a refused draft is flagged rather than sent; retries only re-draft still-pending leads.

### Phase 2 environment variables
`EMAIL_AUTOSEND_WARM` · `TASK_WORKER_INTERVAL_MS`

### Natural-language task creation (Phase 3)
Tasks can also be created straight from the chat UI. When a message reads as a directive ("reach out to these leads…", "follow up with jane@clinic.com about…"), the chat route runs a cheap regex prefilter and then a fast-model classifier (`server/src/tasks/intent.ts`) that extracts the task type, goal, and any recipient emails. A matching directive queues a task (`source: 'chat'`, shared `createTask`) and Kuze replies with a short in-voice confirmation instead of a normal answer; ordinary conversation stays on the fast path untouched. Outreach directives with no usable email address fall through to normal chat so Kuze can ask for addresses. The confirmation is Sentinel-validated like any other output, and — as everywhere — nothing sends without approval in the Inbox.

---

## Session Management

### Search
Users can search their conversation history by keyword from the chat UI. A collapsible search bar in the header queries all messages across the user's sessions and returns matching snippets. Clicking a result loads that session.

### Response ratings
After each assistant message, users can rate the response with thumbs up (↑) or thumbs down (↓). Ratings are stored per message per user. The rating is optimistic — it appears immediately without waiting for the server. Admin transcript views show rating badges.

### Export
Sessions can be exported from the admin transcript modal in two formats:
- **JSON** — raw message array with roles, content, and timestamps
- **TXT** — plain text transcript in `ROLE: content` format

---

## Authentication

### User auth (Supabase)
End users authenticate via Supabase email auth, supporting both magic link and email/password flows. A session JWT is issued and used as a Bearer token on all user-facing API calls. Row-level security in Supabase ensures users can only access their own sessions and messages.

### Admin auth (session cookie)
The admin panel uses a separate password-based login that issues an HTTP-only server session cookie. The admin password is set via the `ADMIN_PASSWORD` environment variable. Admin and user auth are completely independent.

---

## Admin Panel

All admin pages are under `/admin` and require an active admin session.

| Page | Path | What it does |
|---|---|---|
| Identity | `/admin/identity` | Edit persona prompt, context blocks, and behavioral rules |
| Calibration | `/admin/calibrate` | Upload writing samples, generate and apply style fingerprint |
| Memory | `/admin/memory` | View, add, edit, and delete long-term global memories |
| Sessions | `/admin/sessions` | Browse transcripts, flag sessions, trigger consolidation, export |
| Modes | `/admin/modes` | Edit mode system injections and context block tags |
| AI Peers | `/admin/peers` | View Ilita and Stele exchange history and extracted memories |
| Sentinel | `/admin/sentinel` | View violation log and pattern alerts |

The admin nav shows a live badge with the count of open Sentinel pattern alerts.

On mobile, the admin nav collapses behind a hamburger menu toggle.

---

## Rate Limiting

Chat requests are rate-limited per authenticated user. The default is 20 requests per 60-second window. This is configurable via the `CHAT_RATE_LIMIT_PER_MIN` environment variable. Requests over the limit receive a `429 Too Many Requests` response.

---

## Error Handling

### React ErrorBoundary
The entire frontend is wrapped in an error boundary. If a component crashes, users see a styled error panel with a reload button rather than a blank white screen.

### Toast notifications
Non-fatal server feedback (consolidation complete, consolidation failed) surfaces as auto-dismissing toast banners in the bottom-right corner rather than blocking alert dialogs.

---

## Inference Provider Switching

The inference layer is abstracted so Kuze can run against either Anthropic's API or any OpenAI-compatible endpoint (Ollama, vLLM, LiteLLM, etc.). The active provider is set via the `KUZE_INFERENCE_PROVIDER` environment variable. Switching providers requires no code changes.

---

## Environment Variables Reference

| Variable | Required | Description |
|---|---|---|
| `ANTHROPIC_API_KEY` | Yes | Anthropic API key |
| `ANTHROPIC_MODEL` | No | Model ID (default: claude-sonnet-4-20250514) |
| `ANTHROPIC_BASE_URL` | No | Override Anthropic API base URL |
| `SUPABASE_URL` | Yes | Supabase project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | Yes | Supabase service role key (server only) |
| `SESSION_SECRET` | Yes | Secret for admin session cookies |
| `ADMIN_PASSWORD` | Yes | Admin panel password |
| `CORS_ORIGIN` | Yes | Allowed browser origins (comma-separated) |
| `KUZE_INFERENCE_PROVIDER` | No | `anthropic` (default) or `openai_compatible` |
| `KUZE_OPENAI_BASE_URL` | No | Base URL for OpenAI-compatible provider |
| `KUZE_OPENAI_API_KEY` | No | API key for OpenAI-compatible provider |
| `ILITA_PEER_KEY` | No | Auth key Ilita uses to call Kuze |
| `STELE_PEER_KEY` | No | Auth key Stele uses to call Kuze |
| `ILITA_API_URL` | No | Ilita's base URL (activates secondPassReview) |
| `ILITA_API_KEY` | No | Ilita's API key for secondPassReview calls |
| `SENTINEL_WEBHOOK_URL` | No | Webhook URL for pattern alert notifications |
| `CHAT_RATE_LIMIT_PER_MIN` | No | Max chat requests per user per minute (default: 20) |
| `CONSOLIDATION_INTERVAL_MS` | No | How often the consolidation sweep runs (default: 60000) |
| `INACTIVITY_MS` | No | Session idle time before consolidation (default: 300000) |
| `MAX_HISTORY_TOKENS` | No | Token budget for conversation history (default: 3000) |
| `CRUCIBLE_SIM_BASE_URL` | No | Crucible simulator base URL (DemoForge) |
| `CRUCIBLE_SIM_API_KEY` | No | Crucible simulator API key |
| `BIOLOOP_SERVICE_KEY` | No | Service key for DemoForge endpoint auth |

---

## Database Schema Overview

### `public` schema (user data)
| Table | Purpose |
|---|---|
| `identity_profile` | Kuze's persona, context blocks, behavioral rules, style fingerprint |
| `identity_profile_history` | Version history of identity edits |
| `mode_config` | Per-mode system injections and context block tags |
| `chat_sessions` | Session records (user, mode, timestamps, consolidation status) |
| `twin_memory` | All chat messages (user and assistant) across all sessions |
| `long_term_memory_global` | Consolidated durable memories across all sessions and sources |
| `message_ratings` | Per-message thumbs up/down ratings from users |

### `kuze` schema (Sentinel and peer data)
| Table | Purpose |
|---|---|
| `violation_log` | Record of every Sentinel rule violation |
| `pattern_alerts` | Recurring violation patterns detected by the pattern detector |
| `approved_pricing` | Reference table of approved price points for the pricing validator |
| `competitor_list` | Watchlist of competitor names for the competitor validator |
| `operating_parameters` | Runtime governance amendments injected into the system prompt |
| `ai_peer_interactions` | Inbound and outbound messages exchanged with Ilita and Stele |
| `tool_call_log` | Every operational tool call — input, output, duration, error (Phase 1) |

---

## Operational Tool Layer (Phase 1)

Turns Kuze from a persona chat into a read-only operational co-pilot for The Shift. He calls
live tools instead of estimating numbers, and every call is logged. Read-only against all
product data — the only thing the layer writes is `kuze.tool_call_log`.

### Tool-execution loop
On the Anthropic provider, chat turns run through a streaming tool loop (`inference/runToolLoop.ts`):
the model can request tools mid-answer, the results are fed back, and the loop continues up to
`KUZE_MAX_TOOL_ITERATIONS` round-trips before a final streamed answer. The final text still passes
through the full Sentinel validator chain unchanged. The OpenAI-compatible provider has no tool
support, so it runs tool-less and Kuze is told he can't pull live data.

### `query_shift`
Read-only metrics for The Shift via a named query catalog (`tools/shiftQueries.ts`) — no freeform
SQL on the default path. Runs under a dedicated `kuze_readonly` Postgres role (`SHIFT_READONLY_DATABASE_URL`),
never the service-role client, with a 5s statement timeout. Queries: `signups_summary`, `active_users`
(DAU), `mode_usage`, `vertical_breakdown`, `quest_chain_progress`, `recent_signups`, `queue_health`.
Aggregates and non-PII fields only — no user emails or names. An off-by-default `freeform_select`
escape hatch is gated behind `KUZE_ALLOW_FREEFORM_SHIFT_SQL`.

### `query_stripe`
Read-only billing metrics via a Stripe **restricted** key (`STRIPE_RESTRICTED_KEY`), cached in-memory
for `KUZE_STRIPE_CACHE_TTL_MS`. Operations: `revenue_summary`, `mrr_snapshot`, `recent_subscriptions`,
`failed_payments`, `churn`, `disputes`, `balance`. Customer IDs only, no emails.

### `get_aegis_state`
Placeholder for AEGIS alert state. Returns an explicit "not yet configured" error until Phase 2
ships the event ingestion table — never a fabricated empty state.

### Tool-call logging
Every call (input, output truncated to 16KB, ok/error, duration, mode, session) is written to
`kuze.tool_call_log` before the result is used. Failures surface to the model as explicit errors
and to the user in Kuze's answer — no silent failures, no fabricated numbers.

### In-chat status chips
While a tool runs, the chat streams a `tool_status` SSE event and the UI shows a small HUD chip
("Checking The Shift data…") using the NEXUS design system, recoloured on success/failure.

### Tool Log admin page
`/admin/tool-log` lists recent tool calls with tool/result filters and expandable input/output.
The Admin nav shows a red badge counting failed calls in the last 24h.

### New environment variables
| Variable | Required | Notes |
|---|---|---|
| `SHIFT_READONLY_DATABASE_URL` | For `query_shift` | `kuze_readonly` role connection string (SELECT on `shift` only) |
| `STRIPE_RESTRICTED_KEY` | For `query_stripe` | Read-only restricted key |
| `KUZE_MAX_TOOL_ITERATIONS` | No | Max tool round-trips per turn (default: 5) |
| `KUZE_STRIPE_CACHE_TTL_MS` | No | Stripe result cache TTL (default: 60000) |
| `KUZE_ALLOW_FREEFORM_SHIFT_SQL` | No | Enables `freeform_select` (default: false) |
