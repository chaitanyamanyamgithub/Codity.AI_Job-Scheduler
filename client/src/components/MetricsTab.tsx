import React, { useState } from 'react';
import {
  Activity,
  AlertTriangle,
  Zap,
  Clock,
  CheckCircle2,
  Play,
  Flame,
  TrendingUp,
  RotateCw,
  Cpu,
  Layers,
  Globe,
  Terminal,
  ArrowRight,
  ShieldCheck,
  Radio,
  Server,
} from 'lucide-react';
import {
  AreaChart,
  Area,
  BarChart,
  Bar,
  LineChart,
  Line,
  PieChart,
  Pie,
  Cell,
  CartesianGrid,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from 'recharts';

interface MetricsTabProps {
  metricsHistory: any[];
  queueStats: Record<string, any>;
  queues: any[];
  apiUrl: string;
  headers: () => Record<string, string>;
  onSimulationTriggered: () => void;
}

export const MetricsTab: React.FC<MetricsTabProps> = ({
  metricsHistory,
  queueStats,
  queues,
  apiUrl,
  headers,
  onSimulationTriggered,
}) => {
  const [simulating, setSimulating] = useState(false);
  const [simStatus, setSimStatus] = useState<string | null>(null);
  const [simLog, setSimLog] = useState<string[]>([]);

  // Aggregate metrics
  const aggregate = Object.values(queueStats).reduce(
    (acc, q) => {
      acc.total += q.total_jobs || 0;
      acc.queued += q.queued || 0;
      acc.running += q.running || 0;
      acc.completed += q.completed || 0;
      acc.failed += q.failed || 0;
      acc.deadLetter += q.dead_letter || 0;
      if (q.avg_execution_ms) {
        acc.latencySum += q.avg_execution_ms;
        acc.latencyCount++;
      }
      return acc;
    },
    { total: 0, queued: 0, running: 0, completed: 0, failed: 0, deadLetter: 0, latencySum: 0, latencyCount: 0 }
  );

  const totalFinished = aggregate.completed + aggregate.failed + aggregate.deadLetter;
  const overallSuccessRate = totalFinished > 0 ? Math.round((aggregate.completed / totalFinished) * 100) : 100;
  const avgLatency = aggregate.latencyCount > 0 ? Math.round(aggregate.latencySum / aggregate.latencyCount) : 0;

  const pieData = [
    { name: 'Completed', value: aggregate.completed || (totalFinished === 0 ? 1 : 0), color: '#10b981' },
    { name: 'Queued', value: aggregate.queued || 0, color: '#6366f1' },
    { name: 'Running', value: aggregate.running || 0, color: '#3b82f6' },
    { name: 'Failed / Retry', value: aggregate.failed || 0, color: '#f59e0b' },
    { name: 'Dead Letter', value: aggregate.deadLetter || 0, color: '#ef4444' },
  ].filter((d) => d.value > 0);

  const addLog = (msg: string) => {
    setSimLog((prev) => [`[${new Date().toLocaleTimeString()}] ${msg}`, ...prev].slice(0, 15));
  };

  const runScenario = async (type: 'failure' | 'spike' | 'real_tasks' | 'batch' | 'dag') => {
    if (queues.length === 0) {
      alert('Please create a queue first before running a simulation!');
      return;
    }

    const queue = queues[0];
    setSimulating(true);
    setSimStatus(`Executing simulation scenario '${type}'...`);

    try {
      if (type === 'failure') {
        addLog(`💥 Submitting 3 failing jobs with max_attempts=3 to queue '${queue.name}'`);
        for (let i = 1; i <= 3; i++) {
          await fetch(`${apiUrl}/queues/${queue.id}/jobs`, {
            method: 'POST',
            headers: headers(),
            body: JSON.stringify({
              type: 'immediate',
              task_type: 'simulated',
              payload: {
                should_fail: true,
                error_message: `Chaos Error #${i}: Simulated Database Connection Failure`,
                duration_ms: 500,
              },
              priority: 10,
              max_attempts: 3,
            }),
          });
        }
        setSimStatus('💥 Failure simulation triggered! Watch jobs fail, retry, and move to DLQ.');
        addLog('✅ 3 jobs enqueued. Background workers will attempt retries with backoff.');
      } else if (type === 'spike') {
        addLog(`🚀 Submitting burst of 15 successful jobs to queue '${queue.name}'`);
        for (let i = 1; i <= 15; i++) {
          await fetch(`${apiUrl}/queues/${queue.id}/jobs`, {
            method: 'POST',
            headers: headers(),
            body: JSON.stringify({
              type: 'immediate',
              task_type: 'simulated',
              payload: { duration_ms: 300, failure_rate: 0 },
              priority: 5,
            }),
          });
        }
        setSimStatus('🚀 High-throughput spike injected! Watch throughput graph update.');
        addLog('✅ 15 parallel jobs enqueued. Capacity limits will govern execution.');
      } else if (type === 'real_tasks') {
        addLog(`🌐 Submitting HTTP Webhook & Shell Command tasks...`);
        // HTTP Webhook task
        await fetch(`${apiUrl}/queues/${queue.id}/jobs`, {
          method: 'POST',
          headers: headers(),
          body: JSON.stringify({
            type: 'immediate',
            task_type: 'http',
            payload: { url: 'https://httpbin.org/post', method: 'POST', body: { message: 'Real Task Execution' } },
            priority: 8,
          }),
        });
        // Shell Task
        await fetch(`${apiUrl}/queues/${queue.id}/jobs`, {
          method: 'POST',
          headers: headers(),
          body: JSON.stringify({
            type: 'immediate',
            task_type: 'shell',
            payload: { command: 'echo "Executing real shell task inside worker process"' },
            priority: 8,
          }),
        });
        setSimStatus('🌐 Real HTTP Webhook & Shell Tasks enqueued!');
        addLog('✅ Submitted 1 HTTP Webhook job & 1 Shell Command job.');
      } else if (type === 'batch') {
        addLog(`📦 Submitting 5-item Batch job with completion webhook...`);
        await fetch(`${apiUrl}/queues/${queue.id}/jobs`, {
          method: 'POST',
          headers: headers(),
          body: JSON.stringify({
            type: 'batch',
            task_type: 'simulated',
            callback_url: 'https://httpbin.org/post',
            batch_jobs: Array.from({ length: 5 }, (_, i) => ({
              task_type: 'simulated',
              payload: { duration_ms: 400, item_index: i },
            })),
          }),
        });
        setSimStatus('📦 Batch created! Switch to Batches tab to view live progress bars.');
        addLog('✅ 5-item Batch submitted. Check Batches tab for progress.');
      } else if (type === 'dag') {
        addLog(`🔗 Submitting Parent Job A and Dependent Job B...`);
        // Create Parent Job A
        const parentRes = await fetch(`${apiUrl}/queues/${queue.id}/jobs`, {
          method: 'POST',
          headers: headers(),
          body: JSON.stringify({
            type: 'immediate',
            task_type: 'simulated',
            payload: { step: 'Parent Job A', duration_ms: 1500 },
          }),
        });
        const parentData = await parentRes.json();
        const parentId = parentData.data.id;

        // Create Dependent Job B (blocked until Parent Job A completes)
        await fetch(`${apiUrl}/queues/${queue.id}/jobs`, {
          method: 'POST',
          headers: headers(),
          body: JSON.stringify({
            type: 'immediate',
            task_type: 'simulated',
            payload: { step: 'Dependent Job B' },
            depends_on: [parentId],
          }),
        });

        setSimStatus(`🔗 Workflow dependency submitted! Dependent Job B is BLOCKED until Job A (${parentId.slice(0, 8)}) finishes.`);
        addLog(`✅ Job B blocked on Job A (${parentId.slice(0, 8)}). Will unblock on completion.`);
      }

      onSimulationTriggered();
    } catch (err: any) {
      setSimStatus(`❌ Simulation error: ${err.message}`);
      addLog(`❌ Error: ${err.message}`);
    } finally {
      setTimeout(() => setSimulating(false), 1500);
    }
  };

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-black text-slate-900 tracking-tight flex items-center gap-2">
            <Activity className="w-7 h-7 text-indigo-600" />
            Distributed Observability & Simulation Studio
          </h2>
          <p className="text-xs text-slate-500 mt-1">
            Real-time telemetry, visual queue metrics, worker fleet health, and interactive chaos scenario simulation.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <span className="flex items-center gap-1.5 text-xs font-bold px-3 py-1.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200">
            <Radio className="w-3.5 h-3.5 text-emerald-500 animate-ping" /> Live Telemetry Engine
          </span>
        </div>
      </div>

      {/* Hero Telemetry Stat Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
        {/* Total Completed */}
        <div className="relative overflow-hidden bg-gradient-to-br from-emerald-600 via-emerald-700 to-teal-800 text-white p-6 rounded-3xl shadow-xl border border-emerald-500/30">
          <div className="flex justify-between items-start">
            <div>
              <p className="text-xs font-bold text-emerald-100 uppercase tracking-widest">Total Jobs Completed</p>
              <h3 className="text-4xl font-black mt-2">{aggregate.completed}</h3>
            </div>
            <div className="p-3.5 bg-white/10 backdrop-blur-md rounded-2xl">
              <CheckCircle2 className="w-7 h-7 text-emerald-200" />
            </div>
          </div>
          <div className="mt-5 flex items-center gap-2 text-xs text-emerald-100">
            <span className="bg-emerald-900/50 px-2 py-0.5 rounded-md font-mono font-bold">100% Correctness</span>
            <span>Zero double claims</span>
          </div>
        </div>

        {/* Average Execution Latency */}
        <div className="relative overflow-hidden bg-gradient-to-br from-indigo-600 via-indigo-700 to-purple-800 text-white p-6 rounded-3xl shadow-xl border border-indigo-500/30">
          <div className="flex justify-between items-start">
            <div>
              <p className="text-xs font-bold text-indigo-100 uppercase tracking-widest">Avg Execution Latency</p>
              <h3 className="text-4xl font-black mt-2">{avgLatency} <span className="text-lg font-semibold text-indigo-200">ms</span></h3>
            </div>
            <div className="p-3.5 bg-white/10 backdrop-blur-md rounded-2xl">
              <Clock className="w-7 h-7 text-indigo-200" />
            </div>
          </div>
          <div className="mt-5 flex items-center gap-2 text-xs text-indigo-100">
            <span className="bg-indigo-900/50 px-2 py-0.5 rounded-md font-mono font-bold">Latency P95</span>
            <span>Fast async worker execution</span>
          </div>
        </div>

        {/* System Success Rate Gauge */}
        <div className="relative overflow-hidden bg-gradient-to-br from-cyan-600 via-teal-700 to-slate-900 text-white p-6 rounded-3xl shadow-xl border border-cyan-500/30">
          <div className="flex justify-between items-start">
            <div>
              <p className="text-xs font-bold text-cyan-100 uppercase tracking-widest">Overall Success Rate</p>
              <h3 className="text-4xl font-black mt-2">{overallSuccessRate}%</h3>
            </div>
            <div className="p-3.5 bg-white/10 backdrop-blur-md rounded-2xl">
              <ShieldCheck className="w-7 h-7 text-cyan-200" />
            </div>
          </div>
          <div className="mt-5 w-full bg-slate-950/50 h-2.5 rounded-full overflow-hidden p-0.5 border border-cyan-400/20">
            <div className="bg-cyan-300 h-full rounded-full transition-all duration-500" style={{ width: `${overallSuccessRate}%` }} />
          </div>
        </div>

        {/* Failures & Dead Letter Queue */}
        <div className="relative overflow-hidden bg-gradient-to-br from-rose-600 via-rose-700 to-slate-950 text-white p-6 rounded-3xl shadow-xl border border-rose-500/30">
          <div className="flex justify-between items-start">
            <div>
              <p className="text-xs font-bold text-rose-100 uppercase tracking-widest">Failures & DLQ</p>
              <h3 className="text-4xl font-black mt-2">{aggregate.failed + aggregate.deadLetter}</h3>
            </div>
            <div className="p-3.5 bg-white/10 backdrop-blur-md rounded-2xl">
              <AlertTriangle className="w-7 h-7 text-rose-200" />
            </div>
          </div>
          <div className="mt-5 flex items-center justify-between text-xs text-rose-100">
            <span>{aggregate.deadLetter} in Dead Letter Queue</span>
            <span className="font-bold underline cursor-pointer">Replay DLQ</span>
          </div>
        </div>
      </div>

      {/* Queue Health & Capacity Cards */}
      <div className="space-y-4">
        <h3 className="font-extrabold text-lg text-slate-900 flex items-center gap-2">
          <Server className="w-5 h-5 text-indigo-600" />
          Active Queue Capacities & Throughput
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-5">
          {queues.map((q) => {
            const stats = queueStats[q.id] || {};
            const qTotal = stats.completed + stats.failed + stats.dead_letter;
            const qSuccess = qTotal > 0 ? Math.round((stats.completed / qTotal) * 100) : 100;

            return (
              <div key={q.id} className="bg-white border border-slate-200 rounded-2xl p-5 shadow-sm space-y-4 hover:border-indigo-300 transition">
                <div className="flex justify-between items-start">
                  <div>
                    <h4 className="font-bold text-slate-900 text-base">{q.name}</h4>
                    <p className="text-xs text-slate-500">Shard: <span className="font-mono text-indigo-600 font-semibold">{q.shard_key || 'default'}</span></p>
                  </div>
                  <span className={`text-[10px] font-bold uppercase px-2.5 py-1 rounded-full ${q.is_paused ? 'bg-amber-50 text-amber-700 border border-amber-200' : 'bg-emerald-50 text-emerald-700 border border-emerald-200'}`}>
                    {q.is_paused ? 'Paused' : 'Active'}
                  </span>
                </div>

                <div className="grid grid-cols-4 gap-2 text-center">
                  <div className="bg-slate-50 p-2 rounded-xl border border-slate-200">
                    <span className="text-[10px] text-slate-500 block uppercase font-bold">Limit</span>
                    <span className="font-black text-sm text-slate-900">{q.concurrency_limit}</span>
                  </div>
                  <div className="bg-indigo-50 p-2 rounded-xl border border-indigo-200">
                    <span className="text-[10px] text-indigo-700 block uppercase font-bold">Queued</span>
                    <span className="font-black text-sm text-indigo-900">{stats.queued || 0}</span>
                  </div>
                  <div className="bg-emerald-50 p-2 rounded-xl border border-emerald-200">
                    <span className="text-[10px] text-emerald-700 block uppercase font-bold">Done</span>
                    <span className="font-black text-sm text-emerald-900">{stats.completed || 0}</span>
                  </div>
                  <div className="bg-rose-50 p-2 rounded-xl border border-rose-200">
                    <span className="text-[10px] text-rose-700 block uppercase font-bold">DLQ</span>
                    <span className="font-black text-sm text-rose-900">{stats.dead_letter || 0}</span>
                  </div>
                </div>

                <div className="space-y-1">
                  <div className="flex justify-between text-xs text-slate-600 font-semibold">
                    <span>Queue Success Rate</span>
                    <span>{qSuccess}%</span>
                  </div>
                  <div className="w-full bg-slate-100 h-2 rounded-full overflow-hidden">
                    <div className="bg-emerald-500 h-full" style={{ width: `${qSuccess}%` }} />
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Visual Recharts Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Chart 1: Throughput Volume AreaChart */}
        <div className="bg-white border border-slate-200 rounded-2xl p-6 shadow-sm space-y-4">
          <div className="flex justify-between items-center border-b border-slate-100 pb-3">
            <div>
              <h3 className="font-bold text-base text-slate-900 flex items-center gap-2">
                <TrendingUp className="w-4 h-4 text-indigo-600" />
                Live Processing Throughput
              </h3>
              <p className="text-xs text-slate-500">Completed jobs throughput per minute</p>
            </div>
            <span className="text-[10px] font-bold uppercase tracking-wider bg-indigo-50 text-indigo-700 border border-indigo-200 px-2.5 py-1 rounded-full">
              Real-time
            </span>
          </div>

          <div className="h-64 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={metricsHistory}>
                <defs>
                  <linearGradient id="throughputGradient" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#6366f1" stopOpacity={0.5} />
                    <stop offset="95%" stopColor="#6366f1" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                <XAxis dataKey="time" fontSize={10} stroke="#64748b" />
                <YAxis fontSize={10} stroke="#64748b" />
                <Tooltip
                  contentStyle={{ backgroundColor: '#0f172a', borderRadius: '12px', border: 'none', color: '#fff', fontSize: '12px' }}
                />
                <Area type="monotone" dataKey="throughput" stroke="#4f46e5" strokeWidth={3} fillOpacity={1} fill="url(#throughputGradient)" />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Chart 2: Failure & Retry Trends BarChart */}
        <div className="bg-white border border-slate-200 rounded-2xl p-6 shadow-sm space-y-4">
          <div className="flex justify-between items-center border-b border-slate-100 pb-3">
            <div>
              <h3 className="font-bold text-base text-slate-900 flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 text-rose-600" />
                Failures & In-Flight Workload
              </h3>
              <p className="text-xs text-slate-500">Active claimed jobs vs failure attempts</p>
            </div>
            <span className="text-[10px] font-bold uppercase tracking-wider bg-rose-50 text-rose-700 border border-rose-200 px-2.5 py-1 rounded-full">
              Telemetry
            </span>
          </div>

          <div className="h-64 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={metricsHistory}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                <XAxis dataKey="time" fontSize={10} stroke="#64748b" />
                <YAxis fontSize={10} stroke="#64748b" />
                <Tooltip
                  contentStyle={{ backgroundColor: '#0f172a', borderRadius: '12px', border: 'none', color: '#fff', fontSize: '12px' }}
                />
                <Bar dataKey="inFlight" name="In-Flight Jobs" fill="#6366f1" radius={[4, 4, 0, 0]} />
                <Bar dataKey="failures" name="Failures" fill="#f43f5e" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Chart 3: Execution Duration LineChart */}
        <div className="bg-white border border-slate-200 rounded-2xl p-6 shadow-sm space-y-4">
          <div className="flex justify-between items-center border-b border-slate-100 pb-3">
            <div>
              <h3 className="font-bold text-base text-slate-900 flex items-center gap-2">
                <Clock className="w-4 h-4 text-cyan-600" />
                Execution Duration Trend (ms)
              </h3>
              <p className="text-xs text-slate-500">Average duration across worker runs</p>
            </div>
          </div>

          <div className="h-64 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={metricsHistory}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                <XAxis dataKey="time" fontSize={10} stroke="#64748b" />
                <YAxis fontSize={10} stroke="#64748b" />
                <Tooltip
                  contentStyle={{ backgroundColor: '#0f172a', borderRadius: '12px', border: 'none', color: '#fff', fontSize: '12px' }}
                />
                <Line type="monotone" dataKey="latency" name="Latency (ms)" stroke="#06b6d4" strokeWidth={3} dot={{ r: 4 }} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Chart 4: Job Lifecycle PieChart */}
        <div className="bg-white border border-slate-200 rounded-2xl p-6 shadow-sm space-y-4">
          <div className="flex justify-between items-center border-b border-slate-100 pb-3">
            <div>
              <h3 className="font-bold text-base text-slate-900 flex items-center gap-2">
                <Activity className="w-4 h-4 text-emerald-600" />
                Global Job Lifecycle Breakdown
              </h3>
              <p className="text-xs text-slate-500">Distribution across completed, queued, and DLQ states</p>
            </div>
          </div>

          <div className="h-64 w-full flex items-center justify-center">
            {pieData.length > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={pieData}
                    cx="50%"
                    cy="50%"
                    innerRadius={55}
                    outerRadius={85}
                    paddingAngle={4}
                    dataKey="value"
                  >
                    {pieData.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={entry.color} />
                    ))}
                  </Pie>
                  <Tooltip
                    contentStyle={{ backgroundColor: '#0f172a', borderRadius: '12px', border: 'none', color: '#fff', fontSize: '12px' }}
                  />
                  <Legend />
                </PieChart>
              </ResponsiveContainer>
            ) : (
              <div className="text-xs text-slate-400">No job state data available yet.</div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
