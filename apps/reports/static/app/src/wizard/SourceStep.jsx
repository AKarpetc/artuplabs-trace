import { ErrorMessage, Label } from '@atlaskit/form';
import Select from '@atlaskit/select';
import TextArea from '@atlaskit/textarea';
import { token } from '@atlaskit/tokens';
import { Box, Inline, Stack, Text, xcss } from '@atlaskit/primitives';
import { FilterIcon, PageIcon, TableIcon } from '../components/icons.js';
import { StepSection } from '../components/StepSection.jsx';
import { useT } from '../i18n/index.js';
import { useFilterSearch } from './useFilterSearch.js';

/** Id of the JQL field, so empty states can move focus to it. */
export const JQL_FIELD_ID = 'wizard-jql';

const ENTRY_ICON = { issue: PageIcon, sprint: TableIcon, board: TableIcon, jql: FilterIcon };

const cardStyles = xcss({
  padding: 'space.200',
  borderRadius: 'radius.large',
  backgroundColor: 'elevation.surface.raised',
  boxShadow: 'elevation.shadow.raised',
  minWidth: '0',
});
const iconStyles = xcss({ flexShrink: 0, lineHeight: '0' });
const textStyles = xcss({ minWidth: '0', flexGrow: 1 });
const codeStyles = xcss({
  fontFamily: 'font.family.code',
  fontSize: '12px',
  lineHeight: '20px',
  color: 'color.text.subtle',
  overflowWrap: 'anywhere',
  whiteSpace: 'pre-wrap',
});

/** What an entry exports, in words (issue key, sprint, board, selected issues, a saved filter or the current search). */
export function entryText(t, entry) {
  if (entry.selected) return t('source.entry.selected');
  if (entry.kind === 'jql' && entry.label) return t('source.entry.filter', { name: entry.label });
  if (entry.kind === 'issue') return t('source.entry.issue', { key: entry.key });
  if (entry.kind === 'sprint') return t('source.entry.sprint', { id: String(entry.sprintId) });
  if (entry.kind === 'board') return t('source.entry.board', { id: String(entry.boardId) });
  return t('source.entry.jql');
}

/** Card naming the issues an entry point brings (and its JQL for a search). */
export function EntrySummary({ entry }) {
  const t = useT();
  const Icon = ENTRY_ICON[entry.kind] ?? FilterIcon;
  return (
    <Box xcss={cardStyles} testId="entry-summary">
      <Inline space="space.150" alignBlock="start">
        <Box xcss={iconStyles}><Icon label="" color={token('color.icon.subtle')} /></Box>
        <Stack space="space.050" xcss={textStyles}>
          <Text weight="semibold">{entryText(t, entry)}</Text>
          {entry.kind === 'jql' ? <Box xcss={codeStyles}>{entry.jql}</Box> : null}
        </Stack>
      </Inline>
    </Box>
  );
}

/** Source step of the global page: saved-filter search (debounced) and the JQL field with Jira's errors under it. */
export function SourceStep({ number, form, client, jqlErrors }) {
  const t = useT();
  const search = useFilterSearch(client);
  const { jql, filter } = form.state;
  const options = search.filters.map((f) => ({ value: f.id, label: f.name, filter: f }));
  return (
    <StepSection number={number} title={t('source.title')} description={t('source.description')}>
      <Stack space="space.200">
        <Stack space="space.050">
          <Label htmlFor="wizard-filter">{t('source.filter')}</Label>
          <Select
            inputId="wizard-filter"
            options={options}
            value={filter ? { value: filter.id, label: filter.name, filter } : null}
            onChange={(option) => form.chooseFilter(option?.filter ?? null)}
            onInputChange={(text, meta) => {
              if (meta.action === 'input-change') search.setQuery(text);
            }}
            filterOption={null}
            isLoading={search.loading}
            isClearable
            placeholder={t('source.filterPlaceholder')}
            noOptionsMessage={() => t('source.noFilters')}
            loadingMessage={() => t('loading')}
            testId="wizard-filter"
          />
        </Stack>
        <Stack space="space.050">
          <Label htmlFor={JQL_FIELD_ID}>{t('source.jql')}</Label>
          <TextArea
            id={JQL_FIELD_ID}
            value={jql}
            onChange={(event) => form.setJql(event.currentTarget.value)}
            placeholder={t('source.jqlPlaceholder')}
            isInvalid={Boolean(jqlErrors?.length)}
            minimumRows={3}
            resize="vertical"
            isMonospaced
            testId="wizard-jql"
          />
          {(jqlErrors ?? []).map((message) => <ErrorMessage key={message} testId="wizard-jql-error">{message}</ErrorMessage>)}
        </Stack>
      </Stack>
    </StepSection>
  );
}
