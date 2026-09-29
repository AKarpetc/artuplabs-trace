import { useEffect, useState } from 'react';
import Button from '@atlaskit/button/new';
import SectionMessage from '@atlaskit/section-message';
import { router } from '@forge/bridge';
import { Box, Flex, Stack, Text, xcss } from '@atlaskit/primitives';
import { AppHeader } from '../components/AppHeader.jsx';
import { DownloadIcon, QuestionCircleIcon } from '../components/icons.js';
import { PageLayout } from '../components/PageLayout.jsx';
import { toSlug } from '../core/slug.js';
import { useT } from '../i18n/index.js';
import { createBridgeClient } from '../infra/bridge.js';
import { exportFileName, saveBlob } from '../infra/download.js';
import { AccessGate } from './AccessGate.jsx';
import { FailureView } from './FailureView.jsx';
import { FormatStep } from './FormatStep.jsx';
import { ModeStep } from './ModeStep.jsx';
import { OutputPreview } from './OutputPreview.jsx';
import { ResultView } from './ResultView.jsx';
import { RunningView } from './RunningView.jsx';
import { ScopeStep } from './ScopeStep.jsx';
import { useExportForm } from './useExportForm.js';
import { useExportRun } from './useExportRun.js';
import { usePreview } from './usePreview.js';

const HELP_URL = 'https://artuplabs.com/docs/export/';

const pageStyles = xcss({ minHeight: '100vh', boxSizing: 'border-box', padding: 'space.300', backgroundColor: 'elevation.surface' });
const footerStyles = xcss({
  paddingBlockStart: 'space.300',
  borderBlockStartWidth: 'border.width',
  borderBlockStartStyle: 'solid',
  borderBlockStartColor: 'color.border',
});
const fileStyles = xcss({
  minWidth: '0',
  flexShrink: 1,
  color: 'color.text.subtlest',
  fontFamily: 'font.family.code',
  fontSize: '12px',
  lineHeight: '20px',
  overflowWrap: 'anywhere',
});

function useSpaceName(createClient, spaceKey) {
  const [name, setName] = useState(null);
  useEffect(() => {
    const controller = new AbortController();
    if (spaceKey) {
      createClient({ signal: controller.signal }).getSpace(spaceKey)
        .then((space) => !controller.signal.aborted && setName(space.name), () => {});
    }
    return () => controller.abort();
  }, [createClient, spaceKey]);
  return name;
}

function zipName(form, now) {
  const { target, page, mode } = form;
  const rootSlug = target.kind === 'space' ? '' : toSlug(page?.title ?? '') || target.pageId;
  return exportFileName({ spaceKey: target.spaceKey, rootSlug, mode, now });
}

function ExportBar({ form, total, onStart }) {
  const t = useT();
  const [now] = useState(() => new Date());
  const count = form.target.kind === 'page' && form.hasTarget ? 1 : total;
  const label = typeof count === 'number' && form.hasTarget ? t('studio.exportButton', { count }) : t('studio.exportButtonUnknown');
  return (
    <Box xcss={footerStyles}>
      <Flex gap="space.200" alignItems="center" justifyContent="end" wrap="wrap">
        {form.hasTarget ? <Box xcss={fileStyles}>{zipName(form, now)}</Box> : null}
        <Button appearance="primary" iconAfter={DownloadIcon} isDisabled={!form.ready} onClick={() => onStart(form.form)} testId="studio-export">
          {label}
        </Button>
      </Flex>
    </Box>
  );
}

function Header({ createClient, spaceKey }) {
  const t = useT();
  const spaceName = useSpaceName(createClient, spaceKey);
  const help = (
    <Button appearance="subtle" iconBefore={QuestionCircleIcon} onClick={() => router.open(HELP_URL)}>
      {t('studio.help')}
    </Button>
  );
  return <AppHeader subtitle={t('studio.subtitle')} spaceName={spaceName ? `${spaceKey} · ${spaceName}` : spaceKey} actions={help} />;
}

function Studio({ createClient, form, onStart, cancelled }) {
  const t = useT();
  const preview = usePreview({ createClient, target: form.target, options: form.options, names: form.names, siteUrl: form.form.siteUrl });
  const main = (
    <Stack space="space.400">
      {cancelled ? <SectionMessage appearance="information"><Text>{t('run.cancelled')}</Text></SectionMessage> : null}
      <ScopeStep number={1} form={form} createClient={createClient} />
      <FormatStep number={2} form={form} />
      <ModeStep number={3} form={form} />
      <ExportBar form={form} total={preview.total} onStart={onStart} />
    </Stack>
  );
  return <PageLayout main={main} aside={<OutputPreview preview={preview} />} />;
}

function Workspace({ context, createClient, save, onStart }) {
  const form = useExportForm(context);
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
  if (run.state === 'running') {
    body = <RunningView progress={run.progress} startedAt={run.startedAt} onCancel={run.cancel} />;
  } else if (run.state === 'done') {
    body = <ResultView result={run.result} siteUrl={context?.siteUrl ?? ''} spaceKey={form.spaceKey} onDownloadAgain={run.downloadAgain} onNewExport={newExport} />;
  } else if (run.state === 'failed') {
    body = <FailureView error={run.error} onRetry={run.retry} onBack={run.reset} onContinue={run.continueAnyway} />;
  } else {
    body = <Studio createClient={createClient} form={form} onStart={start} cancelled={run.state === 'cancelled'} />;
  }
  return (
    <Stack space="space.400">
      <Header createClient={createClient} spaceKey={form.spaceKey} />
      {body}
    </Stack>
  );
}

/**
 * Space page: licence gate, then the export studio (scope, format, mode, live preview) and the export run views.
 * `onStart(form)` observes each start; `createClient({ signal })` and `save(fileName, blob)` override the bridge client and the download.
 */
export function StudioApp({ context, createClient = createBridgeClient, save = saveBlob, onStart }) {
  return (
    <Box xcss={pageStyles}>
      <AccessGate>
        <Workspace context={context} createClient={createClient} save={save} onStart={onStart} />
      </AccessGate>
    </Box>
  );
}
