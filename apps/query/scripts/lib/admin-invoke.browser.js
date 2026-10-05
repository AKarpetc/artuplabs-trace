/**
 * Calls the admin page resolvers without clicks, for the dev site's acceptance runs (a project reindex for the backfill speed, the status
 * with the index rows). Run it in the Jira tab that shows the app's admin page (Apps → ArtUp Query settings), e.g. through the browser
 * tool's JavaScript runner: it reloads the admin page frame, keeps the invokeExtension request Jira itself sends for it (context, extension
 * and the page's short-lived context token stay inside the page and are never returned), then sends the same request with another
 * resolver. The template lasts as long as the context token (15 minutes); run the script again for a new one.
 *
 *   await aqAdmin('adminStatus')                         → { excluded, progress, parts, rows }
 *   await aqAdmin('reindexProject', { projectKey: 'RPT' }) → { started } (refused with busy while a part is still filling)
 */
(async () => {
  const kept = [];
  const stringify = JSON.stringify;
  JSON.stringify = function keep(...args) {
    const text = stringify.apply(this, args);
    if (typeof text === 'string' && text.startsWith('{"operationName":"useInvokeExtensionRelayMutation"')) kept.push(text);
    return text;
  };
  try {
    const frame = document.querySelector('iframe');
    frame.src = frame.src;
    await new Promise((resolve) => { setTimeout(resolve, 10000); });
  } finally {
    JSON.stringify = stringify;
  }
  if (!kept.length) throw new Error('no invokeExtension request seen: open the app admin page first');
  const template = JSON.parse(kept[kept.length - 1]);
  const query = 'mutation invoke($input: InvokeExtensionInput!) { invokeExtension(input: $input) { success response { body } errors { message } } }';
  window.aqAdmin = async (functionKey, payload = {}) => {
    const variables = structuredClone(template.variables);
    variables.input.payload.call = { functionKey, payload };
    const res = await fetch('/gateway/api/graphql', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ operationName: 'invoke', query, variables }) });
    const answer = (await res.json()).data?.invokeExtension;
    if (!answer?.success) throw new Error(`${functionKey}: ${answer?.errors?.map((e) => e.message).join('; ') ?? res.status}`);
    return answer.response.body;
  };
  return 'aqAdmin ready';
})();
