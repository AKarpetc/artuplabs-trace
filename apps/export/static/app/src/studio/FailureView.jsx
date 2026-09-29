import Button from '@atlaskit/button/new';
import EmptyState from '@atlaskit/empty-state';
import { Box } from '@atlaskit/primitives';
import { ExportSizeError } from '../export/errors.js';
import { formatBytes, useLocale, useT } from '../i18n/index.js';
import { EmptyIllustration } from '../illustrations/EmptyIllustration.jsx';
import { ConfluenceError } from '../infra/confluence.js';

const STATUS_KEYS = { 0: 'errors.network', 403: 'errors.forbidden', 404: 'errors.notFound' };

/** User-facing text for a failed export: Confluence statuses and size limits get translated sentences; anything else is generic with the message. */
export function runErrorMessage(t, error, locale = 'en-US') {
  if (error instanceof ExportSizeError) return t(error.kind === 'zip-limit' ? 'errors.zipLimit' : 'errors.tooLarge', { size: formatBytes(locale, error.bytes) });
  if (error instanceof ConfluenceError) return t(STATUS_KEYS[error.status] ?? 'errors.confluenceStatus', { status: String(error.status) });
  return t('errors.generic', { message: String(error?.message ?? error) });
}

/** Failed export: illustration, translated error and actions; a size error leads back to the options, with "Continue anyway" when allowed. */
export function FailureView({ error, onRetry, onBack, onContinue }) {
  const t = useT();
  const locale = useLocale();
  const sizeError = error instanceof ExportSizeError;
  const back = <Button appearance={sizeError ? 'primary' : 'default'} onClick={onBack}>{t('errors.back')}</Button>;
  const secondary = sizeError
    ? (error.kind === 'large' && onContinue ? <Button onClick={onContinue}>{t('errors.continueAnyway')}</Button> : undefined)
    : back;
  return (
    <Box testId="failure-view">
      <EmptyState
        header={runErrorMessage(t, error, locale)}
        renderImage={() => <EmptyIllustration size={160} />}
        primaryAction={sizeError ? back : <Button appearance="primary" onClick={onRetry}>{t('errors.tryAgain')}</Button>}
        secondaryAction={secondary}
        headingLevel={2}
      />
    </Box>
  );
}
