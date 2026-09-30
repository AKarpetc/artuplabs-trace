import { useCallback, useEffect, useState } from 'react';
import { buildFieldCatalog } from '../core/fields.js';

let cached = null;

/** Field catalog of the site, read with `client.getFields()` once per session; a failed read is not cached. */
export function loadCatalog(client) {
  if (!cached) {
    const pending = client.getFields().then(buildFieldCatalog);
    cached = pending;
    pending.catch(() => {
      if (cached === pending) cached = null;
    });
  }
  return cached;
}

/** Drops the session catalog so the next read asks Jira again. */
export function forgetCatalog() {
  cached = null;
}

/** Session field catalog for the form: `{ status: 'loading' | 'ready' | 'error', catalog, error, retry }`. */
export function useCatalog(client) {
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState({ status: 'loading', catalog: null, error: null });
  useEffect(() => {
    let live = true;
    loadCatalog(client).then(
      (catalog) => live && setState({ status: 'ready', catalog, error: null }),
      (error) => live && setState({ status: 'error', catalog: null, error }),
    );
    return () => {
      live = false;
    };
  }, [client, attempt]);
  const retry = useCallback(() => {
    setState({ status: 'loading', catalog: null, error: null });
    setAttempt((n) => n + 1);
  }, []);
  return { ...state, retry };
}
