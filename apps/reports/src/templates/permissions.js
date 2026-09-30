const PROJECT_KEYS = ['BROWSE_PROJECTS', 'ADMINISTER_PROJECTS'];
const SITE_KEYS = ['ADMINISTER'];

/** Permission checker for one caller; Jira answers are cached per permission set and project, a refusal denies, a failed read throws and is asked again next time. */
export function createPermissions({ accountId, fetchMyPermissions }) {
  const cache = new Map();

  function held(keys, projectKey) {
    const cacheKey = `${keys.join(',')}|${projectKey ?? ''}`;
    if (!cache.has(cacheKey)) {
      const answer = Promise.resolve().then(() => fetchMyPermissions(keys, projectKey)).then((result) => result ?? {});
      answer.catch(() => cache.delete(cacheKey));
      cache.set(cacheKey, answer);
    }
    return cache.get(cacheKey);
  }

  async function has(scope, scopeId, action) {
    if (scope === 'user') return typeof accountId === 'string' && accountId !== '' && scopeId === accountId;
    if (scope === 'site') return action === 'view' || (await held(SITE_KEYS)).ADMINISTER === true;
    if (scope === 'project' && typeof scopeId === 'string') {
      const granted = await held(PROJECT_KEYS, scopeId);
      return granted[action === 'view' ? 'BROWSE_PROJECTS' : 'ADMINISTER_PROJECTS'] === true;
    }
    return false;
  }

  return {
    canView: (meta) => has(meta?.scope, meta?.scopeId, 'view'),
    canManage: (scope, scopeId) => has(scope, scopeId, 'manage'),
  };
}
