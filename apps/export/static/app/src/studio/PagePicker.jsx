import { useCallback, useEffect, useId, useRef, useState } from 'react';
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

/** Async page search in the current space (only the latest request counts, a failed search says so); the chosen page shows its breadcrumb path below the field. */
export function PagePicker({ createClient, spaceKey, value, onChange }) {
  const t = useT();
  const id = useId();
  const latest = useRef({ request: 0, controller: null });
  const [failed, setFailed] = useState(false);
  useEffect(() => () => latest.current.controller?.abort(), []);
  const load = useCallback(async (input) => {
    const text = input.trim();
    latest.current.controller?.abort();
    latest.current.request += 1;
    const request = latest.current.request;
    const controller = new AbortController();
    latest.current.controller = controller;
    if (!text) return [];
    try {
      const results = await createClient({ signal: controller.signal }).searchPages(spaceKey, text);
      if (request !== latest.current.request) return [];
      setFailed(false);
      return results.map(toOption);
    } catch {
      if (request === latest.current.request && !controller.signal.aborted) setFailed(true);
      return [];
    }
  }, [createClient, spaceKey]);
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
        noOptionsMessage={({ inputValue }) => {
          if (!inputValue.trim()) return t('picker.placeholder');
          return failed ? t('picker.searchError') : t('picker.noResults');
        }}
        loadingMessage={() => t('loading')}
        isClearable
      />
      {path ? <Text size="small" color="color.text.subtle">{`${path} / ${value.title}`}</Text> : null}
    </Stack>
  );
}
