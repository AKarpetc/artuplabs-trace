import { Box, Grid, Stack, Text, xcss } from '@atlaskit/primitives';
import { token } from '@atlaskit/tokens';

const APPEARANCE_COLOR = {
  success: 'color.text.success',
  warning: 'color.text.warning',
  danger: 'color.text.danger',
};

const valueStyles = {
  default: xcss({ font: 'font.heading.large', color: 'color.text' }),
  success: xcss({ font: 'font.heading.large', color: 'color.text.success' }),
  warning: xcss({ font: 'font.heading.large', color: 'color.text.warning' }),
  danger: xcss({ font: 'font.heading.large', color: 'color.text.danger' }),
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
              <Box xcss={valueStyles[item.appearance] ?? valueStyles.default}>{item.value}</Box>
            </Stack>
          </Box>
        );
      })}
    </Grid>
  );
}
