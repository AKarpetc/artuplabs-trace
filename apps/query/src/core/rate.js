const RATE_HEADERS = ['retry-after', 'x-ratelimit-limit', 'x-ratelimit-remaining', 'x-ratelimit-reset', 'x-ratelimit-nearlimit', 'ratelimit-reason', 'beta-ratelimit', 'beta-ratelimit-policy', 'beta-retry-after'];

const seconds = (text) => {
  const n = Number(text);
  return text !== null && text !== undefined && text !== '' && Number.isFinite(n) && n >= 0 ? n : null;
};

/** Rate-limit facts of one Jira answer, read through `header(name)`: when to retry (epoch ms, the latest instant any header names), the limit Jira hit, and whether little capacity is left. */
export function rateLimitOf(header, now) {
  const instants = [];
  const retryAfter = seconds(header('retry-after'));
  if (retryAfter !== null) instants.push(now + retryAfter * 1000);
  const betaRetry = seconds(header('beta-retry-after'));
  if (betaRetry !== null) instants.push(now + betaRetry * 1000);
  const reset = Date.parse(header('x-ratelimit-reset') ?? '');
  if (Number.isFinite(reset)) instants.push(reset);
  const beta = /(?:^|;)\s*r=(\d+)/.exec(header('beta-ratelimit') ?? '');
  return {
    retryAt: instants.length ? Math.max(...instants) : null,
    reason: header('ratelimit-reason') ?? null,
    near: String(header('x-ratelimit-nearlimit') ?? '').toLowerCase() === 'true',
    remaining: beta ? Number(beta[1]) : null,
  };
}

/** The rate-limit headers of an answer as `name=value` pairs, for a log line; they hold limits and times only. */
export function rateHeaderText(header) {
  return RATE_HEADERS.flatMap((name) => {
    const value = header(name);
    return value === null || value === undefined ? [] : [`${name}=${value}`];
  }).join(' ');
}

/** The endpoint of a request path without its query and without ids or keys, for counting requests by kind. */
export function endpointOf(path) {
  return String(path).split('?')[0].split('/').map((part, i) => (i <= 3 || /^[a-z][a-z-]*$/.test(part) ? part : '*')).join('/');
}
