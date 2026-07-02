import { computeRetryDelayMs } from '../../src/engine/retryPolicy';
import { RetryPolicy } from '../../src/types';

describe('Retry Policy Calculation', () => {
  const basePolicy: Omit<RetryPolicy, 'strategy'> = {
    id: 'test-policy',
    name: 'Test Policy',
    base_delay_ms: 1000,
    max_retries: 5,
    max_delay_ms: 10000,
    jitter: false,
  };

  test('fixed strategy returns base delay always', () => {
    const policy: RetryPolicy = { ...basePolicy, strategy: 'fixed' };
    expect(computeRetryDelayMs(policy, 1)).toBe(1000);
    expect(computeRetryDelayMs(policy, 2)).toBe(1000);
    expect(computeRetryDelayMs(policy, 5)).toBe(1000);
  });

  test('linear strategy scales base delay linearly with attempt count', () => {
    const policy: RetryPolicy = { ...basePolicy, strategy: 'linear' };
    expect(computeRetryDelayMs(policy, 1)).toBe(1000);
    expect(computeRetryDelayMs(policy, 2)).toBe(2000);
    expect(computeRetryDelayMs(policy, 3)).toBe(3000);
  });

  test('exponential strategy scales exponentially with attempt count', () => {
    const policy: RetryPolicy = { ...basePolicy, strategy: 'exponential' };
    // 1000 * 2^(1-1) = 1000 * 1 = 1000
    expect(computeRetryDelayMs(policy, 1)).toBe(1000);
    // 1000 * 2^(2-1) = 1000 * 2 = 2000
    expect(computeRetryDelayMs(policy, 2)).toBe(2000);
    // 1000 * 2^(3-1) = 1000 * 4 = 4000
    expect(computeRetryDelayMs(policy, 3)).toBe(4000);
    // 1000 * 2^(4-1) = 1000 * 8 = 8000
    expect(computeRetryDelayMs(policy, 4)).toBe(8000);
  });

  test('delays are capped at max_delay_ms', () => {
    const policy: RetryPolicy = { ...basePolicy, strategy: 'exponential', max_delay_ms: 5000 };
    expect(computeRetryDelayMs(policy, 3)).toBe(4000); // under cap
    expect(computeRetryDelayMs(policy, 4)).toBe(5000); // capped (would be 8000)
    expect(computeRetryDelayMs(policy, 5)).toBe(5000); // capped (would be 16000)
  });

  test('jitter strategy applies random variation within +-15% range', () => {
    const policy: RetryPolicy = { ...basePolicy, strategy: 'fixed', jitter: true };
    const delay1 = computeRetryDelayMs(policy, 1);
    const delay2 = computeRetryDelayMs(policy, 1);
    const delay3 = computeRetryDelayMs(policy, 1);

    // With base_delay = 1000, Jitter adds 0.85 to 1.15 multiplier.
    // So output must be in [850, 1150].
    expect(delay1).toBeGreaterThanOrEqual(850);
    expect(delay1).toBeLessThanOrEqual(1150);

    expect(delay2).toBeGreaterThanOrEqual(850);
    expect(delay2).toBeLessThanOrEqual(1150);

    expect(delay3).toBeGreaterThanOrEqual(850);
    expect(delay3).toBeLessThanOrEqual(1150);
  });
});
