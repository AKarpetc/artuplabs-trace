import { Box, xcss } from '@atlaskit/primitives';

const cardStyles = xcss({ backgroundColor: 'elevation.surface.raised', boxShadow: 'elevation.shadow.raised', borderRadius: 'radius.large', padding: 'space.300' });

/** Raised card of the app pages: surface, shadow, large radius and space.300 padding. */
export function Card({ children, testId }) {
  return <Box xcss={cardStyles} testId={testId}>{children}</Box>;
}
