import DynamicTable from '@atlaskit/dynamic-table';
import Button from '@atlaskit/button/new';
import IconButton from '@atlaskit/button/icon/button';
import Heading from '@atlaskit/heading';
import Lozenge from '@atlaskit/lozenge';
import { Box, Inline, Stack, Text, xcss } from '@atlaskit/primitives';
import { DeleteIcon, EditIcon } from '../components/icons.js';
import { formatDate, useLocale, useT } from '../i18n/index.js';
import { EmptyIllustration } from '../illustrations/EmptyIllustration.jsx';
import { TEMPLATE_GROUPS } from '../wizard/useTemplates.js';
import { canManage } from './useTemplateAdmin.js';

const FORMAT_APPEARANCE = { xlsx: 'success', docx: 'inprogress', pdf: 'moved' };
const COLUMNS = [['name', 29], ['format', 10], ['scope', 13], ['updated', 18], ['author', 20], ['actions', 10]];

const emptyStyles = xcss({
  padding: 'space.400',
  borderRadius: 'radius.large',
  backgroundColor: 'elevation.surface.raised',
  boxShadow: 'elevation.shadow.raised',
  minWidth: '0',
});
const emptyBodyStyles = xcss({ maxWidth: '480px', textAlign: 'center' });
const tableStyles = xcss({ minWidth: '0', overflowX: 'auto' });
const wrapStyles = xcss({ overflowWrap: 'anywhere', minWidth: '0' });

function scopeText(t, template) {
  if (template.scope === 'project') return template.scopeId;
  return t(`templates.scope.${template.scope}`);
}

function templateRow({ template, permitted, author, onEdit, onDelete, t, locale }) {
  const cell = (key, content) => ({ key: `${template.id}-${key}`, content });
  return {
    key: template.id,
    testId: `template-row-${template.id}`,
    cells: [
      cell('name', <Box xcss={wrapStyles}><Text weight="semibold">{template.name}</Text></Box>),
      cell('format', <Lozenge appearance={FORMAT_APPEARANCE[template.format] ?? 'default'}>{t(`format.${template.format}.title`)}</Lozenge>),
      cell('scope', <Box xcss={wrapStyles}><Text>{scopeText(t, template)}</Text></Box>),
      cell('updated', <Text>{formatDate(locale, template.updatedAt)}</Text>),
      cell('author', <Box xcss={wrapStyles}><Text>{author ?? ''}</Text></Box>),
      cell('actions', permitted ? (
        <Inline space="space.050" alignInline="end">
          <IconButton icon={EditIcon} label={t('templates.edit', { name: template.name })} appearance="subtle" spacing="compact" onClick={() => onEdit(template)} testId={`template-edit-${template.id}`} />
          <IconButton icon={DeleteIcon} label={t('templates.delete', { name: template.name })} appearance="subtle" spacing="compact" onClick={() => onDelete(template)} testId={`template-delete-${template.id}`} />
        </Inline>
      ) : null),
    ],
  };
}

function GroupTable({ group, templates, scopes, authors, onEdit, onDelete }) {
  const t = useT();
  const locale = useLocale();
  const collator = new Intl.Collator(locale);
  const head = { cells: COLUMNS.map(([key, width]) => ({ key, width, content: key === 'actions' ? '' : t(`templates.column.${key}`), isSortable: false })) };
  const rows = [...templates]
    .sort((a, b) => collator.compare(a.name, b.name))
    .map((template) => templateRow({ template, permitted: canManage(template, scopes), author: authors[template.authorId], onEdit, onDelete, t, locale }));
  const title = t(`template.group.${group}`);
  return (
    <Stack space="space.100" testId={`templates-group-${group}`}>
      <Heading size="small" as="h3">{title}</Heading>
      <Box xcss={tableStyles}>
        <DynamicTable head={head} rows={rows} label={title} testId={`templates-table-${group}`} />
      </Box>
    </Stack>
  );
}

/** Stored templates in one table per group (mine, project, site) with Edit and Delete where the caller may manage; an empty state offers the first template. */
export function TemplatesTable({ groups, scopes, authors, onEdit, onDelete, onCreate }) {
  const t = useT();
  const filled = TEMPLATE_GROUPS.filter((group) => groups[group].length > 0);
  if (filled.length === 0) {
    return (
      <Box xcss={emptyStyles} testId="templates-empty">
        <Stack space="space.300" alignInline="center">
          <EmptyIllustration size={160} />
          <Box xcss={emptyBodyStyles}><Text color="color.text.subtle">{t('templates.empty')}</Text></Box>
          <Button appearance="primary" onClick={onCreate} testId="templates-create-empty">{t('templates.create')}</Button>
        </Stack>
      </Box>
    );
  }
  return (
    <Stack space="space.400">
      {filled.map((group) => (
        <GroupTable key={group} group={group} templates={groups[group]} scopes={scopes} authors={authors} onEdit={onEdit} onDelete={onDelete} />
      ))}
    </Stack>
  );
}
