import { useCallback, useEffect, useRef, useState } from 'react';
import { runExport } from '../export/pipeline.js';
import { createBridgeClient } from '../infra/bridge.js';
import { saveBlob } from '../infra/download.js';

const isAbort = (error) => error?.name === 'AbortError';

function preventUnload(event) {
  event.preventDefault();
  event.returnValue = '';
}

/**
 * Export run state machine: idle → running → done | failed | cancelled; the zip downloads once on success.
 * `createClient({ signal })`, `save(fileName, blob)` and `clock()` are injectable for tests and the preview.
 */
export function useExportRun({ context, createClient = createBridgeClient, save = saveBlob, clock = Date.now } = {}) {
  const [run, setRun] = useState({ state: 'idle', progress: null, result: null, error: null, form: null, startedAt: 0 });
  const controller = useRef(null);
  const siteUrl = context?.siteUrl ?? '';

  const start = useCallback(async (form) => {
    controller.current?.abort();
    const current = new AbortController();
    controller.current = current;
    const startedAt = clock();
    setRun({ state: 'running', progress: { stage: 'scan', done: 0, total: 0 }, result: null, error: null, form, startedAt });
    try {
      const result = await runExport({
        client: createClient({ signal: current.signal }),
        target: form.target,
        options: form.options,
        previousManifest: form.previousManifest,
        siteUrl: form.siteUrl ?? siteUrl,
        signal: current.signal,
        onProgress: (progress) => setRun((prev) => (prev.state === 'running' && controller.current === current ? { ...prev, progress } : prev)),
        now: new Date(clock()),
      });
      if (current.signal.aborted) return;
      const finished = { ...result, elapsedMs: clock() - startedAt };
      setRun((prev) => ({ ...prev, state: 'done', result: finished }));
      save(result.fileName, result.blob);
    } catch (error) {
      if (current.signal.aborted || isAbort(error)) return;
      setRun((prev) => ({ ...prev, state: 'failed', error }));
    }
  }, [createClient, save, clock, siteUrl]);

  const cancel = useCallback(() => {
    controller.current?.abort();
    controller.current = null;
    setRun((prev) => ({ ...prev, state: 'cancelled', progress: null }));
  }, []);

  const reset = useCallback(() => {
    controller.current?.abort();
    controller.current = null;
    setRun({ state: 'idle', progress: null, result: null, error: null, form: null, startedAt: 0 });
  }, []);

  const retry = useCallback(() => {
    if (run.form) start(run.form);
  }, [run.form, start]);

  const downloadAgain = useCallback(() => {
    if (run.result) save(run.result.fileName, run.result.blob);
  }, [run.result, save]);

  useEffect(() => {
    if (run.state !== 'running') return undefined;
    window.addEventListener('beforeunload', preventUnload);
    return () => window.removeEventListener('beforeunload', preventUnload);
  }, [run.state]);

  useEffect(() => () => controller.current?.abort(), []);

  return { ...run, start, cancel, reset, retry, downloadAgain };
}
