import { useCallback, useEffect, useMemo, useState } from 'react';
import { requestJira } from '@forge/bridge';
import { call, withRetry } from '../api.js';
import { RESOLVER_RETRY_DELAYS_MS, TEMPLATE_PROJECT_KEYS, TEMPLATE_READ_CONCURRENCY } from '../core/limits.js';
import { createPool } from '../infra/pool.js';
import { uploadParts } from './upload.js';

const PROJECT_PAGE = 50;
const MAX_PROJECT_PAGES = 20;
const USER_PAGE = 50;
const EMPTY = { user: [], project: [], site: [] };

const chunk = (list, size) => Array.from({ length: Math.ceil(list.length / size) }, (_, i) => list.slice(i * size, (i + 1) * size));

/** Projects the user may edit, `{ key, name }` each, read page by page; none when Jira refuses. */
export async function fetchProjects(request = requestJira) {
  const projects = [];
  try {
    for (let page = 0; page < MAX_PROJECT_PAGES; page += 1) {
      const start = page === 0 ? '' : `&startAt=${projects.length}`;
      const response = await request(`/rest/api/3/project/search?action=edit&maxResults=${PROJECT_PAGE}${start}`);
      if (!response.ok) return [];
      const body = await response.json();
      const values = body.values ?? [];
      projects.push(...values.map(({ key, name }) => ({ key, name })));
      if (body.isLast !== false || values.length === 0) break;
    }
  } catch {
    return projects;
  }
  return projects;
}

/** Display names by account id for the given ids; ids Jira does not answer for are left out. */
export async function fetchAuthors(ids, request = requestJira) {
  const names = {};
  const read = async (part) => {
    const query = part.map((id) => `accountId=${encodeURIComponent(id)}`).join('&');
    const response = await request(`/rest/api/3/user/bulk?${query}&maxResults=${USER_PAGE}`);
    if (!response.ok) return;
    for (const user of (await response.json()).values ?? []) names[user.accountId] = user.displayName;
  };
  await Promise.all(chunk([...new Set(ids)], USER_PAGE).map((part) => read(part).catch(() => undefined)));
  return names;
}

async function loadAll(callResolver, request, retryDelays) {
  const projects = await fetchProjects(request);
  const parts = chunk(projects.map((project) => project.key), TEMPLATE_PROJECT_KEYS);
  const batches = parts.length > 0 ? parts : [[]];
  const read = withRetry(callResolver, { delays: retryDelays });
  const limit = createPool(TEMPLATE_READ_CONCURRENCY);
  const ask = (key) => (projectKeys) => limit(() => read(key, { projectKeys }));
  const [scopeAnswers, listAnswers] = await Promise.all([
    Promise.all(batches.map(ask('getScopes'))),
    Promise.all(batches.map(ask('listTemplates'))),
  ]);
  const groups = {
    user: listAnswers[0].user ?? [],
    project: listAnswers.flatMap((answer) => answer.project ?? []),
    site: listAnswers[0].site ?? [],
  };
  const scopes = { site: scopeAnswers.some((answer) => answer.site === true), projects: scopeAnswers.flatMap((answer) => answer.projects ?? []) };
  const ids = Object.values(groups).flat().map((template) => template.authorId).filter(Boolean);
  return { groups, scopes, projects, authors: await fetchAuthors(ids, request) };
}

/** True when the caller may edit or delete the template: their own, a site one for administrators, a project one for project administrators. */
export function canManage(template, scopes) {
  if (template.scope === 'user') return true;
  if (template.scope === 'site') return scopes.site;
  return scopes.projects.includes(template.scopeId);
}

/**
 * Templates the caller can see, the scopes they may manage and the actions on them:
 * `{ status: 'loading' | 'ready' | 'error', groups, scopes, projects, authors, error, reload, save, upload, remove }`.
 * The reads run at most three at a time and repeat an `internal` failure after each of `retryDelays`.
 */
export function useTemplateAdmin({ callResolver = call, request = requestJira, retryDelays = RESOLVER_RETRY_DELAYS_MS } = {}) {
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState({ status: 'loading', groups: EMPTY, scopes: { site: false, projects: [] }, projects: [], authors: {}, error: null });
  useEffect(() => {
    let live = true;
    setState((current) => ({ ...current, status: 'loading', error: null }));
    loadAll(callResolver, request, retryDelays).then(
      (loaded) => live && setState({ status: 'ready', ...loaded, error: null }),
      (error) => live && setState((current) => ({ ...current, status: 'error', error })),
    );
    return () => {
      live = false;
    };
  }, [callResolver, request, retryDelays, attempt]);
  const reload = useCallback(() => setAttempt((n) => n + 1), []);
  const actions = useMemo(() => ({
    save: (template) => callResolver('saveTemplate', { template }),
    upload: (id, bytes, onProgress) => uploadParts({ id, bytes, call: callResolver, onProgress }),
    remove: (id) => callResolver('deleteTemplate', { id }),
  }), [callResolver]);
  return useMemo(() => ({ ...state, reload, ...actions }), [state, reload, actions]);
}
