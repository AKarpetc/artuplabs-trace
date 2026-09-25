import { createRoot } from 'react-dom/client';
import '@atlaskit/css-reset';
import { Box } from '@atlaskit/primitives';
import Heading from '@atlaskit/heading';
import { bootstrap } from '../theme';
import { I18nProvider, resolveLocale, useT } from '../i18n/index.js';

/** Placeholder ArtUp Trace issue panel shell, full width with themed padding. */
export function IssueApp({ context }) {
  const t = useT();
  return (
    <Box padding="space.300">
      <Heading size="medium">{t('app.title')}</Heading>
    </Box>
  );
}

async function main() {
  const { context } = await bootstrap();
  const root = createRoot(document.getElementById('root'));
  root.render(
    <I18nProvider locale={resolveLocale(context.locale)}>
      <IssueApp context={context} />
    </I18nProvider>,
  );
}

main();
