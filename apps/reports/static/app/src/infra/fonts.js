const SOURCES = {
  latin: {
    family: 'Sans',
    normal: ['NotoSans-Regular.ttf', () => import('../../fonts/NotoSans-Regular.ttf?inline')],
    bold: ['NotoSans-Bold.ttf', () => import('../../fonts/NotoSans-Bold.ttf?inline')],
  },
  cjk: {
    family: 'CJK',
    normal: ['NotoSansSC-Regular.otf', () => import('../../fonts/NotoSansSC-Regular.otf?inline')],
    bold: ['NotoSansSC-Bold.otf', () => import('../../fonts/NotoSansSC-Bold.otf?inline')],
  },
  korean: {
    family: 'KR',
    normal: ['NotoSansKR-Regular.otf', () => import('../../fonts/NotoSansKR-Regular.otf?inline')],
    bold: ['NotoSansKR-Bold.otf', () => import('../../fonts/NotoSansKR-Bold.otf?inline')],
  },
};

function bytesOfDataUrl(url) {
  const binary = atob(url.slice(url.indexOf(',') + 1));
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) out[i] = binary.charCodeAt(i);
  return out;
}

/** Loads the fonts for the scripts present (Latin always); CJK and Korean chunks are fetched only when needed. */
export async function loadFonts(scripts) {
  const wanted = ['latin', ...['cjk', 'korean'].filter((s) => scripts.has(s))];
  const files = {};
  const families = {};
  await Promise.all(wanted.map(async (script) => {
    const source = SOURCES[script];
    const [normal, bold] = await Promise.all([source.normal[1](), source.bold[1]()]);
    files[source.normal[0]] = bytesOfDataUrl(normal.default);
    files[source.bold[0]] = bytesOfDataUrl(bold.default);
    families[source.family] = { normal: source.normal[0], bold: source.bold[0], italics: source.normal[0], bolditalics: source.bold[0] };
  }));
  return { files, families };
}
