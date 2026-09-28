import { useState } from 'react';
import Button from '@atlaskit/button/new';
import Heading from '@atlaskit/heading';
import SectionMessage from '@atlaskit/section-message';
import { Box, Flex, Grid, Inline, Stack, Text, xcss } from '@atlaskit/primitives';
import {
  ArchiveBoxIcon, AttachmentIcon, CheckCircleIcon, ChevronDownIcon, ChevronRightIcon, CopyIcon, DeleteIcon, DownloadIcon,
  PagesIcon, RefreshIcon, StopwatchIcon,
} from '../components/icons.js';
import { StatTile } from '../components/StatTile.jsx';
import { formatBytes, formatDuration, formatNumber, useLocale, useT } from '../i18n/index.js';
import { SuccessIllustration } from '../illustrations/SuccessIllustration.jsx';
import { WarningsTable } from './WarningsTable.jsx';

const cardStyles = xcss({
  padding: 'space.400',
  borderRadius: 'radius.large',
  backgroundColor: 'elevation.surface.raised',
  boxShadow: 'elevation.shadow.raised',
  minWidth: '0',
});
const heroTextStyles = xcss({ minWidth: '0', flexGrow: 1, flexBasis: '280px' });
const illustrationStyles = xcss({ flexShrink: 0, lineHeight: '0' });
const fileStyles = xcss({ fontFamily: 'font.family.code', fontSize: '14px', lineHeight: '20px', color: 'color.text', overflowWrap: 'anywhere' });
const commandStyles = xcss({
  padding: 'space.150',
  borderRadius: 'radius.small',
  backgroundColor: 'color.background.neutral',
  fontFamily: 'font.family.code',
  fontSize: '12px',
  lineHeight: '20px',
  color: 'color.text',
  overflowWrap: 'anywhere',
  whiteSpace: 'pre-wrap',
  minWidth: '0',
  flexGrow: 1,
  flexBasis: '320px',
});
const listStyles = xcss({ margin: 'space.0', paddingInlineStart: 'space.300' });

/** Shell command that unpacks an update zip over `docs` and removes the files listed in export-deleted.txt. */
export function applyCommand(fileName) {
  return `unzip -o ${fileName} -d docs && (cd docs && [ -f export-deleted.txt ] && xargs -d '\\n' rm -f < export-deleted.txt; rm -f export-deleted.txt)`;
}

function tilesOf(t, locale, result) {
  const { stats, mode, deletePaths, elapsedMs } = result;
  const n = (value) => formatNumber(locale, value);
  const size = { id: 'size', label: t('result.size'), value: formatBytes(locale, stats.bytes), icon: ArchiveBoxIcon };
  if (mode === 'update') {
    const changed = stats.added + stats.changed + stats.moved + stats.relinked;
    return [
      { id: 'changed', label: t('result.changed'), value: n(changed), icon: RefreshIcon, tone: 'success' },
      { id: 'unchanged', label: t('result.unchanged'), value: n(stats.unchanged), icon: CheckCircleIcon },
      { id: 'deleted', label: t('result.deleted'), value: n(deletePaths.length), icon: DeleteIcon, tone: deletePaths.length > 0 ? 'warning' : 'neutral' },
      size,
    ];
  }
  return [
    { id: 'pages', label: t('result.pages'), value: n(stats.written), icon: PagesIcon, tone: 'success' },
    { id: 'attachments', label: t('result.attachments'), value: n(stats.attachments), icon: AttachmentIcon },
    size,
    { id: 'time', label: t('result.time'), value: formatDuration(t, elapsedMs ?? 0), icon: StopwatchIcon },
  ];
}

function CopyButton({ text }) {
  const t = useT();
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };
  return (
    <Button appearance="subtle" iconBefore={copied ? CheckCircleIcon : CopyIcon} onClick={copy} testId="apply-copy">
      {copied ? t('result.apply.copied') : t('result.apply.copy')}
    </Button>
  );
}

function ApplyHelp({ fileName }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const command = applyCommand(fileName);
  return (
    <Box xcss={cardStyles}>
      <Stack space="space.200">
        <Box>
          <Button appearance="subtle" iconBefore={open ? ChevronDownIcon : ChevronRightIcon} onClick={() => setOpen(!open)} aria-expanded={open} testId="apply-toggle">
            {t('result.apply.title')}
          </Button>
        </Box>
        {open ? (
          <Box as="ol" xcss={listStyles}>
            <Stack space="space.150">
              <Box as="li"><Text>{t('result.apply.step1')}</Text></Box>
              <Box as="li">
                <Stack space="space.100">
                  <Text>{t('result.apply.step2')}</Text>
                  <Flex gap="space.100" alignItems="start" wrap="wrap">
                    <Box xcss={commandStyles} testId="apply-command">{command}</Box>
                    <CopyButton text={command} />
                  </Flex>
                </Stack>
              </Box>
              <Box as="li"><Text>{t('result.apply.step3')}</Text></Box>
            </Stack>
          </Box>
        ) : null}
      </Stack>
    </Box>
  );
}

/** Finished export: success hero with download, stat tiles, full-export and missing-page notes, apply help and warnings. */
export function ResultView({ result, siteUrl, spaceKey, onDownloadAgain, onNewExport }) {
  const t = useT();
  const locale = useLocale();
  const showApply = result.mode === 'update' || result.deletePaths.length > 0;
  return (
    <Stack space="space.400" testId="result-view">
      <Box xcss={cardStyles}>
        <Flex gap="space.300" alignItems="center" wrap="wrap">
          <Box xcss={illustrationStyles}><SuccessIllustration size={120} /></Box>
          <Stack space="space.150" xcss={heroTextStyles}>
            <Heading size="large" as="h2">{t('result.title')}</Heading>
            <Box xcss={fileStyles}>{result.fileName}</Box>
            <Text color="color.text.subtle">{t('result.started')}</Text>
            <Inline space="space.100" shouldWrap>
              <Button appearance="primary" iconBefore={DownloadIcon} onClick={onDownloadAgain} testId="download-again">{t('result.downloadAgain')}</Button>
              <Button onClick={onNewExport} testId="new-export">{t('result.newExport')}</Button>
            </Inline>
          </Stack>
        </Flex>
      </Box>
      <Grid gap="space.200" templateColumns="repeat(auto-fit, minmax(170px, 1fr))">
        {tilesOf(t, locale, result).map((tile) => (
          <StatTile key={tile.id} testId={`stat-${tile.id}`} label={tile.label} value={tile.value} icon={tile.icon} tone={tile.tone} />
        ))}
      </Grid>
      {result.fullReason ? (
        <SectionMessage appearance="warning"><Text>{t(`result.full.${result.fullReason}`)}</Text></SectionMessage>
      ) : null}
      {result.stats.missing > 0 ? (
        <SectionMessage appearance="warning"><Text>{t('result.missing', { count: result.stats.missing })}</Text></SectionMessage>
      ) : null}
      {showApply ? <ApplyHelp fileName={result.fileName} /> : null}
      {result.warnings.length > 0 ? (
        <Box xcss={cardStyles}>
          <WarningsTable warnings={result.warnings} siteUrl={siteUrl} spaceKey={spaceKey} />
        </Box>
      ) : <WarningsTable warnings={result.warnings} siteUrl={siteUrl} spaceKey={spaceKey} />}
    </Stack>
  );
}
