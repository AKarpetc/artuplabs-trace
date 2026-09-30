import { useEffect, useRef, useState } from 'react';
import IconButton from '@atlaskit/button/icon/button';
import { Fieldset, Label } from '@atlaskit/form';
import Lozenge from '@atlaskit/lozenge';
import { combine } from '@atlaskit/pragmatic-drag-and-drop/combine';
import { draggable, dropTargetForElements } from '@atlaskit/pragmatic-drag-and-drop/element/adapter';
import { Box, Grid, Inline, Stack, Text, xcss } from '@atlaskit/primitives';
import { RadioGroup } from '@atlaskit/radio';
import Select from '@atlaskit/select';
import Toggle from '@atlaskit/toggle';
import { token } from '@atlaskit/tokens';
import { ROW_MODES } from '../core/columns.js';
import { DeleteIcon, DragHandleIcon } from '../components/icons.js';
import { useLocale, useT } from '../i18n/index.js';
import { columnName, columnOptions, groupByOptions } from './columnOptions.js';

const DRAG_TYPE = 'artup-reports-column';

const listStyles = xcss({ margin: 'space.0', padding: 'space.0', listStyle: 'none' });
const itemStyles = xcss({
  display: 'flex',
  alignItems: 'center',
  gap: 'space.100',
  paddingBlock: 'space.050',
  paddingInlineStart: 'space.050',
  paddingInlineEnd: 'space.050',
  borderWidth: 'border.width',
  borderStyle: 'solid',
  borderColor: 'color.border',
  borderRadius: 'radius.medium',
  backgroundColor: 'elevation.surface',
  outline: 'none',
  ':focus-visible': {
    outlineWidth: 'border.width.focused',
    outlineStyle: 'solid',
    outlineColor: 'color.border.focused',
  },
});
const overStyles = xcss({ borderColor: 'color.border.selected', backgroundColor: 'color.background.selected' });
const draggingStyles = xcss({ opacity: 'opacity.disabled' });
const handleStyles = xcss({ cursor: 'grab', lineHeight: '0', flexShrink: 0, padding: 'space.050' });
const indexStyles = xcss({ minWidth: '24px', flexShrink: 0, textAlign: 'end', color: 'color.text.subtlest', font: 'font.body.small' });
const nameStyles = xcss({ minWidth: '0', flexGrow: 1, overflowWrap: 'anywhere' });
const liveStyles = xcss({
  position: 'absolute',
  width: '1px',
  height: '1px',
  overflow: 'hidden',
  clipPath: 'inset(50%)',
  whiteSpace: 'nowrap',
});
const settingsStyles = xcss({ minWidth: '0' });

function ColumnItem({ refName, name, missing, index, total, onMove, onRemove, onKeyDown, itemRef }) {
  const t = useT();
  const handleRef = useRef(null);
  const [over, setOver] = useState(false);
  const [dragging, setDragging] = useState(false);
  useEffect(() => {
    const element = itemRef.current;
    const handle = handleRef.current;
    if (!element || !handle) return undefined;
    return combine(
      draggable({
        element,
        dragHandle: handle,
        getInitialData: () => ({ type: DRAG_TYPE, index }),
        onDragStart: () => setDragging(true),
        onDrop: () => setDragging(false),
      }),
      dropTargetForElements({
        element,
        canDrop: ({ source }) => source.data.type === DRAG_TYPE,
        getData: () => ({ index }),
        onDragEnter: () => setOver(true),
        onDragLeave: () => setOver(false),
        onDrop: ({ source }) => {
          setOver(false);
          onMove(source.data.index, index);
        },
      }),
    );
  }, [index, onMove, itemRef]);
  return (
    <Box
      as="li"
      ref={itemRef}
      tabIndex={0}
      aria-label={t('columns.item', { name, position: index + 1, total })}
      aria-describedby="wizard-columns-hint"
      onKeyDown={onKeyDown}
      xcss={[itemStyles, over && overStyles, dragging && draggingStyles]}
      testId={`column-${refName}`}
    >
      <Box ref={handleRef} xcss={handleStyles} aria-hidden="true" testId={`column-handle-${refName}`}>
        <DragHandleIcon label="" color={token('color.icon.subtle')} />
      </Box>
      <Box xcss={indexStyles} aria-hidden="true">{index + 1}</Box>
      <Box xcss={nameStyles}>
        <Inline space="space.100" alignBlock="center" shouldWrap>
          <Text>{name}</Text>
          {missing ? <Lozenge appearance="moved">{t('columns.missing')}</Lozenge> : null}
        </Inline>
      </Box>
      <IconButton icon={DeleteIcon} label={t('columns.remove', { name })} appearance="subtle" spacing="compact" onClick={onRemove} testId={`column-remove-${refName}`} />
    </Box>
  );
}

/**
 * Excel columns editor: row mode, group-by, summary sheet, an add-column select over the catalog and the chosen columns,
 * reordered by drag handle or Alt+↑/↓ (announced) and removed per column.
 */
export function ColumnsEditor({
  columns, rowMode, groupBy, summary, catalog, catalogLoading = false, labels, onAdd, onRemove, onMove, onRowMode, onGroupBy, onSummary,
}) {
  const t = useT();
  const locale = useLocale();
  const items = useRef(new Map());
  const [focusRef, setFocusRef] = useState(null);
  const [announcement, setAnnouncement] = useState('');
  const named = columns.map((ref) => ({ ref, ...columnName(catalog, ref, labels) }));

  useEffect(() => {
    if (focusRef === null) return;
    items.current.get(focusRef)?.current?.focus();
    setFocusRef(null);
  }, [focusRef, columns]);

  const refFor = (ref) => {
    if (!items.current.has(ref)) items.current.set(ref, { current: null });
    return items.current.get(ref);
  };

  const move = (from, to) => {
    if (to < 0 || to >= columns.length || from === to) return;
    onMove(from, to);
    setFocusRef(columns[from]);
    setAnnouncement(t('columns.moved', { name: named[from].name, position: to + 1, total: columns.length }));
  };

  const onItemKey = (index) => (event) => {
    if (!event.altKey || (event.key !== 'ArrowUp' && event.key !== 'ArrowDown')) return;
    event.preventDefault();
    move(index, event.key === 'ArrowUp' ? index - 1 : index + 1);
  };

  const remove = (index) => {
    onRemove(index);
    setAnnouncement(t('columns.removed', { name: named[index].name }));
    const next = columns[index + 1] ?? columns[index - 1];
    if (next) setFocusRef(next);
  };

  const addOptions = columnOptions({
    catalog, rowMode, chosen: columns, labels, locale, groupLabels: { row: t('columns.group.row'), fields: t('columns.group.fields') },
  });
  const groupOptions = [{ value: '', label: t('groupBy.none') }, ...groupByOptions(catalog, locale)];
  const groupValue = groupOptions.find((option) => option.value === (groupBy ?? '')) ?? { value: groupBy, label: columnName(catalog, groupBy, labels).name };

  return (
    <Stack space="space.300">
      <Grid gap="space.300" templateColumns="repeat(auto-fit, minmax(220px, 1fr))" alignItems="start">
        <Box xcss={settingsStyles}>
          <Fieldset legend={t('rowMode.label')}>
            <RadioGroup
              name="rowMode"
              value={rowMode}
              options={ROW_MODES.map((mode) => ({ name: 'rowMode', value: mode, label: t(`rowMode.${mode}`), testId: `row-mode-${mode}` }))}
              onChange={(event) => onRowMode(event.currentTarget.value)}
            />
          </Fieldset>
        </Box>
        <Stack space="space.050" xcss={settingsStyles}>
          <Label htmlFor="wizard-group-by">{t('groupBy.label')}</Label>
          <Select
            inputId="wizard-group-by"
            options={groupOptions}
            value={groupValue}
            onChange={(option) => onGroupBy(option?.value ? option.value : null)}
            isLoading={catalogLoading}
            loadingMessage={() => t('loading')}
            noOptionsMessage={() => t('columns.noMatch')}
            testId="wizard-group-by"
          />
        </Stack>
        <Stack space="space.050" xcss={settingsStyles}>
          <Label htmlFor="wizard-summary">{t('summarySheet.label')}</Label>
          <Inline space="space.100" alignBlock="center">
            <Toggle id="wizard-summary" isChecked={summary} onChange={(event) => onSummary(event.currentTarget.checked)} testId="wizard-summary" />
          </Inline>
          <Text size="small" color="color.text.subtle">{t('summarySheet.help')}</Text>
        </Stack>
      </Grid>
      <Stack space="space.100">
        <Label htmlFor="wizard-add-column">{t('columns.add')}</Label>
        <Select
          inputId="wizard-add-column"
          options={addOptions}
          value={null}
          onChange={(option) => option && onAdd(option.value)}
          placeholder={t('columns.addPlaceholder')}
          isLoading={catalogLoading}
          loadingMessage={() => t('loading')}
          noOptionsMessage={() => t('columns.noMatch')}
          testId="wizard-add-column"
        />
        <Text size="small" color="color.text.subtle" id="wizard-columns-hint">{t('columns.hint')}</Text>
        {named.length === 0 ? (
          <Text color="color.text.danger" testId="columns-empty">{t('columns.empty')}</Text>
        ) : (
          <Box as="ol" xcss={listStyles} aria-label={t('columns.title')} testId="columns-list">
            <Stack space="space.050">
              {named.map((column, index) => (
                <ColumnItem
                  key={column.ref}
                  refName={column.ref}
                  name={column.name}
                  missing={column.missing}
                  index={index}
                  total={named.length}
                  onMove={move}
                  onRemove={() => remove(index)}
                  onKeyDown={onItemKey(index)}
                  itemRef={refFor(column.ref)}
                />
              ))}
            </Stack>
          </Box>
        )}
        <Box xcss={liveStyles} aria-live="polite" role="status" testId="columns-live">{announcement}</Box>
      </Stack>
    </Stack>
  );
}
