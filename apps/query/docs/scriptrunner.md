# ArtUp Query и ScriptRunner: имена, сигнатуры, расхождения

Сверка 2026-10-03 (Task 1 плана v1). Источники: DC — справочник ScriptRunner for Jira Data Center
(`https://docs.adaptavist.com/sr4js/latest/features/jql-functions/included-jql-functions/<раздел>`,
разделы `issue-links`, `sub-tasks`, `sprint`, `comments`, `attachments`, `date`, `calculations`, `portfolio`);
Cloud — ScriptRunner Enhanced Search (`https://docs.adaptavist.com/sr4jc/latest/features/scriptrunner-enhanced-search/`,
страницы `.../scriptrunner-enhanced-search-jql-functions/{links-and-relationships,agile-and-sprint-management,date-and-time-management-datecompare}/`
и `.../comparison-with-scriptrunner-for-jira-server/`).
Страница `https://docs.adaptavist.com/sr4jc/latest/features/enhanced-search` из брифа отдаёт 404; взята рабочая
`.../features/scriptrunner-enhanced-search/`.

Вызов. ScriptRunner (DC и Cloud): `issueFunction in имя("подзапрос", …)`, в Cloud — только на экране Enhanced Search
(«JQL functions cannot be used within Jira's standard Issue Navigator»). У нас (Forge `jira:jqlFunction`):
`issue in имя(…)` прямо в поиске Jira, в фильтрах и на досках. Мигрант меняет одно слово (Q-R16).

## Таблица 24 функций

«—» = в ScriptRunner такой функции нет. DC-сигнатуры — дословно со страниц DC; смысл — фраза документации.

| Имя у нас | Имя ScriptRunner DC | Имя ScriptRunner Cloud | Аргументы DC (порядок) | Расхождение | Решение |
|---|---|---|---|---|---|
| `subtasksOf` | `subtasksOf` | `subtasksOf(Subquery)` | `("subquery")`; пустая строка = все подзадачи. «Retrieves sub-tasks belonging to issues matched by the provided subquery» ([sub-tasks](https://docs.adaptavist.com/sr4js/latest/features/jql-functions/included-jql-functions/sub-tasks)) | нет | как есть |
| `parentsOf` | `parentsOf` («This covers parent-subtask relationships only, not epic-story») | `parentsOf(Subquery, [Depth])`, пример `parentsOf("project = DEMO", "all")` | `("subquery")` | у нас любой уровень иерархии, включая эпики (§2); у Cloud — глубина вторым аргументом | у нас без аргумента глубины; Q-R25 |
| `epicsOf` | `epicsOf`: «Only retrieves Epics that have associated issues» ([issue-links](https://docs.adaptavist.com/sr4js/latest/features/jql-functions/included-jql-functions/issue-links)) | `epicsOf(Subquery)` | `("subquery")` | нет | как есть |
| `issuesInEpics` | `issuesInEpics` | `issuesInEpics(Subquery)` (на странице опечатка `issueInEpics`) | `("subquery")` | у нас и team-managed | как есть |
| `childIssuesOf` | — (DC: `portfolioChildrenOf(Subquery)` — только Advanced Roadmaps, [portfolio](https://docs.adaptavist.com/sr4js/latest/features/jql-functions/included-jql-functions/portfolio)) | `childrenOf(Subquery, [filter query])`: «all descendant issues (children to grandchildren)» | `portfolioChildrenOf("subquery")` | другое имя; у нас depth, у Cloud фильтр | имя `childIssuesOf`, без алиаса; Q-R25 |
| `linkedIssuesOf` | `linkedIssuesOf` | `linkedIssuesOf(Subquery, [link type])` | `("subquery", "link name"[, "link name"…])`; пример `linkedIssuesOf("","is blocked by", "is cloned by")`. Задачи самого подзапроса не входят | у DC несколько имён связей; у нас один linkType | один необязательный аргумент (имя типа или направления, §2); несколько — ошибка с подсказкой вызвать функцию дважды через OR |
| `linkedIssuesOfRecursive` | `linkedIssuesOfRecursive` | `linkedIssuesOfRecursive(Subquery, [Link name])` | `("subquery"[, "link type"…])` | вопрос 1 ниже: сходится с планом | как в плане: задача подзапроса входит, только если достижима по связи |
| `linkedIssuesOfRecursiveLimited` | `linkedIssuesOfRecursiveLimited` | то же, `(Subquery, Traversal depth, [Link name])` | `("subquery", "traversal depth", "link name")`; пример `("issue = SSP-2", 3, "is blocked by")` | нет | как есть |
| `hasLinks` | `hasLinks` | нет (Cloud: «documentation does not list hasLinks») | `()`, `("link name")`, `("link name", "number of links")`; примеры `hasLinks("blocks")`, `hasLinks("blocks", "+2")` | вопрос 5; у DC второй аргумент — число связей со знаком | Q-R19: принимает имя типа и направление; число связей — не в v1 |
| `hasLinkType` | `hasLinkType` | нет | `("link type")`: «searches for issues that have the specified link type in either direction» | вопрос 5 | синоним `hasLinks(linkType)`, Q-R19 |
| `hasSubtasks` | `hasSubtasks` | нет | `()` | нет | как есть |
| `addedAfterSprintStart` | `addedAfterSprintStart` | `addedAfterSprintStart(Board, [Sprint])` | `(board name/ID, [sprint name/ID])`: «added to the named board after the named sprint started (or all active sprints if a second argument is not provided)» ([sprint](https://docs.adaptavist.com/sr4js/latest/features/jql-functions/included-jql-functions/sprint)) | у DC без sprint — все активные спринты, у нас активный спринт доски | как в §2 |
| `removedAfterSprintStart` | `removedAfterSprintStart` | нет («Unavailable on Jira Cloud») | `(board name/ID, [sprint name/ID])` | вопрос 2: документация молчит | Q-R21 |
| `incompleteInSprint` | `incompleteInSprint` | нет | `(board name/ID, [sprint name/ID])`: «Show incomplete issues in the named sprint (or all active sprints …)» | у DC sprint необязателен; у нас обязателен (§2: «на момент закрытия») | Q-R26 |
| `completeInSprint` | `completeInSprint` | нет | то же | то же | Q-R26 |
| `previousSprint` | `previousSprint` | `previousSprint(Board)`: «issues from the last active sprint» | `(board name/ID)`: «assigned to the last completed sprint» | нет | как в §2 |
| `nextSprint` | `nextSprint` | `nextSprint(Board)` | `(board name/ID)` | нет | как в §2 |
| `commented` | `commented` | есть, но `inRole`/`inGroup` в Cloud не поддержаны | `("comment query")`; условия `by`, `after`, `before`, `on`, `inRole`, `inGroup`, `roleLevel`, `groupLevel`, `visibility` ([comments](https://docs.adaptavist.com/sr4js/latest/features/jql-functions/included-jql-functions/comments)) | вопрос 3; `by currentUser()` отклоняется (Q-R15); `visibility` (JSM) не в v1; `after 2025/03/28` — у нас только `YYYY-MM-DD` и `-N[dhm]` | Q-R22 |
| `lastComment` | `lastComment` | есть (без `inRole`/`inGroup`) | `("comment query")` — те же условия, к последнему комментарию | то же | Q-R22 |
| `hasComments` | `hasComments` | есть | `()`, `(number)`, `('+5')`, `('-3')`: `hasComments(3)` — ровно 3, `'+5'` — больше 5, `'-3'` — меньше 3 | у нас §2: «≥ n» | Q-R17 |
| `fileAttached` | `fileAttached` | нет в страницах Cloud | `("attachment query")`; предикаты `by`, `after`, `before`, `on` ([attachments](https://docs.adaptavist.com/sr4js/latest/features/jql-functions/included-jql-functions/attachments)) | у нас добавлен `ext` (расширение) — у DC его в `fileAttached` нет | Q-R22: `on` сохраняется, `ext` — наше добавление |
| `hasAttachments` | `hasAttachments` | нет | `([file extension], [number of attachments])`; `hasAttachments("pdf", "+3")`, `hasAttachments("", "+5")` | второй аргумент (число со знаком) — нет у нас | Q-R18 |
| `dateCompare` | `dateCompare` | `dateCompare(Subquery, expression)`, плюс `.clearTime()` | `("Subquery", "date comparison expression")`; операторы `<`, `>`, `<=`, `>=`, `=`; интервалы `+2w`, `+1w`, `+2d`; поля `created`, `dueDate`, `resolutionDate`, `firstCommented`, `lastCommented`, date-picker и date-time кастомные ([date](https://docs.adaptavist.com/sr4js/latest/features/jql-functions/included-jql-functions/date)) | вопрос 4; `.clearTime()` нет | Q-R23 |
| `expression` | `expression` | нет («Server/DC Only») | `("subquery", "expression")`; операторы `>`, `<`, `>=`, `<=`, `==`, `!=`; единицы `wd`, `ww`, `d`, `h`, `m` ([calculations](https://docs.adaptavist.com/sr4js/latest/features/jql-functions/included-jql-functions/calculations)) | вопрос 4; единицы | Q-R24 |

Получается: Cloud-версия ScriptRunner не имеет `hasLinks`, `hasLinkType`, `hasSubtasks`, `removedAfterSprintStart`,
`incompleteInSprint`, `completeInSprint`, `expression`, `fileAttached`, `hasAttachments`; у ArtUp Query они есть.

## Ответы на вопросы, от которых зависит код

1. **`linkedIssuesOfRecursive` — входят ли задачи подзапроса.** Входят, но только если достижимы по связи.
   Цитата: «The query returns all issues linked to SSP-1, and all issues linked to those that are linked to SSP-1,
   and so on», и пример: «SSP-1 is returned as it is linked to SSP-2 and SSP-3» (SSP-1 вернулся из-за цикла).
   У `linkedIssuesOf` «does not include the subquery issues themselves» — не оговорено прямо, поведение
   по аналогии. Совпадает с допущением плана. Источник: [issue-links](https://docs.adaptavist.com/sr4js/latest/features/jql-functions/included-jql-functions/issue-links).
2. **`removedAfterSprintStart`: убранные и затем возвращённые.** Документация молчит. Сигнатура: «Show issues that were
   removed from the named board after the named sprint started (or all active sprints if second argument is not
   provided)». Допущение плана сохраняется (Q-R21). Источник: [sprint](https://docs.adaptavist.com/sr4js/latest/features/jql-functions/included-jql-functions/sprint).
3. **`commented`: `inRole`/`inGroup`.** Роль/группа автора комментария. Цитата: «Do not confuse `roleLevel` and `inRole`.
   `roleLevel` is the security level applied to a comment, `inRole` refers to the role(s) of the person making the
   comment». `roleLevel`/`groupLevel` есть, это видимость комментария. `commented()` без условий — документация не
   описывает. Источник: [comments](https://docs.adaptavist.com/sr4js/latest/features/jql-functions/included-jql-functions/comments).
   Cloud: «Comment/worklog functions using `inGroup` or `inRole`» не поддержаны ([comparison](https://docs.adaptavist.com/sr4jc/latest/features/scriptrunner-enhanced-search/comparison-with-scriptrunner-for-jira-server/)).
4. **`dateCompare` и `expression`.** `dateCompare`: операторы `<`, `>`, `<=`, `>=`, `=`; «Time Interval Syntax: `+2w`,
   `+1w`, `+2d`», интервал при поле слева: `created +2w > resolutionDate`; псевдополя `firstCommented`, `lastCommented`
   («hidden field: date of first comment») ([date](https://docs.adaptavist.com/sr4js/latest/features/jql-functions/included-jql-functions/date)).
   `expression`: «`wd` — working day (based on your time tracking configuration)», «`ww` — working week (5 working days
   × wd value)», «`d` — 24-hour day (for non-time-tracking comparisons)», `h`, `m`; «Use `5*wd` rather than `5d` when
   comparing estimates»; пример `timespent > originalestimate + 5*wd`; кастомные поля — имя без пробелов или
   `customfield_12345` ([calculations](https://docs.adaptavist.com/sr4js/latest/features/jql-functions/included-jql-functions/calculations)).
5. **`hasLinks` / `hasLinkType`.** `hasLinks` — описание направления: «for the outward or inward link description, for
   example, `blocks`, `is blocked by`, `duplicates`, `is duplicated by`»; `hasLinkType` — имя типа, «in either direction»
   (`Blocks`, `Duplicate`, `Cloners`). Источник: [issue-links](https://docs.adaptavist.com/sr4js/latest/features/jql-functions/included-jql-functions/issue-links).

## Не проверено

Страницы документации читал пересказ модели WebFetch, не сырой текст; дословность цитат — по этому пересказу.
Версия страниц — `latest` на 2026-10-03.
