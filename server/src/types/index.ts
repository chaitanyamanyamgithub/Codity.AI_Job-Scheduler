import { z } from 'zod';

// ============================================================================
// Auth
// ============================================================================
export const registerSchema = z.object({
  email: z.string().email('Invalid email address'),
  password: z.string().min(6, 'Password must be at least 6 characters'),
  name: z.string().min(1, 'Name is required').optional(),
});

export const loginSchema = z.object({
  email: z.string().email('Invalid email address'),
  password: z.string().min(1, 'Password is required'),
});

export type RegisterInput = z.infer<typeof registerSchema>;
export type LoginInput = z.infer<typeof loginSchema>;

export interface UserPayload {
  id: string;
  email: string;
}

// ============================================================================
// Projects
// ============================================================================
export const createProjectSchema = z.object({
  name: z.string().min(1, 'Project name is required').max(100),
  org_name: z.string().min(1, 'Organization name is required').max(100).optional(),
});

export type CreateProjectInput = z.infer<typeof createProjectSchema>;

export interface Project {
  id: string;
  org_id: string;
  name: string;
  created_at: Date;
}

// ============================================================================
// Retry Policies
// ============================================================================
export const retryStrategyEnum = z.enum(['fixed', 'linear', 'exponential']);
export type RetryStrategy = z.infer<typeof retryStrategyEnum>;

export interface RetryPolicy {
  id: string;
  name: string;
  strategy: RetryStrategy;
  base_delay_ms: number;
  max_retries: number;
  max_delay_ms: number;
  jitter: boolean;
}

// ============================================================================
// Queues
// ============================================================================
export const createQueueSchema = z.object({
  name: z.string().min(1).max(100),
  priority: z.number().int().min(0).max(100).default(0),
  concurrency_limit: z.number().int().min(1).max(100).default(5),
  retry_policy_id: z.string().uuid().optional().nullable(),
  shard_key: z.string().min(1).max(64).default('default'),
});

export const updateQueueSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  priority: z.number().int().min(0).max(100).optional(),
  concurrency_limit: z.number().int().min(1).max(100).optional(),
  retry_policy_id: z.string().uuid().optional().nullable(),
  is_paused: z.boolean().optional(),
  shard_key: z.string().min(1).max(64).optional(),
});

export type CreateQueueInput = z.infer<typeof createQueueSchema>;
export type UpdateQueueInput = z.infer<typeof updateQueueSchema>;

export interface Queue {
  id: string;
  project_id: string;
  name: string;
  priority: number;
  concurrency_limit: number;
  retry_policy_id: string | null;
  is_paused: boolean;
  shard_key: string;
  created_at: Date;
}

export interface QueueStats {
  total_jobs: number;
  queued: number;
  running: number;
  completed: number;
  failed: number;
  dead_letter: number;
  avg_execution_ms: number | null;
  success_rate: number | null;
  throughput_per_minute: number | null;
}

// ============================================================================
// Jobs
// ============================================================================
export const jobTypeEnum = z.enum(['immediate', 'delayed', 'scheduled', 'recurring', 'batch']);
export type JobType = z.infer<typeof jobTypeEnum>;

export const jobStatusEnum = z.enum([
  'blocked', 'queued', 'scheduled', 'claimed', 'running', 'completed', 'failed', 'dead_letter',
]);
export type JobStatus = z.infer<typeof jobStatusEnum>;

export const taskTypeEnum = z.enum(['simulated', 'http', 'shell']);
export type TaskType = z.infer<typeof taskTypeEnum>;

export const batchStatusEnum = z.enum(['pending', 'processing', 'completed', 'failed', 'cancelled']);
export type BatchStatus = z.infer<typeof batchStatusEnum>;

export interface Batch {
  id: string;
  queue_id: string;
  total_jobs: number;
  completed_jobs: number;
  failed_jobs: number;
  status: BatchStatus;
  callback_url: string | null;
  created_at: Date;
  updated_at: Date;
}

export interface HttpTaskPayload {
  url: string;
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';
  headers?: Record<string, string>;
  body?: unknown;
  timeout_ms?: number;
  expected_status?: number;
}

export interface ShellTaskPayload {
  command: string;
  timeout_ms?: number;
  cwd?: string;
}

export const createJobSchema = z.object({
  type: jobTypeEnum,
  task_type: taskTypeEnum.default('simulated'),
  payload: z.record(z.unknown()).default({}),
  priority: z.number().int().min(0).max(100).default(0),
  max_attempts: z.number().int().min(1).max(50).default(3),
  idempotency_key: z.string().max(255).optional().nullable(),
  depends_on: z.array(z.string().uuid()).default([]),
  callback_url: z.string().url().optional().nullable(),
  // For delayed jobs
  delay_ms: z.number().int().min(0).optional(),
  // For scheduled jobs
  run_at: z.string().datetime().optional(),
  // For recurring jobs
  cron_expression: z.string().optional(),
  // For batch jobs
  batch_jobs: z.array(z.object({
    task_type: taskTypeEnum.default('simulated'),
    payload: z.record(z.unknown()).default({}),
    priority: z.number().int().min(0).max(100).default(0),
    max_attempts: z.number().int().min(1).max(50).default(3),
    idempotency_key: z.string().max(255).optional().nullable(),
  })).optional(),
}).superRefine((data, ctx) => {
  if (data.type === 'delayed' && data.delay_ms === undefined) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['delay_ms'],
      message: 'delay_ms is required for delayed jobs',
    });
  }

  if (data.type === 'scheduled' && !data.run_at) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['run_at'],
      message: 'run_at is required for scheduled jobs',
    });
  }

  if (data.type === 'recurring' && !data.cron_expression) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['cron_expression'],
      message: 'cron_expression is required for recurring jobs',
    });
  }

  if (data.type === 'batch' && (!data.batch_jobs || data.batch_jobs.length === 0)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['batch_jobs'],
      message: 'At least one batch job is required for batch jobs',
    });
  }
});

export type CreateJobInput = z.infer<typeof createJobSchema>;

export interface Job {
  id: string;
  queue_id: string;
  type: JobType;
  task_type: TaskType;
  payload: Record<string, unknown>;
  status: JobStatus;
  priority: number;
  run_at: Date;
  attempts: number;
  max_attempts: number;
  idempotency_key: string | null;
  worker_id: string | null;
  batch_id: string | null;
  shard_key: string;
  failure_summary: string | null;
  result_data: Record<string, unknown> | null;
  created_at: Date;
  updated_at: Date;
}

// ============================================================================
// Job Executions
// ============================================================================
export interface JobExecution {
  id: string;
  job_id: string;
  worker_id: string | null;
  attempt_number: number;
  status: 'running' | 'completed' | 'failed';
  started_at: Date;
  finished_at: Date | null;
  error_message: string | null;
  result: Record<string, unknown> | null;
}

// ============================================================================
// Workers
// ============================================================================
export interface Worker {
  id: string;
  name: string;
  status: 'idle' | 'busy' | 'offline';
  last_heartbeat_at: Date | null;
  started_at: Date;
}

export interface WorkerHeartbeat {
  id: number;
  worker_id: string;
  heartbeat_at: Date;
  active_job_count: number;
}

// ============================================================================
// Job Logs
// ============================================================================
export interface JobLog {
  id: number;
  job_id: string;
  level: 'info' | 'warn' | 'error';
  message: string;
  created_at: Date;
}

// ============================================================================
// Scheduled Jobs
// ============================================================================
export interface ScheduledJob {
  id: string;
  queue_id: string;
  job_template: Record<string, unknown>;
  cron_expression: string;
  next_run_at: Date | null;
  last_run_at: Date | null;
  is_active: boolean;
}

// ============================================================================
// Dead Letter Queue
// ============================================================================
export interface DeadLetterEntry {
  id: string;
  original_job_id: string | null;
  queue_id: string | null;
  payload: Record<string, unknown> | null;
  failure_reason: string | null;
  attempts_made: number | null;
  moved_at: Date;
}

// ============================================================================
// Pagination
// ============================================================================
export interface PaginationParams {
  page: number;
  limit: number;
}

export interface PaginatedResponse<T> {
  data: T[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    total_pages: number;
  };
}

// ============================================================================
// API Error
// ============================================================================
export interface ApiError {
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
}

// ============================================================================
// Express Request augmentation
// ============================================================================
declare global {
  namespace Express {
    interface Request {
      user?: UserPayload;
    }
  }
}
