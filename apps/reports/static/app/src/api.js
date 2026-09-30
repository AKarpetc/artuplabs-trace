import { invoke } from '@forge/bridge';
import { RESOLVER_RETRY_DELAYS_MS } from './core/limits.js';

const KNOWN_CODES = ['unlicensed', 'bad-request', 'forbidden', 'not-found', 'too-large', 'internal'];

/**
 * Matches a resolver error message against the known error codes with a
 * substring check; returns `'generic'` when none match.
 */
function matchCode(message) {
  return KNOWN_CODES.find((code) => message.includes(code)) ?? 'generic';
}

/** Error thrown by `call()`; carries the mapped resolver error code and the original message. */
export class AppError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'AppError';
    this.code = code;
  }
}

/**
 * Invokes a Forge resolver by key with a payload; resolves with its data or
 * throws an `AppError` mapped from the rejection message.
 */
export async function call(key, payload) {
  try {
    return await invoke(key, payload);
  } catch (error) {
    const message = String(error?.message ?? error);
    throw new AppError(matchCode(message), message);
  }
}

const codeOf = (error) => (error instanceof AppError ? error.code : matchCode(String(error?.message ?? error)));

const wait = (ms) => new Promise((resolve) => {
  setTimeout(resolve, ms);
});

/**
 * Wraps a resolver caller for reads: an `internal` failure (Jira throttling or a transient error behind the resolver)
 * is repeated after each of `delays`; other codes are final at once.
 */
export function withRetry(callResolver, { delays = RESOLVER_RETRY_DELAYS_MS, sleep = wait } = {}) {
  return async (key, payload) => {
    for (let attempt = 0; ; attempt += 1) {
      try {
        return await callResolver(key, payload);
      } catch (error) {
        if (codeOf(error) !== 'internal' || attempt >= delays.length) throw error;
        await sleep(delays[attempt]);
      }
    }
  };
}

/**
 * Turns a `call()` error (or any `Error`) into a user-facing message via
 * `t()`; known codes get their dedicated translation, others fall back to
 * the generic error text carrying the original message.
 */
export function errorMessage(t, error) {
  const message = String(error?.message ?? error);
  const code = codeOf(error);
  if (code === 'generic') {
    return t('errors.generic', { message });
  }
  return t(`errors.${code}`);
}
