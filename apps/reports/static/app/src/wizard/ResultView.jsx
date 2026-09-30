import Button from '@atlaskit/button/new';
import Heading from '@atlaskit/heading';
import SectionMessage from '@atlaskit/section-message';
import { Box, Flex, Grid, Inline, Stack, Text, xcss } from '@atlaskit/primitives';
import { DownloadIcon, ImageIcon, PagesIcon, StopwatchIcon, WarningIcon } from '../components/icons.js';
import { StatTile } from '../components/StatTile.jsx';
import { formatDuration, formatNumber, useLocale, useT } from '../i18n/index.js';
import { SuccessIllustration } from '../illustrations/SuccessIllustration.jsx';
import { WarningsTable } from './WarningsTable.jsx';

const cardStyles = xcss({
  padding: 'space.400',
  borderRadius: 'radius.large',
  backgroundColor: 'elevation.surface.raised',
  boxShadow: 'elevation.shadow.raised',
  minWidth: '0',
});
const compactCardStyles = xcss({ padding: 'space.300' });
const heroTextStyles = xcss({ minWidth: '0', flexGrow: 1, flexBasis: '280px' });
const illustrationStyles = xcss({ flexShrink: 0, lineHeight: '0' });
const fileStyles = xcss({ fontFamily: 'font.family.code', fontSize: '14px', lineHeight: '20px', color: 'color.text', overflowWrap: 'anywhere' });

/** Stat tiles of a finished file: issues, seconds, skipped issues and missing images. */
export function resultTiles(t, locale, stats) {
  const n = (value) => formatNumber(locale, value);
  return [
    { id: 'issues', label: t('result.issues'), value: n(stats.issues), icon: PagesIcon, tone: 'success' },
    { id: 'time', label: t('result.time'), value: formatDuration(t, stats.seconds * 1000), icon: StopwatchIcon, tone: 'neutral' },
    { id: 'skipped', label: t('result.skipped'), value: n(stats.skipped), icon: WarningIcon, tone: stats.skipped > 0 ? 'warning' : 'neutral' },
    { id: 'images', label: t('result.imagesMissing'), value: n(stats.imagesMissing), icon: ImageIcon, tone: stats.imagesMissing > 0 ? 'warning' : 'neutral' },
  ];
}

/** Finished export: success hero with the file name and "Download again", stat tiles, notes and the warnings table. */
export function ResultView({ file, siteUrl, onDownloadAgain, onNewExport, compact = false, extraAction = null }) {
  const t = useT();
  const locale = useLocale();
  const { stats } = file;
  const card = [cardStyles, compact && compactCardStyles];
  return (
    <Stack space={compact ? 'space.300' : 'space.400'} testId="result-view">
      <Box xcss={card}>
        <Flex gap="space.300" alignItems="center" wrap="wrap">
          {compact ? null : <Box xcss={illustrationStyles}><SuccessIllustration size={120} /></Box>}
          <Stack space="space.150" xcss={heroTextStyles}>
            <Heading size={compact ? 'medium' : 'large'} as="h2">{t(file.partial ? 'result.partialTitle' : 'result.title')}</Heading>
            <Box xcss={fileStyles} testId="result-file">{file.fileName}</Box>
            <Text color="color.text.subtle">{t('result.summary', { count: stats.issues, time: formatDuration(t, stats.seconds * 1000) })}</Text>
            <Text color="color.text.subtle">{t('result.started')}</Text>
            <Inline space="space.100" shouldWrap>
              <Button appearance="primary" iconBefore={DownloadIcon} onClick={onDownloadAgain} testId="download-again">{t('result.downloadAgain')}</Button>
              <Button onClick={onNewExport} testId="new-export">{t('result.newExport')}</Button>
              {extraAction}
            </Inline>
          </Stack>
        </Flex>
      </Box>
      <Grid gap="space.200" templateColumns={compact ? 'repeat(2, minmax(0, 1fr))' : 'repeat(auto-fit, minmax(160px, 1fr))'} testId="result-tiles">
        {resultTiles(t, locale, stats).map((tile) => (
          <StatTile key={tile.id} testId={`stat-${tile.id}`} label={tile.label} value={tile.value} icon={tile.icon} tone={tile.tone} />
        ))}
      </Grid>
      {file.partial ? (
        <SectionMessage appearance="warning"><Text>{t('result.partialNote', { done: stats.issues, count: stats.total })}</Text></SectionMessage>
      ) : null}
      {stats.retries > 0 ? (
        <SectionMessage appearance="information"><Text>{t('result.retries', { count: stats.retries })}</Text></SectionMessage>
      ) : null}
      <Box xcss={card}>
        <WarningsTable warnings={file.warnings} siteUrl={siteUrl} />
      </Box>
    </Stack>
  );
}
