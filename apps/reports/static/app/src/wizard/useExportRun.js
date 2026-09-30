import { useCallback, useEffect, useRef, useState } from 'react';
import { withTemplateTags } from '../export/customTemplate.js';
import { createExportRun } from '../export/pipeline.js';
import { ReportError } from '../export/errors.js';
import { loadRenderers } from '../export/renderers.js';
import { createBridgeClient } from '../infra/bridge.js';
import { saveBlob } from '../infra/download.js';
import { JiraError } from '../infra/jira.js';
import { loadCatalog } from './useCatalog.js';
import { loadTemplateBytes } from './useTemplates.js';

const IDLE = { state: 'idle', progress: null, outcome: null, file: null, error: null, cancelled: false, request: null };

const isAbort = (error) => error?.name === 'AbortError';

async function runnableTemplate(template, getPart, loadLibs) {
  if (template.kind !== 'docx') return template;
  return withTemplateTags(template, await loadTemplateBytes(template, getPart), loadLibs ? { loadLibs } : {});
}

function asRunError(error) {
  return error instanceof JiraError ? new ReportError('network', { status: error.status }) : error;
}

function preventUnload(event) {
  event.preventDefault();
  event.returnValue = '';
}

/**
 * Export run: `state` idle → running → incomplete | done | failed; `start(request)`, `cancel`, `retryMissing`, `downloadPartial`,
 * `download` (the kept Blob again) and `reset`. The file is saved as soon as it is built; a Word template's tags are read
 * from its stored file at start. Clients, saving, renderers, the clock, template-part reads and the template libraries are injectable.
 */
export function useExportRun({
  createClient = createBridgeClient, save = saveBlob, renderers: injected, clock = Date.now, getPart, loadLibs,
} = {}) {
  const [run, setRun] = useState(IDLE);
  const session = useRef(null);
  const renderers = useRef(injected ?? null);

  const live = (current) => session.current === current && !current.controller.signal.aborted;

  const finish = useCallback((current, file, partial) => {
    const blob = new Blob([file.bytes], { type: file.mime });
    current.blob = blob;
    current.fileName = file.fileName;
    save(file.fileName, blob);
    const { bytes, ...kept } = file;
    setRun((prev) => ({ ...prev, state: 'done', progress: null, file: { ...kept, size: bytes.length, partial } }));
  }, [save]);

  const fail = useCallback((current, error) => {
    if (!live(current) || isAbort(error)) return;
    setRun((prev) => ({ ...prev, state: 'failed', progress: null, error: asRunError(error) }));
  }, []);

  const settle = useCallback(async (current, step) => {
    try {
      const outcome = await step();
      if (!live(current)) return;
      if (outcome.status === 'incomplete') {
        setRun((prev) => ({ ...prev, state: 'incomplete', progress: null, outcome }));
        return;
      }
      finish(current, outcome.file, false);
    } catch (error) {
      fail(current, error);
    }
  }, [finish, fail]);

  const start = useCallback(async ({ entry, template, siteUrl, labels, formats }) => {
    session.current?.controller.abort();
    const controller = new AbortController();
    const current = { controller, exportRun: null, blob: null, fileName: '' };
    session.current = current;
    const { signal } = controller;
    setRun({ ...IDLE, state: 'running', progress: { phase: 'prepare', done: 0, total: 0 }, request: { entry, template } });
    try {
      const base = createClient({ signal });
      const [catalog, me, runnable] = await Promise.all([
        loadCatalog(base),
        base.getMyself(),
        runnableTemplate(template, getPart, loadLibs),
      ]);
      if (!live(current)) return;
      const now = new Date(clock());
      renderers.current ??= loadRenderers();
      current.exportRun = createExportRun({
        client: ({ onRetry }) => createClient({ signal, onRetry }),
        entry,
        template: runnable,
        catalog,
        meta: { siteUrl, exportedBy: me.displayName ?? '', now, exportedAt: formats.dateTime(now), paper: template.paper ?? 'A4', fileNamePattern: template.fileNamePattern },
        labels,
        formats,
        renderers: renderers.current,
        clock,
        signal,
        onProgress: (progress) => {
          if (live(current)) setRun((prev) => ({ ...prev, progress }));
        },
      });
    } catch (error) {
      fail(current, error);
      return;
    }
    await settle(current, () => current.exportRun.start());
  }, [createClient, clock, getPart, loadLibs, settle, fail]);

  const retryMissing = useCallback(async () => {
    const current = session.current;
    if (!current?.exportRun) return;
    setRun((prev) => ({ ...prev, state: 'running', progress: { phase: 'read', done: prev.outcome?.done ?? 0, total: prev.outcome?.total ?? 0 } }));
    await settle(current, () => current.exportRun.retryMissing());
  }, [settle]);

  const downloadPartial = useCallback(async () => {
    const current = session.current;
    if (!current?.exportRun) return;
    setRun((prev) => ({ ...prev, state: 'running', progress: { phase: 'build', done: 0, total: 1 } }));
    try {
      const file = await current.exportRun.buildPartial();
      if (live(current)) finish(current, file, true);
    } catch (error) {
      fail(current, error);
    }
  }, [finish, fail]);

  const download = useCallback(() => {
    const current = session.current;
    if (current?.blob) save(current.fileName, current.blob);
  }, [save]);

  const stop = (cancelled) => {
    session.current?.controller.abort();
    session.current = null;
    setRun({ ...IDLE, cancelled });
  };
  const cancel = useCallback(() => stop(true), []);
  const reset = useCallback(() => stop(false), []);

  useEffect(() => {
    if (run.state !== 'running') return undefined;
    window.addEventListener('beforeunload', preventUnload);
    return () => window.removeEventListener('beforeunload', preventUnload);
  }, [run.state]);

  useEffect(() => () => session.current?.controller.abort(), []);

  return { ...run, start, cancel, retryMissing, downloadPartial, download, reset };
}
