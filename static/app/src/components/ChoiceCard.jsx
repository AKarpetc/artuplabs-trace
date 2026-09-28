import { token } from '@atlaskit/tokens';
import Lozenge from '@atlaskit/lozenge';
import { Box, Inline, Stack, Text, xcss } from '@atlaskit/primitives';
import { glyph } from './icons.js';

const ACCENTS = ['blue', 'purple', 'teal', 'orange'];

const cardStyles = xcss({
  display: 'block',
  height: '100%',
  boxSizing: 'border-box',
  padding: 'space.200',
  borderWidth: 'border.width',
  borderStyle: 'solid',
  borderColor: 'color.border',
  borderRadius: 'radius.large',
  backgroundColor: 'elevation.surface',
  cursor: 'pointer',
  outline: 'none',
  ':hover': { backgroundColor: 'elevation.surface.hovered' },
  ':focus-visible': {
    outlineWidth: 'border.width.focused',
    outlineStyle: 'solid',
    outlineColor: 'color.border.focused',
    outlineOffset: 'space.025',
  },
});
const selectedStyles = xcss({
  padding: `calc(${token('space.200')} - 1px)`,
  borderWidth: 'border.width.selected',
  borderColor: 'color.border.selected',
  backgroundColor: 'color.background.selected',
  ':hover': { backgroundColor: 'color.background.selected.hovered' },
});
const disabledStyles = xcss({
  cursor: 'not-allowed',
  opacity: 'opacity.disabled',
  ':hover': { backgroundColor: 'elevation.surface' },
});
const tileStyles = Object.fromEntries(ACCENTS.map((accent) => [accent, xcss({
  width: '40px',
  height: '40px',
  flexShrink: 0,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  borderRadius: 'radius.medium',
  backgroundColor: `color.background.accent.${accent}.subtler`,
})]));
const glyphStyles = xcss({ width: '24px', height: '24px', lineHeight: '0' });
const bodyStyles = xcss({ minWidth: '0', flexGrow: 1 });

/**
 * Radio-like selectable card (role="radio", Space/Enter select) with a tinted icon tile,
 * a semibold title, an optional badge and a two-line description.
 */
export function ChoiceCard({ selected, onSelect, icon, accent = 'blue', title, description, badge, disabled = false, testId }) {
  const Icon = glyph(icon);
  const tone = ACCENTS.includes(accent) ? accent : 'blue';
  const choose = () => {
    if (!disabled) onSelect?.();
  };
  const onKeyDown = (event) => {
    if (event.key !== ' ' && event.key !== 'Enter') return;
    event.preventDefault();
    choose();
  };
  return (
    <Box
      role="radio"
      aria-checked={selected ? 'true' : 'false'}
      aria-disabled={disabled ? 'true' : undefined}
      tabIndex={disabled ? -1 : 0}
      onClick={choose}
      onKeyDown={onKeyDown}
      testId={testId}
      xcss={[cardStyles, selected && selectedStyles, disabled && disabledStyles]}
    >
      <Inline space="space.150" alignBlock="start">
        {Icon ? (
          <Box xcss={tileStyles[tone]}>
            <Box xcss={glyphStyles}>
              <Icon label="" color={token(`color.icon.accent.${tone}`)} shouldScale />
            </Box>
          </Box>
        ) : null}
        <Stack space="space.050" xcss={bodyStyles}>
          <Inline space="space.100" alignBlock="center" shouldWrap>
            <Text weight="semibold">{title}</Text>
            {badge ? <Lozenge appearance="new">{badge}</Lozenge> : null}
          </Inline>
          {description ? <Text color="color.text.subtle" size="small" maxLines={2}>{description}</Text> : null}
        </Stack>
      </Inline>
    </Box>
  );
}
