# Design Decisions & Architectural Trade-offs

## Concurrency

The most important correctness requirement is preventing duplicate execution while respecting queue concurrency limits. The worker claim path locks queue rows in sorted order, counts active `claimed` and `running` jobs, then updates one eligible job using `FOR UPDATE SKIP LOCKED`.

This approach gives two protections:

- Queue-level `FOR UPDATE` locks serialize capacity decisions for each queue.
- Job-level `SKIP LOCKED` prevents concurrent workers from claiming the same row.

Sorting queue locks by ID avoids deadlocks when multiple workers claim across the same queue set.

## Schema

The core schema is normalized around users, organizations, projects, queues, retry policies, jobs, executions, workers, heartbeats, logs, schedules, and DLQ entries. The bonus migration adds support tables without weakening the original model:

- `organization_members` for role-based access control.
- `job_dependencies` for workflow dependencies.
- `distributed_locks` for scheduler and execution locks.
- `api_rate_limits` for request windows.
- `system_events` for live updates and event-driven wakeups.

Key indexes:

- `idx_jobs_status_runat` keeps worker claims fast.
- `idx_jobs_queue_status` keeps dashboard status queries fast.
- `idx_jobs_idempotency` enforces per-queue idempotency keys.
- `idx_jobs_shard_status_runat` supports shard-specific workers.
- `idx_heartbeats_worker_time` supports worker health views.

## Lifecycle

Jobs follow this state model:

`blocked` or `queued/scheduled` -> `claimed` -> `running` -> `completed`, retry back to `queued`, or terminal `dead_letter`.

Workflow jobs submitted with `depends_on` start as `blocked`. After a job completes, the executor checks dependent jobs and releases them only when every prerequisite is completed.

Retries use fixed, linear, or exponential backoff with optional jitter. Permanent failures move to DLQ and receive a local failure summary that helps operators decide whether to replay, tune concurrency, or inspect payload validation.

## Live Operation

The system combines polling with event-driven signals. Polling keeps the design resilient, while `system_events`, PostgreSQL `NOTIFY`, and `/ws` make the dashboard and workers react quickly when jobs, queues, schedules, or DLQ entries change.

The WebSocket implementation intentionally avoids another dependency and uses the Node HTTP upgrade path directly. That keeps deployment small for the assignment while still providing real-time behavior.

## Scale Path

The current design is PostgreSQL-first because it provides transactional correctness and is easy to evaluate. At higher scale, the next improvements would be table partitioning by queue/time, read replicas for dashboard analytics, and eventually a dedicated broker for hot queue traffic while PostgreSQL remains the execution history source of truth.

## Trade-off

The AI-generated failure summary is deterministic and local instead of calling an external LLM. That avoids API keys, network dependencies, and nondeterministic test behavior while still demonstrating the operator-facing feature.
