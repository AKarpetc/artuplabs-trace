import { Box, Stack, xcss } from '@atlaskit/primitives';
import { AccessGate } from '../src/app/AccessGate.jsx';
import { AppHeader } from '../src/components/AppHeader.jsx';
import { useT } from '../src/i18n/index.js';
import { TemplatesTab } from '../src/templates/TemplatesTab.jsx';

const pageStyles = xcss({ minHeight: '100vh', boxSizing: 'border-box', backgroundColor: 'elevation.surface', padding: 'space.300' });

function logSave(fileName, blob) {
  console.info('preview save', fileName, blob.size);
}

/** Templates screen (`?screen=templates&state=…`): the tab behind the access gate, in the states the driver reaches by clicking. */
export function TemplatesScreen() {
  const t = useT();
  return (
    <Box xcss={pageStyles}>
      <AccessGate>
        <Stack space="space.400">
          <AppHeader subtitle={t('app.tagline')} />
          <TemplatesTab save={logSave} />
        </Stack>
      </AccessGate>
    </Box>
  );
}
