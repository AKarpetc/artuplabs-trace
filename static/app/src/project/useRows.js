import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Paged row loader over `fetchPage(after)` resolving `{ rows, next, ... }`: loads the first page on mount
 * and whenever `fetchPage` changes, exposes `reload` and a guarded `loadMore`, and keeps the last response.
 */
export function useRows(fetchPage) {
  const [state, setState] = useState({ rows: [], next: null, last: null, loaded: false, error: null });
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const generation = useRef(0);
  const moreInFlight = useRef(false);

  const reload = useCallback(async () => {
    generation.current += 1;
    const current = generation.current;
    moreInFlight.current = false;
    setLoadingMore(false);
    setLoading(true);
    try {
      const res = await fetchPage('');
      if (current === generation.current) {
        setState({ rows: res.rows ?? [], next: res.next ?? null, last: res, loaded: true, error: null });
      }
    } catch (error) {
      if (current === generation.current) {
        setState((prev) => ({ ...prev, error }));
      }
    } finally {
      if (current === generation.current) {
        setLoading(false);
      }
    }
  }, [fetchPage]);

  const loadMore = useCallback(async () => {
    if (moreInFlight.current || !state.next) {
      return;
    }
    moreInFlight.current = true;
    const current = generation.current;
    setLoadingMore(true);
    try {
      const res = await fetchPage(state.next);
      if (current === generation.current) {
        setState((prev) => ({ ...prev, rows: [...prev.rows, ...(res.rows ?? [])], next: res.next ?? null, last: res, error: null }));
      }
    } catch (error) {
      if (current === generation.current) {
        setState((prev) => ({ ...prev, error }));
      }
    } finally {
      if (current === generation.current) {
        moreInFlight.current = false;
        setLoadingMore(false);
      }
    }
  }, [fetchPage, state.next]);

  useEffect(() => {
    reload();
  }, [reload]);

  return { ...state, loading, loadingMore, reload, loadMore };
}

/** Keeps the rows whose `fields` values contain `query`, compared case-insensitively; an empty query keeps all. */
export function filterRows(rows, query, fields) {
  const needle = query.trim().toLowerCase();
  if (!needle) {
    return rows;
  }
  return rows.filter((row) => fields.some((field) => String(row[field] ?? '').toLowerCase().includes(needle)));
}
