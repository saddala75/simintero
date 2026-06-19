-- V021__task_schema.sql
-- Generic platform Task service: work items of any kind
-- Standalone migration, no cross-schema deps. RLS like platform tables.

CREATE SCHEMA IF NOT EXISTS task;

CREATE TABLE task.task (
  task_id        TEXT PRIMARY KEY,
  tenant_id      TEXT NOT NULL,
  task_kind      TEXT NOT NULL,
  status         TEXT NOT NULL DEFAULT 'open'
                 CHECK (status IN ('open','in_progress','resolved','cancelled')),
  assignee       TEXT,
  assignee_queue TEXT,
  due_at         TIMESTAMPTZ,
  payload        JSONB NOT NULL DEFAULT '{}',
  created_by     TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved_at    TIMESTAMPTZ
);
ALTER TABLE task.task ENABLE ROW LEVEL SECURITY;
ALTER TABLE task.task FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON task.task
  USING (tenant_id = current_setting('sim.tenant_id', true));
CREATE INDEX task_worklist_idx ON task.task (tenant_id, task_kind, status, assignee_queue);
