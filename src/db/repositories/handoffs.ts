import { z } from 'zod';

import type { ConcordDatabase } from '../connection.js';
import { LOCAL_PROJECT } from '../project-scope-migration.js';
import {
  parseHandoffRow,
  serializeStringArray,
  type HandoffDeliveryStatus,
  type HandoffRecord,
  type ReportedOutcomeRecord,
} from '../rows.js';

/** Input for recording a handoff. Array fields default to `[]` at the caller. */
export interface NewHandoff {
  taskId: string;
  status: string;
  changedFiles: readonly string[];
  whatChanged: string;
  testsRun: readonly string[];
  knownRisks: readonly string[];
  assumptions: readonly string[];
  decisions: readonly string[];
  guardrailsChecked: readonly string[];
  needsReviewFrom: readonly string[];
  nextSteps: readonly string[];
  fromAgentId?: string | null;
  toAgentId?: string | null;
  deliveryStatus?: HandoffDeliveryStatus;
  expiresAt?: string | null;
  taskVersion?: number | null;
  reportedOutcome?: ReportedOutcomeRecord | null;
}

export interface HandoffRepository {
  create(handoff: NewHandoff): HandoffRecord;
  listByTask(taskId: string): HandoffRecord[];
  latestForTask(taskId: string): HandoffRecord | undefined;
  get(id: number): HandoffRecord | undefined;
  pendingForTask(taskId: string): HandoffRecord | undefined;
  resolve(
    id: number,
    status: Exclude<HandoffDeliveryStatus, 'recorded' | 'pending'>,
    reason: string | null,
  ): HandoffRecord | undefined;
}

const rawListSchema = z.array(z.unknown());

export function createHandoffRepository(
  db: ConcordDatabase,
  project: string = LOCAL_PROJECT,
): HandoffRepository {
  const insertStmt = db.prepare(`
    INSERT INTO handoffs (
      project, task_id, status, changed_files, what_changed, tests_run, known_risks,
      assumptions, decisions, guardrails_checked, needs_review_from, next_steps,
      from_agent_id, to_agent_id, delivery_status, expires_at, resolved_at,
      task_version, resolution_reason, reported_outcome, created_at
    ) VALUES (
      @project, @task_id, @status, @changed_files, @what_changed, @tests_run, @known_risks,
      @assumptions, @decisions, @guardrails_checked, @needs_review_from, @next_steps,
      @from_agent_id, @to_agent_id, @delivery_status, @expires_at, @resolved_at,
      @task_version, @resolution_reason, @reported_outcome, @created_at
    )
  `);
  const getByIdStmt = db.prepare('SELECT * FROM handoffs WHERE id = ?');
  const listByTaskStmt = db.prepare(
    'SELECT * FROM handoffs WHERE project = ? AND task_id = ? ORDER BY created_at ASC, id ASC',
  );
  const latestStmt = db.prepare(
    `SELECT * FROM handoffs WHERE project = ? AND task_id = ?
     ORDER BY created_at DESC, id DESC LIMIT 1`,
  );
  const pendingStmt = db.prepare(
    `SELECT * FROM handoffs
     WHERE project = ? AND task_id = ? AND delivery_status = 'pending'
     ORDER BY id DESC LIMIT 1`,
  );
  const resolveStmt = db.prepare(
    `UPDATE handoffs
     SET delivery_status = @delivery_status,
         resolved_at = @resolved_at,
         resolution_reason = @resolution_reason
     WHERE id = @id AND delivery_status = 'pending'`,
  );

  function get(id: number): HandoffRecord | undefined {
    const raw: unknown = getByIdStmt.get(id);
    return raw === undefined ? undefined : parseHandoffRow(raw);
  }

  return {
    create(handoff) {
      const info = insertStmt.run({
        project,
        task_id: handoff.taskId,
        status: handoff.status,
        changed_files: serializeStringArray(handoff.changedFiles),
        what_changed: handoff.whatChanged,
        tests_run: serializeStringArray(handoff.testsRun),
        known_risks: serializeStringArray(handoff.knownRisks),
        assumptions: serializeStringArray(handoff.assumptions),
        decisions: serializeStringArray(handoff.decisions),
        guardrails_checked: serializeStringArray(handoff.guardrailsChecked),
        needs_review_from: serializeStringArray(handoff.needsReviewFrom),
        next_steps: serializeStringArray(handoff.nextSteps),
        from_agent_id: handoff.fromAgentId ?? null,
        to_agent_id: handoff.toAgentId ?? null,
        delivery_status: handoff.deliveryStatus ?? 'recorded',
        expires_at: handoff.expiresAt ?? null,
        resolved_at: null,
        task_version: handoff.taskVersion ?? null,
        resolution_reason: null,
        reported_outcome:
          handoff.reportedOutcome === undefined || handoff.reportedOutcome === null
            ? null
            : JSON.stringify(handoff.reportedOutcome),
        created_at: new Date().toISOString(),
      });
      const raw: unknown = getByIdStmt.get(info.lastInsertRowid);
      if (raw === undefined) {
        throw new Error(`Handoff ${String(info.lastInsertRowid)} could not be read back`);
      }
      return parseHandoffRow(raw);
    },
    listByTask(taskId) {
      const raw: unknown = listByTaskStmt.all(project, taskId);
      return rawListSchema.parse(raw).map(parseHandoffRow);
    },
    latestForTask(taskId) {
      const raw: unknown = latestStmt.get(project, taskId);
      if (raw === undefined) {
        return undefined;
      }
      return parseHandoffRow(raw);
    },
    get,
    pendingForTask(taskId) {
      const raw: unknown = pendingStmt.get(project, taskId);
      return raw === undefined ? undefined : parseHandoffRow(raw);
    },
    resolve(id, status, reason) {
      const info = resolveStmt.run({
        id,
        delivery_status: status,
        resolved_at: new Date().toISOString(),
        resolution_reason: reason,
      });
      return info.changes === 0 ? undefined : get(id);
    },
  };
}
