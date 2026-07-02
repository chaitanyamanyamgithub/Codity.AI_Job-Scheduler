# REST API Specification

All routes (except `/auth/*`) require a Bearer token in the `Authorization` header: `Authorization: Bearer <JWT>`.

All list response endpoints return pagination in a consistent envelope:
```json
{
  "data": [],
  "pagination": {
    "page": 1,
    "limit": 20,
    "total": 100,
    "total_pages": 5
  }
}
```

Live updates are available at `GET /ws` using a WebSocket upgrade. The server sends JSON system event objects such as `job.created`, `job.running`, `job.completed`, `job.dead_lettered`, `queue.updated`, and `schedule.dispatched`.

---

## 1. Authentication

### Register User
* **Method & Path**: `POST /auth/register`
* **Request Body**:
  ```json
  {
    "email": "user@example.com",
    "password": "securepassword123",
    "name": "Jane Doe"
  }
  ```
* **Success Response (201 Created)**:
  ```json
  {
    "data": {
      "user": {
        "id": "e8a715a3-db49-411a-ab57-b08e7df006ad",
        "email": "user@example.com",
        "name": "Jane Doe",
        "created_at": "2026-07-02T13:00:00Z"
      },
      "token": "eyJhbGciOi..."
    }
  }
  ```

### Login User
* **Method & Path**: `POST /auth/login`
* **Request Body**:
  ```json
  {
    "email": "user@example.com",
    "password": "securepassword123"
  }
  ```
* **Success Response (200 OK)**:
  ```json
  {
    "data": {
      "user": {
        "id": "e8a715a3-db49-411a-ab57-b08e7df006ad",
        "email": "user@example.com",
        "name": "Jane Doe",
        "created_at": "2026-07-02T13:00:00Z"
      },
      "token": "eyJhbGciOi..."
    }
  }
  ```

---

## 2. Projects & Queues

### Create Project
* **Method & Path**: `POST /projects`
* **Request Body**:
  ```json
  {
    "name": "Production Core",
    "org_name": "Acme Corp"
  }
  ```
* **Success Response (201 Created)**:
  ```json
  {
    "data": {
      "id": "4e73b22b-5ee7-425f-8646-c29007421cb8",
      "org_id": "90b14ef9-7389-42b7-a3f2-f8c05051a8cc",
      "name": "Production Core",
      "created_at": "2026-07-02T13:02:00Z"
    }
  }
  ```

### Create Queue
* **Method & Path**: `POST /projects/:projectId/queues`
* **Request Body**:
  ```json
  {
    "name": "image-resize",
    "priority": 10,
    "concurrency_limit": 5,
    "retry_policy_id": "00000000-0000-0000-0000-000000000002",
    "shard_key": "default"
  }
  ```
* **Success Response (201 Created)**:
  ```json
  {
    "data": {
      "id": "b132bb82-f5bf-4127-991b-68e1b6f00db1",
      "project_id": "4e73b22b-5ee7-425f-8646-c29007421cb8",
      "name": "image-resize",
      "priority": 10,
      "concurrency_limit": 5,
      "retry_policy_id": "00000000-0000-0000-0000-000000000002",
      "is_paused": false,
      "created_at": "2026-07-02T13:05:00Z"
    }
  }
  ```

### Update Queue Configuration (Pause/Resume, Concurrency)
* **Method & Path**: `PATCH /queues/:id`
* **Request Body**:
  ```json
  {
    "concurrency_limit": 10,
    "is_paused": true
  }
  ```
* **Success Response (200 OK)**:
  ```json
  {
    "data": {
      "id": "b132bb82-f5bf-4127-991b-68e1b6f00db1",
      "project_id": "4e73b22b-5ee7-425f-8646-c29007421cb8",
      "name": "image-resize",
      "priority": 10,
      "concurrency_limit": 10,
      "retry_policy_id": "00000000-0000-0000-0000-000000000002",
      "is_paused": true,
      "created_at": "2026-07-02T13:05:00Z"
    }
  }
  ```

### Get Queue Stats (Throughput, success rate, average duration)
* **Method & Path**: `GET /queues/:id/stats`
* **Success Response (200 OK)**:
  ```json
  {
    "data": {
      "total_jobs": 420,
      "queued": 5,
      "running": 2,
      "completed": 400,
      "failed": 10,
      "dead_letter": 3,
      "avg_execution_ms": 1420,
      "success_rate": 96.85,
      "throughput_per_minute": 24.2
    }
  }
  ```

---

## 3. Jobs Management

### Submit Job
* **Method & Path**: `POST /queues/:queueId/jobs`
* **Request Body (Immediate)**:
  ```json
  {
    "type": "immediate",
    "payload": { "image_url": "s3://bucket/photo.jpg" },
    "priority": 5,
    "idempotency_key": "unique-uuid-key-here",
    "depends_on": []
  }
  ```
* **Request Body (Delayed)**:
  ```json
  {
    "type": "delayed",
    "payload": { "task": "notify" },
    "delay_ms": 60000
  }
  ```
* **Request Body (Recurring)**:
  ```json
  {
    "type": "recurring",
    "payload": { "cleanup": true },
    "cron_expression": "0 0 * * *"
  }
  ```
* **Request Body (Batch)**:
  ```json
  {
    "type": "batch",
    "batch_jobs": [
      { "payload": { "chunk": 1 } },
      { "payload": { "chunk": 2 } }
    ]
  }
  ```
* **Success Response (201 Created)**:
  ```json
  {
    "data": {
      "id": "fa2b32bd-482a-4a69-a1b7-a3f295bb8e46",
      "queue_id": "b132bb82-f5bf-4127-991b-68e1b6f00db1",
      "type": "immediate",
      "payload": { "image_url": "s3://bucket/photo.jpg" },
      "status": "queued",
      "priority": 5,
      "run_at": "2026-07-02T13:10:00Z",
      "attempts": 0,
      "max_attempts": 3,
      "idempotency_key": "unique-uuid-key-here",
      "created_at": "2026-07-02T13:10:00Z",
      "updated_at": "2026-07-02T13:10:00Z"
    }
  }
  ```

### List Jobs (with pagination & filter query params)
* **Method & Path**: `GET /jobs?status=running&type=immediate&page=1&limit=2`
* **Success Response (200 OK)**:
  ```json
  {
    "data": [
      {
        "id": "fa2b32bd-482a-4a69-a1b7-a3f295bb8e46",
        "queue_id": "b132bb82-f5bf-4127-991b-68e1b6f00db1",
        "type": "immediate",
        "status": "running",
        "priority": 5,
        "run_at": "2026-07-02T13:10:00Z",
        "attempts": 1,
        "max_attempts": 3
      }
    ],
    "pagination": {
      "page": 1,
      "limit": 2,
      "total": 1,
      "total_pages": 1
    }
  }
  ```

### Replay Failed / DLQ Job
* **Method & Path**: `POST /jobs/:id/retry`
* **Success Response (200 OK)**:
  ```json
  {
    "data": {
      "id": "fa2b32bd-482a-4a69-a1b7-a3f295bb8e46",
      "status": "queued",
      "attempts": 0
    }
  }
```

### Job Dependencies
* **Method & Path**: `GET /jobs/:id/dependencies`
* **Purpose**: Returns prerequisite jobs for a workflow-dependent job.

### System Events
* **Method & Path**: `GET /events?page=1&limit=40`
* **Purpose**: Returns persisted events used by the live dashboard and worker wakeups.

### Project Members / RBAC
* **Method & Path**: `GET /projects/:id/members`
* **Purpose**: Lists organization members and roles for a project.
* **Method & Path**: `POST /projects/:id/members`
* **Body**:
  ```json
  {
    "email": "operator@example.com",
    "role": "operator"
  }
  ```

---

## 4. Workers & DLQ

### List Workers (Stale Detection)
* **Method & Path**: `GET /workers`
* **Success Response (200 OK)**:
  ```json
  {
    "data": [
      {
        "id": "c869fb8d-a41a-4712-ae01-44755fa6dcf1",
        "name": "worker-prod-1",
        "status": "busy",
        "effective_status": "busy",
        "last_heartbeat_at": "2026-07-02T13:14:50Z",
        "started_at": "2026-07-02T12:00:00Z",
        "active_jobs": 2
      }
    ]
  }
  ```

### List Dead Letter Queue Entries
* **Method & Path**: `GET /dlq`
* **Success Response (200 OK)**:
  ```json
  {
    "data": [
      {
        "id": "58ebcdfa-14da-44a6-b51f-d227b605abf4",
        "original_job_id": "fa2b32bd-482a-4a69-a1b7-a3f295bb8e46",
        "queue_id": "b132bb82-f5bf-4127-991b-68e1b6f00db1",
        "failure_reason": "Timeout of 30000ms exceeded",
        "attempts_made": 3,
        "moved_at": "2026-07-02T13:12:00Z"
      }
    ]
  }
  ```

### Replay DLQ Entry
* **Method & Path**: `POST /dlq/:id/replay`
* **Success Response (200 OK)**:
  ```json
  {
    "data": {
      "id": "fa2b32bd-482a-4a69-a1b7-a3f295bb8e46",
      "status": "queued",
      "attempts": 0
    }
  }
  ```
