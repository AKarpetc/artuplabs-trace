import Heading from '@atlaskit/heading';
import { Box, Flex, Stack } from '@atlaskit/primitives';

/**
 * A page section: a heading with an optional right-aligned actions row,
 * followed by its content.
 */
export function PageSection({ title, actions, children }) {
  return (
    <Stack space="space.200">
      <Flex justifyContent="space-between" alignItems="center" gap="space.200">
        <Heading size="medium">{title}</Heading>
        {actions ? <Flex gap="space.100" alignItems="center">{actions}</Flex> : null}
      </Flex>
      {children ? <Box>{children}</Box> : null}
    </Stack>
  );
}
