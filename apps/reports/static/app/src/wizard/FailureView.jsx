import Button from '@atlaskit/button/new';
import Heading from '@atlaskit/heading';
import SectionMessage from '@atlaskit/section-message';
import { Box, Inline, Stack, Text, xcss } from '@atlaskit/primitives';
import { AppError, errorMessage } from '../api.js';
import { ReportError } from '../export/errors.js';
import { useT } from '../i18n/index.js';
import { EmptyIllustration } from '../illustrations/EmptyIllustration.jsx';

const cardStyles = xcss({
  padding: 'space.400',
  borderRadius: 'radius.large',
  backgroundColor: 'elevation.surface.raised',
  boxShadow: 'elevation.shadow.raised',
  minWidth: '0',
});
const messageStyles = xcss({ overflowWrap: 'anywhere' });
const stateStyles = xcss({ maxWidth: '560px', marginInline: 'auto', textAlign: 'center' });

function StateCard({ testId, title, children, actions }) {
  return (
    <Box xcss={cardStyles} testId={testId}>
      <Stack space="space.300" alignInline="center" xcss={stateStyles}>
        <EmptyIllustration size={160} />
        <Heading size="medium" as="h2">{title}</Heading>
        {children}
        <Inline space="space.100" shouldWrap alignInline="center">{actions}</Inline>
      </Stack>
    </Box>
  );
}

/** One translated sentence for a failed export or preview: report codes, resolver codes, else the generic text with the message. */
export function runErrorMessage(t, error) {
  if (error instanceof ReportError) {
    switch (error.code) {
      case 'no-jql': return t('errors.noJql');
      case 'no-issues': return t('errors.noIssues');
      case 'too-many-for-document': return t('errors.tooMany', { count: error.data.count, max: error.data.max });
      case 'jql': return t('errors.jql');
      case 'template-missing': return t('errors.templateMissing');
      case 'network': return error.data.status ? t('errors.status', { status: String(error.data.status) }) : t('errors.offline');
      default: return t('errors.generic', { message: error.code });
    }
  }
  if (error instanceof AppError) return errorMessage(t, error);
  return t('errors.generic', { message: String(error?.message ?? error) });
}

/** Jira's own JQL messages, shown verbatim. */
export function JqlMessages({ error }) {
  const messages = error instanceof ReportError && error.code === 'jql' ? error.data.messages ?? [] : [];
  if (messages.length === 0) return null;
  return (
    <Stack space="space.050" testId="jql-messages">
      {messages.map((message) => <Box key={message} xcss={messageStyles}><Text color="color.text.subtle">{message}</Text></Box>)}
    </Stack>
  );
}

/** Failed export: illustration, one sentence and one action; too many issues for a document offers Excel instead. */
export function FailureView({ error, onRetry, onBack, onSwitchToExcel }) {
  const t = useT();
  const tooMany = error instanceof ReportError && error.code === 'too-many-for-document';
  const retryable = !(error instanceof ReportError) || ['network', 'template-missing'].includes(error.code);
  let primary = <Button appearance="primary" onClick={onBack} testId="failure-back">{t('errors.back')}</Button>;
  let secondary;
  if (tooMany) {
    primary = <Button appearance="primary" onClick={onSwitchToExcel} testId="failure-excel">{t('errors.switchToExcel')}</Button>;
    secondary = <Button onClick={onBack} testId="failure-back">{t('errors.back')}</Button>;
  } else if (retryable) {
    primary = <Button appearance="primary" onClick={onRetry} testId="failure-retry">{t('errors.tryAgain')}</Button>;
    secondary = <Button onClick={onBack} testId="failure-back">{t('errors.back')}</Button>;
  }
  return (
    <StateCard testId="failure-view" title={runErrorMessage(t, error)} actions={<>{primary}{secondary}</>}>
      <JqlMessages error={error} />
    </StateCard>
  );
}

/** Some batches failed after retries: counts, "Retry missing" (primary) and "Download partial file". */
export function IncompleteView({ outcome, onRetry, onPartial, onBack }) {
  const t = useT();
  return (
    <StateCard
      testId="incomplete-view"
      title={t('incomplete.title')}
      actions={(
        <>
          <Button appearance="primary" onClick={onRetry} testId="incomplete-retry">{t('incomplete.retry')}</Button>
          <Button onClick={onPartial} testId="incomplete-partial">{t('incomplete.partial')}</Button>
          <Button appearance="subtle" onClick={onBack} testId="incomplete-back">{t('errors.back')}</Button>
        </>
      )}
    >
      <Text weight="semibold" testId="incomplete-count">{t('incomplete.count', { done: outcome.done, count: outcome.total })}</Text>
      <Text color="color.text.subtle">{t('incomplete.hint')}</Text>
    </StateCard>
  );
}

/** Small in-place empty or error state: illustration, one sentence, one action. */
export function InlineState({ text, action, testId, tone = 'neutral' }) {
  const body = tone === 'error'
    ? <SectionMessage appearance="warning"><Text>{text}</Text></SectionMessage>
    : <Text color="color.text.subtle">{text}</Text>;
  return (
    <Inline space="space.200" alignBlock="center" shouldWrap testId={testId}>
      <EmptyIllustration size={64} />
      <Stack space="space.100" xcss={messageStyles}>
        {body}
        {action ? <Box>{action}</Box> : null}
      </Stack>
    </Inline>
  );
}
