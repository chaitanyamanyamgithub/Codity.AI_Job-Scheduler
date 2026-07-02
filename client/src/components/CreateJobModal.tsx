import React, { useState } from 'react';
import { X, Globe, Terminal, Cpu } from 'lucide-react';

interface CreateJobModalProps {
  queue: any;
  onClose: () => void;
  onSubmit: (jobData: any) => Promise<void>;
  formatApiError: (data: any, fallback: string) => string;
}

export const CreateJobModal: React.FC<CreateJobModalProps> = ({
  queue,
  onClose,
  onSubmit,
  formatApiError,
}) => {
  const [jobType, setJobType] = useState<'immediate' | 'delayed' | 'scheduled' | 'recurring' | 'batch'>('immediate');
  const [taskType, setTaskType] = useState<'simulated' | 'http' | 'shell'>('simulated');

  // Simulated fields
  const [durationMs, setDurationMs] = useState(1200);
  const [failureRate, setFailureRate] = useState(0);

  // HTTP fields
  const [httpUrl, setHttpUrl] = useState('https://httpbin.org/post');
  const [httpMethod, setHttpMethod] = useState<'GET' | 'POST' | 'PUT' | 'DELETE'>('POST');
  const [httpHeaders, setHttpHeaders] = useState('{\n  "Content-Type": "application/json"\n}');
  const [httpBody, setHttpBody] = useState('{\n  "message": "Hello from JobCodity Scheduler"\n}');

  // Shell fields
  const [shellCommand, setShellCommand] = useState('echo "Worker executing command at $(date)"');

  // General fields
  const [priority, setPriority] = useState(0);
  const [maxAttempts, setMaxAttempts] = useState(3);
  const [idempotencyKey, setIdempotencyKey] = useState('');
  const [dependsOn, setDependsOn] = useState('');
  const [callbackUrl, setCallbackUrl] = useState('');
  const [delayMs, setDelayMs] = useState(5000);
  const [runAt, setRunAt] = useState(new Date(Date.now() + 60000).toISOString().slice(0, 16));
  const [cron, setCron] = useState('*/5 * * * *');
  const [batchCount, setBatchCount] = useState(3);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');

    try {
      let payload: Record<string, unknown> = {};

      if (taskType === 'simulated') {
        payload = { duration_ms: Number(durationMs), failure_rate: Number(failureRate) };
      } else if (taskType === 'http') {
        let headersObj = {};
        let bodyObj = null;
        try {
          if (httpHeaders) headersObj = JSON.parse(httpHeaders);
        } catch {
          throw new Error('HTTP Headers must be valid JSON');
        }
        try {
          if (httpBody && httpMethod !== 'GET') bodyObj = JSON.parse(httpBody);
        } catch {
          throw new Error('HTTP Body must be valid JSON');
        }
        payload = {
          url: httpUrl,
          method: httpMethod,
          headers: headersObj,
          body: bodyObj,
        };
      } else if (taskType === 'shell') {
        payload = { command: shellCommand };
      }

      const body: any = {
        type: jobType,
        task_type: taskType,
        payload,
        priority: Number(priority),
        max_attempts: Number(maxAttempts),
        idempotency_key: idempotencyKey || undefined,
        depends_on: dependsOn.split(',').map((s) => s.trim()).filter(Boolean),
        callback_url: callbackUrl || undefined,
      };

      if (jobType === 'delayed') body.delay_ms = Number(delayMs);
      if (jobType === 'scheduled') body.run_at = new Date(runAt).toISOString();
      if (jobType === 'recurring') body.cron_expression = cron;
      if (jobType === 'batch') {
        body.batch_jobs = Array.from({ length: Number(batchCount) }, (_, i) => ({
          task_type: taskType,
          payload: { ...payload, item_index: i },
          priority: Number(priority),
          max_attempts: Number(maxAttempts),
        }));
      }

      await onSubmit(body);
      onClose();
    } catch (err: any) {
      setError(err.message || 'Failed to create job');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-slate-950/40 backdrop-blur-sm flex items-center justify-center p-4 z-50">
      <div className="bg-white border border-slate-200 rounded-2xl max-w-2xl w-full p-6 shadow-2xl overflow-y-auto max-h-[90vh]">
        <div className="flex justify-between items-center pb-4 border-b border-slate-100">
          <div>
            <h3 className="font-bold text-lg text-slate-900">Submit Job to Queue: {queue.name}</h3>
            <p className="text-xs text-slate-500">Configure job scheduling & task execution payload.</p>
          </div>
          <button onClick={onClose} className="p-1 text-slate-400 hover:text-slate-600 rounded-lg">
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-5 mt-4">
          {error && (
            <div className="bg-rose-50 border border-rose-200 text-rose-700 text-xs rounded-xl p-3">
              {error}
            </div>
          )}

          <div>
            <label className="block text-xs font-bold uppercase text-slate-500 mb-1.5">Job Scheduling Type</label>
            <div className="grid grid-cols-5 gap-2">
              {(['immediate', 'delayed', 'scheduled', 'recurring', 'batch'] as const).map((type) => (
                <button
                  type="button"
                  key={type}
                  onClick={() => setJobType(type)}
                  className={`py-2 text-xs font-semibold rounded-lg capitalize border transition ${
                    jobType === type
                      ? 'bg-indigo-600 text-white border-indigo-600 shadow-sm'
                      : 'bg-slate-50 text-slate-700 border-slate-200 hover:bg-slate-100'
                  }`}
                >
                  {type}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="block text-xs font-bold uppercase text-slate-500 mb-1.5">Execution Task Handler</label>
            <div className="grid grid-cols-3 gap-3">
              <button
                type="button"
                onClick={() => setTaskType('simulated')}
                className={`p-3 rounded-xl border flex items-center gap-3 text-left transition ${
                  taskType === 'simulated' ? 'border-indigo-600 bg-indigo-50/50 ring-1 ring-indigo-600' : 'border-slate-200 hover:border-slate-300'
                }`}
              >
                <Cpu className="w-5 h-5 text-indigo-600" />
                <div>
                  <div className="text-xs font-bold text-slate-900">Simulated</div>
                  <div className="text-[10px] text-slate-500">Timer & failure testing</div>
                </div>
              </button>

              <button
                type="button"
                onClick={() => setTaskType('http')}
                className={`p-3 rounded-xl border flex items-center gap-3 text-left transition ${
                  taskType === 'http' ? 'border-indigo-600 bg-indigo-50/50 ring-1 ring-indigo-600' : 'border-slate-200 hover:border-slate-300'
                }`}
              >
                <Globe className="w-5 h-5 text-indigo-600" />
                <div>
                  <div className="text-xs font-bold text-slate-900">HTTP Webhook</div>
                  <div className="text-[10px] text-slate-500">Fetch REST API URL</div>
                </div>
              </button>

              <button
                type="button"
                onClick={() => setTaskType('shell')}
                className={`p-3 rounded-xl border flex items-center gap-3 text-left transition ${
                  taskType === 'shell' ? 'border-indigo-600 bg-indigo-50/50 ring-1 ring-indigo-600' : 'border-slate-200 hover:border-slate-300'
                }`}
              >
                <Terminal className="w-5 h-5 text-indigo-600" />
                <div>
                  <div className="text-xs font-bold text-slate-900">Shell Command</div>
                  <div className="text-[10px] text-slate-500">Execute CLI script</div>
                </div>
              </button>
            </div>
          </div>

          {/* Dynamic Task Config */}
          <div className="bg-slate-50 border border-slate-200 rounded-xl p-4 space-y-3">
            <h4 className="text-xs font-bold uppercase text-slate-700">Task Payload Configuration</h4>

            {taskType === 'simulated' && (
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">Duration (ms)</label>
                  <input
                    type="number"
                    value={durationMs}
                    onChange={(e) => setDurationMs(Number(e.target.value))}
                    className="w-full bg-white border border-slate-200 rounded-lg px-3 py-1.5 text-xs font-mono"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">Failure Rate (0 to 1)</label>
                  <input
                    type="number"
                    step="0.1"
                    min="0"
                    max="1"
                    value={failureRate}
                    onChange={(e) => setFailureRate(Number(e.target.value))}
                    className="w-full bg-white border border-slate-200 rounded-lg px-3 py-1.5 text-xs font-mono"
                  />
                </div>
              </div>
            )}

            {taskType === 'http' && (
              <div className="space-y-3">
                <div className="grid grid-cols-4 gap-2">
                  <select
                    value={httpMethod}
                    onChange={(e: any) => setHttpMethod(e.target.value)}
                    className="bg-white border border-slate-200 rounded-lg px-2.5 py-1.5 text-xs font-bold"
                  >
                    <option value="GET">GET</option>
                    <option value="POST">POST</option>
                    <option value="PUT">PUT</option>
                    <option value="DELETE">DELETE</option>
                  </select>
                  <input
                    type="url"
                    value={httpUrl}
                    onChange={(e) => setHttpUrl(e.target.value)}
                    placeholder="https://api.example.com/webhook"
                    className="col-span-3 bg-white border border-slate-200 rounded-lg px-3 py-1.5 text-xs font-mono"
                    required
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">Headers (JSON)</label>
                  <textarea
                    rows={2}
                    value={httpHeaders}
                    onChange={(e) => setHttpHeaders(e.target.value)}
                    className="w-full bg-white border border-slate-200 rounded-lg p-2 text-xs font-mono"
                  />
                </div>
                {httpMethod !== 'GET' && (
                  <div>
                    <label className="block text-xs font-medium text-slate-600 mb-1">Body (JSON)</label>
                    <textarea
                      rows={3}
                      value={httpBody}
                      onChange={(e) => setHttpBody(e.target.value)}
                      className="w-full bg-white border border-slate-200 rounded-lg p-2 text-xs font-mono"
                    />
                  </div>
                )}
              </div>
            )}

            {taskType === 'shell' && (
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Command String</label>
                <input
                  type="text"
                  value={shellCommand}
                  onChange={(e) => setShellCommand(e.target.value)}
                  className="w-full bg-white border border-slate-200 rounded-lg px-3 py-2 text-xs font-mono"
                  required
                />
              </div>
            )}
          </div>

          {/* Conditional Job Settings */}
          {jobType === 'delayed' && (
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Delay (ms)</label>
              <input
                type="number"
                value={delayMs}
                onChange={(e) => setDelayMs(Number(e.target.value))}
                className="w-full bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-xs font-mono"
              />
            </div>
          )}

          {jobType === 'scheduled' && (
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Run At Timestamp</label>
              <input
                type="datetime-local"
                value={runAt}
                onChange={(e) => setRunAt(e.target.value)}
                className="w-full bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-xs font-mono"
              />
            </div>
          )}

          {jobType === 'recurring' && (
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Cron Expression</label>
              <input
                type="text"
                value={cron}
                onChange={(e) => setCron(e.target.value)}
                className="w-full bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-xs font-mono"
              />
            </div>
          )}

          {jobType === 'batch' && (
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Batch Items Count</label>
                <input
                  type="number"
                  min="1"
                  max="100"
                  value={batchCount}
                  onChange={(e) => setBatchCount(Number(e.target.value))}
                  className="w-full bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-xs font-mono"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Batch Callback Webhook URL</label>
                <input
                  type="url"
                  placeholder="https://webhook.site/..."
                  value={callbackUrl}
                  onChange={(e) => setCallbackUrl(e.target.value)}
                  className="w-full bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-xs font-mono"
                />
              </div>
            </div>
          )}

          {/* Priority, Max Attempts, Idempotency */}
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Priority</label>
              <input
                type="number"
                min="0"
                max="100"
                value={priority}
                onChange={(e) => setPriority(Number(e.target.value))}
                className="w-full bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-xs"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Max Attempts</label>
              <input
                type="number"
                min="1"
                max="20"
                value={maxAttempts}
                onChange={(e) => setMaxAttempts(Number(e.target.value))}
                className="w-full bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-xs"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Idempotency Key</label>
              <input
                type="text"
                placeholder="optional key"
                value={idempotencyKey}
                onChange={(e) => setIdempotencyKey(e.target.value)}
                className="w-full bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-xs font-mono"
              />
            </div>
          </div>

          <div className="flex justify-end gap-3 pt-3 border-t border-slate-100">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-xs font-semibold text-slate-600 hover:text-slate-800"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={loading}
              className="bg-indigo-600 hover:bg-indigo-700 text-white font-semibold text-xs px-5 py-2 rounded-lg shadow-sm disabled:opacity-50"
            >
              {loading ? 'Submitting...' : 'Submit Job'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
