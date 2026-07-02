import React, { useEffect, useState } from 'react';
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  Cpu,
  Database,
  Folder,
  Grid,
  Layers,
  LogOut,
  Pause,
  Play,
  Plus,
  RefreshCw,
  RotateCcw,
  Settings,
  Terminal,
  User,
  Zap,
} from 'lucide-react';
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

import { BatchesTab } from './components/BatchesTab';
import { CreateJobModal } from './components/CreateJobModal';
import { MetricsTab } from './components/MetricsTab';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000';

type Tab = 'queues' | 'jobs' | 'batches' | 'workers' | 'dlq' | 'metrics' | 'events';

interface UserInfo {
  email: string;
  name?: string;
}

export default function App() {
  const [token, setToken] = useState<string | null>(localStorage.getItem('token'));
  const [userInfo, setUserInfo] = useState<UserInfo | null>(
    localStorage.getItem('user') ? JSON.parse(localStorage.getItem('user')!) : null,
  );

  const [isRegister, setIsRegister] = useState(false);
  const [authEmail, setAuthEmail] = useState('');
  const [authPassword, setAuthPassword] = useState('');
  const [authName, setAuthName] = useState('');
  const [authError, setAuthError] = useState('');
  const [loading, setLoading] = useState(false);

  const [activeTab, setActiveTab] = useState<Tab>('queues');
  const [projects, setProjects] = useState<any[]>([]);
  const [activeProject, setActiveProject] = useState<any | null>(null);
  const [queues, setQueues] = useState<any[]>([]);
  const [retryPolicies, setRetryPolicies] = useState<any[]>([]);
  const [queueStats, setQueueStats] = useState<Record<string, any>>({});
  const [jobs, setJobs] = useState<any[]>([]);
  const [jobsPagination, setJobsPagination] = useState({ page: 1, limit: 10, total: 0, total_pages: 1 });
  const [workers, setWorkers] = useState<any[]>([]);
  const [workerHeartbeats, setWorkerHeartbeats] = useState<any[]>([]);
  const [selectedWorker, setSelectedWorker] = useState<any | null>(null);
  const [dlqEntries, setDlqEntries] = useState<any[]>([]);
  const [systemEvents, setSystemEvents] = useState<any[]>([]);
  const [metricsHistory, setMetricsHistory] = useState<any[]>([]);
  const [selectedJob, setSelectedJob] = useState<any | null>(null);
  const [selectedJobLogs, setSelectedJobLogs] = useState<any[]>([]);
  const [selectedJobExecutions, setSelectedJobExecutions] = useState<any[]>([]);
  const [selectedJobDependencies, setSelectedJobDependencies] = useState<any[]>([]);
  const [realtimeConnected, setRealtimeConnected] = useState(false);
  const [refreshTrigger, setRefreshTrigger] = useState(0);

  const [showProjectModal, setShowProjectModal] = useState(false);
  const [projectName, setProjectName] = useState('');
  const [projectOrg, setProjectOrg] = useState('');
  const [showQueueModal, setShowQueueModal] = useState(false);
  const [queueName, setQueueName] = useState('');
  const [queuePriority, setQueuePriority] = useState(0);
  const [queueConcurrency, setQueueConcurrency] = useState(5);
  const [queueRetryPolicy, setQueueRetryPolicy] = useState('00000000-0000-0000-0000-000000000002');
  const [queueShard, setQueueShard] = useState('default');
  const [editingQueue, setEditingQueue] = useState<any | null>(null);

  const [submittingQueue, setSubmittingQueue] = useState<any | null>(null);
  const [jobType, setJobType] = useState<'immediate' | 'delayed' | 'scheduled' | 'recurring' | 'batch'>('immediate');
  const [jobPayload, setJobPayload] = useState('{\n  "duration_ms": 1200,\n  "failure_rate": 0\n}');
  const [jobPriority, setJobPriority] = useState(0);
  const [jobMaxAttempts, setJobMaxAttempts] = useState(3);
  const [jobIdempotencyKey, setJobIdempotencyKey] = useState('');
  const [jobDependsOn, setJobDependsOn] = useState('');
  const [jobDelayMs, setJobDelayMs] = useState(5000);
  const [jobRunAt, setJobRunAt] = useState(new Date(Date.now() + 60000).toISOString().slice(0, 16));
  const [jobCron, setJobCron] = useState('*/5 * * * *');
  const [jobBatchCount, setJobBatchCount] = useState(3);
  const [jobFilterStatus, setJobFilterStatus] = useState('');
  const [jobFilterType, setJobFilterType] = useState('');

  const headers = () => ({
    'Content-Type': 'application/json',
    Authorization: `Bearer ${token}`,
  });

  const formatApiError = (data: any, fallback: string) => {
    const details = data?.error?.details;
    if (Array.isArray(details) && details.length > 0) {
      return details
        .map((detail) => detail.field ? `${detail.field}: ${detail.message}` : detail.message)
        .join('\n');
    }
    return data?.error?.message || fallback;
  };

  useEffect(() => {
    if (!token) return;
    const timer = setInterval(() => setRefreshTrigger((prev) => prev + 1), 3000);
    return () => clearInterval(timer);
  }, [token]);

  useEffect(() => {
    if (!token) return;
    fetchProjects();
    fetchRetryPolicies();
    fetchEvents();

    const socket = new WebSocket(`${API_URL.replace(/^http/, 'ws')}/ws`);
    socket.onopen = () => setRealtimeConnected(true);
    socket.onclose = () => setRealtimeConnected(false);
    socket.onerror = () => setRealtimeConnected(false);
    socket.onmessage = (message) => {
      try {
        const event = JSON.parse(message.data);
        setSystemEvents((prev) => [event, ...prev].slice(0, 40));
      } catch {
        // Ignore non-JSON websocket frames.
      }
      setRefreshTrigger((prev) => prev + 1);
    };

    return () => socket.close();
  }, [token]);

  useEffect(() => {
    if (!token || !activeProject) return;
    fetchQueues();
  }, [token, activeProject, refreshTrigger]);

  useEffect(() => {
    if (!token) return;
    if (activeTab === 'jobs') fetchJobs();
    if (activeTab === 'workers') fetchWorkers();
    if (activeTab === 'dlq') fetchDlq();
    if (activeTab === 'events') fetchEvents();
  }, [token, activeTab, jobFilterStatus, jobFilterType, jobsPagination.page, refreshTrigger]);

  useEffect(() => {
    if (!token || queues.length === 0) return;
    fetchQueueStats();
  }, [token, queues, refreshTrigger]);

  const handleAuth = async (event: React.FormEvent) => {
    event.preventDefault();
    setLoading(true);
    setAuthError('');

    try {
      const res = await fetch(`${API_URL}${isRegister ? '/auth/register' : '/auth/login'}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(isRegister
          ? { email: authEmail, password: authPassword, name: authName }
          : { email: authEmail, password: authPassword }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error?.message || 'Authentication failed');

      localStorage.setItem('token', data.data.token);
      localStorage.setItem('user', JSON.stringify(data.data.user));
      setToken(data.data.token);
      setUserInfo(data.data.user);
    } catch (err: any) {
      setAuthError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const fetchProjects = async () => {
    const res = await fetch(`${API_URL}/projects`, { headers: headers() });
    const data = await res.json();
    if (data.data) {
      setProjects(data.data);
      setActiveProject((current: any | null) => current || data.data[0] || null);
    }
  };

  const fetchRetryPolicies = async () => {
    const res = await fetch(`${API_URL}/retry-policies`, { headers: headers() });
    const data = await res.json();
    if (data.data) setRetryPolicies(data.data);
  };

  const fetchQueues = async () => {
    if (!activeProject) return;
    const res = await fetch(`${API_URL}/queues?project_id=${activeProject.id}`, { headers: headers() });
    const data = await res.json();
    if (data.data) setQueues(data.data);
  };

  const fetchQueueStats = async () => {
    const stats: Record<string, any> = {};
    for (const queue of queues) {
      const res = await fetch(`${API_URL}/queues/${queue.id}/stats`, { headers: headers() });
      const data = await res.json();
      if (data.data) stats[queue.id] = data.data;
    }
    setQueueStats(stats);

    const aggregate = Object.values(stats).reduce((acc: any, item: any) => ({
      completed: acc.completed + item.completed,
      failed: acc.failed + item.failed + item.dead_letter,
      running: acc.running + item.running + item.queued,
      latency: acc.latency + (item.avg_execution_ms || 0),
      latencyCount: acc.latencyCount + (item.avg_execution_ms ? 1 : 0),
    }), { completed: 0, failed: 0, running: 0, latency: 0, latencyCount: 0 });

    setMetricsHistory((prev) => [
      ...prev,
      {
        time: new Date().toLocaleTimeString(),
        throughput: aggregate.completed,
        failures: aggregate.failed,
        inFlight: aggregate.running,
        latency: aggregate.latencyCount ? Math.round(aggregate.latency / aggregate.latencyCount) : 0,
      },
    ].slice(-12));
  };

  const fetchJobs = async () => {
    const params = new URLSearchParams({ page: String(jobsPagination.page), limit: String(jobsPagination.limit) });
    if (jobFilterStatus) params.set('status', jobFilterStatus);
    if (jobFilterType) params.set('type', jobFilterType);
    const res = await fetch(`${API_URL}/jobs?${params}`, { headers: headers() });
    const data = await res.json();
    if (data.data) {
      setJobs(data.data);
      setJobsPagination(data.pagination);
    }
  };

  const fetchWorkers = async () => {
    const res = await fetch(`${API_URL}/workers`, { headers: headers() });
    const data = await res.json();
    if (data.data) setWorkers(data.data);
  };

  const fetchWorkerHeartbeats = async (workerId: string) => {
    const res = await fetch(`${API_URL}/workers/${workerId}/heartbeats?limit=20`, { headers: headers() });
    const data = await res.json();
    if (data.data) setWorkerHeartbeats(data.data);
  };

  const fetchDlq = async () => {
    const res = await fetch(`${API_URL}/dlq`, { headers: headers() });
    const data = await res.json();
    if (data.data) setDlqEntries(data.data);
  };

  const fetchEvents = async () => {
    const res = await fetch(`${API_URL}/events?limit=40`, { headers: headers() });
    const data = await res.json();
    if (data.data) setSystemEvents(data.data);
  };

  const fetchJobDetails = async (jobId: string) => {
    const [jobRes, logsRes, execRes, depsRes] = await Promise.all([
      fetch(`${API_URL}/jobs/${jobId}`, { headers: headers() }),
      fetch(`${API_URL}/jobs/${jobId}/logs?limit=60`, { headers: headers() }),
      fetch(`${API_URL}/jobs/${jobId}/executions`, { headers: headers() }),
      fetch(`${API_URL}/jobs/${jobId}/dependencies`, { headers: headers() }),
    ]);
    const [jobData, logsData, execData, depsData] = await Promise.all([
      jobRes.json(),
      logsRes.json(),
      execRes.json(),
      depsRes.json(),
    ]);

    if (jobData.data) setSelectedJob(jobData.data);
    if (logsData.data) setSelectedJobLogs(logsData.data);
    if (execData.data) setSelectedJobExecutions(execData.data);
    if (depsData.data) setSelectedJobDependencies(depsData.data);
  };

  const createProject = async (event: React.FormEvent) => {
    event.preventDefault();
    try {
      const res = await fetch(`${API_URL}/projects`, {
        method: 'POST',
        headers: headers(),
        body: JSON.stringify({ name: projectName, org_name: projectOrg || undefined }),
      });
      const data = await res.json();
      if (!res.ok) {
        alert(formatApiError(data, 'Failed to create project'));
        return;
      }
      setProjectName('');
      setProjectOrg('');
      setShowProjectModal(false);
      await fetchProjects();
      setActiveProject(data.data);
    } catch (err: any) {
      alert(err.message || 'Failed to create project');
    }
  };

  const createQueue = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!activeProject) return;
    const res = await fetch(`${API_URL}/projects/${activeProject.id}/queues`, {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify({
        name: queueName,
        priority: queuePriority,
        concurrency_limit: queueConcurrency,
        retry_policy_id: queueRetryPolicy || null,
        shard_key: queueShard || 'default',
      }),
    });
    if (res.ok) {
      setQueueName('');
      setQueuePriority(0);
      setQueueConcurrency(5);
      setQueueShard('default');
      setShowQueueModal(false);
      fetchQueues();
    }
  };

  const updateQueue = async (queue: any, updates: Record<string, unknown>) => {
    await fetch(`${API_URL}/queues/${queue.id}`, {
      method: 'PATCH',
      headers: headers(),
      body: JSON.stringify(updates),
    });
    setEditingQueue(null);
    fetchQueues();
  };

  const submitJob = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!submittingQueue) return;

    let payload: Record<string, unknown>;
    try {
      payload = JSON.parse(jobPayload);
    } catch {
      alert('Payload must be valid JSON.');
      return;
    }

    const body: any = {
      type: jobType,
      payload,
      priority: jobPriority,
      max_attempts: jobMaxAttempts,
      idempotency_key: jobIdempotencyKey || undefined,
      depends_on: jobDependsOn.split(',').map((item) => item.trim()).filter(Boolean),
    };

    if (jobType === 'delayed') body.delay_ms = jobDelayMs;
    if (jobType === 'scheduled') body.run_at = new Date(jobRunAt).toISOString();
    if (jobType === 'recurring') body.cron_expression = jobCron;
    if (jobType === 'batch') {
      body.batch_jobs = Array.from({ length: jobBatchCount }, (_, index) => ({
        payload: { ...payload, batch_index: index },
        priority: jobPriority,
        max_attempts: jobMaxAttempts,
      }));
    }

    const res = await fetch(`${API_URL}/queues/${submittingQueue.id}/jobs`, {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify(body),
    });
    const data = await res.json();
    if (!res.ok) {
      alert(formatApiError(data, 'Failed to submit job'));
      return;
    }

    setSubmittingQueue(null);
    setJobIdempotencyKey('');
    setJobDependsOn('');
    setActiveTab('jobs');
    fetchJobs();
  };

  const retryJob = async (jobId: string) => {
    await fetch(`${API_URL}/jobs/${jobId}/retry`, { method: 'POST', headers: headers() });
    fetchJobs();
    fetchJobDetails(jobId);
  };

  const replayDlq = async (dlqId: string) => {
    await fetch(`${API_URL}/dlq/${dlqId}/replay`, { method: 'POST', headers: headers() });
    fetchDlq();
  };

  const logout = () => {
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    setToken(null);
    setUserInfo(null);
    setActiveProject(null);
  };

  if (!token) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
        <form onSubmit={handleAuth} className="w-full max-w-md bg-white border border-slate-200 rounded-2xl p-8 shadow-xl space-y-4">
          <div className="text-center mb-6">
            <div className="w-12 h-12 bg-indigo-600 rounded-xl flex items-center justify-center mx-auto mb-3">
              <Cpu className="w-6 h-6 text-white" />
            </div>
            <h1 className="text-2xl font-bold text-slate-900">Distributed Scheduler</h1>
            <p className="text-sm text-slate-500">Production async job orchestration</p>
          </div>

          {isRegister && (
            <Input label="Name" value={authName} onChange={setAuthName} placeholder="Jane Doe" />
          )}
          <Input label="Email" value={authEmail} onChange={setAuthEmail} placeholder="you@company.com" type="email" />
          <Input label="Password" value={authPassword} onChange={setAuthPassword} placeholder="password" type="password" />

          {authError && <div className="text-xs text-rose-700 bg-rose-50 border border-rose-200 rounded-lg p-3">{authError}</div>}

          <button disabled={loading} className="w-full bg-indigo-600 hover:bg-indigo-700 disabled:bg-indigo-300 text-white rounded-lg py-2.5 text-sm font-semibold">
            {loading ? 'Please wait...' : isRegister ? 'Create Account' : 'Sign In'}
          </button>
          <button type="button" onClick={() => setIsRegister(!isRegister)} className="w-full text-xs font-semibold text-indigo-700">
            {isRegister ? 'Already have an account? Sign in' : 'Need an account? Sign up'}
          </button>
        </form>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 flex flex-col">
      <header className="h-16 bg-white border-b border-slate-200 px-6 flex items-center justify-between shrink-0">
        <div className="flex items-center gap-5">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 bg-indigo-600 rounded-lg flex items-center justify-center">
              <Database className="w-4 h-4 text-white" />
            </div>
            <div>
              <div className="font-bold text-sm">Distributed Scheduler</div>
              <div className="text-[11px] text-slate-500">Live worker control plane</div>
            </div>
          </div>

          <select
            className="bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-xs font-semibold"
            value={activeProject?.id || ''}
            onChange={(event) => setActiveProject(projects.find((project) => project.id === event.target.value) || null)}
          >
            {projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}
          </select>
          <IconButton label="New project" onClick={() => setShowProjectModal(true)} icon={<Plus className="w-4 h-4" />} />
        </div>

        <div className="flex items-center gap-4">
          <div className={`hidden sm:flex items-center gap-2 text-xs font-semibold rounded-full border px-3 py-1 ${realtimeConnected ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : 'bg-slate-50 text-slate-500 border-slate-200'}`}>
            <span className={`w-2 h-2 rounded-full ${realtimeConnected ? 'bg-emerald-500' : 'bg-slate-300'}`} />
            {realtimeConnected ? 'Live' : 'Polling'}
          </div>
          <div className="hidden md:flex items-center gap-2 text-xs font-semibold text-slate-600">
            <User className="w-4 h-4" />
            {userInfo?.name || userInfo?.email}
          </div>
          <IconButton label="Log out" onClick={logout} icon={<LogOut className="w-4 h-4" />} />
        </div>
      </header>

      <div className="flex flex-1 overflow-hidden">
        <aside className="w-60 bg-slate-50 border-r border-slate-200 p-4 hidden md:flex flex-col gap-1.5">
          <NavButton active={activeTab === 'queues'} icon={<Layers />} label="Queues" onClick={() => setActiveTab('queues')} />
          <NavButton active={activeTab === 'jobs'} icon={<Grid />} label="Jobs" onClick={() => setActiveTab('jobs')} />
          <NavButton active={activeTab === 'batches'} icon={<Folder />} label="Batches" onClick={() => setActiveTab('batches')} />
          <NavButton active={activeTab === 'workers'} icon={<Cpu />} label="Workers" onClick={() => setActiveTab('workers')} />
          <NavButton active={activeTab === 'dlq'} icon={<AlertTriangle />} label="DLQ" onClick={() => setActiveTab('dlq')} />
          <NavButton active={activeTab === 'metrics'} icon={<Activity />} label="Metrics" onClick={() => setActiveTab('metrics')} />
          <NavButton active={activeTab === 'events'} icon={<Zap />} label="Live Events" onClick={() => setActiveTab('events')} />
        </aside>

        <main className="flex-1 overflow-y-auto p-4 md:p-8">
          {activeTab === 'batches' && (
            <BatchesTab apiUrl={API_URL} headers={headers} refreshTrigger={refreshTrigger} />
          )}

          {activeTab === 'queues' && (
            <Section title="Queue Management" subtitle="Configure priority, concurrency, retry policy, pause state, and shard placement.">
              <div className="flex justify-end mb-4">
                <button onClick={() => setShowQueueModal(true)} className="bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg px-4 py-2 text-xs font-semibold flex items-center gap-2">
                  <Plus className="w-4 h-4" /> Create Queue
                </button>
              </div>
              <div className="grid grid-cols-1 xl:grid-cols-2 gap-5">
                {queues.map((queue) => {
                  const stats = queueStats[queue.id] || {};
                  return (
                    <div key={queue.id} className="bg-white border border-slate-200 rounded-xl p-5 shadow-sm">
                      <div className="flex items-start justify-between gap-4">
                        <div>
                          <div className="flex items-center gap-2">
                            <h3 className="font-bold">{queue.name}</h3>
                            <StatusPill value={queue.is_paused ? 'paused' : 'active'} />
                          </div>
                          <p className="text-xs text-slate-500 mt-1">
                            Priority {queue.priority} | Concurrency {queue.concurrency_limit} | Shard {queue.shard_key || 'default'}
                          </p>
                          <p className="text-xs text-slate-500 mt-1">Retry: {queue.retry_policy_name || 'Default policy'}</p>
                        </div>
                        <div className="flex gap-2">
                          <IconButton label="Edit" onClick={() => setEditingQueue(queue)} icon={<Settings className="w-4 h-4" />} />
                          <IconButton
                            label={queue.is_paused ? 'Resume' : 'Pause'}
                            onClick={() => updateQueue(queue, { is_paused: !queue.is_paused })}
                            icon={queue.is_paused ? <Play className="w-4 h-4" /> : <Pause className="w-4 h-4" />}
                          />
                        </div>
                      </div>
                      <div className="grid grid-cols-3 md:grid-cols-6 gap-2 mt-5">
                        <Metric label="Queued" value={stats.queued || 0} />
                        <Metric label="Blocked" value={stats.blocked || 0} />
                        <Metric label="Running" value={stats.running || 0} />
                        <Metric label="Done" value={stats.completed || 0} />
                        <Metric label="DLQ" value={stats.dead_letter || 0} />
                        <Metric label="Success" value={stats.success_rate !== null && stats.success_rate !== undefined ? `${stats.success_rate}%` : '-'} />
                      </div>
                      <div className="flex justify-between items-center border-t border-slate-100 mt-5 pt-4">
                        <span className="text-xs text-slate-500">{stats.throughput_per_minute || 0}/min throughput</span>
                        <button onClick={() => setSubmittingQueue(queue)} className="text-xs font-semibold px-3 py-1.5 rounded-lg bg-indigo-50 text-indigo-700 border border-indigo-200">
                          Submit Job
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </Section>
          )}

          {activeTab === 'jobs' && (
            <Section title="Job Explorer" subtitle="Inspect job lifecycle, dependency state, attempts, logs, and manual retries.">
              <div className="bg-white border border-slate-200 rounded-xl p-4 mb-4 flex flex-wrap gap-3">
                <Select value={jobFilterStatus} onChange={(value) => { setJobFilterStatus(value); setJobsPagination((p) => ({ ...p, page: 1 })); }} options={['', 'blocked', 'queued', 'scheduled', 'claimed', 'running', 'completed', 'failed', 'dead_letter']} />
                <Select value={jobFilterType} onChange={(value) => { setJobFilterType(value); setJobsPagination((p) => ({ ...p, page: 1 })); }} options={['', 'immediate', 'delayed', 'scheduled', 'recurring', 'batch']} />
                <IconButton label="Refresh" onClick={fetchJobs} icon={<RefreshCw className="w-4 h-4" />} />
              </div>
              <DataTable
                headers={['Job', 'Queue', 'Type', 'Status', 'Shard', 'Attempts', 'Run At', '']}
                rows={jobs.map((job) => [
                  <button className="font-mono text-indigo-700 font-semibold" onClick={() => fetchJobDetails(job.id)}>{job.id.slice(0, 8)}...</button>,
                  job.queue_name,
                  job.type,
                  <StatusPill value={job.status} />,
                  job.shard_key || 'default',
                  `${job.attempts}/${job.max_attempts}`,
                  new Date(job.run_at).toLocaleString(),
                  ['failed', 'dead_letter'].includes(job.status) ? <button onClick={() => retryJob(job.id)} className="text-xs font-semibold text-indigo-700">Retry</button> : '',
                ])}
              />
            </Section>
          )}

          {activeTab === 'workers' && (
            <Section title="Workers" subtitle="Watch worker health, active load, and heartbeat history.">
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
                <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
                  {workers.map((worker) => (
                    <button
                      key={worker.id}
                      onClick={() => { setSelectedWorker(worker); fetchWorkerHeartbeats(worker.id); }}
                      className="w-full text-left p-4 border-b border-slate-100 hover:bg-slate-50"
                    >
                      <div className="flex justify-between items-center">
                        <span className="font-bold text-sm">{worker.name}</span>
                        <StatusPill value={worker.effective_status} />
                      </div>
                      <p className="text-xs text-slate-500 mt-1">Active jobs: {worker.active_jobs}</p>
                    </button>
                  ))}
                </div>
                <div className="lg:col-span-2 bg-white border border-slate-200 rounded-xl p-5">
                  {selectedWorker ? (
                    <div>
                      <h3 className="font-bold">{selectedWorker.name}</h3>
                      <p className="text-xs text-slate-500 mb-4">{selectedWorker.id}</p>
                      <div className="space-y-2">
                        {workerHeartbeats.map((heartbeat) => (
                          <div key={heartbeat.id} className="flex justify-between text-xs bg-slate-50 border border-slate-200 rounded-lg p-3">
                            <span>{new Date(heartbeat.heartbeat_at).toLocaleString()}</span>
                            <span className="font-bold">Active {heartbeat.active_job_count}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  ) : (
                    <div className="text-sm text-slate-500">Select a worker to inspect heartbeat history.</div>
                  )}
                </div>
              </div>
            </Section>
          )}

          {activeTab === 'dlq' && (
            <Section title="Dead Letter Queue" subtitle="Replay permanent failures and review generated failure summaries.">
              <DataTable
                headers={['Queue', 'Original Job', 'Reason', 'AI Summary', 'Attempts', 'Moved At', '']}
                rows={dlqEntries.map((entry) => [
                  entry.queue_name || 'Deleted queue',
                  entry.original_job_id ? `${entry.original_job_id.slice(0, 8)}...` : '-',
                  <span className="text-rose-700">{entry.failure_reason}</span>,
                  entry.failure_summary || '-',
                  entry.attempts_made,
                  new Date(entry.moved_at).toLocaleString(),
                  <button onClick={() => replayDlq(entry.id)} className="text-xs font-semibold text-indigo-700 flex items-center gap-1"><RotateCcw className="w-3 h-3" /> Replay</button>,
                ])}
              />
            </Section>
          )}

          {activeTab === 'metrics' && (
            <MetricsTab
              metricsHistory={metricsHistory}
              queueStats={queueStats}
              queues={queues}
              apiUrl={API_URL}
              headers={headers}
              onSimulationTriggered={() => setRefreshTrigger((prev) => prev + 1)}
            />
          )}

          {activeTab === 'events' && (
            <Section title="Live Events" subtitle="Real-time system event stream from job, queue, scheduler, and DLQ activity.">
              <div className="bg-white border border-slate-200 rounded-xl divide-y divide-slate-100 overflow-hidden">
                {systemEvents.map((event, index) => (
                  <div key={event.id || `${event.event_type}-${index}`} className="p-4 flex flex-col md:flex-row md:items-center md:justify-between gap-2">
                    <div>
                      <div className="font-bold text-sm text-slate-900">{event.event_type}</div>
                      <div className="text-xs text-slate-500">{event.entity_type} {event.entity_id ? `| ${event.entity_id}` : ''}</div>
                    </div>
                    <div className="text-xs text-slate-500">{event.created_at ? new Date(event.created_at).toLocaleString() : 'just now'}</div>
                  </div>
                ))}
              </div>
            </Section>
          )}
        </main>
      </div>

      {selectedJob && (
        <aside className="fixed inset-y-0 right-0 w-full max-w-xl bg-white border-l border-slate-200 shadow-2xl z-50 overflow-y-auto">
          <div className="p-6 space-y-5">
            <div className="flex items-start justify-between">
              <div>
                <h3 className="font-bold text-lg">Job Details</h3>
                <p className="font-mono text-xs text-indigo-700">{selectedJob.id}</p>
              </div>
              <button onClick={() => setSelectedJob(null)} className="text-xs font-semibold text-slate-500">Close</button>
            </div>

            <InfoGrid items={[
              ['Status', selectedJob.status],
              ['Scheduling Type', selectedJob.type],
              ['Task Handler', selectedJob.task_type || 'simulated'],
              ['Shard', selectedJob.shard_key || 'default'],
              ['Attempts', `${selectedJob.attempts}/${selectedJob.max_attempts}`],
            ]} />

            {selectedJob.failure_summary && (
              <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 text-sm text-amber-900">
                <div className="font-bold mb-1">AI Failure Summary</div>
                {selectedJob.failure_summary}
              </div>
            )}

            {selectedJob.result_data && (
              <Panel title="Execution Result / Output">
                <pre className="text-xs bg-slate-950 text-emerald-400 rounded-lg p-3 overflow-auto">
                  {JSON.stringify(selectedJob.result_data, null, 2)}
                </pre>
              </Panel>
            )}

            <Panel title="Payload">
              <pre className="text-xs bg-slate-950 text-slate-100 rounded-lg p-3 overflow-auto">{JSON.stringify(selectedJob.payload, null, 2)}</pre>
            </Panel>

            <Panel title="Workflow Dependencies">
              {selectedJobDependencies.length === 0 ? (
                <p className="text-xs text-slate-500">No dependencies registered.</p>
              ) : selectedJobDependencies.map((dependency) => (
                <div key={dependency.id} className="flex justify-between text-xs border border-slate-200 rounded-lg p-2 mb-2">
                  <span className="font-mono">{dependency.id.slice(0, 8)}...</span>
                  <StatusPill value={dependency.status} />
                </div>
              ))}
            </Panel>

            <Panel title="Execution Logs">
              <div className="space-y-2">
                {selectedJobLogs.map((log) => (
                  <div key={log.id} className="text-xs bg-slate-50 border border-slate-200 rounded-lg p-2">
                    <span className="text-slate-400">{new Date(log.created_at).toLocaleTimeString()} </span>
                    <span className={log.level === 'error' ? 'text-rose-700 font-semibold' : 'text-slate-700'}>{log.message}</span>
                  </div>
                ))}
              </div>
            </Panel>

            <Panel title="Attempt History">
              <div className="space-y-2">
                {selectedJobExecutions.map((execution) => (
                  <div key={execution.id} className="text-xs border border-slate-200 rounded-lg p-3">
                    <div className="flex justify-between">
                      <span className="font-bold">Attempt {execution.attempt_number}</span>
                      <StatusPill value={execution.status} />
                    </div>
                    {execution.error_message && <p className="text-rose-700 mt-1">{execution.error_message}</p>}
                  </div>
                ))}
              </div>
            </Panel>

            {['failed', 'dead_letter'].includes(selectedJob.status) && (
              <button onClick={() => retryJob(selectedJob.id)} className="w-full bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg py-2 text-sm font-semibold">
                Trigger Manual Retry
              </button>
            )}
          </div>
        </aside>
      )}

      {showProjectModal && (
        <Modal title="New Project" onClose={() => setShowProjectModal(false)}>
          <form onSubmit={createProject} className="space-y-4">
            <Input label="Project Name" value={projectName} onChange={setProjectName} placeholder="Core Pipeline" />
            <Input label="Organization Name" value={projectOrg} onChange={setProjectOrg} placeholder="Acme Corp" />
            <SubmitRow onCancel={() => setShowProjectModal(false)} submitLabel="Create Project" />
          </form>
        </Modal>
      )}

      {showQueueModal && (
        <Modal title="Create Queue" onClose={() => setShowQueueModal(false)}>
          <form onSubmit={createQueue} className="space-y-4">
            <Input label="Queue Name" value={queueName} onChange={setQueueName} placeholder="image-processing" />
            <div className="grid grid-cols-2 gap-3">
              <NumberInput label="Priority" value={queuePriority} onChange={setQueuePriority} min={0} max={100} />
              <NumberInput label="Concurrency" value={queueConcurrency} onChange={setQueueConcurrency} min={1} max={100} />
            </div>
            <Input label="Shard Key" value={queueShard} onChange={setQueueShard} placeholder="default" />
            <label className="block">
              <span className="block text-xs font-bold text-slate-500 uppercase mb-1">Retry Policy</span>
              <select value={queueRetryPolicy} onChange={(event) => setQueueRetryPolicy(event.target.value)} className="w-full bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-sm">
                {retryPolicies.map((policy) => <option key={policy.id} value={policy.id}>{policy.name} ({policy.strategy})</option>)}
              </select>
            </label>
            <SubmitRow onCancel={() => setShowQueueModal(false)} submitLabel="Create Queue" />
          </form>
        </Modal>
      )}

      {editingQueue && (
        <Modal title={`Edit ${editingQueue.name}`} onClose={() => setEditingQueue(null)}>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              updateQueue(editingQueue, {
                priority: Number((event.currentTarget.elements.namedItem('priority') as HTMLInputElement).value),
                concurrency_limit: Number((event.currentTarget.elements.namedItem('concurrency') as HTMLInputElement).value),
                shard_key: (event.currentTarget.elements.namedItem('shard') as HTMLInputElement).value,
              });
            }}
            className="space-y-4"
          >
            <input name="priority" type="number" min="0" max="100" defaultValue={editingQueue.priority} className="w-full bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-sm" />
            <input name="concurrency" type="number" min="1" max="100" defaultValue={editingQueue.concurrency_limit} className="w-full bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-sm" />
            <input name="shard" defaultValue={editingQueue.shard_key || 'default'} className="w-full bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-sm" />
            <SubmitRow onCancel={() => setEditingQueue(null)} submitLabel="Save Queue" />
          </form>
        </Modal>
      )}

      {submittingQueue && (
        <CreateJobModal
          queue={submittingQueue}
          onClose={() => setSubmittingQueue(null)}
          formatApiError={formatApiError}
          onSubmit={async (jobData) => {
            const res = await fetch(`${API_URL}/queues/${submittingQueue.id}/jobs`, {
              method: 'POST',
              headers: headers(),
              body: JSON.stringify(jobData),
            });
            const data = await res.json();
            if (!res.ok) {
              throw new Error(formatApiError(data, 'Failed to submit job'));
            }
            fetchJobs();
            if (jobData.type === 'batch') {
              setActiveTab('batches');
            } else {
              setActiveTab('jobs');
            }
          }}
        />
      )}
    </div>
  );
}

function Section({ title, subtitle, children }: { title: string; subtitle: string; children: React.ReactNode }) {
  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-xl font-bold text-slate-900">{title}</h2>
        <p className="text-xs text-slate-500 mt-1">{subtitle}</p>
      </div>
      {children}
    </div>
  );
}

function NavButton({ active, icon, label, onClick }: { active: boolean; icon: React.ReactElement; label: string; onClick: () => void }) {
  return (
    <button onClick={onClick} className={`flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-semibold ${active ? 'bg-indigo-50 text-indigo-700 border border-indigo-100' : 'text-slate-600 hover:bg-slate-100'}`}>
      {React.cloneElement(icon, { className: 'w-4 h-4' })}
      {label}
    </button>
  );
}

function IconButton({ label, icon, onClick }: { label: string; icon: React.ReactNode; onClick: () => void }) {
  return (
    <button title={label} onClick={onClick} className="p-2 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 border border-slate-200">
      {icon}
    </button>
  );
}

function Metric({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="bg-slate-50 border border-slate-100 rounded-lg p-2 text-center">
      <div className="text-[10px] text-slate-400 font-bold uppercase">{label}</div>
      <div className="text-sm font-bold text-slate-900 mt-1">{value}</div>
    </div>
  );
}

function StatusPill({ value }: { value: string }) {
  const color = value === 'completed' || value === 'active' || value === 'idle'
    ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
    : value === 'running' || value === 'busy'
      ? 'bg-sky-50 text-sky-700 border-sky-200'
      : value === 'failed' || value === 'dead_letter'
        ? 'bg-rose-50 text-rose-700 border-rose-200'
        : value === 'blocked' || value === 'paused'
          ? 'bg-amber-50 text-amber-700 border-amber-200'
          : 'bg-slate-100 text-slate-700 border-slate-200';

  return <span className={`inline-flex rounded-full border px-2 py-0.5 text-[11px] font-bold ${color}`}>{value}</span>;
}

function DataTable({ headers, rows }: { headers: string[]; rows: React.ReactNode[][] }) {
  return (
    <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-left">
          <thead className="bg-slate-50 border-b border-slate-200">
            <tr>{headers.map((header) => <th key={header} className="px-4 py-3 text-[11px] font-bold text-slate-500 uppercase">{header}</th>)}</tr>
          </thead>
          <tbody className="divide-y divide-slate-100 text-xs">
            {rows.length > 0 ? rows.map((row, rowIndex) => (
              <tr key={rowIndex} className="hover:bg-slate-50">
                {row.map((cell, cellIndex) => <td key={cellIndex} className="px-4 py-3 align-top">{cell}</td>)}
              </tr>
            )) : (
              <tr><td colSpan={headers.length} className="px-4 py-8 text-center text-slate-400">No records found.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function ChartCard({ title, children }: { title: string; children: React.ReactElement }) {
  return (
    <div className="bg-white border border-slate-200 rounded-xl p-5">
      <h3 className="text-xs font-bold uppercase text-slate-500 mb-4">{title}</h3>
      <div className="h-72">
        <ResponsiveContainer width="100%" height="100%">{children}</ResponsiveContainer>
      </div>
    </div>
  );
}

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h4 className="text-xs font-bold uppercase text-slate-500 mb-2">{title}</h4>
      {children}
    </section>
  );
}

function InfoGrid({ items }: { items: Array<[string, React.ReactNode]> }) {
  return (
    <div className="grid grid-cols-2 gap-2">
      {items.map(([label, value]) => (
        <div key={label} className="bg-slate-50 border border-slate-200 rounded-lg p-3">
          <div className="text-[10px] uppercase font-bold text-slate-400">{label}</div>
          <div className="text-sm font-semibold mt-1">{value}</div>
        </div>
      ))}
    </div>
  );
}

function Modal({ title, children, onClose, wide = false }: { title: string; children: React.ReactNode; onClose: () => void; wide?: boolean }) {
  return (
    <div className="fixed inset-0 bg-slate-900/40 flex items-center justify-center p-4 z-50">
      <div className={`bg-white rounded-xl border border-slate-200 shadow-2xl p-6 w-full ${wide ? 'max-w-2xl' : 'max-w-md'} max-h-[90vh] overflow-y-auto`}>
        <div className="flex justify-between items-center mb-4">
          <h3 className="font-bold">{title}</h3>
          <button onClick={onClose} className="text-xs font-semibold text-slate-500">Close</button>
        </div>
        {children}
      </div>
    </div>
  );
}

function Input({ label, value, onChange, placeholder, type = 'text' }: { label: string; value: string; onChange: (value: string) => void; placeholder?: string; type?: string }) {
  return (
    <label className="block">
      <span className="block text-xs font-bold text-slate-500 uppercase mb-1">{label}</span>
      <input type={type} value={value} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} className="w-full bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-sm" />
    </label>
  );
}

function NumberInput({ label, value, onChange, min, max }: { label: string; value: number; onChange: (value: number) => void; min?: number; max?: number }) {
  return (
    <label className="block">
      <span className="block text-xs font-bold text-slate-500 uppercase mb-1">{label}</span>
      <input type="number" min={min} max={max} value={value} onChange={(event) => onChange(Number(event.target.value))} className="w-full bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-sm" />
    </label>
  );
}

function Select({ value, onChange, options }: { value: string; onChange: (value: string) => void; options: string[] }) {
  return (
    <select value={value} onChange={(event) => onChange(event.target.value)} className="bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-xs font-semibold">
      {options.map((option) => <option key={option} value={option}>{option || 'all'}</option>)}
    </select>
  );
}

function SubmitRow({ onCancel, submitLabel }: { onCancel: () => void; submitLabel: string }) {
  return (
    <div className="flex gap-3 pt-2">
      <button type="button" onClick={onCancel} className="flex-1 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg py-2 text-xs font-semibold">Cancel</button>
      <button type="submit" className="flex-1 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg py-2 text-xs font-semibold">{submitLabel}</button>
    </div>
  );
}
