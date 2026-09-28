import { forwardRef, useRef } from 'react';
import { token } from '@atlaskit/tokens';
import Lozenge from '@atlaskit/lozenge';
import { Box, Grid, Inline, Stack, Text, xcss } from '@atlaskit/primitives';
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
 * a semibold title, an optional badge and a two-line description; `tabIndex` overrides the default tab stop.
 */
export const ChoiceCard = forwardRef(function ChoiceCard({ selected, onSelect, icon, accent = 'blue', title, description, badge, disabled = false, testId, tabIndex }, ref) {
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
      ref={ref}
      tabIndex={disabled ? -1 : tabIndex ?? 0}
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
});

const STEPS = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 };

/** Index of the enabled option `key` points to from `from`: arrows step with wrap, Home/End jump; -1 for other keys. */
function targetIndex(options, from, key) {
  const enabled = options.map((option, index) => (option.disabled ? -1 : index)).filter((index) => index >= 0);
  if (enabled.length === 0) return -1;
  if (key === 'Home') return enabled[0];
  if (key === 'End') return enabled[enabled.length - 1];
  const step = STEPS[key];
  if (!step) return -1;
  for (let offset = 1; offset <= options.length; offset += 1) {
    const index = (from + step * offset + options.length * offset) % options.length;
    if (!options[index].disabled) return index;
  }
  return -1;
}

/**
 * Labelled radiogroup of ChoiceCards with roving focus: one tab stop (selected or first enabled card),
 * arrows move focus and selection with wrap, Home/End jump, disabled cards are skipped.
 */
export function ChoiceGroup({ label, value, options, onChange, columns = 'repeat(auto-fit, minmax(240px, 1fr))' }) {
  const cards = useRef([]);
  const selectedIndex = options.findIndex((option) => option.value === value && !option.disabled);
  const tabStop = selectedIndex >= 0 ? selectedIndex : options.findIndex((option) => !option.disabled);
  const onKeyDown = (event) => {
    const from = cards.current.findIndex((card) => card && card.contains(event.target));
    if (from < 0) return;
    const next = targetIndex(options, from, event.key);
    if (next < 0) return;
    event.preventDefault();
    onChange(options[next].value);
    cards.current[next]?.focus();
  };
  return (
    <Box role="radiogroup" aria-label={label} onKeyDown={onKeyDown}>
      <Grid gap="space.150" templateColumns={columns}>
        {options.map((option, index) => (
          <ChoiceCard
            key={option.value}
            ref={(card) => {
              cards.current[index] = card;
            }}
            selected={option.value === value}
            onSelect={() => onChange(option.value)}
            icon={option.icon}
            accent={option.accent}
            title={option.title}
            description={option.description}
            badge={option.badge}
            disabled={option.disabled}
            testId={option.testId}
            tabIndex={index === tabStop ? 0 : -1}
          />
        ))}
      </Grid>
    </Box>
  );
}
