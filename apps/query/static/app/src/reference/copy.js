/**
 * Copies text: the async Clipboard API, or a hidden textarea with execCommand where the iframe blocks it.
 * Resolves true only when the text reached the clipboard.
 */
export async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return copyThroughTextarea(text);
  }
}

/** Fallback copy through a hidden, selected textarea; false when the browser refuses the command. */
function copyThroughTextarea(text) {
  const area = document.createElement('textarea');
  area.value = text;
  area.setAttribute('readonly', '');
  area.style.position = 'fixed';
  area.style.opacity = '0';
  document.body.appendChild(area);
  area.select();
  try {
    return document.execCommand('copy') === true;
  } catch {
    return false;
  } finally {
    document.body.removeChild(area);
  }
}
