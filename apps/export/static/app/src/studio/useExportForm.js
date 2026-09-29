import { useCallback, useMemo, useRef, useState } from 'react';
import { parseManifest } from '../core/manifest.js';
import { DEFAULT_OPTIONS } from '../core/presets.js';
import { decideMode, sourceOf } from '../export/pipeline.js';
import { readManifestFromFile } from '../infra/zip.js';

const NO_NAMES = new Map();

/** Largest previous export the studio reads into memory: 512 MB. */
export const MAX_PREVIOUS_BYTES = 512 * 1024 * 1024;

async function readPrevious(file) {
  if (file.size > MAX_PREVIOUS_BYTES) return { ok: false, error: 'too-large' };
  try {
    const text = await readManifestFromFile(file);
    return text === null ? { ok: false, error: 'no-manifest-in-zip' } : parseManifest(text);
  } catch {
    return { ok: false, error: 'no-manifest-in-zip' };
  }
}

/**
 * Studio form state: target (space, branch or page), options, the previous export and the mode.
 * `initial` may set the starting `scope` and `page`; `mode`/`fullReason` are what the export will really do; `form` is what `onStart` receives.
 */
export function useExportForm(context, initial = {}) {
  const spaceKey = context?.extension?.space?.key ?? '';
  const siteUrl = context?.siteUrl ?? '';
  const [scope, setScope] = useState(initial.scope ?? 'space');
  const [page, setPage] = useState(initial.page ?? null);
  const [options, setOptions] = useState(DEFAULT_OPTIONS);
  const [modeChoice, setModeChoice] = useState('full');
  const [previous, setPrevious] = useState(null);
  const reads = useRef(0);

  const target = useMemo(
    () => (scope === 'space' ? { kind: 'space', spaceKey } : { kind: scope, spaceKey, pageId: page?.id ?? null }),
    [scope, spaceKey, page],
  );
  const setTarget = useCallback(({ kind, page: picked }) => {
    if (kind) setScope(kind);
    if (picked !== undefined) setPage(picked);
  }, []);
  const setOption = useCallback((key, value) => setOptions((current) => ({ ...current, [key]: value })), []);
  const setPreviousFile = useCallback(async (file) => {
    reads.current += 1;
    const read = reads.current;
    if (!file) {
      setPrevious(null);
      return;
    }
    const parsed = await readPrevious(file);
    if (read !== reads.current) return;
    setPrevious({ fileName: file.name, manifest: parsed.ok ? parsed.manifest : null, error: parsed.ok ? null : parsed.error });
    if (parsed.ok) setModeChoice('update');
  }, []);

  const manifest = previous?.manifest ?? null;
  const useManifest = modeChoice === 'update' && manifest !== null;
  const decision = useMemo(() => decideMode(
    useManifest ? manifest : null,
    sourceOf({ ...target, spaceKey }, siteUrl),
    options,
  ), [useManifest, manifest, siteUrl, spaceKey, target, options]);
  const hasTarget = Boolean(spaceKey) && (target.kind === 'space' || Boolean(target.pageId));
  const ready = hasTarget && (modeChoice === 'full' || useManifest);
  const form = useMemo(() => ({
    target, options, mode: decision.mode, fullReason: decision.fullReason, previousManifest: useManifest ? manifest : null, siteUrl,
  }), [target, options, decision, useManifest, manifest, siteUrl]);

  return {
    spaceKey,
    target,
    setTarget,
    page,
    options,
    setOption,
    previous,
    setPreviousFile,
    modeChoice,
    setModeChoice,
    mode: decision.mode,
    fullReason: decision.fullReason,
    names: useManifest ? decision.names : NO_NAMES,
    hasTarget,
    ready,
    form,
  };
}
