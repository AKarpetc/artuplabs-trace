import Heading from '@atlaskit/heading';
import { Box, Inline, Stack, Text, xcss } from '@atlaskit/primitives';

const badgeStyles = xcss({
  width: '24px',
  height: '24px',
  flexShrink: 0,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  borderRadius: 'radius.full',
  backgroundColor: 'color.background.brand.bold',
  color: 'color.text.inverse',
  font: 'font.body.small',
  fontWeight: 'font.weight.bold',
});
const titleStyles = xcss({ minWidth: '0', flexGrow: 1 });
const indentStyles = xcss({
  '@media (min-width: 30rem)': { paddingInlineStart: 'space.400' },
});

/** Numbered step: a round brand badge, a small heading, a subtle description and the step content. */
export function StepSection({ number, title, description, children }) {
  return (
    <Stack as="section" space="space.200">
      <Stack space="space.050">
        <Inline space="space.100" alignBlock="center">
          <Box xcss={badgeStyles} aria-hidden="true">{number}</Box>
          <Box xcss={titleStyles}>
            <Heading size="small">{title}</Heading>
          </Box>
        </Inline>
        {description ? (
          <Box xcss={indentStyles}>
            <Text color="color.text.subtle">{description}</Text>
          </Box>
        ) : null}
      </Stack>
      {children ? <Box xcss={indentStyles}>{children}</Box> : null}
    </Stack>
  );
}
