# Live checks: contexts, scopes, storage limits, media mapping

Measured on 2026-09-29 against https://artuplabs-dev.atlassian.net, project RPT. Re-run with `node apps/reports/scripts/live-checks.mjs media`; `adf <KEY>` prints a description ADF.

## Contexts

Source: Forge manifest reference pages of each module (developer.atlassian.com/platform/forge/manifest-reference/modules/). All fields arrive in `(await view.getContext()).extension`.

| Module | Fields that carry the scope of the export | Quote |
|---|---|---|
| `jira:issueNavigatorAction` | `jql`, `filterId`, `issueKeys` | "`jql` - The jql query"; "`issueKeys` - The list of keys of the selected issues"; "`filterId` - ID of the issue navigator filter being displayed"; also `type`, `action`, `location` |
| `jira:boardAction` | `board.id`, `board.type` (`simple`/`scrum`/`kanban`), `sprints`, `project.id/key/type` | "`board.id` - The id of the project where the module is rendered" (the doc text says project, the field is the board id); "`sprints` - The list of sprints present in the board where the module is rendered" |
| `jira:backlogAction` | `board.id`, `board.type`, `project.id/key/type` | "`board.id` - The id of the board where the module is rendered" |
| `jira:sprintAction` | `sprint.id`, `sprint.state` (`active`/`future`), `board.id`, `board.type`, `project.*` | "`sprint.id` - The id of the sprint where the module is rendered" |
| `jira:issueAction` | `issue.id`, `issue.key`, `issue.type`, `issue.typeId`, `project.*` | "`issue.key` - The key of the issue on which the module is rendered." |
| `jira:globalPage` | only `type`, `location` | "`location` - The full URL of the host page where this module is displayed"; one `jira:globalPage` module per app |

Consequences: the navigator action passes the JQL directly; board and backlog pass only the board id (JQL comes from `GET /rest/agile/1.0/board/{id}/configuration` then the filter); sprint passes the sprint id; the global page has no scope and reads the JQL from the user's input.

## Scopes

Source: Jira Cloud platform and Jira Software REST OpenAPI specs (`security` of each operation), cross-checked with the Jira Software board reference page.

| Endpoint | OAuth 2.0 scopes |
|---|---|
| `POST /rest/api/3/issue/bulkfetch` | `read:jira-work` |
| `POST /rest/api/3/search/jql` | `read:jira-work` |
| `GET /rest/api/3/filter/search` | `read:jira-work` |
| `GET /rest/api/3/mypermissions` | `read:jira-work` |
| `GET /rest/agile/1.0/sprint/{sprintId}` | `read:sprint:jira-software` |
| `GET /rest/agile/1.0/board/{boardId}/configuration` | `read:board-scope.admin:jira-software`, `read:project:jira` |

The Task 1 manifest lacked the two scopes of the board configuration call. Added: `read:board-scope.admin:jira-software`, `read:project:jira` (Ruling R17). `forge lint` reports no errors, only the approval note that the scope change is a major version upgrade, so the next deploy needs `forge install --upgrade`. No deploy was done here.

## Storage limits

Source: developer.atlassian.com/platform/forge/limits-kvs-ce/ and /limits-invocation/.

- KVS key: maximum 500 characters, pattern `/^(?!\s+$)[a-zA-Z0-9:._\s-#]+$/`.
- KVS value: "Maximum size of a single persisted value (in RAW)" is 240 KiB (245 760 bytes).
- `invoke` from Custom UI: "Front-end invocation request payload size: 500KB"; response "Front-end invocation response payload size: 5MB".

A 150 000-byte template part is 200 000 base64 characters; with 10% headroom 220 000, which is under 245 760 (value) and 500 KB (request). Both limits are above 210 000, so `TEMPLATE_PART_BYTES` stays 150 KB and no ruling is needed. The value limit, not the request limit, is the tighter one (about 11% headroom left).

## Media mapping

Run: `node apps/reports/scripts/live-checks.mjs media`. Issues RPT-10001..10003 (label `live-check`), attachments 10500 `diagram-1.png`, 10501 `diagram-2.png`, 10502 and 10503 both `same.png`. Description set with v2 wiki markup; `Before !diagram-N.png|thumbnail! after` produced real `media` nodes on the first try (no fallback needed); issue 3 used `!same.png! and !same.png!`.

| Issue | Node | attrs.id | alt | type | collection | width | height | rendered attachment id | file name | alt == file name |
|---|---|---|---|---|---|---|---|---|---|---|
| RPT-10001 | 1 | 77885e92-e384-4929-9955-028d700928d8 | absent | file | "" | 200 | 183 | 10500 | diagram-1.png | no |
| RPT-10002 | 1 | 85c5ffdf-f73e-45d3-bcd1-30f9fece521e | absent | file | "" | 200 | 183 | 10501 | diagram-2.png | no |
| RPT-10003 | 1 | 1d4c8e73-dd62-442f-b029-ad07e79b7ba4 | absent | file | "" | 200 | 183 | 10502 | same.png | no |
| RPT-10003 | 2 | 1d4c8e73-dd62-442f-b029-ad07e79b7ba4 | absent | file | "" | 200 | 183 | 10502 | same.png | no |

Conclusions:

- alt equals the file name: no (the attribute does not exist on stored nodes).
- `media.attrs.id` is a media-services UUID; it is not an attachment id and cannot be matched to `fields.attachment[].id` directly.
- Rendered HTML order matches: yes. Each `<img>` appears in document order and points to `/rest/api/3/attachment/content/<id>` or `/rest/api/3/attachment/thumbnail/<id>`.
- Thumbnail form (`|thumbnail`) additionally carries `data-media-services-id="<node id>"` beside `data-attachment-name` and `href=".../attachment/content/<attachmentId>"`: an exact UUID to attachment mapping. The plain `!file!` form has no such attribute.
- Same-named attachments: Jira renders both nodes as the first one (10502, the older attachment with that name; 10503 is never shown) and both nodes have one UUID. There is no way to tell them apart, so the mapping is ambiguous by construction and the first same-named attachment is the correct answer.
- Description without an image but with attachments: not measured here.

Ruling R16 makes the rendered HTML the primary strategy (data-media-services-id first, then image order). Fixture for Task 6: `apps/reports/static/app/test/fixtures/adf/media-rpt.json` (three cases; issue 3 lists `expected` as `["10502","10502"]`).
