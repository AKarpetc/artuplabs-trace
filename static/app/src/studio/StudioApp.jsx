import { useEffect, useState } from 'react';
import Button from '@atlaskit/button/new';
import EmptyState from '@atlaskit/empty-state';
import Spinner from '@atlaskit/spinner';
import { router } from '@forge/bridge';
import { Box, Flex, Stack, xcss } from '@atlaskit/primitives';
import { errorMessage } from '../api.js';
import { AppHeader } from '../components/AppHeader.jsx';
import { DownloadIcon, QuestionCircleIcon } from '../components/icons.js';
import { PageLayout } from '../components/PageLayout.jsx';
import { toSlug } from '../core/slug.js';
import { useT } from '../i18n/index.js';
import { EmptyIllustration } from '../illustrations/EmptyIllustration.jsx';
import { LockIllustration } from '../illustrations/LockIllustration.jsx';
import { createBridgeClient } from '../infra/bridge.js';
import { exportFileName } from '../infra/download.js';
import { FormatStep } from './FormatStep.jsx';
import { ModeStep } from './ModeStep.jsx';
import { OutputPreview } from './OutputPreview.jsx';
import { ScopeStep } from './ScopeStep.jsx';
import { useAccess } from './useAccess.js';
import { useExportForm } from './useExportForm.js';
import { usePreview } from './usePreview.js';

const HELP_URL = 'https://artuplabs.com/docs/export/';

const pageStyles = xcss({ minHeight: '100vh', boxSizing: 'border-box', padding: 'space.300', backgroundColor: 'elevation.surface' });
const centerStyles = xcss({ minHeight: '60vh', display: 'flex', alignItems: 'center', justifyContent: 'center' });
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

function Studio({ createClient, form, onStart }) {
  const t = useT();
  const preview = usePreview({ createClient, target: form.target, options: form.options, names: form.names, siteUrl: form.form.siteUrl });
  const spaceName = useSpaceName(createClient, form.spaceKey);
  const help = (
    <Button appearance="subtle" iconBefore={QuestionCircleIcon} onClick={() => router.open(HELP_URL)}>
      {t('studio.help')}
    </Button>
  );
  const main = (
    <Stack space="space.400">
      <ScopeStep number={1} form={form} createClient={createClient} />
      <FormatStep number={2} form={form} />
      <ModeStep number={3} form={form} />
      <ExportBar form={form} total={preview.total} onStart={onStart} />
    </Stack>
  );
  return (
    <Stack space="space.400">
      <AppHeader subtitle={t('studio.subtitle')} spaceName={spaceName ? `${form.spaceKey} · ${spaceName}` : form.spaceKey} actions={help} />
      <PageLayout main={main} aside={<OutputPreview preview={preview} />} />
    </Stack>
  );
}

/**
 * Space page: licence gate, then the export studio (scope, format, mode, live preview).
 * `onStart(form)` receives the chosen target, options and previous manifest; `createClient({ signal })` overrides the bridge client.
 */
export function StudioApp({ context, createClient = createBridgeClient, onStart }) {
  const t = useT();
  const access = useAccess();
  const form = useExportForm(context);
  const [, setStarted] = useState(null);
  const start = (chosen) => {
    setStarted(chosen);
    onStart?.(chosen);
  };
  let content;
  if (access.status === 'loading') {
    content = <Box xcss={centerStyles}><Spinner size="large" label={t('loading')} /></Box>;
  } else if (access.status === 'unlicensed') {
    content = <EmptyState header={t('unlicensed.title')} description={t('unlicensed.body')} renderImage={() => <LockIllustration size={160} />} headingLevel={1} />;
  } else if (access.status === 'error') {
    content = (
      <EmptyState
        header={errorMessage(t, access.error)}
        renderImage={() => <EmptyIllustration size={160} />}
        primaryAction={<Button appearance="primary" onClick={access.retry}>{t('errors.tryAgain')}</Button>}
        headingLevel={1}
      />
    );
  } else {
    content = <Studio createClient={createClient} form={form} onStart={start} />;
  }
  return <Box xcss={pageStyles}>{content}</Box>;
}
