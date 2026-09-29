import { invoke } from '@forge/bridge';

const KNOWN_CODES = ['no-permission', 'unlicensed', 'bad-request'];

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

/**
 * Turns a `call()` error (or any `Error`) into a user-facing message via
 * `t()`; known codes get their dedicated translation, others fall back to
 * the generic error text carrying the original message.
 */
export function errorMessage(t, error) {
  const message = String(error?.message ?? error);
  const code = error instanceof AppError ? error.code : matchCode(message);
  if (code === 'generic') {
    return t('errors.generic', { message });
  }
  return t(`errors.${code}`);
}
