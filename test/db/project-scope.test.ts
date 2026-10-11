import { describe, expect, it } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { z } from 'zod';

import Database from 'better-sqlite3';
import { openDatabase } from '../../src/db/connection.js';
import { createRepositories } from '../../src/db/index.js';
import { migrations } from '../../src/db/schema.js';

const task = {
  taskId: 'TASK-1',
  title: 'Shared id',
  owner: null,
  agent: null,
  branch: null,
  worktree: null,
  expectedFiles: ['src/index.ts'],
  modules: ['core'],
  domains: [],
  riskTags: [],
  notes: null,
  parentTaskId: null,
  agentId: null,
} as const;

const handoff = {
  taskId: 'TASK-1',
  status: 'done',
  changedFiles: [],
  whatChanged: 'done',
  testsRun: [],
  knownRisks: [],
  assumptions: [],
  decisions: [],
  guardrailsChecked: [],
  needsReviewFrom: [],
  nextSteps: [],
} as const;

const agent = {
  kind: 'codex',
  owner: null,
  model: null,
  pid: null,
  cwd: null,
  worktree: null,
  branch: null,
  summary: null,
  status: 'active',
} as const;

describe('project-scoped stores', () => {
  it('lets two projects in one store reuse a task id without seeing each other', () => {
    const db = openDatabase(':memory:');
    const repo = createRepositories(db, 'github.com/org/repo');
    const general = createRepositories(db, 'general');

    repo.tasks.create(task);
    general.tasks.create({ ...task, title: 'Same id, other project' });
    repo.handoffs.create(handoff);
    repo.events.record({ taskId: 'TASK-1', tool: 'claim_work', status: 'success', detail: null });

    expect(repo.tasks.get('TASK-1')?.title).toBe('Shared id');
    expect(general.tasks.get('TASK-1')?.title).toBe('Same id, other project');
    expect(general.tasks.list()).toHaveLength(1);
    expect(general.tasks.listByStatuses(['active'])).toHaveLength(1);
    expect(general.handoffs.listByTask('TASK-1')).toEqual([]);
    expect(general.events.list()).toEqual([]);
    expect(repo.events.list()).toHaveLength(1);

    const moved = general.tasks.transition({
      taskId: 'TASK-1',
      expectedVersion: 1,
      status: 'closed',
      agentId: null,
      assignedAgentId: null,
      leaseExpiresAt: null,
    });
    expect(moved?.status).toBe('closed');
    expect(repo.tasks.get('TASK-1')?.status).toBe('active');
  });

  it('shares agents and messages across projects but scopes a task thread', () => {
    const db = openDatabase(':memory:');
    const repo = createRepositories(db, 'github.com/org/repo');
    const general = createRepositories(db, 'general');
    repo.tasks.create(task);
    repo.agents.upsert({ ...agent, agentId: 'codex:a' });
    general.agents.upsert({ ...agent, agentId: 'codex:b' });

    general.agentMessages.create({
      messageId: 'm1',
      taskId: null,
      senderAgentId: 'codex:b',
      recipientAgentId: 'codex:a',
      replyToMessageId: null,
      content: 'hello from outside the repository',
      idempotencyKey: 'k1',
    });
    repo.agentMessages.create({
      messageId: 'm2',
      taskId: 'TASK-1',
      senderAgentId: 'codex:a',
      recipientAgentId: 'codex:b',
      replyToMessageId: 'm1',
      content: 'about TASK-1',
      idempotencyKey: 'k2',
    });

    expect(repo.agents.list().map((entry) => entry.agentId)).toEqual(['codex:a', 'codex:b']);
    expect(repo.agentMessages.listByAgent('codex:a').map((m) => m.messageId)).toEqual(['m1', 'm2']);
    expect(repo.agentMessages.listByTask('TASK-1').map((m) => m.messageId)).toEqual(['m2']);
    expect(general.agentMessages.listByTask('TASK-1')).toEqual([]);
  });

  it('refuses a task-scoped row for a task that exists only in another project', () => {
    const db = openDatabase(':memory:');
    createRepositories(db, 'github.com/org/repo').tasks.create(task);
    const general = createRepositories(db, 'general');

    expect(() => general.handoffs.create(handoff)).toThrow(/FOREIGN KEY/u);
    expect(db.pragma('foreign_keys', { simple: true })).toBe(1);
  });

  it('upgrades a version-11 store into the local project without losing rows', () => {
    const filename = join(mkdtempSync(join(tmpdir(), 'concord-012-')), 'concord.db');
    const legacy = new Database(filename);
    migrations.slice(0, 11).forEach((migration, index) => {
      legacy.exec(migration);
      legacy.pragma(`user_version = ${String(index + 1)}`);
    });
    legacy.pragma('foreign_keys = ON');
    // Seeded with plain SQL: today's repositories write a column that the
    // version-11 schema does not have yet.
    legacy
      .prepare(
        `INSERT INTO tasks (task_id, title, status, created_at, updated_at)
         VALUES ('TASK-1', 'Legacy', 'active', '2026-01-01', '2026-01-01')`,
      )
      .run();
    legacy
      .prepare(
        `INSERT INTO handoffs (task_id, status, what_changed, created_at)
         VALUES ('TASK-1', 'done', 'legacy', '2026-01-01')`,
      )
      .run();
    legacy
      .prepare(
        `INSERT INTO events (task_id, tool, status, created_at)
         VALUES ('TASK-1', 'claim_work', 'success', '2026-01-01')`,
      )
      .run();
    expect(legacy.pragma('user_version', { simple: true })).toBe(11);
    legacy.close();

    const upgraded = createRepositories(openDatabase(filename));
    expect(upgraded.db.pragma('user_version', { simple: true })).toBe(12);
    // Found through the local project, so every copied row was put in it.
    expect(upgraded.tasks.get('TASK-1')?.title).toBe('Legacy');
    expect(upgraded.handoffs.listByTask('TASK-1').map((entry) => entry.whatChanged)).toEqual([
      'legacy',
    ]);
    expect(upgraded.events.list()).toHaveLength(1);

    // Autoincrement ids continue past the copied rows.
    const next = upgraded.handoffs.create(handoff);
    expect(next.id).toBe(2);
  });

  it('rolls back a migration that fails part-way, keeping the previous schema', () => {
    const filename = join(mkdtempSync(join(tmpdir(), 'concord-012-')), 'concord.db');
    const legacy = new Database(filename);
    migrations.slice(0, 11).forEach((migration, index) => {
      legacy.exec(migration);
      legacy.pragma(`user_version = ${String(index + 1)}`);
    });
    // Occupy a name the rebuild needs only after its first table is replaced.
    legacy.exec('CREATE TABLE handoffs_012 (id INTEGER)');
    legacy.close();

    expect(() => openDatabase(filename)).toThrow(/handoffs_012/u);

    const after = new Database(filename);
    expect(after.pragma('user_version', { simple: true })).toBe(11);
    const columns = z
      .array(z.object({ name: z.string() }))
      .parse(after.pragma('table_info(tasks)'))
      .map((column) => column.name);
    expect(columns).not.toContain('project');
    after.close();
  });
});
