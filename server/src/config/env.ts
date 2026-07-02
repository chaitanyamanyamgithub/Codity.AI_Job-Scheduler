import dotenv from 'dotenv';
import path from 'path';

// Load .env from server root
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

export const env = {
  // Database
  DATABASE_URL: process.env.DATABASE_URL || 'postgres://scheduler:scheduler_secret@localhost:5432/job_scheduler',

  // Auth
  JWT_SECRET: process.env.JWT_SECRET || 'dev_secret_change_me',
  JWT_EXPIRES_IN: process.env.JWT_EXPIRES_IN || '24h',

  // Server
  PORT: parseInt(process.env.PORT || '3000', 10),
  NODE_ENV: process.env.NODE_ENV || 'development',

  // Worker
  WORKER_POLL_INTERVAL_MS: parseInt(process.env.WORKER_POLL_INTERVAL_MS || '500', 10),
  WORKER_MAX_PARALLEL_JOBS: parseInt(process.env.WORKER_MAX_PARALLEL_JOBS || '5', 10),
  WORKER_NAME: process.env.WORKER_NAME || `worker-${process.pid}`,
  WORKER_SHARD_KEY: process.env.WORKER_SHARD_KEY || 'default',
  WORKER_HEARTBEAT_INTERVAL_MS: parseInt(process.env.WORKER_HEARTBEAT_INTERVAL_MS || '5000', 10),
  WORKER_STALE_THRESHOLD_MS: parseInt(process.env.WORKER_STALE_THRESHOLD_MS || '30000', 10),
  WORKER_SHUTDOWN_TIMEOUT_MS: parseInt(process.env.WORKER_SHUTDOWN_TIMEOUT_MS || '30000', 10),

  // Scheduler
  SCHEDULER_TICK_INTERVAL_MS: parseInt(process.env.SCHEDULER_TICK_INTERVAL_MS || '3000', 10),

  // Rate limiting
  RATE_LIMIT_WINDOW_MS: parseInt(process.env.RATE_LIMIT_WINDOW_MS || '60000', 10),
  RATE_LIMIT_READ_REQUESTS: parseInt(process.env.RATE_LIMIT_READ_REQUESTS || '120', 10),
  RATE_LIMIT_MUTATION_REQUESTS: parseInt(process.env.RATE_LIMIT_MUTATION_REQUESTS || '60', 10),

  // Migrations
  RUN_MIGRATIONS: process.env.RUN_MIGRATIONS === 'true',
} as const;
