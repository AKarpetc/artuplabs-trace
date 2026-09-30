import { useState } from 'react';
import Badge from '@atlaskit/badge';
import Button from '@atlaskit/button/new';
import DynamicTable from '@atlaskit/dynamic-table';
import Heading from '@atlaskit/heading';
import { token } from '@atlaskit/tokens';
import { router } from '@forge/bridge';
import { Anchor, Box, Flex, Inline, Stack, Text, xcss } from '@atlaskit/primitives';
import { CheckCircleIcon, ChevronDownIcon, ChevronRightIcon } from '../components/icons.js';
import { useT } from '../i18n/index.js';
import { groupWarnings } from './progress.js';

/** Warning kinds the pipeline and the core emit; each has a translated name. */
export const WARNING_KINDS = [
  'adf-fallback', 'image-unresolved', 'image-external', 'image-missing', 'column-missing', 'issue-incomplete', 'issue-failed', 'pdf-emoji',
];

/** Detail rows per page inside one kind. */
export const WARNING_ROWS = 20;

const groupStyles = xcss({
  borderBlockStartWidth: 'border.width',
  borderBlockStartStyle: 'solid',
  borderBlockStartColor: 'color.border',
  paddingBlockStart: 'space.100',
});
const tableStyles = xcss({ minWidth: '0', overflowX: 'auto', paddingInlineStart: 'space.400' });
const detailStyles = xcss({ fontFamily: 'font.family.code', fontSize: '12px', lineHeight: '20px', color: 'color.text.subtle', overflowWrap: 'anywhere' });
const linkStyles = xcss({ color: 'color.link', textDecoration: 'none', overflowWrap: 'anywhere', ':hover': { textDecoration: 'underline' } });

function IssueLink({ siteUrl, issueKey }) {
  if (!issueKey) return null;
  const url = `${siteUrl}/browse/${issueKey}`;
  const open = (event) => {
    event.preventDefault();
    router.open(url);
  };
  return <Anchor href={url} onClick={open} xcss={linkStyles}>{issueKey}</Anchor>;
}

function KindGroup({ kind, items, siteUrl }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const name = t(`warnings.kind.${kind}`);
  const withIssues = items.some((warning) => warning.issueKey);
  const head = {
    cells: [
      ...(withIssues ? [{ key: 'issue', content: t('warnings.column.issue'), width: 20 }] : []),
      { key: 'detail', content: t('warnings.column.detail'), width: withIssues ? 80 : 100 },
    ],
  };
  const rows = items.map((warning, index) => ({
    key: `${kind}-${index}`,
    cells: [
      ...(withIssues ? [{ key: 'issue', content: <IssueLink siteUrl={siteUrl} issueKey={warning.issueKey} /> }] : []),
      { key: 'detail', content: warning.detail ? <Box xcss={detailStyles}>{warning.detail}</Box> : null },
    ],
  }));
  return (
    <Stack space="space.100" xcss={groupStyles} testId={`warnings-${kind}`}>
      <Box>
        <Button
          appearance="subtle"
          iconBefore={open ? ChevronDownIcon : ChevronRightIcon}
          onClick={() => setOpen(!open)}
          aria-expanded={open}
          testId={`warnings-toggle-${kind}`}
        >
          <Inline space="space.100" alignBlock="center">
            <Text>{name}</Text>
            <Badge>{items.length}</Badge>
          </Inline>
        </Button>
      </Box>
      {open ? (
        <Box xcss={tableStyles}>
          <DynamicTable
            head={head}
            rows={rows}
            rowsPerPage={items.length > WARNING_ROWS ? WARNING_ROWS : undefined}
            label={name}
            paginationi18n={{ prev: t('warnings.pagination.prev'), next: t('warnings.pagination.next'), label: t('warnings.pagination.label'), pageLabel: t('warnings.pagination.page') }}
            testId={`warnings-table-${kind}`}
          />
        </Box>
      ) : null}
    </Stack>
  );
}

/** Warnings grouped by kind: translated name and count per kind, expandable to issue key and detail, 20 rows per page. */
export function WarningsTable({ warnings, siteUrl }) {
  const t = useT();
  if (warnings.length === 0) {
    return (
      <Inline space="space.100" alignBlock="center" testId="warnings-none">
        <CheckCircleIcon label="" color={token('color.icon.success')} />
        <Text color="color.text.subtle">{t('warnings.none')}</Text>
      </Inline>
    );
  }
  return (
    <Stack space="space.150" testId="warnings">
      <Flex justifyContent="space-between" alignItems="center" gap="space.200" wrap="wrap">
        <Heading size="small" as="h3">{t('warnings.title', { count: warnings.length })}</Heading>
      </Flex>
      {groupWarnings(warnings).map((group) => <KindGroup key={group.kind} kind={group.kind} items={group.items} siteUrl={siteUrl} />)}
    </Stack>
  );
}
