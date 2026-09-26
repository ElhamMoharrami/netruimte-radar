# Netruimte Radar

Autonomous early-warning agent for Dutch businesses facing future electricity-grid
constraints. Continuously monitors public sources for signals (fleet electrification,
new machinery, facility expansion, heat electrification, solar/battery installations,
sustainability announcements, energy hiring, …), extracts evidence, scores the
opportunity, decides autonomously whether to stop, investigate further or act, and
records everything in an auditable activity log.

## Repository layout

```
apps/
  api/       Hono HTTP API (Cloudflare-Workers compatible), wires everything together
  web/       React + Vite + Tailwind + Recharts dashboard (`/radar`)
packages/
  shared/    Runtime-validated domain models (zod) shared between web and api
  core/      Business logic: extractors, scoring, policy, activity log,
             grid context, sources, autonomous run service
data/
  demo/      Deterministic demo fixtures used before external integrations arrive
docs/
  TODO.md    Living checklist of what has been built and what is still open
```

## Prerequisites

- Node ≥ 22.5 (project pinned to `v25.2.1` via `.nvmrc`).
  Uses the built-in `node:sqlite` module, so no native SQLite binding is needed.
- pnpm ≥ 9 (`npm i -g pnpm`)

## Quick start

```bash
pnpm install
cp .env.example .env
pnpm dev            # runs api (:8787) and web (:5173) in parallel
```

Then open <http://localhost:5173>. Health check: <http://localhost:8787/health>.

## Scripts

```
pnpm dev            api + web
pnpm build          build all packages then all apps
pnpm typecheck      tsc --noEmit across the workspace
pnpm test           vitest across the workspace
pnpm lint           eslint across the workspace
pnpm format         prettier --write
```

## Modes

### Demo mode (default)
Set `DEMO_MODE=true` (default in `.env.example`) to use the deterministic
`DemoSourceDiscoveryProvider` / `DemoGridContextProvider` and to record actions
locally instead of dispatching them. This is the mode the hackathon demo runs
in — the whole pipeline works with zero external credentials.

### Progressive integration
Swap in real integrations by providing credentials (see
[docs/TODO.md](docs/TODO.md#what-remains-before-enabling-real-apify--n8n-credentials)
for the step-by-step):

- `AI_PROVIDER` + one of `{ANTHROPIC,OPENAI,GEMINI}_API_KEY` → enables the matching evidence extractor (always falls back to rule-based on error)
- `APIFY_TOKEN` + `APIFY_ACTOR_ID` → enables `ApifySourceDiscoveryProvider`
- `N8N_BASE_URL` + `NOTIFICATION_ALLOWLIST` → enables `N8nAutomationClient` for real dispatch
- `SERVICE_TOKEN` → enables `POST /api/runs/scheduled` for cron-triggered runs

The core pipeline never depends on any of these being present.

### Evidence-extraction providers

Three interchangeable AI providers, all satisfying the same `EvidenceExtractor`
interface and producing exactly the same Zod-validated domain object. The
selected provider is wrapped in `FallbackEvidenceExtractor` — any request-time
failure (rate limit, timeout, malformed JSON) falls back to the rule-based
extractor and the run continues.

| `AI_PROVIDER` value | Extractor | Requires |
|---|---|---|
| `rules` | `RuleBasedEvidenceExtractor` | nothing — deterministic Dutch/English patterns |
| `anthropic` | `AnthropicEvidenceExtractor` — tool-use, prompt cached | `ANTHROPIC_API_KEY`, optional `ANTHROPIC_MODEL` (default `claude-opus-4-7`) |
| `openai` | `OpenAIEvidenceExtractor` — strict JSON Schema | `OPENAI_API_KEY`, optional `OPENAI_MODEL` (default `gpt-4o-mini`), optional `OPENAI_BASE_URL` |
| `gemini` | `GeminiEvidenceExtractor` — `responseSchema` | `GEMINI_API_KEY`, optional `GEMINI_MODEL` (default `gemini-1.5-flash`) |
| unset | auto — whichever key is present (prefers Anthropic → OpenAI → Gemini) | at least one AI key, or falls back to rule-based |

If `AI_PROVIDER` names a provider whose key is missing, the API logs a warning
and starts in rule-based mode — startup never fails on missing AI credentials.
`GET /api/wiring` reports the active `aiProvider` and the reason. API keys are
read from `process.env` only; the frontend never sees them.

### Offline mode
Append `?offline=true` to any run endpoint (or open the web app with
`?offline=true` in the URL) to force demo providers even if credentials are
configured — a safe toggle for live presentations.

## Key endpoints

| Route | Purpose |
|---|---|
| `POST /api/runs/demo` | Manual autonomous run (no auth) |
| `POST /api/runs/scheduled` | Service-triggered run — requires `X-Service-Token` |
| `GET  /api/runs` | Persisted run history |
| `GET  /api/opportunities` | All opportunities |
| `GET  /api/opportunities/:id` | Detail (company, signals, evidence, decisions) |
| `GET  /api/opportunities/:id/activity` | Ordered activity log |
| `GET  /api/opportunities/:id/history` | Decisions + reassessments |
| `GET  /api/opportunities/:id/dossier` | Structured dossier with uncertainty / gaps |
| `POST /api/demo/reset` | Wipe every record (DEMO_MODE only) |
| `POST /api/demo/inject-conflict/:opportunityId` | Trigger reassessment demo |
| `POST /api/demo/simulate/{apify,n8n}-fail` | Force the failure path |

## Frontend pages

- `/radar` — metrics + autonomous activity feed + trigger button
- `/opportunities` — sortable list
- `/opportunities/:id` — company, evidence with quotes, decisions, reassessment history, dossier
- `/runs` — persisted run history
- `/demo` — real-backend demo controls

## Netlify deployment

The frontend deploys as a static SPA (`apps/web/dist`) and the Hono API is
exposed through a single Netlify Function that wraps the existing app.ts +
context.ts unchanged.

### Files added for deployment

- `netlify.toml` — build command, publish directory, functions directory, SPA fallback.
- `netlify/functions/api.ts` — one-file adapter. Constructs the same
  `AppContext` + `createApp(ctx)` the local server uses, adds a `/api/health`
  alias, and hands each `Request` straight to `app.fetch`. Declarative
  `config.path = '/api/*'` catches every API route without any manual
  redirect gymnastics. (`.ts` extension picked deliberately — Netlify's
  bundler defaults to esbuild for `.ts`, which inlines workspace packages
  like `@netruimte/shared`; `.mts` would default to `nft` which doesn't
  ship workspace-linked deps and would leave them missing at runtime.)
- `netlify/functions/package.json` — 2-line `{"type": "module"}` so the
  `.ts` function is treated as ESM.

### Netlify build settings

Set these on the Netlify site (Site configuration → Build & deploy → Build
settings). They're also in `netlify.toml` so it works with **no manual
overrides** if the toml is left in charge:

| Setting | Value |
|---|---|
| Base directory | *(leave empty — repo root)* |
| Build command | `pnpm install --frozen-lockfile && pnpm build` |
| Publish directory | `apps/web/dist` |
| Functions directory | `netlify/functions` |
| Node version | `24` (via `NODE_VERSION` env in `netlify.toml`, matches `.nvmrc`) |
| Package manager | pnpm (auto-detected from `packageManager` in root `package.json`) |

### Expected production URLs

Assuming a Netlify site at `https://<site>.netlify.app`:

| URL | Served by |
|---|---|
| `https://<site>.netlify.app/` | SPA `/radar` (Vite bundle, static) |
| `https://<site>.netlify.app/radar` | SPA (static + SPA fallback) |
| `https://<site>.netlify.app/opportunities/:id` | SPA (static + SPA fallback) |
| `https://<site>.netlify.app/runs`, `/demo` | SPA |
| `https://<site>.netlify.app/api/health` | Netlify Function |
| `https://<site>.netlify.app/api/wiring` | Netlify Function |
| `https://<site>.netlify.app/api/runs/scheduled` | Netlify Function (auth: `X-Service-Token`) |
| `https://<site>.netlify.app/api/runs` | Netlify Function |
| `https://<site>.netlify.app/api/opportunities` | Netlify Function |
| `https://<site>.netlify.app/api/opportunities/:id` | Netlify Function |
| `https://<site>.netlify.app/api/opportunities/:id/dossier` | Netlify Function |

Users **never** need to call `/.netlify/functions/api` directly.

### Environment variables (set on Netlify only — never checked in)

All server-side; never exposed to the frontend bundle. Set in
Netlify → Site configuration → Environment variables:

| Variable | Purpose |
|---|---|
| `SERVICE_TOKEN` | Required to enable `POST /api/runs/scheduled`. Without it that endpoint returns 503 (safer than pretending). |
| `APIFY_TOKEN` | Enables `ApifySourceDiscoveryProvider`. Missing → demo provider in demo mode, or startup error in production mode. |
| `APIFY_ACTOR_ID` | Actor ID/username-slug the provider runs. Required with `APIFY_TOKEN` unless `APIFY_DATASET_ID` is set. |
| `APIFY_DATASET_ID` | Optional alternative — read an existing dataset instead of running the actor. |
| `AI_PROVIDER` | `rules` \| `anthropic` \| `openai` \| `gemini` (unset → auto). Missing keys for the selected provider degrade cleanly to rule-based. |
| `OPENAI_API_KEY` | Required with `AI_PROVIDER=openai`. |
| `ANTHROPIC_API_KEY` | Required with `AI_PROVIDER=anthropic`. |
| `GEMINI_API_KEY` | Required with `AI_PROVIDER=gemini`. |
| `GRID_PROVIDER` | `demo` \| `netbeheer-nl` (unset → auto — `demo` when `DEMO_MODE=true`, else `netbeheer-nl`). |
| `DATABASE_PROVIDER` | `sqlite` \| `turso` (unset → auto — `turso` if `TURSO_DATABASE_URL` set, else `sqlite`). **Production on Netlify MUST use `turso`** — see below. |
| `TURSO_DATABASE_URL` | libSQL URL (`libsql://<name>-<org>.turso.io`) from the Turso dashboard. Required when `DATABASE_PROVIDER=turso`. |
| `TURSO_AUTH_TOKEN` | Auth JWT scoped to that database. Required for `libsql://` URLs. |
| `N8N_BASE_URL` | Enables `N8nAutomationClient`. If unset in production mode, actions are logged but never dispatched. |
| `N8N_WEBHOOK_TOKEN` | Optional shared secret sent on `x-n8n-token`. |
| `NOTIFICATION_ALLOWLIST` | Comma-separated internal recipients allowed to receive `notify_stakeholder`. Empty → notifications are refused. **Never put scraped businesses here.** |
| `DEMO_MODE` | `true` (deterministic providers) or `false` (real integrations required). Defaults to `true`. |

### Production persistence — Turso is required on Netlify

Netlify Functions run each request in a Lambda that may be a cold container.
`node:sqlite :memory:` therefore cannot hold state across requests: a scan
writes to one container's DB and the very next dashboard request lands on a
different container and sees nothing. Production **must** use Turso/libSQL
so every function invocation reads and writes the same durable database.

Setup — one time per environment:

```bash
# 1) install the Turso CLI (macOS)
brew install tursodatabase/tap/turso
turso auth login

# 2) create the database and grab its URL + a scoped auth token
turso db create netruimte-radar-prod          # or any name
turso db show netruimte-radar-prod --url      # → libsql://…-<org>.turso.io
turso db tokens create netruimte-radar-prod   # → paste as TURSO_AUTH_TOKEN

# (optional) open a SQL shell against it
turso db shell netruimte-radar-prod
```

Set these Netlify environment variables (Site configuration → Environment
variables → Add a variable):

| Variable | Value |
|---|---|
| `DATABASE_PROVIDER` | `turso` |
| `TURSO_DATABASE_URL` | `libsql://…-<org>.turso.io` from step 2 |
| `TURSO_AUTH_TOKEN` | JWT from `turso db tokens create` |

**Schema initialization is automatic.** The libSQL adapter runs the full
`SCHEMA_SQL` on every cold start (`CREATE TABLE IF NOT EXISTS …`), so no
separate migration command is needed — deploy the function and the tables
exist on first request. To reset the schema manually:

```bash
turso db shell netruimte-radar-prod < apps/api/src/persistence/schema.sql  # not required
# or drop-and-let-recreate:
turso db shell netruimte-radar-prod "DROP TABLE grid_events; …"
```

**Do not set `SQLITE_PATH` on Netlify** — it is ignored when
`DATABASE_PROVIDER=turso`, and Netlify's Lambda filesystem outside `/tmp` is
read-only anyway.

Verifying persistence across two separate requests:

```bash
BASE=https://<your-site>.netlify.app
TOKEN=<your SERVICE_TOKEN>

# Request 1 — trigger a scan (writes grid events + activity + run history to Turso)
curl -sf -X POST -H "X-Service-Token: $TOKEN" $BASE/api/runs/scheduled | jq .summary
# → { sourcesDiscovered: 3, gridUpdatesDetected: 3, failures: 0, incomplete: false }

# Request 2 — read from a different Lambda invocation (dashboard fetch)
curl -sf $BASE/api/grid-events?limit=6 | jq '.data | length'
# → 3   ← proves cross-invocation persistence

curl -sf $BASE/api/runs?limit=5   | jq '.data | length'
# → ≥ 1

curl -sf $BASE/api/activity/recent | jq '.data | length'
# → many

curl -sf $BASE/api/wiring | jq '.databaseProvider, .databaseProviderReason'
# → "turso"
# → "DATABASE_PROVIDER=turso"  (or "auto — TURSO_DATABASE_URL present")
```

If step-2's `data.length` is `0` after step-1 succeeded, either
`DATABASE_PROVIDER` is not set to `turso`, or the two Netlify Function
invocations are still hitting different in-memory sqlite dbs — check
`/api/wiring` first.

Frontend never sees any of these — Vite exposes only `VITE_*` prefixed vars,
and this project defines none.

### Deployment verification checklist

Run these three checks after every deploy — they exercise the whole surface
n8n Cloud depends on:

```bash
BASE=https://<your-site>.netlify.app
TOKEN=<your SERVICE_TOKEN>

# 1) health — proves the function cold-starts and the ctx boots cleanly
curl -sf $BASE/api/health
# → {"status":"ok","service":"netruimte-radar-api","demoMode":…}

# 2) wiring — proves every provider selection came out right
curl -sf $BASE/api/wiring
# → {"aiProvider":"…","sourceProvider":"…","gridProvider":"…",
#     "scheduledEndpointEnabled":true, …}

# 3) authenticated scheduled run — the exact call n8n Cloud makes
curl -sf -X POST $BASE/api/runs/scheduled \
  -H "X-Service-Token: $TOKEN"
# → {"wiring":{…},"summary":{"trigger":"scheduled","opportunitiesCreated":…}}
```

Failure modes (each has a clear signature):

| Symptom | Likely cause |
|---|---|
| `/api/health` → 502 | `createContext()` threw at cold-start. Check function logs — most likely `DEMO_MODE=false` + missing Apify creds. |
| `/api/runs/scheduled` → 503 | `SERVICE_TOKEN` is not set on Netlify. |
| `/api/runs/scheduled` → 401 | `SERVICE_TOKEN` set but the request header is missing / doesn't match. |
| Every SPA route 404 | `netlify.toml` catch-all not deployed — verify redirects in the Netlify UI. |
| Frontend loads but `/api/*` returns index.html | Function didn't deploy — check "Functions" tab; ensure `netlify/functions/api.ts` is present. |

### Local test with Netlify CLI (optional)

```bash
npx netlify-cli dev
# serves the SPA on :8888 and runs the function locally on :8888/api/*
```

## Safety invariants

Enforced in code, not just documented:

- **No automated outreach.** `notify_stakeholder` requires at least one recipient in `NOTIFICATION_ALLOWLIST`; the client refuses to POST otherwise.
- **No fake data in production.** `DEMO_MODE=false` without an Apify source provider raises at boot rather than silently substituting the demo provider.
- **No shared-grid claims.** The policy engine issues `request_grid_verification` if a decision would require asserting shared grid infrastructure without verified topology.
- **Bounded retries everywhere.** Discovery, extraction, dispatch: at most one retry, then log a failure — never a silent retry loop.
- **Every extracted claim carries a source URL.** Grid-context readings include their `source` and `checkedAt`.
