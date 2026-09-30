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
Task 18: RESUMED 2026-09-30 — fresh opus implementer dispatched (BASE 746c5ca), may start from stash@{0}
Task 18: implementer DONE_WITH_CONCERNS (commit 75c1cff, 699/699 UI tests, 56 preview screenshots) — review dispatched (opus)
Task 18: Ruling: R19 (implementer) — board entry without project key resolves project from the first issue read (≤3 extra reads) — reading of "via the first read" in brief — cost if wrong: extra reads / wrong project templates listed on boards spanning projects
Task 18: CARRY to Task 21: wizard TemplatePicker loads thumbnails as `preview/thumbs/<builtin id>.png` (brief T18); T21 must emit per-id files (or change the one path line) — plan T21 text says <layout>.png.
Task 18: complete (commits 746c5ca..75c1cff, review clean)
Task 18: minor (deferred): raw fontSize/lineHeight px in xcss (ExcelPreview, SourceStep, WarningsTable, ResultView, Wizard codeStyles) — use font tokens
Task 18: minor (deferred): ColumnsEditor drag effect re-registers each render (onMove unstable)
Task 18: minor (deferred): R19 lookup is 4 reads (board config, filter, searchIds, bulkFetch), not 3 — correct rulings text
Task 18: minor (deferred): useExcelPreview throws ReportError('network') for non-done preview → shows "offline" for incomplete read
Task 18: minor (deferred): progress-per-phase UI test covers read phase only
Task 18: minor (deferred): TemplatePicker stored-groups error uses SectionMessage without illustration (use InlineState)
Task 18: minor (deferred): extras beyond brief — beforeunload guard, RunningView stage tracker/timer
Task 18: minor (deferred): en-GB identical to en-US (en-US already British spellings)
Task 18: Ruling: commit trailer — remaining commits use `Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>` per owner's session prompt/constraints.md; 75c1cff left as is (no history rewrite) — cost if wrong: one inconsistent trailer
Task 19: implementer dispatched (sonnet, BASE 75c1cff)
Task 19: implementer DONE_WITH_CONCERNS (commit 526c3ec, 753/753 UI tests, 48 shots); rulings R20 (editable projects only, paged, 20-key chunks) and R21 (author names via user/bulk) in rulings file — review dispatched (sonnet)
Task 19: complete (commits 75c1cff..526c3ec, review clean) — ⚠️ example-template.docx resolved: committed file is inspected by a test (0 errors) and rendered; context prop carried to T20
Task 19: minor (deferred): unpackedSize trusts zip directory sizes (crafted docx can bypass 20 MB cap; client-side only)
Task 19: minor (deferred): library load/parse failure in DocxUploadForm shown as not-docx
Task 19: minor (deferred): DocxUploadForm choose() race on quick successive files
Task 19: minor (deferred): tab.test.jsx multi-assert tests / toMatchObject (3655, 3798, 3827, 3978, 3995)
Task 19: minor (deferred): useTemplateAdmin takes user/site from first chunk answer — undocumented assumption
Task 19: CARRY to Task 20: TemplatesTab takes no `context` prop (brief said context={…}); mount it in GlobalApp and pass what it needs if anything
Task 20: implementer dispatched (sonnet, BASE 526c3ec) — includes dev deploy + forge install --upgrade (new scopes)
Task 20: implementer DONE (commit 1c00a96; UI 773, root 159; dev deployed v3.0.0 with --approve MAJOR_VERSION_RULE; install --upgrade granted new scopes) — review dispatched (sonnet)
Task 20: Ruling: R22 (implementer) — global page route /jira/apps/<appId>/<envId> from context.localId (not in live-checks.md) — verify at C1; cost if wrong: "Open ArtUp Reports" button degrades to Close
Task 20: review approved; ⚠️ confirmed gap: modal ≥600 px not enforced (no viewportSize in manifest) → fix round 1 (resume implementer)
Task 20: minor (deferred): board/backlog entries indistinguishable in action tests; navigator filterId not exercised; board fixture lacks sprints
Task 20: minor (deferred): Close fallback (path null) has no component test; router.navigate inside modal — does modal close?
Task 20: minor (deferred): no test that header renders on global page / non-en locale (lost with smoke.test.jsx)
Task 20: minor (deferred): GlobalApp hand-rolled tabpanels lack aria-labelledby/id (use TabPanel)
Task 20: minor (deferred): hidden Export wizard keeps loading while Templates tab active (deliberate)
Task 20: fix round 1/5 (commit 6631c3b: viewportSize large on 5 action modules, dev v3.1.0) — scoped re-review dispatched
Task 21: Ruling: thumbnails are 4 files `preview/thumbs/<layout>.png` (plan T21 "Word and PDF share"; the "8" in the Files line contradicts it), rendered with the PDF engine; T21 changes TemplatePicker to use template.layout instead of template.id — cost if wrong: Word thumbnail shows PDF rendering of same layout
Task 20: fix round 1/5 (1 addressed, 0 open; commits 1c00a96..6631c3b)
Task 20: complete (commits 526c3ec..6631c3b, review clean after round 1) — C1: verify rendered modal width and R22 route
Task 21: implementer dispatched (sonnet, BASE 6631c3b)
Task 21: implementer DONE_WITH_CONCERNS (78c6243, 4ae8006; UI 805, root 164; probe 0 over 1088 pages; 198 strings changed in 25 locales; poppler installed via brew) — review dispatched (sonnet)
Task 21: complete (commits 6631c3b..4ae8006, review clean) — ⚠️ items: probe numbers/thumb visuals are implementer evidence (contact sheet for owner at C1); Forge serving thumbs → verified at T22 deploy/C1; native check ko/is/et/hu → owner
Task 21: minor (deferred): probe scroll-ancestor skip hides unclipped overflow inside scroll tables/running tracker
Task 21: minor (deferred): probe tolerates ellipsis truncation outside controls
Task 21: minor (deferred): screenshots.mjs browser context has no locale → paper Letter in all locale shots
Task 21: minor (deferred): thumbnails rendered with en-US content for every locale
Task 21: minor (deferred): export-excel and preview matrix states identical
Task 22: implementer dispatched (sonnet, BASE 4ae8006)
Task 22: implementer DONE_WITH_CONCERNS (1ba475f renderer fix, 1d68f81 scripts+acceptance; xlsx10k 11.8s, docx500 58.1s, pdf500 56.7s, synth50k heap 1399MB; T15a 2000 imgs RSS docx 1557MB / pdf 1968MB >1.5GB; dev v3.2.0, bundles ~41MB each) — review dispatched (sonnet)
Task 22: review approved with 2 Important (Word --multiply proxy deduped → understated; R23 closes owner alarm, no 2000-issue browser check in C2) → fix round 1 (resume implementer; also R24 187/151 mismatch, criterion 7/2 wording, final heap reading)
Task 22: minor (deferred): PDF columnWidth MIN_COLUMN clamp makes >~32-column tables overflow page (old * widths shrank)
Task 22: minor (deferred): pdf.test.js COLUMN helper duplicates production formula
Task 22: minor (deferred): lists/sprint layouts equal-width columns (Summary narrow) — v1.1
Task 22: minor (deferred): first CJK PDF downloads ~35 MB fonts — time it at C2 item 3
Task 22: fix round 1/5 (3 addressed, 0 open; commits 1d68f81..8d43ff5) — Word 2000 RSS 2307 MB / PDF 2163 MB; R23 → owner decision (checklist item 9)
Task 22: minor (deferred): acceptance.mjs uniquePng assumes PNG (non-PNG attachments would get corrupt tail)
Task 22: minor (deferred): checklist item 9 optional 2000-issue repeat vague (no bulk clone)
Task 22: complete (commits 4ae8006..8d43ff5, review clean after round 1)
Task 23: implementer dispatched (sonnet, BASE 8d43ff5)
Task 23: implementer DONE (1650677; listing drafts, 5 screenshots 1840x900, site/reports, NEXT_STEPS §8; OWNER placeholders: R23 count, price/tiers, categories, personal-data wording, uninstall retention) — review dispatched (sonnet)
Task 23: review approved with 2 Important (unmeasured "no issue limit in Excel"; best-case Word/PDF timings as typical) → fix round 1 (resume implementer; also site "no watermark" hedge, "0 s" screenshot)
Task 23: minor (deferred): 5-pdf-page.png soft; listing char counts not recounted; "thousands of issues" tagline; inline style= in site/reports; free ≤10 relies on unconfigured licensing
Task 23: ⚠️ owner: Marketplace char limits, KVS data-residency wording, uninstall retention — in NEXT_STEPS/[OWNER]
Task 23: fix round 1/5 (4 addressed, 0 open; commits 1650677..af40fde)
Task 23: minor (deferred): "four runs" for PDF not directly backed (≥3 runs) — listing.md:100, site/reports/index.html:172
Task 23: complete (commits 8d43ff5..af40fde, review clean after round 1)
Final review: dispatched (opus) over 62ac49a..af40fde
Final review: NOT READY — 1 Critical (custom docx placeholders flat vs tree → fetch plan empty), 4 Important (non-image attachments downloaded as images; JPEG EOI last-16-bytes rejects phone photos; templates tab fan-out + 429-as-deny; nameless field crashes catalog), 6 Minor → ONE fix wave dispatched (opus, BASE af40fde) incl. minors 1,2,4,6 + R19/“four runs” text
Final review: Ruling: T19 zip-bomb guard ships as client-side courtesy (server never unzips; bypassable via invoke anyway; victims only other users' tabs; shared templates need project/site admin) — record in security answers — cost if wrong: a malicious admin template crashes colleagues' tabs until deleted
Final review: owner decision: project templates invisible from navigator action / global page (no project key) — plan behaviour
Final review: minor (deferred): no per-scope template cap; abandoned upload generations removed only on delete (KVS cost exposure)
Final review: must-fix before listing submission (owner): recount listing field lengths vs Marketplace limits
Final fix wave: done (cc643b1..6113651; backend 171, UI 823; dev v3.3.0; rulings R25–R29, R19 corrected) — scoped re-review dispatched (opus)
Final fix wave: re-review — 10/10 addressed, no new Critical/Important (commits af40fde..6113651)
Final review: minor (deferred): abort not wired into retry/template-part reads (background waste after cancel/unmount)
Final review: minor (deferred): withTemplateTags ignores inspection errors → unparsable stored template fails at render instead of fast
Final review: minor (deferred): R25 "costs milliseconds" measured only on ~10 KB example
Final review: minor (deferred): design spec doc-tag table lacks {{partial}}/{{partialBanner}}; withFileCards empty paragraph without filename; 0-part template bytes null
Final review: CLEAN after one fix wave
