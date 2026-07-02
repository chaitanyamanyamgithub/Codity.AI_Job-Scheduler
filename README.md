# Distributed Job Scheduler

A production-grade distributed job scheduling platform built with Node.js, TypeScript, Express, PostgreSQL, and React.

## Key Features
- **Atomic claiming**: Enforced via `FOR UPDATE SKIP LOCKED` + CTE capacity limit matching to avoid double claiming.
- **5 Job Types**: Supports Immediate, Delayed, Scheduled, Recurring (Cron), and Batch jobs.
- **Configurable Retries**: Fixed, Linear, and Exponential backoff policies with ±15% jitter.
- **Dead Letter Queue (DLQ)**: Automatic failure redirection with manual replay capability.
- **Stale Worker Detection**: Identifies crashed worker processes when heartbeats fall behind threshold.
- **Responsive Dashboard**: Dark/light mode theme using Tailwind CSS v3 and Recharts.
- **Bonus Features**: Workflow dependencies, RBAC, rate limiting, queue sharding, distributed locks, event-driven wakeups, WebSocket live updates, and local AI-style failure summaries.

---

## Getting Started

### 1. Prerequisites
- [Docker](https://www.docker.com/) and [Docker Compose](https://docs.docker.com/compose/) installed.

### 2. Startup (Single Command)
Run this command from the root directory to spin up PostgreSQL, the API Server, a Background Worker, and the React client:
```bash
docker-compose up --build
```

- **React Dashboard**: [http://localhost:5173](http://localhost:5173)
- **API Server Gateway**: [http://localhost:3000](http://localhost:3000)

### 3. Creating an Account & Initial Project
1. Open the dashboard at [http://localhost:5173](http://localhost:5173).
2. Click **Sign Up** to register a new account.
3. Once logged in, click the **+** folder icon in the top header to create a new project.
4. Go to **Queues** tab and click **Create Queue** (e.g. `resize-images`).
5. Click **Submit Job** to schedule any of the 5 job types!

---

## Technical Specifications & Documentation

- [System Architecture](file:///docs/architecture.md)
- [ER Diagram](file:///docs/er-diagram.md)
- [Design Decisions & Trade-offs](file:///docs/design-decisions.md)
- [REST API Specification](file:///docs/api-spec.md)

---

## Running Automated Tests

To execute tests locally without Docker, make sure you have a local PostgreSQL running with the connection string defined in `server/.env` (copied from `server/.env.example`). Then run:

```bash
# Install dependencies
cd server
npm install

# Run all unit tests
npm run test:unit

# Run API integration tests
npm run test:integration

# Run worker concurrency race tests
npm run test:concurrency
```
