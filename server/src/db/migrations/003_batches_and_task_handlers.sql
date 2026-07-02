-- 003_batches_and_task_handlers.sql
-- Batch management table & real task execution attributes

CREATE TABLE IF NOT EXISTS batches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  queue_id UUID NOT NULL REFERENCES queues(id) ON DELETE CASCADE,
  total_jobs INT NOT NULL DEFAULT 0,
  completed_jobs INT NOT NULL DEFAULT 0,
  failed_jobs INT NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'processing'
    CHECK (status IN ('pending', 'processing', 'completed', 'failed', 'cancelled')),
  callback_url TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_batches_queue ON batches (queue_id);
CREATE INDEX IF NOT EXISTS idx_batches_status ON batches (status);

ALTER TABLE jobs ADD COLUMN IF NOT EXISTS task_type TEXT NOT NULL DEFAULT 'simulated';
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS result_data JSONB;

-- Clean dangling batch_id values from jobs before adding foreign key
UPDATE jobs SET batch_id = NULL WHERE batch_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM batches WHERE id = jobs.batch_id);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'fk_jobs_batch'
  ) THEN
    ALTER TABLE jobs
      ADD CONSTRAINT fk_jobs_batch
      FOREIGN KEY (batch_id) REFERENCES batches(id) ON DELETE SET NULL;
  END IF;
END $$;
