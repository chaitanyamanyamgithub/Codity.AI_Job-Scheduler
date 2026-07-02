import { RetryPolicy } from '../types';

/**
 * Computes the retry delay in milliseconds based on the policy strategy and current attempt.
 *
 * Strategies:
 * - fixed:       always base_delay_ms
 * - linear:      base_delay_ms × attempt
 * - exponential: base_delay_ms × 2^(attempt-1)
 *
 * All strategies are capped at max_delay_ms.
 * If jitter is enabled, adds ±15% randomization to prevent thundering herd.
 */
export function computeRetryDelayMs(policy: RetryPolicy, attempt: number): number {
  let delay: number;

  switch (policy.strategy) {
    case 'fixed':
      delay = policy.base_delay_ms;
      break;
    case 'linear':
      delay = policy.base_delay_ms * attempt;
      break;
    case 'exponential':
      delay = policy.base_delay_ms * Math.pow(2, attempt - 1);
      break;
    default:
      delay = policy.base_delay_ms;
  }

  // Cap at max_delay_ms
  delay = Math.min(delay, policy.max_delay_ms);

  // Apply jitter: ±15% randomization
  if (policy.jitter) {
    const jitterFactor = 0.85 + Math.random() * 0.3; // 0.85 to 1.15
    delay = Math.round(delay * jitterFactor);
  }

  return delay;
}

/**
 * Gets the default retry policy for use when a queue has no policy configured.
 */
export function getDefaultRetryPolicy(): RetryPolicy {
  return {
    id: 'default',
    name: 'Default',
    strategy: 'exponential',
    base_delay_ms: 1000,
    max_retries: 3,
    max_delay_ms: 60000,
    jitter: true,
  };
}
