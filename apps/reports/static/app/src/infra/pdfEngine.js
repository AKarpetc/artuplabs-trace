const CHUNK = 0x8000;

function base64Of(bytes) {
  let binary = '';
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

/** PDF engine on the browser build of pdfmake: fonts go into its virtual file system, nothing is fetched. */
export async function createBrowserPdfEngine() {
  const mod = await import('pdfmake/build/pdfmake.js');
  const pdfMake = mod.default ?? mod;
  pdfMake.setUrlAccessPolicy(() => false);
  const loaded = new Set();
  return {
    async render(definition, fonts) {
      const fresh = Object.keys(fonts.files).filter((name) => !loaded.has(name));
      pdfMake.addVirtualFileSystem(Object.fromEntries(fresh.map((name) => [name, base64Of(fonts.files[name])])));
      fresh.forEach((name) => loaded.add(name));
      pdfMake.setFonts(fonts.families);
      return new Uint8Array(await pdfMake.createPdf(definition).getBuffer());
    },
  };
}
