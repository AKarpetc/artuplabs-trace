/** Attachments that add up to more than 1 GB (`large`, may be allowed) or more than a zip can hold (`zip-limit`, 4 GiB). */
export class ExportSizeError extends Error {
  constructor(kind, bytes) {
    super(`export too large: ${kind} ${bytes}`);
    this.name = 'ExportSizeError';
    this.kind = kind;
    this.bytes = bytes;
  }
}
