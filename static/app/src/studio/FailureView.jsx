import Button from '@atlaskit/button/new';
import EmptyState from '@atlaskit/empty-state';
import { Box } from '@atlaskit/primitives';
import { useT } from '../i18n/index.js';
import { EmptyIllustration } from '../illustrations/EmptyIllustration.jsx';
import { ConfluenceError } from '../infra/confluence.js';

/** User-facing text for a failed export: 403 → forbidden, status 0 → network, anything else → generic with the message. */
export function runErrorMessage(t, error) {
  if (error instanceof ConfluenceError && error.status === 403) return t('errors.forbidden');
  if (error instanceof ConfluenceError && error.status === 0) return t('errors.network');
  return t('errors.generic', { message: String(error?.message ?? error) });
}

/** Failed export: illustration, translated error, "Try again" and "Back". */
export function FailureView({ error, onRetry, onBack }) {
  const t = useT();
  return (
    <Box testId="failure-view">
      <EmptyState
        header={runErrorMessage(t, error)}
        renderImage={() => <EmptyIllustration size={160} />}
        primaryAction={<Button appearance="primary" onClick={onRetry}>{t('errors.tryAgain')}</Button>}
        secondaryAction={<Button onClick={onBack}>{t('errors.back')}</Button>}
        headingLevel={2}
      />
    </Box>
  );
}
