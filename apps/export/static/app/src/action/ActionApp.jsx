import { useCallback, useEffect, useState } from 'react';
import Button from '@atlaskit/button/new';
import EmptyState from '@atlaskit/empty-state';
import Heading from '@atlaskit/heading';
import Skeleton from '@atlaskit/skeleton';
import Spinner from '@atlaskit/spinner';
import Tooltip from '@atlaskit/tooltip';
import { view } from '@forge/bridge';
import { Box, Inline, Stack, Text, xcss } from '@atlaskit/primitives';
import { useT } from '../i18n/index.js';
import { AppIcon } from '../illustrations/AppIcon.jsx';
import { EmptyIllustration } from '../illustrations/EmptyIllustration.jsx';
import { createBridgeClient } from '../infra/bridge.js';
import { saveBlob } from '../infra/download.js';
import { AccessGate } from '../studio/AccessGate.jsx';
import { FailureView, runErrorMessage } from '../studio/FailureView.jsx';
import { ResultView } from '../studio/ResultView.jsx';
import { RunningView } from '../studio/RunningView.jsx';
import { useExportForm } from '../studio/useExportForm.js';
import { useExportRun } from '../studio/useExportRun.js';
import { ActionForm } from './ActionForm.jsx';

/** Longest page title shown in full in the modal header. */
export const TITLE_LIMIT = 60;

const pageStyles = xcss({
  minHeight: '100vh',
  boxSizing: 'border-box',
  display: 'flex',
  flexDirection: 'column',
  padding: 'space.300',
  backgroundColor: 'elevation.surface',
});
const fillStyles = xcss({ flexGrow: 1 });
const iconStyles = xcss({ flexShrink: 0, lineHeight: '0' });
const titleStyles = xcss({ minWidth: '0', flexGrow: 1, overflowWrap: 'anywhere' });
const triggerStyles = xcss({
  borderRadius: 'radius.small',
  ':focus-visible': { outlineWidth: 'border.width.focused', outlineStyle: 'solid', outlineColor: 'color.border.focused' },
});
const centerStyles = xcss({ minHeight: '40vh', display: 'flex', alignItems: 'center', justifyContent: 'center' });

/** Cuts `title` to `limit` characters (code points), ending with an ellipsis when it was longer. */
export function truncateTitle(title, limit = TITLE_LIMIT) {
  const chars = Array.from(String(title ?? ''));
  return chars.length <= limit ? chars.join('') : `${chars.slice(0, limit - 1).join('')}…`;
}

function closeModal() {
  Promise.resolve(view.close?.()).catch(() => {});
}

/** Loads the page title (unless the context has it) and its subpage count; `subpages` stays undefined while counting. */
function usePageInfo(createClient, spaceKey, pageId, contextTitle) {
  const [attempt, setAttempt] = useState(0);
  const [info, setInfo] = useState({ status: 'loading', title: contextTitle, subpages: undefined, error: null });
  useEffect(() => {
    if (!pageId || !spaceKey) {
      setInfo({ status: 'missing', title: null, subpages: null, error: null });
      return undefined;
    }
    const controller = new AbortController();
    const live = () => !controller.signal.aborted;
    const client = createClient({ signal: controller.signal });
    setInfo({ status: contextTitle ? 'ready' : 'loading', title: contextTitle, subpages: undefined, error: null });
    client.countPages(spaceKey, pageId).then(
      (count) => live() && setInfo((prev) => ({ ...prev, subpages: typeof count === 'number' ? Math.max(0, count - 1) : null })),
      () => live() && setInfo((prev) => ({ ...prev, subpages: null })),
    );
    if (!contextTitle) {
      client.getPages([pageId], { withBody: false }).then(
        ([page]) => live() && setInfo((prev) => (page ? { ...prev, status: 'ready', title: page.title } : { ...prev, status: 'missing' })),
        (error) => live() && setInfo((prev) => ({ ...prev, status: 'error', error })),
      );
    }
    return () => controller.abort();
  }, [createClient, spaceKey, pageId, contextTitle, attempt]);
  const retry = useCallback(() => setAttempt((n) => n + 1), []);
  return { ...info, retry };
}

function Title({ title }) {
  const t = useT();
  const short = truncateTitle(title);
  const text = t('action.title', { title: short });
  if (short === title) {
    return <Heading size="medium" as="h1"><Box as="span" testId="action-title">{text}</Box></Heading>;
  }
  return (
    <Heading size="medium" as="h1">
      <Tooltip content={title} position="bottom-start">
        {(props) => <Box as="span" {...props} tabIndex={0} xcss={triggerStyles} testId="action-title">{text}</Box>}
      </Tooltip>
    </Heading>
  );
}

function Header({ title, loading }) {
  const t = useT();
  let heading = null;
  if (title) heading = <Title title={title} />;
  else if (loading) heading = <Skeleton width="60%" height="24px" isShimmering testId="action-title-skeleton" />;
  return (
    <Inline space="space.150" alignBlock="center">
      <Box xcss={iconStyles}><AppIcon size={32} /></Box>
      <Stack space="space.025" xcss={titleStyles}>
        {heading ? <Text size="small" color="color.text.subtle" weight="medium">{t('app.name')}</Text> : <Heading size="medium" as="h1">{t('app.name')}</Heading>}
        {heading}
      </Stack>
    </Inline>
  );
}

function CloseButton({ appearance = 'default' }) {
  const t = useT();
  return <Button appearance={appearance} onClick={closeModal} testId="action-close">{t('action.close')}</Button>;
}

function Workspace({ context, createClient, save, onStart }) {
  const t = useT();
  const content = context?.extension?.content ?? {};
  const pageId = content.id != null ? String(content.id) : null;
  const spaceKey = context?.extension?.space?.key ?? '';
  const contextTitle = typeof content.title === 'string' && content.title ? content.title : null;
  const info = usePageInfo(createClient, spaceKey, pageId, contextTitle);
  const form = useExportForm(context, { scope: 'page', page: pageId ? { id: pageId, title: contextTitle } : null });
  const run = useExportRun({ context, createClient, save });
  const start = (chosen) => {
    onStart?.(chosen);
    run.start(chosen);
  };
  const newExport = () => {
    form.setPreviousFile(null);
    form.setModeChoice('full');
    run.reset();
  };
  let body;
  if (info.status === 'loading') {
    body = <Box xcss={centerStyles}><Spinner size="large" label={t('loading')} /></Box>;
  } else if (info.status === 'missing') {
    body = (
      <EmptyState
        header={t('action.notFound')}
        renderImage={() => <EmptyIllustration size={120} />}
        primaryAction={<CloseButton appearance="primary" />}
        headingLevel={2}
      />
    );
  } else if (info.status === 'error') {
    body = (
      <EmptyState
        header={runErrorMessage(t, info.error)}
        renderImage={() => <EmptyIllustration size={120} />}
        primaryAction={<Button appearance="primary" onClick={info.retry}>{t('errors.tryAgain')}</Button>}
        secondaryAction={<CloseButton />}
        headingLevel={2}
      />
    );
  } else if (run.state === 'running') {
    body = <RunningView progress={run.progress} startedAt={run.startedAt} onCancel={run.cancel} hint={t('action.keepOpen')} compact />;
  } else if (run.state === 'done') {
    body = (
      <ResultView
        result={run.result}
        siteUrl={context?.siteUrl ?? ''}
        spaceKey={spaceKey}
        onDownloadAgain={run.downloadAgain}
        onNewExport={newExport}
        extraAction={<CloseButton appearance="subtle" />}
        compact
      />
    );
  } else if (run.state === 'failed') {
    body = <FailureView error={run.error} onRetry={run.retry} onBack={run.reset} onContinue={run.continueAnyway} />;
  } else {
    body = (
      <ActionForm
        form={form}
        subpages={info.subpages}
        createClient={createClient}
        cancelled={run.state === 'cancelled'}
        onStart={start}
        onCancel={closeModal}
      />
    );
  }
  return (
    <Stack space="space.300" xcss={fillStyles}>
      <Header title={info.status === 'ready' ? info.title : null} loading={info.status === 'loading'} />
      {body}
    </Stack>
  );
}

/**
 * Content action modal: export the page from the "…" menu alone or with its subpages, then show progress and the result.
 * `onStart(form)` observes each start; `createClient({ signal })` and `save(fileName, blob)` override the bridge client and the download.
 */
export function ActionApp({ context, createClient = createBridgeClient, save = saveBlob, onStart }) {
  return (
    <Box xcss={pageStyles}>
      <AccessGate>
        <Workspace context={context} createClient={createClient} save={save} onStart={onStart} />
      </AccessGate>
    </Box>
  );
}
