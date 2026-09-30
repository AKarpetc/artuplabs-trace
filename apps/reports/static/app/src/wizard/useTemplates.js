import { useCallback, useEffect, useMemo, useState } from 'react';
import { call } from '../api.js';
import { withOrder } from '../core/entry.js';
import { projectKeysOf } from './useWizardForm.js';

/** Stored template groups in the order the picker lists them. */
export const TEMPLATE_GROUPS = ['user', 'project', 'site'];

const EMPTY = { user: [], project: [], site: [] };

/** Decodes a base64 string to bytes. */
export function decodeBase64(data) {
  const text = atob(data);
  const bytes = new Uint8Array(text.length);
  for (let i = 0; i < text.length; i += 1) bytes[i] = text.charCodeAt(i);
  return bytes;
}

/** Reads a stored Word template part by part (0…parts−1, one after another) and joins the bytes; null when it has no parts. */
export async function loadTemplateBytes(template, getPart = (id, index) => call('getTemplatePart', { id, index })) {
  const count = template.parts ?? 0;
  if (count < 1) return null;
  const chunks = [];
  for (let index = 0; index < count; index += 1) {
    const { data } = await getPart(template.id, index);
    chunks.push(decodeBase64(data));
  }
  const bytes = new Uint8Array(chunks.reduce((sum, chunk) => sum + chunk.length, 0));
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  return bytes;
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
export function useTemplates(entry, { client, load = (payload) => call('listTemplates', payload) } = {}) {
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
