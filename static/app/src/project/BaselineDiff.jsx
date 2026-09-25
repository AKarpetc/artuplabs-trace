import { useCallback } from 'react';
import DynamicTable from '@atlaskit/dynamic-table';
import Lozenge from '@atlaskit/lozenge';
import Spinner from '@atlaskit/spinner';
import { Flex, Stack, Text } from '@atlaskit/primitives';
import { call } from '../api.js';
import { formatNumber, useLocale, useT } from '../i18n/index.js';
import { ExportButton } from '../components/ExportButton.jsx';
import { IssueLink } from '../components/IssueLink.jsx';
import { useRows } from './useRows.js';
import { LoadError, LoadMoreButton, sortable, WrapText } from './tableParts.jsx';

const CHANGE_APPEARANCE = {
  added: 'success',
  removed: 'removed',
  changed: 'moved',
  'links-changed': 'inprogress',
};

/** Difference between two baselines: change counts, a paged table of changed requirements and a CSV export. */
export function BaselineDiff({ projectId, projectKey, leftId, rightId }) {
  const t = useT();
  const locale = useLocale();
  const fetchPage = useCallback((after) => call('getDiff', { projectId, leftId, rightId, after }), [projectId, leftId, rightId]);
  const diff = useRows(fetchPage);
  const counts = diff.last?.counts;

  if (!diff.loaded) {
    return diff.error
      ? <LoadError error={diff.error} onRetry={diff.reload} />
      : <Flex justifyContent="center"><Spinner size="large" /></Flex>;
  }

  const none = t('common.none');
  const sort = sortable(t);
  const head = {
    cells: [
      { key: 'key', content: t('table.requirement'), ...sort, width: 15 },
      { key: 'summary', content: t('table.summary'), ...sort, width: 45 },
      { key: 'change', content: t('table.change'), ...sort, width: 15 },
      { key: 'status', content: t('table.statusBeforeAfter'), width: 25 },
    ],
  };
  const rows = diff.rows.map((row) => ({
    key: String(row.issueId),
    cells: [
      { key: row.issueKey, content: <IssueLink issueKey={row.issueKey} /> },
      { key: row.summary ?? '', content: <WrapText>{row.summary}</WrapText> },
      { key: row.change, content: <Lozenge appearance={CHANGE_APPEARANCE[row.change] ?? 'default'}>{t(`change.${row.change}`)}</Lozenge> },
      { content: <WrapText>{t('baselines.statusChange', { before: row.leftStatus || none, after: row.rightStatus || none })}</WrapText> },
    ],
  }));

  return (
    <Stack space="space.200">
      <Flex gap="space.200" justifyContent="space-between" alignItems="center" wrap="wrap">
        {counts ? (
          <Text weight="medium">
            {t('baselines.counts', {
              added: formatNumber(locale, counts.added),
              removed: formatNumber(locale, counts.removed),
              changed: formatNumber(locale, counts.changed),
              linksChanged: formatNumber(locale, counts.linksChanged),
            })}
          </Text>
        ) : <span />}
        <ExportButton kind="diff" projectKey={projectKey} payload={{ projectId, leftId, rightId }} />
      </Flex>
      {diff.error ? <LoadError error={diff.error} onRetry={diff.reload} /> : null}
      <DynamicTable
        head={head}
        rows={rows}
        isFixedSize
        emptyView={<Text color="color.text.subtle">{t('baselines.noDifferences')}</Text>}
      />
      <LoadMoreButton next={diff.next} loading={diff.loadingMore} onClick={diff.loadMore} />
    </Stack>
  );
}
