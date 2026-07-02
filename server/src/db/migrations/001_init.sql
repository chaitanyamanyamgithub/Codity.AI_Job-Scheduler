-- 001_init.sql
-- Distributed Job Scheduler — Full Database Schema
-- 12 tables: users, organizations, projects, retry_policies, queues, workers,
--            jobs, job_executions, worker_heartbeats, job_logs, scheduled_jobs, dead_letter_queue

CREATE EXTENSION IF NOT EXISTS pgcrypto; -- for gen_random_uuid()

-- ============================================================================
-- USERS
-- ============================================================================
CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  name TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============================================================================
-- ORGANIZATIONS
-- ON DELETE RESTRICT on owner: prevents deleting a user who still owns an org
-- ============================================================================
CREATE TABLE organizations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  owner_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============================================================================
-- PROJECTS — belong to an organization
-- ON DELETE CASCADE: removing an org removes all its projects
-- ============================================================================
CREATE TABLE projects (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (org_id, name)
);

-- ============================================================================
-- RETRY POLICIES — reusable across queues
-- ============================================================================
CREATE TABLE retry_policies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  strategy TEXT NOT NULL CHECK (strategy IN ('fixed', 'linear', 'exponential')),
  base_delay_ms INT NOT NULL DEFAULT 1000,
  max_retries INT NOT NULL DEFAULT 3,
  max_delay_ms INT NOT NULL DEFAULT 60000,
  jitter BOOLEAN NOT NULL DEFAULT false
);

-- Seed a few default policies
INSERT INTO retry_policies (id, name, strategy, base_delay_ms, max_retries, max_delay_ms, jitter) VALUES
  ('00000000-0000-0000-0000-000000000001', 'Default Fixed', 'fixed', 1000, 3, 60000, false),
  ('00000000-0000-0000-0000-000000000002', 'Default Exponential', 'exponential', 1000, 5, 60000, true),
  ('00000000-0000-0000-0000-000000000003', 'Default Linear', 'linear', 2000, 4, 30000, false);

-- ============================================================================
-- QUEUES — belong to a project
-- ON DELETE CASCADE: removing a project removes its queues
-- ON DELETE SET NULL for retry_policy: queue survives even if policy is deleted
-- ============================================================================
CREATE TABLE queues (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  priority INT NOT NULL DEFAULT 0,
  concurrency_limit INT NOT NULL DEFAULT 5,
  retry_policy_id UUID REFERENCES retry_policies(id) ON DELETE SET NULL,
  is_paused BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (project_id, name)
);

-- ============================================================================
-- WORKERS — independent service instances
-- ============================================================================
CREATE TABLE workers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'idle' CHECK (status IN ('idle', 'busy', 'offline')),
  last_heartbeat_at TIMESTAMPTZ,
  started_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_workers_heartbeat ON workers (last_heartbeat_at);

-- ============================================================================
-- JOBS — the central table
-- ON DELETE CASCADE on queue: removing a queue removes all its jobs
-- ON DELETE SET NULL on worker: preserves job history when worker is removed
-- ============================================================================
CREATE TABLE jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  queue_id UUID NOT NULL REFERENCES queues(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK (type IN ('immediate', 'delayed', 'scheduled', 'recurring', 'batch')),
  payload JSONB NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'queued'
    CHECK (status IN ('queued', 'scheduled', 'claimed', 'running', 'completed', 'failed', 'dead_letter')),
  priority INT NOT NULL DEFAULT 0,
  run_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  attempts INT NOT NULL DEFAULT 0,
  max_attempts INT NOT NULL DEFAULT 3,
  idempotency_key TEXT,
  worker_id UUID REFERENCES workers(id) ON DELETE SET NULL,
  batch_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- The single most important index: powers the atomic claim query
CREATE INDEX idx_jobs_status_runat ON jobs (status, run_at);
-- For queue-specific job lookups (dashboard, stats)
CREATE INDEX idx_jobs_queue_status ON jobs (queue_id, status);
-- Partial unique index: idempotency keys are unique per queue, but NULLs don't collide
CREATE UNIQUE INDEX idx_jobs_idempotency ON jobs (queue_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;
-- For batch queries
CREATE INDEX idx_jobs_batch ON jobs (batch_id) WHERE batch_id IS NOT NULL;

-- ============================================================================
-- JOB EXECUTIONS — one row per attempt
-- ON DELETE CASCADE: removing a job removes its execution records
-- ON DELETE SET NULL on worker: preserves history
-- ============================================================================
CREATE TABLE job_executions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id UUID NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  worker_id UUID REFERENCES workers(id) ON DELETE SET NULL,
  attempt_number INT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('running', 'completed', 'failed')),
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at TIMESTAMPTZ,
  error_message TEXT,
  result JSONB
);
CREATE INDEX idx_executions_job ON job_executions (job_id);

-- ============================================================================
-- WORKER HEARTBEATS — time-series of worker health
-- ON DELETE CASCADE: removing a worker removes its heartbeat history
-- ============================================================================
CREATE TABLE worker_heartbeats (
  id BIGSERIAL PRIMARY KEY,
  worker_id UUID NOT NULL REFERENCES workers(id) ON DELETE CASCADE,
  heartbeat_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  active_job_count INT NOT NULL DEFAULT 0
);
CREATE INDEX idx_heartbeats_worker_time ON worker_heartbeats (worker_id, heartbeat_at DESC);

-- ============================================================================
-- JOB LOGS — structured log entries per job
-- ON DELETE CASCADE: removing a job removes its logs
-- ============================================================================
CREATE TABLE job_logs (
  id BIGSERIAL PRIMARY KEY,
  job_id UUID NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  level TEXT NOT NULL CHECK (level IN ('info', 'warn', 'error')),
  message TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_logs_job_time ON job_logs (job_id, created_at);

-- ============================================================================
-- SCHEDULED JOBS — templates for recurring (cron) jobs
-- ON DELETE CASCADE: removing a queue removes its schedules
-- ============================================================================
CREATE TABLE scheduled_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  queue_id UUID NOT NULL REFERENCES queues(id) ON DELETE CASCADE,
  job_template JSONB NOT NULL,
  cron_expression TEXT NOT NULL,
  next_run_at TIMESTAMPTZ,
  last_run_at TIMESTAMPTZ,
  is_active BOOLEAN NOT NULL DEFAULT true
);
CREATE INDEX idx_scheduled_next_run ON scheduled_jobs (next_run_at) WHERE is_active;

-- ============================================================================
-- DEAD LETTER QUEUE — permanent failures land here
-- ON DELETE SET NULL: DLQ entry survives even if original job/queue is deleted
-- ============================================================================
CREATE TABLE dead_letter_queue (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  original_job_id UUID REFERENCES jobs(id) ON DELETE SET NULL,
  queue_id UUID REFERENCES queues(id) ON DELETE SET NULL,
  payload JSONB,
  failure_reason TEXT,
  attempts_made INT,
  moved_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_dlq_queue ON dead_letter_queue (queue_id);
CREATE INDEX idx_dlq_moved_at ON dead_letter_queue (moved_at DESC);
