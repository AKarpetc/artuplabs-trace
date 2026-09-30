import { useCallback, useEffect, useMemo, useState } from 'react';
import { call, withRetry } from '../api.js';
import { withOrder } from '../core/entry.js';
import { readTemplateBytes } from '../export/customTemplate.js';
import { projectKeysOf } from './useWizardForm.js';

/** Stored template groups in the order the picker lists them. */
export const TEMPLATE_GROUPS = ['user', 'project', 'site'];

const EMPTY = { user: [], project: [], site: [] };

const read = withRetry(call);

/** Reads a stored Word template part by part through the getTemplatePart resolver, repeating a part that fails with `internal`; null when it has no parts. */
export function loadTemplateBytes(template, getPart = (id, index) => read('getTemplatePart', { id, index })) {
  return readTemplateBytes(template, getPart);
}

/** Stored templates of one format per group; names sorted with the locale collator. */
export function templatesFor(groups, format, locale) {
  const collator = new Intl.Collator(locale);
  return Object.fromEntries(TEMPLATE_GROUPS.map((group) => [
    group,
    (groups[group] ?? []).filter((template) => template.format === format).sort((a, b) => collator.compare(a.name, b.name)),
  ]));
}

/** Project keys for template lookup: the entry's own, else a board's project from its first issue; none when that read fails. */
export async function lookupProjectKeys(client, entry) {
  const known = projectKeysOf(entry);
  if (known.length > 0 || entry.kind !== 'board') return known;
  try {
    const { jql } = await client.boardJql(entry.boardId);
    const [id] = await client.searchIds(withOrder(jql), { limit: 1 });
    if (!id) return [];
    const { issues } = await client.bulkFetch([id], { fields: ['project'] });
    const key = issues[0]?.fields?.project?.key;
    return key ? [key] : [];
  } catch {
    return [];
  }
}

/** Stored templates visible for the entry's project: `{ status: 'loading' | 'ready' | 'error', groups, error, retry }`. */
export function useTemplates(entry, { client, load = (payload) => read('listTemplates', payload) } = {}) {
  const entryKey = JSON.stringify(entry);
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState({ status: 'loading', groups: EMPTY, error: null });
  useEffect(() => {
    let live = true;
    setState({ status: 'loading', groups: EMPTY, error: null });
    lookupProjectKeys(client, JSON.parse(entryKey)).then((projectKeys) => load({ projectKeys })).then(
      (groups) => live && setState({ status: 'ready', groups: { ...EMPTY, ...groups }, error: null }),
      (error) => live && setState({ status: 'error', groups: EMPTY, error }),
    );
    return () => {
      live = false;
    };
  }, [client, entryKey, attempt]);
  const retry = useCallback(() => setAttempt((n) => n + 1), []);
  return useMemo(() => ({ ...state, retry }), [state, retry]);
}
