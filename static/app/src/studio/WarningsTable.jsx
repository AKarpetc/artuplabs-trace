import { useMemo, useState } from 'react';
import DynamicTable from '@atlaskit/dynamic-table';
import Heading from '@atlaskit/heading';
import Lozenge from '@atlaskit/lozenge';
import Select from '@atlaskit/select';
import { token } from '@atlaskit/tokens';
import { router } from '@forge/bridge';
import { Anchor, Box, Flex, Inline, Stack, Text, xcss } from '@atlaskit/primitives';
import { CheckCircleIcon } from '../components/icons.js';
import { useLocale, useT } from '../i18n/index.js';

const ALL = '';
const ROWS_PER_PAGE = 50;
const TONE = {
  'convert-failed': 'removed',
  'missing-attachment': 'moved',
  'attachment-too-large': 'moved',
  'unresolved-user': 'default',
};

const linkStyles = xcss({ overflowWrap: 'anywhere', color: 'color.link', textDecoration: 'none', ':hover': { textDecoration: 'underline' } });
const detailStyles = xcss({ fontFamily: 'font.family.code', fontSize: '12px', lineHeight: '20px', color: 'color.text.subtle', overflowWrap: 'anywhere' });
const filterStyles = xcss({ minWidth: '220px', maxWidth: '100%', flexGrow: 0 });
const tableStyles = xcss({ minWidth: '0', overflowX: 'auto' });

/** Confluence URL of a page in the exported space. */
export function pageUrl(siteUrl, spaceKey, pageId) {
  return `${siteUrl}/wiki/spaces/${spaceKey}/pages/${pageId}`;
}

function PageLink({ url, title }) {
  const open = (event) => {
    event.preventDefault();
    router.open(url);
  };
  return <Anchor href={url} onClick={open} xcss={linkStyles} testId="warning-page">{title}</Anchor>;
}

/** Report of converter and pipeline warnings: page link, kind lozenge, detail; filter by kind; sorted by page title. */
export function WarningsTable({ warnings, siteUrl, spaceKey }) {
  const t = useT();
  const locale = useLocale();
  const [kind, setKind] = useState(ALL);
  const sorted = useMemo(() => {
    const collator = new Intl.Collator(locale);
    return [...warnings].sort((a, b) => collator.compare(a.title, b.title) || collator.compare(a.kind, b.kind) || collator.compare(a.detail ?? '', b.detail ?? ''));
  }, [warnings, locale]);
  const counts = useMemo(() => sorted.reduce((map, w) => map.set(w.kind, (map.get(w.kind) ?? 0) + 1), new Map()), [sorted]);
  const kindLabel = (k) => t(`warnings.kind.${k}`);
  const options = [
    { value: ALL, label: `${t('warnings.filter.all')} (${sorted.length})` },
    ...[...counts].map(([k, count]) => ({ value: k, label: `${kindLabel(k)} (${count})` })),
  ];
  const visible = kind === ALL ? sorted : sorted.filter((w) => w.kind === kind);

  if (warnings.length === 0) {
    return (
      <Inline space="space.100" alignBlock="center" testId="warnings-none">
        <CheckCircleIcon label="" color={token('color.icon.success')} />
        <Text color="color.text.subtle">{t('warnings.none')}</Text>
      </Inline>
    );
  }

  const head = {
    cells: [
      { key: 'page', content: t('warnings.column.page'), width: 34 },
      { key: 'kind', content: t('warnings.column.kind'), width: 26 },
      { key: 'detail', content: t('warnings.column.detail'), width: 40 },
    ],
  };
  const rows = visible.map((w, index) => ({
    key: `${w.pageId}-${w.kind}-${index}`,
    cells: [
      { key: 'page', content: <PageLink url={pageUrl(siteUrl, spaceKey, w.pageId)} title={w.title} /> },
      { key: 'kind', content: <Lozenge appearance={TONE[w.kind] ?? 'default'} maxWidth="100%">{kindLabel(w.kind)}</Lozenge> },
      { key: 'detail', content: w.detail ? <Box xcss={detailStyles}>{w.detail}</Box> : null },
    ],
  }));

  return (
    <Stack space="space.200">
      <Flex justifyContent="space-between" alignItems="center" gap="space.200" wrap="wrap">
        <Heading size="small" as="h3">{t('warnings.title', { count: warnings.length })}</Heading>
        <Box xcss={filterStyles}>
          <Select
            aria-label={t('warnings.filter.label')}
            options={options}
            value={options.find((o) => o.value === kind) ?? options[0]}
            onChange={(option) => setKind(option?.value ?? ALL)}
            isSearchable={false}
            spacing="compact"
            menuPlacement="auto"
          />
        </Box>
      </Flex>
      <Box xcss={tableStyles}>
        <DynamicTable
          head={head}
          rows={rows}
          rowsPerPage={visible.length > ROWS_PER_PAGE ? ROWS_PER_PAGE : undefined}
          label={t('warnings.title', { count: warnings.length })}
          paginationi18n={{ prev: t('warnings.pagination.prev'), next: t('warnings.pagination.next'), label: t('warnings.pagination.label'), pageLabel: t('warnings.pagination.page') }}
          testId="warnings-table"
        />
      </Box>
    </Stack>
  );
}
