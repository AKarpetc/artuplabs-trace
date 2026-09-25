import { Pressable, xcss } from '@atlaskit/primitives';
import { router } from '@forge/bridge';

const linkStyles = xcss({
  display: 'inline',
  background: 'transparent',
  padding: 'space.0',
  color: 'color.link',
  textDecoration: 'none',
  font: 'font.body',
  ':hover': { textDecoration: 'underline' },
  ':active': { color: 'color.link.pressed' },
});

/**
 * Renders an issue key as a keyboard-accessible, link-styled button that
 * opens the issue in Jira via `router.navigate`, never inside the iframe.
 * Relies on Pressable's built-in focus ring (`color.border.focused`).
 */
export function IssueLink({ issueKey }) {
  return (
    <Pressable xcss={linkStyles} onClick={() => router.navigate(`/browse/${issueKey}`)}>
      {issueKey}
    </Pressable>
  );
}
