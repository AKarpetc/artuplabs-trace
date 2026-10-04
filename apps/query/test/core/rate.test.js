import { describe, expect, it } from 'vitest';
import { endpointOf, rateHeaderText, rateLimitOf } from '../../src/core/rate.js';

const headers = (map) => (name) => map[name] ?? null;

describe('rateLimitOf', () => {
  it('retries after the seconds of Retry-After', () => {
    expect(rateLimitOf(headers({ 'retry-after': '1847' }), 1000).retryAt).toEqual(1000 + 1847000);
  });
  it('retries when the window resets, even when Retry-After names a later instant (measured: 3600 s five minutes into the hour)', () => {
    const at = rateLimitOf(headers({ 'retry-after': '3600', 'x-ratelimit-reset': '2026-10-04T22:00Z' }), Date.parse('2026-10-04T21:05:29Z'));
    expect(at.retryAt).toEqual(Date.parse('2026-10-04T22:00:00Z'));
  });
  it('retries at the later of Retry-After and Beta-Retry-After without a reset instant', () => {
    expect(rateLimitOf(headers({ 'retry-after': '5', 'beta-retry-after': '30' }), 0).retryAt).toEqual(30000);
  });
  it('knows no retry instant without rate headers', () => {
    expect(rateLimitOf(headers({}), 1000)).toEqual({ retryAt: null, reason: null, near: false, remaining: null });
  });
  it('ignores a Retry-After that is not a number of seconds', () => {
    expect(rateLimitOf(headers({ 'retry-after': 'soon', 'x-ratelimit-reset': 'later' }), 1000).retryAt).toBe(null);
  });
  it('reads the reason, the near-limit warning and the remaining quota', () => {
    const facts = rateLimitOf(headers({ 'ratelimit-reason': 'jira-quota-global-based', 'x-ratelimit-nearlimit': 'true', 'beta-ratelimit': '"global-app-quota";r=11000;t=600' }), 0);
    expect(facts).toEqual({ retryAt: null, reason: 'jira-quota-global-based', near: true, remaining: 11000 });
  });
});

describe('rateHeaderText', () => {
  it('lists the rate headers present as name=value pairs', () => {
    expect(rateHeaderText(headers({ 'retry-after': '60', 'ratelimit-reason': 'jira-burst-based', 'content-type': 'x' }))).toEqual('retry-after=60 ratelimit-reason=jira-burst-based');
  });
});

describe('endpointOf', () => {
  it('drops the query, ids and keys of a path', () => {
    expect([
      endpointOf('/rest/api/3/issue/123?fields=a'),
      endpointOf('/rest/api/3/project/ABC/role/10'),
      endpointOf('/rest/agile/1.0/board/7/sprint?state=active'),
      endpointOf('/rest/api/3/search/jql'),
    ]).toEqual(['/rest/api/3/issue/*', '/rest/api/3/project/*/role/*', '/rest/agile/1.0/board/*/sprint', '/rest/api/3/search/jql']);
  });
});
