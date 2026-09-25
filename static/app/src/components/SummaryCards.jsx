import Heading from '@atlaskit/heading';
import { Box, Grid, Stack, Text } from '@atlaskit/primitives';
import { token } from '@atlaskit/tokens';

const APPEARANCE_COLOR = {
  success: 'color.text.success',
  warning: 'color.text.warning',
  danger: 'color.text.danger',
};

/**
 * Responsive grid of summary metric cards; each card's `appearance` tints
 * its label and value with an Atlaskit text-color token.
 */
export function SummaryCards({ items }) {
  return (
    <Grid gap="space.200" templateColumns="repeat(auto-fit, minmax(180px, 1fr))">
      {items.map((item, index) => {
        const colorToken = APPEARANCE_COLOR[item.appearance];
        return (
          <Box
            key={`${item.label}-${index}`}
            backgroundColor="elevation.surface.raised"
            padding="space.200"
            style={{ borderRadius: token('radius.small') }}
          >
            <Stack space="space.050">
              <Text size="small" color={colorToken ?? 'color.text.subtlest'}>{item.label}</Text>
              <Box style={colorToken ? { color: token(colorToken) } : undefined}>
                <Heading size="large">{item.value}</Heading>
              </Box>
            </Stack>
          </Box>
        );
      })}
    </Grid>
  );
}
