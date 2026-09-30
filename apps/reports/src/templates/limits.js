/** Largest customer .docx template; equal to the UI value. */
export const TEMPLATE_MAX_BYTES = 2 * 1024 * 1024;
/** Raw bytes per stored template part; equal to the UI value. */
export const TEMPLATE_PART_BYTES = 150 * 1024;
/** Parts needed for the largest template. */
export const TEMPLATE_MAX_PARTS = Math.ceil(TEMPLATE_MAX_BYTES / TEMPLATE_PART_BYTES);
