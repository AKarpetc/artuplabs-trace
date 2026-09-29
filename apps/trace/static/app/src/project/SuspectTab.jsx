import { useCallback, useMemo, useRef, useState } from 'react';
import Button from '@atlaskit/button/new';
import { Checkbox } from '@atlaskit/checkbox';
import DynamicTable from '@atlaskit/dynamic-table';
import EmptyState from '@atlaskit/empty-state';
import Lozenge from '@atlaskit/lozenge';
import Spinner from '@atlaskit/spinner';
import { Flex, Inline, Stack, Text } from '@atlaskit/primitives';
import { call, errorMessage } from '../api.js';
import { formatNumber, useLocale, useT } from '../i18n/index.js';
import { ExportButton } from '../components/ExportButton.jsx';
import { IssueLink } from '../components/IssueLink.jsx';
import { useToasts } from '../components/Toasts.jsx';
import { filterRows, useRows } from './useRows.js';
import { LoadError, LoadMoreButton, sortable, TableToolbar, WrapText } from './tableParts.jsx';

const SEARCH_FIELDS = ['reqKey', 'reqSummary', 'otherKey'];

/** Confirms links one by one; resolves with how many were confirmed and whether any no longer existed. */
async function confirmAll(projectId, linkIds) {
  let confirmed = 0;
  let gone = false;
  for (const linkId of linkIds) {
    const res = await call('confirmLink', { projectId, linkId });
    if (res?.ok) {
      confirmed += 1;
    } else {
      gone = true;
    }
  }
  return { confirmed, gone };
}

/** Suspect links tab: searchable table with per-row and bulk confirmation; `onChanged` runs after every confirmation. */
export function SuspectTab({ projectId, projectKey, onChanged }) {
  const t = useT();
  const locale = useLocale();
  const { show } = useToasts();
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState(() => new Set());
  const [pending, setPending] = useState(() => new Set());
  const inFlight = useRef(false);
  const fetchPage = useCallback((after) => call('getSuspects', { projectId, after }), [projectId]);
  const suspects = useRows(fetchPage);
  const visible = useMemo(() => filterRows(suspects.rows, query, SEARCH_FIELDS), [suspects.rows, query]);
  const busy = pending.size > 0;

  async function confirm(linkIds) {
    if (inFlight.current || !linkIds.length) {
      return;
    }
    inFlight.current = true;
    setPending(new Set(linkIds));
    try {
      await confirmAndNotify(linkIds);
      await suspects.reload();
      onChanged?.();
    } finally {
      inFlight.current = false;
      setPending(new Set());
      setSelected(new Set());
    }
  }

  async function confirmAndNotify(linkIds) {
    try {
      const { confirmed, gone } = await confirmAll(projectId, linkIds);
      if (confirmed === 1) {
        show({ title: t('suspects.confirmed'), appearance: 'success' });
      } else if (confirmed > 1) {
        show({ title: t('suspects.confirmedMany', { count: formatNumber(locale, confirmed) }), appearance: 'success' });
      }
      if (gone) {
        show({ title: t('suspects.gone'), appearance: 'warning' });
      }
    } catch (error) {
      show({ title: errorMessage(t, error), appearance: 'error' });
    }
  }

  function changeQuery(nextQuery) {
    setQuery(nextQuery);
    const shown = new Set(filterRows(suspects.rows, nextQuery, SEARCH_FIELDS).map((row) => row.linkId));
    setSelected((prev) => new Set([...prev].filter((linkId) => shown.has(linkId))));
  }

  function toggle(linkId) {
    setSelected((prev) => {
      const nextSet = new Set(prev);
      if (nextSet.has(linkId)) {
        nextSet.delete(linkId);
      } else {
        nextSet.add(linkId);
      }
      return nextSet;
    });
  }

  const allSelected = visible.length > 0 && visible.every((row) => selected.has(row.linkId));
  function toggleAll() {
    setSelected(allSelected ? new Set() : new Set(visible.map((row) => row.linkId)));
  }

  if (suspects.loaded && !suspects.error && suspects.rows.length === 0) {
    return <EmptyState header={t('suspects.empty.title')} description={t('suspects.empty.body')} />;
  }

  const sort = sortable(t);
  const head = {
    cells: [
      { key: 'select', content: <Checkbox isChecked={allSelected} isDisabled={busy || !visible.length} onChange={toggleAll} aria-label={t('suspects.selectAll')} />, width: 4 },
      { key: 'req', content: t('table.requirement'), ...sort, width: 12 },
      { key: 'summary', content: t('table.summary'), ...sort, width: 38 },
      { key: 'link', content: t('table.link'), ...sort, width: 14 },
      { key: 'other', content: t('table.linkedIssue'), ...sort, width: 20 },
      { key: 'action', content: '', width: 12 },
    ],
  };
  const rows = visible.map((row) => ({
    key: String(row.linkId),
    cells: [
      { key: row.linkId, content: <Checkbox isChecked={selected.has(row.linkId)} isDisabled={busy} onChange={() => toggle(row.linkId)} aria-label={t('suspects.select', { key: row.reqKey })} /> },
      { key: row.reqKey, content: <IssueLink issueKey={row.reqKey} /> },
      { key: row.reqSummary ?? '', content: <WrapText>{row.reqSummary}</WrapText> },
      { key: row.linkTypeName ?? '', content: <WrapText>{row.linkTypeName}</WrapText> },
      {
        key: row.otherKey ?? '',
        content: (
          <Inline space="space.100" alignBlock="center" shouldWrap>
            <IssueLink issueKey={row.otherKey} />
            {row.otherStatus ? <Lozenge>{row.otherStatus}</Lozenge> : null}
          </Inline>
        ),
      },
      {
        key: row.linkId,
        content: (
          <Button onClick={() => confirm([row.linkId])} isDisabled={busy} isLoading={pending.has(row.linkId)}>
            {t('suspects.confirm')}
          </Button>
        ),
      },
    ],
  }));
  const selectedIds = visible.filter((row) => selected.has(row.linkId)).map((row) => row.linkId);

  return (
    <Stack space="space.300">
      {suspects.loaded ? (
        <Text weight="medium">
          {t('suspects.count', { count: `${formatNumber(locale, suspects.rows.length)}${suspects.next ? '+' : ''}` })}
        </Text>
      ) : null}
      <TableToolbar
        query={query}
        onQueryChange={changeQuery}
        actions={(
          <>
            <Button appearance="primary" onClick={() => confirm(selectedIds)} isDisabled={busy || !selectedIds.length} isLoading={busy && pending.size > 1}>
              {t('suspects.confirmSelected', { count: formatNumber(locale, selectedIds.length) })}
            </Button>
            <ExportButton kind="suspects" projectKey={projectKey} payload={{ projectId }} />
          </>
        )}
      />
      {suspects.error ? <LoadError error={suspects.error} onRetry={suspects.reload} /> : null}
      {!suspects.loaded && !suspects.error ? <Flex justifyContent="center"><Spinner size="large" /></Flex> : null}
      {suspects.loaded ? (
        <DynamicTable
          head={head}
          rows={rows}
          isFixedSize
          emptyView={<Text color="color.text.subtle">{t('table.noMatches')}</Text>}
        />
      ) : null}
      {suspects.loaded ? <LoadMoreButton next={suspects.next} loading={suspects.loadingMore} onClick={suspects.loadMore} /> : null}
    </Stack>
  );
}
