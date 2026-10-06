/** Values one stored JQL list may hold (Forge precomputation limit). */
export const VALUE_LIMIT = 1000;
/** Values a root filter may count toward Jira's limit of a stored fragment; a list under a filter keeps this room or moves into a leaf. */
export const ROOT_FILTER_VALUES = 100;
/** Page calls one stored fragment may hold (measured: 9 work, 10 return nothing, 11 fail). */
export const TREE_FANOUT = 9;
/** Levels of page calls under the root; 2 only after the live probe passes. */
export const TREE_LEVELS = 1;
export const ID_PAGE = 5000;
export const BULK_BATCH = 100;
export const BULK_CONCURRENCY = 8;
/** Bulkfetch requests sent at once after Jira warned that little of the app's rate limit is left. */
export const BULK_CONCURRENCY_NEAR = 2;
/** How long a near-limit warning narrows the bulkfetch when Jira names no reset instant. */
export const NEAR_LIMIT_MS = 60 * 1000;
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
/** A group is recomputed in the background (refresh and heavy lane) only while Jira used one of its precomputations this recently; the hourly reconcile rewrites it within an hour of its next use. */
export const REFRESH_USED_MS = 24 * 60 * 60 * 1000;
/** Age of its last rewrite after which the hourly reconcile hands a heavy group to the lane (one run costs Jira rate-limit points per issue); repairs and clock-relative groups go at once. */
export const HEAVY_RECONCILE_MS = 24 * 60 * 60 * 1000;
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
/** Shortest pause of the app's background work after a 429 that names no instant to retry. */
export const RATE_BRAKE_MIN_MS = 60 * 1000;
/** Longest pause of the app's background work after a 429: Jira's quota windows reset every hour. */
export const RATE_BRAKE_MAX_MS = 60 * 60 * 1000;
/** Longest delay of a wake or a resumed fill: shorter than the Forge queue limit (900 s), since 900-s wakes were not delivered on the dev site. */
export const QUEUE_DELAY_MAX_S = 300;
/** Delay of the follow-up refresh after a pass that kept its journal rows (a failed group or a later pass wrote first). */
export const REFRESH_RETRY_DELAY_S = 60;
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
/** Characters one comment or attachment condition argument may hold. */
export const CLAUSES_MAX_LENGTH = 1000;
/** Farthest instant from 1970 a JavaScript date can hold, in ms either way. */
export const DATE_MAX_ABS_MS = 8.64e15;
/** Comments read in one call when bulkfetch returned only part of an issue's comments. */
export const COMMENT_PAGE = 5000;
/** Characters of a file extension kept in the index and read from a condition. */
export const EXT_MAX_LENGTH = 32;
/** Subquery issues whose fields one dateCompare or expression pass holds in memory at a time. */
export const FIELD_EVAL_CHUNK = 5000;
/** Projects one save may exclude from the index. */
export const EXCLUDED_MAX = 200;
/** Issues of excluded projects one result may leave out by an `id not in (…)` clause in its root filter, so the root stays within Jira's 1 000 values; more turn the result into the matching ids. */
export const EXCLUDED_IDS_MAX = VALUE_LIMIT - ROOT_FILTER_VALUES;
/** Characters of a Jira project key. */
export const PROJECT_KEY_MAX_LENGTH = 100;
/** How long the exclusion keeps the project list it checked the excluded keys against. */
export const EXCLUSION_PROJECTS_TTL_MS = 60 * 1000;
/** How long the strict parser's answer about one subquery text is reused: a function call and a refresh pass ask once per text. */
export const JQL_CHECK_MS = 60 * 1000;
/** Jira rate-limit points per hour one site may spend on Tier 1 (the app's pool is shared by every site): five sites at this cap, counted 15 % low, stay under the pool's near-limit warning. */
export const SITE_POINTS_TIER1 = 9000;
/** Points per hour one site may spend on Tier 2 (the site's own pool, Standard 100 000 less 15 % for the counter's error). */
export const SITE_POINTS_TIER2 = 85000;
/** Points one changelog bulkfetch charges per issue log it returns. */
export const CHANGELOG_POINT_FACTOR = 1;
/** Points one bulkfetch charges per issue when it returns their comments. */
export const COMMENT_POINT_FACTOR = 1;
/** Points a computation spends besides reading its issues (subquery check, count, paging). */
export const POINTS_OVERHEAD = 20;
/** Issues a search page returns at most when it asks for fields besides the id. */
export const FIELDS_PAGE = 100;
/** Id ranges a search with fields reads side by side once its result passes one page, and the most times it halves a range still being read (a page of 100 takes 0,4–0,9 s on the dev site, docs/live-checks.md). */
export const FIELD_RANGES = 8;
/** Smallest search page a points scope asks for when little of its limit is left. */
export const POINTS_PAGE_MIN = 100;
/** Points a process spends on one lane before it rewrites its ledger key during an invocation. */
export const POINTS_FLUSH = 200;
/** Unwritten points a process writes to its ledger key at the end of an invocation; less waits for its next invocation. */
export const POINTS_KEY_MIN = 20;
/** How long a process reuses the points it read from the other processes' ledger keys. */
export const POINTS_READ_MS = 15 * 1000;
/** Times a background step tries to claim its room when another process claimed the same points at the same moment. */
export const CLAIM_TRIES = 3;
/** How long a points claim counts after its last write: a claim a killed process could not release stops holding the lane after it. */
export const CLAIM_TTL_MS = 15 * 60 * 1000;
/** Longest random pause before a step tries its claim again. */
export const CLAIM_JITTER_MS = 1500;
/** Seconds after the first call of a new app version that the journal wake it queues comes. */
export const RESUME_WAKE_DELAY_S = 1;
/** Most points the index work of one product event claims, so parallel events each get theirs from the index-event reserve. */
export const EVENT_POINTS_CLAIM = 100;
/** Keys one KVS query page returns at most. */
export const KVS_PAGE = 100;
/** Share of the site's hourly points each kind of work may spend before half past the hour (they add up to the whole cap). */
export const LANE_SHARES = { fn: 0.15, 'index-event': 0.1, refresh: 0.3, heavy: 0.25, reconcile: 0.1, backfill: 0.1 };
/** Minute of the hour from which a kind of work may spend points the others left unspent. */
export const BORROW_MINUTE = 30;
/** Share of the hour's cap work other than function answers may reach by borrowing, so the rest always stays for function answers. */
export const BORROW_CAP_SHARE = 0.9;
/** Share of the site's hourly cap one group may cost; a dearer one gets an error with its numbers. */
export const GROUP_POINTS_SHARE = 0.2;
/** Points a function call may still compute while Jira warns that little of the app's pool is left. */
export const NEAR_FN_POINTS = 300;
/** How long the list of Jira fields stays cached. */
export const FIELDS_TTL_MS = 60 * 60 * 1000;
/** Points one computation may pass its limit by: a scope admits a request by 1 point, so one parallel bulkfetch round can return more. */
export const POINTS_OVERRUN = BULK_CONCURRENCY * (BULK_BATCH + 1);
/** Largest field list kept in `cfg:fields`, below the Forge KVS value limit (240 KiB). */
export const FIELDS_CACHE_MAX_BYTES = 200 * 1024;
/** Share of the site's hourly cap a group may cost and still be recomputed on every event; a dearer one waits for the heavy lane. */
export const LIGHT_GROUP_SHARE = 0.05;
/** How long the cached list of precomputations (`q:pcs:*`) is used before Jira is asked again. */
export const PCS_CACHE_MS = 60 * 60 * 1000;
/** Precomputation records one `q:pcs:<i>` value holds. */
export const PCS_CHUNK = 100;
/** Share of the refresh reserve the fixed cost of journal passes may take; it sets the pause between passes. */
export const REFRESH_OVERHEAD_SHARE = 0.5;
/** Shortest pause between journal passes, in seconds. */
export const PASS_INTERVAL_MIN_S = 5;
/** Longest pause between journal passes, in seconds. */
export const PASS_INTERVAL_MAX_S = 300;
/** Shortest time between two writes of a heavy group by the heavy lane. */
export const HEAVY_MIN_INTERVAL_MS = 60 * 60 * 1000;
/** Longest wait of a group in the heavy lane; then its precomputations get the waited error with its numbers. */
export const HEAVY_WAIT_MAX_MS = 6 * 60 * 60 * 1000;
/** How long the status categories of the site stay cached (`cfg:status`). */
export const STATUS_TTL_MS = 60 * 60 * 1000;
/** Shortest window, in minutes, of recently updated issues the hourly index check re-reads. */
export const RECENT_WINDOW_MIN = 120;
/** Minutes the index check adds to the time since its last finished run, so no update falls between two windows. */
export const RECENT_WINDOW_MARGIN_MIN = 10;
/** How long after half past or the hour a backfill waiting for its reserve starts, so refresh and the heavy lane take first. */
export const BACKFILL_WAKE_DELAY_MS = 60 * 1000;
/** Points one issue costs a backfill or index check slice: its search, its changelog read and its comment read (the slice cap covers more). */
export const INDEX_ISSUE_POINTS = 3;
/** Fewest issues a backfill or index check slice reads; with less room left the run stops until the next allowance. */
export const INDEX_SLICE_MIN = 20;
/** Shortest time between two reads of the status list for a status the cache does not know. */
export const STATUS_REREAD_MS = 5 * 60 * 1000;
/** How long the index check reuses the boards and sprints a part prepared. */
export const INDEX_PREPARE_TTL_MS = 24 * 60 * 60 * 1000;
/** Points of the reconcile reserve the index check keeps however much the group rewrites spend: one slice of the recent issues. */
export const INDEX_CHECK_MIN_POINTS = 200;
