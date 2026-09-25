import { useCallback, useMemo, useState } from 'react';
import DynamicTable from '@atlaskit/dynamic-table';
import EmptyState from '@atlaskit/empty-state';
import Heading from '@atlaskit/heading';
import Lozenge from '@atlaskit/lozenge';
import ProgressBar from '@atlaskit/progress-bar';
import Spinner from '@atlaskit/spinner';
import { Flex, Stack, Text } from '@atlaskit/primitives';
import { call } from '../api.js';
import { formatNumber, useLocale, useT } from '../i18n/index.js';
import { ExportButton } from '../components/ExportButton.jsx';
import { IssueLink } from '../components/IssueLink.jsx';
import { filterRows, useRows } from './useRows.js';
import { LoadError, LoadMoreButton, TableToolbar, WrapText } from './tableParts.jsx';

/** Coverage tab: coverage headline and progress, then the searchable, sortable table of uncovered requirements. */
export function CoverageTab({ projectId, projectKey, coverage }) {
  const t = useT();
  const locale = useLocale();
  const [query, setQuery] = useState('');
  const fetchPage = useCallback((after) => call('getGaps', { projectId, after }), [projectId]);
  const gaps = useRows(fetchPage);
  const visible = useMemo(() => filterRows(gaps.rows, query, ['issueKey', 'summary']), [gaps.rows, query]);

  const total = coverage?.total ?? 0;
  const covered = coverage?.covered ?? 0;
  if (total === 0) {
    return <EmptyState header={t('coverage.empty.title')} description={t('coverage.empty.body')} />;
  }

  const head = {
    cells: [
      { key: 'key', content: t('table.requirement'), isSortable: true, width: 15 },
      { key: 'summary', content: t('table.summary'), isSortable: true, width: 60 },
      { key: 'status', content: t('table.status'), isSortable: true, width: 25 },
    ],
  };
  const rows = visible.map((row) => ({
    key: String(row.issueId),
    cells: [
      { key: row.issueKey, content: <IssueLink issueKey={row.issueKey} /> },
      { key: row.summary ?? '', content: <WrapText>{row.summary}</WrapText> },
      { key: row.statusName ?? '', content: row.statusName ? <Lozenge>{row.statusName}</Lozenge> : null },
    ],
  }));

  return (
    <Stack space="space.300">
      <Stack space="space.150">
        <Heading size="small">
          {t('coverage.headline', {
            percent: formatNumber(locale, coverage.percent ?? 0),
            covered: formatNumber(locale, covered),
            total: formatNumber(locale, total),
          })}
        </Heading>
        <ProgressBar value={total ? covered / total : 0} ariaLabel={t('cards.coverage')} appearance={covered === total ? 'success' : 'default'} />
      </Stack>
      <TableToolbar
        query={query}
        onQueryChange={setQuery}
        actions={<ExportButton kind="gaps" projectKey={projectKey} payload={{ projectId }} />}
      />
      {gaps.error ? <LoadError error={gaps.error} onRetry={gaps.reload} /> : null}
      {!gaps.loaded && !gaps.error ? <Flex justifyContent="center"><Spinner size="large" /></Flex> : null}
      {gaps.loaded ? (
        <DynamicTable
          head={head}
          rows={rows}
          isFixedSize
          defaultSortKey="key"
          defaultSortOrder="ASC"
          emptyView={<Text color="color.text.subtle">{query ? t('table.noMatches') : t('coverage.allCovered')}</Text>}
        />
      ) : null}
      {gaps.loaded ? <LoadMoreButton next={gaps.next} loading={gaps.loadingMore} onClick={gaps.loadMore} /> : null}
    </Stack>
  );
}
