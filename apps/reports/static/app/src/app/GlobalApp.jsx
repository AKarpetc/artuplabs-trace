import Heading from '@atlaskit/heading';
import SectionMessage from '@atlaskit/section-message';
import { Box, Stack } from '@atlaskit/primitives';
import { useI18n } from '../i18n/index.js';

/** Development shell for the global module; shows the module context outside production. */
export function GlobalApp({ context }) {
  const { t } = useI18n();
  return (
    <Box padding="space.300">
      <Stack space="space.300">
        <Heading size="large">{t('app.title')}</Heading>
        {context.environmentType !== 'PRODUCTION' && (
          <SectionMessage title={t('dev.context')}>
            <pre>{JSON.stringify(context.extension, null, 2)}</pre>
          </SectionMessage>
        )}
      </Stack>
    </Box>
  );
}
