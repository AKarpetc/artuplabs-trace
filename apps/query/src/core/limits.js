/** Values one stored JQL list may hold (Forge precomputation limit). */
export const VALUE_LIMIT = 1000;
/** Page calls one stored fragment may hold (measured: 9 work, 10 return nothing, 11 fail). */
export const TREE_FANOUT = 9;
/** Levels of page calls under the root; 2 only after the live probe passes. */
export const TREE_LEVELS = 1;
export const ID_PAGE = 5000;
export const BULK_BATCH = 100;
export const BULK_CONCURRENCY = 8;
export const CACHE_CHUNK = 5000;
export const PAGE_CACHE_MS = 10 * 60 * 1000;
/** Compute budget of one function call: Jira waits about 15 s for an answer (measured) before it calls again, so 10 s leaves time to queue the job and answer. */
export const FUNCTION_BUDGET_MS = 10 * 1000;
/** Budget of one queue worker run (refresh passes, a compute job, one heavy group), under the consumer's 300 s limit. */
export const WORKER_BUDGET_MS = 240 * 1000;
/** Time one group may compute inside a refresh or reconcile pass (a pass lasts about as long as its slowest group); a slower group moves to the heavy lane so it never holds up the journal. */
export const REFRESH_GROUP_BUDGET_MS = 10 * 1000;
/** Lease of the heavy lane runner: the consumer's 300 s limit, so a killed runner frees the lane. */
export const HEAVY_LEASE_MS = 300 * 1000;
/** Runs a heavy group gets when it keeps running past the worker budget; each retry waits behind the other groups. */
export const HEAVY_ATTEMPTS = 3;
/** Age after which a group waiting in the heavy lane is queued again (its runner message was lost). */
export const HEAVY_QUEUED_STALE_MS = 30 * 60 * 1000;
export const LEASE_MS = 90 * 1000;
export const PENDING_STALE_MS = 6 * 60 * 1000;
export const JOURNAL_PAGE = 100;
/** Touched issues a pass reports and verifies again after VERIFY_DELAY_S. */
export const MAX_TOUCHED = 50;
/** Touched issues a pass checks against each query group (in searches of RECONCILE_MAX); more make it recompute every group. */
export const TOUCHED_CHECK_MAX = 200;
export const VERIFY_DELAY_S = 20;
export const ACTIVE_MS = 7 * 24 * 60 * 60 * 1000;
export const RECONCILE_USED_MS = 24 * 60 * 60 * 1000;
export const RECONCILE_STALE_MS = 60 * 60 * 1000;
export const RECONCILE_MAX_GROUPS = 50;
export const MAX_DEPTH = 10;
export const PRECOMPUTATION_BATCH = 50;
export const REQUEST_ATTEMPTS = 6;
/** First backoff step of a retried Jira request; it doubles per attempt. */
export const RETRY_BASE_MS = 300;
/** Longest single retry sleep: the retries of one request (attempts − 1 sleeps) stay inside the function budget. */
export const RETRY_MAX_MS = 1800;
/** Longest retry sleep of a queue worker: a long Retry-After is mostly waited, yet one sleep stays well inside the refresh lease (LEASE_MS). */
export const WORKER_RETRY_MAX_MS = 30 * 1000;
/** Delay of the follow-up refresh after a pass that kept its journal rows (a failed group or a later pass wrote first). */
export const REFRESH_RETRY_DELAY_S = 60;
/** Age after which journal rows are dropped even though a group keeps failing; the hourly reconcile covers them. */
export const FAILED_ROWS_KEEP_MS = 60 * 60 * 1000;
/** Issue ids one search may pass as reconcileIssues (Jira's limit). */
export const RECONCILE_MAX = 50;
/** Reads of a cached group: the second one follows a generation switched during the first. */
export const CACHE_READ_ATTEMPTS = 2;
/** Page size of Jira lists read with startAt (boards, sprints, projects, group members). */
export const LIST_PAGE = 50;
export const PRECOMPUTATION_PAGE = 100;
export const USER_SEARCH_MAX = 50;
/** Issues per changelog bulkfetch request (Jira rejects 1 001). */
export const CHANGELOG_BATCH = 1000;
/** Change histories per changelog bulkfetch page. */
export const CHANGELOG_PAGE = 10000;
/** Groups recomputed in parallel by one refresh or reconcile pass. */
export const REFRESH_CONCURRENCY = 4;
export const ERROR_LOG_SIZE = 20;
export const COUNT_MAX = 10000;
/** Zero-padded digits of the timestamp in a journal key, so keys sort by time. */
export const JOURNAL_TS_DIGITS = 15;
/** Background job keys read per KVS query page (the KVS page maximum). */
export const JOB_PAGE = 100;
/** Characters one dateCompare or expression argument may hold. */
export const EXPRESSION_MAX_LENGTH = 1000;
/** Nesting depth of one expression (parentheses, unary minus and chained operators), so parsing and evaluation never overflow the stack. */
export const EXPRESSION_MAX_DEPTH = 64;
/** Characters of the user's expression an error message quotes. */
export const EXPRESSION_SNIPPET = 30;
/** Ids in one SQL `IN (…)` list and rows in one INSERT. */
export const SQL_IN_CHUNK = 500;
/** How long the ids of the Sprint fields stay cached. */
export const SPRINT_FIELDS_TTL_MS = 24 * 60 * 60 * 1000;
/** Recently updated issues the hourly reconcile re-reads into the index. */
export const RECONCILE_RECENT_MAX = 2000;
/** Age of the last saved backfill cursor after which the hourly reconcile queues the backfill again (its job was lost or failed). */
export const BACKFILL_STALE_MS = 30 * 60 * 1000;
