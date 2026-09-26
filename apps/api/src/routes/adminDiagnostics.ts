/**
 * ⚠️  TEMPORARY diagnostics endpoint — remove after the current production
 * investigation closes.
 *
 * Purpose: give operators SQL-level visibility into a specific runId's
 * failures + activity trace + action-queue state, without needing shell
 * access to the Turso database.
 *
 * Contract:
 *   - Read-only (SELECTs only — never INSERT/UPDATE/DELETE).
 *   - Reuses the AppContext's existing SqlClient — does NOT open a second
 *     connection.
 *   - Auth: X-Service-Token, same shared secret as POST /api/runs/scheduled.
 *     Returns 503 if no token is configured (endpoint is functionally
 *     disabled), 401 if the header is missing or wrong.
 *   - Never emits environment variables, credentials, or the token in the
 *     response body — the JSON returned contains only rows from
 *     activity_log and action_queue.
 *
 * When to remove: delete this file, its wire-up in app.ts, and its test file
 * (`adminDiagnostics.test.ts`) once the mis-attributed-failures investigation
 * is closed.
 */
import { Hono } from 'hono';
import type { AppContext } from '../context.js';

interface RetryFailedRow {
  created_at: string;
  message: string;
  metadata: string | null;
}

interface FailureSplitRow {
  stage: string;
  n: number;
}

interface RunTraceRow {
  created_at: string;
  event_type: string;
  message: string;
  opportunity_id: string | null;
}

interface ActionQueueCountRow {
  status: string;
  n: number;
}

export function adminDiagnosticsRoutes(ctx: AppContext) {
  const app = new Hono();

  app.get('/admin/run-diagnostics/:runId', async (c) => {
    if (!ctx.serviceToken) {
      return c.json({ error: 'diagnostics_disabled' }, 503);
    }
    const provided = c.req.header('x-service-token');
    if (provided !== ctx.serviceToken) {
      return c.json({ error: 'unauthorized' }, 401);
    }
    const runId = c.req.param('runId');
    if (!runId || runId.length === 0) {
      return c.json({ error: 'runId_required' }, 400);
    }

    // ── 1. failureSplit ────────────────────────────────────────────────
    // Bucket RETRY_FAILED activity by whether metadata carries sourceUrl
    // (F1, per-source processing) or actionType (F3, action dispatch).
    // Falls back to 'other' so unclassified rows are still visible.
    const splitRows = await ctx.db.all<FailureSplitRow>(
      `
      SELECT
        CASE
          WHEN json_extract(metadata, '$.sourceUrl')  IS NOT NULL THEN 'F1_per_source'
          WHEN json_extract(metadata, '$.actionType') IS NOT NULL THEN 'F3_action_dispatch'
          ELSE 'other'
        END AS stage,
        COUNT(*) AS n
      FROM activity_log
      WHERE event_type = 'RETRY_FAILED'
        AND json_extract(metadata, '$.runId') = ?
      GROUP BY stage
      `,
      [runId],
    );
    const failureSplit: Record<string, number> = {
      F1_per_source: 0,
      F3_action_dispatch: 0,
      other: 0,
    };
    for (const row of splitRows) {
      failureSplit[row.stage] = Number(row.n);
    }

    // ── 2. failureDetails ───────────────────────────────────────────────
    // Full RETRY_FAILED rows for the run, oldest first.
    const failureDetailRows = await ctx.db.all<RetryFailedRow>(
      `
      SELECT created_at, message, metadata
      FROM activity_log
      WHERE event_type = 'RETRY_FAILED'
        AND json_extract(metadata, '$.runId') = ?
      ORDER BY created_at ASC
      `,
      [runId],
    );
    const failureDetails = failureDetailRows.map((r) => ({
      createdAt: r.created_at,
      message: r.message,
      metadata: safeParseJson(r.metadata),
    }));

    // ── 3. runTrace ─────────────────────────────────────────────────────
    // Every activity row that carries this runId in its metadata, in order.
    const traceRows = await ctx.db.all<RunTraceRow>(
      `
      SELECT created_at, event_type, message, opportunity_id
      FROM activity_log
      WHERE json_extract(metadata, '$.runId') = ?
      ORDER BY created_at ASC
      `,
      [runId],
    );
    const runTrace = traceRows.map((r) => ({
      createdAt: r.created_at,
      eventType: r.event_type,
      message: r.message,
      opportunityId: r.opportunity_id,
    }));

    // ── 4. actionQueueCounts ───────────────────────────────────────────
    // Global (not per-run) — a stale-pending pile causes F3 failures every
    // scan regardless of the current run's opportunities.
    const queueRows = await ctx.db.all<ActionQueueCountRow>(
      `SELECT status, COUNT(*) AS n FROM action_queue GROUP BY status`,
    );
    const actionQueueCounts: Record<string, number> = {};
    for (const row of queueRows) {
      actionQueueCounts[row.status] = Number(row.n);
    }

    return c.json({
      runId,
      failureSplit,
      failureDetails,
      runTrace,
      actionQueueCounts,
    });
  });

  return app;
}

function safeParseJson(raw: string | null): unknown {
  if (raw === null) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}
