import { createRoot } from 'react-dom/client';
import '@atlaskit/css-reset';
import { Box } from '@atlaskit/primitives';
import Heading from '@atlaskit/heading';
import { bootstrap } from '../theme';

/** Placeholder ArtUp Trace project page shell, full width with themed padding. */
export function ProjectApp({ context }) {
  return (
    <Box padding="space.300">
      <Heading size="large">ArtUp Trace</Heading>
    </Box>
  );
}

async function main() {
  const { context } = await bootstrap();
  const root = createRoot(document.getElementById('root'));
  root.render(<ProjectApp context={context} />);
}

main();
