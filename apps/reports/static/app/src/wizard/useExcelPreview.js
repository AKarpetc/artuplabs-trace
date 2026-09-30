import { useCallback, useEffect, useState } from 'react';
import { PREVIEW_ISSUES } from '../core/limits.js';
import { ReportError } from '../export/errors.js';
import { createExportRun } from '../export/pipeline.js';
import { JiraError } from '../infra/jira.js';

/** Rows the preview table shows. */
export const PREVIEW_ROWS = 5;

const IDLE = { status: 'idle', sheet: null, count: null, jql: '', error: null };

const isAbort = (error) => error?.name === 'AbortError';

/** Runs the Excel pipeline on the first issues with a renderer that keeps the assembled sheets instead of writing a file. */
export async function previewSheets({ client, entry, template, catalog, labels, formats, siteUrl, signal, now }) {
  let captured = null;
  const renderers = {
    xlsx: async ({ assembled, meta }) => {
      captured = { sheet: assembled.sheets[0], jql: meta.jql };
      return new Uint8Array();
    },
  };
  const run = createExportRun({
    client,
    entry,
    template: { ...template, summary: false },
    catalog,
    meta: { siteUrl, exportedBy: '', exportedAt: '', now, paper: 'A4' },
    labels,
    formats,
    renderers,
    clock: () => now.getTime(),
    signal,
    limit: PREVIEW_ISSUES,
  });
  const outcome = await run.start();
  if (outcome.status !== 'done') throw new ReportError('network', { status: 0 });
  const count = await client.approximateCount(captured.jql);
  return { sheet: { columns: captured.sheet.columns, rows: captured.sheet.rows.slice(0, PREVIEW_ROWS) }, count, jql: captured.jql };
}

/**
 * Live Excel preview for `request` ({ entry, template, catalog, siteUrl }, or null when off), refreshed `delay` ms after the
 * last change: `{ status: 'idle' | 'loading' | 'ready' | 'empty' | 'error', sheet, count, jql, error, retry }`.
 */
export function useExcelPreview({ createClient, request, labels, formats, delay = 400 }) {
  const [state, setState] = useState(IDLE);
  const [attempt, setAttempt] = useState(0);
  const previewTemplate = request ? { ...request.template, fileNamePattern: undefined } : null;
  const key = request ? JSON.stringify({ entry: request.entry, template: previewTemplate, siteUrl: request.siteUrl }) : '';
  const catalog = request?.catalog ?? null;
  useEffect(() => {
    if (!key || !catalog) {
      setState(IDLE);
      return undefined;
    }
    const { entry, template, siteUrl } = JSON.parse(key);
    const controller = new AbortController();
    setState((prev) => ({ ...prev, status: 'loading', error: null }));
    const timer = setTimeout(() => {
      previewSheets({
        client: createClient({ signal: controller.signal }), entry, template, catalog, labels, formats, siteUrl, signal: controller.signal, now: new Date(),
      }).then(
        (result) => !controller.signal.aborted && setState({ status: 'ready', ...result, error: null }),
        (error) => {
          if (controller.signal.aborted || isAbort(error)) return;
          if (error instanceof ReportError && error.code === 'no-issues') {
            setState({ ...IDLE, status: 'empty' });
            return;
          }
          setState({ ...IDLE, status: 'error', error: error instanceof JiraError ? new ReportError('network', { status: error.status }) : error });
        },
      );
    }, delay);
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [key, catalog, createClient, labels, formats, delay, attempt]);
  const retry = useCallback(() => setAttempt((n) => n + 1), []);
  return { ...state, retry };
}
