export function generateFailureSummary(errorMessage: string, context: Record<string, unknown> = {}): string {
  const normalized = errorMessage.toLowerCase();
  const jobType = context.jobType ? ` ${context.jobType}` : '';
  const attempts = context.attempts ? ` after ${context.attempts} attempts` : '';

  if (normalized.includes('timeout') || normalized.includes('timed out')) {
    return `Likely timeout failure for${jobType} job${attempts}. Check downstream latency, increase handler timeout, or retry with a larger backoff window.`;
  }

  if (normalized.includes('rate') || normalized.includes('429')) {
    return `Likely upstream rate-limit failure for${jobType} job${attempts}. Reduce queue concurrency or use exponential retry with jitter.`;
  }

  if (normalized.includes('validation') || normalized.includes('invalid')) {
    return `Likely payload validation failure for${jobType} job${attempts}. Inspect the submitted payload and handler contract before replaying.`;
  }

  if (normalized.includes('connection') || normalized.includes('econn')) {
    return `Likely network or service connectivity failure for${jobType} job${attempts}. Verify service health, DNS, and retry policy settings.`;
  }

  return `Job${attempts} failed with "${errorMessage}". Review execution logs, payload, and worker health before replaying.`;
}
