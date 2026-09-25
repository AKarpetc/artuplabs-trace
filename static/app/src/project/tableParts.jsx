import Button from '@atlaskit/button/new';
import SectionMessage, { SectionMessageAction } from '@atlaskit/section-message';
import Textfield from '@atlaskit/textfield';
import { Box, Flex, xcss } from '@atlaskit/primitives';
import { errorMessage } from '../api.js';
import { useT } from '../i18n/index.js';

const wrapStyles = xcss({
  overflowWrap: 'anywhere',
  wordBreak: 'break-word',
  whiteSpace: 'normal',
  minWidth: '0',
});

const searchStyles = xcss({
  flexGrow: 1,
  maxWidth: '480px',
  minWidth: '200px',
});

/** Cell content that wraps long text (any script, emoji, unbroken strings) instead of widening the table. */
export function WrapText({ children }) {
  return <Box xcss={wrapStyles}>{children}</Box>;
}

/** Table toolbar: a search field on the left and action buttons on the right, wrapping on narrow screens. */
export function TableToolbar({ query, onQueryChange, actions }) {
  const t = useT();
  return (
    <Flex gap="space.200" justifyContent="space-between" alignItems="center" wrap="wrap">
      <Box xcss={searchStyles}>
        <Textfield
          aria-label={t('table.search')}
          placeholder={t('table.search')}
          value={query}
          onChange={(event) => onQueryChange(event.target.value)}
          isCompact={false}
        />
      </Box>
      <Flex gap="space.100" alignItems="center" wrap="wrap">{actions}</Flex>
    </Flex>
  );
}

/** "Load more" button shown while a next page exists; disabled with a spinner while the page is loading. */
export function LoadMoreButton({ next, loading, onClick }) {
  const t = useT();
  if (!next) {
    return null;
  }
  return (
    <Flex justifyContent="center">
      <Button onClick={onClick} isLoading={loading} isDisabled={loading}>{t('table.loadMore')}</Button>
    </Flex>
  );
}

/** Error banner for a failed load with a "Try again" action. */
export function LoadError({ error, onRetry }) {
  const t = useT();
  return (
    <SectionMessage
      appearance="error"
      actions={onRetry ? [<SectionMessageAction key="retry" onClick={onRetry}>{t('common.retry')}</SectionMessageAction>] : []}
    >
      {errorMessage(t, error)}
    </SectionMessage>
  );
}
