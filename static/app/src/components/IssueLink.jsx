import Button from '@atlaskit/button';
import { router } from '@forge/bridge';

/**
 * Renders an issue key as a keyboard-accessible, link-styled button that
 * opens the issue in Jira via `router.navigate`, never inside the iframe.
 */
export function IssueLink({ issueKey }) {
  return (
    <Button
      appearance="link"
      spacing="none"
      onClick={() => router.navigate(`/browse/${issueKey}`)}
    >
      {issueKey}
    </Button>
  );
}
