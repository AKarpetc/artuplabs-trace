import { createRoot } from 'react-dom/client';
import '@atlaskit/css-reset';
import { Box } from '@atlaskit/primitives';
import Heading from '@atlaskit/heading';
import { bootstrap } from '../theme';

/** Placeholder ArtUp Trace issue panel shell, full width with themed padding. */
export function IssueApp({ context }) {
  return (
    <Box padding="space.300">
      <Heading size="medium">ArtUp Trace</Heading>
    </Box>
  );
}

async function main() {
  const { context } = await bootstrap();
  const root = createRoot(document.getElementById('root'));
  root.render(<IssueApp context={context} />);
}

main();
