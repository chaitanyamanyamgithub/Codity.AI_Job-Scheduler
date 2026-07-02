-- Bonus feature migration: RBAC, workflow dependencies, rate limiting,
-- distributed locks, queue sharding, event stream, and failure summaries.

ALTER TABLE jobs DROP CONSTRAINT IF EXISTS jobs_status_check;
ALTER TABLE jobs ADD CONSTRAINT jobs_status_check
  CHECK (status IN ('blocked', 'queued', 'scheduled', 'claimed', 'running', 'completed', 'failed', 'dead_letter'));

ALTER TABLE queues ADD COLUMN IF NOT EXISTS shard_key TEXT NOT NULL DEFAULT 'default';
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS shard_key TEXT NOT NULL DEFAULT 'default';
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS failure_summary TEXT;
ALTER TABLE dead_letter_queue ADD COLUMN IF NOT EXISTS failure_summary TEXT;

UPDATE jobs j SET shard_key = q.shard_key
FROM queues q
WHERE j.queue_id = q.id AND (j.shard_key IS NULL OR j.shard_key = 'default');

CREATE TABLE IF NOT EXISTS organization_members (
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('owner', 'admin', 'operator', 'viewer')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (org_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_org_members_user ON organization_members (user_id, role);

INSERT INTO organization_members (org_id, user_id, role)
SELECT id, owner_id, 'owner'
FROM organizations
ON CONFLICT (org_id, user_id) DO NOTHING;

CREATE TABLE IF NOT EXISTS job_dependencies (
  job_id UUID NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  depends_on_job_id UUID NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (job_id, depends_on_job_id),
  CHECK (job_id <> depends_on_job_id)
);
CREATE INDEX IF NOT EXISTS idx_job_dependencies_depends_on ON job_dependencies (depends_on_job_id);

CREATE TABLE IF NOT EXISTS distributed_locks (
  lock_key TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  acquired_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_distributed_locks_expires ON distributed_locks (expires_at);

CREATE TABLE IF NOT EXISTS api_rate_limits (
  identity_key TEXT NOT NULL,
  route_key TEXT NOT NULL,
  window_start TIMESTAMPTZ NOT NULL,
  request_count INT NOT NULL DEFAULT 1,
  PRIMARY KEY (identity_key, route_key, window_start)
);
CREATE INDEX IF NOT EXISTS idx_api_rate_limits_window ON api_rate_limits (window_start);

CREATE TABLE IF NOT EXISTS system_events (
  id BIGSERIAL PRIMARY KEY,
  event_type TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT,
  payload JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_system_events_created ON system_events (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_system_events_type ON system_events (event_type, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_queues_shard ON queues (shard_key);
CREATE INDEX IF NOT EXISTS idx_jobs_shard_status_runat ON jobs (shard_key, status, run_at);
