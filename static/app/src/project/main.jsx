import { createRoot } from 'react-dom/client';
import '@atlaskit/css-reset';
import { Box } from '@atlaskit/primitives';
import { bootstrap } from '../theme';
import { I18nProvider, resolveLocale } from '../i18n/index.js';
import { ToastProvider } from '../components/Toasts.jsx';
import { ProjectApp } from './ProjectApp.jsx';

async function main() {
  const { context } = await bootstrap();
  const project = context.extension?.project ?? {};
  const root = createRoot(document.getElementById('root'));
  root.render(
    <I18nProvider locale={resolveLocale(context.locale)}>
      <ToastProvider>
        <Box padding="space.300">
          <ProjectApp projectId={String(project.id ?? '')} projectKey={project.key ?? ''} />
        </Box>
      </ToastProvider>
    </I18nProvider>,
  );
}

main();
