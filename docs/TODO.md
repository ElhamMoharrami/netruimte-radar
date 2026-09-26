# TODO

Living checklist. Updated as each step is completed.

## Foundation phase (steps 1–10) — DONE

- [x] Monorepo scaffold + Hono/React/Vite/Tailwind/Recharts
- [x] Domain models (zod) + `node:sqlite` repositories
- [x] Deterministic demo fixtures + `DemoSourceDiscoveryProvider`
- [x] Rule-based + Anthropic (tool-use, prompt-cached) extractors + `FallbackEvidenceExtractor`
- [x] Deterministic 0–100 `OpportunityScoringService`
- [x] `GridContextProvider` interface + demo + public skeleton
- [x] `PolicyEngine` — 7 deterministic rules, hard invariants against unsafe actions
- [x] Append-only activity log + API routes
- [x] `AutonomousRunService` — scan→extract→identify→grid→score→policy→dispatch→log
- [x] Radar dashboard `/radar`, `/opportunities`, `/opportunities/:id`

## Validation phase (V1–V10)

### V1 — Scheduled run route + history + /runs page — DONE
- [x] `RunHistoryRepository` + `run_history` table
- [x] `POST /api/runs/scheduled` gated on `SERVICE_TOKEN` (401 if wrong, 503 if unset)
- [x] `GET /api/runs`
- [x] `/runs` web page with trigger, providers, counts, incomplete flag, duration

### V2 — OpportunityDossierService — DONE
- [x] `dossiers` table + `DossierRepository`
- [x] `buildDossierContent(opportunity, ctx)` — always includes uncertainty, whatWeDoNotKnow, missingInformation
- [x] `POST /api/opportunities/:id/dossier` (via `OpportunityDossierService.getForOpportunity`)
- [x] Dossier section on `/opportunities/:id`
- [x] Written automatically on `create_dossier` decisions

### V3 — Safe notifications — DONE
- [x] `NOTIFICATION_ALLOWLIST` env, parsed by `context.ts`
- [x] `N8nAutomationClient` refuses `notify_stakeholder` when allowlist is empty
- [x] Retry + success/failure logs handled by run engine's `dispatchWithRetry`

### V4 — Contradiction / reassessment — DONE
- [x] `action_queue` table + repository (pending/dispatched/cancelled/failed)
- [x] `reassessExisting()` — recompute confidence (−0.25 haircut on conflict), rescore, re-run policy
- [x] `OPPORTUNITY_REASSESSED` activity log with priorScore, newScore, priorDecision, newDecision
- [x] Pending actions in queue are `cancelled` + `ACTION_BLOCKED` when policy reverses
- [x] Reassessment fires even when new source has "unknown" signal (silence is signal)

### V5 — Decision History UI — DONE
- [x] `GET /api/opportunities/:id/history` returns decisions + reassessments
- [x] `/opportunities/:id` reassessments section: prev score → new score, prev decision → new decision, triggering source, reason

### V6 — Bounded retries + failure handling — DONE
- [x] Source discovery: try once, `RETRY_STARTED` on first failure, retry once, `RETRY_FAILED` + `incomplete=true` on second failure
- [x] Anthropic: `FallbackEvidenceExtractor` degrades to rule-based (already Step 4)
- [x] Grid context: unknown level → policy engine's `promising_without_congestion_context` rule blocks dispatch; dispatch layer also blocks any queued action for score >= 80 when congestion is unknown
- [x] n8n: `dispatchWithRetry` tries twice, logs `RETRY_STARTED` then `RETRY_FAILED`, marks queue item `failed`
- [x] Never retry indefinitely (hard cap = 2 attempts everywhere)

### V7 — Deterministic integration tests — DONE
- [x] Scheduled run with token (200/401/503 paths)
- [x] Apify failure recovery (flaky → succeeds on retry)
- [x] Apify permanent failure (both attempts fail → incomplete=true)
- [x] Anthropic fallback (throwing extractor → rule-based)
- [x] n8n delivery failure (both attempts throw → queue item `failed`, `RETRY_STARTED` + `RETRY_FAILED` logged)
- [x] Conflicting evidence reversal (create_dossier → stop, `OPPORTUNITY_REASSESSED` logged)
- 22 API tests + 27 core tests + 5 shared tests = **54 total, all green**

### V8 — /demo page + backend demo controls — DONE
- [x] `POST /api/demo/{reset,overnight-scan,inject-conflict/:opportunityId,simulate/apify-fail,simulate/n8n-fail}` (all gated on `DEMO_MODE=true`)
- [x] `/demo` web page with all controls + promising/rejected shortcuts

### V9 — offline mode — DONE
- [x] `?offline=true` on any run endpoint forces `buildOfflineRunService()` (demo providers + local automation) regardless of env
- [x] Frontend propagates `?offline=true` from the URL onto every API call
- [x] Offline pill in the header

### V10 — Final verify + docs — DONE
- [x] Full test/typecheck/build green
- [x] README updated
- [x] Credentials checklist below

---

## Netlify deployment — DONE

- [x] `netlify.toml` — build command, publish `apps/web/dist`, functions `netlify/functions`, Node 22, SPA fallback
- [x] `netlify/functions/api.ts` (+ `netlify/functions/package.json` `type: module`) — thin `Request → app.fetch` adapter, declarative `config.path = '/api/*'`, `/api/health` alias. `.ts` picked so Netlify picks esbuild (inlines workspace packages); `.mts` would default to `nft` which doesn't ship workspace-linked deps.
- [x] Root `package.json` `dependencies` promoted `hono`, `zod`, and the three AI SDKs — required so pnpm creates root-level symlinks that Netlify's function bundler can resolve.
- [x] `netlify/tsconfig.json` — typechecked via root `pnpm typecheck`
- [x] `@netlify/functions` devDep for Config types
- [x] All 13 environment variables documented in README (server-side only; frontend never sees them)
- [x] SPA hard-refresh works (`/*` → `/index.html`), never intercepts `/api/*` (function routing runs first)
- [x] Deployment verification checklist (`GET /api/health`, `GET /api/wiring`, authenticated `POST /api/runs/scheduled`) in README
- [x] Ephemeral-storage caveat documented (`:memory:` is the only workable `SQLITE_PATH` on Lambda; each instance has its own DB)

## Provider-agnostic extraction phase — DONE

- [x] Shared prompt + Zod schema + `parseExtractionToResult` in `aiPromptAndSchema.ts`
- [x] `AnthropicEvidenceExtractor` — refactored to use shared pieces
- [x] `OpenAIEvidenceExtractor` — Structured Outputs (strict `json_schema`)
- [x] `GeminiEvidenceExtractor` — `responseMimeType: application/json` + `responseSchema`
- [x] `chooseEvidenceExtractor({env})` factory — `AI_PROVIDER` selection, credential-gated, fallback-wrapped
- [x] `WiringReport.aiProvider` field + header pill
- [x] 20 factory tests (selection matrix + fallback for all 3 providers)
- [x] Startup never fails on missing AI credentials
- [x] Every extractor writes its name to `Evidence.extractor` via the shared `parseExtractionToResult` — audit trail visible in the `EVIDENCE_EXTRACTED` activity log

## What remains before enabling real Apify + n8n credentials

Every item is code-complete; these are the operational steps.

### For real Apify (source discovery)
1. Create an Apify account and an actor (or dataset).
2. Configure the actor to output items with fields: `url`, `title`, `text` or `html`, optional `publishedAt`, optional `sourceType`.
3. In `.env`:
   ```
   DEMO_MODE=false
   APIFY_TOKEN=<paste apify token>
   APIFY_ACTOR_ID=<paste actor id>
   # or, if you prefer pointing at an existing dataset:
   # APIFY_DATASET_ID=<dataset id>
   ```
4. Restart the API — `/api/wiring` will show `sourceProvider: "apify"`.
5. `POST /api/runs/scheduled` will now pull real data from the actor.

### For real n8n (automation)
1. Deploy n8n (self-hosted or cloud).
2. Create webhook workflows for the actions you want to allow:
   `POST /webhook/create_dossier`, `POST /webhook/notify_stakeholder`,
   `POST /webhook/request_human_review`, `POST /webhook/request_grid_verification`.
3. In `.env`:
   ```
   N8N_BASE_URL=https://n8n.example.com
   N8N_WEBHOOK_TOKEN=<optional shared secret, sent as x-n8n-token>
   NOTIFICATION_ALLOWLIST=alice@internal.example,bob@internal.example
   ```
   NEVER put a scraped business address in `NOTIFICATION_ALLOWLIST`.
4. Restart the API — `/api/wiring` shows `automationProvider: "n8n"` and `notificationAllowlist` count.
5. Any `notify_stakeholder` action will be dispatched to n8n with the fixed
   `recipients` array from the allowlist. Actions to non-allowlisted recipients
   are impossible via this client.

### For scheduled runs
1. In `.env`, set `SERVICE_TOKEN=<generate a long random string>`.
2. In n8n (or GitHub Actions, or cron): `POST https://api.example.com/api/runs/scheduled`
   with header `X-Service-Token: <that string>`.
3. `/api/wiring` shows `scheduledEndpointEnabled: true`.

### For Anthropic (evidence extraction quality)
1. `ANTHROPIC_API_KEY=<key>` in `.env`.
2. Optional `ANTHROPIC_MODEL=claude-sonnet-4-6` if you want cheaper extractions
   than the default `claude-opus-4-7`.
3. Anthropic extractor becomes primary; on any error we fall back to
   rule-based, so a rate limit or outage never blocks the pipeline.

### Pre-flight checklist
- [ ] `.env` filled in with `DEMO_MODE=false`
- [ ] `pnpm typecheck && pnpm test && pnpm build` all green
- [ ] Manually POST `/api/runs/scheduled` with the service token and inspect
      `/api/runs` + `/api/opportunities` — confirm real data lands
- [ ] `NOTIFICATION_ALLOWLIST` populated with internal recipients only
- [ ] Rate-limit alarm on the Apify/Anthropic side so we don't silently burn credits
