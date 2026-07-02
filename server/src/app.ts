import express from 'express';
import cors from 'cors';
import { errorHandler } from './middleware/errorHandler';
import { rateLimitMiddleware } from './middleware/rateLimit';
import authRoutes from './modules/auth/auth.routes';
import projectRoutes from './modules/projects/projects.routes';
import queueRoutes from './modules/queues/queues.routes';
import jobRoutes from './modules/jobs/jobs.routes';
import workerRoutes from './modules/workers/workers.routes';
import dlqRoutes from './modules/dlq/dlq.routes';
import eventRoutes from './modules/events/events.routes';
import batchRoutes from './modules/batches/batches.routes';

const app = express();

// Middlewares
app.use(cors());
app.use(express.json());
app.use(rateLimitMiddleware);

// Health check & Root landing page (public)
app.get('/health', (req, res) => {
  res.json({ status: 'healthy', timestamp: new Date().toISOString() });
});

app.get('/', (req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html>
      <head>
        <title>Distributed Job Scheduler — API</title>
        <style>
          body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; background: #f8fafc; color: #0f172a; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0; }
          .card { background: white; border: 1px solid #e2e8f0; padding: 40px; border-radius: 16px; text-align: center; max-width: 480px; box-shadow: 0 4px 6px -1px rgba(0,0,0,0.05); }
          h1 { margin-top: 0; font-size: 24px; font-weight: 700; color: #0f172a; }
          p { color: #64748b; font-size: 14px; line-height: 1.6; margin-bottom: 24px; }
          a { background: #4f46e5; color: white; text-decoration: none; padding: 12px 24px; border-radius: 8px; font-weight: 600; font-size: 14px; display: inline-block; }
          a:hover { background: #4338ca; }
        </style>
      </head>
      <body>
        <div class="card">
          <h1>Distributed Job Scheduler API</h1>
          <p>The backend REST API server & background workers are running smoothly.</p>
          <a href="http://localhost:5173">Open Web Dashboard</a>
        </div>
      </body>
    </html>
  `);
});

// Routes
app.use('/auth', authRoutes);
app.use('/projects', projectRoutes);
app.use('/', queueRoutes); // Handles projects/:projectId/queues, queues, queues/:id, etc.
app.use('/', jobRoutes);   // Handles queues/:queueId/jobs, jobs, jobs/:id, etc.
app.use('/', batchRoutes); // Handles batches, batches/:id, etc.
app.use('/workers', workerRoutes);
app.use('/dlq', dlqRoutes);
app.use('/events', eventRoutes);

// Error handling middleware
app.use(errorHandler);

export default app;
