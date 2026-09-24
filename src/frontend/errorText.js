/** Turns a resolver error into a message for the user; known resolver reasons get friendly texts, anything else is shown as is. */
export function errorText(error) {
  const message = String(error?.message ?? error);
  if (message.includes('no-permission')) {
    return 'You do not have permission for this action in this project.';
  }
  if (message.includes('unlicensed')) {
    return 'ArtUp Trace license is not active on this site.';
  }
  if (message.includes('bad-request')) {
    return 'The request was not valid. Reload the page and try again.';
  }
  return message;
}
