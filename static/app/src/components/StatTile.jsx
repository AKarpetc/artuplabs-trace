import { token } from '@atlaskit/tokens';
import { Box, Inline, Stack, Text, xcss } from '@atlaskit/primitives';
import { glyph } from './icons.js';

const TONE_ICON = {
  neutral: 'color.icon.subtle',
  success: 'color.icon.success',
  warning: 'color.icon.warning',
  danger: 'color.icon.danger',
};

const tileStyles = xcss({
  padding: 'space.200',
  borderRadius: 'radius.large',
  backgroundColor: 'elevation.surface.raised',
  boxShadow: 'elevation.shadow.raised',
  minWidth: '0',
});
const valueStyles = xcss({ font: 'font.heading.large', color: 'color.text', overflowWrap: 'anywhere' });

/** Metric card: tone-coloured icon and subtle label above a large value. */
export function StatTile({ label, value, tone = 'neutral', icon }) {
  const Icon = glyph(icon);
  return (
    <Box xcss={tileStyles}>
      <Stack space="space.100">
        <Inline space="space.075" alignBlock="center">
          {Icon ? <Icon label="" color={token(TONE_ICON[tone] ?? TONE_ICON.neutral)} /> : null}
          <Text color="color.text.subtle" size="small" weight="medium">{label}</Text>
        </Inline>
        <Box xcss={valueStyles}>{value}</Box>
      </Stack>
    </Box>
  );
}
