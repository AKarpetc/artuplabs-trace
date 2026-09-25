import Button from '@atlaskit/button/new';
import Heading from '@atlaskit/heading';
import { Box, Inline, Stack, Text, xcss } from '@atlaskit/primitives';
import { formatNumber, useLocale, useT } from '../i18n/index.js';

const STEPS = ['onboarding.step1', 'onboarding.step2', 'onboarding.step3'];

const panelStyles = xcss({
  backgroundColor: 'elevation.surface.raised',
  boxShadow: 'elevation.shadow.raised',
  borderRadius: 'radius.large',
  padding: 'space.400',
});

const listStyles = xcss({
  listStyle: 'none',
  margin: 'space.0',
  paddingInlineStart: 'space.0',
});

const itemStyles = xcss({ margin: 'space.0' });

const badgeStyles = xcss({
  backgroundColor: 'color.background.brand.bold',
  color: 'color.text.inverse',
  borderRadius: 'radius.full',
  width: 'size.300',
  height: 'size.300',
  flexShrink: 0,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  fontWeight: 'font.weight.bold',
});

/** First-run guide shown until the project is configured; `onOpenSettings` switches to the Settings tab. */
export function Onboarding({ onOpenSettings }) {
  const t = useT();
  const locale = useLocale();
  return (
    <Box xcss={panelStyles}>
      <Stack space="space.300">
        <Heading size="medium">{t('onboarding.title')}</Heading>
        <Stack as="ol" space="space.200" xcss={listStyles}>
          {STEPS.map((step, index) => (
            <Inline as="li" key={step} space="space.150" alignBlock="center" xcss={itemStyles}>
              <Box xcss={badgeStyles} aria-hidden="true">{formatNumber(locale, index + 1)}</Box>
              <Text>{t(step)}</Text>
            </Inline>
          ))}
        </Stack>
        <Box>
          <Button appearance="primary" onClick={onOpenSettings}>{t('onboarding.cta')}</Button>
        </Box>
      </Stack>
    </Box>
  );
}
