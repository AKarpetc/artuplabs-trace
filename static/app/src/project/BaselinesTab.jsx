import { useCallback, useEffect, useMemo, useState } from 'react';
import Button from '@atlaskit/button/new';
import DynamicTable from '@atlaskit/dynamic-table';
import { Label } from '@atlaskit/form';
import Heading from '@atlaskit/heading';
import Lozenge from '@atlaskit/lozenge';
import Select from '@atlaskit/select';
import Spinner from '@atlaskit/spinner';
import Textfield from '@atlaskit/textfield';
import { Box, Flex, Stack, Text, xcss } from '@atlaskit/primitives';
import { call, errorMessage } from '../api.js';
import { formatDate, formatNumber, useLocale, useT } from '../i18n/index.js';
import { useToasts } from '../components/Toasts.jsx';
import { BaselineDiff } from './BaselineDiff.jsx';
import { LoadError, WrapText } from './tableParts.jsx';

const STATUS_APPEARANCE = { complete: 'success', failed: 'removed', capturing: 'inprogress' };

const fieldStyles = xcss({ flexGrow: 1, minWidth: '240px', maxWidth: '480px' });

/** Baselines tab: create a named snapshot, list existing ones with their status, and compare two complete ones. */
export function BaselinesTab({ projectId, projectKey }) {
  const t = useT();
  const locale = useLocale();
  const { show } = useToasts();
  const [list, setList] = useState(null);
  const [listError, setListError] = useState(null);
  const [refreshing, setRefreshing] = useState(false);
  const [name, setName] = useState('');
  const [creating, setCreating] = useState(false);
  const [left, setLeft] = useState(null);
  const [right, setRight] = useState(null);
  const [compared, setCompared] = useState(null);

  const refresh = useCallback(async () => {
    setRefreshing(true);
    try {
      setList(await call('listBaselines', { projectId }));
      setListError(null);
    } catch (error) {
      setListError(error);
    } finally {
      setRefreshing(false);
    }
  }, [projectId]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const options = useMemo(() => (list ?? [])
    .filter((b) => b.status === 'complete')
    .map((b) => ({
      value: b.id,
      label: t('baselines.option', { name: b.name, date: formatDate(locale, b.createdAt), count: formatNumber(locale, b.memberCount) }),
    })), [list, t, locale]);

  useEffect(() => {
    const ids = new Set(options.map((o) => o.value));
    setLeft((prev) => (prev && !ids.has(prev.value) ? null : prev));
    setRight((prev) => (prev && !ids.has(prev.value) ? null : prev));
  }, [options]);

  async function create() {
    const clean = name.trim();
    if (!clean || creating) {
      return;
    }
    setCreating(true);
    try {
      await call('createBaseline', { projectId, name: clean });
      show({ title: t('baselines.created', { name: clean }), appearance: 'success' });
      setName('');
      await refresh();
    } catch (error) {
      show({ title: errorMessage(t, error), appearance: 'error' });
    } finally {
      setCreating(false);
    }
  }

  const canCompare = Boolean(left && right && left.value !== right.value);
  const head = {
    cells: [
      { key: 'name', content: t('baselines.name'), isSortable: true, width: 40 },
      { key: 'created', content: t('baselines.createdAt'), isSortable: true, width: 25 },
      { key: 'count', content: t('baselines.count'), isSortable: true, width: 15 },
      { key: 'status', content: t('baselines.status'), isSortable: true, width: 20 },
    ],
  };
  const rows = (list ?? []).map((b) => ({
    key: String(b.id),
    cells: [
      { key: b.name, content: <WrapText>{b.name}</WrapText> },
      { key: b.createdAt ?? '', content: formatDate(locale, b.createdAt) },
      { key: Number(b.memberCount) || 0, content: formatNumber(locale, Number(b.memberCount) || 0) },
      { key: b.status, content: <Lozenge appearance={STATUS_APPEARANCE[b.status] ?? 'default'}>{t(`baselines.status.${b.status}`)}</Lozenge> },
    ],
  }));

  return (
    <Stack space="space.400">
      <Stack space="space.200">
        <Flex gap="space.200" alignItems="end" wrap="wrap">
          <Box xcss={fieldStyles}>
            <Label htmlFor="baseline-name">{t('baselines.newName')}</Label>
            <Textfield
              id="baseline-name"
              value={name}
              maxLength={200}
              onChange={(event) => setName(event.target.value)}
              onKeyDown={(event) => { if (event.key === 'Enter') create(); }}
            />
          </Box>
          <Button appearance="primary" onClick={create} isDisabled={!name.trim() || creating} isLoading={creating}>{t('baselines.create')}</Button>
          <Button onClick={refresh} isDisabled={refreshing} isLoading={refreshing}>{t('baselines.refresh')}</Button>
        </Flex>
        {listError ? <LoadError error={listError} onRetry={refresh} /> : null}
        {list === null && !listError ? <Flex justifyContent="center"><Spinner size="large" /></Flex> : null}
        {list !== null ? (
          <DynamicTable
            head={head}
            rows={rows}
            isFixedSize
            emptyView={<Text color="color.text.subtle">{t('baselines.empty')}</Text>}
          />
        ) : null}
      </Stack>
      <Stack space="space.200">
        <Heading size="small">{t('baselines.compareTitle')}</Heading>
        <Flex gap="space.200" alignItems="end" wrap="wrap">
          <Box xcss={fieldStyles}>
            <Label htmlFor="baseline-left">{t('baselines.before')}</Label>
            <Select inputId="baseline-left" options={options} value={left} onChange={setLeft} />
          </Box>
          <Box xcss={fieldStyles}>
            <Label htmlFor="baseline-right">{t('baselines.after')}</Label>
            <Select inputId="baseline-right" options={options} value={right} onChange={setRight} />
          </Box>
          <Button
            appearance="primary"
            isDisabled={!canCompare}
            onClick={() => setCompared((prev) => ({ leftId: left.value, rightId: right.value, run: (prev?.run ?? 0) + 1 }))}
          >
            {t('baselines.compare')}
          </Button>
        </Flex>
        {compared ? (
          <BaselineDiff
            key={`${compared.leftId}:${compared.rightId}:${compared.run}`}
            projectId={projectId}
            projectKey={projectKey}
            leftId={compared.leftId}
            rightId={compared.rightId}
          />
        ) : null}
      </Stack>
    </Stack>
  );
}
