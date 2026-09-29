import { useEffect, useState } from 'react';
import Button from '@atlaskit/button/new';
import { Label } from '@atlaskit/form';
import SectionMessage from '@atlaskit/section-message';
import Select from '@atlaskit/select';
import Spinner from '@atlaskit/spinner';
import { Box, Flex, Stack, Text, xcss } from '@atlaskit/primitives';
import { call, errorMessage } from '../api.js';
import { useT } from '../i18n/index.js';
import { useToasts } from '../components/Toasts.jsx';

const VALIDATION_KEYS = {
  'Choose at least one requirement issue type.': 'settings.errors.noReqTypes',
  'Choose at least one verification issue type.': 'settings.errors.noVerTypes',
  'An issue type cannot be both requirement and verification.': 'settings.errors.overlap',
  'Issue type and link type ids must be numeric Jira ids.': 'settings.errors.badIds',
  'Fingerprint fields must include summary.': 'settings.errors.fingerprint',
};

const FIELDS = [
  { key: 'requirementTypeIds', label: 'settings.reqTypes', source: 'types' },
  { key: 'verificationTypeIds', label: 'settings.verTypes', source: 'types' },
  { key: 'linkTypeIds', label: 'settings.linkTypes', source: 'linkTypes' },
];

const formStyles = xcss({ maxWidth: '720px' });

/** Settings tab: requirement, verification and link types for the project; `onSaved` runs after a successful save. */
export function SettingsTab({ projectId, onSaved }) {
  const t = useT();
  const { show } = useToasts();
  const [data, setData] = useState(null);
  const [config, setConfig] = useState(null);
  const [loadError, setLoadError] = useState(null);
  const [errors, setErrors] = useState([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let active = true;
    Promise.all([
      call('getIssueTypes', { projectId }),
      call('getLinkTypes', { projectId }),
      call('getSettings', { projectId }),
    ]).then(([types, linkTypes, settings]) => {
      if (active) {
        setData({ types, linkTypes });
        setConfig(settings);
      }
    }).catch((error) => {
      if (active) {
        setLoadError(error);
      }
    });
    return () => {
      active = false;
    };
  }, [projectId]);

  if (loadError) {
    return <SectionMessage appearance="warning">{errorMessage(t, loadError)}</SectionMessage>;
  }
  if (!config) {
    return <Flex justifyContent="center"><Spinner size="large" /></Flex>;
  }

  const optionsOf = (list) => list.map((item) => ({ label: item.name, value: item.id }));
  const pick = (list, ids) => optionsOf(list).filter((option) => (ids ?? []).includes(option.value));

  async function save() {
    if (saving) {
      return;
    }
    setSaving(true);
    try {
      const res = await call('saveSettings', { projectId, config });
      const found = res?.errors ?? [];
      setErrors(found.map((message) => (VALIDATION_KEYS[message] ? t(VALIDATION_KEYS[message]) : message)));
      if (!found.length) {
        show({ title: t('settings.saved'), appearance: 'success' });
        onSaved?.();
      }
    } catch (error) {
      setErrors([errorMessage(t, error)]);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Box xcss={formStyles}>
      <Stack space="space.300">
        {errors.length ? (
          <SectionMessage appearance="error">
            <Stack space="space.050">
              {errors.map((message) => <Text key={message}>{message}</Text>)}
            </Stack>
          </SectionMessage>
        ) : null}
        {FIELDS.map((field) => (
          <Stack key={field.key} space="space.050">
            <Label htmlFor={`settings-${field.key}`}>{t(field.label)}</Label>
            <Select
              inputId={`settings-${field.key}`}
              isMulti
              menuPlacement="auto"
              noOptionsMessage={() => t('common.noOptions')}
              options={optionsOf(data[field.source])}
              value={pick(data[field.source], config[field.key])}
              onChange={(selected) => setConfig((prev) => ({ ...prev, [field.key]: (selected ?? []).map((s) => s.value) }))}
            />
          </Stack>
        ))}
        <Text color="color.text.subtle">{t('settings.fingerprintNote')}</Text>
        <Flex>
          <Button appearance="primary" onClick={save} isDisabled={saving} isLoading={saving}>{t('settings.save')}</Button>
        </Flex>
      </Stack>
    </Box>
  );
}
