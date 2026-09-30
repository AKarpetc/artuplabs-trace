/** Loads each format's library only when that format is used. */
export function loadRenderers() {
  return {
    async xlsx(input) {
      const [{ default: ExcelJS }, { renderXlsx }] = await Promise.all([import('exceljs'), import('../render/xlsx.js')]);
      return renderXlsx({ ...input, ExcelJS });
    },
    async docx(input) {
      const [docx, { renderDocx }] = await Promise.all([import('docx'), import('../render/docx.js')]);
      return renderDocx({ ...input, docx });
    },
    async pdf(input) {
      const [{ renderPdf }, { createBrowserPdfEngine }, { loadFonts }] = await Promise.all([
        import('../render/pdf.js'), import('../infra/pdfEngine.js'), import('../infra/fonts.js'),
      ]);
      return renderPdf({ ...input, engine: await createBrowserPdfEngine(), loadFonts });
    },
    async docxTemplate(input) {
      const [{ default: PizZip }, { default: Docxtemplater }, { renderDocxTemplate }] = await Promise.all([
        import('pizzip'), import('docxtemplater'), import('../render/docxTemplate.js'),
      ]);
      return renderDocxTemplate({ ...input, PizZip, Docxtemplater });
    },
  };
}
