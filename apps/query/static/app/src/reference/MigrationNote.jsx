import SectionMessage from '@atlaskit/section-message';
import { Stack, Text } from '@atlaskit/primitives';
import { useT } from '../i18n/index.js';

/** How ScriptRunner filters map to ArtUp Query, and how dates and work time are read. */
export function MigrationNote() {
  const t = useT();
  return (
    <SectionMessage appearance="information" title={t('reference.migrationTitle')}>
      <Stack space="space.100">
        <Text>{t('reference.migrationBody')}</Text>
        <Text>{t('reference.timeNote')}</Text>
      </Stack>
    </SectionMessage>
  );
}
