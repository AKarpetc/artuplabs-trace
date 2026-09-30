/** Issue ids per search page. */
export const ID_PAGE = 5000;
/** Issues per bulkfetch call. */
export const BULK_BATCH = 100;
/** Parallel issue requests. */
export const ISSUE_CONCURRENCY = 6;
/** Parallel attachment downloads. */
export const MEDIA_CONCURRENCY = 12;
/** Attempts per request, first try included. */
export const MAX_ATTEMPTS = 6;
/** Largest Word or PDF export. */
export const MAX_DOC_ISSUES = 2000;
/** Characters Excel accepts in one cell. */
export const EXCEL_CELL_LIMIT = 32767;
/** Largest customer .docx template. */
export const TEMPLATE_MAX_BYTES = 2 * 1024 * 1024;
/** Raw bytes per stored template part. */
export const TEMPLATE_PART_BYTES = 150 * 1024;
/** Parts needed for the largest template. */
export const TEMPLATE_MAX_PARTS = Math.ceil(TEMPLATE_MAX_BYTES / TEMPLATE_PART_BYTES);
/** Largest total size of a Word template once unpacked. */
export const TEMPLATE_MAX_UNCOMPRESSED_BYTES = 20 * 1024 * 1024;
/** Project keys the template resolvers take per call. */
export const TEMPLATE_PROJECT_KEYS = 20;

/** Template resolver reads in flight at once on the Templates tab. */
export const TEMPLATE_READ_CONCURRENCY = 3;

/** Waits before repeating a template resolver read that failed with `internal`. */
export const RESOLVER_RETRY_DELAYS_MS = [1000, 2000, 4000];
/** Issues shown in the Excel preview. */
export const PREVIEW_ISSUES = 5;
