import Heading from '@atlaskit/heading';
import Lozenge from '@atlaskit/lozenge';
import { Box, Flex, Inline, Stack, Text, xcss } from '@atlaskit/primitives';
import { useT } from '../i18n/index.js';
import { AppIcon } from '../illustrations/AppIcon.jsx';

const iconStyles = xcss({ flexShrink: 0, lineHeight: '0' });
const titleStyles = xcss({ minWidth: '0' });

/** App header: 32px mark, app name, optional scope lozenge and subtitle, right-aligned actions. */
export function AppHeader({ subtitle, scopeName, actions }) {
  const t = useT();
  return (
    <Flex justifyContent="space-between" alignItems="center" gap="space.200" wrap="wrap">
      <Inline space="space.150" alignBlock="center">
        <Box xcss={iconStyles}>
          <AppIcon size={32} />
        </Box>
        <Stack space="space.025" xcss={titleStyles}>
          <Inline space="space.100" alignBlock="center" shouldWrap>
            <Heading size="large">{t('app.title')}</Heading>
            {scopeName ? <Lozenge maxWidth={280}>{scopeName}</Lozenge> : null}
          </Inline>
          {subtitle ? <Text color="color.text.subtle">{subtitle}</Text> : null}
        </Stack>
      </Inline>
      {actions ? <Inline space="space.100" alignBlock="center" shouldWrap>{actions}</Inline> : null}
    </Flex>
  );
}
