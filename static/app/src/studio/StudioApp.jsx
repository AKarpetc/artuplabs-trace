import Heading from '@atlaskit/heading';
import { Box } from '@atlaskit/primitives';
import { useT } from '../i18n/index.js';

/** Placeholder ArtUp Export space page shell; replaced by the real studio in later tasks. */
export function StudioApp({ context }) {
  const t = useT();
  return (
    <Box padding="space.300">
      <Heading size="large">{t('app.name')}</Heading>
    </Box>
  );
}
