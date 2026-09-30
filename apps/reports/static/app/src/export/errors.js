/** Export failure the UI explains to the user: no-jql, no-issues, too-many-for-document, jql, network, template-missing. */
export class ReportError extends Error {
  constructor(code, data = {}) {
    super(code);
    this.name = 'ReportError';
    this.code = code;
    this.data = data;
  }
}
