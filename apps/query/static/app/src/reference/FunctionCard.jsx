import { useEffect, useState } from 'react';
import { IconButton } from '@atlaskit/button/new';
import { Code } from '@atlaskit/code';
import Heading from '@atlaskit/heading';
import Lozenge from '@atlaskit/lozenge';
import { Box, Inline, Stack, Text, xcss } from '@atlaskit/primitives';
import { Card } from '../components/Card.jsx';
import { CopyIcon } from '../components/icons.js';
import { useT } from '../i18n/index.js';
import { copyText } from './copy.js';

const COPIED_MS = 2000;
const exampleStyles = xcss({ minWidth: '0', overflowWrap: 'anywhere' });

/** One function: signature, description and examples, each with a copy button; "Copied" shows for two seconds after a copy that worked. */
export function FunctionCard({ fn }) {
  const t = useT();
  const [copied, setCopied] = useState(null);
  useEffect(() => {
    if (copied === null) return undefined;
    const timer = setTimeout(() => setCopied(null), COPIED_MS);
    return () => clearTimeout(timer);
  }, [copied]);
  const copy = async (example) => {
    setCopied(null);
    if (await copyText(example)) setCopied(example);
  };
  return (
    <Card testId={`fn-${fn.name}`}>
      <Stack space="space.150">
        <Heading size="small" as="h3"><Code>{fn.usage}</Code></Heading>
        <Text>{t(`fn.${fn.name}`)}</Text>
        {fn.examples.map((example) => (
          <Inline key={example} space="space.100" alignBlock="center">
            <Box xcss={exampleStyles}><Code>{example}</Code></Box>
            <IconButton icon={CopyIcon} label={t('reference.copy')} appearance="subtle" onClick={() => copy(example)} testId="copy" />
            {copied === example ? <Lozenge appearance="success">{t('reference.copied')}</Lozenge> : null}
          </Inline>
        ))}
      </Stack>
    </Card>
  );
}
