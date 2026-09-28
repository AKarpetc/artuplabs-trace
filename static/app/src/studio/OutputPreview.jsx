import Button from '@atlaskit/button/new';
import Heading from '@atlaskit/heading';
import Skeleton from '@atlaskit/skeleton';
import Spinner from '@atlaskit/spinner';
import { Box, Inline, Stack, Text, xcss } from '@atlaskit/primitives';
import { errorMessage } from '../api.js';
import { FileTree } from '../components/FileTree.jsx';
import { useT } from '../i18n/index.js';
import { EmptyIllustration } from '../illustrations/EmptyIllustration.jsx';
import { ExportIllustration } from '../illustrations/ExportIllustration.jsx';

const TREE_ROWS = ['45%', '62%', '38%', '70%', '52%', '30%', '58%', '44%'];
const CODE_ROWS = ['30%', '55%', '40%', '35%', '60%', '25%'];

const cardStyles = xcss({
  padding: 'space.300',
  borderRadius: 'radius.large',
  backgroundColor: 'elevation.surface.raised',
  boxShadow: 'elevation.shadow.raised',
  minWidth: '0',
});
const flatStyles = xcss({ padding: 'space.0', backgroundColor: 'elevation.surface', boxShadow: 'none' });
const sunkenStyles = xcss({
  padding: 'space.200',
  borderRadius: 'radius.large',
  backgroundColor: 'elevation.surface.sunken',
});
const codeStyles = xcss({
  margin: 'space.0',
  padding: 'space.200',
  borderRadius: 'radius.large',
  backgroundColor: 'elevation.surface.sunken',
  color: 'color.text',
  fontFamily: 'font.family.code',
  fontSize: '12px',
  lineHeight: '20px',
  whiteSpace: 'pre-wrap',
  overflowWrap: 'anywhere',
});
const stateStyles = xcss({ paddingBlock: 'space.200', textAlign: 'center' });
const spinnerStyles = xcss({ lineHeight: '0', flexShrink: 0 });

function Rows({ widths, testId }) {
  return (
    <Box xcss={sunkenStyles} testId={testId}>
      <Stack space="space.100">
        {widths.map((width, index) => (
          <Box key={`${width}-${index}`} paddingInlineStart={index % 3 === 0 ? 'space.0' : 'space.200'}>
            <Skeleton width={width} height={12} isShimmering />
          </Box>
        ))}
      </Stack>
    </Box>
  );
}

function Message({ illustration: Illustration, text, action }) {
  return (
    <Stack space="space.150" alignInline="center" xcss={stateStyles}>
      <Illustration size={96} />
      <Text color="color.text.subtle">{text}</Text>
      {action}
    </Stack>
  );
}

/**
 * Sticky aside: the planned file tree (up to `limit` files) and a front-matter sample, with skeletons while the target is scanned.
 * `compact` renders a flat section with the tree only, for a modal.
 */
export function OutputPreview({ preview, limit = 14, compact = false }) {
  const t = useT();
  const { status, paths, frontMatter, hiddenExtra } = preview;
  const loading = status === 'loading' || status === 'idle';
  let body;
  if (status === 'needs-page') {
    body = <Message illustration={ExportIllustration} text={t('preview.pickPage')} />;
  } else if (status === 'error') {
    body = (
      <Message
        illustration={EmptyIllustration}
        text={errorMessage(t, preview.error)}
        action={<Button onClick={preview.retry}>{t('errors.tryAgain')}</Button>}
      />
    );
  } else if (loading || !paths) {
    body = <Rows widths={TREE_ROWS} testId="preview-skeleton" />;
  } else {
    body = <FileTree paths={paths} limit={limit} hiddenExtra={hiddenExtra} label={t('preview.title')} moreLabel={(count) => t('preview.more', { count })} />;
  }
  const showSample = !compact && status !== 'needs-page' && status !== 'error' && (loading || Boolean(frontMatter));
  return (
    <Box xcss={[cardStyles, compact && flatStyles]} testId="output-preview">
      <Stack space={compact ? 'space.150' : 'space.200'}>
        <Inline space="space.100" alignBlock="center" spread="space-between">
          <Heading size={compact ? 'xsmall' : 'small'} as="h2">{t('preview.title')}</Heading>
          {loading ? <Box xcss={spinnerStyles}><Spinner size="small" label={t('preview.loading')} /></Box> : null}
        </Inline>
        {body}
        {showSample ? (
          <Stack space="space.100">
            <Heading size="xxsmall" as="h3">{t('preview.frontMatter')}</Heading>
            {frontMatter && !loading ? <Box as="pre" testId="front-matter" xcss={codeStyles}>{frontMatter.trimEnd()}</Box> : <Rows widths={CODE_ROWS} />}
          </Stack>
        ) : null}
      </Stack>
    </Box>
  );
}
