import DynamicTable from '@atlaskit/dynamic-table';
import Heading from '@atlaskit/heading';
import Lozenge from '@atlaskit/lozenge';
import { Inline, Stack, Text } from '@atlaskit/primitives';
import { Card } from '../components/Card.jsx';
import { formatDate, useI18n } from '../i18n/index.js';
import { IndexProgress } from './IndexProgress.jsx';

const iso = (ms) => new Date(ms).toISOString();

/** Refresh queue, last update, index progress per part and the recent JQL editor errors. */
export function StatusPanel({ status }) {
  const { t, locale } = useI18n();
  const queue = status.queue.running ? ['inprogress', 'status.running'] : status.queue.pending ? ['moved', 'status.pending'] : ['success', 'status.idle'];
  const hasParts = Object.keys(status.progress ?? {}).length > 0;
  const rows = status.errors.map((e, i) => ({
    key: `${e.at}-${i}`,
    cells: [{ key: 't', content: formatDate(locale, iso(e.at)) }, { key: 'f', content: e.functionName }, { key: 'm', content: e.message }],
  }));
  return (
    <Stack space="space.400">
      <Card>
        <Stack space="space.150">
          <Heading size="small" as="h2">{t('status.queue')}</Heading>
          <Inline space="space.100" alignBlock="center" shouldWrap>
            <Lozenge appearance={queue[0]}>{t(queue[1])}</Lozenge>
            <Text>{status.lastRefresh ? t('status.lastRefresh', { time: formatDate(locale, iso(status.lastRefresh.at)) }) : t('status.never')}</Text>
          </Inline>
        </Stack>
      </Card>
      {hasParts ? (
        <Card>
          <Stack space="space.200">
            <Heading size="small" as="h2">{t('status.index')}</Heading>
            <IndexProgress progress={status.progress} />
            {status.excluded.length ? <Text>{t('status.excluded', { keys: status.excluded.join(', ') })}</Text> : null}
          </Stack>
        </Card>
      ) : null}
      <Card>
        <Stack space="space.150">
          <Heading size="small" as="h2">{t('status.errors')}</Heading>
          {rows.length ? (
            <DynamicTable head={{ cells: [{ key: 't', content: t('status.time') }, { key: 'f', content: t('status.function') }, { key: 'm', content: t('status.message') }] }} rows={rows} />
          ) : <Text>{t('status.noErrors')}</Text>}
        </Stack>
      </Card>
    </Stack>
  );
}
