import Heading from '@atlaskit/heading';
import SectionMessage from '@atlaskit/section-message';
import { Flex, Stack, Text } from '@atlaskit/primitives';
import { formatDate, formatNumber, useLocale, useT } from '../i18n/index.js';

const RUNNING = ['running', 'waiting'];

/** Page header: app title, last sync time and a banner while a sync runs or after it failed. */
export function ProjectHeader({ overview }) {
  const t = useT();
  const locale = useLocale();
  const lastSyncedAt = overview?.sync?.lastSyncedAt;
  const job = overview?.sync?.job;
  return (
    <Stack space="space.200">
      <Flex justifyContent="space-between" alignItems="baseline" gap="space.200" wrap="wrap">
        <Heading size="large">{t('app.title')}</Heading>
        {lastSyncedAt ? <Text color="color.text.subtle">{t('app.lastSynced', { time: formatDate(locale, lastSyncedAt) })}</Text> : null}
      </Flex>
      {job && RUNNING.includes(job.status) ? (
        <SectionMessage appearance="information">
          {t('app.syncing', { pages: formatNumber(locale, Number(job.state?.pages) || 0) })}
        </SectionMessage>
      ) : null}
      {job?.status === 'failed' ? (
        <SectionMessage appearance="error">{t('app.syncFailed', { error: job.error ?? '' })}</SectionMessage>
      ) : null}
    </Stack>
  );
}
