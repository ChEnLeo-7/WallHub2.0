'use strict';

const DEFAULT_WORKSHOP_ATTEMPT_TIMEOUT_MS = 15000;
const DEFAULT_WORKSHOP_MAX_ATTEMPTS = 3;

async function requestWorkshopWithRetry(request, options = {}) {
  const maxAttempts = Math.max(1, Math.min(5, Number(options.maxAttempts || DEFAULT_WORKSHOP_MAX_ATTEMPTS)));
  const timeoutMs = Math.max(10, Number(options.timeoutMs || DEFAULT_WORKSHOP_ATTEMPT_TIMEOUT_MS));
  const parentSignal = options.signal || null;
  const onAttempt = typeof options.onAttempt === 'function' ? options.onAttempt : () => {};
  const onFailure = typeof options.onFailure === 'function' ? options.onFailure : () => {};
  let lastError = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    if (parentSignal && parentSignal.aborted) break;
    const controller = new AbortController();
    let timedOut = false;
    const abortFromParent = () => controller.abort();
    if (parentSignal) parentSignal.addEventListener('abort', abortFromParent, { once: true });
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, timeoutMs);
    timer.unref?.();
    onAttempt({ attempt, maxAttempts, retryCount: attempt - 1, lastError });
    try {
      return await request({ signal: controller.signal, attempt, maxAttempts, timeoutMs });
    } catch (error) {
      lastError = timedOut
        ? Object.assign(new Error(`Steam Community request timed out after ${Math.round(timeoutMs / 1000)} seconds`), { code: 'ONBOARDING_WORKSHOP_TIMEOUT' })
        : error;
      onFailure({ attempt, maxAttempts, retryCount: attempt - 1, error: lastError, willRetry: attempt < maxAttempts });
      if (attempt >= maxAttempts || (parentSignal && parentSignal.aborted)) break;
    } finally {
      clearTimeout(timer);
      if (parentSignal) parentSignal.removeEventListener('abort', abortFromParent);
    }
  }

  if (parentSignal && parentSignal.aborted) {
    const error = new Error('Steam Community connection check exceeded its time limit');
    error.code = 'ONBOARDING_NETWORK_TIMEOUT';
    error.cause = lastError;
    throw error;
  }
  const error = new Error(`Steam Community connection failed after ${maxAttempts} attempts: ${lastError && lastError.message || 'request failed'}`);
  error.code = lastError && lastError.code || 'ONBOARDING_WORKSHOP_RETRIES_EXHAUSTED';
  error.cause = lastError;
  error.attempts = maxAttempts;
  throw error;
}

module.exports = {
  DEFAULT_WORKSHOP_ATTEMPT_TIMEOUT_MS,
  DEFAULT_WORKSHOP_MAX_ATTEMPTS,
  requestWorkshopWithRetry,
};
