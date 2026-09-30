# SDD ledger — plan: atlassian/plans/2026-09-29-artup-reports-v1.md
Spec: atlassian/plans/2026-09-29-artup-reports-design.md. Branch reports-v1, start 62ac49a.

## Pre-flight scan
| Pair / task | Produces vs consumes | Finding |
|---|---|---|
| T3→T4 | TEMPLATE_PART_BYTES may be lowered by T3 finding | consistent (T4 says "use T3 value") |
| T3→T6 | fixture media-rpt.json {cases:[{adf,attachments,renderedHtml,expected}]} | consistent |
| T5→T7→T8 | resolveField/findBy*/cellValue/linkCell → resolveColumn → createRowBuilder | consistent |
| T7→T9 | planLayout(catalog) changed to planLayout(template,catalog) in T9 Step 1 | explicit, consistent |
| T9→T12/T13/T14/T15 | DocSpec, Prepared, imagesFor, buildTemplateData | consistent |
| T10→T15 | bulkFetch→{issues,errors}, onRetry, attachmentBytes/Thumbnail | consistent |
| T11→T15 | renderXlsx({assembled,summary,meta,labels,ExcelJS}) | consistent |
| T12→T15 | renderDocx({spec,images,labels,meta,docx}) | consistent |
| T13→T15 | renderPdf → {bytes,emojiDropped} | consistent (T15 unwraps) |
| T14→T15/T19 | renderDocxTemplate(...), inspectTemplate(...) | consistent |
| T16→T18/T19 | resolver keys + error codes; T2 KNOWN_CODES adds forbidden/not-found/too-large | consistent |
| T1 self | Step 8 CI UI steps "commit now only if…" ambiguous | P2 |
| T8 self | finish() uses literal 32767 vs Global Constraint "limits only in limits.js" | P1 |
| T4,T5,T6,T7,T8 self | tests vs code hand-checked when written | consistent |
| T9–T23 self | tests described in prose, code partial | consistent; review loop is the net |

- Ruling P1: T8 must use EXCEL_CELL_LIMIT from core/limits.js instead of literal 32767 — Global Constraint beats plan snippet — cost if wrong: none.
- Ruling P2: T1 adds only non-UI CI steps (install/lint/test/audit root); UI steps (UI test/UI build/UI audit) are added in T2 — UI does not exist before T2 — cost if wrong: none.

## Tasks
Task 1: complete (commits 62ac49a..485467f, review clean) — app id a6576b04-b09c-43a8-8b22-bd83557c112d; forge register needs `-s 249db86b-0aa6-4b81-96ba-62341736ad15`; forge lint needs dist dirs (Task 2)
Task 1: minor (deferred): AGENTS.md says "Jira Content Properties REST API" (should be issue/entity properties)
Task 1: minor (deferred): test/access.test.js two expects per it (copied from Export, plan-mandated)
Task 1: minor (deferred): manifestLocales.test.js regex brittle to indentation
Task 2: complete (commits aae20dc..ebec8b2, review clean) — dev deploy v2.0.0 installed on artuplabs-dev, eligible RoA; uuid override ^11.0.0; useI18n() added
Task 2: minor (deferred): smoke test does not prove locale applied (plan-mandated recipe); useI18n/formatDuration untested directly
Task 3: complete (commits ebec8b2..06c047c, review clean; 2 Important carried to Task 6) — alt absent in ADF media; rendered HTML has data-media-services-id (UUID→attachment id) for thumbnail form; scopes +read:board-scope.admin:jira-software +read:project:jira (R17) → next deploy needs --upgrade; KVS value 240 KiB, invoke request 500 KB
Task 3: Ruling T3a: reviewer Important #1 (no distinct-id order case) and #2 (same-name ordering wording) are carried into Task 6, which owns media.js and its tests: Task 6 adds a synthetic case with two distinct images and resolves by data-media-services-id first, then rendered order, then filename — the consumer task is the right owner — cost if wrong: none, Task 6 review checks it.
Task 3: minor (deferred): live-checks api() retries POST on 5xx (possible duplicate issues); assertRpt prefix-only check; `!file!` plain form unmeasured
Task 4: complete (commits 06c047c..5e61780, review clean, batched with 5)
Task 5: complete (commits 5e61780..b6ba8c0, review clean)
Task 4: minor (deferred): textRuns space after emoji starts latin run (doc says stays with previous); keycaps/‼ classed latin; Windows reserved names; -PARTIAL after 120 cap; imageSize weak magic checks, zero sizes; tests thin on truncated/progressive JPEG
Task 5: minor (deferred): dateCell rolls over invalid dates; catalog throws on nameless field; tests use field-by-field checks in places (plan-authored)
Task 6: Ruling T6a: createMediaResolver order = (1) data-media-services-id→attachment id map parsed from rendered HTML, matched by attrs.id; (2) rendered <img> order by index; (3) filename by attrs.alt; always restricted to the issue's attachments — Task 3 measured alt absent and UUID≠attachment id — cost if wrong: images mis-mapped only when HTML lacks both id and order.
Task 6: Ruling T6b: fixture rpt-lists.json uses RPT-2 (seeded descriptions have flat lists only); nested lists are covered by synthetic tests — no seeded issue has nested lists — cost if wrong: none.
Task 6: fix round 1/5 (6 addressed, 0 open — tableGrid overlap, media order after file cards, warning detail, NaN date, truncate clamp, test name; commits ac225d5..3dcc10b)
Task 6: complete (commits b6ba8c0..3dcc10b, review clean after round 1)
Task 6: minor (deferred): resolved non-image attachments still become image blocks (downstream treats unreadable bytes as missing); text links to attachment URLs count as rendered media entries; vitest warns on dynamic JSON import in adf.test.js (output not pristine)
Task 7: Ruling T7a: navigator issueKeys selection wins over jql — user's explicit selection — cost if wrong: user expecting whole search gets selection only.
Task 7: Ruling T7b: entries carry optional projectKey from extension.project.key — used for project templates — cost if wrong: none.
Task 7: fix round 1/5 (3 addressed, 0 open — prototype-key lookups, idOf, navigator array guard; commits ca464e2..3c85e3d)
Task 7: complete (commits 3dcc10b..3c85e3d, review clean after round 1)
Task 7: minor (deferred): withOrder matches "order by" inside quoted strings; field "X"/raw on custom fields not scope-checked; BUILTINS not frozen; missing not de-duplicated
Task 8: fix round 1/5 (4 addressed, 0 open — sheetName apostrophes, empty grouped sheets, missing groupBy + builder.grouped, cross-mode item cells; commits 51743cf..60d02b3)
Task 8: complete (commits 3c85e3d..60d02b3, review clean after round 1)
Task 8: CARRY to Task 15: pipeline must pass builder.grouped (not template.groupBy) to assembleSheets and surface builder.missing as column-missing warnings.
Task 8: minor (deferred): issue-level cells recomputed per worklog/comment row (perf); localeCompare without locale; placeholder bucket names may merge with real "(none)"/"Unassigned"
Task 9: complete (commits 60d02b3..3f07d83, review clean)
Task 9: CARRY to Task 12/13/14: renderers must tolerate a table with zero rows (keyValues can be empty) — skip it.
Task 9: CARRY to Task 15: comments completed via listComments (expand=renderedBody) keep their own renderedBody; never re-sort comments without it (prepare matches rendered comment bodies by index otherwise).
Task 9: minor (deferred): status/type groups without value titled "Untitled"; sprint title may be joined "Sprint 6, Sprint 7"
Task 10: complete (commits 3f07d83..ecfbdad, review clean)
Task 10: CARRY to Task 15: call searchIds with limit only when it is a positive number (limit 0/null sends maxResults 0).
Task 10: minor (deferred): searchIds limit ≤0/null unguarded; boardJql with missing filter id requests /filter/NaN; paged stops after 1 page when total missing; abortableSleep leaves listener; retry-cap/onRetry-network tests missing
Task 11: complete (commits ecfbdad..5553d4d, review clean) — 10k×15 in 518 ms
Task 11: minor (deferred): banner "exactly once" not pinned across multi-sheet/summary-null cases; zero-column autoFilter unguarded; Uint8Array type not asserted
Task 12: fix round 1/5 (4 addressed, 0 open — nested ordered list restart/start, empty header, image width in cells/lists, quote indent; commits 4704cff..1a2a8ca)
Task 12: complete (commits 5553d4d..1a2a8ca, review clean after round 1) — docx rowSpan continuation inserted by library; PALETTE.muted added
Task 12: minor (deferred): heading as list lead loses style; Hyperlink style colour not PALETTE.link; quote-in-list indent double count; list marker in quote not shifted; images in >4-column tables can exceed cell
Task 13: fix round 1/5 (4 addressed, 0 open — corrupt image fallback + retry, cell padding, probe scripts, loadFonts test; commits 80238d7..83632d7)
Task 13: complete (commits 1a2a8ca..83632d7, review clean after round 1) — font chunks: Sans 0.83 MB, KR 6.4 MB, SC 11.4 MB (deploy must accept); GIF → placeholder in PDF
Task 13: CARRY to Task 15: renderPdf returns { bytes, emojiDropped, imagesDropped }; surface imagesDropped as image-missing warnings/stats.
Task 13: minor (deferred): italic faces upright; base64 decoded+re-encoded; code blocks proportional font; strike+underline keeps only strike; JPEG EOI must be in last 16 bytes (drops some valid JPEGs)
Task 14: complete (commits 83632d7..1cd1329, review clean)
Task 14: Ruling T14a: GIFs in customer Word templates are embedded on a valid header alone (isImageIntact returns false for GIF by design; Word tolerates GIF) — cost if wrong: a truncated GIF shows as a broken picture in Word, file still opens.
Task 14: CARRY to Task 19: declare `lodash` as a direct dependency of static/app when inspectTemplate is wired in (docxtemplater inspect-module requires it); cap total uncompressed size of the uploaded zip (e.g. 20 MB summed from the zip entries) before compiling.
Task 14: minor (deferred): no tests for header rich image / customer drawing renumbering / JPEG embed / XML well-formedness; self-closing <Relationships/> not handled; HYPERLINK backslash; lone surrogates; heading-in-list formatting
Task 15: Ruling T15a: the Images map stays in memory until the build (renderers need every image at once) and is released after a successful build and on abort; only 404/unreadable cached as missing — spec §2 "stream images" is not achievable with docx/pdfmake APIs — cost if wrong: tab memory peak on 2 000-issue Word/PDF with many images (Task 22 measures).
Task 15: fix round 1/5 (5 addressed, 0 open — per-issue isolation, image release, abort writes, doc id cap, imagesMissing unit; commits f240a4e..1a052f7)
Task 15: complete (commits 1cd1329..1a052f7, review clean after round 1) — R18: client may be a factory ({ onRetry }) => client
Task 15: CARRY to Task 18: useExportRun passes the client as a factory `({ onRetry }) => createBridgeClient({ signal, onRetry })` so stats.retries is real.
Task 15: minor (deferred): 'complete' progress phase never emitted; stats.seconds includes time on error screen for retry/partial; custom-template plan.missing not warned; non-abort render error keeps image cache; timing-based tests
Task 16: fix round 1/5 (6 addressed, 0 open — enum types, upload generations, 2 MiB server cap, exact scope filter, write order, error logging; commits da32583..0d02405)
Task 16: complete (commits 1a052f7..0d02405, review clean after round 1)
Task 16: Ruling T16a: accept implementer deviations — `internal` error code for unexpected failures; every non-last part exactly TEMPLATE_PART_BYTES decoded; kind immutable on update; kind must match format; site scopeId 'site'; client-chosen id on create → not-found — they tighten the contract without changing the spec — cost if wrong: client must follow them (Task 19 carries).
Task 16: CARRY to Task 19: uploadTemplatePart({ id, uploadId, index, total, data }) — new UUID uploadId per upload; split at exactly 150 KiB (last part may be shorter); send parts in order; unexpected errors arrive as `internal` (add to api.js KNOWN_CODES + translations); add `errors.internal` key.
Task 16: minor (deferred): saveTemplate vs finalize race can point meta at deleted gen; abandoned generations not cleaned until delete; partIndexes reads full values via prefix query (~2.6 MB)
Task 17: complete (commits 0d02405..14dcb49, review clean) — getScopes mock shape matches resolver
Task 17: CARRY to Task 18/19/20: StepSection takes `number` (not index) + optional description; AppHeader takes { subtitle, scopeName, actions } and always shows t('app.title') (no title prop); AccessGate/useAccess in src/app/.
Task 17: minor (deferred): fixtures resolve('getAccess') dead branch; bulkfetch mock never returns issueErrors / fixed order
Task 18: INTERRUPTED by owner 2026-09-29 — implementer started (not reviewed); partial work saved as `git stash` "REPORTS task 18 WIP (wizard, unreviewed, interrupted 2026-09-29)" (src/wizard/, test/wizard/, preview WizardScreen, +200 locale keys, @atlaskit/textarea 10.2.7). Resume Task 18 in a new session: dispatch a fresh opus implementer that may start from `git stash apply` of that stash, then normal review.
