import { useCallback, useId } from 'react';
import { Label } from '@atlaskit/form';
import { Box, Stack, Text, xcss } from '@atlaskit/primitives';
import { AsyncSelect } from '@atlaskit/select';
import { useT } from '../i18n/index.js';

const titleStyles = xcss({ overflowWrap: 'anywhere' });

const toOption = (page) => ({ value: page.id, label: page.title, page });
const trail = (page) => (page?.ancestors ?? []).join(' / ');

function OptionLabel(option, { context }) {
  const path = trail(option.page);
  if (context !== 'menu') return option.label;
  return (
    <Stack space="space.025">
      <Box xcss={titleStyles} testId="picker-option-title">{option.label}</Box>
      {path ? <Text size="small" color="color.text.subtlest">{path}</Text> : null}
    </Stack>
  );
}

/** Async page search in the current space; the chosen page shows its breadcrumb path below the field. */
export function PagePicker({ client, spaceKey, value, onChange }) {
  const t = useT();
  const id = useId();
  const load = useCallback(async (input) => {
    const text = input.trim();
    if (!text) return [];
    try {
      return (await client.searchPages(spaceKey, text)).map(toOption);
    } catch {
      return [];
    }
  }, [client, spaceKey]);
  const path = trail(value);
  return (
    <Stack space="space.050">
      <Label htmlFor={id}>{t('picker.label')}</Label>
      <AsyncSelect
        inputId={id}
        cacheOptions
        loadOptions={load}
        value={value ? toOption(value) : null}
        onChange={(option) => onChange(option?.page ?? null)}
        formatOptionLabel={OptionLabel}
        placeholder={t('picker.placeholder')}
        noOptionsMessage={({ inputValue }) => (inputValue.trim() ? t('picker.noResults') : t('picker.placeholder'))}
        loadingMessage={() => t('loading')}
        isClearable
      />
      {path ? <Text size="small" color="color.text.subtle">{`${path} / ${value.title}`}</Text> : null}
    </Stack>
  );
}
