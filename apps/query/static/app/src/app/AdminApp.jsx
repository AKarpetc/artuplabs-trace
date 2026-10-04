import { Box, Stack, xcss } from '@atlaskit/primitives';
import { AdminPanel } from '../admin/AdminPanel.jsx';
import { AppHeader } from '../components/AppHeader.jsx';
import { PageLayout } from '../components/PageLayout.jsx';
import { useT } from '../i18n/index.js';
import { AccessGate } from './AccessGate.jsx';

const pageStyles = xcss({ padding: 'space.300' });

/** Admin page: licence gate, the app header with the settings title, then the index settings (Jira administrators only). */
export function AdminApp() {
  const t = useT();
  return (
    <Box xcss={pageStyles}>
      <AccessGate>
        <PageLayout
          main={(
            <Stack space="space.400">
              <AppHeader subtitle={t('admin.title')} />
              <AdminPanel />
            </Stack>
          )}
        />
      </AccessGate>
    </Box>
  );
}
