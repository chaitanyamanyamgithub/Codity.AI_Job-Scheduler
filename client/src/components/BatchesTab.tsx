import React, { useEffect, useState } from 'react';
import { RefreshCw, XCircle, CheckCircle2, AlertTriangle, Clock } from 'lucide-react';

interface BatchesTabProps {
  apiUrl: string;
  headers: () => Record<string, string>;
  refreshTrigger: number;
}

export const BatchesTab: React.FC<BatchesTabProps> = ({ apiUrl, headers, refreshTrigger }) => {
  const [batches, setBatches] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedBatch, setSelectedBatch] = useState<any | null>(null);
  const [batchJobs, setBatchJobs] = useState<any[]>([]);

  const fetchBatches = async () => {
    setLoading(true);
    try {
      const res = await fetch(`${apiUrl}/batches`, { headers: headers() });
      const data = await res.json();
      if (data.data) setBatches(data.data);
    } catch (err) {
      console.error('Failed to fetch batches', err);
    } finally {
      setLoading(false);
    }
  };

  const fetchBatchJobs = async (batchId: string) => {
    try {
      const res = await fetch(`${apiUrl}/batches/${batchId}/jobs`, { headers: headers() });
      const data = await res.json();
      if (data.data) setBatchJobs(data.data);
    } catch (err) {
      console.error('Failed to fetch batch jobs', err);
    }
  };

  const cancelBatch = async (batchId: string) => {
    if (!confirm('Are you sure you want to cancel this batch?')) return;
    try {
      await fetch(`${apiUrl}/batches/${batchId}/cancel`, { method: 'POST', headers: headers() });
      fetchBatches();
      if (selectedBatch?.id === batchId) {
        setSelectedBatch((prev: any) => prev ? { ...prev, status: 'cancelled' } : null);
      }
    } catch (err) {
      console.error('Failed to cancel batch', err);
    }
  };

  useEffect(() => {
    fetchBatches();
  }, [refreshTrigger]);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold text-slate-900">Batch Processing</h2>
          <p className="text-xs text-slate-500">Monitor batch job progress, completion rates, and Webhook callbacks.</p>
        </div>
        <button
          onClick={fetchBatches}
          className="p-2 text-slate-500 hover:text-slate-900 bg-white border border-slate-200 rounded-lg shadow-sm"
        >
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
        </button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-4">
          {batches.length === 0 ? (
            <div className="bg-white border border-slate-200 rounded-xl p-8 text-center text-slate-500">
              No batches created yet. Submit a Batch job from the Queues tab!
            </div>
          ) : (
            batches.map((batch) => {
              const percent = batch.total_jobs > 0
                ? Math.round(((batch.completed_jobs + batch.failed_jobs) / batch.total_jobs) * 100)
                : 0;

              return (
                <div
                  key={batch.id}
                  onClick={() => { setSelectedBatch(batch); fetchBatchJobs(batch.id); }}
                  className={`bg-white border rounded-xl p-5 shadow-sm cursor-pointer transition ${
                    selectedBatch?.id === batch.id ? 'border-indigo-500 ring-1 ring-indigo-500' : 'border-slate-200 hover:border-slate-300'
                  }`}
                >
                  <div className="flex items-start justify-between mb-3">
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-sm font-bold text-slate-900">{batch.id.slice(0, 8)}...</span>
                        <span className="text-xs px-2 py-0.5 rounded-full bg-slate-100 font-medium text-slate-700">{batch.queue_name}</span>
                        <StatusBadge status={batch.status} />
                      </div>
                      {batch.callback_url && (
                        <p className="text-xs text-slate-500 mt-1 truncate max-w-md">
                          Webhook: <span className="font-mono text-slate-600">{batch.callback_url}</span>
                        </p>
                      )}
                    </div>
                    {batch.status === 'processing' && (
                      <button
                        onClick={(e) => { e.stopPropagation(); cancelBatch(batch.id); }}
                        className="text-xs text-rose-600 hover:text-rose-700 font-semibold border border-rose-200 px-2.5 py-1 rounded-lg bg-rose-50"
                      >
                        Cancel
                      </button>
                    )}
                  </div>

                  <div className="space-y-1.5">
                    <div className="flex justify-between text-xs font-semibold text-slate-600">
                      <span>Progress: {batch.completed_jobs + batch.failed_jobs} / {batch.total_jobs} jobs ({percent}%)</span>
                      <span>
                        <span className="text-emerald-600 mr-2">{batch.completed_jobs} done</span>
                        {batch.failed_jobs > 0 && <span className="text-rose-600">{batch.failed_jobs} failed</span>}
                      </span>
                    </div>
                    <div className="w-full bg-slate-100 h-2.5 rounded-full overflow-hidden flex">
                      <div
                        className="bg-emerald-500 h-full transition-all duration-300"
                        style={{ width: `${(batch.completed_jobs / (batch.total_jobs || 1)) * 100}%` }}
                      />
                      <div
                        className="bg-rose-500 h-full transition-all duration-300"
                        style={{ width: `${(batch.failed_jobs / (batch.total_jobs || 1)) * 100}%` }}
                      />
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>

        <div className="bg-white border border-slate-200 rounded-xl p-5 h-fit">
          {selectedBatch ? (
            <div className="space-y-4">
              <div className="border-b border-slate-100 pb-3">
                <h3 className="font-bold text-sm text-slate-900">Batch Details</h3>
                <p className="font-mono text-xs text-indigo-600 mt-0.5">{selectedBatch.id}</p>
              </div>

              <div className="grid grid-cols-2 gap-3 text-xs">
                <div className="bg-slate-50 p-2.5 rounded-lg border border-slate-200">
                  <span className="text-slate-500 block">Total Jobs</span>
                  <span className="font-bold text-sm text-slate-900">{selectedBatch.total_jobs}</span>
                </div>
                <div className="bg-slate-50 p-2.5 rounded-lg border border-slate-200">
                  <span className="text-slate-500 block">Completed</span>
                  <span className="font-bold text-sm text-emerald-600">{selectedBatch.completed_jobs}</span>
                </div>
                <div className="bg-slate-50 p-2.5 rounded-lg border border-slate-200">
                  <span className="text-slate-500 block">Failed</span>
                  <span className="font-bold text-sm text-rose-600">{selectedBatch.failed_jobs}</span>
                </div>
                <div className="bg-slate-50 p-2.5 rounded-lg border border-slate-200">
                  <span className="text-slate-500 block">Status</span>
                  <span className="font-bold text-xs uppercase text-slate-900">{selectedBatch.status}</span>
                </div>
              </div>

              <div>
                <h4 className="font-bold text-xs text-slate-700 uppercase mb-2">Batch Items</h4>
                <div className="space-y-2 max-h-96 overflow-y-auto">
                  {batchJobs.map((job) => (
                    <div key={job.id} className="text-xs bg-slate-50 border border-slate-200 p-2.5 rounded-lg flex justify-between items-center">
                      <div>
                        <span className="font-mono font-semibold">{job.id.slice(0, 8)}</span>
                        <span className="ml-2 text-slate-500">[{job.task_type || 'simulated'}]</span>
                      </div>
                      <StatusBadge status={job.status} />
                    </div>
                  ))}
                </div>
              </div>
            </div>
          ) : (
            <div className="text-sm text-slate-500 text-center py-10">Select a batch to view individual job details.</div>
          )}
        </div>
      </div>
    </div>
  );
};

const StatusBadge: React.FC<{ status: string }> = ({ status }) => {
  switch (status) {
    case 'completed':
      return <span className="text-[10px] font-bold uppercase px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200">Completed</span>;
    case 'failed':
      return <span className="text-[10px] font-bold uppercase px-2 py-0.5 rounded-full bg-rose-50 text-rose-700 border border-rose-200">Failed</span>;
    case 'cancelled':
      return <span className="text-[10px] font-bold uppercase px-2 py-0.5 rounded-full bg-amber-50 text-amber-700 border border-amber-200">Cancelled</span>;
    case 'processing':
    case 'running':
    case 'queued':
    default:
      return <span className="text-[10px] font-bold uppercase px-2 py-0.5 rounded-full bg-indigo-50 text-indigo-700 border border-indigo-200">{status}</span>;
  }
};
