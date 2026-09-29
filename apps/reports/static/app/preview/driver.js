/** Preview query parameters: `screen`, `state`, `locale` (default en-US), `theme` (light|dark), `width` in px (0 = full). */
export function previewParams() {
  const search = new URLSearchParams(globalThis.location?.search ?? '');
  const width = Number(search.get('width'));
  return {
    screen: search.get('screen') || 'gallery',
    state: search.get('state') || 'default',
    locale: search.get('locale') || 'en-US',
    theme: search.get('theme') === 'dark' ? 'dark' : 'light',
    width: Number.isFinite(width) && width > 0 ? Math.round(width) : 0,
  };
}

/** Constrains `element` to the requested viewport width so narrow layouts can be checked in a wide window. */
export function applyWidth(element, width) {
  if (!width) return;
  element.style.width = `${width}px`;
  element.style.maxWidth = '100%';
}
