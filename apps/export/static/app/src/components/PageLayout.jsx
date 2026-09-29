import { Box, xcss } from '@atlaskit/primitives';

const WIDE = '@media (min-width: 900px)';

const gridStyles = xcss({
  display: 'grid',
  gridTemplateColumns: 'minmax(0, 1fr)',
  gap: 'space.400',
  alignItems: 'start',
});
const splitStyles = xcss({
  [WIDE]: { gridTemplateColumns: 'minmax(0, 7fr) minmax(0, 5fr)' },
});
const asideStyles = xcss({
  minWidth: '0',
  [WIDE]: { position: 'sticky', top: 'space.300' },
});
const mainStyles = xcss({ minWidth: '0' });

/** Two-column page body (7/5 from 900px, stacked below) with a sticky aside. */
export function PageLayout({ main, aside }) {
  return (
    <Box xcss={[gridStyles, aside ? splitStyles : undefined]}>
      <Box xcss={mainStyles}>{main}</Box>
      {aside ? <Box as="aside" xcss={asideStyles}>{aside}</Box> : null}
    </Box>
  );
}
