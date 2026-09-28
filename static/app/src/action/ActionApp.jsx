import Heading from '@atlaskit/heading';
import { Box } from '@atlaskit/primitives';
import { useT } from '../i18n/index.js';

/** Placeholder ArtUp Export content action shell; replaced by the real flow in later tasks. */
export function ActionApp({ context }) {
  const t = useT();
  return (
    <Box padding="space.300">
      <Heading size="large">{t('app.name')}</Heading>
    </Box>
  );
}
