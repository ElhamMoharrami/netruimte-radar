import {
  ActivityLogSchema,
  newId,
  nowIso,
  type ActivityEventType,
  type ActivityLog,
  type ActivityLogRepository,
} from '@netruimte/shared';

export interface AppendOptions {
  opportunityId?: string | null;
  message: string;
  metadata?: Record<string, unknown> | null;
}

/**
 * Thin wrapper around the repository that:
 *   - assigns IDs and timestamps
 *   - validates every entry via the shared schema
 *   - refuses to mutate existing entries (append-only invariant)
 *
 * Every meaningful step in the autonomous pipeline calls this — the resulting
 * feed is what the dashboard renders and what a demo reviewer inspects to
 * verify that scoring/policy behaved deterministically.
 */
export class ActivityLogger {
  constructor(private readonly repo: ActivityLogRepository) {}

  async log(eventType: ActivityEventType, opts: AppendOptions): Promise<ActivityLog> {
    const entry: ActivityLog = {
      id: newId.activity(),
      opportunityId: opts.opportunityId ?? null,
      eventType,
      message: opts.message,
      metadata: opts.metadata ?? null,
      createdAt: nowIso(),
    };
    ActivityLogSchema.parse(entry);
    return this.repo.append(entry);
  }
}
