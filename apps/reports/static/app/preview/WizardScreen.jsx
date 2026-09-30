import { Box, Stack, xcss } from '@atlaskit/primitives';
import { AccessGate } from '../src/app/AccessGate.jsx';
import { AppHeader } from '../src/components/AppHeader.jsx';
import { useT } from '../src/i18n/index.js';
import { Wizard } from '../src/wizard/Wizard.jsx';
import { previewParams } from './driver.js';

const pageStyles = xcss({ minHeight: '100vh', boxSizing: 'border-box', backgroundColor: 'elevation.surface', padding: 'space.300' });

const GLOBAL = { kind: 'none' };
const SEARCH = { kind: 'jql', jql: 'project = RPT ORDER BY key ASC' };
const ENTRIES = { form: GLOBAL, 'form-excel': GLOBAL };

function logSave(fileName, blob) {
  console.info('preview save', fileName, blob.size);
}

/** Wizard screen (`?screen=wizard&state=…`): the global page for the form states, a search entry for the run states. */
export function WizardScreen({ context }) {
  const t = useT();
  const { state } = previewParams();
  const entry = ENTRIES[state] ?? SEARCH;
  return (
    <Box xcss={pageStyles}>
      <AccessGate>
        <Stack space="space.400">
          <AppHeader subtitle={t('app.tagline')} scopeName={entry.kind === 'none' ? null : 'RPT'} />
          <Wizard entry={entry} context={{ siteUrl: 'https://preview.atlassian.net', ...context }} save={logSave} />
        </Stack>
      </AccessGate>
    </Box>
  );
}
