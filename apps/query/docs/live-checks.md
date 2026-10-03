# Живые проверки платформы (Task 3)

Сверка 2026-10-03, сайт `https://artuplabs-dev.atlassian.net`. Документация — цитаты с URL; замеры — вывод
`apps/query/scripts/live-checks.mjs` (сырой вывод: `.superpowers/sdd/2026-10-03-artup-query-v1/task-3-live-output.txt`).
Страницы REST-справочника отдаются WebFetch обрезанными; точные описания и скоупы взяты из OpenAPI-файлов
`https://dac-static.atlassian.com/cloud/jira/platform/swagger-v3.v3.json` и
`https://dac-static.atlassian.com/cloud/jira/software/swagger.v3.json`.

## Function payload and context

Источник: https://developer.atlassian.com/cloud/jira/platform/jql-functions/ — вход функции:

```json
{ "precomputationId": "<uuid>",
  "clause": { "field": "key", "type": ["issue"], "operator": "in", "functionName": "issuesWithText", "arguments": ["Test"] } }
```

- «`precomputationId`: the ID of the precomputation that will be created for the function after its first evaluation finishes».
- Ответ: `{ "jql": "id in (1, 2, 3)" }` или `{ "error": "Error message returned by app.", "storeErrorAsPrecomputation": true }`; «`storeErrorAsPrecomputation` defaults to `false` if omitted».
- Пределы (там же): «Forge functions: 25-second timeout»; «There is a limit of 1,000 right-hand side values in the JQL fragment returned by custom functions»; «Precomputations not evaluated for 7 days are removed automatically by Jira»; неудачный ответ приложения кэшируется до 1 минуты.
- Манифест, https://developer.atlassian.com/platform/forge/manifest-reference/modules/jql-function/ (адрес `.../jira-jql-function/` из брифа — 404): обязательные `key`, `name`, `operators`, `types`, `arguments`, `function` или `endpoint`; пример обработчика `const { clause } = args; const { operator } = clause; const [text] = clause.arguments;` и «return a valid JQL fragment»; динамические модули — «currently available as a Forge preview feature». Предел числа модулей `jira:jqlFunction` на приложение страница не называет; на форуме вопрос о нём без ответа Atlassian (https://community.developer.atlassian.com/t/forge-forge-deploy-fails-at-release-caas-manifest-with-500-is-there-a-limit-on-jira-jqlfunction-modules/99607). Нужны 24 модуля: проверять реальным деплоем (Task 14).
- Контекст обработчика (https://developer.atlassian.com/platform/forge/function-reference/arguments/): «Context is the same for all modules»; поля `installContext`, `principal`, `license`. `license` — «only present for paid apps in the production environment … undefined for free apps, apps in DEVELOPMENT and STAGING environments, and apps that are not listed on the Atlassian Marketplace»; свойства `active` (`isActive` устарел), `billingPeriod`, `ccpEntitlementId`, `trialEndDate`, `supportEntitlementNumber`.
- `environmentType` в контексте обработчика страница не перечисляет; он есть в `getAppContext()` (https://developer.atlassian.com/platform/forge/runtime-reference/app-context-api/): «environmentType — … DEVELOPMENT, STAGING, or PRODUCTION», рядом `moduleKey`, `installationAri`, `license` (с той же оговоркой).

## Events

Источники: https://developer.atlassian.com/platform/forge/events-reference/jira/ и https://developer.atlassian.com/platform/forge/events-reference/jira-software/.

| Группа | Имя события (по документации) | Замечание |
|---|---|---|
| задача | `avi:jira:created:issue`, `avi:jira:updated:issue`, `avi:jira:deleted:issue` | поля: `eventType, selfGenerated, issue, atlassianId, associatedUsers`; у updated ещё `jiraEventTypeName?, changelog, associatedStatuses?` |
| связь | `avi:jira:created:issuelink`, `avi:jira:deleted:issuelink` | поля: `id, sourceIssueId, destinationIssueId, sourceProjectId, destinationProjectId, issueLinkType` |
| комментарий | `avi:jira:commented:issue`, `avi:jira:deleted:comment` (+ `avi:jira:mentioned:comment`) | `avi:jira:updated:comment` в документации **нет**; правка комментария отдельным событием не описана |
| вложение | `avi:jira:created:attachment`, `avi:jira:deleted:attachment` | поле `attachment` («The attachment the event is related to»), внутренние поля не расписаны |
| спринт | `avi:jira-software:created|started|updated|closed|deleted:sprint` | пример (updated): `sprint{id, originBoardId, name, goal, state, createDate, startDate, endDate}`, `oldValue`, `atlassianId`; `completeDate` в списке полей |

- `changelog.id` у `avi:jira:updated:issue`: страница пишет «A list of changes that have occurred in the update» с `to`/`from` («the previous and new values for each changed field respectively, or null when a field was empty»); поля `id` не документирует.
- `timestamp` в примерах документации не показан.
- Примеров JSON, кроме спринта, на страницах нет: фикстуры `test/fixtures/events/*.json` собраны по спискам полей и по полям, которые читает `src/core/events.js` (бриф); `changelog.id`, `timestamp`, `issueLink.*` в фикстурах — допущения брифа, не подтверждённые документацией, и проверяются живыми событиями в Tasks 14/24/27.

## Changelog bulkfetch

OpenAPI `POST /rest/api/3/changelog/bulkfetch`: «You can request the changelogs of up to 1000 issues and can filter them by up to 10 field IDs»; схема: `issueIdsOrKeys` 1…1000, `fieldIds` ≤ 10, `maxResults` по умолчанию 1000, максимум 10000, `nextPageToken`; ответ `issueChangeLogs[{issueId, changeHistories[]}]`, `nextPageToken`. Скоуп: `read:jira-work` (Beta-вариант: `read:issue-meta:jira`, `read:avatar:jira`, `read:issue.changelog:jira`).

Живой замер (скрипт, команда `changelog`):

```
sprint field: customfield_10020
bulkfetch 1000 ids: status 200 | issues 0 | histories 0 | nextPageToken no | created n/a
bulkfetch 1001 ids: status 400 | You may only load changelogs for a maximum of 1,000 issues by ID or key at a time.
walk: issues 5000 | requests 5 | seconds 2.9   (истории пустые — время не показательно)
```

- Задачи JQLG истории не имеют вовсе (`status changed`, `sprint is not EMPTY`, `updated > created` — 0; `issue/JQLG-1/changelog` total 0), поэтому `test/fixtures/changelog-bulkfetch.json` = `{"issueChangeLogs": []}`. Это ожидаемо: фикстуру перезапишет Task 22 на засеянных задачах спринта (`--keys --roles --sprint --closed-at`), тест строится на ней там. Режим `--keys` не прогонялся.
- Разовая проверка на задачах сайта с историей: 200, ключи `issueChangeLogs, nextPageToken`, `created` — число (epoch ms, `1790584137824`), `items[]` = `{field:"status", fieldId:"status", from:"10004", to:"3"}`.

## Agile sprints

OpenAPI `GET /rest/agile/1.0/board/{boardId}/sprint`: поля спринта `completeDate, createdDate, endDate, goal, id, name, originBoardId, self, startDate, state`; скоуп `read:sprint:jira-software`. `activatedDate` в схеме нет.

```
boards: 5 | scrum 2 (REQ, 1 future) и 36 (RPT, 1 active)
sprint fields: createdDate, endDate, id, name, originBoardId, self, startDate, state
activatedDate present: no
sample active: {"id":34,"state":"active","name":"BT sprint","startDate":"2026-09-30T12:29:46.516Z","endDate":"2026-10-14T12:29:46.516Z","createdDate":"2026-09-30T12:29:35.720Z","originBoardId":36}
```

Закрытых спринтов на сайте нет: у closed-спринта `activatedDate`/`completeDate` не проверены, проверка — после засева (Task 22).

## issueLinkType

Эталон — `issuelinks` из `issue/bulkfetch` по 50 157 задачам `project in (JQLG, RPT)` (Q-R9).

```
type | outward n/ref | inward n/ref
Blocks (blocks / is blocked by)       | outward 1863/1190 (missing 0, extra 673) | inward 834/834
Cloners (clones / is cloned by)       | outward 909/909   | inward 836/836
Duplicate (duplicates / is duplicated by) | outward 916/916 | inward 838/838
Relates (relates to / relates to)     | outward 3595/3595 | inward 3595/3595
all match reference: no
```

Разовые проверки: `issueLinkType = "Blocks"` → 1 863; `in ("blocks","is blocked by")` → 1 863; `= "is blocked by"` → 834. JQL сравнивает аргумент с **именем типа** (без учёта регистра) и отдаёт связи обеих сторон; описание направления, совпавшее с именем типа, неоднозначно.

## Scopes

Источники: OpenAPI `swagger-v3.v3.json` и `swagger.v3.json` (Jira Software) на dac-static.atlassian.com (адреса вверху), страницы событий https://developer.atlassian.com/platform/forge/events-reference/jira/ и https://developer.atlassian.com/platform/forge/events-reference/jira-software/.

| Вызов / событие | Скоуп |
|---|---|
| `POST /rest/api/3/changelog/bulkfetch` | `read:jira-work` (Beta: `read:issue-meta:jira`, `read:avatar:jira`, `read:issue.changelog:jira`) |
| `GET /rest/api/3/jql/function/computation` | Current: нет; Beta: `read:app-data:jira` (необязателен, «we will eventually make it mandatory») |
| `POST /rest/api/3/jql/function/computation` | Current: нет; Beta: `write:app-data:jira` (то же). Доступно только приложению для своих функций |
| `GET /rest/agile/1.0/board/{boardId}/sprint`, `GET /rest/agile/1.0/sprint/{id}` | `read:sprint:jira-software` |
| `GET /rest/agile/1.0/board` | `read:board-scope:jira-software` и `read:project:jira` |
| `POST /rest/api/3/search/jql` | Current: `read:jira-work` (Beta: `read:issue-details:jira`, `read:field.default-value:jira`, `read:field.option:jira`, `read:field:jira`, `read:group:jira`) |
| `POST /rest/api/3/issue/bulkfetch` | Current: `read:jira-work` (Beta: `read:issue-meta:jira`, `read:issue-security-level:jira`, `read:issue.vote:jira`, `read:issue.changelog:jira`, `read:avatar:jira`, `read:issue:jira`, `read:status:jira`, `read:user:jira`, `read:field-configuration:jira`) |
| `GET /rest/api/3/issueLinkType`, `GET /rest/api/3/field` | `read:jira-work` |
| `GET /rest/api/3/user/search` (подбор accountId по строке, Task 13) | Current: `read:jira-user` (Beta: `read:user:jira`, `read:user.property:jira`, `read:application-role:jira`, `read:avatar:jira`, `read:group:jira`) |
| `GET /rest/api/3/project/{project}/role/{id}` (участники роли) | Current: `read:jira-work` (Beta: `read:user:jira`, `read:group:jira`, `read:project-role:jira`, `read:project:jira`, `read:avatar:jira`, `read:project-category:jira`) |
| `GET /rest/api/3/group/member` (участники группы) | Current: **`manage:jira-configuration`**; Beta: `read:group:jira`, `read:user:jira`, `read:avatar:jira` |
| события задач (`created|updated|deleted:issue`), связей (`created|deleted:issuelink`), комментариев (`commented:issue`, `deleted:comment`) | `read:jira-work` |
| события вложений (`created|deleted:attachment`) | classic `read:jira-work`; granular `read:attachment:jira` |
| события спринтов (все пять) | classic `read:jira-work`; granular `read:sprint:jira-software` |

Нужен ли `read:jira-user`: да, если `user/search` (текст в `by`/`reporter`-подобных аргументах) остаётся в плане; без него эндпоинт недоступен (classic-скоупа взамен нет).

Ожидаемый глобальный список v1 (план, Global Constraints):

- `read:jira-work` — подтверждён: bulkfetch, search/jql, issue/bulkfetch, issueLinkType, field, роль проекта и все события задач, связей, комментариев, вложений и спринтов.
- `read:jira-user` — подтверждён: нужен для `GET /rest/api/3/user/search`.
- `read:board-scope:jira-software` — подтверждён: `GET /rest/agile/1.0/board` (вместе с `read:project:jira`, который входит в granular-набор того же вызова; в classic-списке не нужен, пока доски читаются basic/Forge-запросом приложения; точное требование проверит деплой Task 14).
- `read:sprint:jira-software` — подтверждён: спринты досок и granular-скоуп событий спринтов.
- `read:app-data:jira` — подтверждён (необязателен сейчас, станет обязательным): `GET .../jql/function/computation`.
- `write:app-data:jira` — подтверждён (то же): `POST .../jql/function/computation`.
- `storage:app` — не проверялся по REST-документации (скоуп Forge storage, не Jira); остаётся из плана без изменений.
- Открыто: classic-скоуп `GET /rest/api/3/group/member` — `manage:jira-configuration` (запись/админ-права недопустимы по «ничего не пишем»); раскрытие групп в `by`-аргументах требует granular `read:group:jira` + `read:user:jira` (+ `read:avatar:jira`) в манифесте либо другого способа — решает контроллер до Task 13.

## Consequences

- (а) Предел `changelog/bulkfetch` — **1 000** id, подтверждён текстом ошибки 400 на 1 001: `CHANGELOG_BATCH = 1000` (Task 5); `fieldIds` ≤ 10; пагинация `nextPageToken`. Эндпоинт доступен с basic-авторизацией; недоступность из Forge не проверялась (в Forge скоуп `read:jira-work`). Запасной путь не нужен, пометка «J-G6 под угрозой» не ставится. Время обхода (2,9 с на 5 000) на пустых историях не показательно; ворота меряет Task 20.
- (б) Старт спринта — **`startDate`**: Agile API `activatedDate` не отдаёт (проверено на future/active; closed — после засева). Task 8 `sprintWindow` берёт `startDate` (Q-R37).
- (в) Контекст функции: **`license`** есть (`active`, `billingPeriod`, `ccpEntitlementId`, `trialEndDate`, `supportEntitlementNumber`), но только у платных приложений Marketplace в production; в DEVELOPMENT/STAGING он `undefined`. **`environmentType`** в списке контекста обработчика не значится — брать из `getAppContext().environmentType`. Task 13 `licenceInput` читает `license` с запасом на `undefined` (dev = без ограничений по окружению, не по лицензии) и `environmentType` из `getAppContext()`.
- (г) Имена событий для манифеста (Tasks 14, 24, 27): `avi:jira:created|updated|deleted:issue`, `avi:jira:created|deleted:issuelink`, `avi:jira:commented:issue`, `avi:jira:deleted:comment`, `avi:jira:created|deleted:attachment`, `avi:jira-software:created|started|updated|closed|deleted:sprint`. **`avi:jira:updated:comment` в документации отсутствует** — правка комментария отдельным событием не гарантирована; Ruling Q-R38: правки комментариев обновляет часовая сверка, листинг не обещает секунды для правок (формулировка — Task 27). `changelog.id` документацией не подтверждён: Ruling Q-R39: идемпотентность событий не зависит от `changelog.id`; запасной ключ — `issue.id` + `timestamp` + содержимое `items`.
- (д) `issueLinkType` совпал с эталоном **не на 100%**: Blocks outward 1 863 против 1 190. Ruling Q-R36: аргумент, равный имени типа, — обе стороны через `issueLinkType`; аргумент, равный описанию направления, — только если оно не совпадает с именем какого-либо типа (без учёта регистра), иначе вычисляемый список id (дерево). Cloners, Duplicate, Relates точны.
- Лимиты функции: ответ ≤ 25 с, ≤ 1 000 значений в `{ jql }`, прекомпутации живут 7 дней без вычисления; предел числа модулей `jira:jqlFunction` не документирован — проверить деплоем 24 модулей (Task 14).

## M1 on site

Сайт `artuplabs-dev`, окружение development, приложение 2.x (13 функций в `autocompletedata`, `forge eligibility`: eligible). Прототип J-G5 снят (`forge uninstall`). Доска для спринтовых функций — `RPT scrum (browser-test)` (id 36; `RPT board` — kanban, спринтов нет). Закрытые и будущий спринты на доске созданы через Agile API (закрыт спринт «BT sprint», создан будущий «AQ future planned» с тремя задачами). Удаление задач на JQLG недоступно пользователю токена (нет DELETE_ISSUES), проверка события удаления сделана на SAM1. Тестовые задачи JQLG-40152…40156 остаются на сайте.

### Формы событий (живые тела, `forge logs`)

Расхождения с прежними фикстурами; фикстуры `test/fixtures/events/*.json` приведены к живым телам, добавлены `attachment-deleted`, `sprint-created`, `sprint-updated`, `sprint-deleted`; `eventRecord` читает все тела без `unknown`.

| Что | Живое тело |
|---|---|
| `timestamp` | строка (`"1791038284541"`), не число |
| смена родителя | `changelog.items[0] = { field: "IssueParentAssociation", fieldtype: "jira", from: "<id>", to: "<id>" }`, `fieldId` нет; `changelog.id` есть |
| связь | `issueLinkType = { id, name, inward, outward }` (не `inwardName/outwardName`); объекта `issueLink` нет; `sourceIssueId`/`destinationIssueId` на верхнем уровне |
| вложение | `attachment = { id, issueId, projectId, fileName, createDate, size, mimeType, author }`; `atlassianId` на верхнем уровне |
| комментарий | `comment = { id, author, body, updateAuthor, created, updated, jsdPublic }`; `visibility` нет; правка комментария приходит как второе `commented:issue`, `updated:comment` не приходит; каждый комментарий и вложение дают ещё `updated:issue` с `Comment`/`Attachment` |
| спринт | `sprint.id`, `originBoardId` — строки; `updated:sprint` несёт `oldValue: { name }`; `closed` несёт `completeDate` |
| удаление задачи | `fields` без `parent` у не-подзадачи; у удалённой подзадачи `parent` есть |
| прочее | `updated:issue` из Sprint-поля несёт `metadata: { operationType, sendMail }`; `associatedUsers` в событиях задач |

### Прочие проверки платформы

- `issueLinkType = "is blocked by"` → 834 (только входящая сторона), `= "blocks"` → 1 863 и `= "Blocks"` → 1 863 (имя типа, обе стороны).
- `kvs.query().where('key', beginsWith(...))` отдаёт ключи в лексикографическом порядке байтов: `zz:10, zz:9, zz:B, zz:a, zz:b, zz:c`.
- `getAppContext().environmentType` в development — `DEVELOPMENT`; `license` присутствует среди ключей контекста. Чтение `environmentType` из контекста resolver Custom UI на странице не проверялось.
- `jql/function/computation`: `used` выставляется первым вычислением (через 0,1 с после создания).
- Потребитель очереди, бросивший ошибку, вызывается повторно (`retryContext.retryCount: 1`, `FUNCTION_ERROR_HOSTED_APP_CODE`, примерно через 40 с).
- `POST /rest/api/3/changelog/bulkfetch` из Forge `asApp` доступен: 200.
- Первая `queue.push` сразу после `forge deploy` дважды вернула `400 Bad Request` (триггер и функция); следующие пуши проходят.
- Записи 429 с Retry-After в логах не встретились.

### Полнота M1 (`data/acceptance-complete-m1.json`, второй проход; первый — в отчёте задачи)

Эталон — обход REST. `complete: true` у 22 из 24 строк на втором проходе; `childIssuesOf` на всех уровнях (ожидалось 39 661) и `linkedIssuesOf("project in (JQLG, RPT)")` (ожидалось 5 922) вернули 0 без ошибки (первое обращение длится около 31 с, функция возвращает «Computing, retry in a minute», Jira отдаёт пустой результат, дальше значение остаётся пустым). Подробности и журнал — в отчёте задачи 17.

### Свежесть

- `newSubtask` (30 из 30): p50 2,8 с, p90 3,0 с, max 3,3 с. Прогон `fresh --group query --n 30` остановлен вручную: изменения связей (`newLink`) и полей (`field`) не были видны за 10 минут; потребитель очереди упирается в лимит 300 с на пересчёте больших групп `childIssuesOf` (см. отчёт).
- Группа `board` (n=3, остановлен после первого цикла): `nextSprint` и `previousSprint` не обновились за 10 минут каждый.
- Холодный старт: первое вычисление `subtasksOf("project = JQLG AND labels = jg-mid")` — 4,7 с без «Computing».

### Team-managed

Проект JQLT создан `acceptance.mjs seed-tm` (14 задач: 2 эпика, 6 историй, 6 подзадач, дубликатов нет); `issuesInEpics` 6 из 6, `subtasksOf` 6 из 6.
