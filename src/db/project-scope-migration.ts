/** The project of a repository's own `.concord/` store: it holds only itself. */
export const LOCAL_PROJECT = '';

/**
 * Migration 012 — tasks belong to a project.
 *
 * One database can hold several repositories' work: the machine-wide store
 * keeps every repository that was never set up, plus `general` for sessions
 * outside any repository. Agents choose task ids (`TASK-1`), so two
 * repositories can use the same one; a task is therefore unique per
 * `(project, task_id)`, as Concord Cloud keys it per project.
 *
 * A repository's own `.concord/` store is a single project, the empty key, so
 * every existing row lands there and its behaviour is unchanged.
 *
 * SQLite cannot change a primary key or a foreign key in place, so `tasks` and
 * every table that references it are rebuilt and copied. Each copy is
 * `SELECT *, ''`: the new table repeats the version-11 columns in order, with
 * `project` appended, and this migration only ever runs on version 11.
 *
 * The migration runner turns foreign-key enforcement off around it, as
 * SQLite's table-rebuild procedure requires, and checks the result before
 * committing. Agents, endpoints and message events are not task-scoped and
 * are left alone.
 */
export const PROJECT_SCOPE_MIGRATION = `
  CREATE TABLE tasks_012 (
    task_id           TEXT NOT NULL,
    title             TEXT NOT NULL,
    owner             TEXT,
    agent             TEXT,
    branch            TEXT,
    worktree          TEXT,
    expected_files    TEXT NOT NULL DEFAULT '[]',
    modules           TEXT NOT NULL DEFAULT '[]',
    domains           TEXT NOT NULL DEFAULT '[]',
    risk_tags         TEXT NOT NULL DEFAULT '[]',
    notes             TEXT,
    status            TEXT NOT NULL DEFAULT 'active',
    created_at        TEXT NOT NULL,
    updated_at        TEXT NOT NULL,
    parent_task_id    TEXT,
    agent_id          TEXT,
    version           INTEGER NOT NULL DEFAULT 1,
    assigned_agent_id TEXT,
    lease_expires_at  TEXT,
    project           TEXT NOT NULL DEFAULT '',
    PRIMARY KEY (project, task_id)
  );
  INSERT INTO tasks_012 SELECT *, '' FROM tasks;
  DROP TABLE tasks;
  ALTER TABLE tasks_012 RENAME TO tasks;

  CREATE TABLE handoffs_012 (
    id                 INTEGER PRIMARY KEY AUTOINCREMENT,
    task_id            TEXT NOT NULL,
    status             TEXT NOT NULL,
    changed_files      TEXT NOT NULL DEFAULT '[]',
    what_changed       TEXT NOT NULL,
    tests_run          TEXT NOT NULL DEFAULT '[]',
    known_risks        TEXT NOT NULL DEFAULT '[]',
    assumptions        TEXT NOT NULL DEFAULT '[]',
    decisions          TEXT NOT NULL DEFAULT '[]',
    guardrails_checked TEXT NOT NULL DEFAULT '[]',
    needs_review_from  TEXT NOT NULL DEFAULT '[]',
    next_steps         TEXT NOT NULL DEFAULT '[]',
    created_at         TEXT NOT NULL,
    from_agent_id      TEXT,
    to_agent_id        TEXT,
    delivery_status    TEXT NOT NULL DEFAULT 'recorded',
    expires_at         TEXT,
    resolved_at        TEXT,
    task_version       INTEGER,
    resolution_reason  TEXT,
    reported_outcome   TEXT,
    project            TEXT NOT NULL DEFAULT '',
    FOREIGN KEY (project, task_id) REFERENCES tasks(project, task_id)
  );
  INSERT INTO handoffs_012 SELECT *, '' FROM handoffs;
  DROP TABLE handoffs;
  ALTER TABLE handoffs_012 RENAME TO handoffs;
  CREATE INDEX idx_handoffs_task_id ON handoffs(project, task_id);
  CREATE INDEX idx_handoffs_pending_recipient ON handoffs(to_agent_id, delivery_status);

  CREATE TABLE reviews_012 (
    id                 INTEGER PRIMARY KEY AUTOINCREMENT,
    task_id            TEXT NOT NULL,
    plan_summary       TEXT NOT NULL,
    tests_run          TEXT NOT NULL DEFAULT '[]',
    diff_size          TEXT,
    guardrails_checked TEXT NOT NULL DEFAULT '[]',
    assumptions        TEXT NOT NULL DEFAULT '[]',
    open_questions     TEXT NOT NULL DEFAULT '[]',
    provenance         TEXT NOT NULL DEFAULT '[]',
    created_at         TEXT NOT NULL,
    project            TEXT NOT NULL DEFAULT '',
    FOREIGN KEY (project, task_id) REFERENCES tasks(project, task_id)
  );
  INSERT INTO reviews_012 SELECT *, '' FROM reviews;
  DROP TABLE reviews;
  ALTER TABLE reviews_012 RENAME TO reviews;
  CREATE INDEX idx_reviews_task_id ON reviews(project, task_id);

  CREATE TABLE task_updates_012 (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    task_id    TEXT NOT NULL,
    kind       TEXT NOT NULL,
    content    TEXT NOT NULL,
    agent      TEXT,
    created_at TEXT NOT NULL,
    project    TEXT NOT NULL DEFAULT '',
    FOREIGN KEY (project, task_id) REFERENCES tasks(project, task_id)
  );
  INSERT INTO task_updates_012 SELECT *, '' FROM task_updates;
  DROP TABLE task_updates;
  ALTER TABLE task_updates_012 RENAME TO task_updates;
  CREATE INDEX idx_task_updates_task_id ON task_updates(project, task_id);

  CREATE TABLE task_ownership_events_012 (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    task_id         TEXT NOT NULL,
    transition      TEXT NOT NULL,
    actor_agent_id  TEXT NOT NULL,
    from_agent_id   TEXT,
    to_agent_id     TEXT,
    from_status     TEXT NOT NULL,
    to_status       TEXT NOT NULL,
    from_version    INTEGER NOT NULL,
    to_version      INTEGER NOT NULL,
    reason          TEXT,
    created_at      TEXT NOT NULL,
    project         TEXT NOT NULL DEFAULT '',
    FOREIGN KEY (project, task_id) REFERENCES tasks(project, task_id)
  );
  INSERT INTO task_ownership_events_012 SELECT *, '' FROM task_ownership_events;
  DROP TABLE task_ownership_events;
  ALTER TABLE task_ownership_events_012 RENAME TO task_ownership_events;
  CREATE INDEX idx_ownership_events_task_id ON task_ownership_events(project, task_id, id);

  CREATE TABLE agent_messages_012 (
    message_id          TEXT PRIMARY KEY,
    task_id             TEXT,
    sender_agent_id     TEXT NOT NULL REFERENCES agents(agent_id),
    recipient_agent_id  TEXT NOT NULL REFERENCES agents(agent_id),
    reply_to_message_id TEXT REFERENCES agent_messages(message_id),
    content             TEXT NOT NULL,
    delivery_mode       TEXT NOT NULL DEFAULT 'steer',
    status              TEXT NOT NULL DEFAULT 'pending',
    provider            TEXT,
    provider_receipt    TEXT,
    error_code          TEXT,
    error_detail        TEXT,
    idempotency_key     TEXT NOT NULL,
    created_at          TEXT NOT NULL,
    delivered_at        TEXT,
    replied_at          TEXT,
    failed_at           TEXT,
    project             TEXT NOT NULL DEFAULT '',
    CHECK (delivery_mode = 'steer'),
    CHECK (status IN ('pending', 'delivered', 'replied', 'failed')),
    UNIQUE (sender_agent_id, idempotency_key),
    FOREIGN KEY (project, task_id) REFERENCES tasks(project, task_id)
  );
  INSERT INTO agent_messages_012 SELECT *, '' FROM agent_messages;
  DROP TABLE agent_messages;
  ALTER TABLE agent_messages_012 RENAME TO agent_messages;
  CREATE INDEX idx_agent_messages_recipient
    ON agent_messages(recipient_agent_id, created_at, message_id);
  CREATE INDEX idx_agent_messages_sender
    ON agent_messages(sender_agent_id, created_at, message_id);
  CREATE INDEX idx_agent_messages_task
    ON agent_messages(project, task_id, created_at, message_id);
  CREATE INDEX idx_agent_messages_pending_recipient
    ON agent_messages(recipient_agent_id, status, created_at, message_id);

  ALTER TABLE events ADD COLUMN project TEXT NOT NULL DEFAULT '';
  DROP INDEX idx_events_task_id;
  CREATE INDEX idx_events_project_task ON events(project, task_id);
`;
