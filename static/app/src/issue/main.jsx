import { createRoot } from 'react-dom/client';
import '@atlaskit/css-reset';
import { Box } from '@atlaskit/primitives';
import { bootstrap } from '../theme';
import { I18nProvider, resolveLocale } from '../i18n/index.js';
import { ToastProvider } from '../components/Toasts.jsx';
import { IssueApp } from './IssueApp.jsx';

async function main() {
  const { context } = await bootstrap();
  const issue = context.extension?.issue ?? {};
  const project = context.extension?.project ?? {};
  const root = createRoot(document.getElementById('root'));
  root.render(
    <I18nProvider locale={resolveLocale(context.locale)}>
      <ToastProvider>
        <Box padding="space.200">
          <IssueApp issueId={String(issue.id ?? '')} projectId={String(project.id ?? '')} />
        </Box>
      </ToastProvider>
    </I18nProvider>,
  );
}

main();
