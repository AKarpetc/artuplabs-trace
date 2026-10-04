# ArtUp Query v1 — план реализации

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Forge-приложение для Jira Cloud с 24 JQL-функциями, которых нет в родном JQL (по результату запроса, по иерархии, по связям, по истории спринтов, по комментариям, вложениям и сравнению полей), с результатом, свежим через секунды после правки, полным при любом размере и без единой записи в задачи клиента.

**Architecture:** Каждая функция — модуль `jira:jqlFunction` с precomputation: функция возвращает родной JQL (`id in (…)`, `parent in (…)`, `issueLinkType …`, `sprint = N`), Jira хранит его, приложение переписывает его по событиям. Событие → запись журнала в KVS (ключ на событие) → очередь `refresh` → пересчёт только затронутых групп precomputation (пересечение затронутых id с кэшем значений и внутренним запросом). Больше 1 000 значений — дерево вложенных вызовов страниц (скрытый последний аргумент `__aq:l<n>` / `__aq:m<n>`). История спринтов, комментарии и вложения — свой индекс в Forge SQL (только id, даты, авторы, видимость, расширения), заполняемый `backfill` по `changelog/bulkfetch` и `issue/bulkfetch` и поддерживаемый событиями. Ядро — чистые функции `src/core/*`; ввод-вывод — `src/infra/*`; источники значений — `src/compute/*`; оркестрация — `src/handlers/*`. Страница приложения (`jira:globalPage`) и админ-страница (`jira:adminPage`) — Custom UI на Atlaskit, как в Reports.

**Tech Stack:** Forge (`jira:jqlFunction` × 24, `trigger`, `consumer`, `scheduledTrigger`, `jira:globalPage`, `jira:adminPage`, `sql`, resolver; nodejs24.x, arm64), `@forge/api` 8.2.0, `@forge/kvs` 2.0.7, `@forge/events` 3.0.7, `@forge/sql` 4.0.7, `@forge/resolver` 2.0.0, React 18 + Vite + Atlaskit + `@atlaskit/tokens` (версии — как в `apps/reports/static/app/package.json`), Vitest 5.0.2, ESLint 8.57.1, `yaml` 2.9.1 (dev, разбор манифеста в тестах), Node 22 для скриптов замера.

**Spec:** [2026-10-03-artup-query-design.md](2026-10-03-artup-query-design.md) (обязательна) + rulings [2026-10-03-artup-query-v1-rulings.md](2026-10-03-artup-query-v1-rulings.md) + бриф [../25_app5_jql.md](../25_app5_jql.md) §4 (планка приёмки) и §11 (выводы прототипа). Прототип, с которого переносится механика обновления: `atlassian/tools/j-g5-jqlfn/src/index.js`. Образец устройства приложения: `apps/reports` (каркас, лицензия, i18n, тема, guard-тесты, CI), образец Forge SQL: `apps/trace/src/infra/{schema.js,repo.js}`.

---

## Для владельца: что решено в плане без вас

Q-R9…Q-R15 записаны в rulings вместе со спецификацией; Task 1 продолжает с Q-R16 (строки таблицы `| Q-Rn | решение | почему |`). Те, что меняют спецификацию:

| # | Решение | Почему | Цена ошибки |
|---|---|---|---|
| Q-R9 | `hasLinks`/`hasLinkType` → родной `issueLinkType …`; `hasSubtasks` → живой поиск подзадач и их родителей; `previousSprint`/`nextSprint` → родной `sprint = <id>` через Agile API. Эти функции не требуют индекса: строятся в M1 и остаются в v1 при любом исходе J-G6. Таблицы `issue_node`/`issue_link` не строятся — иерархия и связи читаются живыми запросами; J-G6 меряет то, что строится (changelog Sprint+status), порог не меняется | меньше индекса — меньше рисков свежести и полноты; родной JQL всегда свеж и без предела 1 000 | если `issueLinkType` в Jira считает иначе, чем REST, — Task 17 это поймает, функция переходит на список id |
| Q-R10 | страница дерева — скрытый последний аргумент `__aq:l<n>` (лист) / `__aq:m<n>` (узел); до замера — 1 уровень (≤ 9 000 значений), 2 уровня (≤ 81 000) включаются только после проверки на сайте (Task 30); сверх ёмкости — явная ошибка с числами | прототип доказал 1 уровень (9 листьев), 2 уровня не мерялись | без 2 уровней функции вида `expression` на всём сайте дают ошибку вместо результата |
| Q-R11 | если J-G7 не пройдён, в v1.1 уходят только функции на индексе комментариев/вложений (`commented`, `lastComment`, `hasComments`, `fileAttached`, `hasAttachments(ext)`); `dateCompare`/`expression` индекса не требуют и остаются (без псевдополей `firstCommented`/`lastCommented`); `hasAttachments()` без аргумента — родной `attachments is not EMPTY` | Q-R1: непроверенная часть не задерживает проверенную | две функции M3 выходят без ворот J-G7 — они их и не касаются |
| Q-R12 | даты в условиях (`after`, `on`, `-7d`, `startOfWeek()`) — UTC, неделя с понедельника; длительности в `expression`: 1d = 8h, 1w = 5d (умолчание Jira) | Jira не передаёт в функцию ни часовой пояс пользователя, ни настройки учёта времени (их чтение требует прав администратора) | на границе суток результат сдвинут на часовой пояс; написано в справочнике функций |
| Q-R13 | исключение проектов (админ-страница) действует на индекс (M2/M3); функции M1 читают живые данные и проектом не ограничены; функция спринта на доске исключённого проекта отвечает ошибкой «Project X is excluded…» | спецификация §4 требует пояснения, а не тихого пустого результата | — |
| Q-R14 | журнал ошибок страницы хранит имя функции и текст ошибки, но не аргументы (в них JQL клиента) | приватность (§4 спецификации) | диагностика без текста запроса |
| Q-R15 | `currentUser()` внутри аргументов отклоняется явной ошибкой | precomputation общий для всех пользователей (Q-R3), внутренний запрос идёт от имени приложения | — |

Решения сверки плана перед исполнением (pre-flight, коммит JQL-7; Task 1 записывает P-1 … P-7 в rulings строками после своих строк сверки, текст решения и «почему» — дословно из этой таблицы; P-8 — сама строка сверки по вопросам 3–4):

| # | Решение | Почему | Цена ошибки |
|---|---|---|---|
| P-1 | вердикт полноты J-G6 — 30 из 30 `complete` против эталона B (changelog по REST); сравнение засева A с B — проверка сеялки: расхождение означает починку засева или инструмента и повтор замера, а не «не пройдено» | порог §9 спецификации не меняется | нет |
| P-2 | J-G7 меряет и вложения (фазы `attachment-latency`, `attachment-complete`); если не проходят только вложения, в v1.1 уходят только `fileAttached` и `hasAttachments(ext)` (Q-R11) | §9: «метаданные комментариев **и вложений**» | лишнее время замера |
| P-3 | размер случая полноты для каждой функции — максимальный, какой дают данные; функции спринта — плюс один спринт на 1 000+ задач из `jg-task`; `hasComments("1")`, `commented("after 2020-01-01")`, `hasAttachments()` — на всём сайте; документ приёмки пишет фактический размер каждого случая | §8: полнота «на данных > 1 000 и > 10 000» | время засева |
| P-4 | 25 с — предел платформы на ответ функции; внутренний бюджет вычисления — `FUNCTION_BUDGET_MS = 20 000`, чтобы успеть записать очередь, `q:jobs` и журнал ошибок; поведение по §6 («Computing, retry in a minute») не меняется | запас на запись состояния до предела платформы | нет |
| P-5 | кэш значений — по группе: `v:<sha1(groupKey)>:{m,c<i>,w<i>}` вместо `v:<pcId>:<chunk>` §3 | страницы дерева читают набор значений корня (Review Focus 2); `w<i>` — список отслеживаемых id, по нему решается, что пересчитывать (§5) | нет |
| P-6 | эталоны приёмки (`scripts/lib/reference.mjs`) и инструменты замера (`atlassian/tools/*`, `scripts/lib/http.mjs`, `scripts/lib/latency.mjs`) намеренно не импортируют `src/` и держат свои копии `pool`, разбора условий и вычисления выражений | эталон, собранный из кода продукта, не поймает ошибку продукта | дубли кода в скриптах |
| P-7 | покрытие ветвлений §8 — порог: `npm run coverage` (`@vitest/coverage-v8`), ветви `src/core/**` ≥ 90% | §8: «vitest, покрытие ветвлений» | несколько лишних тестов |
| P-8 | итог сверки ScriptRunner по вопросам 3–4 Task 1 закрепляется строкой Q-R16+: как в ScriptRunner DC — `commented()` без условий = любой комментарий; `roleLevel`/`groupLevel` = видимость комментария; у `fileAttached` условие `on` сохраняется | §2 записывает `commented(clauses)` без скобок; план делает условия необязательными и добавляет `roleLevel`/`groupLevel`, `on` | нет |

Ворота: J-G6 — Task 20 (перед кодом M2), J-G7 — Task 21 (перед кодом M3). Task 21 исполняется всегда, при любом исходе J-G6. Не прошло — группа уходит в v1.1 строкой Ruling, задачи её кода пропускаются, план идёт дальше (Q-R1).

Модели исполнителей: у каждой задачи строка **Model** (opus — любой код, скрипты, тесты, отладка; sonnet — замеры, сбор данных и документации, браузер, переводы, снимки, листинг). Задача, где есть и то и другое, делится по шагам: «**Model:** opus (шаги …), sonnet (шаги …)».

---

## Global Constraints

- Только Forge; ноль Connect-модулей; **ноль egress** — нет `permissions.external`, нет удалённых шрифтов/CDN/картинок; после каждого деплоя `forge eligibility -e development --non-interactive` печатает eligible для Runs on Atlassian.
- **Ничего не пишем в задачи клиента.** Скоупы v1 (фиксируются Task 3, ожидаемый список): `read:jira-work`, `read:jira-user`, `read:board-scope:jira-software`, `read:sprint:jira-software`, `read:app-data:jira`, `write:app-data:jira` (precomputation API, как в прототипе), `storage:app`. Никогда `write:jira-work` и никакой другой `write:*`, кроме `write:app-data:jira`.
- Хранилище: KVS — `t:<ts15>:<rand>` (журнал), `v:<sha1(groupKey)>:{m,c<i>,w<i>}` (кэш значений группы, ≤ 5 000 на ключ; ключ по группе, а не по `pcId` — P-5), `q:pending`, `q:running`, `q:lastWrittenStart`, `q:jobs`, `log:errors`, `log:refresh`, `idx:progress:<part>`, `idx:waiting:<part>` (проекты, ждущие заполнения части после её текущего заполнения), `cfg:excluded`, `cfg:sprintFields`. Forge SQL — `sprint`, `sprint_event`, `status_event` (M2), `comment_meta`, `attachment_meta` (M3). Текст задач, комментариев и вложений не хранится нигде, включая логи.
- Ошибки в JQL-редакторе — на английском (Q-R6); их тексты формируются только в `src/core/**` (`errors.js` — общие тексты `ERR.*`, в том числе приставка имени функции `ERR.withFunction`; разборщики `args.js`, `links.js`, `boards.js`, `dates.js`, `comment-clauses.js`, `expression.js`), слои `compute`/`handlers` берут их оттуда; текст Jira об ошибке в subquery передаётся как есть (§6); страница и админ-страница — 26 языков: zh-CN, zh-TW, cs-CZ, da-DK, nl-NL, en-US, en-GB, et-EE, fi-FI, fr-FR, de-DE, hu-HU, is-IS, it-IT, ja-JP, ko-KR, no-NO, pl-PL, pt-BR, pt-PT, ro-RO, ru-RU, sk-SK, tr-TR, es-ES, sv-SE. Каждый ключ появляется во всех 26 файлах в том же коммите (тесты сверяют ключи, плейсхолдеры и категории множественного числа).
- Custom UI: React 18 + компоненты Atlaskit + `@atlaskit/primitives` + токены дизайна. **Никаких hex/rgb/hsl/именованных цветов** в `static/app/src` (guard-тест). Визуальный стандарт Reports: ширина на всю страницу с `space.300` по бокам, секции через `space.400`, карточки `elevation.surface.raised` + `radius.large`, одна основная кнопка на вид, заголовки `@atlaskit/heading`, текст 14px, длинные строки переносятся, загрузка — скелетоны/спиннеры на месте, пустые и ошибочные состояния — иллюстрация + фраза + действие; светлая и тёмная темы.
- Слои: `src/core/**` — чистые функции: без I/O, без `Date.now()`/`new Date()` без аргумента, без случайности (время и колбэки передаются параметрами). `src/infra/**` — KVS, SQL, REST, очередь. `src/compute/**` — источники значений функций. `src/handlers/**` — оркестрация. Обработчики Forge собираются в `src/index.js` из `src/deps.js`.
- Все числовые пределы (размеры страниц и пачек, параллелизм, сроки, предельные значения аргументов) — в `src/core/limits.js` и только там; каталог ссылается на `MAX_DEPTH`/`COUNT_MAX`; задача, которой нужен новый предел, дописывает его в `limits.js`.
- Стиль кода как в Reports: vanilla JS/JSX, ES-модули, **без `//` комментариев внутри тел функций**, JSDoc 1–2 строки на экспортируемых функциях, без упоминаний задач, плана, спецификации и rulings в коде. Guard-тесты: `test/guards.test.js` (Task 5) — `src/**`; `static/app/test/guards.test.js` (Task 4) — `static/app/src/**`.
- Тесты: Vitest; одно поведение на `it`, имя называет поведение; целые значения сравниваются через `toEqual`. Покрытие ветвлений (P-7): `npm run coverage` (`@vitest/coverage-v8`), порог — ветви `src/core/**` ≥ 90%; задача, меняющая `src/core/**`, запускает его в шаге Run, CI запускает его вместо `npm test`. Повторяемые в тестах помощники — общими файлами (`test/fakeKvs.js`, `test/fakeJira.js`, `test/handlers/makeDeps.js`), не копиями.
- Коммиты: `JQL-<n>: <Description>` + пустая строка + `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`; нумерация: JQL-6 — план, JQL-7 — поправки pre-flight, Task N → JQL-(N+7) (Task 1 = JQL-8 … Task 34 = JQL-41). Локальная ветка `jql-v1`; не пушить, не открывать PR, не сливать в main.
- Секреты: `set -a && . /Users/artyomkarpets/IncomeApps/projects/DistributB2B/.env && set +a` перед forge и REST; токены не печатать.
- Регистрация: `forge register -s 249db86b-0aa6-4b81-96ba-62341736ad15` (Developer Space «ArtUp Labs»). Деплой — **только `development`** до решения владельца на чекпоинте C2.
- `forge install --upgrade` зависает после успеха: запускать как `perl -e 'alarm 300; exec @ARGV' forge install --upgrade …`.
- Решения без владельца — строкой в `atlassian/plans/2026-10-03-artup-query-v1-rulings.md` (`| Q-Rn | решение | почему |`, продолжая номера) и в конце сессии списком.
- Ворота записаны до замера и после замера не меняются; числа в документах — только измеренные или с источником (`context/method.md`).
- Цена листинга $175/мес за 200, ≤ 10 пользователей бесплатно (`app.licensing.enabled: true`).
- Площадка проверки: `https://artuplabs-dev.atlassian.net`, проекты JQLG (40 000 задач) + RPT (10 000), засев `atlassian/tools/seed-jira-jqlg.mjs`.

## Review Focus

1. **Подзапрос с кавычками, обратными слэшами, юникодом или вложенной функцией приложения** (`subtasksOf("issue in linkedIssuesOf(\"project = A\", \"blocks\")")`, `summary ~ "\"x\""`) → вызовы страниц дерева повторяют аргументы байт в байт и Jira их разбирает; группа корня и страниц одна. Тесты: Task 6 `quote`/`pageCall` с `"` и `\`, Task 5 `groupKey` корня и страницы.
2. **Результат пересекает 1 000 / 9 000 между вычислением корня и чтением страницы** (корень дал 1 200 значений, правка уменьшила до 800 до запроса листа 2) → лист за пределами значений даёт `id = -1`, без ошибки и без дублей; `refresh` переписывает корень и все страницы группы из одного набора значений. Тесты: Task 6 «leaf beyond values», Task 14 «rewrites root and pages from one value set».
3. **Всплеск: журнал ≥ 100 записей, неизвестное событие, сбой записи precomputation** → пересчитываются все активные группы; записи журнала удаляются только после успешной записи — ни одно изменение не теряется. Тесты: Task 7 `summarizeJournal` (`all`), Task 14 «keeps journal rows when the write fails».
4. **Доски и спринты с одинаковыми или числовыми именами** («2024», две доски «Team») → строка из цифр сначала ищется как id, потом как имя; неоднозначное имя — ошибка с подсказкой использовать id, не произвольный выбор. Тесты: Task 8 `matchBoard`/`matchSprint`.
5. **Даты и условия на границах**: `on 2026-03-29` (переход на летнее время не влияет — UTC), `-0d`, `startOfWeek(-1)`, автор с пробелами в кавычках, `currentUser()` → явная ошибка (общий precomputation). Тесты: Task 25 `parseDate`/`parseClauses`, Task 5 `currentUser()`.

---

## Структура файлов (`apps/query`)

```
apps/query/
  manifest.yml                       24 jqlFunction (по группам), триггеры, очередь, расписание, SQL, 2 страницы
  package.json, .eslintrc, .gitignore, AGENTS.md, README.md, vitest.config.mjs
  locales/<26>.json                  заголовки модулей (globalPage, adminPage)
  docs/scriptrunner.md               Task 1: сверка имён и сигнатур
  docs/live-checks.md                Task 3, 17, 30: документация и замеры платформы
  src/index.js                       экспорт обработчиков Forge
  src/deps.js                        сборка зависимостей для обработчиков (боевая)
  src/access.js                      решение по лицензии (копия Reports)
  src/core/limits.js                 все пределы
  src/core/errors.js                 тексты ошибок JQL-редактора
  src/core/catalog.js                24 функции: имя, ключ, группа, семейство, аргументы, примеры
  src/core/ids.js                    byNumber, sortIds — порядок id для ядра, compute и infra
  src/core/args.js                   разбор аргументов, токен страницы, ключ группы
  src/core/jql-build.js              EMPTY, quote, pageCall
  src/core/tree.js                   форма дерева, фрагмент корня/узла/листа
  src/core/events.js                 событие → затронутые id и виды изменений
  src/core/affected.js               журнал → решение, какие группы пересчитать; сверка
  src/core/readiness.js              готовность индекса для групп M2/M3
  src/core/links.js                  тип связи, связанные id, замыкание, родной hasLinks
  src/core/hierarchy.js              узлы, родители, эпик, потомки
  src/core/boards.js                 доска/спринт по имени или id, предыдущий/следующий/активный
  src/core/sprint-history.js         changelog → события спринта/статуса; added/removed/complete/incomplete
  src/core/dates.js                  абсолютные и относительные даты (UTC)
  src/core/comment-clauses.js        условия commented/lastComment/fileAttached
  src/core/expression.js             разбор и вычисление dateCompare/expression
  src/infra/pool.js                  ограниченный параллелизм
  src/infra/jira.js                  REST от имени приложения: поиск, bulkfetch, changelog, Agile, precomputation
  src/infra/journal.js               журнал KVS
  src/infra/cache.js                 кэш значений групп KVS
  src/infra/state.js                 очередь/аренда/ошибки/прогресс индекса/исключения
  src/infra/queue.js                 очередь @forge/events
  src/infra/schema.js                миграции Forge SQL (M2, M3)
  src/infra/indexRepo.js             строки индекса (M2, M3)
  src/compute/hierarchy.js           subtasksOf, parentsOf, epicsOf, issuesInEpics, childIssuesOf, hasSubtasks
  src/compute/links.js               linkedIssuesOf(Recursive/Limited), hasLinks, hasLinkType
  src/compute/boards.js              previousSprint, nextSprint
  src/compute/sprints.js             added/removedAfterSprintStart, complete/incompleteInSprint (M2)
  src/compute/comments.js            commented, lastComment, hasComments, fileAttached, hasAttachments (M3)
  src/compute/fields.js              dateCompare, expression (M3)
  src/handlers/functions.js          вычисление функции: лицензия, аргументы, кэш страниц, бюджет
  src/handlers/trigger.js            событие → индекс → журнал → задача очереди
  src/handlers/refresh.js            consumer: проходы пересчёта, задачи compute, verify
  src/handlers/reconcile.js          раз в час: сверка и добивка индекса
  src/handlers/backfill.js           первичное заполнение индекса порциями (M2, M3)
  src/handlers/lifecycle.js          установка/обновление: миграции и запуск backfill
  src/handlers/resolvers.js          getAccess, getStatus, админ-действия
  src/handlers/indexing.js           части индекса, запись по событиям, добивка пропусков
  src/handlers/admin.js              действия админ-страницы
  test/**                            зеркалит src/; test/fakeKvs.js, test/fakeJira.js, test/handlers/makeDeps.js, test/fixtures/**
  test/guards.test.js                guard-тест src/**: без `//` в функциях, ядро без часов, без упоминаний плана
  scripts/live-checks.mjs            Task 3
  scripts/acceptance.mjs, scripts/lib/{http.mjs,latency.mjs,reference.mjs,report.mjs}   Task 16, 31
  scripts/gen-manifest-functions.mjs Task 13: блок YAML функций из каталога
  static/app/                        Custom UI (копия оболочки Reports): global-page, admin-page; общие components/Card.jsx, status/IndexProgress.jsx
```

Вне `apps/query`: `atlassian/tools/j-g67-index/` и `atlassian/tools/{seed-jira-sprints.mjs,seed-jira-comments.mjs,measure-jql-jg67.mjs}` (прототип и замеры ворот J-G6/J-G7), `atlassian/plans/2026-10-03-artup-query-acceptance.md`, `atlassian/listing-query/`, `site/query/`, правовые страницы `site/{privacy,terms,security,support}.html`.

---
## Этап 0 — первые проверки (§10 спецификации)

### Task 1: Сверка имён и сигнатур с ScriptRunner, 20 фильтров-образцов, rulings плана

**Model:** sonnet

Задача измеряет и записывает; кода продукта нет.

**Files:**
- Create: `apps/query/docs/scriptrunner.md`, `apps/query/test/fixtures/sr-samples.json`
- Modify: `atlassian/plans/2026-10-03-artup-query-v1-rulings.md`

**Interfaces:**
- Produces: `sr-samples.json` = `{ "samples": [ { "id": 1, "source": "<URL страницы документации>", "scriptrunner": "<JQL как в документации>", "query": "<тот же смысл на ArtUp Query и данных JQLG/RPT>", "group": "<группа каталога: query|site|board|sprint|comment|attachment|fields>", "reference": { "fn": "subtasksOf", "args": ["project = JQLG AND labels = jg-mid"], "and": "<родной JQL-сомножитель или null>" }, "meaning": "<одна фраза>" } ] }` (`query` = `issue in <fn>(<args>)` и, если `and` не null, ` AND <and>`; фаза `sr` сверяет его с эталоном `REFERENCES[fn](args)` ∩ `ids(and)`, а образец группы, не отгруженной по воротам, пропускает с `skipped: 'v1.1'`) — ровно 20 записей; потребитель — фаза `sr` скрипта приёмки (Task 31). `docs/scriptrunner.md` — таблица по 24 функциям: имя у нас | имя ScriptRunner DC | имя ScriptRunner Cloud | аргументы DC (порядок) | расхождение | решение.

- [ ] **Step 1: Загрузить WebFetch.** Вызвать ToolSearch с запросом `select:WebFetch`.

- [ ] **Step 2: Документация ScriptRunner DC.** WebFetch страниц справочника JQL-функций ScriptRunner for Jira Server/DC на `docs.adaptavist.com` (разделы Issue Links, Sub-tasks/Hierarchy, Agile/Sprint, Comments, Attachments, Date and Calculations/`dateCompare`/`expression`). Начать с `https://docs.adaptavist.com/sr4js/latest/features/jql-functions/included-jql-functions` и идти по ссылкам. Для каждой функции из §2 спецификации записать дословно сигнатуру и одну фразу смысла с URL.

- [ ] **Step 3: Документация ScriptRunner Cloud (Enhanced Search).** WebFetch `https://docs.adaptavist.com/sr4jc/latest/features/enhanced-search` и страниц его функций; записать, какие имена есть в Cloud и как их вызывают (`issueFunction in …` у ScriptRunner против `issue in …` у Forge `jira:jqlFunction`).

- [ ] **Step 4: Заполнить `docs/scriptrunner.md`.** Таблица 24 строки. Отдельно ответить на вопросы, от которых зависит код (каждый ответ — с цитатой и URL):
  1. `linkedIssuesOfRecursive` — входят ли в результат сами задачи подзапроса;
  2. `removedAfterSprintStart` — учитываются ли задачи, убранные и затем возвращённые;
  3. `commented` — смысл `inRole`/`inGroup` (роль/группа автора или видимость комментария), есть ли `roleLevel`/`groupLevel`;
  4. синтаксис `dateCompare` (операторы, интервалы `+2d`, псевдополя `firstCommented`/`lastCommented`) и `expression` (единицы длительностей);
  5. `hasLinks` / `hasLinkType` — принимают имя типа или описание направления.

- [ ] **Step 5: 20 фильтров-образцов.** Выбрать из документации 20 примеров JQL, покрывающих все группы (по запросу 6, связи 4, иерархия 2, спринты 3, комментарии 2, вложения 1, поля 2), записать в `test/fixtures/sr-samples.json` по схеме Interfaces; в `query` — тот же смысл на наших данных: проекты JQLG/RPT, метки `jg-mid`, `jg-big`, `jg-lnk`, `jg-task`, доска «JQLG board» (создаёт Task 18), `issue in` вместо `issueFunction in`. Каждый образец — в пределах возможностей эталона (`scripts/lib/reference.mjs`, Tasks 16, 24, 27, 28), иначе брать другой пример документации: `reference.fn` — функция каталога; комментарии — условия `by <accountId>`, `after`/`before`/`on` (дата `YYYY-MM-DD` или `-N[dhm]`), `inRole`, `inGroup`, `roleLevel`, `groupLevel`; вложения — `by`, `after`, `before`, `on`, `ext`; `dateCompare`/`expression` — поля, числа, длительности `Nw/Nd/Nh/Nm`, `+ - * /`, сравнения, `and`/`or`, псевдополя `firstCommented`/`lastCommented`. Проверить: `node -e "const s=require('./apps/query/test/fixtures/sr-samples.json').samples; const g=['query','site','board','sprint','comment','attachment','fields']; if(s.length!==20||s.some((x)=>!g.includes(x.group))) throw new Error(s.length); console.log('ok')"` → `ok`.

- [ ] **Step 6: Rulings.** Q-R9 … Q-R15 уже записаны в `atlassian/plans/2026-10-03-artup-query-v1-rulings.md` вместе со спецификацией — их не дописывать. Дописать в ту же таблицу, начиная с Q-R16: по каждому расхождению Step 4 — строку: решение (как делаем у себя) и почему. Обязательно строка про `issue in` вместо `issueFunction in` (мигранты меняют одно слово; страница приложения это объясняет). Обязательно строка по вопросам 3–4 (P-8): «как в ScriptRunner DC: `commented()` без условий = любой комментарий; `roleLevel`/`groupLevel` = видимость комментария; у `fileAttached` условие `on` сохраняется» — с цитатой и URL; если документация говорит иначе — записать её смысл и поправить каталог (Task 5) и ожидания Task 25 при их исполнении. После строк сверки — по строке на каждое решение P-1 … P-7 из раздела «Для владельца» (решение и «почему» дословно, следующие номера Q-Rn); P-8 уже записан строкой сверки по вопросам 3–4. Если ответ на вопрос 1–3 расходится с допущениями этого плана (рекурсия включает задачи подзапроса только при достижимости по связи; «убраны» = убраны после старта и не возвращены до закрытия; `inRole`/`inGroup` = автор состоит в роли/группе, `roleLevel`/`groupLevel` = видимость), — записать Ruling с выбранным смыслом и поправить ожидания в тестах Task 8 / Task 22 / Task 25 при их исполнении.

- [ ] **Step 7: Commit**

```bash
git add apps/query/docs/scriptrunner.md apps/query/test/fixtures/sr-samples.json atlassian/plans/2026-10-03-artup-query-v1-rulings.md
git commit -m "JQL-8: Record ScriptRunner names, signatures and 20 sample filters

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 2: 0 потерь на 150 изменениях на версии прототипа с журналом

**Model:** sonnet (при потерях отладка — отдельный исполнитель opus по superpowers:systematic-debugging)

**Files:**
- Modify: `atlassian/tools/measure-jql-jg5.mjs` (таймаут запроса), `atlassian/25_app5_jql.md` (§11, строка результата)

**Interfaces:**
- Produces: вердикт «0 потерь на 150 изменениях» с числами для Task 14 (механика журнала переносится в продукт как есть) и для приёмки §4 «полнота».

- [ ] **Step 1: Таймаут и повтор в инструменте.** В `api()` файла `atlassian/tools/measure-jql-jg5.mjs` добавить к `fetch` параметр `signal: AbortSignal.timeout(30000)`; ветка `catch` уже повторяет сетевые ошибки — `TimeoutError` попадает туда же. Изменение:

```js
      res = await fetch(`${SITE}${path}`, {
        method,
        headers: { Authorization: auth(), Accept: 'application/json', ...(body ? { 'Content-Type': 'application/json' } : {}) },
        body: body ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(30000),
      });
```

Run: `node --check atlassian/tools/measure-jql-jg5.mjs` → без вывода.

- [ ] **Step 2: Деплой прототипа с журналом.**

```bash
set -a && . /Users/artyomkarpets/IncomeApps/projects/DistributB2B/.env && set +a
cd atlassian/tools/j-g5-jqlfn && npm install && forge deploy -e development --non-interactive
perl -e 'alarm 300; exec @ARGV' forge install --upgrade -e development --site artuplabs-dev.atlassian.net --product jira --non-interactive
```

Expected: деплой успешен; установка обновлена или «already up to date».

- [ ] **Step 3: Прогон 150 изменений.** Из корня репозитория:

```bash
set -a && . /Users/artyomkarpets/IncomeApps/projects/DistributB2B/.env && set +a
node atlassian/tools/measure-jql-jg5.mjs --phase latency --n 30 && node atlassian/tools/measure-jql-jg5.mjs --phase forge
```

`--n 30` × 5 видов (новая подзадача, новая связь, удалённая связь, вход во внутренний запрос, выход) = 150 изменений. Результат — `atlassian/data/jg5-latency.json`, `jg5-forge.json`.

- [ ] **Step 4: Вердикт.** Критерий (записан до замера): `overall.timeouts === 0` (ни одно изменение не осталось невидимым за 10 мин) и `overall.p90 ≤ 60`. Проверка: `node -e "const r=require('./atlassian/data/jg5-latency.json'); console.log(JSON.stringify(r.overall))"`.
  - Прошло → Step 5.
  - Потери > 0 → стоп для этой задачи: исполнитель opus по superpowers:systematic-debugging находит причину в `atlassian/tools/j-g5-jqlfn/src/index.js` (`forge logs -e development --since <старт прогона>`; сопоставить id потерянных изменений с проходами `worker`), чинит, повторяет Step 2–4 до 0 потерь. Причина и исправление — строкой Ruling и пунктом в Interfaces Task 14 (механика переносится вместе с исправлением). M1 не начинается до 0 потерь.

- [ ] **Step 5: Записать результат** строкой в таблицу §11 брифа `atlassian/25_app5_jql.md`: `| J-G5 (журнал) | 150 изменений (5 видов × 30): потерь 0, p50 … с, p90 … с, максимум … с; вызовов REST … | <дата> | механика журнала подтверждена |` (числа из файлов Step 3).

- [ ] **Step 6: Commit**

```bash
git add atlassian/tools/measure-jql-jg5.mjs atlassian/25_app5_jql.md atlassian/tools/j-g5-jqlfn/src/index.js atlassian/plans/2026-10-03-artup-query-v1-rulings.md
git commit -m "JQL-9: Confirm zero lost updates on 150 changes with the event journal

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 3: Платформа — changelog/bulkfetch, события спринтов, комментариев, вложений, контекст функции

**Model:** opus (шаг 2 — скрипт `scripts/live-checks.mjs`), sonnet (шаги 1, 3, 4 — документация, прогон скрипта, выводы, коммит)

**Files:**
- Create: `apps/query/scripts/live-checks.mjs`, `apps/query/docs/live-checks.md`, `apps/query/test/fixtures/events/{issue-created,issue-updated-parent,issue-updated-sprint,issue-updated-status,issue-deleted,issuelink-created,issuelink-deleted,sprint-started,sprint-closed,comment-created,comment-deleted,attachment-created}.json`, `apps/query/test/fixtures/changelog-bulkfetch.json`
- Modify: rulings (при расхождениях)

**Interfaces:**
- Produces: `docs/live-checks.md` с разделами: «Function payload and context», «Events», «Changelog bulkfetch», «Agile sprints», «issueLinkType», «Scopes». Фикстуры событий — тела событий по документации Forge (поля, которые читает `src/core/events.js`: `eventType`, `issue.id`, `issue.fields.parent.id`, `changelog.id`, `changelog.items[].{field,fieldId,from,to}`, `issueLink.{sourceIssueId,destinationIssueId}`, `sprint.{id,state,startDate,completeDate,originBoardId}`, `comment.{id,author.accountId,created,updated,visibility}`, `attachment.{id,issueId,filename,author.accountId,created}`, `timestamp`). `changelog-bulkfetch.json` — один настоящий ответ на 3 задачи JQLG (без текста: только `issueId`, `changeHistories[].{id,created,items[].{field,fieldId,from,to}}`); Task 22 перезаписывает его тем же скриптом на засеянных задачах спринта (флаги `--keys`, `--roles`, `--sprint`, `--closed-at`) и строит на нём тест.

- [ ] **Step 1: Документация (WebFetch, загрузка — `select:WebFetch`).** Страницы developer.atlassian.com:
  - `platform/forge/manifest-reference/modules/jira-jql-function/` — форма `payload` (ожидается `clause.{field,operator,arguments}`, `precomputationId`), форма ответа `{ jql }` / `{ error, storeErrorAsPrecomputation }`, есть ли `context.license` и `context.environmentType` у обработчика функции;
  - `platform/forge/events-reference/jira/` — точные имена событий задач, связей, комментариев (`avi:jira:commented:issue`, `avi:jira:updated:comment`, `avi:jira:deleted:comment` — проверить), вложений (`avi:jira:created:attachment`, `avi:jira:deleted:attachment` — проверить), спринтов (`avi:jira-software:created|started|closed|updated|deleted:sprint` — проверить) и тела событий; есть ли `changelog.id` у `avi:jira:updated:issue`;
  - REST: `POST /rest/api/3/changelog/bulkfetch` (предел `issueIdsOrKeys`, `fieldIds`, `maxResults`, форма `created`), `GET /rest/agile/1.0/board/{id}/sprint` (поле фактического старта `activatedDate`?), `GET /rest/api/3/jql/function/computation`, `POST …/computation` — скоупы каждого вызова; предел числа модулей `jira:jqlFunction` на приложение (нам нужно 24) и время ответа функции.
  Записать цитаты с URL в `docs/live-checks.md`; по ним написать фикстуры событий.

- [ ] **Step 2: Скрипт `scripts/live-checks.mjs`** (базовая авторизация из `.env`, сайт `https://artuplabs-dev.atlassian.net`, только чтение; `fetch` с `AbortSignal.timeout(30000)` и повтором сетевых ошибок, 429 и 5xx до 8 раз, как `measure-jql-jg5.mjs`). Команды:
  - `changelog` — берёт 1 001 id `project = JQLG ORDER BY id`, шлёт `changelog/bulkfetch` с 1 000 и с 1 001 id (`fieldIds: [<id поля Sprint>, "status"]`, id поля Sprint — из `GET /rest/api/3/field`, где `schema.custom === 'com.pyxis.greenhopper.jira:gh-sprint'`), печатает статус, число историй, наличие `nextPageToken`, тип `created`; затем проходит 5 000 задач и печатает секунды и число запросов (оценка для 50 000 — справочно, ворота меряет Task 20); сохраняет ответ на 3 задачи (ключи `JQLG-1…3`, тексты `fromString`/`toString` удаляются) в `test/fixtures/changelog-bulkfetch.json`; с флагами `--keys K1,K2,K3 --roles r1,r2,r3 --sprint <id спринта> --closed-at <ms>` — только ответ на эти три задачи (`fieldIds: [<id поля Sprint>]`), и в файл рядом с `issueChangeLogs` пишутся `sprintFieldId`, `sprintId`, `closedAt` и `roles: { <issueId>: <роль> }` (роль i-й задачи — i-е слово `--roles`);
  - `linktype` — для каждого типа связи из `GET /rest/api/3/issueLinkType` считает `issueLinkType = "<outward>"` и `issueLinkType = "<inward>"` на `project in (JQLG, RPT)` и сравнивает с эталоном bulkfetch `issuelinks` по всем задачам (Q-R9): печатает `type | outward n/ref | inward n/ref`;
  - `agile` — доски сайта (`GET /rest/agile/1.0/board`), у первой scrum-доски — спринты; печатает имена полей спринта (есть ли `activatedDate`).

Run: `node apps/query/scripts/live-checks.mjs changelog`, затем `linktype`, затем `agile`; вывод — в `docs/live-checks.md`.

- [ ] **Step 3: Выводы и rulings.** В `docs/live-checks.md` — раздел «Consequences» с ответами: (а) предел `changelog/bulkfetch` → значение `CHANGELOG_BATCH` для Task 5 (ожидается 1 000); (б) поле старта спринта (`activatedDate` или `startDate`) → Task 8 `sprintWindow`; (в) поля лицензии и окружения в контексте функции → Task 13 `licenceInput`; (г) точные имена событий → манифест Tasks 14, 24, 27; (д) совпал ли `issueLinkType` с эталоном на 100% → иначе Ruling: `hasLinks` считает список id по bulkfetch. Если `changelog/bulkfetch` недоступен приложению Forge — Ruling: запасной путь `GET /rest/api/3/issue/{id}/changelog` и запись «J-G6 под угрозой» для Task 20. Если какого-то события нет — Ruling: для этой группы свежесть держит часовая сверка, обещание в листинге уточняется.

- [ ] **Step 4: Commit**

```bash
git add apps/query/scripts/live-checks.mjs apps/query/docs/live-checks.md apps/query/test/fixtures atlassian/plans/2026-10-03-artup-query-v1-rulings.md
git commit -m "JQL-10: Record changelog bulkfetch limits, Forge events and the JQL function context

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

## Этап M1 — каркас, лицензия, функции по запросу, журнал

### Task 4: Каркас приложения, оболочка Custom UI, лицензия, CI, первый деплой

**Model:** opus

**Files:**
- Create: `apps/query/{manifest.yml,package.json,.eslintrc,.gitignore,AGENTS.md,README.md,vitest.config.mjs}`, `apps/query/locales/*.json` (26), `apps/query/src/{index.js,access.js}`, `apps/query/src/handlers/resolvers.js`, `apps/query/resources/icon.svg`, `apps/query/test/{access.test.js,resolvers.test.js,manifestLocales.test.js,fakeKvs.js}`, `apps/query/static/app/**` (оболочка из Reports: `package.json`, `vite.config.js`, `global-page/index.html`, `admin-page/index.html`, `src/{theme.js,api.js}`, `src/i18n/index.js`, `src/i18n/locales/*.json` (26), `src/app/{GlobalApp.jsx,AdminApp.jsx,globalMain.jsx,adminMain.jsx,AccessGate.jsx,useAccess.js}`, `src/components/{AppHeader.jsx,PageLayout.jsx,icons.js}`, `src/illustrations/{AppIcon.jsx,EmptyIllustration.jsx,LockIllustration.jsx}`, `test/{setup.js,i18n.test.js,guards.test.js,smoke.test.jsx}`)
- Modify: `.github/workflows/ci.yml`

**Interfaces:**
- Produces: `decideLicence({ environmentType, license }) → { licensed: boolean }` (`src/access.js`, копия Reports); резолвер `getAccess → { licensed, environmentType }`; `createResolverDefinitions(deps)` в `src/handlers/resolvers.js` (Task 15 и 29 добавляют ключи); UI: `I18nProvider`, `useT()`, `resolveLocale(raw)`, `call(key, payload)`, `AppError`, `bootstrap()` — копии Reports; `test/fakeKvs.js` — копия `apps/reports/test/fakeKvs.js` (`createFakeKvs({ pageSize })`); `vitest.config.mjs` с порогом покрытия ветвлений `src/core/**` ≥ 90% и скрипт `npm run coverage` (P-7).

- [ ] **Step 1: Создать и зарегистрировать приложение.** Из корня репозитория:

```bash
test ! -e apps/query/manifest.yml && mkdir -p apps/query && cd apps/query
set -a && . /Users/artyomkarpets/IncomeApps/projects/DistributB2B/.env && set +a
cp ../reports/{.eslintrc,AGENTS.md} .
mkdir -p test && cp ../reports/test/fakeKvs.js test/
```

Каталог `apps/query` уже есть (Tasks 1 и 3 создали `docs/`, `scripts/`, `test/fixtures/`), поэтому признак готового каркаса — `manifest.yml`, а не каталог; если `manifest.yml` уже есть, цепочка останавливается до `cd`, и каркас не пересоздаётся. `vitest.config.mjs` — не копия Reports, а с покрытием (P-7):

```js
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.js'],
    environment: 'node',
    coverage: {
      provider: 'v8',
      include: ['src/**/*.js'],
      reporter: ['text-summary'],
      thresholds: { 'src/core/**': { branches: 90 } },
    },
  },
});
```

Записать манифест Step 4 с `id: placeholder`, затем `forge register -s 249db86b-0aa6-4b81-96ba-62341736ad15 --accept-terms "ArtUp Query"` (перепишет `app.id`). В `AGENTS.md` заменить «Reports» на «Query», убрать абзац про экспорт.

- [ ] **Step 2: Падающие тесты.** `test/access.test.js` — копия `apps/reports/test/access.test.js`. `test/resolvers.test.js`:

```js
import { describe, expect, it } from 'vitest';
import { createResolverDefinitions } from '../src/handlers/resolvers.js';

const run = (defs, key, context, payload) => defs[key]({ context, payload });

describe('getAccess', () => {
  const defs = createResolverDefinitions({});
  it('is unlicensed in production without an active licence', async () => {
    expect(await run(defs, 'getAccess', { environmentType: 'PRODUCTION', license: { active: false } })).toEqual({ licensed: false, environmentType: 'PRODUCTION' });
  });
  it('is licensed in development', async () => {
    expect(await run(defs, 'getAccess', { environmentType: 'DEVELOPMENT' })).toEqual({ licensed: true, environmentType: 'DEVELOPMENT' });
  });
});
```

`test/manifestLocales.test.js` — копия Reports с ключами и проверкой названия:

```js
const KEYS = ['module.globalPage.title', 'module.adminPage.title'];
```

и `it("keeps 'ArtUp Query' untranslated in every locale", …)` для `module.globalPage.title`; блок «action modals» удалить.

Run: `npx vitest run` → FAIL (нет модулей).

- [ ] **Step 3: Реализация.** `src/access.js` — копия `apps/reports/src/access.js`. `src/handlers/resolvers.js`:

```js
import { decideLicence } from '../access.js';

/** Resolver functions by key; `deps` carries state and clients for the keys added later. */
export function createResolverDefinitions(deps) {
  return {
    getAccess: ({ context }) => ({
      ...decideLicence({ environmentType: context?.environmentType, license: context?.license }),
      environmentType: context?.environmentType ?? '',
    }),
  };
}
```

`src/index.js`:

```js
import Resolver from '@forge/resolver';
import { createResolverDefinitions } from './handlers/resolvers.js';

const resolver = new Resolver();
for (const [key, fn] of Object.entries(createResolverDefinitions({}))) resolver.define(key, fn);

/** Forge resolver entry point. */
export const resolverHandler = resolver.getDefinitions();
```

- [ ] **Step 4: Манифест** `manifest.yml`:

```yaml
modules:
  jira:globalPage:
    - key: query-global-page
      resource: global-page
      resolver:
        function: resolver
      title:
        i18n: module.globalPage.title
      icon: resource:icons;icon.svg
      layout: basic
  jira:adminPage:
    - key: query-admin-page
      resource: admin-page
      resolver:
        function: resolver
      title:
        i18n: module.adminPage.title
  function:
    - key: resolver
      handler: index.resolverHandler
resources:
  - key: global-page
    path: static/app/dist/global-page
  - key: admin-page
    path: static/app/dist/admin-page
  - key: icons
    path: resources
translations:
  resources:
    - key: zh-CN
      path: locales/zh-CN.json
```

Перечислить все 26 локалей в порядке Global Constraints, затем:

```yaml
  fallback:
    default: en-US
permissions:
  scopes:
    - read:jira-work
    - read:jira-user
    - read:board-scope:jira-software
    - read:sprint:jira-software
    - read:app-data:jira
    - write:app-data:jira
    - storage:app
  content:
    styles:
      - 'unsafe-inline'
app:
  runtime:
    name: nodejs24.x
    memoryMB: 256
    architecture: arm64
  id: <пишет forge register>
  licensing:
    enabled: true
```

Скоупы — по выводам Task 3 («Scopes»); добавленный сверх списка скоуп — строкой Ruling. `locales/en-US.json`:

```json
{
  "module.globalPage.title": "ArtUp Query",
  "module.adminPage.title": "ArtUp Query settings"
}
```

Остальные 25 файлов — настоящий перевод второго ключа (ru-RU: «Настройки ArtUp Query»), первый не переводится. `resources/icon.svg` — копия `apps/reports/resources/icon.svg` (перекраска — Task 33).

- [ ] **Step 5: `package.json`** — копия `apps/reports/package.json`, `"name": "artuplabs-query"`, зависимости ровно: `"@forge/api": "8.2.0"`, `"@forge/kvs": "2.0.7"`, `"@forge/events": "3.0.7"`, `"@forge/sql": "4.0.7"`, `"@forge/resolver": "2.0.0"`; devDependencies `"eslint": "8.57.1"`, `"vitest": "5.0.2"`, `"@vitest/coverage-v8": "5.0.2"`, `"yaml": "2.9.1"`; скрипты как в Reports без `screenshots`, плюс `"coverage": "vitest run --coverage"` (первый прогон с порогом — Task 5, когда появляется `src/core`). `.gitignore`: `node_modules/`, `static/app/dist/`, `static/app/screenshots/`, `data/`, `.env`. `npm install`.

- [ ] **Step 6: Оболочка UI.** Скопировать из `apps/reports/static/app` и переименовать:
  - `package.json` → `"name": "artuplabs-query-ui"`, `build`: `vite build --mode global-page && vite build --mode admin-page`; зависимости — только Atlaskit-пакеты Reports, `@forge/bridge`, `react`, `react-dom`, `lodash` (без exceljs, docx, pdfmake, docxtemplater, pizzip, без `overrides`); devDependencies как в Reports без `pdfjs-dist`;
  - `vite.config.js` → `pageDirs = { 'global-page': 'global-page', 'admin-page': 'admin-page' }`, без `assetsInclude` шрифтов;
  - `src/theme.js`, `src/api.js` (`KNOWN_CODES = ['unlicensed', 'bad-request', 'forbidden', 'not-found', 'internal']`, `withRetry` убрать вместе с импортом limits), `src/i18n/index.js`, `test/setup.js`, `test/i18n.test.js` — дословно;
  - `test/guards.test.js` — дословно, без исключения `render/palette.js` в тесте цветов и без теста `<pre>`-зонда до Task 15 (Task 15 возвращает его);
  - `src/components/{AppHeader.jsx,PageLayout.jsx,icons.js}`, `src/app/{AccessGate.jsx,useAccess.js}`, `src/illustrations/{AppIcon.jsx,EmptyIllustration.jsx,LockIllustration.jsx}` — копии Reports (в `icons.js` оставить только `glyph`, `CopyIcon`, `RefreshIcon`, `SettingsIcon`, `WarningIcon`, `CheckCircleIcon`);
  - `global-page/index.html`, `admin-page/index.html` — как в Reports (`<div id="root">`, модульный скрипт `../src/app/globalMain.jsx` / `../src/app/adminMain.jsx`);
  - `globalMain.jsx`/`adminMain.jsx` — как `globalMain.jsx` Reports; `GlobalApp` и `AdminApp` пока рисуют `AccessGate` → `AppHeader` с `t('app.title')` и `t('app.tagline')`.
  `src/i18n/locales/en-US.json`:

```json
{
  "app.title": "ArtUp Query",
  "app.tagline": "JQL functions that stay fresh: subtasks, links, hierarchy, sprint history, comments and field math",
  "admin.title": "ArtUp Query settings",
  "errors.generic": "Something went wrong: {message}",
  "errors.unlicensed": "ArtUp Query needs an active licence on this site.",
  "errors.forbidden": "You don't have permission to do that.",
  "errors.not-found": "Not found.",
  "errors.bad-request": "The request was not valid.",
  "errors.internal": "Something went wrong on our side. Try again in a minute."
}
```

плюс ключи, которые требуют скопированные `AccessGate`/`AppHeader` (взять из `apps/reports/static/app/src/i18n/locales/en-US.json` по `t('…')` в этих файлах), с настоящими переводами в 25 файлах. `test/smoke.test.jsx`: мок `@forge/bridge` (`view.getContext` → `{ locale: 'ru_RU', environmentType: 'DEVELOPMENT', extension: { type: 'jira:globalPage' } }`, `invoke('getAccess')` → `{ licensed: true, environmentType: 'DEVELOPMENT' }`, `view.theme.enable` → resolve), рендер `GlobalApp` внутри `I18nProvider locale="ru-RU"` → виден заголовок «ArtUp Query».

Run: `npm --prefix static/app install && npm --prefix static/app test` → PASS; `npm run build:ui` → есть `static/app/dist/global-page/index.html` и `static/app/dist/admin-page/index.html`.

- [ ] **Step 7: Тесты и линт.** `npx vitest run` → PASS; `npm run lint` → 0 ошибок; `forge lint` → без ошибок.

- [ ] **Step 8: CI.** В `.github/workflows/ci.yml` добавить блок «Query: install / lint / test / UI test / UI build / audit» — копия блока «Reports» с `working-directory: apps/query`; в `cache-dependency-path` — `apps/query/package-lock.json` и `apps/query/static/app/package-lock.json`.

- [ ] **Step 9: Деплой в development и установка.**

```bash
set -a && . /Users/artyomkarpets/IncomeApps/projects/DistributB2B/.env && set +a
cd apps/query && npm run build:ui && forge deploy -e development --non-interactive
perl -e 'alarm 300; exec @ARGV' forge install -e development --site artuplabs-dev.atlassian.net --product jira --non-interactive
forge eligibility -e development --non-interactive
```

Expected: деплой и установка успешны (если «already installed» — та же команда с `--upgrade`), eligibility — eligible for Runs on Atlassian. Строки вывода (без токенов) — в тело коммита.

- [ ] **Step 10: Commit**

```bash
git add apps/query .github/workflows/ci.yml
git commit -m "JQL-11: Scaffold ArtUp Query with the licence resolver, the Custom UI shell and CI

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 5: Пределы, тексты ошибок, каталог функций, разбор аргументов

**Model:** opus

**Files:**
- Create: `apps/query/src/core/{limits.js,errors.js,catalog.js,args.js}`, `apps/query/test/guards.test.js`
- Modify: `.github/workflows/ci.yml` (шаг тестов блока Query — `npm run coverage`)
- Test: `apps/query/test/core/{catalog.test.js,args.test.js}`, `apps/query/test/guards.test.js`

**Interfaces:**
- Produces:
  - `limits.js`: `VALUE_LIMIT=1000`, `TREE_FANOUT=9`, `TREE_LEVELS=1`, `ID_PAGE=5000`, `BULK_BATCH=100`, `BULK_CONCURRENCY=8`, `CACHE_CHUNK=5000`, `PAGE_CACHE_MS`, `FUNCTION_BUDGET_MS=20000`, `WORKER_BUDGET_MS=240000`, `LEASE_MS=90000`, `PENDING_STALE_MS`, `JOURNAL_PAGE=100`, `MAX_TOUCHED=50`, `VERIFY_DELAY_S=20`, `ACTIVE_MS` (7 дней), `RECONCILE_USED_MS` (24 ч), `RECONCILE_STALE_MS` (1 ч), `RECONCILE_MAX_GROUPS=50`, `MAX_DEPTH=10`, `PRECOMPUTATION_BATCH=50`, `REQUEST_ATTEMPTS=6`, `RETRY_BASE_MS=300`, `LIST_PAGE=50`, `PRECOMPUTATION_PAGE=100`, `USER_SEARCH_MAX=50`, `CHANGELOG_BATCH` (из Task 3), `CHANGELOG_PAGE=10000`, `REFRESH_CONCURRENCY=4`, `ERROR_LOG_SIZE=20`, `COUNT_MAX=10000`. `FUNCTION_BUDGET_MS` — внутренний бюджет 20 с под предел платформы 25 с (P-4). Пределы индекса (`SQL_IN_CHUNK`, `SPRINT_FIELDS_TTL_MS`, `RECONCILE_RECENT_MAX`, `COMMENT_PAGE`) и админ-страницы (`EXCLUDED_MAX`) дописывают Tasks 23, 27, 29.
  - `errors.js`: `ERR.{unlicensed(), computing(), indexBuilding(done,total), notFound(what,value), ambiguous(what,value,count), tooMany(count,capacity), excluded(key), perUser(word), withFunction(functionName, message)}` → string; `withFunction` — приставка `<имя>: ` для ошибок, которые слои `compute`/`handlers` получают от разборщиков или от Jira.
  - `test/guards.test.js`: в `src/**` нет `//` внутри функций и упоминаний задач/плана/спецификации/rulings; в `src/core/**` нет `Date.now()` и `new Date()` без аргумента.
  - `catalog.js`: `FUNCTIONS: Fn[]`, `FUNCTION_BY_NAME: Map<string, Fn>`, `SHIPPED_GROUPS: string[]`, `shippedFunctions() → Fn[]`, `usage(fn) → string`; `Fn = { name, key, group: 'query'|'site'|'board'|'sprint'|'comment'|'attachment'|'fields', family: 'query'|'links'|'subtasks'|'board'|'sprint'|'comment'|'attachment', args: Arg[], examples: string[] }`, `Arg = { name, type: 'jql'|'text'|'int'|'clauses'|'ext', required, min?, max? }`.
  - `args.js`: `pageToken(page) → string`, `pageOf(token) → Page|null`, `splitPage(raw) → { userArgs: string[], page: Page|null }`, `groupKey(functionName, userArgs) → string`, `parseArgs(functionName, raw) → { args: object, userArgs: string[], page: Page|null } | { error: string }`; `Page = { kind: 'leaf'|'mid', index: number }`.

- [ ] **Step 1: Падающие тесты.** `test/core/catalog.test.js`:

```js
import { describe, expect, it } from 'vitest';
import { FUNCTIONS, FUNCTION_BY_NAME, SHIPPED_GROUPS, shippedFunctions, usage } from '../../src/core/catalog.js';

describe('catalog', () => {
  it('defines 24 functions with unique names and keys', () => {
    expect(FUNCTIONS).toHaveLength(24);
    expect(new Set(FUNCTIONS.map((f) => f.name)).size).toBe(24);
    expect(new Set(FUNCTIONS.map((f) => f.key)).size).toBe(24);
  });
  it('uses lower-case kebab keys', () => {
    expect(FUNCTIONS.filter((f) => !/^[a-z][a-z-]{2,40}$/.test(f.key))).toEqual([]);
  });
  it('keeps required arguments before optional ones', () => {
    for (const f of FUNCTIONS) {
      const flags = f.args.map((a) => a.required);
      expect(flags, f.name).toEqual([...flags].sort((a, b) => Number(b) - Number(a)));
    }
  });
  it('gives every function an example that calls it with issue in', () => {
    expect(FUNCTIONS.filter((f) => !f.examples.length || !f.examples.every((e) => e.includes(`issue in ${f.name}(`)))).toEqual([]);
  });
  it('writes optional arguments in brackets', () => {
    expect(usage(FUNCTION_BY_NAME.get('linkedIssuesOfRecursiveLimited'))).toBe('linkedIssuesOfRecursiveLimited(subquery, depth, [linkType])');
    expect(usage(FUNCTION_BY_NAME.get('hasSubtasks'))).toBe('hasSubtasks()');
  });
  it('ships the groups built so far', () => {
    expect(SHIPPED_GROUPS).toEqual(['query', 'site', 'board']);
    expect(shippedFunctions().map((f) => f.name)).toEqual(['subtasksOf', 'parentsOf', 'epicsOf', 'issuesInEpics', 'childIssuesOf', 'linkedIssuesOf', 'linkedIssuesOfRecursive', 'linkedIssuesOfRecursiveLimited', 'hasLinks', 'hasLinkType', 'hasSubtasks', 'previousSprint', 'nextSprint']);
  });
});
```

`test/core/args.test.js`:

```js
import { describe, expect, it } from 'vitest';
import { groupKey, pageOf, pageToken, parseArgs, splitPage } from '../../src/core/args.js';

describe('page tokens', () => {
  it('round-trips leaf and middle pages', () => {
    expect(pageOf(pageToken({ kind: 'leaf', index: 7 }))).toEqual({ kind: 'leaf', index: 7 });
    expect(pageOf(pageToken({ kind: 'mid', index: 2 }))).toEqual({ kind: 'mid', index: 2 });
  });
  it('rejects strings that only look like a token', () => {
    expect([pageOf('__aq:l0'), pageOf('__aq:x1'), pageOf('tree:3'), pageOf(' __aq:l1'), pageOf(undefined)]).toEqual([null, null, null, null, null]);
  });
  it('strips only a trailing token', () => {
    expect(splitPage(['project = A', '__aq:l2'])).toEqual({ userArgs: ['project = A'], page: { kind: 'leaf', index: 2 } });
    expect(splitPage(['__aq:l2', 'blocks'])).toEqual({ userArgs: ['__aq:l2', 'blocks'], page: null });
    expect(splitPage(undefined)).toEqual({ userArgs: [], page: null });
  });
});

describe('parseArgs', () => {
  it('names the arguments of a function', () => {
    expect(parseArgs('linkedIssuesOfRecursiveLimited', ['key = A-1', ' 3 ', 'blocks'])).toEqual({
      args: { subquery: 'key = A-1', depth: 3, linkType: 'blocks' }, userArgs: ['key = A-1', ' 3 ', 'blocks'], page: null,
    });
  });
  it('keeps the page token apart from optional arguments', () => {
    expect(parseArgs('childIssuesOf', ['key = A-1', '__aq:m1'])).toEqual({ args: { subquery: 'key = A-1' }, userArgs: ['key = A-1'], page: { kind: 'mid', index: 1 } });
  });
  it('explains the usage when arguments are missing or extra', () => {
    expect(parseArgs('subtasksOf', [])).toEqual({ error: 'Usage: subtasksOf(subquery)' });
    expect(parseArgs('hasSubtasks', ['x'])).toEqual({ error: 'Usage: hasSubtasks()' });
    expect(parseArgs('addedAfterSprintStart', [])).toEqual({ error: 'Usage: addedAfterSprintStart(board, [sprint])' });
  });
  it('rejects a depth outside 1..10 or not a number', () => {
    expect(parseArgs('childIssuesOf', ['key = A-1', '11'])).toEqual({ error: 'childIssuesOf: depth must be between 1 and 10' });
    expect(parseArgs('childIssuesOf', ['key = A-1', 'two'])).toEqual({ error: 'childIssuesOf: depth must be a whole number' });
  });
  it('rejects an empty subquery', () => {
    expect(parseArgs('parentsOf', ['  '])).toEqual({ error: 'parentsOf: subquery must not be empty' });
  });
  it('rejects currentUser() because results are shared by all users', () => {
    expect(parseArgs('parentsOf', ['assignee = currentUser()'])).toEqual({ error: 'parentsOf: currentUser() is not supported: results are shared by all users' });
    expect(parseArgs('commented', ['by currentUser()'])).toEqual({ error: 'commented: currentUser() is not supported: results are shared by all users' });
  });
  it('normalises a file extension', () => {
    expect(parseArgs('hasAttachments', ['.XLSX']).args).toEqual({ extension: 'xlsx' });
  });
  it('rejects an unknown function', () => {
    expect(parseArgs('nope', [])).toEqual({ error: 'Unknown function nope' });
  });
  it('builds the same group key for the root and its pages', () => {
    const root = parseArgs('subtasksOf', ['project = "A"']);
    const leaf = parseArgs('subtasksOf', ['project = "A"', '__aq:l4']);
    expect(groupKey('subtasksOf', leaf.userArgs)).toBe(groupKey('subtasksOf', root.userArgs));
    expect(groupKey('subtasksOf', ['a'])).not.toBe(groupKey('parentsOf', ['a']));
  });
});
```

`test/guards.test.js` (серверный код; UI проверяет `static/app/test/guards.test.js` Task 4):

```js
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const SRC = new URL('../src', import.meta.url).pathname;
const files = (dir) => readdirSync(dir).flatMap((name) => {
  const path = join(dir, name);
  return statSync(path).isDirectory() ? files(path) : [path];
});
const code = files(SRC).filter((f) => f.endsWith('.js'));
const text = (f) => readFileSync(f, 'utf8');

describe('server source guards', () => {
  it('has no comments inside function bodies', () => {
    expect(code.filter((f) => /^\s+\/\/(?!\s*eslint)/m.test(text(f)))).toEqual([]);
  });
  it('keeps the core free of the clock', () => {
    expect(code.filter((f) => f.includes('/src/core/') && /\bDate\.now\(|\bnew Date\(\s*\)/.test(text(f)))).toEqual([]);
  });
  it('never mentions tasks, the plan, the specification or rulings', () => {
    expect(code.filter((f) => /\bTask \d|\bplan\b|\bspecification\b|\brulings?\b|\bQ-R\d/i.test(text(f)))).toEqual([]);
  });
});
```

- [ ] **Step 2: Run** `npx vitest run test/core test/guards.test.js` → FAIL (модулей нет; guard-тест проходит уже на коде Task 4 — если нет, поправить скопированные файлы).

- [ ] **Step 3: `src/core/limits.js`**

```js
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
/** Compute budget of one function call: 20 s under the platform's 25 s, leaving time to queue the job and log. */
export const FUNCTION_BUDGET_MS = 20 * 1000;
export const WORKER_BUDGET_MS = 240 * 1000;
export const LEASE_MS = 90 * 1000;
export const PENDING_STALE_MS = 6 * 60 * 1000;
export const JOURNAL_PAGE = 100;
export const MAX_TOUCHED = 50;
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
/** Page size of Jira lists read with startAt (boards, sprints, projects, group members). */
export const LIST_PAGE = 50;
export const PRECOMPUTATION_PAGE = 100;
export const USER_SEARCH_MAX = 50;
export const CHANGELOG_BATCH = 1000;
/** Change histories per changelog bulkfetch page. */
export const CHANGELOG_PAGE = 10000;
/** Groups recomputed in parallel by one refresh or reconcile pass. */
export const REFRESH_CONCURRENCY = 4;
export const ERROR_LOG_SIZE = 20;
export const COUNT_MAX = 10000;
```

(`CHANGELOG_BATCH` — значение из `docs/live-checks.md` Task 3, если оно не 1 000.)

- [ ] **Step 4: `src/core/errors.js`**

```js
const fmt = (n) => Number(n).toLocaleString('en-US');

/** English messages for the JQL editor; Jira passes no locale to a JQL function. */
export const ERR = {
  unlicensed: () => 'ArtUp Query license is not active',
  computing: () => 'Computing, retry in a minute',
  indexBuilding: (done, total) => `Index is building: ${fmt(done)} of ${fmt(total)} issues`,
  notFound: (what, value) => `${what} "${value}" not found`,
  ambiguous: (what, value, count) => `${what} "${value}" matches ${count} items; use its id`,
  tooMany: (count, capacity) => `The result needs ${fmt(count)} issues; one function returns at most ${fmt(capacity)}. Narrow the subquery.`,
  excluded: (key) => `Project ${key} is excluded from the ArtUp Query index`,
  perUser: (word) => `${word} is not supported: results are shared by all users`,
  withFunction: (functionName, message) => `${functionName}: ${message}`,
};
```

- [ ] **Step 5: `src/core/catalog.js`**

```js
import { COUNT_MAX, MAX_DEPTH } from './limits.js';

const SUBQUERY = { name: 'subquery', type: 'jql', required: true };
const LINK_TYPE = { name: 'linkType', type: 'text', required: false };
const BOARD = { name: 'board', type: 'text', required: true };
const SPRINT = { name: 'sprint', type: 'text', required: true };
const SPRINT_OPTIONAL = { ...SPRINT, required: false };
const DEPTH = { name: 'depth', type: 'int', required: false, min: 1, max: MAX_DEPTH };
const CLAUSES = { name: 'clauses', type: 'clauses', required: false };
const EXPRESSION = { name: 'expression', type: 'text', required: true };

const fn = (name, key, group, family, args, examples) => ({ name, key, group, family, args, examples });

/** Every function of ArtUp Query: group = unit of build and of the v1.1 rule, family = what makes a result stale. */
export const FUNCTIONS = [
  fn('subtasksOf', 'subtasks-of', 'query', 'query', [SUBQUERY], ['issue in subtasksOf("project = DEMO AND status = \\"In Progress\\"")']),
  fn('parentsOf', 'parents-of', 'query', 'query', [SUBQUERY], ['issue in parentsOf("project = DEMO AND type = Sub-task AND status = Done")']),
  fn('epicsOf', 'epics-of', 'query', 'query', [SUBQUERY], ['issue in epicsOf("fixVersion = 2.0")']),
  fn('issuesInEpics', 'issues-in-epics', 'query', 'query', [SUBQUERY], ['issue in issuesInEpics("project = DEMO AND status = Done")']),
  fn('childIssuesOf', 'child-issues-of', 'query', 'query', [SUBQUERY, DEPTH], ['issue in childIssuesOf("key = DEMO-1")', 'issue in childIssuesOf("project = DEMO AND type = Epic", "1")']),
  fn('linkedIssuesOf', 'linked-issues-of', 'query', 'query', [SUBQUERY, LINK_TYPE], ['issue in linkedIssuesOf("project = DEMO AND status = Open", "blocks")']),
  fn('linkedIssuesOfRecursive', 'linked-issues-of-recursive', 'query', 'query', [SUBQUERY, LINK_TYPE], ['issue in linkedIssuesOfRecursive("key = DEMO-1", "is blocked by")']),
  fn('linkedIssuesOfRecursiveLimited', 'linked-issues-of-recursive-limited', 'query', 'query', [SUBQUERY, { ...DEPTH, required: true }, LINK_TYPE], ['issue in linkedIssuesOfRecursiveLimited("key = DEMO-1", "3", "blocks")']),
  fn('hasLinks', 'has-links', 'site', 'links', [LINK_TYPE], ['issue in hasLinks("blocks")']),
  fn('hasLinkType', 'has-link-type', 'site', 'links', [{ ...LINK_TYPE, required: true }], ['issue in hasLinkType("Duplicate")']),
  fn('hasSubtasks', 'has-subtasks', 'site', 'subtasks', [], ['project = DEMO AND issue in hasSubtasks()']),
  fn('previousSprint', 'previous-sprint', 'board', 'board', [BOARD], ['issue in previousSprint("DEMO board")']),
  fn('nextSprint', 'next-sprint', 'board', 'board', [BOARD], ['issue in nextSprint("DEMO board")']),
  fn('addedAfterSprintStart', 'added-after-sprint-start', 'sprint', 'sprint', [BOARD, SPRINT_OPTIONAL], ['issue in addedAfterSprintStart("DEMO board")', 'issue in addedAfterSprintStart("DEMO board", "DEMO Sprint 7")']),
  fn('removedAfterSprintStart', 'removed-after-sprint-start', 'sprint', 'sprint', [BOARD, SPRINT_OPTIONAL], ['issue in removedAfterSprintStart("DEMO board")']),
  fn('incompleteInSprint', 'incomplete-in-sprint', 'sprint', 'sprint', [BOARD, SPRINT], ['issue in incompleteInSprint("DEMO board", "DEMO Sprint 6")']),
  fn('completeInSprint', 'complete-in-sprint', 'sprint', 'sprint', [BOARD, SPRINT], ['issue in completeInSprint("DEMO board", "DEMO Sprint 6")']),
  fn('commented', 'commented', 'comment', 'comment', [CLAUSES], ['issue in commented("after -7d inRole Developers")']),
  fn('lastComment', 'last-comment', 'comment', 'comment', [{ ...CLAUSES, required: true }], ['issue in lastComment("before -14d")']),
  fn('hasComments', 'has-comments', 'comment', 'comment', [{ name: 'count', type: 'int', required: false, min: 1, max: COUNT_MAX }], ['issue in hasComments("5")']),
  fn('fileAttached', 'file-attached', 'attachment', 'attachment', [CLAUSES], ['issue in fileAttached("after startOfWeek() ext pdf")']),
  fn('hasAttachments', 'has-attachments', 'attachment', 'attachment', [{ name: 'extension', type: 'ext', required: false }], ['issue in hasAttachments("xlsx")']),
  fn('dateCompare', 'date-compare', 'fields', 'query', [SUBQUERY, EXPRESSION], ['issue in dateCompare("project = DEMO", "resolutiondate > duedate")']),
  fn('expression', 'expression', 'fields', 'query', [SUBQUERY, EXPRESSION], ['issue in expression("project = DEMO", "timespent > originalestimate * 1.2")']),
];

/** Functions by name. */
export const FUNCTION_BY_NAME = new Map(FUNCTIONS.map((f) => [f.name, f]));

/** Groups whose code is built and declared in the manifest. */
export const SHIPPED_GROUPS = ['query', 'site', 'board'];

/** Functions of the shipped groups, in catalog order. */
export function shippedFunctions() {
  return FUNCTIONS.filter((f) => SHIPPED_GROUPS.includes(f.group));
}

/** `name(required, [optional])`. */
export function usage(f) {
  return `${f.name}(${f.args.map((a) => (a.required ? a.name : `[${a.name}]`)).join(', ')})`;
}
```

- [ ] **Step 6: `src/core/args.js`**

```js
import { FUNCTION_BY_NAME, usage } from './catalog.js';
import { ERR } from './errors.js';

const PAGE = /^__aq:([lm])([1-9]\d{0,2})$/;
const WHOLE = /^\d{1,6}$/;
const PER_USER = /\bcurrentUser\s*\(/i;

/** Hidden trailing argument of a tree page call: `__aq:l3` (leaf 3) or `__aq:m1` (middle node 1). */
export function pageToken(page) {
  return `__aq:${page.kind === 'leaf' ? 'l' : 'm'}${page.index}`;
}

/** The page a token addresses, or null when the string is not a page token. */
export function pageOf(token) {
  const m = PAGE.exec(String(token ?? ''));
  return m ? { kind: m[1] === 'l' ? 'leaf' : 'mid', index: Number(m[2]) } : null;
}

/** Splits clause arguments into the user's arguments and a trailing page token. */
export function splitPage(raw) {
  const list = Array.isArray(raw) ? raw.map((a) => String(a ?? '')) : [];
  const page = list.length ? pageOf(list[list.length - 1]) : null;
  return { userArgs: page ? list.slice(0, -1) : list, page };
}

/** Identity of a precomputation group: the function and the user's arguments without the page token. */
export function groupKey(functionName, userArgs) {
  return `${functionName}${JSON.stringify(userArgs)}`;
}

function parseOne(spec, raw) {
  const value = raw.trim();
  if (spec.type === 'int') {
    if (!WHOLE.test(value)) return { error: `${spec.name} must be a whole number` };
    const n = Number(value);
    if (n < spec.min || n > spec.max) return { error: `${spec.name} must be between ${spec.min} and ${spec.max}` };
    return { value: n };
  }
  if (!value) return { error: `${spec.name} must not be empty` };
  if (PER_USER.test(value)) return { error: ERR.perUser('currentUser()') };
  if (spec.type === 'ext') return { value: value.replace(/^\.+/, '').toLowerCase() };
  return { value };
}

/** Clause arguments → `{ args, userArgs, page }`, or `{ error }` with the message shown in the JQL editor. */
export function parseArgs(functionName, raw) {
  const f = FUNCTION_BY_NAME.get(functionName);
  if (!f) return { error: `Unknown function ${functionName}` };
  const { userArgs, page } = splitPage(raw);
  const required = f.args.filter((a) => a.required).length;
  if (userArgs.length < required || userArgs.length > f.args.length) return { error: `Usage: ${usage(f)}` };
  const args = {};
  for (let i = 0; i < userArgs.length; i += 1) {
    const r = parseOne(f.args[i], userArgs[i]);
    if (r.error) return { error: ERR.withFunction(f.name, r.error) };
    args[f.args[i].name] = r.value;
  }
  return { args, userArgs, page };
}
```

- [ ] **Step 7: Run** `npx vitest run test/core test/guards.test.js` → PASS; `npm run coverage` → PASS (ветви `src/core/**` ≥ 90%; если ниже — дописать тесты на непокрытые ветви, порог не снижать); `npm run lint` → 0 ошибок. В `.github/workflows/ci.yml` в блоке Query шаг `npm test` заменить на `npm run coverage`.

- [ ] **Step 8: Commit**

```bash
git add apps/query/src/core apps/query/test/core apps/query/test/guards.test.js .github/workflows/ci.yml
git commit -m "JQL-12: Add the function catalog, limits, error texts and argument parsing

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 6: Построение JQL и дерево страниц

**Model:** opus

**Files:**
- Create: `apps/query/src/core/{jql-build.js,tree.js}`
- Test: `apps/query/test/core/{jql-build.test.js,tree.test.js}`

**Interfaces:**
- Consumes: `pageToken` (Task 5), `VALUE_LIMIT`, `TREE_FANOUT`, `TREE_LEVELS`, `ERR.tooMany`.
- Produces:
  - `jql-build.js`: `EMPTY = 'id = -1'`, `quote(text) → string`, `pageCall(functionName, userArgs, page) → string`.
  - `tree.js`: `valuesOf(ids: string[]) → Values`, `treeShape(n, levels = TREE_LEVELS) → { kind: 'list', leaves } | { kind: 'tree', levels: 1, leaves } | { kind: 'tree', levels: 2, leaves, mids } | { kind: 'over', capacity }`, `buildFragment({ functionName, userArgs, page, values, field, rootFilter, levels }) → { jql } | { error }`; `Values = { n: number, range(from, to) → string[] }`.

- [ ] **Step 1: Падающие тесты.** `test/core/jql-build.test.js`:

```js
import { describe, expect, it } from 'vitest';
import { EMPTY, pageCall, quote } from '../../src/core/jql-build.js';

describe('quote', () => {
  it('escapes quotes and backslashes', () => {
    expect(quote('a "b" \\c')).toBe('"a \\"b\\" \\\\c"');
  });
  it('keeps unicode as it is', () => {
    expect(quote('метка = "тест"')).toBe('"метка = \\"тест\\""');
  });
});

describe('pageCall', () => {
  it('repeats a nested function call byte for byte and appends the page token', () => {
    const inner = 'issue in linkedIssuesOf("project = A", "blocks")';
    expect(pageCall('subtasksOf', [inner], { kind: 'leaf', index: 2 })).toBe('issue in subtasksOf("issue in linkedIssuesOf(\\"project = A\\", \\"blocks\\")", "__aq:l2")');
  });
  it('matches no issue with EMPTY', () => {
    expect(EMPTY).toBe('id = -1');
  });
});
```

`test/core/tree.test.js`:

```js
import { describe, expect, it } from 'vitest';
import { buildFragment, treeShape, valuesOf } from '../../src/core/tree.js';

const ids = (n) => Array.from({ length: n }, (_, i) => String(1000 + i));
const call = (page) => `issue in subtasksOf("project = \\"A\\"", "__aq:${page}")`;
const base = { functionName: 'subtasksOf', userArgs: ['project = "A"'], field: 'parent', rootFilter: 'issuetype in subTaskIssueTypes()' };

describe('treeShape', () => {
  it.each([
    [0, 2, { kind: 'list', leaves: 0 }],
    [1000, 2, { kind: 'list', leaves: 1 }],
    [1001, 2, { kind: 'tree', levels: 1, leaves: 2 }],
    [9000, 2, { kind: 'tree', levels: 1, leaves: 9 }],
    [9001, 2, { kind: 'tree', levels: 2, leaves: 10, mids: 2 }],
    [81000, 2, { kind: 'tree', levels: 2, leaves: 81, mids: 9 }],
    [81001, 2, { kind: 'over', capacity: 81000 }],
    [9001, 1, { kind: 'over', capacity: 9000 }],
  ])('%i values at %i levels → %o', (n, levels, shape) => {
    expect(treeShape(n, levels)).toEqual(shape);
  });
});

describe('buildFragment', () => {
  it('stores up to 1 000 values as one list under the root filter', () => {
    expect(buildFragment({ ...base, page: null, values: valuesOf(['3', '5']), levels: 1 })).toEqual({ jql: 'issuetype in subTaskIssueTypes() AND (parent in (3,5))' });
  });
  it('omits the filter when there is none', () => {
    expect(buildFragment({ ...base, rootFilter: undefined, field: 'id', page: null, values: valuesOf(['7']), levels: 1 })).toEqual({ jql: 'id in (7)' });
  });
  it('matches nothing for no values', () => {
    expect(buildFragment({ ...base, page: null, values: valuesOf([]), levels: 1 })).toEqual({ jql: 'id = -1' });
  });
  it('splits 2 500 values into three leaf calls that quote the subquery', () => {
    expect(buildFragment({ ...base, page: null, values: valuesOf(ids(2500)), levels: 1 })).toEqual({
      jql: `issuetype in subTaskIssueTypes() AND (${call('l1')} OR ${call('l2')} OR ${call('l3')})`,
    });
  });
  it('gives each leaf its own 1 000 values without the root filter', () => {
    expect(buildFragment({ ...base, page: { kind: 'leaf', index: 3 }, values: valuesOf(ids(2500)), levels: 1 })).toEqual({ jql: `parent in (${ids(2500).slice(2000).join(',')})` });
  });
  it('returns EMPTY for a leaf beyond the values after the result shrank', () => {
    expect(buildFragment({ ...base, page: { kind: 'leaf', index: 2 }, values: valuesOf(ids(800)), levels: 1 })).toEqual({ jql: 'id = -1' });
  });
  it('routes 12 000 values through two middle nodes at two levels', () => {
    const v = valuesOf(ids(12000));
    expect(buildFragment({ ...base, page: null, values: v, levels: 2 })).toEqual({ jql: `issuetype in subTaskIssueTypes() AND (${call('m1')} OR ${call('m2')})` });
    expect(buildFragment({ ...base, page: { kind: 'mid', index: 2 }, values: v, levels: 2 })).toEqual({ jql: `(${call('l10')} OR ${call('l11')} OR ${call('l12')})` });
  });
  it('returns EMPTY for a middle node beyond the leaves', () => {
    expect(buildFragment({ ...base, page: { kind: 'mid', index: 3 }, values: valuesOf(ids(12000)), levels: 2 })).toEqual({ jql: 'id = -1' });
  });
  it('explains an over-capacity result with numbers', () => {
    expect(buildFragment({ ...base, page: null, values: valuesOf(ids(9001)), levels: 1 })).toEqual({ error: 'The result needs 9,001 issues; one function returns at most 9,000. Narrow the subquery.' });
  });
});
```

- [ ] **Step 2: Run** `npx vitest run test/core/jql-build.test.js test/core/tree.test.js` → FAIL.

- [ ] **Step 3: `src/core/jql-build.js`**

```js
import { pageToken } from './args.js';

/** JQL that matches no issue. */
export const EMPTY = 'id = -1';

/** A JQL string literal. */
export function quote(text) {
  return `"${String(text).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

/** `issue in fn("arg", …, "__aq:l2")`: the call of one tree page with the user's arguments repeated. */
export function pageCall(functionName, userArgs, page) {
  return `issue in ${functionName}(${[...userArgs, pageToken(page)].map(quote).join(', ')})`;
}
```

- [ ] **Step 4: `src/core/tree.js`**

```js
import { TREE_FANOUT, TREE_LEVELS, VALUE_LIMIT } from './limits.js';
import { ERR } from './errors.js';
import { EMPTY, pageCall } from './jql-build.js';

/** Sorted ids as a value source. */
export function valuesOf(ids) {
  return { n: ids.length, range: (from, to) => ids.slice(from, to) };
}

/** How n values are stored: one list, pages under the root (1 or 2 levels), or over capacity. */
export function treeShape(n, levels = TREE_LEVELS) {
  const leaves = Math.ceil(n / VALUE_LIMIT);
  if (n <= VALUE_LIMIT) return { kind: 'list', leaves };
  if (leaves <= TREE_FANOUT) return { kind: 'tree', levels: 1, leaves };
  if (levels >= 2 && leaves <= TREE_FANOUT * TREE_FANOUT) return { kind: 'tree', levels: 2, leaves, mids: Math.ceil(leaves / TREE_FANOUT) };
  return { kind: 'over', capacity: (levels >= 2 ? TREE_FANOUT * TREE_FANOUT : TREE_FANOUT) * VALUE_LIMIT };
}

const anyOf = (clauses) => (clauses.length === 1 ? clauses[0] : `(${clauses.join(' OR ')})`);
const span = (first, last) => Array.from({ length: last - first + 1 }, (_, i) => first + i);

/**
 * Stored JQL of one precomputation: the root (page null), a middle node or a leaf. `field` is `id` or `parent`;
 * `rootFilter` is ANDed on the root only (a nested leaf with it returned nothing in the J-G5 measurement).
 */
export function buildFragment({ functionName, userArgs, page, values, field, rootFilter, levels = TREE_LEVELS }) {
  const list = (from, to) => {
    const ids = values.range(from, to);
    return ids.length ? `${field} in (${ids.join(',')})` : EMPTY;
  };
  const shape = treeShape(values.n, levels);
  const leafCall = (index) => pageCall(functionName, userArgs, { kind: 'leaf', index });
  if (page?.kind === 'leaf') return { jql: list((page.index - 1) * VALUE_LIMIT, page.index * VALUE_LIMIT) };
  if (page?.kind === 'mid') {
    const first = (page.index - 1) * TREE_FANOUT + 1;
    const last = Math.min(shape.leaves ?? 0, first + TREE_FANOUT - 1);
    return { jql: first > last ? EMPTY : anyOf(span(first, last).map(leafCall)) };
  }
  if (!values.n) return { jql: EMPTY };
  if (shape.kind === 'over') return { error: ERR.tooMany(values.n, shape.capacity) };
  let body = list(0, values.n);
  if (shape.kind === 'tree' && shape.levels === 1) body = anyOf(span(1, shape.leaves).map(leafCall));
  if (shape.kind === 'tree' && shape.levels === 2) body = anyOf(span(1, shape.mids).map((index) => pageCall(functionName, userArgs, { kind: 'mid', index })));
  if (!rootFilter) return { jql: body };
  return { jql: `${rootFilter} AND ${body.startsWith('(') ? body : `(${body})`}` };
}
```

- [ ] **Step 5: Run** `npx vitest run test/core` → PASS; `npm run coverage` → PASS (порог ветвлений `src/core/**`); `npm run lint` → 0 ошибок.

- [ ] **Step 6: Commit**

```bash
git add apps/query/src/core apps/query/test/core
git commit -m "JQL-13: Build stored JQL with a tree of page calls over 1 000 values

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 7: События и решение, что пересчитывать

**Model:** opus

**Files:**
- Create: `apps/query/src/core/{ids.js,events.js,affected.js}`
- Test: `apps/query/test/core/{ids.test.js,events.test.js,affected.test.js}`

**Interfaces:**
- Consumes: `FUNCTION_BY_NAME` (Task 5), `splitPage`, `groupKey` (Task 5), `JOURNAL_PAGE`, `MAX_TOUCHED`, фикстуры `test/fixtures/events/*.json` (Task 3).
- Produces:
  - `ids.js` (общий помощник ядра, `compute` и `infra` — одна реализация вместо копий в каждом модуле): `byNumber(a, b) → number` (сравнение id-строк как чисел), `sortIds(ids: Iterable) → string[]` (без повторов, строки, по возрастанию числа).
  - `events.js`: `eventRecord(event) → { ids: string[], kinds: Kind[] }`; `Kind = 'issue-created'|'issue-updated'|'issue-deleted'|'parent'|'sprint-field'|'status'|'link'|'sprint'|'comment'|'attachment'|'unknown'`.
  - `affected.js`: `summarizeJournal(rows, { page, maxTouched }) → { touched: string[], kinds: Kind[], all: boolean, firstAt: number|null }` (`rows = [{ key: 't:<ts15>:<rand>', value: { ids, kinds } }]`); `groupPrecomputations(pcs, { now, activeMs }) → Group[]`, `Group = { key, functionName, family, userArgs, items: Pc[] }`, `Pc = { id, functionName, arguments, value?, error?, used?, created?, updated? }`; `familyWants(family, kinds) → boolean`; `queryOverlap({ touched, watch: Set|null, liveHits: string[]|null }) → boolean`; `isTimeRelative(userArgs) → boolean`; `reconcileTargets(groups, { now, usedMs, staleMs, max }) → Group[]`.

- [ ] **Step 1: Падающие тесты.** `test/core/ids.test.js`:

```js
import { describe, expect, it } from 'vitest';
import { byNumber, sortIds } from '../../src/core/ids.js';

describe('ids', () => {
  it('orders id strings by number', () => {
    expect(['10', '9', '100'].sort(byNumber)).toEqual(['9', '10', '100']);
  });
  it('drops duplicates and turns numbers into strings', () => {
    expect(sortIds([3, '1', '3', 2])).toEqual(['1', '2', '3']);
    expect(sortIds(new Set(['20', '3']))).toEqual(['3', '20']);
  });
});
```

`test/core/events.test.js`:

```js
import { readFileSync, readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { eventRecord } from '../../src/core/events.js';

const dir = new URL('../fixtures/events/', import.meta.url);

describe('eventRecord', () => {
  it('takes the issue and its parent from a created issue', () => {
    expect(eventRecord({ eventType: 'avi:jira:created:issue', issue: { id: '20', fields: { parent: { id: '10' } } } })).toEqual({ ids: ['10', '20'], kinds: ['issue-created'] });
  });
  it('reads parent, sprint and status changes from the changelog', () => {
    const event = {
      eventType: 'avi:jira:updated:issue',
      issue: { id: '20' },
      changelog: { id: '900', items: [
        { field: 'IssueParentAssociation', fieldId: 'parent', from: '10', to: '11' },
        { field: 'Sprint', fieldId: 'customfield_10020', from: '1', to: '1, 2' },
        { field: 'status', fieldId: 'status', from: '10000', to: '10001' },
      ] },
    };
    expect(eventRecord(event)).toEqual({ ids: ['10', '11', '20'], kinds: ['issue-updated', 'parent', 'sprint-field', 'status'] });
  });
  it('ignores non-numeric changelog values', () => {
    expect(eventRecord({ eventType: 'avi:jira:updated:issue', issue: { id: '20' }, changelog: { items: [{ field: 'Epic Link', from: 'DEMO-1', to: null }] } }).ids).toEqual(['20']);
  });
  it('takes both ends of a link', () => {
    expect(eventRecord({ eventType: 'avi:jira:deleted:issuelink', issueLink: { sourceIssueId: 5, destinationIssueId: 6 } })).toEqual({ ids: ['5', '6'], kinds: ['link'] });
  });
  it('marks sprint, comment and attachment events', () => {
    expect(eventRecord({ eventType: 'avi:jira-software:started:sprint', sprint: { id: 3 } })).toEqual({ ids: [], kinds: ['sprint'] });
    expect(eventRecord({ eventType: 'avi:jira:commented:issue', issue: { id: '20' }, comment: { id: '1' } })).toEqual({ ids: ['20'], kinds: ['comment'] });
    expect(eventRecord({ eventType: 'avi:jira:created:attachment', attachment: { id: '1', issueId: '20' } })).toEqual({ ids: ['20'], kinds: ['attachment'] });
  });
  it('calls anything else unknown', () => {
    expect(eventRecord({ eventType: 'avi:jira:mentioned:issue', issue: { id: '1' } }).kinds).toEqual(['unknown']);
  });
  it.each(readdirSync(dir).filter((f) => f.endsWith('.json')))('reads the documented %s without unknown kinds', (file) => {
    const record = eventRecord(JSON.parse(readFileSync(new URL(file, dir), 'utf8')));
    expect(record.kinds).not.toContain('unknown');
  });
});
```

`test/core/affected.test.js`:

```js
import { describe, expect, it } from 'vitest';
import { familyWants, groupPrecomputations, isTimeRelative, queryOverlap, reconcileTargets, summarizeJournal } from '../../src/core/affected.js';

const row = (ts, ids, kinds) => ({ key: `t:${String(ts).padStart(15, '0')}:abc`, value: { ids, kinds } });
const NOW = Date.parse('2026-10-10T12:00:00Z');
const iso = (msAgo) => new Date(NOW - msAgo).toISOString();
const HOUR = 3600000;

describe('summarizeJournal', () => {
  it('merges ids and kinds and keeps the oldest timestamp', () => {
    expect(summarizeJournal([row(200, ['2', '1'], ['link']), row(100, ['1'], ['issue-updated'])])).toEqual({ touched: ['1', '2'], kinds: ['issue-updated', 'link'], all: false, firstAt: 100 });
  });
  it('recomputes everything when the page is full', () => {
    const rows = Array.from({ length: 100 }, (_, i) => row(i + 1, [String(i)], ['issue-updated']));
    expect(summarizeJournal(rows).all).toBe(true);
  });
  it('recomputes everything after an unknown event or a row without kinds', () => {
    expect(summarizeJournal([row(1, ['1'], ['unknown'])]).all).toBe(true);
    expect(summarizeJournal([{ key: 't:000000000000001:x', value: { ids: ['1'] } }]).all).toBe(true);
  });
  it('recomputes everything when more than 50 issues are touched', () => {
    expect(summarizeJournal([row(1, Array.from({ length: 51 }, (_, i) => String(i)), ['issue-updated'])]).all).toBe(true);
  });
});

describe('groupPrecomputations', () => {
  const pcs = [
    { id: 'a', functionName: 'subtasksOf', arguments: ['project = A'], used: iso(HOUR) },
    { id: 'b', functionName: 'subtasksOf', arguments: ['project = A', '__aq:l2'], used: iso(HOUR) },
    { id: 'c', functionName: 'subtasksOf', arguments: ['project = B'], used: iso(8 * 24 * HOUR) },
    { id: 'd', functionName: 'gone', arguments: [] },
    { id: 'e', functionName: 'hasLinks', arguments: [] },
  ];
  it('joins pages to their root, drops inactive and unknown functions', () => {
    expect(groupPrecomputations(pcs, { now: NOW, activeMs: 7 * 24 * HOUR })).toEqual([
      { key: 'subtasksOf["project = A"]', functionName: 'subtasksOf', family: 'query', userArgs: ['project = A'], items: [pcs[0], pcs[1]] },
      { key: 'hasLinks[]', functionName: 'hasLinks', family: 'links', userArgs: [], items: [pcs[4]] },
    ]);
  });
});

describe('familyWants', () => {
  it('maps change kinds to the families they make stale', () => {
    expect(familyWants('subtasks', ['issue-created'])).toBe(true);
    expect(familyWants('subtasks', ['link'])).toBe(false);
    expect(familyWants('sprint', ['status'])).toBe(true);
    expect(familyWants('board', ['sprint'])).toBe(true);
    expect(familyWants('links', ['link'])).toBe(false);
    expect(familyWants('comment', ['issue-deleted'])).toBe(true);
    expect(familyWants('attachment', ['comment'])).toBe(false);
  });
});

describe('queryOverlap', () => {
  it('is stale when a touched issue is watched', () => {
    expect(queryOverlap({ touched: ['5'], watch: new Set(['5']), liveHits: [] })).toBe(true);
  });
  it('is stale when a touched issue now matches the subquery', () => {
    expect(queryOverlap({ touched: ['5'], watch: new Set(), liveHits: ['5'] })).toBe(true);
  });
  it('is stale when the watch list or the live check is unknown', () => {
    expect(queryOverlap({ touched: ['5'], watch: null, liveHits: [] })).toBe(true);
    expect(queryOverlap({ touched: ['5'], watch: new Set(), liveHits: null })).toBe(true);
  });
  it('is fresh when nothing touched is related', () => {
    expect(queryOverlap({ touched: ['5'], watch: new Set(['6']), liveHits: [] })).toBe(false);
  });
});

describe('reconcileTargets', () => {
  const group = (functionName, userArgs, used, updated) => ({ key: functionName, functionName, family: 'query', userArgs, items: [{ id: 'x', used: iso(used), updated: iso(updated) }] });
  it('picks groups used in the last day that were not rewritten for an hour or depend on the clock', () => {
    const stale = group('a', ['project = A'], HOUR, 2 * HOUR);
    const fresh = group('b', ['project = A'], HOUR, 10 * 60000);
    const clock = group('c', ['after -7d'], HOUR, 10 * 60000);
    const unused = group('d', ['project = A'], 2 * 24 * HOUR, 2 * HOUR);
    expect(reconcileTargets([stale, fresh, clock, unused], { now: NOW, usedMs: 24 * HOUR, staleMs: HOUR, max: 50 })).toEqual([stale, clock]);
  });
  it('keeps at most max groups, oldest first', () => {
    const older = group('a', ['x'], HOUR, 5 * HOUR);
    const newer = group('b', ['x'], HOUR, 2 * HOUR);
    expect(reconcileTargets([newer, older], { now: NOW, usedMs: 24 * HOUR, staleMs: HOUR, max: 1 })).toEqual([older]);
  });
});

describe('isTimeRelative', () => {
  it.each([['after -7d', true], ['created > startOfWeek()', true], ['on 2026-01-01', false], ['project = A-7d', false]])('%s → %s', (arg, expected) => {
    expect(isTimeRelative([arg])).toBe(expected);
  });
});
```

- [ ] **Step 2: Run** `npx vitest run test/core/ids.test.js test/core/events.test.js test/core/affected.test.js` → FAIL.

- [ ] **Step 3: `src/core/ids.js` и `src/core/events.js`.** `src/core/ids.js`:

```js
/** Comparator of numeric id strings. */
export const byNumber = (a, b) => Number(a) - Number(b);

/** Distinct ids as strings, in ascending numeric order. */
export function sortIds(ids) {
  return [...new Set([...ids].map(String))].sort(byNumber);
}
```

`src/core/events.js`:

```js
import { sortIds } from './ids.js';

const PARENT_FIELDS = new Set(['IssueParentAssociation', 'parent', 'Parent', 'Epic Link']);
const NUMERIC = /^\d+$/;

/** Issue ids an event touches and the kinds of change it carries; an unrecognised event is `unknown`. */
export function eventRecord(event) {
  const type = String(event?.eventType ?? '');
  const ids = new Set();
  const kinds = new Set();
  const add = (value) => {
    const s = value === undefined || value === null ? '' : String(value).trim();
    if (NUMERIC.test(s)) ids.add(s);
  };
  add(event?.issue?.id);
  add(event?.issue?.fields?.parent?.id);
  if (type === 'avi:jira:created:issue') kinds.add('issue-created');
  else if (type === 'avi:jira:deleted:issue') kinds.add('issue-deleted');
  else if (type === 'avi:jira:updated:issue') {
    kinds.add('issue-updated');
    for (const item of event?.changelog?.items ?? []) {
      if (PARENT_FIELDS.has(item.field) || item.fieldId === 'parent') {
        kinds.add('parent');
        add(item.from);
        add(item.to);
      } else if (item.field === 'Sprint') kinds.add('sprint-field');
      else if (item.fieldId === 'status' || item.field === 'status') kinds.add('status');
    }
  } else if (type.endsWith(':issuelink')) {
    kinds.add('link');
    add(event?.issueLink?.sourceIssueId);
    add(event?.issueLink?.destinationIssueId);
  } else if (type.startsWith('avi:jira-software:') && type.endsWith(':sprint')) kinds.add('sprint');
  else if (type === 'avi:jira:commented:issue' || type.endsWith(':comment')) kinds.add('comment');
  else if (type.endsWith(':attachment')) {
    kinds.add('attachment');
    add(event?.attachment?.issueId);
  } else kinds.add('unknown');
  return { ids: sortIds(ids), kinds: [...kinds].sort() };
}
```

- [ ] **Step 4: `src/core/affected.js`**

```js
import { JOURNAL_PAGE, MAX_TOUCHED } from './limits.js';
import { FUNCTION_BY_NAME } from './catalog.js';
import { groupKey, splitPage } from './args.js';
import { sortIds } from './ids.js';

const FAMILY_KINDS = {
  query: [],
  links: [],
  subtasks: ['issue-created', 'issue-deleted', 'parent'],
  board: ['sprint'],
  sprint: ['sprint', 'sprint-field', 'status', 'issue-deleted'],
  comment: ['comment', 'issue-deleted'],
  attachment: ['attachment', 'issue-deleted'],
};
const RELATIVE = /(^|[\s"(])[-+]\d+[mhdw]\b|\b(start|end)Of(Day|Week|Month|Year)\s*\(/i;

/** A journal page → touched ids, change kinds, the oldest event time and whether everything must be recomputed. */
export function summarizeJournal(rows, { page = JOURNAL_PAGE, maxTouched = MAX_TOUCHED } = {}) {
  const ids = new Set();
  const kinds = new Set();
  let firstAt = null;
  for (const row of rows) {
    const at = Number(String(row.key).split(':')[1]);
    if (Number.isFinite(at) && (firstAt === null || at < firstAt)) firstAt = at;
    for (const id of row.value?.ids ?? []) ids.add(String(id));
    for (const kind of row.value?.kinds ?? ['unknown']) kinds.add(kind);
  }
  const touched = sortIds(ids);
  const all = rows.length >= page || kinds.has('unknown') || touched.length > maxTouched;
  return { touched, kinds: [...kinds].sort(), all, firstAt };
}

/** Active precomputations of known functions, grouped by function and user arguments (pages join their root). */
export function groupPrecomputations(pcs, { now, activeMs }) {
  const groups = new Map();
  for (const pc of pcs) {
    const f = FUNCTION_BY_NAME.get(pc.functionName);
    if (!f) continue;
    if (pc.used && now - Date.parse(pc.used) > activeMs) continue;
    const { userArgs } = splitPage(pc.arguments);
    const key = groupKey(f.name, userArgs);
    if (!groups.has(key)) groups.set(key, { key, functionName: f.name, family: f.family, userArgs, items: [] });
    groups.get(key).items.push(pc);
  }
  return [...groups.values()];
}

/** Whether changes of these kinds can make a result of this family stale; the query family is decided by overlap. */
export function familyWants(family, kinds) {
  return (FAMILY_KINDS[family] ?? []).some((k) => kinds.includes(k));
}

/** Query family: stale when a touched issue is watched or now matches the subquery; unknown inputs mean stale. */
export function queryOverlap({ touched, watch, liveHits }) {
  if (liveHits === null || watch === null) return true;
  if (liveHits.length) return true;
  return touched.some((id) => watch.has(id));
}

/** Whether arguments mention the clock (`-7d`, `startOfWeek()`), so the result changes without any event. */
export function isTimeRelative(userArgs) {
  return userArgs.some((a) => RELATIVE.test(a));
}

const lastWrite = (g) => Math.min(...g.items.map((pc) => Date.parse(pc.updated ?? pc.created ?? '') || 0));

/** Groups the hourly reconcile recomputes: used within usedMs and not rewritten for staleMs, or tied to the clock. */
export function reconcileTargets(groups, { now, usedMs, staleMs, max }) {
  return groups
    .filter((g) => g.items.some((pc) => pc.used && now - Date.parse(pc.used) <= usedMs))
    .filter((g) => now - lastWrite(g) >= staleMs || isTimeRelative(g.userArgs))
    .sort((a, b) => lastWrite(a) - lastWrite(b))
    .slice(0, max);
}
```

В тесте «picks groups…» ожидаемый порядок `[stale, clock]` совпадает с сортировкой по времени записи (2 ч назад раньше 10 мин назад).

- [ ] **Step 5: Run** `npx vitest run test/core` → PASS; `npm run coverage` → PASS (порог ветвлений `src/core/**`). Если фикстура Task 3 даёт `unknown` — сверить имя события с `docs/live-checks.md` и поправить ветку в `eventRecord` (имена событий — из документации, не из догадки).

- [ ] **Step 6: Commit**

```bash
git add apps/query/src/core apps/query/test/core
git commit -m "JQL-14: Map product events to touched issues and decide which results go stale

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 8: Связи, иерархия, доски и спринты — чистые функции

**Model:** opus

**Files:**
- Create: `apps/query/src/core/{links.js,hierarchy.js,boards.js}`
- Test: `apps/query/test/core/{links.test.js,hierarchy.test.js,boards.test.js}`

**Interfaces:**
- Consumes: `MAX_DEPTH`, `ERR`, `quote` (Tasks 5, 6), `sortIds` (Task 7).
- Produces:
  - `links.js`: `matchLinkType(types, arg|undefined) → { filter: LinkFilter|null } | { error }`, `LinkFilter = { typeId: string, direction: 'any'|'outward'|'inward' }`; `linkedIds(issuelinks, filter) → string[]`; `hasLinksJql(types, filter) → string`; `closure(starts, depth, neighboursOf) → Promise<string[]>` (`neighboursOf(ids) → Promise<Map<string, string[]>>`).
  - `hierarchy.js`: `nodesFrom(issues, nodes = new Map()) → Map<string, Node>`, `Node = { id, parentId: string|null|undefined, level: number, loaded: boolean }`; `parentIds(ids, nodes) → string[]`; `epicOf(id, nodes) → string|null|undefined`; `unresolvedParents(ids, nodes) → string[]`; `descendantParents(starts, depth, childrenOf) → Promise<{ parents: string[], seen: string[] }>` (`childrenOf(ids) → Promise<Map<string, string[]>>`).
  - `boards.js`: `matchBoard(boards, arg) → { item } | { error }`, `matchSprint(sprints, arg) → { item } | { error }`, `sprintWindow(sprint) → { startAt: number|null, completeAt: number|null }`, `activeSprint(sprints) → Sprint|null`, `lastClosed(sprints) → Sprint|null`, `nextFuture(sprints) → Sprint|null`; `Sprint = { id, name, state, startDate?, activatedDate?, completeDate?, originBoardId? }`.

- [ ] **Step 1: Падающие тесты.** `test/core/links.test.js`:

```js
import { describe, expect, it } from 'vitest';
import { closure, hasLinksJql, linkedIds, matchLinkType } from '../../src/core/links.js';

const TYPES = [
  { id: '1', name: 'Blocks', outward: 'blocks', inward: 'is blocked by' },
  { id: '2', name: 'Relates', outward: 'relates to', inward: 'relates to' },
  { id: '3', name: 'Cloners', outward: 'clones', inward: 'is cloned by' },
];
const out = (typeId, id) => ({ type: { id: typeId }, outwardIssue: { id } });
const inw = (typeId, id) => ({ type: { id: typeId }, inwardIssue: { id } });

describe('matchLinkType', () => {
  it('reads a type name as both directions', () => {
    expect(matchLinkType(TYPES, ' blocks ')).toEqual({ filter: { typeId: '1', direction: 'outward' } });
    expect(matchLinkType(TYPES, 'Blocks')).toEqual({ filter: { typeId: '1', direction: 'any' } });
  });
  it('reads a direction description as that direction', () => {
    expect(matchLinkType(TYPES, 'is blocked by')).toEqual({ filter: { typeId: '1', direction: 'inward' } });
  });
  it('treats a symmetric description as both directions', () => {
    expect(matchLinkType(TYPES, 'relates to')).toEqual({ filter: { typeId: '2', direction: 'any' } });
  });
  it('means every link when no type is given', () => {
    expect(matchLinkType(TYPES, undefined)).toEqual({ filter: null });
  });
  it('names an unknown type', () => {
    expect(matchLinkType(TYPES, 'duplicates')).toEqual({ error: 'Link type "duplicates" not found' });
  });
  it('refuses a description shared by two types', () => {
    expect(matchLinkType([...TYPES, { id: '9', name: 'Gates', outward: 'blocks', inward: 'is gated by' }], 'blocks')).toEqual({ error: 'Link type "blocks" matches 2 items; use its id' });
  });
});

describe('linkedIds', () => {
  const links = [out('1', '10'), inw('1', '11'), out('2', '12'), { type: { id: '1' } }];
  it('returns every other end without a filter', () => {
    expect(linkedIds(links, null)).toEqual(['10', '11', '12']);
  });
  it('keeps one type and direction', () => {
    expect(linkedIds(links, { typeId: '1', direction: 'outward' })).toEqual(['10']);
    expect(linkedIds(links, { typeId: '1', direction: 'inward' })).toEqual(['11']);
    expect(linkedIds(links, { typeId: '1', direction: 'any' })).toEqual(['10', '11']);
  });
});

describe('hasLinksJql', () => {
  it('uses the native issueLinkType clause', () => {
    expect(hasLinksJql(TYPES, null)).toBe('issueLinkType is not EMPTY');
    expect(hasLinksJql(TYPES, { typeId: '1', direction: 'outward' })).toBe('issueLinkType = "blocks"');
    expect(hasLinksJql(TYPES, { typeId: '1', direction: 'any' })).toBe('issueLinkType in ("blocks", "is blocked by")');
    expect(hasLinksJql(TYPES, { typeId: '2', direction: 'any' })).toBe('issueLinkType = "relates to"');
  });
});

describe('closure', () => {
  const graph = new Map([['1', ['2']], ['2', ['3', '1']], ['3', ['4']], ['4', ['3']]]);
  const neighboursOf = async (ids) => new Map(ids.map((id) => [id, graph.get(id) ?? []]));
  it('walks links level by level and survives cycles', async () => {
    expect(await closure(['1'], 10, neighboursOf)).toEqual(['1', '2', '3', '4']);
  });
  it('stops at the given depth', async () => {
    expect(await closure(['1'], 2, neighboursOf)).toEqual(['1', '2', '3']);
    expect(await closure(['1'], 1, neighboursOf)).toEqual(['2']);
  });
  it('caps the depth at 10 levels', async () => {
    const chain = async (ids) => new Map(ids.map((id) => [id, [String(Number(id) + 1)]]));
    expect(await closure(['0'], 50, chain)).toEqual(['1', '2', '3', '4', '5', '6', '7', '8', '9', '10']);
  });
});
```

`test/core/hierarchy.test.js`:

```js
import { describe, expect, it } from 'vitest';
import { descendantParents, epicOf, nodesFrom, parentIds, unresolvedParents } from '../../src/core/hierarchy.js';

const issue = (id, level, parent) => ({ id, fields: { issuetype: { hierarchyLevel: level }, ...(parent ? { parent: { id: parent[0], fields: { issuetype: { hierarchyLevel: parent[1] } } } } : {}) } });

describe('nodesFrom', () => {
  it('stores each issue and a stub of its parent', () => {
    expect([...nodesFrom([issue('100', -1, ['10', 0])]).values()]).toEqual([
      { id: '100', parentId: '10', level: -1, loaded: true },
      { id: '10', parentId: undefined, level: 0, loaded: false },
    ]);
  });
  it('never replaces a loaded node with a stub', () => {
    const nodes = nodesFrom([issue('10', 0, ['1', 1])]);
    nodesFrom([issue('100', -1, ['10', 0])], nodes);
    expect(nodes.get('10')).toEqual({ id: '10', parentId: '1', level: 0, loaded: true });
  });
});

describe('epicOf', () => {
  it('finds the epic above a story', () => {
    expect(epicOf('10', nodesFrom([issue('10', 0, ['1', 1])]))).toBe('1');
  });
  it('asks for the story before resolving a subtask', () => {
    const nodes = nodesFrom([issue('100', -1, ['10', 0])]);
    expect(epicOf('100', nodes)).toBeUndefined();
    expect(unresolvedParents(['100'], nodes)).toEqual(['10']);
    nodesFrom([issue('10', 0, ['1', 1])], nodes);
    expect(epicOf('100', nodes)).toBe('1');
    expect(unresolvedParents(['100'], nodes)).toEqual([]);
  });
  it('has no epic for an epic, an orphan or an issue under a higher level', () => {
    expect(epicOf('1', nodesFrom([issue('1', 1)]))).toBeNull();
    expect(epicOf('10', nodesFrom([issue('10', 0)]))).toBeNull();
    expect(epicOf('10', nodesFrom([issue('10', 0, ['5', 2])]))).toBeNull();
  });
});

describe('parentIds', () => {
  it('returns the distinct direct parents', () => {
    expect(parentIds(['100', '101', '1'], nodesFrom([issue('100', -1, ['10', 0]), issue('101', -1, ['10', 0]), issue('1', 1)]))).toEqual(['10']);
  });
});

describe('descendantParents', () => {
  const tree = new Map([['1', ['10', '11']], ['10', ['100', '101']], ['11', []], ['100', []], ['101', []]]);
  const childrenOf = async (ids) => new Map(ids.map((id) => [id, tree.get(id) ?? []]));
  it('collects the parents whose children are the descendants', async () => {
    expect(await descendantParents(['1'], 10, childrenOf)).toEqual({ parents: ['1', '10'], seen: ['1', '10', '11', '100', '101'] });
  });
  it('stops at the depth', async () => {
    expect(await descendantParents(['1'], 1, childrenOf)).toEqual({ parents: ['1'], seen: ['1', '10', '11'] });
  });
});
```

`test/core/boards.test.js`:

```js
import { describe, expect, it } from 'vitest';
import { activeSprint, lastClosed, matchBoard, matchSprint, nextFuture, sprintWindow } from '../../src/core/boards.js';

const BOARDS = [{ id: 7, name: 'Team' }, { id: 8, name: 'team' }, { id: 9, name: '2024' }, { id: 2024, name: 'Ops' }];

describe('matchBoard', () => {
  it('prefers an id for a numeric argument', () => {
    expect(matchBoard(BOARDS, '2024')).toEqual({ item: BOARDS[3] });
  });
  it('falls back to the name when no board has that id', () => {
    expect(matchBoard([{ id: 9, name: '2024' }], '2024')).toEqual({ item: { id: 9, name: '2024' } });
  });
  it('refuses an ambiguous name and names a missing board', () => {
    expect(matchBoard(BOARDS, 'TEAM')).toEqual({ error: 'Board "TEAM" matches 2 items; use its id' });
    expect(matchBoard(BOARDS, 'Nope')).toEqual({ error: 'Board "Nope" not found' });
  });
});

describe('sprints', () => {
  const S = [
    { id: 1, name: 'S1', state: 'closed', startDate: '2026-01-01T00:00:00Z', completeDate: '2026-01-14T00:00:00Z' },
    { id: 2, name: 'S2', state: 'closed', startDate: '2026-01-15T00:00:00Z', activatedDate: '2026-01-15T09:00:00Z', completeDate: '2026-01-28T00:00:00Z' },
    { id: 3, name: 'S3', state: 'active', startDate: '2026-01-29T00:00:00Z' },
    { id: 5, name: 'S5', state: 'future' },
    { id: 4, name: 'S4', state: 'future', startDate: '2026-02-12T00:00:00Z' },
  ];
  it('finds a sprint by id or name', () => {
    expect(matchSprint(S, '2')).toEqual({ item: S[1] });
    expect(matchSprint(S, 's3')).toEqual({ item: S[2] });
  });
  it('uses the activation time as the start', () => {
    expect(sprintWindow(S[1])).toEqual({ startAt: Date.parse('2026-01-15T09:00:00Z'), completeAt: Date.parse('2026-01-28T00:00:00Z') });
    expect(sprintWindow(S[2])).toEqual({ startAt: Date.parse('2026-01-29T00:00:00Z'), completeAt: null });
  });
  it('picks the active, last closed and next future sprint', () => {
    expect(activeSprint(S)).toEqual(S[2]);
    expect(lastClosed(S)).toEqual(S[1]);
    expect(nextFuture(S)).toEqual(S[4]);
    expect([activeSprint([]), lastClosed([]), nextFuture([])]).toEqual([null, null, null]);
  });
});
```

- [ ] **Step 2: Run** `npx vitest run test/core/links.test.js test/core/hierarchy.test.js test/core/boards.test.js` → FAIL.

- [ ] **Step 3: `src/core/links.js`**

```js
import { MAX_DEPTH } from './limits.js';
import { ERR } from './errors.js';
import { quote } from './jql-build.js';
import { sortIds } from './ids.js';

const norm = (s) => String(s ?? '').trim().toLowerCase();

/** Link type argument (type name or direction description) → filter, null for every link, or `{ error }`. */
export function matchLinkType(types, arg) {
  if (arg === undefined) return { filter: null };
  const want = norm(arg);
  const named = types.filter((t) => t.name === arg.trim());
  if (named.length === 1) return { filter: { typeId: String(named[0].id), direction: 'any' } };
  const outward = types.filter((t) => norm(t.outward) === want);
  const inward = types.filter((t) => norm(t.inward) === want);
  const ids = new Set([...outward, ...inward].map((t) => String(t.id)));
  if (!ids.size) {
    const loose = types.filter((t) => norm(t.name) === want);
    return loose.length === 1 ? { filter: { typeId: String(loose[0].id), direction: 'any' } } : { error: ERR.notFound('Link type', arg.trim()) };
  }
  if (ids.size > 1) return { error: ERR.ambiguous('Link type', arg.trim(), ids.size) };
  const [typeId] = ids;
  if (outward.length && inward.length) return { filter: { typeId, direction: 'any' } };
  return { filter: { typeId, direction: outward.length ? 'outward' : 'inward' } };
}

/** Ids at the other end of an issue's links that pass the filter (`outwardIssue`: this issue → it, by type.outward). */
export function linkedIds(issuelinks, filter) {
  const out = [];
  for (const link of issuelinks ?? []) {
    const other = link.outwardIssue ?? link.inwardIssue;
    if (!other) continue;
    const direction = link.outwardIssue ? 'outward' : 'inward';
    if (filter && String(link.type?.id) !== filter.typeId) continue;
    if (filter && filter.direction !== 'any' && filter.direction !== direction) continue;
    out.push(String(other.id));
  }
  return out;
}

/** hasLinks as Jira's own `issueLinkType` clause: always fresh, no value limit. */
export function hasLinksJql(types, filter) {
  if (!filter) return 'issueLinkType is not EMPTY';
  const t = types.find((x) => String(x.id) === filter.typeId);
  const names = filter.direction === 'outward' ? [t.outward] : filter.direction === 'inward' ? [t.inward] : [...new Set([t.outward, t.inward])];
  return names.length === 1 ? `issueLinkType = ${quote(names[0])}` : `issueLinkType in (${names.map(quote).join(', ')})`;
}

/** Issues reachable in 1..depth link steps (at most 10) from the starts; cycles are walked once. */
export async function closure(starts, depth, neighboursOf) {
  const expanded = new Set();
  const reached = new Set();
  let frontier = [...new Set(starts.map(String))];
  for (let level = 1; level <= Math.min(depth, MAX_DEPTH) && frontier.length; level += 1) {
    for (const id of frontier) expanded.add(id);
    const map = await neighboursOf(frontier);
    const next = new Set();
    for (const id of frontier) {
      for (const other of map.get(id) ?? []) {
        reached.add(String(other));
        if (!expanded.has(String(other))) next.add(String(other));
      }
    }
    frontier = [...next];
  }
  return sortIds(reached);
}
```

Тест «reads a type name as both directions» проверяет, что `blocks` (описание) выигрывает у регистронезависимого совпадения имени `Blocks`: точное имя (с учётом регистра) → обе стороны; описание направления → одна сторона; имя без учёта регистра — только когда описаний не нашлось.

- [ ] **Step 4: `src/core/hierarchy.js`**

```js
import { MAX_DEPTH } from './limits.js';
import { sortIds } from './ids.js';

/** Nodes from bulkfetched issues (fields parent, issuetype): each issue, and a stub of its parent if not loaded. */
export function nodesFrom(issues, nodes = new Map()) {
  for (const issue of issues) {
    const parent = issue.fields?.parent;
    nodes.set(String(issue.id), { id: String(issue.id), parentId: parent ? String(parent.id) : null, level: issue.fields?.issuetype?.hierarchyLevel ?? 0, loaded: true });
    if (parent && !nodes.get(String(parent.id))?.loaded) {
      nodes.set(String(parent.id), { id: String(parent.id), parentId: undefined, level: parent.fields?.issuetype?.hierarchyLevel ?? 0, loaded: false });
    }
  }
  return nodes;
}

/** Distinct direct parents of the issues. */
export function parentIds(ids, nodes) {
  return sortIds(ids.map((id) => nodes.get(String(id))?.parentId).filter(Boolean));
}

/** Epic (level 1) above an issue: its id, null when there is none, undefined when a parent must be loaded first. */
export function epicOf(id, nodes) {
  let node = nodes.get(String(id));
  if (!node || node.level >= 1) return null;
  for (let step = 0; step < MAX_DEPTH; step += 1) {
    if (node.parentId === undefined) return undefined;
    if (node.parentId === null) return null;
    const parent = nodes.get(node.parentId);
    if (!parent) return undefined;
    if (parent.level === 1) return parent.id;
    if (parent.level > 1) return null;
    node = parent;
  }
  return null;
}

/** Parent stubs that must be loaded before the epic of every given issue is known. */
export function unresolvedParents(ids, nodes) {
  const out = new Set();
  for (const id of ids) {
    if (epicOf(id, nodes) !== undefined) continue;
    let node = nodes.get(String(id));
    while (node?.loaded && node.parentId) node = nodes.get(node.parentId);
    if (node && !node.loaded) out.add(node.id);
  }
  return sortIds(out);
}

/** Parents whose children are the descendants of the starts within depth: `parent in (these)` returns levels 1..depth. */
export async function descendantParents(starts, depth, childrenOf) {
  const seen = new Set(starts.map(String));
  const parents = new Set();
  let frontier = [...seen];
  for (let level = 1; level <= Math.min(depth, MAX_DEPTH) && frontier.length; level += 1) {
    const children = await childrenOf(frontier);
    const next = [];
    for (const [parent, kids] of children) {
      if (!kids.length) continue;
      parents.add(String(parent));
      for (const kid of kids.map(String)) {
        if (seen.has(kid)) continue;
        seen.add(kid);
        next.push(kid);
      }
    }
    frontier = next;
  }
  return { parents: sortIds(parents), seen: sortIds(seen) };
}
```

- [ ] **Step 5: `src/core/boards.js`**

```js
import { ERR } from './errors.js';

const norm = (s) => String(s ?? '').trim().toLowerCase();
const ms = (v) => (v ? Date.parse(v) : null);

function pick(list, arg, what) {
  const text = String(arg).trim();
  if (/^\d+$/.test(text)) {
    const byId = list.find((x) => String(x.id) === text);
    if (byId) return { item: byId };
  }
  const named = list.filter((x) => norm(x.name) === norm(text));
  if (named.length === 1) return { item: named[0] };
  if (named.length > 1) return { error: ERR.ambiguous(what, text, named.length) };
  return { error: ERR.notFound(what, text) };
}

/** Board by id (a numeric argument is tried as an id first) or by unique name. */
export const matchBoard = (boards, arg) => pick(boards, arg, 'Board');

/** Sprint of a board by id or unique name. */
export const matchSprint = (sprints, arg) => pick(sprints, arg, 'Sprint');

/** Start (actual activation when known) and completion time of a sprint, in ms. */
export function sprintWindow(sprint) {
  return { startAt: ms(sprint.activatedDate ?? sprint.startDate), completeAt: ms(sprint.completeDate) };
}

/** The active sprint with the lowest id, or null. */
export function activeSprint(sprints) {
  return sprints.filter((s) => s.state === 'active').sort((a, b) => a.id - b.id)[0] ?? null;
}

/** The closed sprint completed last, or null. */
export function lastClosed(sprints) {
  return sprints.filter((s) => s.state === 'closed').sort((a, b) => (ms(b.completeDate) ?? 0) - (ms(a.completeDate) ?? 0) || b.id - a.id)[0] ?? null;
}

/** The future sprint planned first (by start date, then id), or null. */
export function nextFuture(sprints) {
  return sprints.filter((s) => s.state === 'future').sort((a, b) => (ms(a.startDate) ?? Infinity) - (ms(b.startDate) ?? Infinity) || a.id - b.id)[0] ?? null;
}
```

Поле старта (`activatedDate` или `startDate`) — по выводу (б) Task 3; если `activatedDate` в ответе Agile нет, `sprintWindow` всё равно берёт `startDate`.

- [ ] **Step 6: Run** `npx vitest run test/core` → PASS; `npm run coverage` → PASS (порог ветвлений `src/core/**`); `npm run lint` → 0 ошибок.

- [ ] **Step 7: Commit**

```bash
git add apps/query/src/core apps/query/test/core
git commit -m "JQL-15: Add pure link, hierarchy, board and sprint helpers

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 9: REST-клиент Jira от имени приложения

**Model:** opus

**Files:**
- Create: `apps/query/src/infra/{pool.js,jira.js}`
- Test: `apps/query/test/infra/jira.test.js`

**Interfaces:**
- Consumes: `ID_PAGE`, `BULK_BATCH`, `BULK_CONCURRENCY`, `CHANGELOG_BATCH`, `CHANGELOG_PAGE`, `PRECOMPUTATION_BATCH`, `PRECOMPUTATION_PAGE`, `REQUEST_ATTEMPTS`, `RETRY_BASE_MS`, `LIST_PAGE`, `USER_SEARCH_MAX`, `MAX_TOUCHED` (Task 5); чисел в коде клиента нет — только эти пределы.
- Produces:
  - `pool(items, concurrency, task) → Promise<results[]>` (порядок сохраняется).
  - `class JiraError extends Error { name: 'JiraError', status: number }` — ответ, который повтор не исправит.
  - `createJira(request, { sleep, attempts }) → Jira`, где `request(path: string, init) → Promise<{ status, headers: { get(name) }, text() }>`; `appJira() → Jira` (боевой: `api.asApp().requestJira(assumeTrustedRoute(path), init)`).
  - `Jira = { call(method, path, body), searchIds(jql, { reconcile }) → string[], bulkIssues(ids, fields) → issue[], issue(id, fields) → issue, linkTypes() → LinkType[], fields() → Field[], statusCategories() → Map<statusId, 'new'|'indeterminate'|'done'>, boards(arg) → Board[], allBoards() → Board[], sprints(boardId) → Sprint[], changelogs(ids, fieldIds) → Map<issueId, ChangeHistory[]>, precomputations() → Pc[], writePrecomputations(updates) → void, userIds(query) → string[], groupMemberIds(name) → string[], roleMemberIds(projectKey, roleName) → string[]|null, approximateCount(jql) → number }`.

- [ ] **Step 1: Падающие тесты** `test/infra/jira.test.js`:

```js
import { describe, expect, it, vi } from 'vitest';

vi.mock('@forge/api', () => ({ default: { asApp: () => ({ requestJira: vi.fn() }) }, assumeTrustedRoute: (p) => p }));
const { createJira, JiraError } = await import('../../src/infra/jira.js');

const reply = (status, body, headers = {}) => ({ status, headers: { get: (n) => headers[n.toLowerCase()] ?? null }, text: async () => (body === undefined ? '' : JSON.stringify(body)) });

function scripted(answers) {
  const calls = [];
  const request = async (path, init) => {
    calls.push({ path, method: init.method, body: init.body ? JSON.parse(init.body) : undefined });
    const next = answers.shift();
    return typeof next === 'function' ? next(path, init) : next;
  };
  return { calls, request };
}

describe('call', () => {
  it('waits Retry-After on 429 and then succeeds', async () => {
    const { request } = scripted([reply(429, {}, { 'retry-after': '2' }), reply(200, { ok: 1 })]);
    const sleep = vi.fn(async () => {});
    expect(await createJira(request, { sleep }).call('GET', '/x')).toEqual({ ok: 1 });
    expect(sleep.mock.calls).toEqual([[2000]]);
  });
  it('gives up on a 5xx after the last attempt', async () => {
    const { request, calls } = scripted([reply(503, {}), reply(503, {}), reply(503, { errorMessages: ['down'] })]);
    await expect(createJira(request, { sleep: async () => {}, attempts: 3 }).call('GET', '/x')).rejects.toMatchObject({ name: 'JiraError', status: 503, message: 'down' });
    expect(calls).toHaveLength(3);
  });
  it('keeps Jira messages of a 400', async () => {
    const { request } = scripted([reply(400, { errorMessages: ['Field "x" does not exist'], errors: { jql: 'bad' } })]);
    const error = await createJira(request).call('POST', '/x', {}).catch((e) => e);
    expect(error).toBeInstanceOf(JiraError);
    expect([error.status, error.message]).toEqual([400, 'Field "x" does not exist; bad']);
  });
});

describe('reads', () => {
  it('pages ids by token and sends at most 50 reconcile ids as numbers', async () => {
    const { request, calls } = scripted([reply(200, { issues: [{ id: '1' }], nextPageToken: 't' }), reply(200, { issues: [{ id: 2 }] })]);
    const touched = Array.from({ length: 60 }, (_, i) => String(i + 1));
    expect(await createJira(request).searchIds('project = A', { reconcile: touched })).toEqual(['1', '2']);
    expect(calls[0].body).toEqual({ jql: 'project = A', fields: ['id'], maxResults: 5000, reconcileIssues: touched.slice(0, 50).map(Number) });
    expect(calls[1].body.nextPageToken).toBe('t');
  });
  it('bulkfetches in batches of 100', async () => {
    const answer = (_p, init) => reply(200, { issues: JSON.parse(init.body).issueIdsOrKeys.map((id) => ({ id })) });
    const { request, calls } = scripted([answer, answer, answer]);
    const ids = Array.from({ length: 250 }, (_, i) => String(i));
    expect((await createJira(request).bulkIssues(ids, ['parent'])).map((x) => x.id)).toEqual(ids);
    expect(calls.map((c) => c.body.issueIdsOrKeys.length).sort()).toEqual([100, 100, 50]);
  });
  it('merges changelog pages per issue', async () => {
    const { request, calls } = scripted([
      reply(200, { issueChangeLogs: [{ issueId: '1', changeHistories: [{ id: 'a' }] }], nextPageToken: 'n' }),
      reply(200, { issueChangeLogs: [{ issueId: '1', changeHistories: [{ id: 'b' }] }, { issueId: '2', changeHistories: [{ id: 'c' }] }] }),
    ]);
    const logs = await createJira(request).changelogs(['1', '2'], ['status']);
    expect([...logs.entries()]).toEqual([['1', [{ id: 'a' }, { id: 'b' }]], ['2', [{ id: 'c' }]]]);
    expect(calls[0].body).toEqual({ issueIdsOrKeys: ['1', '2'], fieldIds: ['status'], maxResults: 10000 });
  });
  it('lists precomputations until the last page', async () => {
    const { request, calls } = scripted([reply(200, { values: [{ id: 'a' }], isLast: false }), reply(200, { values: [{ id: 'b' }], isLast: true })]);
    expect(await createJira(request).precomputations()).toEqual([{ id: 'a' }, { id: 'b' }]);
    expect(calls.map((c) => c.path)).toEqual(['/rest/api/3/jql/function/computation?startAt=0&maxResults=100', '/rest/api/3/jql/function/computation?startAt=1&maxResults=100']);
  });
  it('writes precomputations in batches of 50', async () => {
    const { request, calls } = scripted([reply(204), reply(204), reply(204)]);
    await createJira(request).writePrecomputations(Array.from({ length: 120 }, (_, i) => ({ id: String(i), value: 'id = 1' })));
    expect(calls.map((c) => c.body.values.length)).toEqual([50, 50, 20]);
    expect(calls[0].path).toBe('/rest/api/3/jql/function/computation?skipNotFoundPrecomputations=true');
  });
  it('finds a board by id and by name, and only by name when the id is unknown', async () => {
    const { request } = scripted([reply(200, { values: [{ id: 9, name: '7' }], isLast: true }), reply(200, { id: 7, name: 'Team' })]);
    expect(await createJira(request).boards('7')).toEqual([{ id: 7, name: 'Team' }, { id: 9, name: '7' }]);
    const missing = scripted([reply(200, { values: [{ id: 9, name: '7' }], isLast: true }), reply(404, { errorMessages: ['no'] })]);
    expect(await createJira(missing.request).boards('7')).toEqual([{ id: 9, name: '7' }]);
  });
  it('maps statuses to their categories', async () => {
    const { request } = scripted([reply(200, [{ id: '1', statusCategory: { key: 'done' } }, { id: 2, statusCategory: { key: 'new' } }])]);
    expect([...(await createJira(request).statusCategories()).entries()]).toEqual([['1', 'done'], ['2', 'new']]);
  });
});
```

- [ ] **Step 2: Run** `npx vitest run test/infra/jira.test.js` → FAIL.

- [ ] **Step 3: `src/infra/pool.js`**

```js
/** Runs task over items with at most `concurrency` in flight; results keep the input order. */
export async function pool(items, concurrency, task) {
  const out = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (next < items.length) {
      const i = next;
      next += 1;
      out[i] = await task(items[i], i);
    }
  }));
  return out;
}
```

- [ ] **Step 4: `src/infra/jira.js`**

```js
import api, { assumeTrustedRoute } from '@forge/api';
import {
  BULK_BATCH, BULK_CONCURRENCY, CHANGELOG_BATCH, CHANGELOG_PAGE, ID_PAGE, LIST_PAGE, MAX_TOUCHED, PRECOMPUTATION_BATCH, PRECOMPUTATION_PAGE,
  REQUEST_ATTEMPTS, RETRY_BASE_MS, USER_SEARCH_MAX,
} from '../core/limits.js';
import { pool } from './pool.js';

/** Jira answered with an error that a retry will not fix. */
export class JiraError extends Error {
  constructor(status, messages) {
    super(messages.length ? messages.join('; ') : `Jira answered ${status}`);
    this.name = 'JiraError';
    this.status = status;
  }
}

const wait = (ms) => new Promise((resolve) => {
  setTimeout(resolve, ms);
});
const enc = encodeURIComponent;
const chunks = (list, size) => Array.from({ length: Math.ceil(list.length / size) }, (_, i) => list.slice(i * size, (i + 1) * size));

function messagesOf(raw) {
  try {
    const body = JSON.parse(raw);
    return [...(body.errorMessages ?? []), ...Object.values(body.errors ?? {})].map(String);
  } catch {
    return [];
  }
}

/** Jira REST client over `request(path, init)`; 429 and 5xx are retried with Retry-After or exponential backoff. */
export function createJira(request, { sleep = wait, attempts = REQUEST_ATTEMPTS } = {}) {
  async function call(method, path, body) {
    for (let attempt = 1; ; attempt += 1) {
      const headers = { Accept: 'application/json', ...(body ? { 'Content-Type': 'application/json' } : {}) };
      const res = await request(path, { method, headers, ...(body ? { body: JSON.stringify(body) } : {}) });
      if ((res.status === 429 || res.status >= 500) && attempt < attempts) {
        await sleep(Number(res.headers.get('retry-after')) * 1000 || RETRY_BASE_MS * 2 ** attempt);
        continue;
      }
      const raw = await res.text();
      if (res.status >= 400) throw new JiraError(res.status, messagesOf(raw));
      return raw ? JSON.parse(raw) : null;
    }
  }

  async function paged(path, size = LIST_PAGE) {
    const out = [];
    let startAt = 0;
    for (;;) {
      const page = await call('GET', `${path}${path.includes('?') ? '&' : '?'}startAt=${startAt}&maxResults=${size}`);
      const items = page?.values ?? [];
      out.push(...items);
      startAt += items.length;
      if (page?.isLast === true || !items.length || (Number.isFinite(page?.total) && startAt >= page.total)) return out;
    }
  }

  async function searchIds(jql, { reconcile = [] } = {}) {
    const out = [];
    let nextPageToken;
    do {
      const page = await call('POST', '/rest/api/3/search/jql', {
        jql,
        fields: ['id'],
        maxResults: ID_PAGE,
        ...(reconcile.length ? { reconcileIssues: reconcile.slice(0, MAX_TOUCHED).map(Number) } : {}),
        ...(nextPageToken ? { nextPageToken } : {}),
      });
      out.push(...(page.issues ?? []).map((x) => String(x.id)));
      nextPageToken = page.nextPageToken;
    } while (nextPageToken);
    return out;
  }

  async function bulkIssues(ids, fields) {
    const pages = await pool(chunks(ids, BULK_BATCH), BULK_CONCURRENCY, (chunk) => call('POST', '/rest/api/3/issue/bulkfetch', { issueIdsOrKeys: chunk, fields }));
    return pages.flatMap((p) => p?.issues ?? []);
  }

  async function boards(arg) {
    const text = String(arg).trim();
    const named = await paged(`/rest/agile/1.0/board?name=${enc(text)}`);
    if (!/^\d+$/.test(text)) return named;
    try {
      const byId = await call('GET', `/rest/agile/1.0/board/${text}`);
      return [byId, ...named.filter((b) => String(b.id) !== text)];
    } catch (error) {
      if (error instanceof JiraError && error.status === 404) return named;
      throw error;
    }
  }

  async function changelogs(ids, fieldIds) {
    const out = new Map();
    for (const chunk of chunks(ids, CHANGELOG_BATCH)) {
      let nextPageToken;
      do {
        const page = await call('POST', '/rest/api/3/changelog/bulkfetch', { issueIdsOrKeys: chunk, fieldIds, maxResults: CHANGELOG_PAGE, ...(nextPageToken ? { nextPageToken } : {}) });
        for (const log of page?.issueChangeLogs ?? []) {
          const key = String(log.issueId);
          out.set(key, [...(out.get(key) ?? []), ...(log.changeHistories ?? [])]);
        }
        nextPageToken = page?.nextPageToken;
      } while (nextPageToken);
    }
    return out;
  }

  async function groupMemberIds(name) {
    return (await paged(`/rest/api/3/group/member?groupname=${enc(name)}&includeInactiveUsers=true`)).map((u) => u.accountId);
  }

  async function roleMemberIds(projectKey, roleName) {
    const roles = (await call('GET', `/rest/api/3/project/${enc(projectKey)}/role`)) ?? {};
    const url = Object.entries(roles).find(([name]) => name.toLowerCase() === String(roleName).toLowerCase())?.[1];
    if (!url) return null;
    const role = await call('GET', `/rest/api/3/project/${enc(projectKey)}/role/${enc(String(url).split('/').pop())}`);
    const users = (role?.actors ?? []).filter((a) => a.actorUser).map((a) => a.actorUser.accountId);
    for (const group of (role?.actors ?? []).filter((a) => a.actorGroup).map((a) => a.actorGroup.name)) users.push(...(await groupMemberIds(group)));
    return [...new Set(users)];
  }

  return {
    call,
    searchIds,
    bulkIssues,
    boards,
    changelogs,
    groupMemberIds,
    roleMemberIds,
    issue: (id, fields) => call('GET', `/rest/api/3/issue/${enc(id)}?fields=${fields.map(enc).join(',')}`),
    linkTypes: async () => (await call('GET', '/rest/api/3/issueLinkType'))?.issueLinkTypes ?? [],
    fields: () => call('GET', '/rest/api/3/field'),
    statusCategories: async () => new Map(((await call('GET', '/rest/api/3/status')) ?? []).map((s) => [String(s.id), s.statusCategory?.key ?? 'new'])),
    allBoards: () => paged('/rest/agile/1.0/board'),
    sprints: (boardId) => paged(`/rest/agile/1.0/board/${enc(boardId)}/sprint?state=active,closed,future`),
    precomputations: () => paged('/rest/api/3/jql/function/computation', PRECOMPUTATION_PAGE),
    writePrecomputations: async (updates) => {
      for (const batch of chunks(updates, PRECOMPUTATION_BATCH)) await call('POST', '/rest/api/3/jql/function/computation?skipNotFoundPrecomputations=true', { values: batch });
    },
    userIds: async (query) => ((await call('GET', `/rest/api/3/user/search?query=${enc(query)}&maxResults=${USER_SEARCH_MAX}`)) ?? []).map((u) => u.accountId),
    approximateCount: async (jql) => (await call('POST', '/rest/api/3/search/approximate-count', { jql }))?.count ?? 0,
  };
}

/** Client acting as the app, against the Jira of the installation only. */
export const appJira = () => createJira((path, init) => api.asApp().requestJira(assumeTrustedRoute(path), init));
```

- [ ] **Step 5: Run** `npx vitest run test/infra` → PASS; `npm run lint` → 0 ошибок.

- [ ] **Step 6: Commit**

```bash
git add apps/query/src/infra apps/query/test/infra
git commit -m "JQL-16: Add the app Jira client with retries, paging and batched reads

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 10: Журнал, кэш значений, состояние, очередь (KVS)

**Model:** opus

**Files:**
- Create: `apps/query/src/infra/{journal.js,cache.js,state.js,queue.js}`
- Test: `apps/query/test/infra/{journal.test.js,cache.test.js,state.test.js}`

**Interfaces:**
- Consumes: `test/fakeKvs.js` (Task 4), `CACHE_CHUNK`, `ERROR_LOG_SIZE`, `PAGE_CACHE_MS` (Task 5).
- Produces:
  - `createJournal({ kvs, beginsWith, random }) → { append(record, ts), read(limit) → [{ key, value }], remove(keys) }`; ключ `t:<ts, 15 цифр>:<rand>`.
  - `createValueCache({ kvs, hash }) → { meta(key) → Meta|null, values(key, meta, from, to) → string[], watch(key) → Set|null, write(key, { values, watch, field, rootFilter, at, source }) }`; `Meta = { at, n, nw: number|null, field, rootFilter: string|null, source: 'function'|'refresh'|'job' }`; `key` — `groupKey` группы (корень и все её страницы читают один набор значений), в KVS — `v:<sha1(groupKey)>:{m,c<i>,w<i>}`, а не `v:<pcId>:<chunk>` §3 (P-5).
  - `createState({ kvs }) → { pending, lease, lastWrittenStart, lastRefresh: { get(), set(v), clear() }, progress: { get() → { sprint?, comments? }|null, getPart(part), setPart(part, value), clearPart(part) }, excluded() → string[], setExcluded(keys), recordError(entry), errors() → entry[], addJob(job), jobs(now) → job[] }`; `job = { key, functionName, userArgs, at }`; прогресс каждой части индекса — свой ключ `idx:progress:<part>`, чтобы заполнение двух частей не затирало друг друга.
  - `createQueueClient(queue) → { push(body, delayInSeconds?) }`.

- [ ] **Step 1: Падающие тесты.** `test/infra/journal.test.js`:

```js
import { describe, expect, it } from 'vitest';
import { createFakeKvs } from '../fakeKvs.js';
import { createJournal } from '../../src/infra/journal.js';

const beginsWith = (p) => ({ values: [p] });

describe('journal', () => {
  it('writes one key per event so parallel events never overwrite each other', async () => {
    const kvs = createFakeKvs({ pageSize: 100 });
    let n = 0;
    const journal = createJournal({ kvs, beginsWith, random: () => `r${(n += 1)}` });
    await Promise.all([journal.append({ ids: ['1'], kinds: ['link'] }, 5), journal.append({ ids: ['2'], kinds: ['link'] }, 5)]);
    expect(await journal.read(10)).toEqual([
      { key: 't:000000000000005:r1', value: { ids: ['1'], kinds: ['link'] } },
      { key: 't:000000000000005:r2', value: { ids: ['2'], kinds: ['link'] } },
    ]);
  });
  it('reads the oldest rows first and removes the given keys', async () => {
    const kvs = createFakeKvs({ pageSize: 100 });
    const journal = createJournal({ kvs, beginsWith, random: () => 'x' });
    await journal.append({ ids: [], kinds: ['sprint'] }, 20);
    await journal.append({ ids: ['1'], kinds: ['link'] }, 10);
    const rows = await journal.read(1);
    expect(rows.map((r) => r.key)).toEqual(['t:000000000000010:x']);
    await journal.remove(rows.map((r) => r.key));
    expect((await journal.read(10)).map((r) => r.key)).toEqual(['t:000000000000020:x']);
  });
});
```

`test/infra/cache.test.js`:

```js
import { describe, expect, it } from 'vitest';
import { createFakeKvs } from '../fakeKvs.js';
import { createValueCache } from '../../src/infra/cache.js';

const ids = (n, from = 1) => Array.from({ length: n }, (_, i) => String(from + i));

describe('value cache', () => {
  it('stores values and watched ids in chunks of 5 000 and reads any range', async () => {
    const kvs = createFakeKvs({ pageSize: 100 });
    const cache = createValueCache({ kvs, hash: (s) => s });
    await cache.write('g', { values: ids(12000), watch: ids(3), field: 'id', rootFilter: null, at: 7, source: 'refresh' });
    const meta = await cache.meta('g');
    expect(meta).toEqual({ at: 7, n: 12000, nw: 3, field: 'id', rootFilter: null, source: 'refresh' });
    expect(await cache.values('g', meta, 4999, 5001)).toEqual(['5000', '5001']);
    expect(await cache.values('g', meta, 11000, 13000)).toEqual(ids(1000, 11001));
    expect(await cache.watch('g')).toEqual(new Set(['1', '2', '3']));
    expect([...kvs.data.keys()].filter((k) => k.startsWith('v:g:c'))).toEqual(['v:g:c0', 'v:g:c1', 'v:g:c2']);
  });
  it('deletes chunks a smaller result no longer needs', async () => {
    const kvs = createFakeKvs({ pageSize: 100 });
    const cache = createValueCache({ kvs, hash: (s) => s });
    await cache.write('g', { values: ids(12000), watch: null, field: 'id', rootFilter: null, at: 1, source: 'refresh' });
    await cache.write('g', { values: ids(10), watch: null, field: 'id', rootFilter: null, at: 2, source: 'refresh' });
    expect([...kvs.data.keys()].filter((k) => k.startsWith('v:g:c'))).toEqual(['v:g:c0']);
    expect(await cache.watch('g')).toBeNull();
  });
  it('knows nothing about a group never written', async () => {
    const cache = createValueCache({ kvs: createFakeKvs(), hash: (s) => s });
    expect([await cache.meta('x'), await cache.watch('x')]).toEqual([null, null]);
  });
});
```

`test/infra/state.test.js`:

```js
import { describe, expect, it } from 'vitest';
import { createFakeKvs } from '../fakeKvs.js';
import { createState } from '../../src/infra/state.js';

describe('state', () => {
  it('keeps the newest 20 errors first', async () => {
    const state = createState({ kvs: createFakeKvs() });
    for (let i = 0; i < 25; i += 1) await state.recordError({ at: i, functionName: 'f', message: `m${i}` });
    const errors = await state.errors();
    expect([errors.length, errors[0].message, errors[19].message]).toEqual([20, 'm24', 'm5']);
  });
  it('forgets compute jobs older than the page cache and replaces a job of the same group', async () => {
    const state = createState({ kvs: createFakeKvs() });
    await state.addJob({ key: 'a', functionName: 'f', userArgs: ['x'], at: 0 });
    await state.addJob({ key: 'b', functionName: 'f', userArgs: ['y'], at: 500000 });
    await state.addJob({ key: 'b', functionName: 'f', userArgs: ['y'], at: 550000 });
    expect(await state.jobs(650000)).toEqual([{ key: 'b', functionName: 'f', userArgs: ['y'], at: 550000 }]);
  });
  it('stores excluded projects sorted and unique', async () => {
    const state = createState({ kvs: createFakeKvs() });
    await state.setExcluded(['B', 'A', 'B']);
    expect(await state.excluded()).toEqual(['A', 'B']);
  });
  it('keeps index progress per part', async () => {
    const state = createState({ kvs: createFakeKvs() });
    await state.progress.setPart('sprint', { done: 1, total: 2 });
    expect(await state.progress.get()).toEqual({ sprint: { done: 1, total: 2 } });
    await state.progress.setPart('comments', { done: 0, total: 2 });
    expect(Object.keys(await state.progress.get())).toEqual(['sprint', 'comments']);
  });
  it('reads unset records as null', async () => {
    const state = createState({ kvs: createFakeKvs() });
    expect([await state.pending.get(), await state.lease.get(), await state.progress.get()]).toEqual([null, null, null]);
  });
});
```

- [ ] **Step 2: Run** `npx vitest run test/infra` → FAIL.

- [ ] **Step 3: `src/infra/journal.js`**

```js
const randomTag = () => Math.random().toString(36).slice(2, 8);

/** Journal of touched issues in KVS: one key per event, so concurrent events never overwrite each other. */
export function createJournal({ kvs, beginsWith, random = randomTag }) {
  return {
    append: (record, ts) => kvs.set(`t:${String(ts).padStart(15, '0')}:${random()}`, record),
    read: async (limit) => (await kvs.query().where('key', beginsWith('t:')).limit(limit).getMany()).results ?? [],
    remove: async (keys) => {
      for (const key of keys) await kvs.delete(key);
    },
  };
}
```

- [ ] **Step 4: `src/infra/cache.js`**

```js
import { CACHE_CHUNK } from '../core/limits.js';

/** Value cache of a precomputation group: meta `v:<h>:m`, values `v:<h>:c<i>`, watched ids `v:<h>:w<i>`, ≤ 5 000 ids per key. */
export function createValueCache({ kvs, hash }) {
  const base = (key) => `v:${hash(key)}`;

  async function readChunks(prefix, from, to) {
    const first = Math.floor(from / CACHE_CHUNK);
    const out = [];
    for (let c = first; c * CACHE_CHUNK < to; c += 1) out.push(...((await kvs.get(`${prefix}${c}`)) ?? []));
    return out.slice(from - first * CACHE_CHUNK, to - first * CACHE_CHUNK);
  }

  async function writeChunks(prefix, list, oldCount) {
    const count = Math.ceil(list.length / CACHE_CHUNK);
    for (let c = 0; c < count; c += 1) await kvs.set(`${prefix}${c}`, list.slice(c * CACHE_CHUNK, (c + 1) * CACHE_CHUNK));
    for (let c = count; c < oldCount; c += 1) await kvs.delete(`${prefix}${c}`);
  }

  async function meta(key) {
    return (await kvs.get(`${base(key)}:m`)) ?? null;
  }

  return {
    meta,
    values: (key, m, from, to) => readChunks(`${base(key)}:c`, from, Math.min(to, m.n)),
    async watch(key) {
      const m = await meta(key);
      if (!m || m.nw === null || m.nw === undefined) return null;
      return new Set(await readChunks(`${base(key)}:w`, 0, m.nw));
    },
    async write(key, { values, watch, field, rootFilter, at, source }) {
      const old = await meta(key);
      await writeChunks(`${base(key)}:c`, values, Math.ceil((old?.n ?? 0) / CACHE_CHUNK));
      await writeChunks(`${base(key)}:w`, watch ?? [], Math.ceil((old?.nw ?? 0) / CACHE_CHUNK));
      await kvs.set(`${base(key)}:m`, { at, n: values.length, nw: watch ? watch.length : null, field, rootFilter: rootFilter ?? null, source });
    },
  };
}
```

- [ ] **Step 5: `src/infra/state.js`**

```js
import { ERROR_LOG_SIZE, PAGE_CACHE_MS } from '../core/limits.js';

/** KVS records of the refresh machinery, the error log, index progress and settings. */
export function createState({ kvs }) {
  const record = (key) => ({
    get: async () => (await kvs.get(key)) ?? null,
    set: (value) => kvs.set(key, value),
    clear: () => kvs.delete(key),
  });
  return {
    pending: record('q:pending'),
    lease: record('q:running'),
    lastWrittenStart: record('q:lastWrittenStart'),
    lastRefresh: record('log:refresh'),
    progress: {
      async get() {
        const [sprint, comments] = await Promise.all([kvs.get('idx:progress:sprint'), kvs.get('idx:progress:comments')]);
        if (!sprint && !comments) return null;
        return { ...(sprint ? { sprint } : {}), ...(comments ? { comments } : {}) };
      },
      getPart: async (part) => (await kvs.get(`idx:progress:${part}`)) ?? null,
      setPart: (part, value) => kvs.set(`idx:progress:${part}`, value),
      clearPart: (part) => kvs.delete(`idx:progress:${part}`),
    },
    excluded: async () => (await kvs.get('cfg:excluded')) ?? [],
    setExcluded: (keys) => kvs.set('cfg:excluded', [...new Set(keys)].sort()),
    async recordError(entry) {
      const list = (await kvs.get('log:errors')) ?? [];
      await kvs.set('log:errors', [entry, ...list].slice(0, ERROR_LOG_SIZE));
    },
    errors: async () => (await kvs.get('log:errors')) ?? [],
    async addJob(job) {
      const list = (await kvs.get('q:jobs')) ?? [];
      await kvs.set('q:jobs', [job, ...list.filter((j) => j.key !== job.key)]);
    },
    async jobs(now) {
      const list = (await kvs.get('q:jobs')) ?? [];
      const live = list.filter((j) => now - j.at < PAGE_CACHE_MS);
      if (live.length !== list.length) await kvs.set('q:jobs', live);
      return live;
    },
  };
}
```

Журнал ошибок — чтение-изменение-запись без блокировки: при одновременных ошибках одна запись может потеряться; это диагностика, не данные результата.

- [ ] **Step 6: `src/infra/queue.js`**

```js
/** Pushes a job body to a Forge queue; `delayInSeconds` postpones it. */
export function createQueueClient(queue) {
  return { push: (body, delayInSeconds) => queue.push(delayInSeconds ? { body, delayInSeconds } : { body }) };
}
```

- [ ] **Step 7: Run** `npx vitest run test/infra` → PASS; `npm run lint` → 0 ошибок.

- [ ] **Step 8: Commit**

```bash
git add apps/query/src/infra apps/query/test/infra
git commit -m "JQL-17: Add the event journal, the value cache and refresh state in KVS

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 11: Источники значений — иерархия и hasSubtasks

**Model:** opus

**Files:**
- Create: `apps/query/src/compute/hierarchy.js`, `apps/query/test/fakeJira.js`
- Test: `apps/query/test/compute/hierarchy.test.js`

**Interfaces:**
- Consumes: `Jira.searchIds`, `Jira.bulkIssues` (Task 9); `nodesFrom`, `parentIds`, `epicOf`, `unresolvedParents`, `descendantParents` (Task 8); `sortIds` (Task 7); `VALUE_LIMIT`, `MAX_DEPTH`.
- Produces:
  - Контракт источника значений (общий для `src/compute/*`): `(args, { reconcile: string[] }) → Promise<Result>`, `Result = { ids: string[] (по возрастанию числа), field: 'id'|'parent', rootFilter?: string, watch: string[]|null } | { native: string } | { error: string }`; `watch` — id, чья правка может изменить результат (null — не отслеживается, решает семейство).
  - `createHierarchyCompute({ jira }) → { subtasksOf, parentsOf, epicsOf, issuesInEpics, childIssuesOf, hasSubtasks }`; `SUBTASK_FILTER = 'issuetype in subTaskIssueTypes()'`.
  - `test/fakeJira.js`: `issue(id, { level, parent, subtasks, links })`, `fakeJira({ issues, searches, linkTypes, boards, sprints })` — фейк `Jira` с журналом `calls`.

- [ ] **Step 1: Фейк Jira** `test/fakeJira.js`:

```js
/** Issue as bulkfetch returns it: issuetype level, parent stub with its level, subtasks and links. */
export function issue(id, { level = 0, parent, subtasks = [], links = [] } = {}) {
  return {
    id: String(id),
    fields: {
      issuetype: { hierarchyLevel: level },
      ...(parent ? { parent: { id: String(parent[0]), fields: { issuetype: { hierarchyLevel: parent[1] } } } } : {}),
      subtasks: subtasks.map((s) => ({ id: String(s) })),
      issuelinks: links,
    },
  };
}

/** In-memory Jira: explicit search answers, `parent in (…)` and the subtask search computed from the issues. */
export function fakeJira({ issues = [], searches = {}, linkTypes = [], boards = [], sprints = {} } = {}) {
  const byId = new Map(issues.map((i) => [i.id, i]));
  const calls = [];
  return {
    calls,
    async searchIds(jql, options = {}) {
      calls.push(['search', jql, options.reconcile ?? []]);
      if (jql in searches) {
        const answer = searches[jql];
        if (answer instanceof Error) throw answer;
        return answer;
      }
      const parentIn = /^parent in \(([\d,]+)\)$/.exec(jql);
      if (parentIn) {
        const set = new Set(parentIn[1].split(','));
        return issues.filter((i) => set.has(i.fields.parent?.id)).map((i) => i.id);
      }
      if (jql === 'issuetype in subTaskIssueTypes()') return issues.filter((i) => i.fields.issuetype.hierarchyLevel === -1).map((i) => i.id);
      throw Object.assign(new Error(`unexpected search ${jql}`), { name: 'JiraError', status: 400 });
    },
    async bulkIssues(ids, fields) {
      calls.push(['bulk', ids.length, fields]);
      return ids.map((id) => byId.get(String(id))).filter(Boolean);
    },
    async issue(id) {
      calls.push(['issue', id]);
      return byId.get(String(id));
    },
    linkTypes: async () => linkTypes,
    boards: async (arg) => boards.filter((b) => String(b.id) === String(arg).trim() || b.name.toLowerCase() === String(arg).trim().toLowerCase()),
    sprints: async (boardId) => sprints[boardId] ?? [],
  };
}
```

- [ ] **Step 2: Падающие тесты** `test/compute/hierarchy.test.js`:

```js
import { describe, expect, it } from 'vitest';
import { fakeJira, issue } from '../fakeJira.js';
import { createHierarchyCompute } from '../../src/compute/hierarchy.js';

const ISSUES = [
  issue(1, { level: 1 }),
  issue(10, { parent: [1, 1], subtasks: [100, 101] }),
  issue(11, { parent: [1, 1] }),
  issue(100, { level: -1, parent: [10, 0] }),
  issue(101, { level: -1, parent: [10, 0] }),
  issue(12),
];
const ctx = { reconcile: [] };
const make = (searches) => createHierarchyCompute({ jira: fakeJira({ issues: ISSUES, searches }) });

describe('hierarchy compute', () => {
  it('subtasksOf keeps the inner issues as parents under the subtask filter', async () => {
    expect(await make({ S: ['11', '10'] }).subtasksOf({ subquery: 'S' }, ctx)).toEqual({ ids: ['10', '11'], field: 'parent', rootFilter: 'issuetype in subTaskIssueTypes()', watch: ['11', '10'] });
  });
  it('subtasksOf keeps only parents with subtasks above 1 000 inner issues', async () => {
    const many = [...Array.from({ length: 1001 }, (_, i) => String(5000 + i)), '10'];
    const result = await make({ S: many }).subtasksOf({ subquery: 'S' }, ctx);
    expect(result.ids).toEqual(['10']);
  });
  it('parentsOf returns direct parents of any level', async () => {
    expect(await make({ S: ['100', '11', '12'] }).parentsOf({ subquery: 'S' }, ctx)).toEqual({ ids: ['1', '10'], field: 'id', watch: ['100', '11', '12'] });
  });
  it('epicsOf loads the story above a subtask to reach the epic', async () => {
    const result = await make({ S: ['100', '12'] }).epicsOf({ subquery: 'S' }, ctx);
    expect(result).toEqual({ ids: ['1'], field: 'id', watch: ['1', '10', '12', '100'] });
  });
  it('issuesInEpics keeps the epics of the subquery as parents', async () => {
    expect(await make({ S: ['1', '10'] }).issuesInEpics({ subquery: 'S' }, ctx)).toEqual({ ids: ['1'], field: 'parent', watch: ['1', '10'] });
  });
  it('childIssuesOf walks all levels by default and stops at the depth', async () => {
    const compute = make({ S: ['1'] });
    expect(await compute.childIssuesOf({ subquery: 'S' }, ctx)).toEqual({ ids: ['1', '10'], field: 'parent', watch: ['1', '10', '11', '100', '101'] });
    expect(await compute.childIssuesOf({ subquery: 'S', depth: 1 }, ctx)).toEqual({ ids: ['1'], field: 'parent', watch: ['1', '10', '11'] });
  });
  it('hasSubtasks returns the parents of all subtasks', async () => {
    expect(await make({}).hasSubtasks({}, ctx)).toEqual({ ids: ['10'], field: 'id', watch: null });
  });
  it('passes touched issues to the inner search for read-after-write', async () => {
    const jira = fakeJira({ issues: ISSUES, searches: { S: ['10'] } });
    await createHierarchyCompute({ jira }).parentsOf({ subquery: 'S' }, { reconcile: ['10'] });
    expect(jira.calls[0]).toEqual(['search', 'S', ['10']]);
  });
});
```

- [ ] **Step 3: Run** `npx vitest run test/compute` → FAIL.

- [ ] **Step 4: `src/compute/hierarchy.js`**

```js
import { MAX_DEPTH, VALUE_LIMIT } from '../core/limits.js';
import { descendantParents, epicOf, nodesFrom, parentIds, unresolvedParents } from '../core/hierarchy.js';
import { sortIds } from '../core/ids.js';

/** Root filter of subtasksOf. */
export const SUBTASK_FILTER = 'issuetype in subTaskIssueTypes()';

/** Value sources of the hierarchy functions and hasSubtasks. */
export function createHierarchyCompute({ jira }) {
  const inner = (subquery, reconcile) => jira.searchIds(subquery, { reconcile });

  async function loadNodes(ids) {
    const nodes = nodesFrom(await jira.bulkIssues(ids, ['parent', 'issuetype']));
    for (let round = 0; round < MAX_DEPTH; round += 1) {
      const missing = unresolvedParents(ids, nodes);
      if (!missing.length) break;
      nodesFrom(await jira.bulkIssues(missing, ['parent', 'issuetype']), nodes);
    }
    return nodes;
  }

  async function childrenOf(parents) {
    const map = new Map(parents.map((p) => [String(p), []]));
    for (let i = 0; i < parents.length; i += VALUE_LIMIT) {
      const kids = await jira.searchIds(`parent in (${parents.slice(i, i + VALUE_LIMIT).join(',')})`);
      for (const kid of await jira.bulkIssues(kids, ['parent'])) map.get(String(kid.fields?.parent?.id))?.push(String(kid.id));
    }
    return map;
  }

  return {
    async subtasksOf({ subquery }, { reconcile }) {
      const ids = await inner(subquery, reconcile);
      let parents = ids;
      if (ids.length > VALUE_LIMIT) parents = (await jira.bulkIssues(ids, ['subtasks'])).filter((x) => x.fields?.subtasks?.length).map((x) => x.id);
      return { ids: sortIds(parents), field: 'parent', rootFilter: SUBTASK_FILTER, watch: ids };
    },
    async parentsOf({ subquery }, { reconcile }) {
      const ids = await inner(subquery, reconcile);
      return { ids: parentIds(ids, nodesFrom(await jira.bulkIssues(ids, ['parent', 'issuetype']))), field: 'id', watch: ids };
    },
    async epicsOf({ subquery }, { reconcile }) {
      const ids = await inner(subquery, reconcile);
      const nodes = await loadNodes(ids);
      return { ids: sortIds(ids.map((id) => epicOf(id, nodes)).filter(Boolean)), field: 'id', watch: sortIds([...ids, ...nodes.keys()]) };
    },
    async issuesInEpics({ subquery }, { reconcile }) {
      const ids = await inner(subquery, reconcile);
      const epics = (await jira.bulkIssues(ids, ['issuetype'])).filter((x) => x.fields?.issuetype?.hierarchyLevel === 1).map((x) => x.id);
      return { ids: sortIds(epics), field: 'parent', watch: ids };
    },
    async childIssuesOf({ subquery, depth }, { reconcile }) {
      const ids = await inner(subquery, reconcile);
      const { parents, seen } = await descendantParents(ids, depth ?? MAX_DEPTH, childrenOf);
      return { ids: parents, field: 'parent', watch: seen };
    },
    async hasSubtasks() {
      const subtasks = await jira.searchIds(SUBTASK_FILTER);
      const parents = (await jira.bulkIssues(subtasks, ['parent'])).map((x) => x.fields?.parent?.id).filter(Boolean);
      return { ids: sortIds(parents), field: 'id', watch: null };
    },
  };
}
```

В тесте `epicsOf` узел `1` — заглушка родителя `10`, попадает в `watch` вместе с загруженными: правка эпика (смена уровня) тоже меняет ответ.

- [ ] **Step 5: Run** `npx vitest run test/compute` → PASS; `npm run lint` → 0 ошибок.

- [ ] **Step 6: Commit**

```bash
git add apps/query/src/compute apps/query/test/compute apps/query/test/fakeJira.js
git commit -m "JQL-18: Compute subtasks, parents, epics, epic children, descendants and hasSubtasks

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 12: Источники значений — связи и доски

**Model:** opus

**Files:**
- Create: `apps/query/src/compute/{links.js,boards.js}`
- Test: `apps/query/test/compute/{links.test.js,boards.test.js}`

**Interfaces:**
- Consumes: контракт источника значений и `fakeJira` (Task 11); `matchLinkType`, `linkedIds`, `hasLinksJql`, `closure` (Task 8); `matchBoard`, `lastClosed`, `nextFuture` (Task 8); `EMPTY` (Task 6); `sortIds` (Task 7); `MAX_DEPTH`.
- Produces: `createLinkCompute({ jira }) → { linkedIssuesOf, linkedIssuesOfRecursive, linkedIssuesOfRecursiveLimited, hasLinks, hasLinkType }`; `createBoardCompute({ jira }) → { previousSprint, nextSprint, boardOf(arg) → { item }|{ error } }`.

- [ ] **Step 1: Падающие тесты.** `test/compute/links.test.js`:

```js
import { describe, expect, it } from 'vitest';
import { fakeJira, issue } from '../fakeJira.js';
import { createLinkCompute } from '../../src/compute/links.js';

const TYPES = [{ id: '1', name: 'Blocks', outward: 'blocks', inward: 'is blocked by' }, { id: '2', name: 'Relates', outward: 'relates to', inward: 'relates to' }];
const out = (t, id) => ({ type: { id: t }, outwardIssue: { id: String(id) } });
const inw = (t, id) => ({ type: { id: t }, inwardIssue: { id: String(id) } });
const ISSUES = [
  issue(1, { links: [out('1', 2), inw('2', 5)] }),
  issue(2, { links: [inw('1', 1), out('1', 3)] }),
  issue(3, { links: [inw('1', 2), out('1', 1)] }),
  issue(5, { links: [out('2', 1)] }),
];
const ctx = { reconcile: [] };
const make = (searches) => createLinkCompute({ jira: fakeJira({ issues: ISSUES, searches, linkTypes: TYPES }) });

describe('link compute', () => {
  it('linkedIssuesOf returns every linked issue without a type', async () => {
    expect(await make({ S: ['1'] }).linkedIssuesOf({ subquery: 'S' }, ctx)).toEqual({ ids: ['2', '5'], field: 'id', watch: ['1'] });
  });
  it('linkedIssuesOf follows one direction of a type', async () => {
    expect((await make({ S: ['2'] }).linkedIssuesOf({ subquery: 'S', linkType: 'blocks' }, ctx)).ids).toEqual(['3']);
    expect((await make({ S: ['2'] }).linkedIssuesOf({ subquery: 'S', linkType: 'is blocked by' }, ctx)).ids).toEqual(['1']);
  });
  it('linkedIssuesOf names an unknown link type before searching', async () => {
    expect(await make({}).linkedIssuesOf({ subquery: 'S', linkType: 'nope' }, ctx)).toEqual({ error: 'Link type "nope" not found' });
  });
  it('linkedIssuesOfRecursive follows a cycle once and watches every reached issue', async () => {
    expect(await make({ S: ['1'] }).linkedIssuesOfRecursive({ subquery: 'S', linkType: 'blocks' }, ctx)).toEqual({ ids: ['1', '2', '3'], field: 'id', watch: ['1', '2', '3'] });
  });
  it('linkedIssuesOfRecursiveLimited stops at the depth', async () => {
    expect((await make({ S: ['1'] }).linkedIssuesOfRecursiveLimited({ subquery: 'S', depth: 1, linkType: 'blocks' }, ctx)).ids).toEqual(['2']);
  });
  it('re-reads touched inner issues one by one for links bulkfetch may still miss', async () => {
    const jira = fakeJira({ issues: ISSUES, searches: { S: ['1', '2'] }, linkTypes: TYPES });
    await createLinkCompute({ jira }).linkedIssuesOf({ subquery: 'S' }, { reconcile: ['2', '9'] });
    expect(jira.calls.filter((c) => c[0] === 'issue')).toEqual([['issue', '2']]);
  });
  it('hasLinks and hasLinkType answer with native JQL', async () => {
    const compute = make({});
    expect(await compute.hasLinks({}, ctx)).toEqual({ native: 'issueLinkType is not EMPTY' });
    expect(await compute.hasLinkType({ linkType: 'Blocks' }, ctx)).toEqual({ native: 'issueLinkType in ("blocks", "is blocked by")' });
  });
});
```

`test/compute/boards.test.js`:

```js
import { describe, expect, it } from 'vitest';
import { fakeJira } from '../fakeJira.js';
import { createBoardCompute } from '../../src/compute/boards.js';

const jira = fakeJira({
  boards: [{ id: 7, name: 'DEMO board' }],
  sprints: { 7: [{ id: 1, state: 'closed', completeDate: '2026-01-14T00:00:00Z' }, { id: 2, state: 'active' }, { id: 3, state: 'future' }] },
});

describe('board compute', () => {
  it('previousSprint and nextSprint compile to the native sprint clause', async () => {
    const compute = createBoardCompute({ jira });
    expect(await compute.previousSprint({ board: 'demo board' })).toEqual({ native: 'sprint = 1' });
    expect(await compute.nextSprint({ board: '7' })).toEqual({ native: 'sprint = 3' });
  });
  it('matches nothing when the board has no such sprint', async () => {
    const empty = createBoardCompute({ jira: fakeJira({ boards: [{ id: 8, name: 'B' }] }) });
    expect(await empty.previousSprint({ board: 'B' })).toEqual({ native: 'id = -1' });
  });
  it('names a missing board', async () => {
    expect(await createBoardCompute({ jira }).nextSprint({ board: 'Nope' })).toEqual({ error: 'Board "Nope" not found' });
  });
});
```

- [ ] **Step 2: Run** `npx vitest run test/compute` → FAIL.

- [ ] **Step 3: `src/compute/links.js`**

```js
import { MAX_DEPTH } from '../core/limits.js';
import { closure, hasLinksJql, linkedIds, matchLinkType } from '../core/links.js';
import { sortIds } from '../core/ids.js';

/** Value sources of the link functions; hasLinks/hasLinkType compile to Jira's own issueLinkType clause. */
export function createLinkCompute({ jira }) {
  async function filterOf(linkType) {
    if (linkType === undefined) return { filter: null };
    return matchLinkType(await jira.linkTypes(), linkType);
  }

  async function linksOf(ids, reconcile) {
    const map = new Map();
    for (const x of await jira.bulkIssues(ids, ['issuelinks'])) map.set(String(x.id), x.fields?.issuelinks ?? []);
    const asked = new Set(ids.map(String));
    for (const id of reconcile.filter((r) => asked.has(String(r)))) {
      const fresh = await jira.issue(id, ['issuelinks']);
      if (fresh) map.set(String(id), fresh.fields?.issuelinks ?? []);
    }
    return map;
  }

  async function recursive({ subquery, linkType }, depth, reconcile) {
    const f = await filterOf(linkType);
    if (f.error) return f;
    const ids = await jira.searchIds(subquery, { reconcile });
    const reached = await closure(ids, depth, async (frontier) => {
      const map = await linksOf(frontier, reconcile);
      return new Map(frontier.map((id) => [id, linkedIds(map.get(id), f.filter)]));
    });
    return { ids: reached, field: 'id', watch: sortIds([...ids, ...reached]) };
  }

  async function hasLinks({ linkType }) {
    const f = await filterOf(linkType);
    if (f.error) return f;
    return { native: hasLinksJql(await jira.linkTypes(), f.filter) };
  }

  return {
    async linkedIssuesOf({ subquery, linkType }, { reconcile }) {
      const f = await filterOf(linkType);
      if (f.error) return f;
      const ids = await jira.searchIds(subquery, { reconcile });
      const map = await linksOf(ids, reconcile);
      return { ids: sortIds(ids.flatMap((id) => linkedIds(map.get(id), f.filter))), field: 'id', watch: ids };
    },
    linkedIssuesOfRecursive: (args, { reconcile }) => recursive(args, MAX_DEPTH, reconcile),
    linkedIssuesOfRecursiveLimited: (args, { reconcile }) => recursive(args, args.depth, reconcile),
    hasLinks,
    hasLinkType: hasLinks,
  };
}
```

Повторное чтение тронутых задач по одной — находка прототипа: bulkfetch сразу после события связи иногда ещё не видит новую связь.

- [ ] **Step 4: `src/compute/boards.js`**

```js
import { lastClosed, matchBoard, nextFuture } from '../core/boards.js';
import { EMPTY } from '../core/jql-build.js';

/** Value sources of previousSprint/nextSprint: Jira's own `sprint = <id>` clause of the chosen sprint. */
export function createBoardCompute({ jira }) {
  const boardOf = async (arg) => matchBoard(await jira.boards(arg), arg);
  const sprintOf = (pick) => async ({ board }) => {
    const b = await boardOf(board);
    if (b.error) return b;
    const sprint = pick(await jira.sprints(b.item.id));
    return { native: sprint ? `sprint = ${sprint.id}` : EMPTY };
  };
  return { boardOf, previousSprint: sprintOf(lastClosed), nextSprint: sprintOf(nextFuture) };
}
```

- [ ] **Step 5: Run** `npx vitest run test/compute` → PASS; `npm run lint` → 0 ошибок.

- [ ] **Step 6: Commit**

```bash
git add apps/query/src/compute apps/query/test/compute
git commit -m "JQL-19: Compute linked issues, link closures, hasLinks and previous or next sprint

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 13: Вычисление JQL-функции, манифест функций M1, сборка зависимостей

**Model:** opus

**Files:**
- Create: `apps/query/src/core/readiness.js`, `apps/query/src/handlers/functions.js`, `apps/query/src/deps.js`, `apps/query/scripts/gen-manifest-functions.mjs`
- Modify: `apps/query/src/index.js`, `apps/query/manifest.yml`
- Test: `apps/query/test/core/readiness.test.js`, `apps/query/test/handlers/functions.test.js`, `apps/query/test/manifestFunctions.test.js`

**Interfaces:**
- Consumes: Tasks 5–12; `decideLicence` (Task 4); поля лицензии в контексте функции — `docs/live-checks.md` (Task 3, вывод «в»).
- Produces:
  - `readiness.js`: `indexPartOf(group) → 'sprint'|'comments'|null`, `readinessError(progress, group) → string|null`; `progress = { sprint?: Part, comments?: Part }`, `Part = { generation, startedAt, done, total, cursor|null, finishedAt|null, readyAt|null }` (`readyAt` — первое полное заполнение; переиндексация проекта его не сбрасывает, сброс индекса — сбрасывает).
  - `functions.js` (бюджет `FUNCTION_BUDGET_MS` = 20 с — внутренний, под предел платформы 25 с, P-4; ошибка Jira по subquery передаётся как есть с приставкой `ERR.withFunction`): `licenceInput(payload, context) → { environmentType, license }`; `computeGroup(deps, functionName, args, userArgs, { reconcile, source }) → Promise<Result>` (пишет кэш для результатов-списков); `fragmentFor(functionName, userArgs, page, result, levels) → { jql }|{ error }`; `handleFunction(deps, functionName, payload, context) → { jql } | { error, storeErrorAsPrecomputation: false }`; `createFunctionHandlers(deps) → { [functionName]: (payload, context) => Promise }`.
  - `Deps = { jira, state, cache, journal, queue, backfillQueue, compute: { [functionName]: source }, indexEvent(event), indexReconcile(), now(), sleep(ms), levels, debugEvents, ready(functionName) → string|null }`; `createDeps()` в `src/deps.js`.

- [ ] **Step 1: Падающие тесты.** `test/core/readiness.test.js`:

```js
import { describe, expect, it } from 'vitest';
import { indexPartOf, readinessError } from '../../src/core/readiness.js';

describe('readiness', () => {
  it('maps groups to index parts', () => {
    expect([indexPartOf('sprint'), indexPartOf('comment'), indexPartOf('attachment'), indexPartOf('query')]).toEqual(['sprint', 'comments', 'comments', null]);
  });
  it('needs nothing for groups without an index', () => {
    expect(readinessError(null, 'query')).toBeNull();
  });
  it('reports progress until the part was built once', () => {
    expect(readinessError({ sprint: { done: 12400, total: 50000 } }, 'sprint')).toBe('Index is building: 12,400 of 50,000 issues');
    expect(readinessError(null, 'comment')).toBe('Index is building: 0 of 0 issues');
    expect(readinessError({ sprint: { done: 5, total: 5, finishedAt: 9, readyAt: 9 } }, 'sprint')).toBeNull();
  });
  it('stays ready while a project is reindexed', () => {
    expect(readinessError({ comments: { done: 10, total: 900, finishedAt: null, readyAt: 9 } }, 'attachment')).toBeNull();
  });
});
```

`test/handlers/functions.test.js`:

```js
import { describe, expect, it } from 'vitest';
import { createFakeKvs } from '../fakeKvs.js';
import { createValueCache } from '../../src/infra/cache.js';
import { createState } from '../../src/infra/state.js';
import { fragmentFor, handleFunction } from '../../src/handlers/functions.js';
import { PAGE_CACHE_MS } from '../../src/core/limits.js';

const ids = (n) => Array.from({ length: n }, (_, i) => String(i + 1));
const payload = (...args) => ({ clause: { field: 'issue', operator: 'in', arguments: args } });
const DEV = { environmentType: 'DEVELOPMENT' };
const never = () => new Promise(() => {});

function makeDeps(compute, extra = {}) {
  const kvs = createFakeKvs({ pageSize: 100 });
  let now = 1000000;
  const pushed = [];
  return {
    cache: createValueCache({ kvs, hash: (s) => s }),
    state: createState({ kvs }),
    queue: { push: async (body) => { pushed.push(body); } },
    compute,
    ready: async () => null,
    now: () => now,
    advance: (ms) => { now += ms; },
    sleep: never,
    levels: 1,
    pushed,
    ...extra,
  };
}

describe('handleFunction', () => {
  it('returns an id list for a small result', async () => {
    const deps = makeDeps({ parentsOf: async () => ({ ids: ['3', '5'], field: 'id', watch: ['9'] }) });
    expect(await handleFunction(deps, 'parentsOf', payload('project = A'), DEV)).toEqual({ jql: 'id in (3,5)' });
  });
  it('answers unlicensed in production without an active licence', async () => {
    const deps = makeDeps({});
    expect(await handleFunction(deps, 'parentsOf', payload('q'), { environmentType: 'PRODUCTION', license: { active: false } })).toEqual({ error: 'ArtUp Query license is not active', storeErrorAsPrecomputation: false });
  });
  it('shows argument errors and logs them without the arguments', async () => {
    const deps = makeDeps({});
    expect(await handleFunction(deps, 'subtasksOf', payload(), DEV)).toEqual({ error: 'Usage: subtasksOf(subquery)', storeErrorAsPrecomputation: false });
    expect(await deps.state.errors()).toEqual([{ at: 1000000, functionName: 'subtasksOf', message: 'Usage: subtasksOf(subquery)' }]);
  });
  it('turns a Jira 400 on the subquery into the function error', async () => {
    const bad = Object.assign(new Error('Field \'x\' does not exist'), { name: 'JiraError', status: 400 });
    const deps = makeDeps({ subtasksOf: async () => { throw bad; } });
    expect(await handleFunction(deps, 'subtasksOf', payload('x = 1'), DEV)).toEqual({ error: 'subtasksOf: Field \'x\' does not exist', storeErrorAsPrecomputation: false });
  });
  it('serves a leaf page from the values the root cached', async () => {
    let calls = 0;
    const deps = makeDeps({ linkedIssuesOf: async () => { calls += 1; return { ids: ids(2500), field: 'id', watch: [] }; } });
    const root = await handleFunction(deps, 'linkedIssuesOf', payload('q'), DEV);
    expect(root.jql).toBe('(issue in linkedIssuesOf("q", "__aq:l1") OR issue in linkedIssuesOf("q", "__aq:l2") OR issue in linkedIssuesOf("q", "__aq:l3"))');
    expect(await handleFunction(deps, 'linkedIssuesOf', payload('q', '__aq:l3'), DEV)).toEqual({ jql: `id in (${ids(2500).slice(2000).join(',')})` });
    expect(calls).toBe(1);
  });
  it('recomputes a page once the cache expired', async () => {
    let calls = 0;
    const deps = makeDeps({ linkedIssuesOf: async () => { calls += 1; return { ids: ids(1500), field: 'id', watch: [] }; } });
    await handleFunction(deps, 'linkedIssuesOf', payload('q'), DEV);
    deps.advance(PAGE_CACHE_MS);
    await handleFunction(deps, 'linkedIssuesOf', payload('q', '__aq:l2'), DEV);
    expect(calls).toBe(2);
  });
  it('queues the computation when the budget runs out and says so', async () => {
    const deps = makeDeps({ subtasksOf: never }, { sleep: async () => {} });
    expect(await handleFunction(deps, 'subtasksOf', payload('project = A'), DEV)).toEqual({ error: 'Computing, retry in a minute', storeErrorAsPrecomputation: false });
    expect(deps.pushed).toEqual([{ kind: 'compute', functionName: 'subtasksOf', userArgs: ['project = A'] }]);
    expect((await deps.state.jobs(1000000)).map((j) => j.key)).toEqual(['subtasksOf["project = A"]']);
    expect(await deps.state.errors()).toEqual([]);
  });
  it('queues the computation when Jira keeps failing', async () => {
    const deps = makeDeps({ subtasksOf: async () => { throw Object.assign(new Error('down'), { name: 'JiraError', status: 503 }); } });
    expect((await handleFunction(deps, 'subtasksOf', payload('project = A'), DEV)).error).toBe('Computing, retry in a minute');
    expect(deps.pushed).toHaveLength(1);
  });
  it('serves the root from a finished compute job', async () => {
    const deps = makeDeps({ subtasksOf: never });
    await deps.cache.write('subtasksOf["project = A"]', { values: ['4'], watch: ['4'], field: 'parent', rootFilter: 'issuetype in subTaskIssueTypes()', at: 1000000, source: 'job' });
    expect(await handleFunction(deps, 'subtasksOf', payload('project = A'), DEV)).toEqual({ jql: 'issuetype in subTaskIssueTypes() AND (parent in (4))' });
  });
  it('returns native JQL as it is', async () => {
    const deps = makeDeps({ hasLinks: async () => ({ native: 'issueLinkType is not EMPTY' }) });
    expect(await handleFunction(deps, 'hasLinks', payload(), DEV)).toEqual({ jql: 'issueLinkType is not EMPTY' });
  });
  it('answers the index error while the index builds', async () => {
    const deps = makeDeps({}, { ready: async () => 'Index is building: 5 of 10 issues' });
    expect((await handleFunction(deps, 'parentsOf', payload('q'), DEV)).error).toBe('Index is building: 5 of 10 issues');
  });
});

describe('fragmentFor', () => {
  it('passes an error through', () => {
    expect(fragmentFor('parentsOf', ['q'], null, { error: 'x' }, 1)).toEqual({ error: 'x' });
  });
});
```

`test/manifestFunctions.test.js`:

```js
import { readFileSync } from 'node:fs';
import { parse } from 'yaml';
import { describe, expect, it } from 'vitest';
import { shippedFunctions } from '../src/core/catalog.js';

const manifest = parse(readFileSync(new URL('../manifest.yml', import.meta.url), 'utf8'));
const indexText = readFileSync(new URL('../src/index.js', import.meta.url), 'utf8');
const declared = manifest.modules['jira:jqlFunction'];

describe('manifest JQL functions', () => {
  it('declares exactly the shipped functions in catalog order', () => {
    expect(declared.map((m) => [m.key, m.name])).toEqual(shippedFunctions().map((f) => [f.key, f.name]));
  });
  it('declares the user arguments plus the hidden page argument, issue type, in and not in', () => {
    for (const f of shippedFunctions()) {
      const m = declared.find((x) => x.name === f.name);
      expect(m.arguments, f.name).toEqual([...f.args.map((a) => ({ name: a.name, required: a.required })), { name: 'page', required: false }]);
      expect([m.types, m.operators]).toEqual([['issue'], ['in', 'not in']]);
    }
  });
  it('points every function at an exported handler', () => {
    const handlers = new Map(manifest.modules.function.map((x) => [x.key, x.handler]));
    for (const m of declared) {
      expect(handlers.get(m.function), m.name).toBe(`index.${m.name}`);
      expect(indexText).toMatch(new RegExp(`\\b${m.name}\\b`));
    }
  });
  it('asks for no write scope except app data and no egress', () => {
    expect(manifest.permissions.scopes.filter((s) => s.startsWith('write:') && s !== 'write:app-data:jira')).toEqual([]);
    expect(manifest.permissions.external).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run** `npx vitest run` → FAIL.

- [ ] **Step 3: `src/core/readiness.js`**

```js
import { ERR } from './errors.js';

const PART_OF_GROUP = { sprint: 'sprint', comment: 'comments', attachment: 'comments' };

/** The index part a function group reads, or null. */
export function indexPartOf(group) {
  return PART_OF_GROUP[group] ?? null;
}

/** "Index is building" until the part a group needs was built once (a later reindex keeps it ready); null when not needed. */
export function readinessError(progress, group) {
  const part = indexPartOf(group);
  if (!part || progress?.[part]?.readyAt) return null;
  return ERR.indexBuilding(progress?.[part]?.done ?? 0, progress?.[part]?.total ?? 0);
}
```

- [ ] **Step 4: `src/handlers/functions.js`**

```js
import { decideLicence } from '../access.js';
import { groupKey, parseArgs } from '../core/args.js';
import { FUNCTIONS } from '../core/catalog.js';
import { ERR } from '../core/errors.js';
import { FUNCTION_BUDGET_MS, PAGE_CACHE_MS, VALUE_LIMIT } from '../core/limits.js';
import { buildFragment, valuesOf } from '../core/tree.js';

const TIMEOUT = Symbol('timeout');

/** Licence input of a JQL function call: the handler context first, the payload context as a fallback. */
export function licenceInput(payload, context) {
  return {
    environmentType: context?.environmentType ?? payload?.context?.environmentType,
    license: context?.license ?? payload?.context?.license,
  };
}

/** Runs a value source and caches a value list; a Jira 400 (invalid subquery) becomes the function's error. */
export async function computeGroup(deps, functionName, args, userArgs, { reconcile = [], source = 'function' } = {}) {
  let result;
  try {
    result = await deps.compute[functionName](args, { reconcile });
  } catch (error) {
    if (error?.name !== 'JiraError' || error.status !== 400) throw error;
    result = { error: ERR.withFunction(functionName, error.message) };
  }
  if (result.ids) {
    await deps.cache.write(groupKey(functionName, userArgs), { values: result.ids, watch: result.watch ?? null, field: result.field, rootFilter: result.rootFilter ?? null, at: deps.now(), source });
  }
  return result;
}

/** Stored JQL of one precomputation (root or page) from a group result. */
export function fragmentFor(functionName, userArgs, page, result, levels) {
  if (result.error) return { error: result.error };
  if (result.native !== undefined) return { jql: result.native };
  return buildFragment({ functionName, userArgs, page, values: valuesOf(result.ids), field: result.field, rootFilter: result.rootFilter ?? undefined, levels });
}

async function fromCache(deps, functionName, userArgs, page) {
  const key = groupKey(functionName, userArgs);
  const meta = await deps.cache.meta(key);
  if (!meta || deps.now() - meta.at >= PAGE_CACHE_MS) return null;
  if (!page && meta.source !== 'job') return null;
  let from = 0;
  let to = page ? 0 : Math.min(meta.n, VALUE_LIMIT);
  if (page?.kind === 'leaf') {
    from = (page.index - 1) * VALUE_LIMIT;
    to = page.index * VALUE_LIMIT;
  }
  const ids = to > from ? await deps.cache.values(key, meta, from, to) : [];
  const values = { n: meta.n, range: (f, t) => ids.slice(f - from, t - from) };
  return buildFragment({ functionName, userArgs, page, values, field: meta.field, rootFilter: meta.rootFilter ?? undefined, levels: deps.levels });
}

async function defer(deps, functionName, userArgs) {
  await deps.state.addJob({ key: groupKey(functionName, userArgs), functionName, userArgs, at: deps.now() });
  await deps.queue.push({ kind: 'compute', functionName, userArgs });
  return { error: ERR.computing() };
}

async function evaluateClause(deps, functionName, payload, context) {
  if (!decideLicence(licenceInput(payload, context)).licensed) return { error: ERR.unlicensed() };
  const parsed = parseArgs(functionName, payload?.clause?.arguments);
  if (parsed.error) return parsed;
  const { args, userArgs, page } = parsed;
  const gate = await deps.ready(functionName);
  if (gate) return { error: gate };
  const cached = await fromCache(deps, functionName, userArgs, page);
  if (cached) return cached;
  const work = computeGroup(deps, functionName, args, userArgs).catch((failed) => ({ failed }));
  const outcome = await Promise.race([work, deps.sleep(FUNCTION_BUDGET_MS).then(() => TIMEOUT)]);
  if (outcome === TIMEOUT) return defer(deps, functionName, userArgs);
  if (outcome.failed) {
    console.error(`${functionName} failed: ${outcome.failed?.name} ${outcome.failed?.status ?? ''}`);
    return defer(deps, functionName, userArgs);
  }
  return fragmentFor(functionName, userArgs, page, outcome, deps.levels);
}

/** One JQL function clause → stored JQL, or an error Jira shows in the editor (never stored, so the next search retries). */
export async function handleFunction(deps, functionName, payload, context) {
  const reply = await evaluateClause(deps, functionName, payload, context);
  if (!reply.error) return { jql: reply.jql };
  if (reply.error !== ERR.computing()) await deps.state.recordError({ at: deps.now(), functionName, message: reply.error });
  return { error: reply.error, storeErrorAsPrecomputation: false };
}

/** Forge handlers for every catalog function, by function name. */
export function createFunctionHandlers(deps) {
  return Object.fromEntries(FUNCTIONS.map((f) => [f.name, (payload, context) => handleFunction(deps, f.name, payload, context)]));
}
```

Поля лицензии — по выводу «в» Task 3: если документация называет другое поле, поправить `licenceInput` и добавить тест на это поле.

- [ ] **Step 5: `src/deps.js`**

```js
import { createHash } from 'node:crypto';
import { kvs, WhereConditions } from '@forge/kvs';
import { Queue } from '@forge/events';
import { FUNCTION_BY_NAME } from './core/catalog.js';
import { TREE_LEVELS } from './core/limits.js';
import { readinessError } from './core/readiness.js';
import { appJira } from './infra/jira.js';
import { createValueCache } from './infra/cache.js';
import { createJournal } from './infra/journal.js';
import { createState } from './infra/state.js';
import { createQueueClient } from './infra/queue.js';
import { createHierarchyCompute } from './compute/hierarchy.js';
import { createLinkCompute } from './compute/links.js';
import { createBoardCompute } from './compute/boards.js';

const sha1 = (text) => createHash('sha1').update(text).digest('hex');

/** Production dependencies of every handler. */
export function createDeps() {
  const jira = appJira();
  const state = createState({ kvs });
  return {
    jira,
    state,
    cache: createValueCache({ kvs, hash: sha1 }),
    journal: createJournal({ kvs, beginsWith: WhereConditions.beginsWith }),
    queue: createQueueClient(new Queue({ key: 'query-refresh' })),
    backfillQueue: createQueueClient(new Queue({ key: 'query-backfill' })),
    compute: { ...createHierarchyCompute({ jira }), ...createLinkCompute({ jira }), ...createBoardCompute({ jira }) },
    indexEvent: async () => null,
    indexReconcile: async () => null,
    now: () => Date.now(),
    sleep: (ms) => new Promise((resolve) => {
      setTimeout(resolve, ms);
    }),
    levels: Number(process.env.QUERY_TREE_LEVELS) || TREE_LEVELS,
    debugEvents: process.env.QUERY_DEBUG_EVENTS === '1',
    ready: async (functionName) => readinessError(await state.progress.get(), FUNCTION_BY_NAME.get(functionName).group),
  };
}
```

`indexEvent`/`indexReconcile` в M1 ничего не делают: индекса нет; Task 23 и Task 27 подставляют настоящие.

- [ ] **Step 6: `src/index.js`**

```js
import Resolver from '@forge/resolver';
import { createDeps } from './deps.js';
import { createFunctionHandlers } from './handlers/functions.js';
import { createResolverDefinitions } from './handlers/resolvers.js';

const deps = createDeps();
const resolver = new Resolver();
for (const [key, fn] of Object.entries(createResolverDefinitions(deps))) resolver.define(key, fn);

/** Forge resolver entry point. */
export const resolverHandler = resolver.getDefinitions();

export const {
  subtasksOf, parentsOf, epicsOf, issuesInEpics, childIssuesOf, linkedIssuesOf, linkedIssuesOfRecursive,
  linkedIssuesOfRecursiveLimited, hasLinks, hasLinkType, hasSubtasks, previousSprint, nextSprint,
  addedAfterSprintStart, removedAfterSprintStart, incompleteInSprint, completeInSprint, commented, lastComment,
  hasComments, fileAttached, hasAttachments, dateCompare, expression,
} = createFunctionHandlers(deps);
```

- [ ] **Step 7: Генератор блока манифеста** `scripts/gen-manifest-functions.mjs`:

```js
import { shippedFunctions } from '../src/core/catalog.js';

const lines = ['  jira:jqlFunction:'];
for (const f of shippedFunctions()) {
  lines.push(`    - key: ${f.key}`, `      name: ${f.name}`, '      arguments:');
  for (const a of [...f.args, { name: 'page', required: false }]) lines.push(`        - name: ${a.name}`, `          required: ${a.required}`);
  lines.push('      types:', '        - issue', '      operators:', '        - in', '        - not in', `      function: fn-${f.key}`);
}
lines.push('', '  function: (append to the existing list)');
for (const f of shippedFunctions()) lines.push(`    - key: fn-${f.key}`, `      handler: index.${f.name}`);
console.log(lines.join('\n'));
```

Run: `node scripts/gen-manifest-functions.mjs`; вставить блок `jira:jqlFunction` в `modules` манифеста, функции `fn-*` — в список `function` (рядом с `resolver`). Строка-подсказка «(append …)» в манифест не идёт.

- [ ] **Step 8: Run** `npx vitest run` → PASS; `npm run coverage` → PASS (порог ветвлений `src/core/**`, включая `readiness.js`); `npm run lint` → 0 ошибок; `forge lint` → без ошибок (предупреждение о числе модулей — сверить с пределом из Task 3).

- [ ] **Step 9: Commit**

```bash
git add apps/query
git commit -m "JQL-20: Evaluate JQL functions with cached tree pages, a compute budget and M1 manifest entries

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 14: Обновление по событиям — триггер, consumer `refresh`, часовая сверка

**Model:** opus

**Files:**
- Create: `apps/query/src/handlers/{trigger.js,refresh.js,reconcile.js}`, `apps/query/test/handlers/makeDeps.js` (общий помощник трёх файлов тестов)
- Modify: `apps/query/src/index.js`, `apps/query/manifest.yml`, `apps/query/test/manifestFunctions.test.js`
- Test: `apps/query/test/handlers/{trigger.test.js,refresh.test.js,reconcile.test.js}`, `apps/query/test/manifestFunctions.test.js`

**Interfaces:**
- Consumes: `eventRecord` (Task 7), `summarizeJournal`, `groupPrecomputations`, `familyWants`, `queryOverlap`, `reconcileTargets` (Task 7), `computeGroup`, `fragmentFor` (Task 13), `pool` (Task 9), journal/cache/state (Task 10), `REFRESH_CONCURRENCY` (Task 5), механика прототипа и исправления Task 2.
- Produces: `onEvent(deps, event) → { ids, kinds }`; `pushRefresh(deps, ts) → boolean`; `refreshOnce(deps) → Pass|null`, `Pass = { touched, kinds, events, all, groups, recomputed, changed, stale, oldestEventMs }`; `rewrite(deps, group, reconcile) → Update[]` (`Update = { id, value } | { id, error }`); `onRefresh(deps, event) → { passes } | { busy: true } | { computed } | { error }`; `onReconcile(deps) → { groups, changed, index }`. Тела задач очереди `query-refresh`: `{ kind: 'refresh', ts }`, `{ kind: 'refresh', ts, verify: string[], kinds: Kind[] }` (с задержкой 20 с), `{ kind: 'compute', functionName, userArgs }`. Триггер `query-events` подписан и на события спринтов (`avi:jira-software:*:sprint`) уже в M1: по Q-R9 `previousSprint`/`nextSprint` строятся в M1 и их семейство `board` устаревает от вида `sprint`; Task 24 только включает запись этих событий в индекс. `test/handlers/makeDeps.js`: `makeDeps({ pcs, compute, searches, write }) → Deps & { kvs, advance(ms), pushed: [body, delay|null][], written: Update[] }`, `ids(n, from)`, `RECENT`.

- [ ] **Step 1: Падающие тесты.** Общий помощник `test/handlers/makeDeps.js` — один файл, его импортируют `refresh.test.js`, `trigger.test.js` и `reconcile.test.js` (не копировать блок в каждый файл):

```js
import { createFakeKvs } from '../fakeKvs.js';
import { createJournal } from '../../src/infra/journal.js';
import { createValueCache } from '../../src/infra/cache.js';
import { createState } from '../../src/infra/state.js';

/** n id strings starting at `from`. */
export const ids = (n, from = 1) => Array.from({ length: n }, (_, i) => String(from + i));

/** A `used` time inside the active window of the test clock. */
export const RECENT = new Date(999000).toISOString();

/** Handler dependencies over a fake KVS and a scripted Jira; records pushed jobs and written precomputations. */
export function makeDeps({ pcs = [], compute = {}, searches = {}, write } = {}) {
  const kvs = createFakeKvs({ pageSize: 1000 });
  let now = 1000000;
  let tag = 0;
  const pushed = [];
  const written = [];
  return {
    kvs,
    journal: createJournal({ kvs, beginsWith: (p) => ({ values: [p] }), random: () => String((tag += 1)).padStart(4, '0') }),
    cache: createValueCache({ kvs, hash: (s) => s }),
    state: createState({ kvs }),
    queue: { push: async (body, delay) => { pushed.push([body, delay ?? null]); } },
    jira: {
      precomputations: async () => pcs,
      searchIds: async (jql) => searches[jql] ?? [],
      writePrecomputations: write ?? (async (updates) => { written.push(...updates); }),
    },
    compute,
    ready: async () => null,
    indexEvent: async () => null,
    indexReconcile: async () => null,
    now: () => now,
    advance: (ms) => { now += ms; },
    levels: 1,
    pushed,
    written,
  };
}
```

Тесты `refresh.test.js`:

```js
import { describe, expect, it, vi } from 'vitest';
import { ids, makeDeps, RECENT } from './makeDeps.js';
import { onRefresh, refreshOnce } from '../../src/handlers/refresh.js';

describe('refreshOnce', () => {
  it('does nothing on an empty journal', async () => {
    expect(await refreshOnce(makeDeps())).toBeNull();
  });
  it('rewrites the root and its pages from one value set', async () => {
    const pcs = [
      { id: 'root', functionName: 'linkedIssuesOf', arguments: ['q'], value: 'id in (1)', used: RECENT },
      { id: 'leaf2', functionName: 'linkedIssuesOf', arguments: ['q', '__aq:l2'], value: 'id = -1', used: RECENT },
    ];
    const deps = makeDeps({ pcs, compute: { linkedIssuesOf: async () => ({ ids: ids(1500), field: 'id', watch: ['5'] }) } });
    await deps.cache.write('linkedIssuesOf["q"]', { values: ['1'], watch: ['5'], field: 'id', rootFilter: null, at: 1, source: 'refresh' });
    await deps.journal.append({ ids: ['5'], kinds: ['link'] }, 999500);
    const pass = await refreshOnce(deps);
    expect(deps.written).toEqual([
      { id: 'root', value: '(issue in linkedIssuesOf("q", "__aq:l1") OR issue in linkedIssuesOf("q", "__aq:l2"))' },
      { id: 'leaf2', value: `id in (${ids(500, 1001).join(',')})` },
    ]);
    expect(pass).toMatchObject({ touched: ['5'], kinds: ['link'], events: 1, recomputed: 1, changed: 2, stale: false, oldestEventMs: 500 });
    expect(await deps.journal.read(10)).toEqual([]);
  });
  it('skips a group the touched issues cannot affect', async () => {
    const pcs = [{ id: 'root', functionName: 'parentsOf', arguments: ['q'], value: 'id in (1)', used: RECENT }];
    const compute = { parentsOf: vi.fn() };
    const deps = makeDeps({ pcs, compute });
    await deps.cache.write('parentsOf["q"]', { values: ['1'], watch: ['7'], field: 'id', rootFilter: null, at: 1, source: 'refresh' });
    await deps.journal.append({ ids: ['5'], kinds: ['issue-updated'] }, 999500);
    expect((await refreshOnce(deps)).recomputed).toBe(0);
    expect(compute.parentsOf).not.toHaveBeenCalled();
  });
  it('recomputes a group whose subquery now matches a touched issue', async () => {
    const pcs = [{ id: 'root', functionName: 'parentsOf', arguments: ['q'], value: 'id in (1)', used: RECENT }];
    const deps = makeDeps({ pcs, searches: { '(q) AND id in (5)': ['5'] }, compute: { parentsOf: async () => ({ ids: ['2'], field: 'id', watch: ['5'] }) } });
    await deps.cache.write('parentsOf["q"]', { values: ['1'], watch: [], field: 'id', rootFilter: null, at: 1, source: 'refresh' });
    await deps.journal.append({ ids: ['5'], kinds: ['issue-updated'] }, 999500);
    await refreshOnce(deps);
    expect(deps.written).toEqual([{ id: 'root', value: 'id in (2)' }]);
  });
  it('recomputes hasSubtasks on a new issue but not on a new link', async () => {
    const pcs = [{ id: 'h', functionName: 'hasSubtasks', arguments: [], value: 'id in (1)', used: RECENT }];
    const compute = { hasSubtasks: vi.fn(async () => ({ ids: ['1', '2'], field: 'id', watch: null })) };
    const deps = makeDeps({ pcs, compute });
    await deps.journal.append({ ids: ['9'], kinds: ['link'] }, 999500);
    await refreshOnce(deps);
    expect(compute.hasSubtasks).not.toHaveBeenCalled();
    await deps.journal.append({ ids: ['9'], kinds: ['issue-created'] }, 999600);
    await refreshOnce(deps);
    expect(deps.written).toEqual([{ id: 'h', value: 'id in (1,2)' }]);
  });
  it('recomputes previousSprint when a sprint starts or closes', async () => {
    const pcs = [{ id: 'p', functionName: 'previousSprint', arguments: ['DEMO board'], value: 'sprint = 1', used: RECENT }];
    const deps = makeDeps({ pcs, compute: { previousSprint: async () => ({ native: 'sprint = 2' }) } });
    await deps.journal.append({ ids: [], kinds: ['sprint'] }, 999500);
    await refreshOnce(deps);
    expect(deps.written).toEqual([{ id: 'p', value: 'sprint = 2' }]);
  });
  it('keeps the journal rows when the write fails', async () => {
    const pcs = [{ id: 'h', functionName: 'hasSubtasks', arguments: [], value: 'id in (1)', used: RECENT }];
    const deps = makeDeps({ pcs, compute: { hasSubtasks: async () => ({ ids: ['2'], field: 'id', watch: null }) }, write: async () => { throw new Error('503'); } });
    await deps.journal.append({ ids: ['9'], kinds: ['issue-created'] }, 999500);
    await expect(refreshOnce(deps)).rejects.toThrow('503');
    expect(await deps.journal.read(10)).toHaveLength(1);
  });
  it('does not overwrite a pass that started later', async () => {
    const pcs = [{ id: 'h', functionName: 'hasSubtasks', arguments: [], value: 'id in (1)', used: RECENT }];
    const deps = makeDeps({ pcs, compute: { hasSubtasks: async () => ({ ids: ['2'], field: 'id', watch: null }) } });
    await deps.state.lastWrittenStart.set(2000000);
    await deps.journal.append({ ids: ['9'], kinds: ['issue-created'] }, 999500);
    expect((await refreshOnce(deps)).stale).toBe(true);
    expect(deps.written).toEqual([]);
  });
  it('keeps the cache of a deferred computation fresh before Jira stores its root', async () => {
    const compute = { linkedIssuesOf: vi.fn(async () => ({ ids: ['8'], field: 'id', watch: ['5'] })) };
    const deps = makeDeps({ compute });
    await deps.state.addJob({ key: 'linkedIssuesOf["q"]', functionName: 'linkedIssuesOf', userArgs: ['q'], at: 999000 });
    await deps.cache.write('linkedIssuesOf["q"]', { values: ['1'], watch: ['5'], field: 'id', rootFilter: null, at: 999000, source: 'job' });
    await deps.journal.append({ ids: ['5'], kinds: ['link'] }, 999500);
    await refreshOnce(deps);
    expect(await deps.cache.values('linkedIssuesOf["q"]', await deps.cache.meta('linkedIssuesOf["q"]'), 0, 10)).toEqual(['8']);
    expect((await deps.cache.meta('linkedIssuesOf["q"]')).source).toBe('job');
  });
});

describe('onRefresh', () => {
  it('leaves at once while another worker holds the lease', async () => {
    const deps = makeDeps();
    await deps.state.lease.set(999990);
    expect(await onRefresh(deps, { body: { kind: 'refresh', ts: 1 } })).toEqual({ busy: true });
  });
  it('runs passes until the journal is empty, then pushes one delayed verify', async () => {
    const pcs = [{ id: 'h', functionName: 'hasSubtasks', arguments: [], value: 'id in (1)', used: RECENT }];
    const deps = makeDeps({ pcs, compute: { hasSubtasks: async () => ({ ids: ['2'], field: 'id', watch: null }) } });
    await deps.state.pending.set(999000);
    await deps.journal.append({ ids: ['9'], kinds: ['issue-created'] }, 999500);
    const result = await onRefresh(deps, { body: { kind: 'refresh', ts: 999000 } });
    expect(result.passes).toHaveLength(1);
    expect([await deps.state.pending.get(), await deps.state.lease.get()]).toEqual([null, null]);
    expect(deps.pushed).toEqual([[{ kind: 'refresh', ts: 1000000, verify: ['9'], kinds: ['issue-created'] }, 20]]);
  });
  it('turns a verify job into a journal record and pushes no further verify', async () => {
    const deps = makeDeps();
    await onRefresh(deps, { body: { kind: 'refresh', ts: 1, verify: ['9'], kinds: ['link'] } });
    expect(deps.pushed).toEqual([]);
  });
  it('runs a compute job into the cache', async () => {
    const deps = makeDeps({ compute: { parentsOf: async () => ({ ids: ['4'], field: 'id', watch: [] }) } });
    expect(await onRefresh(deps, { body: { kind: 'compute', functionName: 'parentsOf', userArgs: ['q'] } })).toEqual({ computed: 'parentsOf["q"]' });
    expect((await deps.cache.meta('parentsOf["q"]')).source).toBe('job');
  });
});
```

`test/handlers/trigger.test.js`:

```js
import { describe, expect, it } from 'vitest';
import { makeDeps } from './makeDeps.js';
import { onEvent } from '../../src/handlers/trigger.js';

describe('onEvent', () => {
  it('journals the event and pushes one refresh when none is pending', async () => {
    const deps = makeDeps();
    await onEvent(deps, { eventType: 'avi:jira:created:issuelink', issueLink: { sourceIssueId: 1, destinationIssueId: 2 } });
    await onEvent(deps, { eventType: 'avi:jira:deleted:issuelink', issueLink: { sourceIssueId: 1, destinationIssueId: 3 } });
    expect((await deps.journal.read(10)).map((r) => r.value)).toEqual([{ ids: ['1', '2'], kinds: ['link'] }, { ids: ['1', '3'], kinds: ['link'] }]);
    expect(deps.pushed).toEqual([[{ kind: 'refresh', ts: 1000000 }, null]]);
  });
  it('clears the pending mark when the push fails so the next event retries', async () => {
    const deps = makeDeps();
    deps.queue.push = async () => { throw new Error('rate'); };
    await onEvent(deps, { eventType: 'avi:jira:created:issue', issue: { id: '5' } });
    expect(await deps.state.pending.get()).toBeNull();
    expect(await deps.journal.read(10)).toHaveLength(1);
  });
  it('writes index rows before the journal record', async () => {
    const order = [];
    const deps = makeDeps();
    deps.indexEvent = async () => { order.push('index'); };
    const append = deps.journal.append;
    deps.journal.append = async (...a) => { order.push('journal'); return append(...a); };
    await onEvent(deps, { eventType: 'avi:jira:created:issue', issue: { id: '5' } });
    expect(order).toEqual(['index', 'journal']);
  });
});
```

`test/handlers/reconcile.test.js`:

```js
import { describe, expect, it } from 'vitest';
import { makeDeps, RECENT } from './makeDeps.js';
import { onReconcile } from '../../src/handlers/reconcile.js';

describe('onReconcile', () => {
  it('rewrites used groups that were not rewritten for an hour', async () => {
    const old = new Date(1000000 - 2 * 3600000).toISOString();
    const pcs = [{ id: 'h', functionName: 'hasSubtasks', arguments: [], value: 'id in (1)', used: RECENT, updated: old }];
    const deps = makeDeps({ pcs, compute: { hasSubtasks: async () => ({ ids: ['2'], field: 'id', watch: null }) } });
    expect(await onReconcile(deps)).toEqual({ groups: 1, changed: 1, index: null });
    expect(deps.written).toEqual([{ id: 'h', value: 'id in (2)' }]);
  });
  it('does not overwrite a refresh that started after it', async () => {
    const old = new Date(1000000 - 2 * 3600000).toISOString();
    const pcs = [{ id: 'h', functionName: 'hasSubtasks', arguments: [], value: 'id in (1)', used: RECENT, updated: old }];
    const deps = makeDeps({ pcs, compute: { hasSubtasks: async () => ({ ids: ['2'], field: 'id', watch: null }) } });
    await deps.state.lastWrittenStart.set(2000000);
    expect((await onReconcile(deps)).changed).toBe(0);
  });
});
```

В `test/manifestFunctions.test.js` (Task 13) дописать в `describe('manifest JQL functions')`:

```js
  it('subscribes the event trigger to sprint events for the board functions', () => {
    const events = manifest.modules.trigger.find((t) => t.key === 'query-events').events;
    expect(events.filter((e) => e.startsWith('avi:jira-software:') && e.endsWith(':sprint')).length).toBeGreaterThanOrEqual(2);
  });
```

- [ ] **Step 2: Run** `npx vitest run test/handlers test/manifestFunctions.test.js` → FAIL.

- [ ] **Step 3: `src/handlers/refresh.js`**

```js
import { groupKey, parseArgs, splitPage } from '../core/args.js';
import { FUNCTION_BY_NAME } from '../core/catalog.js';
import { familyWants, groupPrecomputations, queryOverlap, summarizeJournal } from '../core/affected.js';
import { ACTIVE_MS, JOURNAL_PAGE, LEASE_MS, MAX_TOUCHED, REFRESH_CONCURRENCY, VERIFY_DELAY_S, WORKER_BUDGET_MS } from '../core/limits.js';
import { pool } from '../infra/pool.js';
import { computeGroup, fragmentFor } from './functions.js';

/** Marks a refresh as pending and pushes it; a failed push clears the mark so the next event retries. */
export async function pushRefresh(deps, ts) {
  await deps.state.pending.set(ts);
  try {
    await deps.queue.push({ kind: 'refresh', ts });
    return true;
  } catch (error) {
    await deps.state.pending.clear();
    console.error(`refresh push failed: ${error?.message}`);
    return false;
  }
}

function jobGroups(jobs, groups) {
  const known = new Set(groups.map((g) => g.key));
  return jobs.filter((j) => !known.has(j.key)).map((j) => ({ key: j.key, functionName: j.functionName, family: FUNCTION_BY_NAME.get(j.functionName)?.family ?? 'query', userArgs: j.userArgs, items: [] }));
}

async function isStale(deps, group, summary) {
  if (summary.all) return true;
  if (group.family !== 'query') return familyWants(group.family, summary.kinds);
  if (!summary.touched.length) return false;
  const parsed = parseArgs(group.functionName, group.userArgs);
  if (parsed.error) return false;
  const watch = await deps.cache.watch(group.key);
  let liveHits = null;
  try {
    liveHits = await deps.jira.searchIds(`(${parsed.args.subquery}) AND id in (${summary.touched.join(',')})`, { reconcile: summary.touched.slice(0, MAX_TOUCHED) });
  } catch (error) {
    if (error?.name !== 'JiraError') throw error;
  }
  return queryOverlap({ touched: summary.touched, watch, liveHits });
}

/** Recomputes one group; returns the precomputation updates whose stored value or error changed. */
export async function rewrite(deps, group, reconcile) {
  const parsed = parseArgs(group.functionName, group.userArgs);
  const gate = parsed.error ? null : await deps.ready(group.functionName);
  let result = { error: parsed.error ?? gate };
  if (!parsed.error && !gate) {
    result = await computeGroup(deps, group.functionName, parsed.args, group.userArgs, { reconcile, source: group.items.length ? 'refresh' : 'job' });
  }
  const updates = [];
  for (const pc of group.items) {
    const r = fragmentFor(group.functionName, group.userArgs, splitPage(pc.arguments).page, result, deps.levels);
    if ((r.jql ?? null) !== (pc.value ?? null) || (r.error ?? null) !== (pc.error ?? null)) updates.push(r.error ? { id: pc.id, error: r.error } : { id: pc.id, value: r.jql });
  }
  return updates;
}

/** One pass over a journal page: recompute stale groups, write changes, then drop the rows (kept if the write fails). */
export async function refreshOnce(deps) {
  const startedAt = deps.now();
  const rows = await deps.journal.read(JOURNAL_PAGE);
  if (!rows.length) return null;
  const summary = summarizeJournal(rows);
  const groups = groupPrecomputations(await deps.jira.precomputations(), { now: startedAt, activeMs: ACTIVE_MS });
  const all = [...groups, ...jobGroups(await deps.state.jobs(startedAt), groups)];
  const reconcile = summary.touched.slice(0, MAX_TOUCHED);
  const updates = [];
  let recomputed = 0;
  await pool(all, REFRESH_CONCURRENCY, async (group) => {
    if (!(await isStale(deps, group, summary))) return;
    recomputed += 1;
    updates.push(...(await rewrite(deps, group, reconcile)));
  });
  let stale = false;
  if (updates.length) {
    if (((await deps.state.lastWrittenStart.get()) ?? 0) > startedAt) stale = true;
    else {
      await deps.state.lastWrittenStart.set(startedAt);
      await deps.jira.writePrecomputations(updates);
    }
  }
  await deps.journal.remove(rows.map((r) => r.key));
  return { touched: reconcile, kinds: summary.kinds, events: rows.length, all: summary.all, groups: all.length, recomputed, changed: updates.length, stale, oldestEventMs: summary.firstAt === null ? null : startedAt - summary.firstAt };
}

async function computeJob(deps, { functionName, userArgs }) {
  const parsed = parseArgs(functionName, userArgs);
  if (parsed.error) return { error: parsed.error };
  await computeGroup(deps, functionName, parsed.args, parsed.userArgs, { source: 'job' });
  return { computed: groupKey(functionName, parsed.userArgs) };
}

/** Queue consumer: a compute job, or refresh passes under a lease until the journal is empty or the budget is spent. */
export async function onRefresh(deps, event) {
  const body = event?.body ?? {};
  if (body.kind === 'compute') return computeJob(deps, body);
  if (body.verify?.length) await deps.journal.append({ ids: body.verify, kinds: body.kinds ?? ['issue-updated'] }, deps.now());
  else await deps.state.pending.clear();
  if (deps.now() - ((await deps.state.lease.get()) ?? 0) < LEASE_MS) return { busy: true };
  const deadline = deps.now() + WORKER_BUDGET_MS;
  await deps.state.lease.set(deps.now());
  const passes = [];
  try {
    while (deps.now() < deadline) {
      const pass = await refreshOnce(deps);
      if (!pass) break;
      passes.push(pass);
      await deps.state.lease.set(deps.now());
    }
  } finally {
    await deps.state.lease.clear();
  }
  if ((await deps.journal.read(1)).length && !(await deps.state.pending.get())) await pushRefresh(deps, deps.now());
  const verify = [...new Set(passes.flatMap((p) => p.touched))].slice(0, MAX_TOUCHED);
  if (!body.verify && verify.length) {
    await deps.queue.push({ kind: 'refresh', ts: deps.now(), verify, kinds: [...new Set(passes.flatMap((p) => p.kinds))].sort() }, VERIFY_DELAY_S);
  }
  if (passes.length) {
    await deps.state.lastRefresh.set({ at: deps.now(), passes: passes.length, changed: passes.reduce((s, p) => s + p.changed, 0), oldestEventMs: Math.max(...passes.map((p) => p.oldestEventMs ?? 0)) });
  }
  return { passes };
}
```

`verify` повторяет проход через 20 с для тех же задач — находка прототипа: проход сразу после события иногда читает данные без этого изменения.

- [ ] **Step 4: `src/handlers/trigger.js`**

```js
import { eventRecord } from '../core/events.js';
import { LEASE_MS, PENDING_STALE_MS } from '../core/limits.js';
import { pushRefresh } from './refresh.js';

/** Product event → index rows, one journal record, and a refresh job unless one is pending or running. */
export async function onEvent(deps, event) {
  const record = eventRecord(event);
  if (deps.debugEvents) {
    console.log(JSON.stringify({ event: event?.eventType, keys: Object.keys(event ?? {}), items: (event?.changelog?.items ?? []).map((i) => [i.field, i.fieldId]), record }));
  }
  await deps.indexEvent(event);
  const ts = deps.now();
  await deps.journal.append(record, ts);
  const [pending, running] = await Promise.all([deps.state.pending.get(), deps.state.lease.get()]);
  if (ts - (pending ?? 0) > PENDING_STALE_MS && ts - (running ?? 0) > LEASE_MS) await pushRefresh(deps, ts);
  return record;
}
```

Отладочная строка (только при переменной `QUERY_DEBUG_EVENTS=1` в development) печатает имена полей и id, без текста задач.

- [ ] **Step 5: `src/handlers/reconcile.js`**

```js
import { groupPrecomputations, reconcileTargets } from '../core/affected.js';
import { ACTIVE_MS, RECONCILE_MAX_GROUPS, RECONCILE_STALE_MS, RECONCILE_USED_MS, REFRESH_CONCURRENCY } from '../core/limits.js';
import { pool } from '../infra/pool.js';
import { rewrite } from './refresh.js';

/** Hourly safety net: recompute used groups that missed an event or depend on the clock, then fill index gaps. */
export async function onReconcile(deps) {
  const startedAt = deps.now();
  const groups = reconcileTargets(groupPrecomputations(await deps.jira.precomputations(), { now: startedAt, activeMs: ACTIVE_MS }), {
    now: startedAt, usedMs: RECONCILE_USED_MS, staleMs: RECONCILE_STALE_MS, max: RECONCILE_MAX_GROUPS,
  });
  const updates = [];
  await pool(groups, REFRESH_CONCURRENCY, async (group) => {
    updates.push(...(await rewrite(deps, group, [])));
  });
  let changed = 0;
  if (updates.length && ((await deps.state.lastWrittenStart.get()) ?? 0) <= startedAt) {
    await deps.state.lastWrittenStart.set(startedAt);
    await deps.jira.writePrecomputations(updates);
    changed = updates.length;
  }
  return { groups: groups.length, changed, index: await deps.indexReconcile() };
}
```

- [ ] **Step 6: Экспорт и манифест.** В `src/index.js` добавить:

```js
import { onEvent as handleEvent } from './handlers/trigger.js';
import { onRefresh as handleRefresh } from './handlers/refresh.js';
import { onReconcile as handleReconcile } from './handlers/reconcile.js';

export const onEvent = (event) => handleEvent(deps, event);
export const onRefresh = (event) => handleRefresh(deps, event);
export const onReconcile = () => handleReconcile(deps);
```

В `manifest.yml` → `modules`:

```yaml
  trigger:
    - key: query-events
      function: on-event
      events:
        - avi:jira:created:issue
        - avi:jira:updated:issue
        - avi:jira:deleted:issue
        - avi:jira:created:issuelink
        - avi:jira:deleted:issuelink
        - avi:jira-software:created:sprint
        - avi:jira-software:started:sprint
        - avi:jira-software:closed:sprint
        - avi:jira-software:updated:sprint
        - avi:jira-software:deleted:sprint
      filter:
        ignoreSelf: true
  consumer:
    - key: query-refresh-consumer
      queue: query-refresh
      function: on-refresh
  scheduledTrigger:
    - key: query-reconcile
      function: on-reconcile
      interval: hour
```

Имена событий спринтов — по выводу «г» Task 3 (`docs/live-checks.md`); если какого-то из пяти нет, строка убирается, тест выше требует хотя бы начало и закрытие спринта. В M1 `indexEvent` — пустая функция, событие спринта только пишет запись журнала вида `sprint`, и `refresh` переписывает `previousSprint`/`nextSprint` (тест «recomputes previousSprint…»).

и в список `function`:

```yaml
    - key: on-event
      handler: index.onEvent
    - key: on-refresh
      handler: index.onRefresh
      timeoutSeconds: 300
    - key: on-reconcile
      handler: index.onReconcile
      timeoutSeconds: 900
```

- [ ] **Step 7: Run** `npx vitest run` → PASS; `npm run lint` → 0 ошибок; `forge lint` → без ошибок.

- [ ] **Step 8: Commit**

```bash
git add apps/query
git commit -m "JQL-21: Refresh precomputations from journaled events with verify passes and an hourly reconcile

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 15: Страница приложения — справочник функций и состояние обновления

**Model:** opus

**Files:**
- Create: `apps/query/static/app/src/app/useStatus.js`, `apps/query/static/app/src/components/Card.jsx`, `apps/query/static/app/src/reference/{FunctionReference.jsx,FunctionCard.jsx,MigrationNote.jsx,copy.js}`, `apps/query/static/app/src/status/{StatusPanel.jsx,IndexProgress.jsx}`
- Modify: `apps/query/src/handlers/resolvers.js`, `apps/query/static/app/src/app/GlobalApp.jsx`, `apps/query/static/app/src/i18n/locales/*.json` (26), `apps/query/static/app/package.json` (`@atlaskit/code`, `@atlaskit/textfield`, `@atlaskit/progress-bar`, `@atlaskit/dynamic-table` — версии как в Reports, `@atlaskit/code` — текущая, закреплённая точно), `apps/query/static/app/test/guards.test.js` (вернуть тест «no `<pre>`»)
- Test: `apps/query/test/resolvers.test.js`, `apps/query/static/app/test/{reference.test.jsx,status.test.jsx,shared.test.jsx}`

**Interfaces:**
- Consumes: `shippedFunctions`, `usage` (Task 5), `Deps.state`, `Deps.now` (Task 13), `LEASE_MS`.
- Produces: резолвер `getStatus → { functions: [{ name, group, usage, examples }], queue: { pending: boolean, running: boolean }, lastRefresh: { at, passes, changed, oldestEventMs }|null, errors: [{ at, functionName, message }], progress: Progress|null, excluded: string[] }` (без лицензии — ошибка `unlicensed`); UI: `useStatus(everyMs) → { status: 'loading'|'ready'|'error', data?, error?, reload }`, `copyText(text) → Promise<void>`, компоненты `FunctionReference({ functions })`, `FunctionCard({ fn })`, `StatusPanel({ status })`; общие для страницы приложения и админ-страницы (Task 29 их импортирует, не копирует): `Card({ children, testId })` — карточка `elevation.surface.raised` + `radius.large` + `space.300`, `IndexProgress({ progress })` — строки частей индекса (полоса + «N of M issues» / «Ready»). Ключи i18n: `tabs.*`, `reference.*`, `group.<7 групп>`, `fn.<24 функции>` (описания всех 24 сразу — последующие этапы только расширяют `SHIPPED_GROUPS`), `status.*`.

- [ ] **Step 1: Падающий тест резолвера** — дописать в `test/resolvers.test.js`:

```js
import { createFakeKvs } from './fakeKvs.js';
import { createState } from '../src/infra/state.js';
import { shippedFunctions } from '../src/core/catalog.js';

describe('getStatus', () => {
  it('lists the shipped functions with usage and reports the refresh state', async () => {
    const state = createState({ kvs: createFakeKvs() });
    await state.lease.set(990000);
    await state.recordError({ at: 5, functionName: 'subtasksOf', message: 'Usage: subtasksOf(subquery)' });
    const defs = createResolverDefinitions({ state, now: () => 1000000 });
    const status = await run(defs, 'getStatus', { environmentType: 'DEVELOPMENT' });
    expect(status.functions[0]).toEqual({ name: 'subtasksOf', group: 'query', usage: 'subtasksOf(subquery)', examples: ['issue in subtasksOf("project = DEMO AND status = \\"In Progress\\"")'] });
    expect(status.functions.map((f) => f.name)).toEqual(shippedFunctions().map((f) => f.name));
    expect([status.queue, status.errors.length, status.progress, status.excluded]).toEqual([{ pending: false, running: true }, 1, null, []]);
  });
  it('refuses without a licence', async () => {
    const defs = createResolverDefinitions({ state: createState({ kvs: createFakeKvs() }), now: () => 0 });
    await expect(run(defs, 'getStatus', { environmentType: 'PRODUCTION', license: { active: false } })).rejects.toThrow('unlicensed');
  });
});
```

Run: `npx vitest run test/resolvers.test.js` → FAIL.

- [ ] **Step 2: Резолвер.** `src/handlers/resolvers.js`:

```js
import { decideLicence } from '../access.js';
import { shippedFunctions, usage } from '../core/catalog.js';
import { LEASE_MS } from '../core/limits.js';

const licensed = (context) => decideLicence({ environmentType: context?.environmentType, license: context?.license }).licensed;

/** Resolver functions by key. */
export function createResolverDefinitions(deps) {
  return {
    getAccess: ({ context }) => ({
      ...decideLicence({ environmentType: context?.environmentType, license: context?.license }),
      environmentType: context?.environmentType ?? '',
    }),
    getStatus: async ({ context }) => {
      if (!licensed(context)) throw new Error('unlicensed');
      const [pending, lease, lastRefresh, errors, progress, excluded] = await Promise.all([
        deps.state.pending.get(), deps.state.lease.get(), deps.state.lastRefresh.get(), deps.state.errors(), deps.state.progress.get(), deps.state.excluded(),
      ]);
      return {
        functions: shippedFunctions().map((f) => ({ name: f.name, group: f.group, usage: usage(f), examples: f.examples })),
        queue: { pending: pending !== null, running: lease !== null && deps.now() - lease < LEASE_MS },
        lastRefresh,
        errors,
        progress,
        excluded,
      };
    },
  };
}
```

Run: `npx vitest run` → PASS.

- [ ] **Step 3: Падающие тесты UI.** `static/app/test/reference.test.jsx`:

```jsx
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { I18nProvider } from '../src/i18n/index.js';
import { FunctionReference } from '../src/reference/FunctionReference.jsx';

const FUNCTIONS = [
  { name: 'subtasksOf', group: 'query', usage: 'subtasksOf(subquery)', examples: ['issue in subtasksOf("project = DEMO")'] },
  { name: 'hasLinks', group: 'site', usage: 'hasLinks([linkType])', examples: ['issue in hasLinks("blocks")'] },
];
const view = () => render(<I18nProvider locale="en-US"><FunctionReference functions={FUNCTIONS} /></I18nProvider>);

describe('FunctionReference', () => {
  it('shows every function under its group heading', () => {
    view();
    expect(screen.getByTestId('fn-subtasksOf')).toBeTruthy();
    expect(screen.getByTestId('fn-hasLinks')).toBeTruthy();
    expect(screen.getByText('Work items of a query')).toBeTruthy();
  });
  it('filters by name or description', () => {
    view();
    fireEvent.change(screen.getByTestId('reference-search'), { target: { value: 'links' } });
    expect(screen.queryByTestId('fn-subtasksOf')).toBeNull();
    expect(screen.getByTestId('fn-hasLinks')).toBeTruthy();
  });
  it('offers to clear a search that matches nothing', () => {
    view();
    fireEvent.change(screen.getByTestId('reference-search'), { target: { value: 'zzz' } });
    fireEvent.click(screen.getByText('Clear search'));
    expect(screen.getByTestId('fn-subtasksOf')).toBeTruthy();
  });
  it('copies an example and says so', async () => {
    const writeText = vi.fn(async () => {});
    Object.assign(navigator, { clipboard: { writeText } });
    view();
    fireEvent.click(screen.getAllByTestId('copy')[0]);
    expect(await screen.findByText('Copied')).toBeTruthy();
    expect(writeText).toHaveBeenCalledWith('issue in subtasksOf("project = DEMO")');
  });
  it('explains the ScriptRunner difference', () => {
    view();
    expect(screen.getByText('Coming from ScriptRunner?')).toBeTruthy();
  });
});
```

`static/app/test/status.test.jsx`:

```jsx
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { I18nProvider } from '../src/i18n/index.js';
import { StatusPanel } from '../src/status/StatusPanel.jsx';

const view = (status) => render(<I18nProvider locale="en-US"><StatusPanel status={status} /></I18nProvider>);
const BASE = { queue: { pending: false, running: false }, lastRefresh: null, errors: [], progress: null, excluded: [] };

describe('StatusPanel', () => {
  it('shows an idle queue, no update yet and no errors', () => {
    view(BASE);
    expect(screen.getByText('Idle')).toBeTruthy();
    expect(screen.getByText('No update yet')).toBeTruthy();
    expect(screen.getByText('No errors in the JQL editor so far.')).toBeTruthy();
  });
  it('shows index progress per part', () => {
    view({ ...BASE, progress: { sprint: { done: 12400, total: 50000 }, comments: { done: 5, total: 5, finishedAt: 1 } } });
    expect(screen.getByText('12,400 of 50,000 issues')).toBeTruthy();
    expect(screen.getByText('Ready')).toBeTruthy();
  });
  it('lists recent errors with the function name', () => {
    view({ ...BASE, errors: [{ at: Date.parse('2026-10-03T10:00:00Z'), functionName: 'parentsOf', message: 'Usage: parentsOf(subquery)' }] });
    expect(screen.getByText('parentsOf')).toBeTruthy();
    expect(screen.getByText('Usage: parentsOf(subquery)')).toBeTruthy();
  });
});
```

`static/app/test/shared.test.jsx`:

```jsx
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { I18nProvider } from '../src/i18n/index.js';
import { Card } from '../src/components/Card.jsx';
import { IndexProgress } from '../src/status/IndexProgress.jsx';

const view = (progress) => render(<I18nProvider locale="en-US"><IndexProgress progress={progress} /></I18nProvider>);

describe('Card', () => {
  it('renders its children under the test id', () => {
    render(<Card testId="card"><span>inside</span></Card>);
    expect(screen.getByTestId('card').textContent).toBe('inside');
  });
});

describe('IndexProgress', () => {
  it('counts the issues of a part that is filling', () => {
    view({ sprint: { done: 5, total: 10 } });
    expect(screen.getByText('5 of 10 issues')).toBeTruthy();
  });
  it('says Ready for a finished part', () => {
    view({ comments: { done: 3, total: 3, finishedAt: 1 } });
    expect(screen.getByText('Ready')).toBeTruthy();
  });
  it('renders nothing without progress', () => {
    const { container } = view(null);
    expect(container.textContent).toBe('');
  });
});
```

Run: `npm --prefix static/app test` → FAIL.

- [ ] **Step 4: Компоненты.** `src/components/Card.jsx`:

```jsx
import { Box, xcss } from '@atlaskit/primitives';

const cardStyles = xcss({ backgroundColor: 'elevation.surface.raised', boxShadow: 'elevation.shadow.raised', borderRadius: 'radius.large', padding: 'space.300' });

/** Raised card of the app pages: surface, shadow, large radius and space.300 padding. */
export function Card({ children, testId }) {
  return <Box xcss={cardStyles} testId={testId}>{children}</Box>;
}
```

`src/status/IndexProgress.jsx`:

```jsx
import ProgressBar from '@atlaskit/progress-bar';
import { Stack, Text } from '@atlaskit/primitives';
import { formatNumber, useI18n } from '../i18n/index.js';

/** Progress of each index part: a bar and "N of M issues", or "Ready" once the part finished. */
export function IndexProgress({ progress }) {
  const { t, locale } = useI18n();
  const parts = Object.entries(progress ?? {});
  if (!parts.length) return null;
  return (
    <Stack space="space.200">
      {parts.map(([part, p]) => (
        <Stack key={part} space="space.075">
          <Text weight="medium">{t(`status.part.${part}`)}</Text>
          <ProgressBar value={p.total ? p.done / p.total : 0} ariaLabel={t(`status.part.${part}`)} />
          <Text color="color.text.subtle">{p.finishedAt ? t('status.indexReady') : t('status.indexProgress', { done: formatNumber(locale, p.done), total: formatNumber(locale, p.total) })}</Text>
        </Stack>
      ))}
    </Stack>
  );
}
```

`src/reference/copy.js`:

```js
/** Copies text: the async Clipboard API, or a hidden textarea with execCommand where the iframe blocks it. */
export async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return;
  } catch {
    const area = document.createElement('textarea');
    area.value = text;
    area.setAttribute('readonly', '');
    area.style.position = 'fixed';
    area.style.opacity = '0';
    document.body.appendChild(area);
    area.select();
    document.execCommand('copy');
    document.body.removeChild(area);
  }
}
```

`src/reference/FunctionCard.jsx`:

```jsx
import { useState } from 'react';
import { IconButton } from '@atlaskit/button/new';
import { Code } from '@atlaskit/code';
import Heading from '@atlaskit/heading';
import Lozenge from '@atlaskit/lozenge';
import { Box, Inline, Stack, Text, xcss } from '@atlaskit/primitives';
import { Card } from '../components/Card.jsx';
import { CopyIcon } from '../components/icons.js';
import { useT } from '../i18n/index.js';
import { copyText } from './copy.js';

const exampleStyles = xcss({ minWidth: '0', overflowWrap: 'anywhere' });

/** One function: signature, description and examples, each with a copy button. */
export function FunctionCard({ fn }) {
  const t = useT();
  const [copied, setCopied] = useState(null);
  const copy = async (example) => {
    await copyText(example);
    setCopied(example);
  };
  return (
    <Card testId={`fn-${fn.name}`}>
      <Stack space="space.150">
        <Heading size="small" as="h3"><Code>{fn.usage}</Code></Heading>
        <Text>{t(`fn.${fn.name}`)}</Text>
        {fn.examples.map((example) => (
          <Inline key={example} space="space.100" alignBlock="center">
            <Box xcss={exampleStyles}><Code>{example}</Code></Box>
            <IconButton icon={CopyIcon} label={t('reference.copy')} appearance="subtle" onClick={() => copy(example)} testId="copy" />
            {copied === example ? <Lozenge appearance="success">{t('reference.copied')}</Lozenge> : null}
          </Inline>
        ))}
      </Stack>
    </Card>
  );
}
```

`src/reference/MigrationNote.jsx`:

```jsx
import SectionMessage from '@atlaskit/section-message';
import { Stack, Text } from '@atlaskit/primitives';
import { useT } from '../i18n/index.js';

/** How ScriptRunner filters map to ArtUp Query, and how dates and work time are read. */
export function MigrationNote() {
  const t = useT();
  return (
    <SectionMessage appearance="information" title={t('reference.migrationTitle')}>
      <Stack space="space.100">
        <Text>{t('reference.migrationBody')}</Text>
        <Text>{t('reference.timeNote')}</Text>
      </Stack>
    </SectionMessage>
  );
}
```

`src/reference/FunctionReference.jsx`:

```jsx
import { useMemo, useState } from 'react';
import Button from '@atlaskit/button/new';
import EmptyState from '@atlaskit/empty-state';
import Heading from '@atlaskit/heading';
import Textfield from '@atlaskit/textfield';
import { Stack } from '@atlaskit/primitives';
import { useT } from '../i18n/index.js';
import { EmptyIllustration } from '../illustrations/EmptyIllustration.jsx';
import { FunctionCard } from './FunctionCard.jsx';
import { MigrationNote } from './MigrationNote.jsx';

const GROUPS = ['query', 'site', 'board', 'sprint', 'comment', 'attachment', 'fields'];

/** Searchable reference of the shipped functions, by group. */
export function FunctionReference({ functions }) {
  const t = useT();
  const [filter, setFilter] = useState('');
  const visible = useMemo(() => {
    const q = filter.trim().toLowerCase();
    return functions.filter((f) => !q || f.name.toLowerCase().includes(q) || t(`fn.${f.name}`).toLowerCase().includes(q));
  }, [functions, filter, t]);
  return (
    <Stack space="space.400">
      <MigrationNote />
      <Textfield aria-label={t('reference.search')} placeholder={t('reference.search')} value={filter} onChange={(e) => setFilter(e.target.value)} testId="reference-search" />
      {visible.length === 0 ? (
        <EmptyState
          header={t('reference.none')}
          renderImage={() => <EmptyIllustration size={120} />}
          primaryAction={<Button onClick={() => setFilter('')}>{t('reference.clear')}</Button>}
          headingLevel={2}
        />
      ) : null}
      {GROUPS.map((group) => {
        const list = visible.filter((f) => f.group === group);
        if (!list.length) return null;
        return (
          <Stack key={group} space="space.200">
            <Heading size="medium" as="h2">{t(`group.${group}`)}</Heading>
            {list.map((f) => <FunctionCard key={f.name} fn={f} />)}
          </Stack>
        );
      })}
    </Stack>
  );
}
```

`src/status/StatusPanel.jsx`:

```jsx
import DynamicTable from '@atlaskit/dynamic-table';
import Heading from '@atlaskit/heading';
import Lozenge from '@atlaskit/lozenge';
import { Inline, Stack, Text } from '@atlaskit/primitives';
import { Card } from '../components/Card.jsx';
import { formatDate, useI18n } from '../i18n/index.js';
import { IndexProgress } from './IndexProgress.jsx';

const iso = (ms) => new Date(ms).toISOString();

/** Refresh queue, last update, index progress per part and the recent JQL editor errors. */
export function StatusPanel({ status }) {
  const { t, locale } = useI18n();
  const queue = status.queue.running ? ['inprogress', 'status.running'] : status.queue.pending ? ['moved', 'status.pending'] : ['success', 'status.idle'];
  const hasParts = Object.keys(status.progress ?? {}).length > 0;
  const rows = status.errors.map((e, i) => ({
    key: `${e.at}-${i}`,
    cells: [{ key: 't', content: formatDate(locale, iso(e.at)) }, { key: 'f', content: e.functionName }, { key: 'm', content: e.message }],
  }));
  return (
    <Stack space="space.400">
      <Card>
        <Stack space="space.150">
          <Heading size="small" as="h2">{t('status.queue')}</Heading>
          <Inline space="space.100" alignBlock="center" shouldWrap>
            <Lozenge appearance={queue[0]}>{t(queue[1])}</Lozenge>
            <Text>{status.lastRefresh ? t('status.lastRefresh', { time: formatDate(locale, iso(status.lastRefresh.at)) }) : t('status.never')}</Text>
          </Inline>
        </Stack>
      </Card>
      {hasParts ? (
        <Card>
          <Stack space="space.200">
            <Heading size="small" as="h2">{t('status.index')}</Heading>
            <IndexProgress progress={status.progress} />
            {status.excluded.length ? <Text>{t('status.excluded', { keys: status.excluded.join(', ') })}</Text> : null}
          </Stack>
        </Card>
      ) : null}
      <Card>
        <Stack space="space.150">
          <Heading size="small" as="h2">{t('status.errors')}</Heading>
          {rows.length ? (
            <DynamicTable head={{ cells: [{ key: 't', content: t('status.time') }, { key: 'f', content: t('status.function') }, { key: 'm', content: t('status.message') }] }} rows={rows} />
          ) : <Text>{t('status.noErrors')}</Text>}
        </Stack>
      </Card>
    </Stack>
  );
}
```

`formatNumber(locale, n)` и `formatDate(locale, iso)` — из скопированного `i18n/index.js` Reports (сигнатуры там такие). `src/app/useStatus.js`:

```js
import { useCallback, useEffect, useState } from 'react';
import { call } from '../api.js';

/** Loads getStatus; polls every `everyMs` while mounted when given; `reload` refetches now. */
export function useStatus(everyMs = 0) {
  const [state, setState] = useState({ status: 'loading' });
  const load = useCallback(async () => {
    try {
      setState({ status: 'ready', data: await call('getStatus') });
    } catch (error) {
      setState({ status: 'error', error });
    }
  }, []);
  useEffect(() => {
    load();
    if (!everyMs) return undefined;
    const timer = setInterval(load, everyMs);
    return () => clearInterval(timer);
  }, [load, everyMs]);
  return { ...state, reload: load };
}
```

`src/app/GlobalApp.jsx` — `AccessGate` → `AppHeader` (подзаголовок `t('app.tagline')`, действие — кнопка `t('status.refresh')` с `RefreshIcon`, вызывает `reload`) → `Tabs` «Functions»/«Status» (выбранная вкладка помнится в `localStorage` как в Reports) → `FunctionReference functions={data.functions}` / `StatusPanel status={data}`; при `status === 'loading'` — `@atlaskit/skeleton` на месте карточек, при `error` — `EmptyState` с `errorMessage(t, error)` и кнопкой повтора; `useStatus(15000)`.

- [ ] **Step 5: Тексты.** В `static/app/src/i18n/locales/en-US.json` добавить:

```json
{
  "tabs.functions": "Functions",
  "tabs.status": "Status",
  "reference.search": "Search functions",
  "reference.none": "No function matches your search.",
  "reference.clear": "Clear search",
  "reference.copy": "Copy",
  "reference.copied": "Copied",
  "reference.migrationTitle": "Coming from ScriptRunner?",
  "reference.migrationBody": "Function names and arguments are the same. Write issue in instead of issueFunction in, for example: issue in subtasksOf(\"project = DEMO\").",
  "reference.timeNote": "Dates in clauses are in UTC and weeks start on Monday. In expression, 1d of work time is 8h and 1w is 5d.",
  "group.query": "Work items of a query",
  "group.site": "Links and subtasks across the site",
  "group.board": "Board sprints",
  "group.sprint": "Sprint history",
  "group.comment": "Comments",
  "group.attachment": "Attachments",
  "group.fields": "Compare fields",
  "fn.subtasksOf": "Subtasks of the work items the subquery returns.",
  "fn.parentsOf": "Parents of the work items the subquery returns: the task of a subtask, the epic of a task, at any level.",
  "fn.epicsOf": "Epics of the work items the subquery returns.",
  "fn.issuesInEpics": "Work items in the epics the subquery returns, in company-managed and team-managed projects.",
  "fn.childIssuesOf": "All descendants of the work items the subquery returns; the optional depth limits the levels.",
  "fn.linkedIssuesOf": "Work items linked to the work items the subquery returns; optionally one link type or direction, such as \"blocks\" or \"is blocked by\".",
  "fn.linkedIssuesOfRecursive": "Work items linked directly or through other links, up to 10 levels, without looping on cycles.",
  "fn.linkedIssuesOfRecursiveLimited": "The same as linkedIssuesOfRecursive with the depth you set.",
  "fn.hasLinks": "Work items that have links, optionally of one type or direction.",
  "fn.hasLinkType": "Work items that have links of the given type (the ScriptRunner name of hasLinks).",
  "fn.hasSubtasks": "Work items that have subtasks.",
  "fn.previousSprint": "Work items of the last closed sprint of a board.",
  "fn.nextSprint": "Work items of the next future sprint of a board.",
  "fn.addedAfterSprintStart": "Work items added to a sprint after it started, even if removed later; without a sprint, the active sprint of the board.",
  "fn.removedAfterSprintStart": "Work items removed from a sprint after it started and not returned before it closed.",
  "fn.incompleteInSprint": "Work items that were in the sprint when it closed and not done.",
  "fn.completeInSprint": "Work items that were in the sprint when it closed and done.",
  "fn.commented": "Work items with comments matching the clauses: by, after, before, on, inRole, inGroup, roleLevel, groupLevel.",
  "fn.lastComment": "Work items whose last comment matches the clauses.",
  "fn.hasComments": "Work items with at least the given number of comments (1 by default).",
  "fn.fileAttached": "Work items with attachments matching the clauses: by, after, before, on, ext.",
  "fn.hasAttachments": "Work items with attachments, optionally of one file extension.",
  "fn.dateCompare": "Work items of the subquery where one date field compares to another, such as resolutiondate > duedate or created + 2d < firstCommented.",
  "fn.expression": "Work items of the subquery where arithmetic over number and time fields is true, such as timespent > originalestimate * 1.2.",
  "status.refresh": "Refresh",
  "status.queue": "Updates",
  "status.idle": "Idle",
  "status.pending": "Waiting",
  "status.running": "Updating",
  "status.lastRefresh": "Last update {time}",
  "status.never": "No update yet",
  "status.index": "Index",
  "status.part.sprint": "Sprint history",
  "status.part.comments": "Comments and attachments",
  "status.indexProgress": "{done} of {total} issues",
  "status.indexReady": "Ready",
  "status.excluded": "Projects excluded from the index: {keys}",
  "status.errors": "Recent errors",
  "status.noErrors": "No errors in the JQL editor so far.",
  "status.time": "Time",
  "status.function": "Function",
  "status.message": "Message"
}
```

(слиянием с существующими ключами), и настоящие переводы всех новых ключей в 25 файлах; имена функций, `issue in`, `issueFunction in`, `UTC`, `1d`, `8h`, `5d`, имена условий (`by`, `after` …) не переводятся; термины — как в интерфейсе Jira на этом языке («задача» в ru-RU для work item — по текущему переводу Jira). В `guards.test.js` вернуть тест «leaves no `<pre>` context probe in any component».

- [ ] **Step 6: Run** `npm --prefix static/app install && npm --prefix static/app test` → PASS; `npm run build:ui` → сборка без ошибок; `npx vitest run` → PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/query
git commit -m "JQL-22: Add the function reference and the refresh status page in 26 languages

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 16: Инструмент приёмки — HTTP с таймаутом, эталоны REST, полнота и свежесть M1

**Model:** opus

**Files:**
- Create: `apps/query/scripts/lib/{http.mjs,latency.mjs,reference.mjs,report.mjs}`, `apps/query/scripts/acceptance.mjs`
- Test: `apps/query/test/scripts/report.test.js`

**Interfaces:**
- Consumes: `.env` (`FORGE_EMAIL`, `FORGE_API_TOKEN`), засев JQLG/RPT, доска RPT из засева Reports.
- Produces:
  - `http.mjs`: `SITE`, `stats = { requests, retries, timeouts }`, `sleep(ms)`, `api(method, path, body, { raw, attempts, timeoutMs, unsafe }) → json | { status, text }` (таймаут 30 с, повтор сетевых ошибок, 429, 5xx; для `unsafe: true` — сетевую ошибку не повторяет, бросает `UnsafeRetryError`, чтобы вызывающий проверил, применилось ли изменение), `pool(items, n, task)`, `ids(jql) → { ids } | { error }`, `bulk(ids, fields) → issue[]`.
  - `latency.mjs` (общий модуль замера свежести; его импортируют `acceptance.mjs`, фазы `fresh` Tasks 24, 27, 28, фаза `burst` Task 31 и `atlassian/tools/measure-jql-jg67.mjs` Task 19 — функции замера не копируются по скриптам): `waitFor(clause, id, present, since) → seconds|null` (null — не видно за 10 мин, потеря), `linkId(fromId, toId) → string|null`, `latencyResult(rows, startedAt) → { seconds, summary, overall, raw }`, `latency({ n, log })` — 5 видов изменений × n против функций M1.
  - `reference.mjs`: `REFERENCES[functionName](userArgs, options) → Promise<string[]>` — эталоны независимым REST-обходом (без `src/`, P-6); M1 — 13 функций; `myAccountId() → string` (из `/rest/api/3/myself`, кэш на процесс).
  - `report.mjs`: `pct(values, p)`, `summary(values) → { n, p50, p90, max }`, `compare(got, ref) → { count, reference, missing, extra, complete }`, `save(name, data) → path` (в `apps/query/data/`).
  - `acceptance.mjs <phase> [--tag t] [--n 30] [--board <name|id>] [--group query|board] [--cases m1]`: фазы `complete` (полнота по таблице случаев; случай — `[fn, userArgs, note, and?]`, `@board` → `--board`, `@me` → `myAccountId()`, `and` — родной JQL, который приписывается ` AND (and)` к запросу функции, чтобы сузить результат до области эталона), `fresh` (свежесть и потери; группы `query` и `board`), `seed-tm` (team-managed проект). Task 31 добавляет `burst`, `audit`, `errors`, `sr`; Tasks 24, 27, 28 — случаи и эталоны своих групп.

- [ ] **Step 1: Падающий тест** `test/scripts/report.test.js`:

```js
import { describe, expect, it } from 'vitest';
import { compare, pct, summary } from '../../scripts/lib/report.mjs';

describe('report', () => {
  it('takes nearest-rank percentiles', () => {
    expect([pct([5, 1, 3, 2, 4], 50), pct([5, 1, 3, 2, 4], 90), pct([], 90)]).toEqual([3, 5, null]);
    expect(summary([1, 2, 3])).toEqual({ n: 3, p50: 2, p90: 3, max: 3 });
  });
  it('counts missing and extra ids against the reference', () => {
    expect(compare(['1', '2', '4'], ['1', '2', '3'])).toEqual({ count: 3, reference: 3, missing: 1, extra: 1, complete: false });
    expect(compare(['2', '1'], ['1', '2'])).toEqual({ count: 2, reference: 2, missing: 0, extra: 0, complete: true });
  });
});
```

Run: `npx vitest run test/scripts` → FAIL.

- [ ] **Step 2: `scripts/lib/report.mjs`**

```js
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const DATA = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'data');

/** Nearest-rank percentile, null for no values. */
export function pct(values, p) {
  if (!values.length) return null;
  const s = [...values].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.ceil((p / 100) * s.length) - 1)];
}

/** n, p50, p90 and max of a list of seconds. */
export function summary(values) {
  return { n: values.length, p50: pct(values, 50), p90: pct(values, 90), max: values.length ? Math.max(...values) : null };
}

/** Result ids against reference ids. */
export function compare(got, ref) {
  const g = new Set(got.map(String));
  const r = new Set(ref.map(String));
  const missing = [...r].filter((x) => !g.has(x)).length;
  const extra = [...g].filter((x) => !r.has(x)).length;
  return { count: g.size, reference: r.size, missing, extra, complete: missing === 0 && extra === 0 };
}

/** Writes a JSON result to apps/query/data/<name>.json and returns the path. */
export function save(name, data) {
  mkdirSync(DATA, { recursive: true });
  const path = join(DATA, `${name}.json`);
  writeFileSync(path, JSON.stringify({ date: new Date().toISOString(), ...data }, null, 1));
  return path;
}
```

Run: `npx vitest run test/scripts` → PASS.

- [ ] **Step 3: `scripts/lib/http.mjs`**

```js
export const SITE = 'https://artuplabs-dev.atlassian.net';
export const stats = { requests: 0, retries: 0, timeouts: 0 };

/** Thrown when a write timed out or the connection broke: the caller checks whether it was applied before retrying. */
export class UnsafeRetryError extends Error {}

const auth = () => `Basic ${Buffer.from(`${process.env.FORGE_EMAIL}:${process.env.FORGE_API_TOKEN}`).toString('base64')}`;
export const sleep = (ms) => new Promise((resolve) => {
  setTimeout(resolve, ms);
});

/** REST call with a request timeout and retries of network errors, 429 and 5xx; `raw` returns status and text. */
export async function api(method, path, body, { raw = false, attempts = 8, timeoutMs = 30000, unsafe = false } = {}) {
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    stats.requests += 1;
    let res;
    try {
      res = await fetch(`${SITE}${path}`, {
        method,
        headers: { Authorization: auth(), Accept: 'application/json', 'X-Atlassian-Token': 'no-check', ...(body ? { 'Content-Type': 'application/json' } : {}) },
        body: body ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (error) {
      stats.retries += 1;
      if (error?.name === 'TimeoutError') stats.timeouts += 1;
      if (unsafe) throw new UnsafeRetryError(`${method} ${path}: ${error?.name ?? error}`);
      await sleep(500 * 2 ** attempt);
      continue;
    }
    if (res.status === 429 || res.status >= 500) {
      stats.retries += 1;
      await sleep(Number(res.headers.get('retry-after')) * 1000 || 500 * 2 ** attempt);
      continue;
    }
    const text = await res.text();
    if (raw) return { status: res.status, text };
    if (!res.ok) throw Object.assign(new Error(`${method} ${path} → ${res.status} ${text.slice(0, 300)}`), { status: res.status, text });
    return text ? JSON.parse(text) : null;
  }
  throw new Error(`${method} ${path} → gave up after ${attempts} attempts`);
}

/** Runs task over items with at most n in flight (own copy, not src/infra/pool.js: the tools stay independent of the app, P-6). */
export async function pool(items, n, task) {
  const out = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    while (next < items.length) {
      const i = next;
      next += 1;
      out[i] = await task(items[i], i);
    }
  }));
  return out;
}

/** All ids of a JQL (5 000 per page), or `{ error }` with Jira's answer. */
export async function ids(jql) {
  const out = [];
  let nextPageToken;
  do {
    const r = await api('POST', '/rest/api/3/search/jql', { jql, fields: ['id'], maxResults: 5000, ...(nextPageToken ? { nextPageToken } : {}) }, { raw: true });
    if (r.status !== 200) return { error: `${r.status} ${r.text.slice(0, 300)}` };
    const page = JSON.parse(r.text);
    out.push(...page.issues.map((x) => String(x.id)));
    nextPageToken = page.nextPageToken;
  } while (nextPageToken);
  return { ids: out };
}

/** Issues with the given fields via bulkfetch, 100 per call, 8 in parallel. */
export async function bulk(idList, fields) {
  const chunks = [];
  for (let i = 0; i < idList.length; i += 100) chunks.push(idList.slice(i, i + 100));
  const pages = await pool(chunks, 8, (c) => api('POST', '/rest/api/3/issue/bulkfetch', { issueIdsOrKeys: c, fields }));
  return pages.flatMap((p) => p.issues ?? []);
}
```

- [ ] **Step 4: `scripts/lib/reference.mjs`** — эталоны, независимые от кода приложения:

```js
import { api, bulk, ids } from './http.mjs';

const byNum = (a, b) => Number(a) - Number(b);
const uniq = (list) => [...new Set(list.map(String))].sort(byNum);
const chunk = (list, n) => Array.from({ length: Math.ceil(list.length / n) }, (_, i) => list.slice(i * n, (i + 1) * n));
const jiraMs = (s) => Date.parse(String(s).replace(/([+-]\d{2})(\d{2})$/, '$1:$2'));

async function must(jql) {
  const r = await ids(jql);
  if (r.error) throw new Error(`${jql}: ${r.error}`);
  return r.ids;
}

let me = null;

/** Account id of the user the tool runs as. */
export async function myAccountId() {
  me = me ?? (await api('GET', '/rest/api/3/myself')).accountId;
  return me;
}

async function children(parentIds) {
  const out = [];
  for (const part of chunk(parentIds, 500)) out.push(...(await must(`parent in (${part.join(',')})`)));
  return out;
}

function linkPasses(link, type) {
  if (!type) return true;
  const want = type.trim().toLowerCase();
  if (link.type.name === type.trim()) return true;
  if (link.outwardIssue && link.type.outward.toLowerCase() === want) return true;
  if (link.inwardIssue && link.type.inward.toLowerCase() === want) return true;
  const isDescription = [link.type.outward, link.type.inward].some((d) => d.toLowerCase() === want);
  return !isDescription && link.type.name.toLowerCase() === want;
}

const others = (issue, type) => (issue.fields.issuelinks ?? []).filter((l) => linkPasses(l, type)).map((l) => (l.outwardIssue ?? l.inwardIssue).id);

async function closure(starts, depth, type) {
  const expanded = new Set();
  const reached = new Set();
  let frontier = uniq(starts);
  for (let level = 0; level < Math.min(depth, 10) && frontier.length; level += 1) {
    frontier.forEach((id) => expanded.add(id));
    const next = new Set();
    for (const x of await bulk(frontier, ['issuelinks'])) {
      for (const o of others(x, type)) {
        reached.add(String(o));
        if (!expanded.has(String(o))) next.add(String(o));
      }
    }
    frontier = [...next];
  }
  return uniq([...reached]);
}

async function boardId(arg) {
  if (/^\d+$/.test(arg)) return Number(arg);
  const page = await api('GET', `/rest/agile/1.0/board?name=${encodeURIComponent(arg)}`);
  const exact = page.values.filter((b) => b.name.toLowerCase() === arg.toLowerCase());
  if (exact.length !== 1) throw new Error(`board ${arg}: ${exact.length} matches`);
  return exact[0].id;
}

async function sprintsOf(board, state) {
  const out = [];
  for (let startAt = 0; ; startAt += 50) {
    const page = await api('GET', `/rest/agile/1.0/board/${board}/sprint?state=${state}&startAt=${startAt}&maxResults=50`);
    out.push(...page.values);
    if (page.isLast || !page.values.length) return out;
  }
}

async function sprintIssues(sprintId) {
  const out = [];
  for (let startAt = 0; ; startAt += 100) {
    const page = await api('GET', `/rest/agile/1.0/sprint/${sprintId}/issue?fields=id&startAt=${startAt}&maxResults=100`);
    out.push(...page.issues.map((x) => String(x.id)));
    if (startAt + page.issues.length >= page.total || !page.issues.length) return uniq(out);
  }
}

/** Reference results by REST traversal, written without the app's code. */
export const REFERENCES = {
  async subtasksOf([q]) {
    const inner = new Set(await must(q));
    return uniq((await bulk(await must('issuetype in subTaskIssueTypes()'), ['parent'])).filter((x) => inner.has(String(x.fields.parent?.id))).map((x) => x.id));
  },
  async parentsOf([q]) {
    return uniq((await bulk(await must(q), ['parent'])).map((x) => x.fields.parent?.id).filter(Boolean));
  },
  async epicsOf([q]) {
    let level = await bulk(await must(q), ['parent', 'issuetype']);
    const out = [];
    for (let step = 0; step < 3 && level.length; step += 1) {
      const up = [];
      for (const x of level) {
        const p = x.fields.parent;
        if (!p || x.fields.issuetype.hierarchyLevel >= 1) continue;
        if (p.fields?.issuetype?.hierarchyLevel === 1) out.push(p.id);
        else up.push(p.id);
      }
      level = up.length ? await bulk(uniq(up), ['parent', 'issuetype']) : [];
    }
    return uniq(out);
  },
  async issuesInEpics([q]) {
    const epics = (await bulk(await must(q), ['issuetype'])).filter((x) => x.fields.issuetype.hierarchyLevel === 1).map((x) => String(x.id));
    return uniq(await children(epics));
  },
  async childIssuesOf([q, depth]) {
    let frontier = await must(q);
    const seen = new Set(frontier);
    const out = new Set();
    for (let level = 0; level < Number(depth ?? 10) && frontier.length; level += 1) {
      const kids = await children(frontier);
      kids.forEach((k) => out.add(k));
      frontier = kids.filter((k) => !seen.has(k));
      frontier.forEach((k) => seen.add(k));
    }
    return uniq([...out]);
  },
  async linkedIssuesOf([q, type]) {
    return uniq((await bulk(await must(q), ['issuelinks'])).flatMap((x) => others(x, type)));
  },
  linkedIssuesOfRecursive: async ([q, type]) => closure(await must(q), 10, type),
  linkedIssuesOfRecursiveLimited: async ([q, depth, type]) => closure(await must(q), Number(depth), type),
  async hasLinks([type]) {
    return uniq((await bulk(await must('project is not EMPTY'), ['issuelinks'])).filter((x) => others(x, type).length).map((x) => x.id));
  },
  hasLinkType: async ([type]) => REFERENCES.hasLinks([type]),
  async hasSubtasks() {
    return uniq((await bulk(await must('issuetype in subTaskIssueTypes()'), ['parent'])).map((x) => x.fields.parent?.id).filter(Boolean));
  },
  async previousSprint([board]) {
    const closed = (await sprintsOf(await boardId(board), 'closed')).sort((a, b) => Date.parse(b.completeDate) - Date.parse(a.completeDate) || b.id - a.id);
    return closed.length ? sprintIssues(closed[0].id) : [];
  },
  async nextSprint([board]) {
    const future = (await sprintsOf(await boardId(board), 'future')).sort((a, b) => (Date.parse(a.startDate ?? '') || Infinity) - (Date.parse(b.startDate ?? '') || Infinity) || a.id - b.id);
    return future.length ? sprintIssues(future[0].id) : [];
  },
};
```

- [ ] **Step 5: `scripts/acceptance.mjs`** — фазы M1:

```js
#!/usr/bin/env node
import { api, bulk, ids, sleep, stats } from './lib/http.mjs';
import { latency, latencyResult, waitFor } from './lib/latency.mjs';
import { myAccountId, REFERENCES } from './lib/reference.mjs';
import { compare, save, summary } from './lib/report.mjs';

const args = { phase: process.argv[2], n: 30, tag: '', board: 'RPT board', group: 'query' };
for (let i = 3; i < process.argv.length; i += 2) args[process.argv[i].replace(/^--/, '')] = process.argv[i + 1];
args.n = Number(args.n);

const log = (s) => process.stderr.write(`${new Date().toISOString().slice(11, 19)} ${s}\n`);
const q = (s) => `"${String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
const clause = (fn, userArgs) => `issue in ${fn}(${userArgs.map(q).join(', ')})`;

/** Completeness cases: function, user arguments, what the case proves, optional native JQL ANDed to the result. Later stages append their own. */
export const CASES = {
  m1: [
    ['subtasksOf', ['project = JQLG AND labels = jg-mid'], '1 200 subtasks (> 1 000)'],
    ['subtasksOf', ['project = JQLG AND labels = jg-big'], '12 000 subtasks (> 10 000)'],
    ['subtasksOf', ['filter = "JQLG mid"'], 'saved filter as the argument'],
    ['subtasksOf', ['key in (JQLG-1, JQLG-2, JQLG-3)'], 'list of keys as the argument'],
    ['subtasksOf', ['issue in linkedIssuesOf("project = JQLG AND labels = jg-lnk")'], 'nested app function'],
    ['parentsOf', ['project = JQLG AND issuetype in subTaskIssueTypes()'], 'parents of 24 000 subtasks'],
    ['epicsOf', ['project = JQLG AND issuetype in subTaskIssueTypes()'], 'subtask → story → epic'],
    ['issuesInEpics', ['project = JQLG AND issuetype = Epic'], '15 600 children (> 10 000)'],
    ['childIssuesOf', ['project = JQLG AND issuetype = Epic'], 'all levels (> 10 000)'],
    ['childIssuesOf', ['project = JQLG AND issuetype = Epic', '1'], 'depth 1'],
    ['linkedIssuesOf', ['project = JQLG AND labels = jg-lnk'], '1 500 linked (> 1 000)'],
    ['linkedIssuesOf', ['project = JQLG AND labels = jg-lnk', 'blocks'], 'one direction'],
    ['linkedIssuesOf', ['project in (JQLG, RPT)'], 'inner query of 50 000'],
    ['linkedIssuesOfRecursive', ['project = JQLG AND labels = jg-lnk'], 'closure'],
    ['linkedIssuesOfRecursiveLimited', ['project = JQLG AND labels = jg-lnk', '2'], 'closure, depth 2'],
    ['hasLinks', [], 'native issueLinkType'],
    ['hasLinkType', ['Blocks'], 'native, both directions'],
    ['hasSubtasks', [], 'parents of all subtasks'],
    ['previousSprint', ['@board'], 'last closed sprint'],
    ['nextSprint', ['@board'], 'next future sprint'],
  ],
};

async function ensureFilter() {
  const found = await api('GET', `/rest/api/3/filter/search?filterName=${encodeURIComponent('"JQLG mid"')}`);
  if (found.values.some((f) => f.name === 'JQLG mid')) return;
  await api('POST', '/rest/api/3/filter', { name: 'JQLG mid', jql: 'project = JQLG AND labels = jg-mid', sharePermissions: [{ type: 'authenticated' }] });
}

async function evaluate(jql) {
  for (let attempt = 1; attempt <= 6; attempt += 1) {
    const t0 = Date.now();
    const r = await ids(jql);
    if (!r.error?.includes('Computing, retry in a minute')) return { ...r, seconds: (Date.now() - t0) / 1000, attempts: attempt };
    log(`computing, waiting 60 s: ${jql.slice(0, 80)}`);
    await sleep(60000);
  }
  return { error: 'still computing after 6 attempts' };
}

async function complete() {
  await ensureFilter();
  const list = CASES[args.cases ?? 'm1'];
  const rows = [];
  for (const [fn, raw, note, and] of list) {
    const userArgs = [];
    for (const a of raw) userArgs.push(a === '@board' ? args.board : a.includes('@me') ? a.replace('@me', await myAccountId()) : a);
    const jql = and ? `${clause(fn, userArgs)} AND (${and})` : clause(fn, userArgs);
    const got = await evaluate(jql);
    const row = { fn, userArgs, note, and: and ?? null, seconds: got.seconds, attempts: got.attempts, error: got.error };
    if (got.ids) Object.assign(row, compare(got.ids, await REFERENCES[fn](userArgs, args)));
    log(`${fn} ${note}: ${JSON.stringify(row)}`);
    rows.push(row);
  }
  const path = save(`acceptance-complete-${args.cases ?? 'm1'}${args.tag ? `-${args.tag}` : ''}`, { stats, rows, allComplete: rows.every((r) => r.complete) });
  log(`saved ${path}`);
}
```

Фаза `fresh` (группы `query` и `board`, M1). Замер свежести — общий модуль `scripts/lib/latency.mjs` (перенос механики `atlassian/tools/measure-jql-jg5.mjs` с функциями приложения вместо функций прототипа; `api`, `ids`, `bulk`, `sleep` — из `lib/http.mjs` с таймаутом); потерянным считается изменение, не видимое за 10 мин (`timeouts`):

```js
import { api, bulk, ids, sleep } from './http.mjs';
import { summary } from './report.mjs';

const POLL_MS = 2000;
const TIMEOUT_MS = 10 * 60 * 1000;
const round = (ms) => Math.round(ms / 100) / 10;

/** Polls `(clause) AND id = X` until present (or absent): seconds from `since`, or null after 10 minutes (a lost change). */
export async function waitFor(clause, id, present, since) {
  for (;;) {
    const r = await api('POST', '/rest/api/3/search/jql', { jql: `(${clause}) AND id = ${id}`, fields: ['id'], maxResults: 1 }, { raw: true });
    const found = r.status === 200 && JSON.parse(r.text).issues.length > 0;
    if (r.status === 200 && found === present) return round(Date.now() - since);
    if (Date.now() - since > TIMEOUT_MS) return null;
    await sleep(POLL_MS);
  }
}

/** Id of the link between two issues, or null. */
export async function linkId(fromId, toId) {
  const x = await api('GET', `/rest/api/3/issue/${fromId}?fields=issuelinks`);
  return x.fields.issuelinks.find((l) => (l.outwardIssue ?? l.inwardIssue)?.id === String(toId))?.id ?? null;
}

/** Seconds per kind of change and overall; null (not visible within 10 minutes) counts as a timeout. */
export function latencyResult(rows, startedAt) {
  const seen = (list) => list.filter((x) => x !== null);
  const lost = (list) => list.filter((x) => x === null).length;
  const all = Object.values(rows).flat();
  return {
    seconds: round(Date.now() - startedAt),
    summary: Object.fromEntries(Object.entries(rows).map(([k, v]) => [k, { ...summary(seen(v)), timeouts: lost(v) }])),
    overall: { ...summary(seen(all)), timeouts: lost(all) },
    raw: rows,
  };
}

/** M1 freshness: n changes of five kinds on JQLG, each awaited in subtasksOf or linkedIssuesOf of the app. */
export async function latency({ n, log }) {
  const project = await api('GET', '/rest/api/3/project/JQLG');
  const subType = (await api('GET', `/rest/api/3/issuetype/project?projectId=${project.id}`)).find((t) => t.subtask);
  const C_SUB = 'issue in subtasksOf("project = JQLG AND labels = jg-mid")';
  const C_LNK = 'issue in linkedIssuesOf("project = JQLG AND labels = jg-lnk")';
  const C_IN = 'issue in subtasksOf("project = JQLG AND labels = jg-in")';
  for (const c of [C_SUB, C_LNK, C_IN]) log(`warm ${c}: ${(await ids(c)).ids?.length}`);
  const mid = (await ids('project = JQLG AND labels = jg-mid ORDER BY key')).ids;
  const lnk = (await ids('project = JQLG AND labels = jg-lnk ORDER BY key')).ids;
  const small = await bulk((await ids('project = JQLG AND labels = jg-small ORDER BY key')).ids.slice(0, n + 5), ['subtasks', 'labels']);
  const targets = (await ids('project = JQLG AND labels = jg-task AND issueLinkType is EMPTY AND labels not in (jg-big, jg-mid, jg-small, jg-lnk, jg-sprint, jg-sprint-big) ORDER BY key DESC')).ids;
  const rows = { newSubtask: [], newLink: [], deletedLink: [], enterQuery: [], leaveQuery: [] };
  const subStream = async () => {
    for (let i = 0; i < n; i += 1) {
      const parent = mid[(i * 7) % mid.length];
      const created = await api('POST', '/rest/api/3/issue', { fields: { project: { id: project.id }, issuetype: { id: subType.id }, summary: `aq measure sub ${i}`, labels: ['jg', 'jg-measure'], parent: { id: parent } } });
      rows.newSubtask.push(await waitFor(C_SUB, created.id, true, Date.now()));
      log(`newSubtask ${i}: ${rows.newSubtask.at(-1)} s`);
    }
  };
  const linkStream = async () => {
    for (let i = 0; i < n; i += 1) {
      const from = lnk[(i * 11) % lnk.length];
      const to = targets[i];
      await api('POST', '/rest/api/3/issueLink', { type: { name: 'Relates' }, outwardIssue: { id: from }, inwardIssue: { id: to } });
      rows.newLink.push(await waitFor(C_LNK, to, true, Date.now()));
      await api('DELETE', `/rest/api/3/issueLink/${await linkId(from, to)}`, undefined, { raw: true });
      rows.deletedLink.push(await waitFor(C_LNK, to, false, Date.now()));
      log(`link ${i}: +${rows.newLink.at(-1)} s −${rows.deletedLink.at(-1)} s`);
    }
  };
  const fieldStream = async () => {
    for (let i = 0; i < n; i += 1) {
      const x = small[i];
      const sub = x.fields.subtasks[0].id;
      await api('PUT', `/rest/api/3/issue/${x.id}`, { update: { labels: [{ add: 'jg-in' }] } });
      rows.enterQuery.push(await waitFor(C_IN, sub, true, Date.now()));
      await api('PUT', `/rest/api/3/issue/${x.id}`, { update: { labels: [{ remove: 'jg-in' }] } });
      rows.leaveQuery.push(await waitFor(C_IN, sub, false, Date.now()));
      log(`field ${i}: in ${rows.enterQuery.at(-1)} s out ${rows.leaveQuery.at(-1)} s`);
    }
  };
  const t0 = Date.now();
  await Promise.all([subStream(), linkStream(), fieldStream()]);
  return latencyResult(rows, t0);
}
```

В `acceptance.mjs` — группа `query` и группа `board` (свежесть `previousSprint`/`nextSprint` по событиям спринтов, Task 17 Step 5): на доске `--board` без активного спринта n раз создать будущий спринт с самой ранней датой старта, положить в него задачу из бэклога доски и ждать её в `nextSprint`; затем запустить и закрыть спринт и ждать задачу в `previousSprint`:

```js
const tagged = (name) => `${name}${args.tag ? `-${args.tag}` : ''}`;

async function queryLatency() {
  const result = await latency({ n: args.n, log });
  log(JSON.stringify(result.summary));
  save(tagged('acceptance-fresh-query'), { stats, ...result });
}

async function boardLatency() {
  const DAY = 86400000;
  const board = (await api('GET', `/rest/agile/1.0/board?name=${encodeURIComponent(args.board)}`)).values.find((b) => b.name === args.board);
  if (!board) throw new Error(`board ${args.board} not found`);
  if ((await api('GET', `/rest/agile/1.0/board/${board.id}/sprint?state=active`)).values.length) throw new Error(`board ${args.board} has an active sprint: close it first`);
  const backlog = (await api('GET', `/rest/agile/1.0/board/${board.id}/backlog?fields=key&maxResults=${args.n}`)).issues.map((x) => String(x.id));
  const C_NEXT = clause('nextSprint', [args.board]);
  const C_PREV = clause('previousSprint', [args.board]);
  const rows = { nextSprint: [], previousSprint: [] };
  const t0 = Date.now();
  for (const x of backlog) {
    const created = Date.now();
    const sprint = await api('POST', '/rest/agile/1.0/sprint', { name: `AQ fresh ${created}`, originBoardId: board.id, startDate: new Date(created - DAY).toISOString(), endDate: new Date(created + DAY).toISOString() });
    await api('POST', `/rest/agile/1.0/sprint/${sprint.id}/issue`, { issues: [x] });
    rows.nextSprint.push(await waitFor(C_NEXT, x, true, created));
    await api('POST', `/rest/agile/1.0/sprint/${sprint.id}`, { state: 'active' });
    await api('POST', `/rest/agile/1.0/sprint/${sprint.id}`, { state: 'closed' });
    rows.previousSprint.push(await waitFor(C_PREV, x, true, Date.now()));
    log(`board ${x}: next ${rows.nextSprint.at(-1)} s, previous ${rows.previousSprint.at(-1)} s`);
  }
  const result = latencyResult(rows, t0);
  log(JSON.stringify(result.summary));
  save(tagged('acceptance-fresh-board'), { stats, ...result });
}
```

Фаза `seed-tm` — team-managed проект для строки §4 брифа «company- и team-managed»:

```js
async function seedTeamManaged() {
  const me = await api('GET', '/rest/api/3/myself');
  let project = await api('GET', '/rest/api/3/project/JQLT', undefined, { raw: true });
  if (project.status === 404) {
    const created = await api('POST', '/rest/api/3/project', { key: 'JQLT', name: 'JQL team-managed', projectTypeKey: 'software', projectTemplateKey: 'com.pyxis.greenhopper.jira:gh-simplified-agility-scrum', leadAccountId: me.accountId }, { raw: true });
    if (created.status >= 300) {
      log(`team-managed project not created (${created.status}): ask the owner to create JQLT (team-managed scrum) and rerun`);
      return;
    }
  }
  const meta = await api('GET', '/rest/api/3/issue/createmeta/JQLT/issuetypes');
  const type = (level) => meta.issueTypes.find((t) => t.hierarchyLevel === level);
  const make = (fields) => api('POST', '/rest/api/3/issue', { fields: { project: { key: 'JQLT' }, ...fields } });
  const existing = (await ids('project = JQLT')).ids ?? [];
  if (existing.length) {
    log(`JQLT already has ${existing.length} issues`);
    return;
  }
  for (let e = 0; e < 2; e += 1) {
    const epic = await make({ issuetype: { id: type(1).id }, summary: `tm epic ${e}` });
    for (let s = 0; s < 3; s += 1) {
      const story = await make({ issuetype: { id: type(0).id }, summary: `tm story ${e}.${s}`, parent: { id: epic.id } });
      await make({ issuetype: { id: type(-1).id }, summary: `tm sub ${e}.${s}`, parent: { id: story.id } });
    }
  }
  log(`JQLT seeded: ${(await ids('project = JQLT')).ids.length} issues`);
}
```

Случаи team-managed добавить в `CASES.m1`: `['issuesInEpics', ['project = JQLT AND issuetype = Epic'], 'team-managed epics']`, `['subtasksOf', ['project = JQLT AND hierarchyLevel = 0'], 'team-managed subtasks']` — если JQL `hierarchyLevel` не поддержан, заменить на `project = JQLT AND issuetype in standardIssueTypes() AND issuetype != Epic`.

Конец файла:

```js
/** Freshness phases by function group; later stages add sprint, comment, attachment and fields. */
export const FRESH = { query: queryLatency, board: boardLatency };

const PHASES = { complete, fresh: () => FRESH[args.group](), 'seed-tm': seedTeamManaged };
if (!PHASES[args.phase]) {
  log(`phases: ${Object.keys(PHASES).join(', ')}`);
  process.exit(2);
}
PHASES[args.phase]().then(() => log(`requests ${stats.requests}, retries ${stats.retries}, timeouts ${stats.timeouts}`)).catch((e) => {
  console.error(e.stack);
  process.exit(1);
});
```

- [ ] **Step 6: Проверка.** `node --check apps/query/scripts/acceptance.mjs && node --check apps/query/scripts/lib/reference.mjs && node --check apps/query/scripts/lib/latency.mjs` → без вывода; `npx vitest run` → PASS; `npm run lint` → 0 ошибок.

- [ ] **Step 7: Commit**

```bash
git add apps/query/scripts apps/query/test/scripts
git commit -m "JQL-23: Add the acceptance tool with request timeouts, REST references and M1 cases

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 17: Деплой M1, проверка на сайте, полнота и свежесть M1

**Model:** sonnet

**Files:**
- Modify: `apps/query/docs/live-checks.md` (раздел «M1 on site»), `apps/query/test/fixtures/events/*.json` (если живые тела событий отличаются), rulings

**Interfaces:**
- Consumes: Tasks 4–16; прототип J-G5 установлен на сайте (Task 2).
- Produces: таблица полноты M1 (`data/acceptance-complete-m1.json`), свежесть и потери на 150 изменениях (`data/acceptance-fresh-query.json`), свежесть `previousSprint`/`nextSprint` по событиям спринтов (`data/acceptance-fresh-board.json`), подтверждённые формы событий (включая события спринтов); при расхождениях — Ruling и задача на исправление.

- [ ] **Step 1: Снять прототип с сайта** (одинаковые имена `subtasksOf`/`linkedIssuesOf` у двух приложений на одном сайте):

```bash
set -a && . /Users/artyomkarpets/IncomeApps/projects/DistributB2B/.env && set +a
cd atlassian/tools/j-g5-jqlfn && forge uninstall -e development --site artuplabs-dev.atlassian.net --product jira --non-interactive
```

- [ ] **Step 2: Деплой с отладкой событий.**

```bash
cd apps/query && npm run build:ui
forge variables set -e development QUERY_DEBUG_EVENTS 1
forge deploy -e development --non-interactive
perl -e 'alarm 300; exec @ARGV' forge install --upgrade -e development --site artuplabs-dev.atlassian.net --product jira --non-interactive
forge eligibility -e development --non-interactive
```

Expected: eligible for Runs on Atlassian; в редакторе JQL на `artuplabs-dev` подсказка показывает 13 функций.

- [ ] **Step 3: Формы событий.** Сделать по одному изменению каждого вида на JQLG (новая подзадача, смена родителя, новая и удалённая связь, удаление задачи) и на доске RPT (создание, старт и закрытие спринта) через `node apps/query/scripts/live-checks.mjs` или REST вручную; `forge logs -e development --since 10m | grep '"event"'`; сравнить ключи и пары `[field, fieldId]` с фикстурами `test/fixtures/events/*.json`. Расхождение → поправить фикстуру; если `eventRecord` даёт `unknown` или теряет id — исполнитель opus чинит `src/core/events.js` с тестом (отдельный коммит `JQL-24`-подзадачи не делается: исправление входит в коммит этой задачи).

- [ ] **Step 4: Полнота M1.** `node apps/query/scripts/acceptance.mjs complete --cases m1 --board "<доска RPT из засева Reports>"` (имя доски — `GET /rest/agile/1.0/board?projectKeyOrId=RPT`; если у доски нет закрытого и будущего спринта — создать их через Agile API и записать это в `docs/live-checks.md`). Затем `node apps/query/scripts/acceptance.mjs seed-tm` и повторить `complete` для случаев JQLT. Критерий: `complete: true` у каждой строки. Строка с `complete: false` → стоп, исполнитель opus находит причину (сравнить `missing`/`extra` с эталоном), чинит с тестом, повтор.

- [ ] **Step 5: Свежесть и потери M1.** `node apps/query/scripts/acceptance.mjs fresh --group query --n 30` → 150 изменений. Критерий: `overall.timeouts === 0` и `overall.p90 ≤ 60`. Холодный первый поиск `subtasksOf("project in (JQLG, RPT)")` — записать секунды и было ли «Computing, retry in a minute» (строка §4 «первый результат на 50 000 задач»). Затем свежесть функций доски по событиям спринтов (§3, §5 «секунды»): `node apps/query/scripts/acceptance.mjs fresh --group board --n 10 --board "<доска RPT>"` — 10 раз «новый будущий спринт с задачей → `nextSprint`» и «старт и закрытие спринта → `previousSprint`»; если у доски есть активный спринт, фаза останавливается с ошибкой — закрыть его через Agile API (`POST /rest/agile/1.0/sprint/{id} { state: 'closed' }`) и записать это в `docs/live-checks.md`. Критерий: в `data/acceptance-fresh-board.json` у `nextSprint` и `previousSprint` `timeouts === 0` и `p90 ≤ 60`. Не прошло → исполнитель opus сверяет имена событий спринтов в манифесте (Task 14) с `forge logs`, чинит с тестом, повтор.

- [ ] **Step 6: Отключить отладку**: `forge variables unset -e development QUERY_DEBUG_EVENTS` и повторный `forge deploy -e development --non-interactive`.

- [ ] **Step 7: Записать** в `docs/live-checks.md` раздел «M1 on site»: таблица полноты (функция, случай, count, reference, missing, extra, секунды), свежесть (p50/p90/max, потери) по группам `query` и `board`, холодный старт, team-managed (создан скриптом или владельцем).

- [ ] **Step 8: Commit**

```bash
git add apps/query/docs apps/query/test/fixtures apps/query/src atlassian/plans/2026-10-03-artup-query-v1-rulings.md
git commit -m "JQL-24: Record M1 completeness, freshness and live event shapes on the dev site

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

> **Чекпоинт C1 (владелец, после Task 17):** открыть на `artuplabs-dev` «Приложения → ArtUp Query»: справочник 13 функций, копирование примера, вкладка состояния; в поиске задач выполнить 3–4 примера из справочника. Если проект JQLT не создался скриптом — создать team-managed scrum-проект `JQLT` (агент досеет и повторит проверку). Работа агента дальше не ждёт C1: M2 идёт параллельно.

## Ворота J-G6 и J-G7, этап M2 — история спринтов

Оба замера делаются до кода индекса: J-G6 — до кода M2, J-G7 — сразу за ним (раньше кода M3, как требует §9), чтобы общая инфраструктура индекса (Tasks 22–23) строилась, только если пройдены одни из ворот.

### Task 18: Засев для ворот J-G6/J-G7 — доска и 30 спринтов, комментарии и вложения

**Model:** opus

**Files:**
- Create: `atlassian/tools/seed-jira-sprints.mjs`, `atlassian/tools/seed-jira-comments.mjs`

**Interfaces:**
- Consumes: `apps/query/scripts/lib/http.mjs` (Task 16: `api`, `ids`, `bulk`, `pool`, `sleep`, `UnsafeRetryError`).
- Produces: `atlassian/data/jg6-seed.json` = `{ board: { id, name }, sprints: [{ id, name, startedAt, closedAt, initial: [key], added: [{ key, at }], removed: [{ key, at }], readded: [{ key, at }], done: [key] }], big: { id, name, startedAt, closedAt, initial: [key], added: [{ key, at }], removed: [{ key, at }], done: [key] }, active: { id, name }, future: [{ id, name }] }` (`closedAt` — время в мс непосредственно перед запросом закрытия) — эталон «вручную» для J-G6 (30 спринтов `sprints`) и большой спринт `big` для полноты функций спринта на > 1 000 задач (P-3; в ворота J-G6 не входит); `atlassian/data/jg7-seed.json` = `{ comments: { before, after, restricted: { role, group } }, attachments: { added, byExt } }`.

- [ ] **Step 1: `seed-jira-sprints.mjs`.** Скрипт (возобновляемый: существующие спринты с тем же именем пропускаются, их записи читаются из `jg6-seed.json`):
  1. метка `jg-sprint` на задачах `project = JQLG AND labels = jg-task AND key >= JQLG-8000 AND key < JQLG-9000` (1 000 задач) и метка `jg-sprint-big` на задачах `project = JQLG AND labels = jg-task AND key >= JQLG-10000 AND key < JQLG-12200` (2 200 задач; если `jg-task` в диапазоне меньше — сдвинуть верхнюю границу, пока не наберётся 2 200); `PUT /rest/api/3/issue/{id}` с `update.labels.add`, 4 параллельно, пропуская уже помеченные;
  2. фильтр «JQLG board filter» (`project = JQLG AND labels in (jg-sprint, jg-sprint-big) ORDER BY Rank ASC`, `sharePermissions: [{ type: 'authenticated' }]`) и scrum-доска «JQLG board» (`POST /rest/agile/1.0/board { name, type: 'scrum', filterId, location: { type: 'project', projectKeyOrId: 'JQLG' } }`), если их нет;
  3. переход в Done: `GET /rest/api/3/issue/{key}/transitions`, первый переход, у которого `to.statusCategory.key === 'done'`;
  4. для s = 1…30 по очереди: создать спринт `JQLG S<s>` (`POST /rest/agile/1.0/sprint { name, originBoardId }`); положить 20 задач (`POST /rest/agile/1.0/sprint/{id}/issue { issues }`); запустить (`POST /rest/agile/1.0/sprint/{id} { state: 'active', startDate: now, endDate: now + 14 d }`); подождать 3 с; добавить 5 задач (время каждой — `added`); убрать 3 из начальных в бэклог (`POST /rest/agile/1.0/backlog/issue`, время — `removed`); вернуть 1 из убранных (`readded`); перевести 10 начальных в Done (`done`); закрыть (`state: 'closed'`); после закрытия прочитать поле Sprint у всех задач спринта и записать в лог, что Jira сделала с незавершёнными;
  5. большой спринт `JQLG SB` (только в полном прогоне, без `--limit`): создать; положить 1 100 задач `jg-sprint-big` (`initial`; Agile API принимает до 50 задач за запрос — пачками по 50); запустить; добавить остальные 1 100 задач `jg-sprint-big` (`added`); убрать в бэклог 1 050 из начальных (`removed`); перевести в Done все 1 100 добавленных (`done`); закрыть. Ожидаемо: `addedAfterSprintStart` — 1 100, `removedAfterSprintStart` — 1 050, `completeInSprint` — 1 100, `incompleteInSprint` — 50 (оставшиеся начальные);
  6. затем `JQLG S31` — активный с 20 задачами, `JQLG S32`, `JQLG S33` — будущие (для `nextSprint` и замера свежести);
  7. все запросы — через `api` из `apps/query/scripts/lib/http.mjs` (таймаут 30 с, повтор сетевых ошибок); POST, меняющие состав спринта, — с `{ unsafe: true }`: при `UnsafeRetryError` перечитать `GET /rest/agile/1.0/sprint/{id}/issue` и повторить только неприменённое.
  Сохранить `atlassian/data/jg6-seed.json` после каждого спринта.

- [ ] **Step 2: `seed-jira-comments.mjs`.**
  1. счёт комментариев на `project in (JQLG, RPT)`: `bulk(все id, ['comment'])` → сумма `comment.total`; записать `before`;
  2. роли и группы: `GET /rest/api/3/project/JQLG/role` → первая роль, кроме `atlassian-addons-project-access`; `GET /rest/api/3/groups/picker?maxResults=5` → первая группа;
  3. добавить комментарии на задачах `project = JQLG AND labels = jg-small ORDER BY key` (текст «seed comment N», без личных данных), пока сумма не станет ≥ 6 300: каждый 20-й — с `visibility: { type: 'role', value: <роль> }`, каждый 20-й со сдвигом 10 — `{ type: 'group', identifier: <группа> }`; 4 параллельно;
  4. 300 вложений на `JQLG-9000…JQLG-9299` (`POST /rest/api/3/issue/{key}/attachments`, multipart, заголовок `X-Atlassian-Token: no-check`), расширения по кругу `xlsx, pdf, png, txt, docx`, содержимое — несколько байт;
  5. сохранить `atlassian/data/jg7-seed.json`.

- [ ] **Step 3: Пробный запуск.** `node --check atlassian/tools/seed-jira-sprints.mjs atlassian/tools/seed-jira-comments.mjs`; `node atlassian/tools/seed-jira-sprints.mjs --limit 1` (один спринт) и `node atlassian/tools/seed-jira-comments.mjs --limit 5` → без ошибок, файлы `data/` содержат одну запись. Полный прогон — Task 20.

- [ ] **Step 4: Commit**

```bash
git add atlassian/tools/seed-jira-sprints.mjs atlassian/tools/seed-jira-comments.mjs
git commit -m "JQL-25: Add seeders for 30 sprints with known history and restricted comments and attachments

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 19: Прототип индекса для замера J-G6/J-G7

**Model:** opus

Прототип — замер, не продукт (как `j-g5-jqlfn`): своя регистрация, свои имена функций с префиксом, чтобы не конфликтовать с ArtUp Query на том же сайте.

**Files:**
- Create: `atlassian/tools/j-g67-index/{manifest.yml,package.json,src/index.js}`, `atlassian/tools/measure-jql-jg67.mjs`

**Interfaces:**
- Consumes: `jg6-seed.json`, `jg7-seed.json` (Task 18), `apps/query/scripts/lib/{http.mjs,latency.mjs,report.mjs}` (Task 16; `waitFor` — из общего `latency.mjs`, не копия), выводы Task 3 (имена событий, предел changelog).
- Produces: JQL-функции прототипа `g6AddedAfterSprintStart(board, sprint)`, `g7Commented(clauses)` (`by <accountId>`, `after <YYYY-MM-DD>`) и `g7HasAttachments(ext)` (вложения J-G7, P-2); webtrigger `g67-control` (`?action=start&part=sprint|comments`, `?action=progress`, `?action=reset`); `measure-jql-jg67.mjs --phase backfill|sprint-reference|sprint-latency|comment-latency|comment-complete|attachment-latency|attachment-complete [--part sprint|comments] [--url <webtrigger>] [--n 30]` → `atlassian/data/jg67-<phase>.json`.

- [ ] **Step 1: Манифест** `atlassian/tools/j-g67-index/manifest.yml`:

```yaml
modules:
  jira:jqlFunction:
    - key: g6-added-after-sprint-start
      name: g6AddedAfterSprintStart
      arguments:
        - name: board
          required: true
        - name: sprint
          required: true
      types:
        - issue
      operators:
        - in
        - not in
      function: fn-added
    - key: g7-commented
      name: g7Commented
      arguments:
        - name: clauses
          required: true
      types:
        - issue
      operators:
        - in
        - not in
      function: fn-commented
    - key: g7-has-attachments
      name: g7HasAttachments
      arguments:
        - name: ext
          required: true
      types:
        - issue
      operators:
        - in
        - not in
      function: fn-attachments
  trigger:
    - key: g67-events
      function: on-event
      events:
        - avi:jira:updated:issue
        - avi:jira-software:started:sprint
        - avi:jira-software:closed:sprint
        - avi:jira:commented:issue
        - avi:jira:created:attachment
  consumer:
    - key: g67-backfill-consumer
      queue: g67-backfill
      function: on-backfill
  webtrigger:
    - key: g67-control
      function: on-control
  sql:
    - key: main
      engine: mysql
  function:
    - key: fn-added
      handler: index.added
    - key: fn-commented
      handler: index.commented
    - key: fn-attachments
      handler: index.hasAttachments
    - key: on-event
      handler: index.onEvent
    - key: on-backfill
      handler: index.onBackfill
      timeoutSeconds: 300
    - key: on-control
      handler: index.onControl
permissions:
  scopes:
    - read:jira-work
    - read:jira-user
    - read:board-scope:jira-software
    - read:sprint:jira-software
    - read:app-data:jira
    - write:app-data:jira
    - storage:app
app:
  runtime:
    name: nodejs24.x
    memoryMB: 256
    architecture: arm64
  id: placeholder
```

Имена событий — по `apps/query/docs/live-checks.md` (Task 3). `package.json`: `@forge/api` 8.2.0, `@forge/kvs` 2.0.7, `@forge/events` 3.0.7, `@forge/sql` 4.0.7. Регистрация: `forge register -s 249db86b-0aa6-4b81-96ba-62341736ad15 --accept-terms "JG67 index probe"`.

- [ ] **Step 2: `src/index.js` прототипа**

```js
import api, { assumeTrustedRoute } from '@forge/api';
import { kvs } from '@forge/kvs';
import { Queue } from '@forge/events';
import { migrationRunner, sql } from '@forge/sql';

const queue = new Queue({ key: 'g67-backfill' });
const BUDGET_MS = 240000;
const SCOPE = 'project in (JQLG, RPT) ORDER BY id ASC';

async function jira(method, path, body) {
  for (let attempt = 1; attempt <= 6; attempt += 1) {
    const res = await api.asApp().requestJira(assumeTrustedRoute(path), { method, headers: { Accept: 'application/json', ...(body ? { 'Content-Type': 'application/json' } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
    if (res.status === 429 || res.status >= 500) {
      await new Promise((r) => setTimeout(r, Number(res.headers.get('retry-after')) * 1000 || 300 * 2 ** attempt));
      continue;
    }
    const raw = await res.text();
    if (!res.ok) throw Object.assign(new Error(`${method} ${path} ${res.status} ${raw.slice(0, 300)}`), { status: res.status });
    return raw ? JSON.parse(raw) : null;
  }
  throw new Error(`${method} ${path} gave up`);
}

async function migrate() {
  await migrationRunner
    .enqueue('v1_sprint_event', 'CREATE TABLE IF NOT EXISTS sprint_event (issue_id BIGINT NOT NULL, sprint_id BIGINT NOT NULL, kind CHAR(1) NOT NULL, at BIGINT NOT NULL, change_id BIGINT NOT NULL, PRIMARY KEY (change_id, issue_id, sprint_id, kind), INDEX idx_se_sprint (sprint_id, at))')
    .enqueue('v2_status_event', 'CREATE TABLE IF NOT EXISTS status_event (issue_id BIGINT NOT NULL, at BIGINT NOT NULL, to_cat VARCHAR(16) NOT NULL, change_id BIGINT NOT NULL, PRIMARY KEY (change_id, issue_id))')
    .enqueue('v3_comment_meta', 'CREATE TABLE IF NOT EXISTS comment_meta (comment_id BIGINT PRIMARY KEY, issue_id BIGINT NOT NULL, author VARCHAR(128) NOT NULL, created_at BIGINT NOT NULL, INDEX idx_cm_author (author, created_at))')
    .enqueue('v4_attachment_meta', 'CREATE TABLE IF NOT EXISTS attachment_meta (attachment_id BIGINT PRIMARY KEY, issue_id BIGINT NOT NULL, author VARCHAR(128) NOT NULL, created_at BIGINT NOT NULL, ext VARCHAR(32) NOT NULL)')
    .run();
}

async function insert(table, cols, rows) {
  for (let i = 0; i < rows.length; i += 500) {
    const part = rows.slice(i, i + 500);
    await sql.prepare(`INSERT IGNORE INTO ${table} (${cols.join(',')}) VALUES ${part.map(() => `(${cols.map(() => '?').join(',')})`).join(',')}`).bindParams(...part.flat()).execute();
  }
}

const ms = (v) => (typeof v === 'number' ? v : Date.parse(v));
const idSet = (v) => new Set(String(v ?? '').split(',').map((s) => s.trim()).filter((s) => /^\d+$/.test(s)));

async function sprintFieldId() {
  const cached = await kvs.get('sprintField');
  if (cached) return cached;
  const id = (await jira('GET', '/rest/api/3/field')).find((f) => f.schema?.custom === 'com.pyxis.greenhopper.jira:gh-sprint').id;
  await kvs.set('sprintField', id);
  return id;
}

async function categories() {
  return new Map((await jira('GET', '/rest/api/3/status')).map((s) => [String(s.id), s.statusCategory.key]));
}

function rowsFromHistories(issueId, histories, cats) {
  const sprintRows = [];
  const statusRows = [];
  for (const h of histories) {
    for (const item of h.items ?? []) {
      if (item.field === 'Sprint') {
        const from = idSet(item.from);
        const to = idSet(item.to);
        for (const s of to) if (!from.has(s)) sprintRows.push([issueId, s, 'a', ms(h.created), h.id]);
        for (const s of from) if (!to.has(s)) sprintRows.push([issueId, s, 'r', ms(h.created), h.id]);
      } else if (item.fieldId === 'status') statusRows.push([issueId, ms(h.created), cats.get(String(item.to)) ?? 'new', h.id]);
    }
  }
  return { sprintRows, statusRows };
}

async function indexChangelogs(ids) {
  const [field, cats] = [await sprintFieldId(), await categories()];
  let token;
  const sprintRows = [];
  const statusRows = [];
  do {
    const page = await jira('POST', '/rest/api/3/changelog/bulkfetch', { issueIdsOrKeys: ids, fieldIds: [field, 'status'], maxResults: 10000, ...(token ? { nextPageToken: token } : {}) });
    for (const log of page.issueChangeLogs ?? []) {
      const r = rowsFromHistories(log.issueId, log.changeHistories ?? [], cats);
      sprintRows.push(...r.sprintRows);
      statusRows.push(...r.statusRows);
    }
    token = page.nextPageToken;
  } while (token);
  await insert('sprint_event', ['issue_id', 'sprint_id', 'kind', 'at', 'change_id'], sprintRows);
  await insert('status_event', ['issue_id', 'at', 'to_cat', 'change_id'], statusRows);
}

const extOf = (name) => (String(name).includes('.') ? String(name).split('.').pop().toLowerCase().slice(0, 32) : '');

async function indexComments(ids) {
  const commentRows = [];
  const attachmentRows = [];
  const chunks = [];
  for (let i = 0; i < ids.length; i += 100) chunks.push(ids.slice(i, i + 100));
  await Promise.all(Array.from({ length: 8 }, async (_, w) => {
    for (let c = w; c < chunks.length; c += 8) {
      const page = await jira('POST', '/rest/api/3/issue/bulkfetch', { issueIdsOrKeys: chunks[c], fields: ['comment', 'attachment'] });
      for (const x of page.issues ?? []) {
        let comments = x.fields.comment?.comments ?? [];
        if ((x.fields.comment?.total ?? 0) > comments.length) comments = (await jira('GET', `/rest/api/3/issue/${x.id}/comment?maxResults=5000`)).comments;
        for (const cm of comments) commentRows.push([cm.id, x.id, cm.author?.accountId ?? '', ms(cm.created)]);
        for (const a of x.fields.attachment ?? []) attachmentRows.push([a.id, x.id, a.author?.accountId ?? '', ms(a.created), extOf(a.filename)]);
      }
    }
  }));
  await insert('comment_meta', ['comment_id', 'issue_id', 'author', 'created_at'], commentRows);
  await insert('attachment_meta', ['attachment_id', 'issue_id', 'author', 'created_at', 'ext'], attachmentRows);
}

export async function onBackfill(event) {
  const { part } = event.body;
  const progress = await kvs.get(`progress:${part}`);
  const deadline = Date.now() + BUDGET_MS;
  let { token, offset = 0 } = progress.cursor ?? {};
  for (;;) {
    const page = await jira('POST', '/rest/api/3/search/jql', { jql: SCOPE, fields: ['id'], maxResults: 5000, ...(token ? { nextPageToken: token } : {}) });
    const ids = page.issues.map((x) => x.id);
    while (offset < ids.length) {
      if (Date.now() > deadline) {
        await kvs.set(`progress:${part}`, { ...progress, cursor: { token, offset } });
        await queue.push({ body: { part } });
        return;
      }
      const slice = ids.slice(offset, offset + 1000);
      if (part === 'sprint') await indexChangelogs(slice);
      else await indexComments(slice);
      offset += slice.length;
      progress.done += slice.length;
      await kvs.set(`progress:${part}`, { ...progress, cursor: { token, offset } });
    }
    if (!page.nextPageToken) break;
    token = page.nextPageToken;
    offset = 0;
  }
  await kvs.set(`progress:${part}`, { ...progress, cursor: null, finishedAt: Date.now() });
}

async function boardSprint(boardName, sprintName) {
  const board = (await jira('GET', `/rest/agile/1.0/board?name=${encodeURIComponent(boardName)}`)).values.find((b) => b.name === boardName);
  const sprints = [];
  for (let startAt = 0; ; startAt += 50) {
    const page = await jira('GET', `/rest/agile/1.0/board/${board.id}/sprint?startAt=${startAt}&maxResults=50`);
    sprints.push(...page.values);
    if (page.isLast) break;
  }
  return sprints.find((s) => s.name === sprintName);
}

const list = (rows) => (rows.length ? `id in (${rows.map((r) => r.issue_id).join(',')})` : 'id = -1');

async function addedValue([board, sprint]) {
  const s = await boardSprint(board, sprint);
  if (!s) return { error: `Sprint "${sprint}" not found` };
  const start = ms(s.activatedDate ?? s.startDate);
  const end = s.completeDate ? ms(s.completeDate) : Number.MAX_SAFE_INTEGER;
  const rows = (await sql.prepare("SELECT DISTINCT issue_id FROM sprint_event WHERE sprint_id = ? AND kind = 'a' AND at > ? AND at <= ?").bindParams(s.id, start, end).execute()).rows;
  return rows.length > 1000 ? { error: `${rows.length} values` } : { jql: list(rows) };
}

async function commentedValue([clauses]) {
  const by = /\bby\s+(\S+)/.exec(clauses)?.[1] ?? '';
  const after = Date.parse(/\bafter\s+(\d{4}-\d{2}-\d{2})/.exec(clauses)?.[1] ?? '1970-01-01');
  const rows = (await sql.prepare('SELECT DISTINCT issue_id FROM comment_meta WHERE author = ? AND created_at > ?').bindParams(by, after).execute()).rows;
  return rows.length > 1000 ? { error: `${rows.length} values` } : { jql: list(rows) };
}

async function attachmentsValue([ext]) {
  const rows = (await sql.prepare('SELECT DISTINCT issue_id FROM attachment_meta WHERE ext = ?').bindParams(String(ext).replace(/^\.+/, '').toLowerCase()).execute()).rows;
  return rows.length > 1000 ? { error: `${rows.length} values` } : { jql: list(rows) };
}

const VALUE = { g6AddedAfterSprintStart: addedValue, g7Commented: commentedValue, g7HasAttachments: attachmentsValue };

async function evaluate(name, args) {
  try {
    return await VALUE[name](args);
  } catch (e) {
    return { error: String(e.message).slice(0, 200) };
  }
}

export const added = async (payload) => {
  const r = await evaluate('g6AddedAfterSprintStart', payload.clause.arguments);
  return r.error ? { error: r.error, storeErrorAsPrecomputation: false } : r;
};
export const commented = async (payload) => {
  const r = await evaluate('g7Commented', payload.clause.arguments);
  return r.error ? { error: r.error, storeErrorAsPrecomputation: false } : r;
};
export const hasAttachments = async (payload) => {
  const r = await evaluate('g7HasAttachments', payload.clause.arguments);
  return r.error ? { error: r.error, storeErrorAsPrecomputation: false } : r;
};

async function recomputeAll() {
  const pcs = [];
  for (let startAt = 0; ; startAt += 100) {
    const page = await jira('GET', `/rest/api/3/jql/function/computation?startAt=${startAt}&maxResults=100`);
    pcs.push(...page.values);
    if (page.isLast || !page.values.length) break;
  }
  const updates = [];
  for (const pc of pcs) {
    const r = await evaluate(pc.functionName, pc.arguments);
    if ((r.jql ?? null) !== (pc.value ?? null)) updates.push(r.error ? { id: pc.id, error: r.error } : { id: pc.id, value: r.jql });
  }
  for (let i = 0; i < updates.length; i += 50) await jira('POST', '/rest/api/3/jql/function/computation?skipNotFoundPrecomputations=true', { values: updates.slice(i, i + 50) });
}

export async function onEvent(event) {
  const type = event.eventType;
  if (type === 'avi:jira:updated:issue' && event.changelog) {
    const r = rowsFromHistories(event.issue.id, [{ id: event.changelog.id, created: event.timestamp ?? Date.now(), items: event.changelog.items }], await categories());
    await insert('sprint_event', ['issue_id', 'sprint_id', 'kind', 'at', 'change_id'], r.sprintRows);
    await insert('status_event', ['issue_id', 'at', 'to_cat', 'change_id'], r.statusRows);
  }
  if (type === 'avi:jira:commented:issue' && event.comment) await insert('comment_meta', ['comment_id', 'issue_id', 'author', 'created_at'], [[event.comment.id, event.issue.id, event.comment.author?.accountId ?? '', ms(event.comment.created)]]);
  if (type === 'avi:jira:created:attachment' && event.attachment) await insert('attachment_meta', ['attachment_id', 'issue_id', 'author', 'created_at', 'ext'], [[event.attachment.id, event.attachment.issueId, event.attachment.author?.accountId ?? '', ms(event.attachment.created), extOf(event.attachment.filename)]]);
  await recomputeAll();
  console.log(JSON.stringify({ g67: 'event', type, lagMs: event.timestamp ? Date.now() - Number(event.timestamp) : null }));
}

const reply = (body) => ({ statusCode: 200, headers: { 'Content-Type': ['application/json'] }, body: JSON.stringify(body) });

export async function onControl(request) {
  const action = request.queryParameters?.action?.[0];
  const part = request.queryParameters?.part?.[0];
  await migrate();
  if (action === 'start') {
    const total = (await jira('POST', '/rest/api/3/search/approximate-count', { jql: SCOPE.replace(' ORDER BY id ASC', '') })).count;
    await kvs.set(`progress:${part}`, { part, done: 0, total, startedAt: Date.now(), cursor: null });
    await queue.push({ body: { part } });
    return reply({ started: part, total });
  }
  if (action === 'reset') {
    for (const t of ['sprint_event', 'status_event', 'comment_meta', 'attachment_meta']) await sql.prepare(`DELETE FROM ${t}`).execute();
    return reply({ reset: true });
  }
  return reply({ sprint: await kvs.get('progress:sprint'), comments: await kvs.get('progress:comments') });
}
```

Прототип индексирует `sprint`-часть одним проходом changelog и `comments`-часть (комментарии и вложения) одним проходом bulkfetch — время каждой части меряется отдельно (две строки ворот).

- [ ] **Step 3: `atlassian/tools/measure-jql-jg67.mjs`** — фазы (`api`, `ids`, `bulk`, `pool`, `sleep`, `stats` — из `apps/query/scripts/lib/http.mjs`; `waitFor` — из `apps/query/scripts/lib/latency.mjs`; `summary`, `compare` — из `report.mjs`; результат — `atlassian/data/jg67-<phase>.json`):
  - `backfill --part sprint|comments --url <URL webtrigger>`: `GET <url>?action=start&part=<part>`; каждые 30 с `GET <url>?action=progress` до `finishedAt`; итог: минуты, `done`, `total`.
  - `sprint-reference`: для 30 закрытых спринтов из `jg6-seed.json`: результат `issue in g6AddedAfterSprintStart("JQLG board", "<имя>")`; эталон A — ключи `added` + `readded` из `jg6-seed.json` (то, что засев сделал после старта); эталон B — по REST: для задач спринта и задач из `removed` — `GET /rest/api/3/issue/{key}/changelog` (все страницы), события поля `Sprint` с добавлением id спринта после `activatedDate ?? startDate` и не позже `completeDate`; `compare` с обоими. Вердикт ворот — 30 из 30 `complete` против эталона B (§9: «эталон, восстановленный из changelog»); сравнение A с B — проверка сеялки, не часть ворот (P-1): расхождение A и B печатается отдельной строкой `seeder-check` и означает починку засева или инструмента и повтор замера.
  - `sprint-latency --n 30`: активный `JQLG S31`; n раз: взять задачу `labels = jg-sprint AND sprint is EMPTY`, `POST /rest/agile/1.0/sprint/{id}/issue` (`unsafe: true`, при `UnsafeRetryError` — проверить состав и не повторять применённое), затем каждые 2 с `issue in g6AddedAfterSprintStart("JQLG board", "JQLG S31") AND id = X` до появления (таймаут 10 мин) → секунды; `summary`.
  - `comment-latency --n 30`: n раз комментарий «probe N» к задаче `JQLG` из `labels = jg-mid`, затем `waitFor('issue in g7Commented("by <accountId из /myself> after <сегодня UTC>")', X, true, t)`; `summary`.
  - `comment-complete`: результат `g7Commented("by <accountId> after 2020-01-01")` против эталона — `bulk(все id project in (JQLG, RPT), ['comment'])` (+ догрузка `GET …/comment`, где `total > comments.length`), задачи с комментарием этого автора; `compare`.
  - `attachment-latency --n 30` (P-2): n раз вложение `probe-<N>.jg7` (multipart, `X-Atlassian-Token: no-check`) к i-й задаче из `project = JQLG AND labels = jg-mid ORDER BY key`, у которой ещё нет вложения `.jg7` (проверка по `bulk(…, ['attachment'])` до прогона), затем `waitFor('issue in g7HasAttachments("jg7")', X, true, t)`; `summary`.
  - `attachment-complete` (P-2): для каждого расширения `xlsx`, `pdf`, `png`, `txt`, `docx` — результат `g7HasAttachments("<ext>")` против эталона `bulk(все id project in (JQLG, RPT), ['attachment'])` (задачи с вложением, имя которого оканчивается на `.<ext>`); `compare`; итог — `complete` у всех пяти.

- [ ] **Step 4: Деплой и проверка.**

```bash
set -a && . /Users/artyomkarpets/IncomeApps/projects/DistributB2B/.env && set +a
cd atlassian/tools/j-g67-index && npm install && forge register -s 249db86b-0aa6-4b81-96ba-62341736ad15 --accept-terms "JG67 index probe"
forge deploy -e development --non-interactive
perl -e 'alarm 300; exec @ARGV' forge install -e development --site artuplabs-dev.atlassian.net --product jira --non-interactive
forge webtrigger -e development --site artuplabs-dev.atlassian.net --product jira
```

`node --check atlassian/tools/measure-jql-jg67.mjs`; `GET <url>?action=progress` → JSON с `sprint: null, comments: null`; в редакторе JQL сайта подсказка показывает `g6AddedAfterSprintStart`, `g7Commented`, `g7HasAttachments`.

- [ ] **Step 5: Commit**

```bash
git add atlassian/tools/j-g67-index atlassian/tools/measure-jql-jg67.mjs
git commit -m "JQL-26: Add the index probe and the measurement tool for gates J-G6 and J-G7

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 20: Ворота J-G6 — замер и вердикт (до кода M2)

**Model:** sonnet

**Files:**
- Modify: `atlassian/25_app5_jql.md` (§11, строка J-G6), `atlassian/plans/2026-10-03-artup-query-v1-rulings.md`

**Interfaces:**
- Consumes: Tasks 18, 19.
- Produces: вердикт J-G6 «пройдено / не пройдено» с числами. После этой задачи **всегда** идёт Task 21 (замер J-G7) — при любом исходе J-G6. Не пройдено → Task 24 (функции истории спринтов) не исполняется, `sprint` не входит в `SHIPPED_GROUPS`, справочник и листинг без истории спринтов; `previousSprint`/`nextSprint` остаются (Q-R9). Tasks 22–23 (ядро истории и инфраструктура индекса) исполняются, если пройден J-G6 **или** J-G7.

Ворота (спецификация §9, дословно, записаны до замера): **«J-G6: заполнение индекса (узлы, связи, changelog Sprint+status через `POST /rest/api/3/changelog/bulkfetch`) на 50 000 задач ≤ 60 мин; событие → функция спринта p90 ≤ 60 с; `addedAfterSprintStart` на 30 спринтах совпадает с эталоном, восстановленным из changelog вручную, на 100%. Не прошло — группа уходит в v1.1 (Ruling), остальное идёт»**. По Q-R9 узлы и связи не индексируются — меряется то, что строится (changelog Sprint+status); порог тот же.

- [ ] **Step 1: Засев.**

```bash
set -a && . /Users/artyomkarpets/IncomeApps/projects/DistributB2B/.env && set +a
node atlassian/tools/seed-jira-sprints.mjs
node atlassian/tools/seed-jira-comments.mjs
```

Expected: в `jg6-seed.json` 30 закрытых спринтов, S31 активный, S32–S33 будущие; в `jg7-seed.json` `after ≥ 6 300` комментариев и 300 вложений.

- [ ] **Step 2: Заполнение индекса спринтов.** `node atlassian/tools/measure-jql-jg67.mjs --phase backfill --part sprint --url <URL>` → минуты. Порог ≤ 60.

- [ ] **Step 3: Полнота на 30 спринтах.** `node atlassian/tools/measure-jql-jg67.mjs --phase sprint-reference` → 30 строк; порог — 30 из 30 `complete` против эталона B (changelog по REST). Строка `seeder-check` (A ≠ B) — не вердикт ворот (P-1): починить засев (`seed-jira-sprints.mjs`) или инструмент, повторить Step 1–3; записать, что чинилось.

- [ ] **Step 4: Свежесть.** `node atlassian/tools/measure-jql-jg67.mjs --phase sprint-latency --n 30` → p90. Порог ≤ 60 с.

- [ ] **Step 5: Вердикт.** Строка в §11 брифа: `| J-G6 | заполнение changelog Sprint+status на <N> задачах — <M> мин; полнота addedAfterSprintStart <k>/30 против эталона changelog (проверка засева: A = B / чинилось: …); свежесть p50 … p90 … max … с; потерь … | <дата> | пройдено / не пройдено |`.
  - В любом случае дальше — Task 21 (ворота J-G7); после неё — по итогам обоих ворот (граф в конце плана).
  - Не пройдено (любая из трёх частей) → строка rulings: `| Q-Rn | J-G6 не пройден (<какая часть, числа>): функции addedAfterSprintStart, removedAfterSprintStart, incompleteInSprint, completeInSprint — в v1.1; previousSprint/nextSprint остаются (Q-R9) | ворота §9, Q-R1 |`; Task 24 пропустить; Tasks 22–23 — только если J-G7 пройден (Task 21); в Task 30, 31 и 32 случаи и фазы группы `sprint` не запускать.

- [ ] **Step 6: Commit**

```bash
git add atlassian/25_app5_jql.md atlassian/plans/2026-10-03-artup-query-v1-rulings.md
git commit -m "JQL-27: Record the J-G6 gate measurement for sprint history

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 21: Ворота J-G7 — замер и вердикт (до кода M3)

**Model:** sonnet

**Files:**
- Modify: `atlassian/25_app5_jql.md` (§11, строка J-G7), `atlassian/plans/2026-10-03-artup-query-v1-rulings.md`

**Interfaces:**
- Consumes: прототип и инструмент Task 19, засев Task 20 Step 1.
- Исполняется всегда, при любом исходе J-G6 (Task 20).
- Produces: вердикт J-G7 отдельно для комментариев и для вложений (P-2). Не пройдены оба → по Q-R11 Tasks 25 и 27 не исполняются, `comment` и `attachment` не входят в `SHIPPED_GROUPS`; Tasks 26 и 28 (`dateCompare`, `expression`) исполняются без псевдополей `firstCommented`/`lastCommented`. Не пройдены только вложения → в v1.1 уходят только `fileAttached` и `hasAttachments(ext)` (`attachment` не входит в `SHIPPED_GROUPS`), Tasks 25 и 27 исполняются для `comment`. Не пройдены только комментарии → в v1.1 уходят `commented`, `lastComment`, `hasComments` и псевдополя, Tasks 25 и 27 исполняются для `attachment`. Если не пройдены и J-G6, и J-G7 целиком — Tasks 22–23 тоже не исполняются (Task 24 зависит только от J-G6).

Ворота (спецификация §9, дословно, записаны до замера): **«J-G7: заполнение метаданных комментариев и вложений на 50 000 задач (6 000+ комментариев) ≤ 60 мин; p90 ≤ 60 с; полнота 100%. Не прошло — группа в v1.1»**.

- [ ] **Step 1: Заполнение.** `node atlassian/tools/measure-jql-jg67.mjs --phase backfill --part comments --url <URL>` → минуты (порог ≤ 60); число комментариев в индексе ≥ 6 000 (сверить с `jg7-seed.json`).

- [ ] **Step 2: Свежесть.** Две строки: `node atlassian/tools/measure-jql-jg67.mjs --phase comment-latency --n 30` → p90 комментариев; `node atlassian/tools/measure-jql-jg67.mjs --phase attachment-latency --n 30` → p90 вложений (порог каждой ≤ 60 с, без потерь за 10 мин).

- [ ] **Step 3: Полнота.** Две строки: `node atlassian/tools/measure-jql-jg67.mjs --phase comment-complete` → `complete: true`; `node atlassian/tools/measure-jql-jg67.mjs --phase attachment-complete` → `complete: true` у всех пяти расширений (порог каждой 100%).

- [ ] **Step 4: Снять прототип с сайта.**

```bash
set -a && . /Users/artyomkarpets/IncomeApps/projects/DistributB2B/.env && set +a
cd atlassian/tools/j-g67-index && forge uninstall -e development --site artuplabs-dev.atlassian.net --product jira --non-interactive
```

- [ ] **Step 5: Вердикт.** Строка §11 брифа: `| J-G7 | заполнение комментариев и вложений: <N> задач, <C> комментариев, <A> вложений — <M> мин; свежесть комментариев p50 … p90 … max … с, вложений p50 … p90 … max … с; полнота комментариев <x>%, вложений <y>% | <дата> | комментарии: пройдено / не пройдено; вложения: пройдено / не пройдено |`. Заполнение (Step 1) общее: не прошло оно — не пройдены обе части.
  - Не пройдены обе → строка rulings `| Q-Rn | J-G7 не пройден (<часть, числа>): commented, lastComment, hasComments, fileAttached, hasAttachments(ext) — в v1.1; dateCompare и expression остаются без firstCommented/lastCommented (Q-R11) | ворота §9, Q-R1 |`, Tasks 25 и 27 пропустить.
  - Не пройдены только вложения → строка rulings `| Q-Rn | J-G7 по вложениям не пройден (<числа>): fileAttached, hasAttachments(ext) — в v1.1; функции комментариев отгружаются (P-2, Q-R11) | ворота §9, Q-R1 |`; Tasks 25 и 27 исполняются, в Task 27 `SHIPPED_GROUPS` += только `'comment'`.
  - Не пройдены только комментарии → строка rulings `| Q-Rn | J-G7 по комментариям не пройден (<числа>): commented, lastComment, hasComments и псевдополя firstCommented/lastCommented — в v1.1; функции вложений отгружаются (Q-R11) | ворота §9, Q-R1 |`; Tasks 25 и 27 исполняются, в Task 27 `SHIPPED_GROUPS` += только `'attachment'`.
  - Дальше — Tasks 22–23, если пройден J-G6 или хотя бы одна часть J-G7; иначе — Task 26 (граф в конце плана).

- [ ] **Step 6: Commit**

```bash
git add atlassian/25_app5_jql.md atlassian/plans/2026-10-03-artup-query-v1-rulings.md
git commit -m "JQL-28: Record the J-G7 gate measurement for comment and attachment metadata

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 22: История спринтов — чистые функции

**Model:** opus

Исполняется, если пройден J-G6 (Task 20) или J-G7 (Task 21): ядро истории нужно части индекса `sprint`, а инфраструктура Task 23 общая для обеих частей.

**Files:**
- Create: `apps/query/src/core/sprint-history.js`
- Modify: `apps/query/test/fixtures/changelog-bulkfetch.json` (перезапись на засеянных задачах спринта)
- Test: `apps/query/test/core/sprint-history.test.js`

**Interfaces:**
- Consumes: команда `changelog` скрипта `scripts/live-checks.mjs` с флагами `--keys/--roles/--sprint/--closed-at` (Task 3); `atlassian/data/jg6-seed.json` (засев Task 20 Step 1); `Window = { startAt, completeAt }` из `sprintWindow` (Task 8); `byNumber`, `sortIds` (Task 7).
- Produces: `toMs(value) → number|null` (понимает `+0000`); `sprintIdsOf(value) → Set<string>`; `sprintEvents(issueId, histories, sprintFieldIds: Set) → SprintEvent[]`, `SprintEvent = { issueId, sprintId, kind: 'added'|'removed', at, changeId }`; `statusEvents(issueId, histories, categoryOf: Map) → StatusEvent[]`, `StatusEvent = { issueId, at, from, to, changeId }`; `addedAfterStart(events, sprintId, window) → string[]`; `removedAfterStart(events, sprintId, window) → string[]`; `membersAt(currentIds, events, sprintId, t) → Set<string>`; `categoryAt(changes, t, current) → string`; `sprintOutcome({ sprintId, window, now, currentIds, events, statusByIssue: Map, currentCategory: Map }) → { complete: string[], incomplete: string[] }`.

- [ ] **Step 1: Перезаписать фикстуру changelog.** Фикстура Task 3 (JQLG-1…3) записана до засева спринтов и изменений поля Sprint не содержит — тест на ней ничего бы не проверял. Из `atlassian/data/jg6-seed.json` взять спринт `JQLG S1` (`sprints[0]`): `R` — ключ из `readded` (добавлен до старта, убран, возвращён), `X` — ключ из `removed`, которого нет в `readded` (добавлен до старта, убран), `A` — ключ из `added` (добавлен после старта); затем из корня репозитория:

```bash
set -a && . /Users/artyomkarpets/IncomeApps/projects/DistributB2B/.env && set +a
node apps/query/scripts/live-checks.mjs changelog --keys R,X,A --roles readded,removed,added --sprint <sprints[0].id> --closed-at <sprints[0].closedAt>
```

(вместо `R,X,A` — три ключа). Файл `test/fixtures/changelog-bulkfetch.json` содержит `sprintFieldId`, `sprintId`, `closedAt`, `roles` и `issueChangeLogs` трёх задач, без текстов.

- [ ] **Step 2: Падающие тесты** `test/core/sprint-history.test.js`:

```js
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { addedAfterStart, categoryAt, membersAt, removedAfterStart, sprintEvents, sprintIdsOf, sprintOutcome, statusEvents, toMs } from '../../src/core/sprint-history.js';

const FIELDS = new Set(['customfield_10020']);
const ev = (issueId, sprintId, kind, at, changeId = at) => ({ issueId, sprintId, kind, at, changeId: String(changeId) });
const W = { startAt: 100, completeAt: 200 };

describe('changelog parsing', () => {
  it('reads Jira times with a +0000 offset, ISO times and numbers', () => {
    expect([toMs('2026-01-01T10:00:00.000+0000'), toMs('2026-01-01T10:00:00Z'), toMs(5), toMs(undefined)]).toEqual([Date.UTC(2026, 0, 1, 10), Date.UTC(2026, 0, 1, 10), 5, null]);
  });
  it('splits sprint values', () => {
    expect(sprintIdsOf(' 12, 13 ,x')).toEqual(new Set(['12', '13']));
    expect(sprintIdsOf(null)).toEqual(new Set());
  });
  it('turns Sprint field changes into added and removed events', () => {
    const histories = [
      { id: '1', created: 10, items: [{ field: 'Sprint', fieldId: 'customfield_10020', from: '', to: '5' }] },
      { id: '2', created: 20, items: [{ field: 'Sprint', fieldId: 'customfield_10020', from: '5', to: '5, 6' }, { field: 'summary', from: 'a', to: 'b' }] },
      { id: '3', created: 30, items: [{ field: 'Sprint', fieldId: 'customfield_10020', from: '5, 6', to: '6' }] },
    ];
    expect(sprintEvents(7, histories, FIELDS)).toEqual([ev('7', '5', 'added', 10, 1), ev('7', '6', 'added', 20, 2), ev('7', '5', 'removed', 30, 3)]);
  });
  it('keeps only status changes that move between categories', () => {
    const cats = new Map([['1', 'new'], ['3', 'indeterminate'], ['4', 'indeterminate'], ['10001', 'done']]);
    const histories = [
      { id: '1', created: 10, items: [{ field: 'status', fieldId: 'status', from: '1', to: '3' }] },
      { id: '2', created: 20, items: [{ field: 'status', fieldId: 'status', from: '3', to: '4' }] },
      { id: '3', created: 30, items: [{ field: 'status', fieldId: 'status', from: '4', to: '10001' }] },
    ];
    expect(statusEvents('7', histories, cats)).toEqual([
      { issueId: '7', at: 10, from: 'new', to: 'indeterminate', changeId: '1' },
      { issueId: '7', at: 30, from: 'indeterminate', to: 'done', changeId: '3' },
    ]);
  });
  it('reads the seeded sprint history from a recorded bulkfetch answer', () => {
    const answer = JSON.parse(readFileSync(new URL('../fixtures/changelog-bulkfetch.json', import.meta.url), 'utf8'));
    const kindsOf = (log) => sprintEvents(log.issueId, log.changeHistories, new Set([answer.sprintFieldId]))
      .filter((e) => e.sprintId === String(answer.sprintId) && e.at < answer.closedAt)
      .sort((a, b) => a.at - b.at)
      .map((e) => e.kind);
    const byRole = Object.fromEntries(answer.issueChangeLogs.map((log) => [answer.roles[log.issueId], kindsOf(log)]));
    expect(byRole).toEqual({ readded: ['added', 'removed', 'added'], removed: ['added', 'removed'], added: ['added'] });
  });
});

describe('added and removed after the start', () => {
  const events = [ev('1', '9', 'added', 50), ev('2', '9', 'added', 150), ev('2', '9', 'removed', 160), ev('3', '9', 'added', 250), ev('4', '8', 'added', 150)];
  it('counts additions inside the sprint window, even if removed later', () => {
    expect(addedAfterStart(events, 9, W)).toEqual(['2']);
  });
  it('counts removals not undone before the close', () => {
    const r = [ev('1', '9', 'removed', 150), ev('1', '9', 'added', 170), ev('2', '9', 'removed', 150), ev('3', '9', 'removed', 250)];
    expect(removedAfterStart(r, '9', W)).toEqual(['2']);
  });
  it('uses now as the end of a running sprint', () => {
    expect(removedAfterStart([ev('5', '9', 'removed', 150)], '9', { startAt: 100, completeAt: null })).toEqual(['5']);
  });
  it('has nothing before the sprint started', () => {
    expect(addedAfterStart(events, '9', { startAt: null, completeAt: null })).toEqual([]);
  });
});

describe('membership and categories at a time', () => {
  it('undoes the events after t', () => {
    const events = [ev('2', '9', 'added', 150), ev('4', '9', 'removed', 160)];
    expect(membersAt(['1', '2'], events, '9', 100)).toEqual(new Set(['1', '4']));
  });
  it('reads the category in force at t', () => {
    const changes = [{ at: 200, from: 'indeterminate', to: 'done', changeId: '2' }, { at: 100, from: 'new', to: 'indeterminate', changeId: '1' }];
    expect([categoryAt(changes, 50, 'done'), categoryAt(changes, 150, 'done'), categoryAt(changes, 250, 'new'), categoryAt([], 1, 'done')]).toEqual(['new', 'indeterminate', 'done', 'done']);
  });
  it('splits the members at the close into done and not done', () => {
    const events = [ev('3', '9', 'removed', 210)];
    const statusByIssue = new Map([['1', [{ at: 150, from: 'indeterminate', to: 'done', changeId: '1' }]], ['2', [{ at: 250, from: 'indeterminate', to: 'done', changeId: '2' }]]]);
    const currentCategory = new Map([['1', 'done'], ['2', 'done'], ['3', 'new']]);
    expect(sprintOutcome({ sprintId: '9', window: W, now: 999, currentIds: ['1', '2'], events, statusByIssue, currentCategory })).toEqual({ complete: ['1'], incomplete: ['2', '3'] });
  });
});
```

- [ ] **Step 3: Run** `npx vitest run test/core/sprint-history.test.js` → FAIL.

- [ ] **Step 4: `src/core/sprint-history.js`**

```js
import { sortIds } from './ids.js';

const NUMERIC = /^\d+$/;
const byTime = (a, b) => a.at - b.at || Number(a.changeId) - Number(b.changeId);

/** Epoch ms from a number, an ISO string or Jira's `+0000` form; null when absent. */
export function toMs(value) {
  if (typeof value === 'number') return value;
  const t = Date.parse(String(value ?? '').replace(/([+-]\d{2})(\d{2})$/, '$1:$2'));
  return Number.isFinite(t) ? t : null;
}

/** Sprint ids of a changelog value such as "12, 13". */
export function sprintIdsOf(value) {
  return new Set(String(value ?? '').split(',').map((s) => s.trim()).filter((s) => NUMERIC.test(s)));
}

/** Added and removed events of one issue from its Sprint field changes. */
export function sprintEvents(issueId, histories, sprintFieldIds) {
  const out = [];
  for (const h of histories ?? []) {
    const at = toMs(h.created);
    for (const item of h.items ?? []) {
      if (!(sprintFieldIds.has(item.fieldId) || item.field === 'Sprint')) continue;
      const from = sprintIdsOf(item.from);
      const to = sprintIdsOf(item.to);
      for (const s of to) if (!from.has(s)) out.push({ issueId: String(issueId), sprintId: s, kind: 'added', at, changeId: String(h.id) });
      for (const s of from) if (!to.has(s)) out.push({ issueId: String(issueId), sprintId: s, kind: 'removed', at, changeId: String(h.id) });
    }
  }
  return out;
}

/** Status changes of one issue that move it between categories (new, indeterminate, done). */
export function statusEvents(issueId, histories, categoryOf) {
  const out = [];
  for (const h of histories ?? []) {
    for (const item of h.items ?? []) {
      if (item.fieldId !== 'status' && item.field !== 'status') continue;
      const from = categoryOf.get(String(item.from)) ?? 'new';
      const to = categoryOf.get(String(item.to)) ?? 'new';
      if (from !== to) out.push({ issueId: String(issueId), at: toMs(h.created), from, to, changeId: String(h.id) });
    }
  }
  return out;
}

const inWindow = (at, { startAt, completeAt }) => startAt !== null && at > startAt && (completeAt === null || at <= completeAt);

/** Issues added to the sprint after it started and up to its close, even if removed later. */
export function addedAfterStart(events, sprintId, window) {
  return sortIds(events.filter((e) => e.sprintId === String(sprintId) && e.kind === 'added' && inWindow(e.at, window)).map((e) => e.issueId));
}

/** Issues removed after the start and not back in the sprint at its close (or now, while it runs). */
export function removedAfterStart(events, sprintId, window) {
  const mine = events.filter((e) => e.sprintId === String(sprintId)).sort(byTime);
  const removed = new Set(mine.filter((e) => e.kind === 'removed' && inWindow(e.at, window)).map((e) => e.issueId));
  const out = [];
  for (const id of removed) {
    const last = mine.filter((e) => e.issueId === id && (window.completeAt === null || e.at <= window.completeAt)).at(-1);
    if (last?.kind === 'removed') out.push(id);
  }
  return sortIds(out);
}

/** Members of a sprint at time t: today's members with every later event undone. */
export function membersAt(currentIds, events, sprintId, t) {
  const members = new Set(currentIds.map(String));
  const later = events.filter((e) => e.sprintId === String(sprintId) && e.at > t).sort(byTime).reverse();
  for (const e of later) {
    if (e.kind === 'added') members.delete(e.issueId);
    else members.add(e.issueId);
  }
  return members;
}

/** Status category in force at time t, from category changes and today's category. */
export function categoryAt(changes, t, current) {
  const sorted = [...changes].sort(byTime);
  const before = sorted.filter((c) => c.at <= t);
  if (before.length) return before.at(-1).to;
  if (sorted.length) return sorted[0].from;
  return current;
}

/** Members at the close (or now, while running) split by whether their category was done then. */
export function sprintOutcome({ sprintId, window, now, currentIds, events, statusByIssue, currentCategory }) {
  const t = window.completeAt ?? now;
  const complete = [];
  const incomplete = [];
  for (const id of membersAt(currentIds, events, sprintId, t)) {
    const category = categoryAt(statusByIssue.get(id) ?? [], t, currentCategory.get(id) ?? 'new');
    if (category === 'done') complete.push(id);
    else incomplete.push(id);
  }
  return { complete: sortIds(complete), incomplete: sortIds(incomplete) };
}
```

Смысл «убраны» (не возвращены до закрытия) и «добавлены» (даже если потом убраны) — по Task 1; если сверка с ScriptRunner записала другой смысл, поправить тест и функцию по Ruling.

- [ ] **Step 5: Run** `npx vitest run test/core` → PASS; `npm run coverage` → PASS (порог ветвлений `src/core/**`); `npm run lint` → 0 ошибок.

- [ ] **Step 6: Commit**

```bash
git add apps/query/src/core/sprint-history.js apps/query/test/core/sprint-history.test.js apps/query/test/fixtures/changelog-bulkfetch.json
git commit -m "JQL-29: Derive sprint additions, removals and outcomes from changelog events

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 23: Индекс в Forge SQL — миграции, строки, первичное заполнение, запись по событиям

**Model:** opus

Исполняется, если пройден J-G6 или J-G7. Если J-G6 не пройден, часть `sprint` остаётся в коде, но не входит в `shippedParts()` (её группа не отгружена).

**Files:**
- Create: `apps/query/src/infra/{schema.js,indexRepo.js}`, `apps/query/src/handlers/{backfill.js,indexing.js,lifecycle.js}`
- Modify: `apps/query/src/core/limits.js` (`SQL_IN_CHUNK`, `SPRINT_FIELDS_TTL_MS`, `RECONCILE_RECENT_MAX`), `apps/query/src/infra/jira.js` (`searchPage`, `projects`), `apps/query/src/infra/state.js` (`sprintFields`), `apps/query/src/deps.js`, `apps/query/src/index.js`, `apps/query/manifest.yml`
- Test: `apps/query/test/infra/{schema.test.js,indexRepo.test.js,jira.test.js}`, `apps/query/test/handlers/{backfill.test.js,indexing.test.js,lifecycle.test.js}`

**Interfaces:**
- Consumes: `sprintEvents`, `statusEvents` (Task 22), `sprintWindow` (Task 8), `indexPartOf` (Task 13), `SHIPPED_GROUPS`, `CHANGELOG_BATCH`, `WORKER_BUDGET_MS`; новые пределы этой задачи — в `limits.js`.
- Produces:
  - `Jira.searchPage(jql, nextPageToken|null) → { ids: string[], nextPageToken: string|null }`, `Jira.projects() → [{ id, key }]`.
  - `state.sprintFields: { get(), set(v), clear() }` — `{ ids: string[], at }`.
  - `runMigrations()` — таблицы `sprint`, `sprint_event`, `status_event`.
  - `createIndexRepo(run = execute) → { upsertSprints(rows), deleteSprint(id), addSprintEvents(events), addStatusEvents(events), sprintEventsOf(sprintId) → SprintEvent[], statusEventsOf(issueIds) → Map<issueId, StatusEvent[]>, deleteIssue(issueId, tables), deleteProject(projectId, tables), clear(tables) }`; `SprintRow = { id, boardId, name, state, startAt, completeAt }`; события — с `projectId`.
  - `startBackfill(deps, part, { projects }) → Part`; `onBackfill(deps, event) → { finished }|{ continued }|{ skipped }`; тело задачи очереди `query-backfill`: `{ kind: 'backfill', part, generation }`.
  - `createIndexing(deps) → { parts: { sprint: IndexPart }, indexEvent(event), reconcileIndex() → { started, reindexed } , shippedParts() → string[], shippedTables() → string[] }`; `IndexPart = { tables: string[], prepare(), index(ids, project: { id, key }) }`.
  - `onLifecycle(deps) → { started: string[] }`.
  - `Deps` дополняется: `repo`, `indexParts`, `migrate()`, `shippedParts()`; `indexEvent` и `indexReconcile` — из `createIndexing`. В `createDeps()` `repo` — локальная константа `const repo = createIndexRepo();`, объявленная до литерала `deps`; Tasks 24, 27, 28 передают в свои `create*Compute` именно её (не `deps.repo` внутри литерала — это ReferenceError при загрузке модуля).
  - `limits.js` += `SQL_IN_CHUNK = 500` (id в одном `IN (…)` и строк в одном `INSERT`), `SPRINT_FIELDS_TTL_MS` = 24 ч (кэш id полей Sprint), `RECONCILE_RECENT_MAX = 2000` (задач, перечитываемых часовой добивкой индекса).
  - События спринтов пишутся в индекс (`sprint`), только когда часть `sprint` отгружена (`shippedParts()` её содержит — после Task 24); подписка триггера на них есть с Task 14.

- [ ] **Step 1: Падающие тесты.** `test/infra/indexRepo.test.js`:

```js
import { describe, expect, it } from 'vitest';
import { createIndexRepo } from '../../src/infra/indexRepo.js';

function recorder(rows = []) {
  const calls = [];
  const run = async (query, params) => {
    calls.push([query.replace(/\s+/g, ' ').trim(), params]);
    return { rows: rows.shift() ?? [] };
  };
  return { calls, run };
}

describe('index repo', () => {
  it('inserts sprint events idempotently with short kinds', async () => {
    const { calls, run } = recorder();
    await createIndexRepo(run).addSprintEvents([
      { issueId: '7', projectId: '1', sprintId: '5', kind: 'added', at: 10, changeId: '100' },
      { issueId: '7', projectId: '1', sprintId: '5', kind: 'removed', at: 20, changeId: '101' },
    ]);
    expect(calls).toEqual([[
      'INSERT IGNORE INTO sprint_event (issue_id, project_id, sprint_id, kind, at, change_id) VALUES (?,?,?,?,?,?), (?,?,?,?,?,?)',
      ['7', '1', '5', 'a', 10, '100', '7', '1', '5', 'r', 20, '101'],
    ]]);
  });
  it('upserts sprints', async () => {
    const { calls, run } = recorder();
    await createIndexRepo(run).upsertSprints([{ id: '5', boardId: '2', name: 'S5', state: 'closed', startAt: 1, completeAt: 2 }]);
    expect(calls[0][0]).toMatch(/^INSERT INTO sprint .* ON DUPLICATE KEY UPDATE board_id = VALUES\(board_id\)/);
  });
  it('reads the events of a sprint back in the shape of the core', async () => {
    const { run } = recorder([[{ issue_id: 7, sprint_id: 5, kind: 'a', at: '10', change_id: 100 }]]);
    expect(await createIndexRepo(run).sprintEventsOf('5')).toEqual([{ issueId: '7', sprintId: '5', kind: 'added', at: 10, changeId: '100' }]);
  });
  it('reads status events per issue in chunks of 500', async () => {
    const { calls, run } = recorder([[{ issue_id: 1, at: 5, from_cat: 'new', to_cat: 'done', change_id: 9 }], [], []]);
    const ids = Array.from({ length: 1200 }, (_, i) => String(i + 1));
    const map = await createIndexRepo(run).statusEventsOf(ids);
    expect(calls).toHaveLength(3);
    expect([...map.entries()]).toEqual([['1', [{ issueId: '1', at: 5, from: 'new', to: 'done', changeId: '9' }]]]);
  });
  it('deletes an issue from the given tables', async () => {
    const { calls, run } = recorder();
    await createIndexRepo(run).deleteIssue('7', ['sprint_event', 'status_event']);
    expect(calls).toEqual([['DELETE FROM sprint_event WHERE issue_id = ?', ['7']], ['DELETE FROM status_event WHERE issue_id = ?', ['7']]]);
  });
});
```

`test/infra/schema.test.js` (по образцу `apps/trace/test/infra/schema.test.js`):

```js
import { describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({ enqueued: [] }));
vi.mock('@forge/sql', () => ({
  migrationRunner: {
    enqueue(name, statement) {
      h.enqueued.push({ name, statement });
      return this;
    },
    run: vi.fn(async () => h.enqueued.map((m) => m.name)),
  },
  sql: {},
}));
const { runMigrations } = await import('../../src/infra/schema.js');

describe('runMigrations', () => {
  it('creates the sprint tables in order with idempotent keys', async () => {
    await runMigrations();
    expect(h.enqueued.map((m) => m.name)).toEqual(['v001_sprint', 'v002_sprint_event', 'v003_status_event']);
    expect(h.enqueued[1].statement).toContain('PRIMARY KEY (change_id, issue_id, sprint_id, kind)');
  });
});
```

`test/handlers/backfill.test.js`:

```js
import { describe, expect, it, vi } from 'vitest';
import { createFakeKvs } from '../fakeKvs.js';
import { createState } from '../../src/infra/state.js';
import { onBackfill, startBackfill } from '../../src/handlers/backfill.js';

function makeDeps({ pages, cost = 0 }) {
  let now = 1000;
  const pushed = [];
  const indexed = [];
  return {
    state: createState({ kvs: createFakeKvs() }),
    jira: {
      projects: async () => [{ id: '1', key: 'A' }, { id: '2', key: 'B' }, { id: '3', key: 'X' }],
      approximateCount: async (jql) => (jql.includes('"X"') ? 99 : 4500),
      searchPage: async (jql, token) => pages[`${jql}|${token}`],
    },
    indexParts: { sprint: { prepare: vi.fn(async () => {}), index: async (ids, project) => { indexed.push([project.key, ids.length]); now += cost; } } },
    backfillQueue: { push: async (body) => { pushed.push(body); } },
    now: () => now,
    pushed,
    indexed,
  };
}
const ids = (n, from = 1) => Array.from({ length: n }, (_, i) => String(from + i));
const PAGES = {
  'project = "A" ORDER BY id ASC|null': { ids: ids(5000), nextPageToken: 't2' },
  'project = "A" ORDER BY id ASC|t2': { ids: ids(1500, 5001), nextPageToken: null },
  'project = "B" ORDER BY id ASC|null': { ids: ids(10, 9001), nextPageToken: null },
};

describe('backfill', () => {
  it('starts with the projects that are not excluded and keeps an earlier readyAt', async () => {
    const deps = makeDeps({ pages: PAGES });
    await deps.state.setExcluded(['X']);
    await deps.state.progress.setPart('sprint', { readyAt: 7 });
    const p = await startBackfill(deps, 'sprint');
    expect(p).toEqual({ generation: 1000, startedAt: 1000, done: 0, total: 4500, cursor: { projects: [{ id: '1', key: 'A' }, { id: '2', key: 'B' }], index: 0, token: null, offset: 0 }, finishedAt: null, readyAt: 7 });
    expect(deps.indexParts.sprint.prepare).toHaveBeenCalled();
    expect(deps.pushed).toEqual([{ kind: 'backfill', part: 'sprint', generation: 1000 }]);
  });
  it('walks pages and projects in slices of 1 000 and marks the part ready', async () => {
    const deps = makeDeps({ pages: PAGES });
    await startBackfill(deps, 'sprint');
    expect(await onBackfill(deps, { body: { part: 'sprint', generation: 1000 } })).toEqual({ finished: true, done: 6510 });
    expect(deps.indexed).toEqual([['A', 1000], ['A', 1000], ['A', 1000], ['A', 1000], ['A', 1000], ['A', 1000], ['A', 500], ['B', 10]]);
    const p = await deps.state.progress.getPart('sprint');
    expect([p.finishedAt, p.readyAt, p.cursor]).toEqual([1000, 1000, null]);
  });
  it('saves the cursor and queues itself when the budget is spent', async () => {
    const deps = makeDeps({ pages: PAGES, cost: 100000 });
    await startBackfill(deps, 'sprint');
    expect(await onBackfill(deps, { body: { part: 'sprint', generation: 1000 } })).toEqual({ continued: true, done: 3000 });
    expect((await deps.state.progress.getPart('sprint')).cursor).toEqual({ projects: [{ id: '1', key: 'A' }, { id: '2', key: 'B' }], index: 0, token: null, offset: 3000 });
    expect(deps.pushed.at(-1)).toEqual({ kind: 'backfill', part: 'sprint', generation: 1000 });
  });
  it('ignores a job of an older generation', async () => {
    const deps = makeDeps({ pages: PAGES });
    await startBackfill(deps, 'sprint');
    expect(await onBackfill(deps, { body: { part: 'sprint', generation: 5 } })).toEqual({ skipped: true });
  });
});
```

`test/handlers/indexing.test.js`:

```js
import { describe, expect, it, vi } from 'vitest';
import { createFakeKvs } from '../fakeKvs.js';
import { createState } from '../../src/infra/state.js';
import { createIndexing } from '../../src/handlers/indexing.js';

function makeDeps() {
  const repo = { addSprintEvents: vi.fn(), addStatusEvents: vi.fn(), upsertSprints: vi.fn(), deleteSprint: vi.fn(), deleteIssue: vi.fn() };
  const jira = {
    fields: async () => [{ id: 'customfield_10020', schema: { custom: 'com.pyxis.greenhopper.jira:gh-sprint' } }, { id: 'summary', schema: {} }],
    statusCategories: async () => new Map([['1', 'new'], ['2', 'done']]),
    issue: async () => ({ fields: { project: { id: '10', key: 'JQLG' } } }),
  };
  return { repo, jira, state: createState({ kvs: createFakeKvs() }), now: () => 5000 };
}
const updated = (items) => ({ eventType: 'avi:jira:updated:issue', timestamp: 4000, issue: { id: '7', fields: { project: { id: '10', key: 'JQLG' } } }, changelog: { id: '900', items } });

describe('indexEvent', () => {
  it('stores sprint and status changes of an updated issue with its project', async () => {
    const deps = makeDeps();
    await createIndexing(deps).indexEvent(updated([{ field: 'Sprint', fieldId: 'customfield_10020', from: '', to: '5' }, { field: 'status', fieldId: 'status', from: '1', to: '2' }]));
    expect(deps.repo.addSprintEvents).toHaveBeenCalledWith([{ issueId: '7', projectId: '10', sprintId: '5', kind: 'added', at: 4000, changeId: '900' }]);
    expect(deps.repo.addStatusEvents).toHaveBeenCalledWith([{ issueId: '7', projectId: '10', at: 4000, from: 'new', to: 'done', changeId: '900' }]);
  });
  it('skips issues of excluded projects', async () => {
    const deps = makeDeps();
    await deps.state.setExcluded(['JQLG']);
    await createIndexing(deps).indexEvent(updated([{ field: 'Sprint', fieldId: 'customfield_10020', from: '', to: '5' }]));
    expect(deps.repo.addSprintEvents).not.toHaveBeenCalled();
  });
  it('keeps sprint dates and drops deleted sprints and issues', async () => {
    const deps = makeDeps();
    const indexing = createIndexing(deps);
    await indexing.indexEvent({ eventType: 'avi:jira-software:started:sprint', sprint: { id: 5, name: 'S5', state: 'active', startDate: '2026-01-01T00:00:00Z', originBoardId: 2 } });
    expect(deps.repo.upsertSprints).toHaveBeenCalledWith([{ id: '5', boardId: '2', name: 'S5', state: 'active', startAt: Date.UTC(2026, 0, 1), completeAt: null }]);
    await indexing.indexEvent({ eventType: 'avi:jira-software:deleted:sprint', sprint: { id: 5 } });
    expect(deps.repo.deleteSprint).toHaveBeenCalledWith('5');
    await indexing.indexEvent({ eventType: 'avi:jira:deleted:issue', issue: { id: '7' } });
    expect(deps.repo.deleteIssue).toHaveBeenCalledWith('7', indexing.shippedTables());
  });
});
```

`test/handlers/lifecycle.test.js`:

```js
import { describe, expect, it, vi } from 'vitest';
import { createFakeKvs } from '../fakeKvs.js';
import { createState } from '../../src/infra/state.js';
import { onLifecycle } from '../../src/handlers/lifecycle.js';

describe('onLifecycle', () => {
  it('migrates and starts only the parts that were never built', async () => {
    const state = createState({ kvs: createFakeKvs() });
    await state.progress.setPart('comments', { readyAt: 1 });
    const deps = {
      state, migrate: vi.fn(async () => {}), shippedParts: () => ['sprint', 'comments'], now: () => 9,
      jira: { projects: async () => [], approximateCount: async () => 0 },
      indexParts: { sprint: { prepare: async () => {} }, comments: { prepare: async () => {} } },
      backfillQueue: { push: vi.fn(async () => {}) },
    };
    expect(await onLifecycle(deps)).toEqual({ started: ['sprint'] });
    expect(deps.migrate).toHaveBeenCalled();
  });
});
```

В `test/infra/jira.test.js` дописать:

```js
describe('index reads', () => {
  it('returns one search page with its token', async () => {
    const { request, calls } = scripted([reply(200, { issues: [{ id: 1 }], nextPageToken: 'x' })]);
    expect(await createJira(request).searchPage('project = "A" ORDER BY id ASC', null)).toEqual({ ids: ['1'], nextPageToken: 'x' });
    expect(calls[0].body).toEqual({ jql: 'project = "A" ORDER BY id ASC', fields: ['id'], maxResults: 5000 });
  });
  it('lists projects as id and key', async () => {
    const { request } = scripted([reply(200, { values: [{ id: 10, key: 'A', name: 'n' }], isLast: true })]);
    expect(await createJira(request).projects()).toEqual([{ id: '10', key: 'A' }]);
  });
});
```

- [ ] **Step 2: Run** `npx vitest run` → FAIL.

- [ ] **Step 3: Пределы и `src/infra/schema.js`.** В конец `src/core/limits.js`:

```js
/** Ids in one SQL `IN (…)` list and rows in one INSERT. */
export const SQL_IN_CHUNK = 500;
/** How long the ids of the Sprint fields stay cached. */
export const SPRINT_FIELDS_TTL_MS = 24 * 60 * 60 * 1000;
/** Recently updated issues the hourly reconcile re-reads into the index. */
export const RECONCILE_RECENT_MAX = 2000;
```

`src/infra/schema.js`:

```js
import { migrationRunner } from '@forge/sql';

/** Applies pending index migrations; safe to call repeatedly. */
export async function runMigrations() {
  return migrationRunner
    .enqueue('v001_sprint', `CREATE TABLE IF NOT EXISTS sprint (
      sprint_id BIGINT PRIMARY KEY,
      board_id BIGINT NOT NULL,
      name VARCHAR(255) NOT NULL,
      state VARCHAR(16) NOT NULL,
      start_at BIGINT NULL,
      complete_at BIGINT NULL,
      INDEX idx_sprint_board (board_id)
    )`)
    .enqueue('v002_sprint_event', `CREATE TABLE IF NOT EXISTS sprint_event (
      issue_id BIGINT NOT NULL,
      project_id BIGINT NOT NULL,
      sprint_id BIGINT NOT NULL,
      kind CHAR(1) NOT NULL,
      at BIGINT NOT NULL,
      change_id BIGINT NOT NULL,
      PRIMARY KEY (change_id, issue_id, sprint_id, kind),
      INDEX idx_se_sprint (sprint_id, at),
      INDEX idx_se_issue (issue_id),
      INDEX idx_se_project (project_id)
    )`)
    .enqueue('v003_status_event', `CREATE TABLE IF NOT EXISTS status_event (
      issue_id BIGINT NOT NULL,
      project_id BIGINT NOT NULL,
      at BIGINT NOT NULL,
      from_cat VARCHAR(16) NOT NULL,
      to_cat VARCHAR(16) NOT NULL,
      change_id BIGINT NOT NULL,
      PRIMARY KEY (change_id, issue_id),
      INDEX idx_st_issue (issue_id, at),
      INDEX idx_st_project (project_id)
    )`)
    .run();
}
```

- [ ] **Step 4: `src/infra/indexRepo.js`**

```js
import { sql } from '@forge/sql';
import { SQL_IN_CHUNK } from '../core/limits.js';

const marks = (n) => new Array(n).fill('?').join(',');
const chunks = (list) => Array.from({ length: Math.ceil(list.length / SQL_IN_CHUNK) }, (_, i) => list.slice(i * SQL_IN_CHUNK, (i + 1) * SQL_IN_CHUNK));

/** One prepared statement on the app's Forge SQL database. */
export const execute = (query, params = []) => sql.prepare(query).bindParams(...params).execute();

/** Index rows: sprints, sprint and status events; comment and attachment metadata are added with the comment part. */
export function createIndexRepo(run = execute) {
  async function insert(table, cols, rows, onDuplicate = '') {
    for (const part of chunks(rows)) {
      await run(`INSERT ${onDuplicate ? '' : 'IGNORE '}INTO ${table} (${cols.join(', ')}) VALUES ${part.map(() => `(${marks(cols.length)})`).join(', ')}${onDuplicate}`, part.flat());
    }
  }

  return {
    insert,
    run,
    upsertSprints: (rows) => insert('sprint', ['sprint_id', 'board_id', 'name', 'state', 'start_at', 'complete_at'], rows.map((s) => [s.id, s.boardId, s.name, s.state, s.startAt, s.completeAt]),
      ' ON DUPLICATE KEY UPDATE board_id = VALUES(board_id), name = VALUES(name), state = VALUES(state), start_at = VALUES(start_at), complete_at = VALUES(complete_at)'),
    deleteSprint: (id) => run('DELETE FROM sprint WHERE sprint_id = ?', [id]),
    addSprintEvents: (events) => insert('sprint_event', ['issue_id', 'project_id', 'sprint_id', 'kind', 'at', 'change_id'], events.map((e) => [e.issueId, e.projectId, e.sprintId, e.kind === 'added' ? 'a' : 'r', e.at, e.changeId])),
    addStatusEvents: (events) => insert('status_event', ['issue_id', 'project_id', 'at', 'from_cat', 'to_cat', 'change_id'], events.map((e) => [e.issueId, e.projectId, e.at, e.from, e.to, e.changeId])),
    async sprintEventsOf(sprintId) {
      const { rows } = await run('SELECT issue_id, sprint_id, kind, at, change_id FROM sprint_event WHERE sprint_id = ?', [sprintId]);
      return (rows ?? []).map((r) => ({ issueId: String(r.issue_id), sprintId: String(r.sprint_id), kind: r.kind === 'a' ? 'added' : 'removed', at: Number(r.at), changeId: String(r.change_id) }));
    },
    async statusEventsOf(issueIds) {
      const out = new Map();
      for (const part of chunks(issueIds)) {
        const { rows } = await run(`SELECT issue_id, at, from_cat, to_cat, change_id FROM status_event WHERE issue_id IN (${marks(part.length)})`, part);
        for (const r of rows ?? []) {
          const id = String(r.issue_id);
          out.set(id, [...(out.get(id) ?? []), { issueId: id, at: Number(r.at), from: r.from_cat, to: r.to_cat, changeId: String(r.change_id) }]);
        }
      }
      return out;
    },
    async deleteIssue(issueId, tables) {
      for (const table of tables) await run(`DELETE FROM ${table} WHERE issue_id = ?`, [issueId]);
    },
    async deleteProject(projectId, tables) {
      for (const table of tables) await run(`DELETE FROM ${table} WHERE project_id = ?`, [projectId]);
    },
    async clear(tables) {
      for (const table of tables) await run(`DELETE FROM ${table}`);
    },
  };
}
```

- [ ] **Step 5: Клиент и состояние.** В `createJira` (Task 9) добавить и вернуть:

```js
  async function searchPage(jql, nextPageToken) {
    const page = await call('POST', '/rest/api/3/search/jql', { jql, fields: ['id'], maxResults: ID_PAGE, ...(nextPageToken ? { nextPageToken } : {}) });
    return { ids: (page.issues ?? []).map((x) => String(x.id)), nextPageToken: page.nextPageToken ?? null };
  }
```

и `projects: async () => (await paged('/rest/api/3/project/search')).map((p) => ({ id: String(p.id), key: p.key }))`. В `createState` добавить `sprintFields: record('cfg:sprintFields')`.

- [ ] **Step 6: `src/handlers/backfill.js`**

```js
import { CHANGELOG_BATCH, WORKER_BUDGET_MS } from '../core/limits.js';

const inList = (projects) => projects.map((p) => `"${p.key}"`).join(', ');

/** Starts filling one index part for every project not excluded (or the given ones); an earlier readyAt is kept. */
export async function startBackfill(deps, part, { projects } = {}) {
  const excluded = new Set(await deps.state.excluded());
  const scope = projects ?? (await deps.jira.projects()).filter((p) => !excluded.has(p.key));
  const old = await deps.state.progress.getPart(part);
  const total = scope.length ? await deps.jira.approximateCount(`project in (${inList(scope)})`) : 0;
  const progress = { generation: deps.now(), startedAt: deps.now(), done: 0, total, cursor: { projects: scope, index: 0, token: null, offset: 0 }, finishedAt: null, readyAt: old?.readyAt ?? null };
  await deps.state.progress.setPart(part, progress);
  await deps.indexParts[part].prepare();
  await deps.backfillQueue.push({ kind: 'backfill', part, generation: progress.generation });
  return progress;
}

/** Backfill consumer: slices of issue ids, project by project, within the budget; then it queues itself to continue. */
export async function onBackfill(deps, event) {
  const { part, generation } = event?.body ?? {};
  const p = await deps.state.progress.getPart(part);
  if (!p || p.generation !== generation || p.finishedAt) return { skipped: true };
  const deadline = deps.now() + WORKER_BUDGET_MS;
  const c = p.cursor;
  let page = null;
  while (deps.now() < deadline) {
    const project = c.projects[c.index];
    if (!project) {
      await deps.state.progress.setPart(part, { ...p, cursor: null, finishedAt: deps.now(), readyAt: p.readyAt ?? deps.now() });
      return { finished: true, done: p.done };
    }
    if (!page) page = await deps.jira.searchPage(`project = "${project.key}" ORDER BY id ASC`, c.token);
    const slice = page.ids.slice(c.offset, c.offset + CHANGELOG_BATCH);
    if (slice.length) {
      await deps.indexParts[part].index(slice, project);
      p.done += slice.length;
      c.offset += slice.length;
    }
    if (c.offset >= page.ids.length) {
      if (page.nextPageToken) c.token = page.nextPageToken;
      else {
        c.index += 1;
        c.token = null;
      }
      c.offset = 0;
      page = null;
    }
    if ((await deps.state.progress.getPart(part))?.generation !== generation) return { skipped: true };
    await deps.state.progress.setPart(part, p);
  }
  await deps.backfillQueue.push({ kind: 'backfill', part, generation });
  return { continued: true, done: p.done };
}
```

- [ ] **Step 7: `src/handlers/indexing.js`**

```js
import { SHIPPED_GROUPS } from '../core/catalog.js';
import { sprintWindow } from '../core/boards.js';
import { RECONCILE_RECENT_MAX, SPRINT_FIELDS_TTL_MS } from '../core/limits.js';
import { indexPartOf } from '../core/readiness.js';
import { sprintEvents, statusEvents } from '../core/sprint-history.js';
import { startBackfill } from './backfill.js';

const SPRINT_FIELD = 'com.pyxis.greenhopper.jira:gh-sprint';
const RECENT_JQL = 'updated >= -2h';

const sprintRow = (s, boardId) => ({ id: String(s.id), boardId: String(boardId ?? s.originBoardId ?? 0), name: s.name ?? '', state: s.state ?? '', ...sprintWindow(s) });

/** Index parts, the event writer and the hourly gap filler of the shipped index parts. */
export function createIndexing(deps) {
  async function sprintFieldIds() {
    const cached = await deps.state.sprintFields.get();
    if (cached && deps.now() - cached.at < SPRINT_FIELDS_TTL_MS) return new Set(cached.ids);
    const ids = (await deps.jira.fields()).filter((f) => f.schema?.custom === SPRINT_FIELD).map((f) => f.id);
    await deps.state.sprintFields.set({ ids, at: deps.now() });
    return new Set(ids);
  }

  async function projectOf(event) {
    return event.issue?.fields?.project ?? (await deps.jira.issue(event.issue.id, ['project'])).fields.project;
  }

  const parts = {
    sprint: {
      tables: ['sprint_event', 'status_event'],
      async prepare() {
        for (const board of await deps.jira.allBoards()) {
          if (board.type !== 'scrum') continue;
          await deps.repo.upsertSprints((await deps.jira.sprints(board.id)).map((s) => sprintRow(s, board.id)));
        }
      },
      async index(ids, project) {
        const fields = await sprintFieldIds();
        const categories = await deps.jira.statusCategories();
        const logs = await deps.jira.changelogs(ids, [...fields, 'status']);
        const sprintRows = [];
        const statusRows = [];
        for (const [issueId, histories] of logs) {
          sprintRows.push(...sprintEvents(issueId, histories, fields).map((e) => ({ ...e, projectId: String(project.id) })));
          statusRows.push(...statusEvents(issueId, histories, categories).map((e) => ({ ...e, projectId: String(project.id) })));
        }
        await deps.repo.addSprintEvents(sprintRows);
        await deps.repo.addStatusEvents(statusRows);
      },
    },
  };

  const shippedParts = () => [...new Set(SHIPPED_GROUPS.map(indexPartOf).filter(Boolean))].filter((p) => parts[p]);
  const shippedTables = () => shippedParts().flatMap((p) => parts[p].tables);

  async function indexEvent(event) {
    const type = String(event?.eventType ?? '');
    if (!shippedParts().length) return;
    if (type.startsWith('avi:jira-software:') && type.endsWith(':sprint')) {
      if (!shippedParts().includes('sprint')) return;
      if (type.endsWith(':deleted:sprint')) await deps.repo.deleteSprint(String(event.sprint.id));
      else await deps.repo.upsertSprints([sprintRow(event.sprint)]);
      return;
    }
    if (type === 'avi:jira:deleted:issue') {
      await deps.repo.deleteIssue(String(event.issue.id), shippedTables());
      return;
    }
    if (type !== 'avi:jira:updated:issue' || !event.changelog?.items?.length || !parts.sprint || !shippedParts().includes('sprint')) return;
    const project = await projectOf(event);
    if ((await deps.state.excluded()).includes(project.key)) return;
    const histories = [{ id: event.changelog.id, created: event.timestamp ?? deps.now(), items: event.changelog.items }];
    const sprintRows = sprintEvents(event.issue.id, histories, await sprintFieldIds()).map((e) => ({ ...e, projectId: String(project.id) }));
    if (sprintRows.length) await deps.repo.addSprintEvents(sprintRows);
    if (event.changelog.items.some((i) => i.fieldId === 'status' || i.field === 'status')) {
      const statusRows = statusEvents(event.issue.id, histories, await deps.jira.statusCategories()).map((e) => ({ ...e, projectId: String(project.id) }));
      if (statusRows.length) await deps.repo.addStatusEvents(statusRows);
    }
  }

  async function reconcileIndex() {
    const started = [];
    for (const part of shippedParts()) {
      if (!(await deps.state.progress.getPart(part))) {
        await startBackfill(deps, part);
        started.push(part);
      }
    }
    const excluded = await deps.state.excluded();
    const jql = excluded.length ? `${RECENT_JQL} AND project not in (${excluded.map((k) => `"${k}"`).join(', ')})` : RECENT_JQL;
    const recent = (await deps.jira.searchPage(jql, null)).ids.slice(0, RECONCILE_RECENT_MAX);
    const byProject = new Map();
    for (const issue of await deps.jira.bulkIssues(recent, ['project'])) {
      const p = issue.fields.project;
      if (!byProject.has(p.id)) byProject.set(p.id, { project: p, ids: [] });
      byProject.get(p.id).ids.push(String(issue.id));
    }
    for (const part of shippedParts()) {
      if (started.includes(part)) continue;
      if (part === 'sprint') await parts.sprint.prepare();
      for (const { project, ids } of byProject.values()) await parts[part].index(ids, project);
    }
    return { started, reindexed: recent.length };
  }

  return { parts, indexEvent, reconcileIndex, shippedParts, shippedTables };
}
```

Тест «keeps sprint dates…» вызывает `indexEvent` при `SHIPPED_GROUPS` без `sprint` — в этой задаче группа ещё не отгружена, поэтому в тестах `indexing.test.js` добавить в начало `vi.mock('../../src/core/catalog.js', async (orig) => ({ ...(await orig()), SHIPPED_GROUPS: ['query', 'site', 'board', 'sprint'] }))`; Task 24 убирает мок, когда `sprint` входит в `SHIPPED_GROUPS`.

- [ ] **Step 8: `src/handlers/lifecycle.js`**

```js
import { startBackfill } from './backfill.js';

/** App installed or upgraded: apply migrations, then start every shipped index part that was never built. */
export async function onLifecycle(deps) {
  await deps.migrate();
  const started = [];
  for (const part of deps.shippedParts()) {
    if (await deps.state.progress.getPart(part)) continue;
    await startBackfill(deps, part);
    started.push(part);
  }
  return { started };
}
```

- [ ] **Step 9: Сборка.** `src/deps.js` — импорты `createIndexRepo` (`./infra/indexRepo.js`), `runMigrations` (`./infra/schema.js`), `createIndexing` (`./handlers/indexing.js`); `createDeps` целиком:

```js
/** Production dependencies of every handler. */
export function createDeps() {
  const jira = appJira();
  const state = createState({ kvs });
  const repo = createIndexRepo();
  const deps = {
    jira,
    state,
    repo,
    cache: createValueCache({ kvs, hash: sha1 }),
    journal: createJournal({ kvs, beginsWith: WhereConditions.beginsWith }),
    queue: createQueueClient(new Queue({ key: 'query-refresh' })),
    backfillQueue: createQueueClient(new Queue({ key: 'query-backfill' })),
    compute: { ...createHierarchyCompute({ jira }), ...createLinkCompute({ jira }), ...createBoardCompute({ jira }) },
    migrate: runMigrations,
    now: () => Date.now(),
    sleep: (ms) => new Promise((resolve) => {
      setTimeout(resolve, ms);
    }),
    levels: Number(process.env.QUERY_TREE_LEVELS) || TREE_LEVELS,
    debugEvents: process.env.QUERY_DEBUG_EVENTS === '1',
    ready: async (functionName) => readinessError(await state.progress.get(), FUNCTION_BY_NAME.get(functionName).group),
  };
  const indexing = createIndexing(deps);
  deps.indexParts = indexing.parts;
  deps.indexEvent = indexing.indexEvent;
  deps.indexReconcile = indexing.reconcileIndex;
  deps.shippedParts = indexing.shippedParts;
  return deps;
}
```

Tasks 24, 27, 28 дописывают свои источники в `compute` этого литерала, передавая локальную `repo`. `src/index.js`:

```js
import { onBackfill as handleBackfill } from './handlers/backfill.js';
import { onLifecycle as handleLifecycle } from './handlers/lifecycle.js';

export const onBackfill = (event) => handleBackfill(deps, event);
export const onLifecycle = () => handleLifecycle(deps);
```

`manifest.yml` → `modules`: `sql: [{ key: main, engine: mysql }]`; в `trigger` — `{ key: query-lifecycle, function: on-lifecycle, events: [avi:forge:installed:app, avi:forge:upgraded:app] }`; в `consumer` — `{ key: query-backfill-consumer, queue: query-backfill, function: on-backfill }`; функции `{ key: on-lifecycle, handler: index.onLifecycle, timeoutSeconds: 120 }`, `{ key: on-backfill, handler: index.onBackfill, timeoutSeconds: 300 }`.

- [ ] **Step 10: Run** `npx vitest run` → PASS; `npm run lint` → 0 ошибок; `forge lint` → без ошибок.

- [ ] **Step 11: Commit**

```bash
git add apps/query
git commit -m "JQL-30: Store sprint and status history in Forge SQL with a resumable backfill and event writes

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 24: Функции истории спринтов — вычисление, манифест, эталоны

**Model:** opus

Исполняется, только если пройден J-G6.

**Files:**
- Create: `apps/query/src/compute/sprints.js`
- Modify: `apps/query/src/core/catalog.js` (`SHIPPED_GROUPS` + `'sprint'`), `apps/query/test/core/catalog.test.js`, `apps/query/test/handlers/indexing.test.js` (убрать мок каталога), `apps/query/src/deps.js`, `apps/query/manifest.yml`, `apps/query/scripts/lib/reference.mjs`, `apps/query/scripts/acceptance.mjs`
- Test: `apps/query/test/compute/sprints.test.js`

**Interfaces:**
- Consumes: `addedAfterStart`, `removedAfterStart`, `sprintOutcome` (Task 22), `matchBoard`, `matchSprint`, `activeSprint`, `sprintWindow` (Task 8), `IndexRepo.sprintEventsOf`, `IndexRepo.statusEventsOf` (Task 23), `ERR.excluded`, `ERR.notFound`.
- Produces: `createSprintCompute({ jira, repo, state, now }) → { addedAfterSprintStart, removedAfterSprintStart, incompleteInSprint, completeInSprint }` (результат — `{ ids, field: 'id', watch: null }`); случаи `CASES.m2` (30 спринтов засева и большой спринт `big` на 2 200 задач — полнота на > 1 000, P-3) и эталоны `REFERENCES.{addedAfterSprintStart,removedAfterSprintStart,completeInSprint,incompleteInSprint}`; фаза `fresh --group sprint`. События спринтов подписаны в Task 14; эта задача только включает их запись в индекс — через `SHIPPED_GROUPS` часть `sprint` попадает в `shippedParts()`.

- [ ] **Step 1: Падающие тесты** `test/compute/sprints.test.js`:

```js
import { describe, expect, it } from 'vitest';
import { createFakeKvs } from '../fakeKvs.js';
import { createState } from '../../src/infra/state.js';
import { fakeJira } from '../fakeJira.js';
import { createSprintCompute } from '../../src/compute/sprints.js';

const SPRINTS = [
  { id: 1, name: 'S1', state: 'closed', startDate: '2026-01-01T00:00:00Z', completeDate: '2026-01-14T00:00:00Z' },
  { id: 2, name: 'S2', state: 'active', startDate: '2026-01-15T00:00:00Z' },
];
const T = (d) => Date.UTC(2026, 0, d);
const EVENTS = { 1: [{ issueId: '10', sprintId: '1', kind: 'added', at: T(3), changeId: '1' }, { issueId: '11', sprintId: '1', kind: 'removed', at: T(4), changeId: '2' }], 2: [{ issueId: '12', sprintId: '2', kind: 'added', at: T(16), changeId: '3' }] };

function make() {
  const jira = fakeJira({ boards: [{ id: 7, name: 'DEMO board', location: { projectKey: 'DEMO' } }], sprints: { 7: SPRINTS }, searches: { 'sprint = 1': ['10', '13'] } });
  jira.bulkIssues = async (ids) => ids.map((id) => ({ id, fields: { status: { statusCategory: { key: id === '13' ? 'new' : 'done' } } } }));
  const repo = { sprintEventsOf: async (id) => EVENTS[id] ?? [], statusEventsOf: async () => new Map() };
  const state = createState({ kvs: createFakeKvs() });
  return { compute: createSprintCompute({ jira, repo, state, now: () => T(20) }), state };
}

describe('sprint compute', () => {
  it('addedAfterSprintStart reads a named sprint', async () => {
    expect(await make().compute.addedAfterSprintStart({ board: 'DEMO board', sprint: 'S1' })).toEqual({ ids: ['10'], field: 'id', watch: null });
  });
  it('addedAfterSprintStart without a sprint uses the active one', async () => {
    expect((await make().compute.addedAfterSprintStart({ board: '7' })).ids).toEqual(['12']);
  });
  it('removedAfterSprintStart lists removals not undone', async () => {
    expect((await make().compute.removedAfterSprintStart({ board: 'DEMO board', sprint: '1' })).ids).toEqual(['11']);
  });
  it('complete and incomplete split the members at the close', async () => {
    const { compute } = make();
    expect((await compute.completeInSprint({ board: 'DEMO board', sprint: 'S1' })).ids).toEqual(['10']);
    expect((await compute.incompleteInSprint({ board: 'DEMO board', sprint: 'S1' })).ids).toEqual(['13']);
  });
  it('explains a board without an active sprint and a board of an excluded project', async () => {
    const { compute, state } = make();
    const jira2 = fakeJira({ boards: [{ id: 8, name: 'B', location: { projectKey: 'B' } }], sprints: { 8: [] } });
    const noActive = createSprintCompute({ jira: jira2, repo: { sprintEventsOf: async () => [] }, state, now: () => 0 });
    expect(await noActive.addedAfterSprintStart({ board: 'B' })).toEqual({ error: 'Active sprint of board "B" not found' });
    await state.setExcluded(['DEMO']);
    expect(await compute.addedAfterSprintStart({ board: 'DEMO board', sprint: 'S1' })).toEqual({ error: 'Project DEMO is excluded from the ArtUp Query index' });
  });
});
```

Состав на закрытии: `membersAt` отменяет только события после закрытия; `11` убран внутри окна и в текущем составе (`sprint = 1` → `10`, `13`) отсутствует, поэтому незавершённые — только `13`.

- [ ] **Step 2: Run** `npx vitest run test/compute/sprints.test.js` → FAIL.

- [ ] **Step 3: `src/compute/sprints.js`**

```js
import { activeSprint, matchBoard, matchSprint, sprintWindow } from '../core/boards.js';
import { ERR } from '../core/errors.js';
import { addedAfterStart, removedAfterStart, sprintOutcome } from '../core/sprint-history.js';

/** Value sources of the sprint history functions over the SQL index and live sprint membership. */
export function createSprintCompute({ jira, repo, state, now }) {
  async function resolve({ board, sprint }) {
    const b = matchBoard(await jira.boards(board), board);
    if (b.error) return b;
    const projectKey = b.item.location?.projectKey;
    if (projectKey && (await state.excluded()).includes(projectKey)) return { error: ERR.excluded(projectKey) };
    const sprints = await jira.sprints(b.item.id);
    if (sprint === undefined) {
      const active = activeSprint(sprints);
      return active ? { sprint: active } : { error: ERR.notFound('Active sprint of board', board) };
    }
    const s = matchSprint(sprints, sprint);
    return s.error ? s : { sprint: s.item };
  }

  const fromEvents = (pick) => async (args) => {
    const r = await resolve(args);
    if (r.error) return r;
    return { ids: pick(await repo.sprintEventsOf(String(r.sprint.id)), String(r.sprint.id), sprintWindow(r.sprint)), field: 'id', watch: null };
  };

  const outcome = (which) => async (args) => {
    const r = await resolve(args);
    if (r.error) return r;
    const sprintId = String(r.sprint.id);
    const currentIds = await jira.searchIds(`sprint = ${sprintId}`);
    const events = await repo.sprintEventsOf(sprintId);
    const members = [...new Set([...currentIds, ...events.map((e) => e.issueId)])];
    const currentCategory = new Map((await jira.bulkIssues(members, ['status'])).map((x) => [String(x.id), x.fields?.status?.statusCategory?.key ?? 'new']));
    const result = sprintOutcome({ sprintId, window: sprintWindow(r.sprint), now: now(), currentIds, events, statusByIssue: await repo.statusEventsOf(members), currentCategory });
    return { ids: result[which], field: 'id', watch: null };
  };

  return {
    addedAfterSprintStart: fromEvents(addedAfterStart),
    removedAfterSprintStart: fromEvents(removedAfterStart),
    completeInSprint: outcome('complete'),
    incompleteInSprint: outcome('incomplete'),
  };
}
```

- [ ] **Step 4: Отгрузка группы.** `SHIPPED_GROUPS = ['query', 'site', 'board', 'sprint']`; в `catalog.test.js` ожидание `SHIPPED_GROUPS` и список `shippedFunctions` дополнить четырьмя функциями спринта; в `indexing.test.js` убрать `vi.mock` каталога. `src/deps.js`: в литерале `deps` (Task 23) `compute` += `...createSprintCompute({ jira, repo, state, now: () => Date.now() })` — `repo` и `state` — локальные константы `createDeps`, объявленные до литерала. Манифест: `node scripts/gen-manifest-functions.mjs` → заменить блок `jira:jqlFunction`, добавить функции `fn-*`; триггер `query-events` не менять — события спринтов в нём с Task 14.

- [ ] **Step 5: Эталоны и случаи приёмки.** В `scripts/lib/reference.mjs` добавить (независимо от `src/`):

```js
const changelogCache = new Map();

async function changelogOf(key) {
  if (changelogCache.has(key)) return changelogCache.get(key);
  const out = [];
  for (let startAt = 0; ; startAt += 100) {
    const page = await api('GET', `/rest/api/3/issue/${key}/changelog?startAt=${startAt}&maxResults=100`);
    out.push(...page.values);
    if (page.isLast || !page.values.length) break;
  }
  changelogCache.set(key, out);
  return out;
}

const sprintSet = (v) => new Set(String(v ?? '').split(',').map((x) => x.trim()).filter(Boolean));

async function sprintByName(board, name) {
  const all = await sprintsOf(await boardId(board), 'active,closed,future');
  return name === undefined ? all.find((s) => s.state === 'active') : all.find((s) => s.name === name || String(s.id) === String(name));
}

async function sprintChanges(candidates, sprintId) {
  const out = [];
  for (const id of candidates) {
    for (const h of await changelogOf(id)) {
      for (const item of h.items.filter((i) => i.field === 'Sprint')) {
        const had = sprintSet(item.from).has(String(sprintId));
        const has = sprintSet(item.to).has(String(sprintId));
        if (had !== has) out.push({ id, at: jiraMs(h.created), added: has });
      }
    }
  }
  return out.sort((a, b) => a.at - b.at);
}

Object.assign(REFERENCES, {
  async addedAfterSprintStart([board, sprint], { candidates }) {
    const s = await sprintByName(board, sprint);
    const start = jiraMs(s.activatedDate ?? s.startDate);
    const end = s.completeDate ? jiraMs(s.completeDate) : Infinity;
    return uniq((await sprintChanges(await must(candidates), s.id)).filter((c) => c.added && c.at > start && c.at <= end).map((c) => c.id));
  },
  async removedAfterSprintStart([board, sprint], { candidates }) {
    const s = await sprintByName(board, sprint);
    const start = jiraMs(s.activatedDate ?? s.startDate);
    const end = s.completeDate ? jiraMs(s.completeDate) : Infinity;
    const changes = (await sprintChanges(await must(candidates), s.id)).filter((c) => c.at <= end);
    const last = new Map(changes.map((c) => [c.id, c]));
    return uniq([...new Set(changes.filter((c) => !c.added && c.at > start).map((c) => c.id))].filter((id) => !last.get(id).added));
  },
  async completeInSprint(args, options) {
    return (await outcomeRef(args, options)).complete;
  },
  async incompleteInSprint(args, options) {
    return (await outcomeRef(args, options)).incomplete;
  },
});

async function outcomeRef([board, sprint], { candidates }) {
  const s = await sprintByName(board, sprint);
  const t = s.completeDate ? jiraMs(s.completeDate) : Date.now();
  const statuses = new Map((await api('GET', '/rest/api/3/status')).map((x) => [String(x.id), x.statusCategory.key]));
  const complete = [];
  const incomplete = [];
  for (const id of await must(candidates)) {
    const log = await changelogOf(id);
    const sprintItems = log.flatMap((h) => h.items.filter((i) => i.field === 'Sprint').map((i) => ({ at: jiraMs(h.created), from: i.from, to: i.to })));
    const before = sprintItems.filter((i) => i.at <= t).at(-1);
    const after = sprintItems.find((i) => i.at > t);
    const current = (await bulk([id], ['customfield_10020']))[0]?.fields?.customfield_10020 ?? [];
    const value = before ? sprintSet(before.to) : after ? sprintSet(after.from) : new Set(current.map((x) => String(x.id)));
    if (!value.has(String(s.id))) continue;
    const statusItems = log.flatMap((h) => h.items.filter((i) => i.fieldId === 'status').map((i) => ({ at: jiraMs(h.created), from: i.from, to: i.to })));
    const sb = statusItems.filter((i) => i.at <= t).at(-1);
    const sa = statusItems.find((i) => i.at > t);
    const statusId = sb ? sb.to : sa ? sa.from : (await bulk([id], ['status']))[0].fields.status.id;
    (statuses.get(String(statusId)) === 'done' ? complete : incomplete).push(id);
  }
  return { complete: uniq(complete), incomplete: uniq(incomplete) };
}
```

(`customfield_10020` — id поля Sprint с этого сайта из `docs/live-checks.md`; если другой — подставить его.) В `acceptance.mjs` (в импорт из `./lib/http.mjs` добавить `UnsafeRetryError`; если импорта `readFileSync` ещё нет — `import { readFileSync } from 'node:fs';` в начало файла) — случаи `CASES.m2` из засева (геттер: файл засева читается, только когда выбран `--cases m2`), область эталонов и фаза `fresh --group sprint`; `waitFor`, `latencyResult` — из общего `lib/latency.mjs` (Task 16). Блок вставить сразу после `export const FRESH = …` и до `const PHASES` (к `CASES` и `FRESH` нельзя обращаться до их объявления):

```js
const JG6_SEED = new URL('../../../atlassian/data/jg6-seed.json', import.meta.url);
const jg6Seed = () => JSON.parse(readFileSync(JG6_SEED, 'utf8'));
args.candidates = args.candidates ?? 'project = JQLG AND labels in (jg-sprint, jg-sprint-big)';

Object.defineProperty(CASES, 'm2', {
  enumerable: true,
  get() {
    const seed = jg6Seed();
    const board = 'JQLG board';
    const SPRINT_FUNCTIONS = ['addedAfterSprintStart', 'removedAfterSprintStart', 'completeInSprint', 'incompleteInSprint'];
    return [
      ...seed.sprints.flatMap((s) => [
        ['addedAfterSprintStart', [board, s.name], `${s.name}: added after the start`],
        ['removedAfterSprintStart', [board, s.name], `${s.name}: removed after the start`],
      ]),
      ...seed.sprints.slice(0, 10).flatMap((s) => [
        ['completeInSprint', [board, s.name], `${s.name}: done at the close`],
        ['incompleteInSprint', [board, s.name], `${s.name}: not done at the close`],
      ]),
      ['addedAfterSprintStart', [board], 'active sprint'],
      ...SPRINT_FUNCTIONS.map((fn) => [fn, [board, seed.big.name], `${seed.big.name}: sprint of 2 200 issues (> 1 000)`]),
    ];
  },
});

async function addToSprint(sprintId, issueId) {
  for (let attempt = 1; attempt <= 5; attempt += 1) {
    try {
      await api('POST', `/rest/agile/1.0/sprint/${sprintId}/issue`, { issues: [issueId] }, { unsafe: true });
      return;
    } catch (error) {
      if (!(error instanceof UnsafeRetryError)) throw error;
      if ((await ids(`sprint = ${sprintId} AND id = ${issueId}`)).ids?.length) return;
      await sleep(1000 * attempt);
    }
  }
  throw new Error(`issue ${issueId} was not added to sprint ${sprintId}`);
}

async function toDone(issueId) {
  const { transitions } = await api('GET', `/rest/api/3/issue/${issueId}/transitions`);
  const done = transitions.find((t) => t.to?.statusCategory?.key === 'done');
  await api('POST', `/rest/api/3/issue/${issueId}/transitions`, { transition: { id: done.id } });
}

FRESH.sprint = async () => {
  const { active } = jg6Seed();
  const free = (await ids('project = JQLG AND labels = jg-sprint AND sprint is EMPTY ORDER BY key')).ids.slice(0, args.n);
  const open = (await ids(`sprint = ${active.id} AND statusCategory != Done ORDER BY key`)).ids.slice(0, args.n);
  const rows = { addedAfterStart: [], completed: [] };
  const t0 = Date.now();
  for (const x of free) {
    const t = Date.now();
    await addToSprint(active.id, x);
    rows.addedAfterStart.push(await waitFor(clause('addedAfterSprintStart', ['JQLG board']), x, true, t));
  }
  for (const x of open) {
    const t = Date.now();
    await toDone(x);
    rows.completed.push(await waitFor(clause('completeInSprint', ['JQLG board', active.name]), x, true, t));
  }
  const result = latencyResult(rows, t0);
  log(JSON.stringify(result.summary));
  save(tagged('acceptance-fresh-sprint'), { stats, ...result });
};
```

- [ ] **Step 6: Run** `npx vitest run` → PASS; `npm run lint` → 0 ошибок; `forge lint` → без ошибок; `node --check apps/query/scripts/acceptance.mjs`.

- [ ] **Step 7: Commit**

```bash
git add apps/query
git commit -m "JQL-31: Ship sprint history functions over the index with REST references

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

## Этап M3 — комментарии, вложения, поля (ворота J-G7)

### Task 25: Даты и условия комментариев и вложений — чистые функции

**Model:** opus

Исполняется, только если J-G7 пройден хотя бы по одной части — комментариям или вложениям (Task 21, P-2).

**Files:**
- Create: `apps/query/src/core/{dates.js,comment-clauses.js}`
- Test: `apps/query/test/core/{dates.test.js,comment-clauses.test.js}`

**Interfaces:**
- Consumes: `ERR` (Task 5), `sortIds` (Task 7).
- Produces:
  - `dates.js`: `DAY_MS`, `startOfDayMs(ms) → ms`, `parseDate(text, now) → { ms } | { error }` (UTC; `YYYY-MM-DD`, `YYYY/MM/DD`, `… HH:mm`, `±N[mhdw]`, `start|endOf(Day|Week|Month|Year)(±N | "±N[mhdw]")`, неделя с понедельника).
  - `comment-clauses.js`: `tokenize(text) → { words } | { error }`; `parseClauses(text, kind: 'comment'|'attachment', now) → { clauses } | { error }`, `Clauses = { by?, inRole?, inGroup?, roleLevel?, groupLevel?, after?, before?, onStart?, onEnd?, ext? }`; `metaMatches(meta, clauses, people) → boolean`, `Meta = { id, issueId, projectId, author, createdAt, visType, visValue, ext }`, `People = { by?: Set, inGroup?: Set, inRole?: Map<projectId, Set> }`; `issuesWith(metas, clauses, { last, people }) → string[]`. Счёт комментариев на задачу (`hasComments`) — в SQL (`IndexRepo.issuesWithCommentCount`, Task 27), отдельной функции ядра нет. Условия — по итогу сверки ScriptRunner (P-8, Task 1): пустые условия = любой комментарий; `roleLevel`/`groupLevel` — видимость комментария; у вложений есть `on`.

- [ ] **Step 1: Падающие тесты.** `test/core/dates.test.js`:

```js
import { describe, expect, it } from 'vitest';
import { DAY_MS, parseDate, startOfDayMs } from '../../src/core/dates.js';

const NOW = Date.UTC(2026, 9, 8, 15, 0);

describe('parseDate', () => {
  it.each([
    ['2026-09-01', Date.UTC(2026, 8, 1)],
    ['2026/09/01 10:30', Date.UTC(2026, 8, 1, 10, 30)],
    ['-7d', NOW - 7 * DAY_MS],
    ['-0d', NOW],
    ['+2h', NOW + 2 * 3600000],
    ['-30m', NOW - 30 * 60000],
    ['startOfDay()', Date.UTC(2026, 9, 8)],
    ['startOfWeek()', Date.UTC(2026, 9, 5)],
    ['startOfWeek(-1)', Date.UTC(2026, 8, 28)],
    ['startOfMonth()', Date.UTC(2026, 9, 1)],
    ['startOfMonth(-1)', Date.UTC(2026, 8, 1)],
    ['endOfMonth(-1)', Date.UTC(2026, 9, 1) - 1],
    ['endOfDay()', Date.UTC(2026, 9, 9) - 1],
    ['startOfDay("-1d")', Date.UTC(2026, 9, 7)],
    ['startOfYear()', Date.UTC(2026, 0, 1)],
  ])('%s', (text, ms) => {
    expect(parseDate(text, NOW)).toEqual({ ms });
  });
  it('rejects impossible and unknown dates', () => {
    expect(parseDate('2026-02-30', NOW)).toEqual({ error: 'Invalid date "2026-02-30"' });
    expect(parseDate('tomorrow', NOW)).toEqual({ error: 'Invalid date "tomorrow"' });
  });
  it('cuts to midnight UTC', () => {
    expect(startOfDayMs(Date.UTC(2026, 2, 29, 23, 59))).toBe(Date.UTC(2026, 2, 29));
  });
});
```

`test/core/comment-clauses.test.js`:

```js
import { describe, expect, it } from 'vitest';
import { issuesWith, metaMatches, parseClauses, tokenize } from '../../src/core/comment-clauses.js';

const NOW = Date.UTC(2026, 9, 8, 15, 0);
const DAY = 86400000;
const meta = (id, issueId, author, createdAt, extra = {}) => ({ id, issueId, projectId: '1', author, createdAt, visType: null, visValue: null, ext: '', ...extra });

describe('tokenize', () => {
  it('keeps quoted words with spaces and function calls with inner quotes', () => {
    expect(tokenize('by "John Smith" after startOfDay("-1d")')).toEqual({ words: ['by', 'John Smith', 'after', 'startOfDay("-1d")'] });
  });
  it('rejects an unclosed quote', () => {
    expect(tokenize('by "John')).toEqual({ error: 'Unclosed quote in "by "John"' });
  });
});

describe('parseClauses', () => {
  it('reads people, roles and dates', () => {
    expect(parseClauses('by 5b10ac after -7d inRole Developers', 'comment', NOW)).toEqual({ clauses: { by: '5b10ac', after: NOW - 7 * DAY, inRole: 'Developers' } });
  });
  it('turns on into one UTC day', () => {
    expect(parseClauses('on 2026-03-29', 'comment', NOW)).toEqual({ clauses: { onStart: Date.UTC(2026, 2, 29), onEnd: Date.UTC(2026, 2, 30) } });
  });
  it('accepts ext only for attachments, without a dot and in lower case', () => {
    expect(parseClauses('ext .PDF', 'attachment', NOW)).toEqual({ clauses: { ext: 'pdf' } });
    expect(parseClauses('ext pdf', 'comment', NOW)).toEqual({ error: 'Unknown clause "ext"; use by, after, before, on, inRole, inGroup, roleLevel, groupLevel' });
  });
  it('explains a clause without a value, a repeated clause and a bad date', () => {
    expect(parseClauses('by', 'comment', NOW)).toEqual({ error: 'Clause "by" needs a value' });
    expect(parseClauses('by a by b', 'comment', NOW)).toEqual({ error: 'Clause "by" is given twice' });
    expect(parseClauses('after soon', 'comment', NOW)).toEqual({ error: 'Invalid date "soon"' });
  });
  it('means any comment when empty', () => {
    expect(parseClauses('', 'comment', NOW)).toEqual({ clauses: {} });
  });
});

describe('matching', () => {
  const metas = [
    meta('1', '10', 'a', 100),
    meta('2', '10', 'b', 200),
    meta('3', '11', 'a', 150, { visType: 'role', visValue: 'Developers' }),
    meta('4', '12', 'c', 50, { projectId: '2' }),
  ];
  it('finds issues with any matching comment', () => {
    expect(issuesWith(metas, { by: 'a' }, { people: { by: new Set(['a']) } })).toEqual(['10', '11']);
  });
  it('checks only the last comment with last', () => {
    expect(issuesWith(metas, { by: 'a' }, { last: true, people: { by: new Set(['a']) } })).toEqual(['11']);
  });
  it('reads visibility for roleLevel and author membership per project for inRole', () => {
    expect(issuesWith(metas, { roleLevel: 'developers' }, {})).toEqual(['11']);
    expect(issuesWith(metas, { inRole: 'Dev' }, { people: { inRole: new Map([['1', new Set(['b'])]]) } })).toEqual(['10']);
  });
  it('applies date windows strictly after and before', () => {
    expect(metaMatches(metas[0], { after: 100 }, {})).toBe(false);
    expect(metaMatches(metas[0], { before: 101 }, {})).toBe(true);
    expect(metaMatches(metas[0], { onStart: 0, onEnd: 100 }, {})).toBe(false);
  });
});
```

- [ ] **Step 2: Run** `npx vitest run test/core/dates.test.js test/core/comment-clauses.test.js` → FAIL.

- [ ] **Step 3: `src/core/dates.js`**

```js
/** One day in ms. */
export const DAY_MS = 86400000;

const UNIT_MS = { m: 60000, h: 3600000, d: DAY_MS, w: 7 * DAY_MS };
const ABSOLUTE = /^(\d{4})[-/](\d{2})[-/](\d{2})(?:[ T](\d{2}):(\d{2}))?$/;
const RELATIVE = /^([-+]?)(\d+)([mhdw])$/;
const CALL = /^(start|end)Of(Day|Week|Month|Year)\(\s*"?(?:([-+]?\d+)([mhdw])?)?"?\s*\)$/i;

/** Midnight UTC of the day that contains ms. */
export function startOfDayMs(ms) {
  return Math.floor(ms / DAY_MS) * DAY_MS;
}

function startOf(unit, ms) {
  const d = new Date(ms);
  if (unit === 'day') return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  if (unit === 'week') return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  if (unit === 'month') return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1);
  return Date.UTC(d.getUTCFullYear(), 0, 1);
}

function shift(unit, ms, n) {
  const d = new Date(ms);
  if (unit === 'day') return ms + n * DAY_MS;
  if (unit === 'week') return ms + n * 7 * DAY_MS;
  if (unit === 'month') return Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + n, d.getUTCDate());
  return Date.UTC(d.getUTCFullYear() + n, d.getUTCMonth(), d.getUTCDate());
}

/** A date argument in UTC: absolute, relative to now (`-7d`) or a start/end function (`startOfWeek(-1)`). */
export function parseDate(text, now) {
  const s = String(text ?? '').trim();
  const abs = ABSOLUTE.exec(s);
  if (abs) {
    const [, y, mo, d, h = '0', mi = '0'] = abs;
    const ms = Date.UTC(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi));
    const back = new Date(ms);
    if (back.getUTCMonth() !== Number(mo) - 1 || back.getUTCDate() !== Number(d)) return { error: `Invalid date "${s}"` };
    return { ms };
  }
  const rel = RELATIVE.exec(s);
  if (rel) return { ms: now + (rel[1] === '-' ? -1 : 1) * Number(rel[2]) * UNIT_MS[rel[3]] };
  const call = CALL.exec(s);
  if (!call) return { error: `Invalid date "${s}"` };
  const unit = call[2].toLowerCase();
  const n = call[3] === undefined ? 0 : Number(call[3]);
  const start = call[4] ? startOf(unit, now) : shift(unit, startOf(unit, now), n);
  const base = call[1].toLowerCase() === 'end' ? shift(unit, start, 1) - 1 : start;
  return { ms: call[4] ? base + n * UNIT_MS[call[4]] : base };
}
```

- [ ] **Step 4: `src/core/comment-clauses.js`**

```js
import { DAY_MS, parseDate, startOfDayMs } from './dates.js';
import { sortIds } from './ids.js';

const KEYWORDS = {
  comment: ['by', 'after', 'before', 'on', 'inrole', 'ingroup', 'rolelevel', 'grouplevel'],
  attachment: ['by', 'after', 'before', 'on', 'ext'],
};
const CANONICAL = { inrole: 'inRole', ingroup: 'inGroup', rolelevel: 'roleLevel', grouplevel: 'groupLevel' };
const WORD = /"((?:[^"\\]|\\.)*)"|(\S+)/g;
const eq = (a, b) => String(a ?? '').toLowerCase() === String(b ?? '').toLowerCase();

/** Clause text → words; a double-quoted part keeps its spaces. */
export function tokenize(text) {
  const s = String(text ?? '');
  const words = [];
  for (const m of s.matchAll(WORD)) {
    if (m[1] !== undefined) words.push(m[1].replace(/\\(.)/g, '$1'));
    else if (m[2].startsWith('"')) return { error: `Unclosed quote in "${s}"` };
    else words.push(m[2]);
  }
  return { words };
}

/** Clauses of commented/lastComment (`comment`) or fileAttached (`attachment`), dates resolved against now. */
export function parseClauses(text, kind, now) {
  const t = tokenize(text);
  if (t.error) return t;
  const allowed = KEYWORDS[kind];
  const clauses = {};
  const seen = new Set();
  for (let i = 0; i < t.words.length; i += 2) {
    const key = t.words[i].toLowerCase();
    if (!allowed.includes(key)) return { error: `Unknown clause "${t.words[i]}"; use ${allowed.map((k) => CANONICAL[k] ?? k).join(', ')}` };
    const name = CANONICAL[key] ?? key;
    if (i + 1 >= t.words.length) return { error: `Clause "${name}" needs a value` };
    if (seen.has(name)) return { error: `Clause "${name}" is given twice` };
    seen.add(name);
    const value = t.words[i + 1];
    if (name === 'after' || name === 'before' || name === 'on') {
      const d = parseDate(value, now);
      if (d.error) return d;
      if (name === 'on') {
        clauses.onStart = startOfDayMs(d.ms);
        clauses.onEnd = clauses.onStart + DAY_MS;
      } else clauses[name] = d.ms;
    } else if (name === 'ext') clauses.ext = value.replace(/^\.+/, '').toLowerCase();
    else clauses[name] = value;
  }
  return { clauses };
}

/** Whether one comment or attachment passes every clause; people holds account ids resolved for by, inGroup and inRole. */
export function metaMatches(meta, clauses, people) {
  if (clauses.by !== undefined && !people?.by?.has(meta.author)) return false;
  if (clauses.inGroup !== undefined && !people?.inGroup?.has(meta.author)) return false;
  if (clauses.inRole !== undefined && !people?.inRole?.get(String(meta.projectId))?.has(meta.author)) return false;
  if (clauses.roleLevel !== undefined && !(meta.visType === 'role' && eq(meta.visValue, clauses.roleLevel))) return false;
  if (clauses.groupLevel !== undefined && !(meta.visType === 'group' && eq(meta.visValue, clauses.groupLevel))) return false;
  if (clauses.after !== undefined && !(meta.createdAt > clauses.after)) return false;
  if (clauses.before !== undefined && !(meta.createdAt < clauses.before)) return false;
  if (clauses.onStart !== undefined && !(meta.createdAt >= clauses.onStart && meta.createdAt < clauses.onEnd)) return false;
  if (clauses.ext !== undefined && meta.ext !== clauses.ext) return false;
  return true;
}

function lastPerIssue(metas) {
  const latest = new Map();
  for (const m of metas) {
    const cur = latest.get(m.issueId);
    if (!cur || m.createdAt > cur.createdAt || (m.createdAt === cur.createdAt && Number(m.id) > Number(cur.id))) latest.set(m.issueId, m);
  }
  return [...latest.values()];
}

/** Issues with a matching comment or attachment; with `last`, only each issue's latest comment is checked. */
export function issuesWith(metas, clauses, { last = false, people = {} } = {}) {
  const pool = last ? lastPerIssue(metas) : metas;
  return sortIds(pool.filter((m) => metaMatches(m, clauses, people)).map((m) => m.issueId));
}
```

- [ ] **Step 5: Run** `npx vitest run test/core` → PASS; `npm run coverage` → PASS (порог ветвлений `src/core/**`); `npm run lint` → 0 ошибок.

- [ ] **Step 6: Commit**

```bash
git add apps/query/src/core apps/query/test/core
git commit -m "JQL-32: Parse UTC dates and comment and attachment clauses

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 26: Выражения dateCompare и expression — чистые функции

**Model:** opus

**Files:**
- Create: `apps/query/src/core/expression.js`
- Test: `apps/query/test/core/expression.test.js`

**Interfaces:**
- Produces: `parseExpression(text) → { ast, fields: string[] } | { error }` (поля — канонические: идентификаторы в нижнем регистре через псевдонимы `originalestimate→timeoriginalestimate`, `remainingestimate→timeestimate`, `due→duedate`, `resolved→resolutiondate`; имена в кавычках — как есть); `evaluate(ast, valueOf, mode: 'date'|'number') → number|boolean|null` (`valueOf(name) → number|null`; длительности: `date` — календарные мс, `number` — рабочие секунды 1d = 8h, 1w = 5d); `fieldValue(raw) → number|null` (число, дата `YYYY-MM-DD`, дата-время Jira с `+0000`, объекты `{ value }`, `{ votes }`, `{ watchCount }`).

- [ ] **Step 1: Падающие тесты** `test/core/expression.test.js`:

```js
import { describe, expect, it } from 'vitest';
import { evaluate, fieldValue, parseExpression } from '../../src/core/expression.js';

const run = (text, values, mode) => {
  const p = parseExpression(text);
  if (p.error) return p;
  return evaluate(p.ast, (name) => values[name] ?? null, mode);
};

describe('parseExpression', () => {
  it('reads precedence and canonical field names', () => {
    const p = parseExpression('timespent > originalestimate * 1.2');
    expect(p.fields).toEqual(['timeoriginalestimate', 'timespent']);
    expect(p.ast).toEqual({ k: 'cmp', op: '>', l: { k: 'field', name: 'timespent' }, r: { k: 'bin', op: '*', l: { k: 'field', name: 'timeoriginalestimate' }, r: { k: 'num', v: 1.2 } } });
  });
  it('keeps quoted field names and duration literals', () => {
    expect(parseExpression('"Story Points" >= 5 and created + 2d < firstCommented').fields).toEqual(['Story Points', 'created', 'firstcommented']);
  });
  it('explains what is wrong', () => {
    expect(parseExpression('timespent >')).toEqual({ error: 'Unexpected end of expression' });
    expect(parseExpression('timespent + 1')).toEqual({ error: 'The expression must compare values, such as a > b' });
    expect(parseExpression('2days > 1')).toEqual({ error: 'Unexpected "2days > 1" at 1' });
    expect(parseExpression('(a > b')).toEqual({ error: 'Missing ")"' });
    expect(parseExpression('a > b c')).toEqual({ error: 'Unexpected "c" at 7' });
    expect(parseExpression('(a > b) + 1 > 2')).toEqual({ error: 'Cannot do arithmetic on a comparison' });
  });
});

describe('evaluate', () => {
  it('compares work time in seconds with 1d = 8h', () => {
    expect(run('timespent > originalestimate * 1.2', { timespent: 36000, timeoriginalestimate: 28800 }, 'number')).toBe(true);
    expect(run('timespent >= 1d', { timespent: 28800 }, 'number')).toBe(true);
    expect(run('timespent >= 1w', { timespent: 5 * 28800 - 1 }, 'number')).toBe(false);
  });
  it('compares dates with calendar intervals', () => {
    const d = Date.UTC(2026, 0, 1);
    expect(run('created + 2d < firstcommented', { created: d, firstcommented: d + 3 * 86400000 }, 'date')).toBe(true);
    expect(run('resolutiondate > duedate', { resolutiondate: d, duedate: d + 1 }, 'date')).toBe(false);
  });
  it('treats a missing value or a division by zero as not matching', () => {
    expect(run('duedate < created', { created: 1 }, 'date')).toBe(false);
    expect(run('votes / watches > 1', { votes: 3, watches: 0 }, 'number')).toBe(false);
  });
  it('combines comparisons with and and or, and negates', () => {
    expect(run('a > 1 and b < 1 or -a < -5', { a: 6, b: 2 }, 'number')).toBe(true);
    expect(run('a > 1 AND b < 1', { a: 6, b: 2 }, 'number')).toBe(false);
  });
});

describe('fieldValue', () => {
  it('reads numbers, dates and Jira objects', () => {
    expect([fieldValue(5), fieldValue('7'), fieldValue('2026-01-02'), fieldValue('2026-01-02T03:04:05.000+0000'), fieldValue({ votes: 2 }), fieldValue({ watchCount: 4 }), fieldValue({ value: 3 }), fieldValue(null), fieldValue('n/a')])
      .toEqual([5, 7, Date.UTC(2026, 0, 2), Date.UTC(2026, 0, 2, 3, 4, 5), 2, 4, 3, null, null]);
  });
});
```

- [ ] **Step 2: Run** `npx vitest run test/core/expression.test.js` → FAIL.

- [ ] **Step 3: `src/core/expression.js`**

```js
const DURATION = { date: { m: 60000, h: 3600000, d: 86400000, w: 604800000 }, number: { m: 60, h: 3600, d: 28800, w: 144000 } };
const ALIASES = { originalestimate: 'timeoriginalestimate', remainingestimate: 'timeestimate', due: 'duedate', resolved: 'resolutiondate' };
const TOKEN = /\s*(?:(\d+(?:\.\d+)?)([wdhm])?(?![A-Za-z0-9_])|([A-Za-z_][A-Za-z0-9_.]*)|"((?:[^"\\]|\\.)*)"|(<=|>=|!=|==|&&|\|\||=|<|>|\+|-|\*|\/|\(|\)))/y;
const COMPARE = new Set(['<', '<=', '>', '>=', '=', '==', '!=']);
const BOOLEAN = new Set(['cmp', 'and', 'or']);

function tokenize(text) {
  const tokens = [];
  TOKEN.lastIndex = 0;
  const s = String(text ?? '');
  while (TOKEN.lastIndex < s.length) {
    if (/^\s*$/.test(s.slice(TOKEN.lastIndex))) break;
    const at = TOKEN.lastIndex;
    const m = TOKEN.exec(s);
    if (!m) return { error: `Unexpected "${s.slice(at).trim()}" at ${at + 1 + (s.slice(at).length - s.slice(at).trimStart().length)}` };
    if (m[1] !== undefined) tokens.push(m[2] ? { t: 'dur', v: Number(m[1]), unit: m[2] } : { t: 'num', v: Number(m[1]) });
    else if (m[3] !== undefined) {
      const word = m[3].toLowerCase();
      if (word === 'and' || word === 'or') tokens.push({ t: 'op', v: word });
      else tokens.push({ t: 'id', v: ALIASES[word] ?? word });
    } else if (m[4] !== undefined) tokens.push({ t: 'id', v: m[4].replace(/\\(.)/g, '$1') });
    else tokens.push({ t: 'op', v: m[5] === '&&' ? 'and' : m[5] === '||' ? 'or' : m[5] });
  }
  return { tokens };
}

function parser(tokens) {
  let i = 0;
  const peek = () => tokens[i];
  const isOp = (...ops) => peek()?.t === 'op' && ops.includes(peek().v);
  const fail = (message) => {
    throw new Error(message);
  };
  const arithmetic = (node) => (BOOLEAN.has(node.k) ? fail('Cannot do arithmetic on a comparison') : node);

  function primary() {
    const tok = tokens[i];
    if (!tok) fail('Unexpected end of expression');
    i += 1;
    if (tok.t === 'num') return { k: 'num', v: tok.v };
    if (tok.t === 'dur') return { k: 'dur', v: tok.v, unit: tok.unit };
    if (tok.t === 'id') return { k: 'field', name: tok.v };
    if (tok.v === '(') {
      const inner = or();
      if (!isOp(')')) fail('Missing ")"');
      i += 1;
      return inner;
    }
    if (tok.v === '-') return { k: 'neg', e: arithmetic(primary()) };
    return fail(`Unexpected "${tok.v}"`);
  }
  function product() {
    let node = primary();
    while (isOp('*', '/')) {
      const op = tokens[i].v;
      i += 1;
      node = { k: 'bin', op, l: arithmetic(node), r: arithmetic(primary()) };
    }
    return node;
  }
  function sum() {
    let node = product();
    while (isOp('+', '-')) {
      const op = tokens[i].v;
      i += 1;
      node = { k: 'bin', op, l: arithmetic(node), r: arithmetic(product()) };
    }
    return node;
  }
  function compare() {
    const left = sum();
    if (peek()?.t === 'op' && COMPARE.has(peek().v)) {
      const op = tokens[i].v;
      i += 1;
      return { k: 'cmp', op, l: arithmetic(left), r: arithmetic(sum()) };
    }
    return left;
  }
  function and() {
    let node = compare();
    while (isOp('and')) {
      i += 1;
      node = { k: 'and', l: node, r: compare() };
    }
    return node;
  }
  function or() {
    let node = and();
    while (isOp('or')) {
      i += 1;
      node = { k: 'or', l: node, r: and() };
    }
    return node;
  }
  return { or, rest: () => tokens.slice(i) };
}

function fieldsOf(node, out = new Set()) {
  if (node.k === 'field') out.add(node.name);
  for (const child of [node.l, node.r, node.e]) if (child) fieldsOf(child, out);
  return out;
}

/** Expression text → AST and the fields it reads, or `{ error }`; the top level must be a comparison. */
export function parseExpression(text) {
  const t = tokenize(text);
  if (t.error) return t;
  try {
    const p = parser(t.tokens);
    const ast = p.or();
    const rest = p.rest();
    if (rest.length) {
      const at = String(text).lastIndexOf(String(rest[0].v)) + 1;
      return { error: `Unexpected "${rest[0].v}" at ${at}` };
    }
    if (!BOOLEAN.has(ast.k)) return { error: 'The expression must compare values, such as a > b' };
    return { ast, fields: [...fieldsOf(ast)].sort() };
  } catch (error) {
    return { error: error.message };
  }
}

function compareValues(op, a, b) {
  if (op === '<') return a < b;
  if (op === '<=') return a <= b;
  if (op === '>') return a > b;
  if (op === '>=') return a >= b;
  if (op === '!=') return a !== b;
  return a === b;
}

/** Value of an AST node: numbers for arithmetic (null when a field is empty), booleans for comparisons. */
export function evaluate(node, valueOf, mode) {
  if (node.k === 'num') return node.v;
  if (node.k === 'dur') return node.v * DURATION[mode][node.unit];
  if (node.k === 'field') return valueOf(node.name) ?? null;
  if (node.k === 'neg') {
    const v = evaluate(node.e, valueOf, mode);
    return v === null ? null : -v;
  }
  if (node.k === 'and') return evaluate(node.l, valueOf, mode) === true && evaluate(node.r, valueOf, mode) === true;
  if (node.k === 'or') return evaluate(node.l, valueOf, mode) === true || evaluate(node.r, valueOf, mode) === true;
  const a = evaluate(node.l, valueOf, mode);
  const b = evaluate(node.r, valueOf, mode);
  if (node.k === 'cmp') return a !== null && b !== null && compareValues(node.op, a, b);
  if (a === null || b === null) return null;
  if (node.op === '+') return a + b;
  if (node.op === '-') return a - b;
  if (node.op === '*') return a * b;
  return b === 0 ? null : a / b;
}

/** A Jira field value as a number: numbers, numeric strings, dates (ms), and objects with value, votes or watchCount. */
export function fieldValue(raw) {
  if (raw === null || raw === undefined) return null;
  if (typeof raw === 'number') return raw;
  if (typeof raw === 'string') {
    if (/^-?\d+(\.\d+)?$/.test(raw)) return Number(raw);
    const text = /^\d{4}-\d{2}-\d{2}$/.test(raw) ? `${raw}T00:00:00Z` : raw.replace(/([+-]\d{2})(\d{2})$/, '$1:$2');
    const t = /^\d{4}-\d{2}-\d{2}T/.test(text) ? Date.parse(text) : NaN;
    return Number.isFinite(t) ? t : null;
  }
  for (const key of ['value', 'votes', 'watchCount']) if (typeof raw[key] === 'number') return raw[key];
  return null;
}
```

Позиция в ошибке (`at 1`, `at 7`) — номер первого непрочитанного символа, считая с 1.

- [ ] **Step 4: Run** `npx vitest run test/core` → PASS; `npm run coverage` → PASS (порог ветвлений `src/core/**`, включая `expression.js`); `npm run lint` → 0 ошибок.

- [ ] **Step 5: Commit**

```bash
git add apps/query/src/core/expression.js apps/query/test/core/expression.test.js
git commit -m "JQL-33: Parse and evaluate field comparisons and arithmetic for dateCompare and expression

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 27: Комментарии и вложения — индекс, функции, эталоны

**Model:** opus

Исполняется, если J-G7 пройден хотя бы по одной части — комментариям или вложениям (Task 21, P-2); отгружаются только прошедшие группы.

**Files:**
- Create: `apps/query/src/compute/comments.js`
- Modify: `apps/query/src/core/limits.js` (`COMMENT_PAGE`), `apps/query/src/infra/schema.js` (v004, v005), `apps/query/src/infra/indexRepo.js`, `apps/query/src/handlers/indexing.js` (часть `comments`, события), `apps/query/src/core/catalog.js` (`SHIPPED_GROUPS` + прошедшие `'comment'`, `'attachment'`), `apps/query/test/core/catalog.test.js`, `apps/query/src/deps.js`, `apps/query/manifest.yml`, `apps/query/scripts/lib/{http.mjs,reference.mjs}`, `apps/query/scripts/acceptance.mjs`
- Test: `apps/query/test/compute/comments.test.js`, `apps/query/test/infra/{schema.test.js,indexRepo.test.js}`, `apps/query/test/handlers/indexing.test.js`

**Interfaces:**
- Consumes: `parseClauses`, `issuesWith` (Task 25), `ERR.notFound`, `ERR.withFunction` (Task 5), `sortIds` (Task 7), `Jira.userIds`, `Jira.groupMemberIds`, `Jira.roleMemberIds` (Task 9), `createIndexing`, локальная `repo` в `createDeps` (Task 23), `myAccountId`, `waitFor`, `latencyResult` (Task 16).
- Produces: таблицы `comment_meta(comment_id PK, issue_id, project_id, author, created_at, updated_at, vis_type, vis_value)`, `attachment_meta(attachment_id PK, issue_id, project_id, author, created_at, ext)`; `IndexRepo.{upsertComments(metas), deleteComment(id), upsertAttachments(metas), deleteAttachment(id), commentMetas({ after, before, authors }) → Meta[], lastCommentMetas() → Meta[], issuesWithCommentCount(n) → string[], attachmentMetas({ ext }) → Meta[], commentBounds(issueIds) → Map<issueId, { first, last }>}`; часть индекса `comments` (`tables: ['comment_meta', 'attachment_meta']`); `createCommentCompute({ jira, repo, now }) → { commented, lastComment, hasComments, fileAttached, hasAttachments }`; `limits.js` += `COMMENT_PAGE = 5000` (комментариев в одном чтении `GET /issue/{id}/comment`); `http.mjs` += `upload(issueId, filename, text)`; эталоны `REFERENCES.{commented,lastComment,hasComments,fileAttached,hasAttachments}` — свой разбор условий, область по умолчанию `project in (JQLG, RPT)` (P-6); случаи `CASES.m3` (через `M3_PARTS`), фазы `fresh --group comment|attachment`.

- [ ] **Step 1: Падающие тесты** `test/compute/comments.test.js`:

```js
import { describe, expect, it } from 'vitest';
import { createCommentCompute } from '../../src/compute/comments.js';

const NOW = Date.UTC(2026, 9, 8);
const meta = (id, issueId, author, createdAt, extra = {}) => ({ id, issueId, projectId: '1', author, createdAt, visType: null, visValue: null, ext: '', ...extra });
const A = '5b10ac8d82e05b22cc7d4ef5';
const B = '5b10ac8d82e05b22cc7d4ef6';
const METAS = [meta('1', '10', A, NOW - 86400000), meta('2', '11', B, NOW - 10 * 86400000), meta('3', '10', B, NOW - 3600000)];

function make(extra = {}) {
  const repo = {
    commentMetas: async () => METAS,
    lastCommentMetas: async () => [METAS[1], METAS[2]],
    issuesWithCommentCount: async (n) => (n <= 1 ? ['10', '11'] : ['10']),
    attachmentMetas: async ({ ext }) => [meta('9', '12', A, NOW - 1000, { ext: 'pdf' })].filter((m) => !ext || m.ext === ext),
  };
  const jira = {
    userIds: async (q) => (q === 'Ann' ? [A] : []),
    groupMemberIds: async () => [B],
    roleMemberIds: async () => [A],
    ...extra,
  };
  return createCommentCompute({ jira, repo, now: () => NOW });
}

describe('comment compute', () => {
  it('commented resolves a user name to account ids', async () => {
    expect(await make().commented({ clauses: 'by Ann after -2d' }, {})).toEqual({ ids: ['10'], field: 'id', watch: null });
  });
  it('commented without clauses means any comment', async () => {
    expect((await make().commented({}, {})).ids).toEqual(['10', '11']);
  });
  it('lastComment checks only the latest comment of each issue', async () => {
    expect((await make().lastComment({ clauses: 'inGroup devs' }, {})).ids).toEqual(['10', '11']);
    expect((await make().lastComment({ clauses: `by ${A}` }, {})).ids).toEqual([]);
  });
  it('names a user nobody matches', async () => {
    expect(await make().commented({ clauses: 'by Nobody' }, {})).toEqual({ error: 'commented: User "Nobody" not found' });
  });
  it('passes clause errors through with the function name', async () => {
    expect(await make().commented({ clauses: 'text x' }, {})).toEqual({ error: 'commented: Unknown clause "text"; use by, after, before, on, inRole, inGroup, roleLevel, groupLevel' });
  });
  it('hasComments counts in SQL', async () => {
    expect((await make().hasComments({ count: 2 }, {})).ids).toEqual(['10']);
    expect((await make().hasComments({}, {})).ids).toEqual(['10', '11']);
  });
  it('hasAttachments without an extension is native JQL, with one it reads the index', async () => {
    expect(await make().hasAttachments({}, {})).toEqual({ native: 'attachments is not EMPTY' });
    expect((await make().hasAttachments({ extension: 'pdf' }, {})).ids).toEqual(['12']);
  });
  it('fileAttached applies attachment clauses', async () => {
    expect((await make().fileAttached({ clauses: 'ext pdf after -1d' }, {})).ids).toEqual(['12']);
  });
});
```

В `test/infra/indexRepo.test.js` дописать:

```js
describe('comment and attachment rows', () => {
  it('upserts comments with their visibility', async () => {
    const { calls, run } = recorder();
    await createIndexRepo(run).upsertComments([
      { id: '1', issueId: '10', projectId: '2', author: 'a', createdAt: 5, updatedAt: 6, visType: 'role', visValue: 'Developers' },
      { id: '2', issueId: '10', projectId: '2', author: 'b', createdAt: 7 },
    ]);
    expect(calls[0]).toEqual([
      'INSERT INTO comment_meta (comment_id, issue_id, project_id, author, created_at, updated_at, vis_type, vis_value) VALUES (?,?,?,?,?,?,?,?), (?,?,?,?,?,?,?,?) ON DUPLICATE KEY UPDATE author = VALUES(author), updated_at = VALUES(updated_at), vis_type = VALUES(vis_type), vis_value = VALUES(vis_value)',
      ['1', '10', '2', 'a', 5, 6, 'role', 'Developers', '2', '10', '2', 'b', 7, 7, null, null],
    ]);
  });
  it('counts comments per issue in SQL', async () => {
    const { calls, run } = recorder([[{ issue_id: 11 }, { issue_id: 10 }]]);
    expect(await createIndexRepo(run).issuesWithCommentCount(3)).toEqual(['10', '11']);
    expect(calls[0]).toEqual(['SELECT issue_id FROM comment_meta GROUP BY issue_id HAVING COUNT(*) >= ?', [3]]);
  });
  it('reads the latest comment of each issue', async () => {
    const { calls, run } = recorder([[{ comment_id: 3, issue_id: 10, project_id: 2, author: 'b', created_at: 9, vis_type: null, vis_value: null }]]);
    expect(await createIndexRepo(run).lastCommentMetas()).toEqual([{ id: '3', issueId: '10', projectId: '2', author: 'b', createdAt: 9, visType: null, visValue: null, ext: '' }]);
    expect(calls[0][0]).toContain('MAX(created_at)');
  });
});
```

В `test/infra/schema.test.js` ожидание имён миграций: `['v001_sprint', 'v002_sprint_event', 'v003_status_event', 'v004_comment_meta', 'v005_attachment_meta']`. В `test/handlers/indexing.test.js` дописать (если Task 24 был пропущен по J-G6, мок каталога остаётся и в его `SHIPPED_GROUPS` добавляются `'comment', 'attachment'`):

```js
describe('comment and attachment events', () => {
  it('stores comment metadata with visibility, drops deleted comments, stores attachments with the extension', async () => {
    const deps = makeDeps();
    deps.repo.upsertComments = vi.fn();
    deps.repo.deleteComment = vi.fn();
    deps.repo.upsertAttachments = vi.fn();
    const indexing = createIndexing(deps);
    await indexing.indexEvent({ eventType: 'avi:jira:commented:issue', issue: { id: '7', fields: { project: { id: '10', key: 'JQLG' } } }, comment: { id: '55', author: { accountId: 'a' }, created: '2026-01-01T00:00:00.000+0000', visibility: { type: 'role', value: 'Developers' } } });
    expect(deps.repo.upsertComments).toHaveBeenCalledWith([{ id: '55', issueId: '7', projectId: '10', author: 'a', createdAt: Date.UTC(2026, 0, 1), updatedAt: Date.UTC(2026, 0, 1), visType: 'role', visValue: 'Developers' }]);
    await indexing.indexEvent({ eventType: 'avi:jira:deleted:comment', comment: { id: '55' } });
    expect(deps.repo.deleteComment).toHaveBeenCalledWith('55');
    await indexing.indexEvent({ eventType: 'avi:jira:created:attachment', attachment: { id: '9', issueId: '7', filename: 'Report.PDF', author: { accountId: 'a' }, created: '2026-01-02T00:00:00.000+0000' } });
    expect(deps.repo.upsertAttachments).toHaveBeenCalledWith([{ id: '9', issueId: '7', projectId: '10', author: 'a', createdAt: Date.UTC(2026, 0, 2), ext: 'pdf' }]);
  });
  it('reads every comment of an issue whose bulkfetch list is cut', async () => {
    const deps = makeDeps();
    deps.repo.upsertComments = vi.fn();
    deps.repo.upsertAttachments = vi.fn();
    deps.jira.bulkIssues = async () => [{ id: '7', fields: { comment: { total: 2, comments: [{ id: '1', author: { accountId: 'a' }, created: 1 }] }, attachment: [] } }];
    deps.jira.call = vi.fn(async () => ({ comments: [{ id: '1', author: { accountId: 'a' }, created: 1 }, { id: '2', author: { accountId: 'b' }, created: 2 }] }));
    await createIndexing(deps).parts.comments.index(['7'], { id: '10', key: 'JQLG' });
    expect(deps.jira.call).toHaveBeenCalledWith('GET', '/rest/api/3/issue/7/comment?maxResults=5000');
    expect(deps.repo.upsertComments.mock.calls[0][0].map((m) => m.id)).toEqual(['1', '2']);
  });
});
```

- [ ] **Step 2: Run** `npx vitest run` → FAIL.

- [ ] **Step 3: Предел, миграции и репозиторий.** В конец `src/core/limits.js`:

```js
/** Comments read in one call when bulkfetch returned only part of an issue's comments. */
export const COMMENT_PAGE = 5000;
```

В `runMigrations` после v003:

```js
    .enqueue('v004_comment_meta', `CREATE TABLE IF NOT EXISTS comment_meta (
      comment_id BIGINT PRIMARY KEY,
      issue_id BIGINT NOT NULL,
      project_id BIGINT NOT NULL,
      author VARCHAR(128) NOT NULL,
      created_at BIGINT NOT NULL,
      updated_at BIGINT NOT NULL,
      vis_type VARCHAR(8) NULL,
      vis_value VARCHAR(255) NULL,
      INDEX idx_cm_issue (issue_id, created_at),
      INDEX idx_cm_author (author, created_at),
      INDEX idx_cm_created (created_at),
      INDEX idx_cm_project (project_id)
    )`)
    .enqueue('v005_attachment_meta', `CREATE TABLE IF NOT EXISTS attachment_meta (
      attachment_id BIGINT PRIMARY KEY,
      issue_id BIGINT NOT NULL,
      project_id BIGINT NOT NULL,
      author VARCHAR(128) NOT NULL,
      created_at BIGINT NOT NULL,
      ext VARCHAR(32) NOT NULL,
      INDEX idx_am_issue (issue_id),
      INDEX idx_am_ext (ext),
      INDEX idx_am_project (project_id)
    )`)
```

В `createIndexRepo` добавить:

```js
    upsertComments: (metas) => insert('comment_meta', ['comment_id', 'issue_id', 'project_id', 'author', 'created_at', 'updated_at', 'vis_type', 'vis_value'],
      metas.map((m) => [m.id, m.issueId, m.projectId, m.author, m.createdAt, m.updatedAt ?? m.createdAt, m.visType ?? null, m.visValue ?? null]),
      ' ON DUPLICATE KEY UPDATE author = VALUES(author), updated_at = VALUES(updated_at), vis_type = VALUES(vis_type), vis_value = VALUES(vis_value)'),
    deleteComment: (id) => run('DELETE FROM comment_meta WHERE comment_id = ?', [id]),
    upsertAttachments: (metas) => insert('attachment_meta', ['attachment_id', 'issue_id', 'project_id', 'author', 'created_at', 'ext'],
      metas.map((m) => [m.id, m.issueId, m.projectId, m.author, m.createdAt, m.ext]), ' ON DUPLICATE KEY UPDATE ext = VALUES(ext)'),
    deleteAttachment: (id) => run('DELETE FROM attachment_meta WHERE attachment_id = ?', [id]),
    async commentMetas({ after, before, authors } = {}) {
      const where = [];
      const params = [];
      if (after !== undefined) {
        where.push('created_at > ?');
        params.push(after);
      }
      if (before !== undefined) {
        where.push('created_at < ?');
        params.push(before);
      }
      if (authors) {
        where.push(`author IN (${marks(authors.length || 1)})`);
        params.push(...(authors.length ? authors : ['']));
      }
      const { rows } = await run(`SELECT comment_id, issue_id, project_id, author, created_at, vis_type, vis_value FROM comment_meta${where.length ? ` WHERE ${where.join(' AND ')}` : ''}`, params);
      return (rows ?? []).map(commentMeta);
    },
    async lastCommentMetas() {
      const { rows } = await run('SELECT c.comment_id, c.issue_id, c.project_id, c.author, c.created_at, c.vis_type, c.vis_value FROM comment_meta c JOIN (SELECT issue_id, MAX(created_at) AS m FROM comment_meta GROUP BY issue_id) l ON c.issue_id = l.issue_id AND c.created_at = l.m');
      return (rows ?? []).map(commentMeta);
    },
    async issuesWithCommentCount(n) {
      const { rows } = await run('SELECT issue_id FROM comment_meta GROUP BY issue_id HAVING COUNT(*) >= ?', [n]);
      return sortIds((rows ?? []).map((r) => r.issue_id));
    },
    async attachmentMetas({ ext } = {}) {
      const { rows } = await run(`SELECT attachment_id, issue_id, project_id, author, created_at, ext FROM attachment_meta${ext ? ' WHERE ext = ?' : ''}`, ext ? [ext] : []);
      return (rows ?? []).map((r) => ({ id: String(r.attachment_id), issueId: String(r.issue_id), projectId: String(r.project_id), author: r.author, createdAt: Number(r.created_at), visType: null, visValue: null, ext: r.ext }));
    },
    async commentBounds(issueIds) {
      const out = new Map();
      for (const part of chunks(issueIds)) {
        const { rows } = await run(`SELECT issue_id, MIN(created_at) AS f, MAX(created_at) AS l FROM comment_meta WHERE issue_id IN (${marks(part.length)}) GROUP BY issue_id`, part);
        for (const r of rows ?? []) out.set(String(r.issue_id), { first: Number(r.f), last: Number(r.l) });
      }
      return out;
    },
```

и в начало `indexRepo.js` — `import { sortIds } from '../core/ids.js';`, а вне `createIndexRepo`:

```js
const commentMeta = (r) => ({ id: String(r.comment_id), issueId: String(r.issue_id), projectId: String(r.project_id), author: r.author, createdAt: Number(r.created_at), visType: r.vis_type ?? null, visValue: r.vis_value ?? null, ext: '' });
```


- [ ] **Step 4: Часть индекса `comments` и события.** В `createIndexing` (Task 23):

```js
const extOf = (name) => (String(name ?? '').includes('.') ? String(name).split('.').pop().toLowerCase().slice(0, 32) : '');
const toMeta = (c, issueId, projectId) => ({ id: String(c.id), issueId: String(issueId), projectId: String(projectId), author: c.author?.accountId ?? '', createdAt: toMs(c.created), updatedAt: toMs(c.updated ?? c.created), visType: c.visibility?.type ?? null, visValue: c.visibility?.value ?? c.visibility?.identifier ?? null });
const toAttachment = (a, issueId, projectId) => ({ id: String(a.id), issueId: String(issueId), projectId: String(projectId), author: a.author?.accountId ?? '', createdAt: toMs(a.created), ext: extOf(a.filename) });
```

```js
    comments: {
      tables: ['comment_meta', 'attachment_meta'],
      async prepare() {},
      async index(ids, project) {
        const comments = [];
        const attachments = [];
        for (const issue of await deps.jira.bulkIssues(ids, ['comment', 'attachment'])) {
          let list = issue.fields?.comment?.comments ?? [];
          if ((issue.fields?.comment?.total ?? 0) > list.length) list = (await deps.jira.call('GET', `/rest/api/3/issue/${issue.id}/comment?maxResults=${COMMENT_PAGE}`))?.comments ?? [];
          comments.push(...list.map((c) => toMeta(c, issue.id, project.id)));
          attachments.push(...(issue.fields?.attachment ?? []).map((a) => toAttachment(a, issue.id, project.id)));
        }
        await deps.repo.upsertComments(comments);
        await deps.repo.upsertAttachments(attachments);
      },
    },
```

В `indexEvent`, до ветки `avi:jira:updated:issue`, при отгруженной части `comments`:

```js
    if (shippedParts().includes('comments')) {
      if (type === 'avi:jira:deleted:comment') {
        await deps.repo.deleteComment(String(event.comment.id));
        return;
      }
      if (type === 'avi:jira:deleted:attachment') {
        await deps.repo.deleteAttachment(String(event.attachment.id));
        return;
      }
      if (type === 'avi:jira:commented:issue' || type === 'avi:jira:updated:comment' || type === 'avi:jira:created:attachment') {
        const project = await projectOf(event.issue ? event : { issue: { id: event.attachment.issueId } });
        if ((await deps.state.excluded()).includes(project.key)) return;
        if (event.comment) await deps.repo.upsertComments([toMeta(event.comment, event.issue.id, project.id)]);
        else await deps.repo.upsertAttachments([toAttachment(event.attachment, event.attachment.issueId, project.id)]);
        return;
      }
    }
```

(`toMs` — импорт из `core/sprint-history.js`; `COMMENT_PAGE` — в импорт из `../core/limits.js`; имена событий — по Task 3.)

- [ ] **Step 5: `src/compute/comments.js`**

```js
import { issuesWith, parseClauses } from '../core/comment-clauses.js';
import { ERR } from '../core/errors.js';
import { sortIds } from '../core/ids.js';

const ACCOUNT = /^[0-9a-f]{24}$|^\d+:[0-9a-f-]{36}$/i;

/** Value sources of the comment and attachment functions over the metadata index. */
export function createCommentCompute({ jira, repo, now }) {
  async function people(clauses, metas) {
    const out = {};
    if (clauses.by !== undefined) {
      const ids = ACCOUNT.test(clauses.by) ? [clauses.by] : await jira.userIds(clauses.by);
      if (!ids.length) return { error: ERR.notFound('User', clauses.by) };
      out.by = new Set(ids);
    }
    if (clauses.inGroup !== undefined) out.inGroup = new Set(await jira.groupMemberIds(clauses.inGroup));
    if (clauses.inRole !== undefined) {
      out.inRole = new Map();
      for (const projectId of new Set(metas.map((m) => m.projectId))) {
        const members = await jira.roleMemberIds(projectId, clauses.inRole);
        out.inRole.set(projectId, new Set(members ?? []));
      }
    }
    return { people: out };
  }

  const run = (name, kind, load, last) => async ({ clauses: text = '' }) => {
    const parsed = parseClauses(text, kind, now());
    if (parsed.error) return { error: ERR.withFunction(name, parsed.error) };
    const metas = await load(parsed.clauses);
    const p = await people(parsed.clauses, metas);
    if (p.error) return { error: ERR.withFunction(name, p.error) };
    return { ids: issuesWith(metas, parsed.clauses, { last, people: p.people }), field: 'id', watch: null };
  };

  return {
    commented: run('commented', 'comment', (c) => repo.commentMetas({ after: c.after ?? (c.onStart !== undefined ? c.onStart - 1 : undefined), before: c.before ?? c.onEnd }), false),
    lastComment: run('lastComment', 'comment', () => repo.lastCommentMetas(), true),
    fileAttached: run('fileAttached', 'attachment', (c) => repo.attachmentMetas({ ext: c.ext }), false),
    async hasComments({ count }) {
      return { ids: await repo.issuesWithCommentCount(count ?? 1), field: 'id', watch: null };
    },
    async hasAttachments({ extension }) {
      if (extension === undefined) return { native: 'attachments is not EMPTY' };
      return { ids: sortIds((await repo.attachmentMetas({ ext: extension })).map((m) => m.issueId)), field: 'id', watch: null };
    },
  };
}
```

`ACCOUNT` узнаёт accountId Atlassian (24 hex или `NNNNNN:uuid`); всё остальное ищется как имя или почта через `user/search`.

- [ ] **Step 6: Отгрузка, манифест, эталоны.** `SHIPPED_GROUPS` += группы, прошедшие J-G7 (Task 21): `'comment'` и/или `'attachment'`; `catalog.test.js` — ожидания; `deps.js` — в литерале `deps` (Task 23) `compute` += `...createCommentCompute({ jira, repo, now: () => Date.now() })`, `repo` — локальная константа `createDeps`; манифест — блок функций из генератора, в `trigger query-events` — события комментариев и вложений (имена по Task 3; события вложений — только если группа `attachment` отгружена).

`scripts/lib/http.mjs` — загрузка вложения (нужна фазе `fresh --group attachment`):

```js
/** Uploads one small file as an attachment of an issue; not retried, because a retry could attach it twice. */
export async function upload(issueId, filename, text) {
  stats.requests += 1;
  const form = new FormData();
  form.append('file', new Blob([text]), filename);
  const res = await fetch(`${SITE}/rest/api/3/issue/${issueId}/attachments`, {
    method: 'POST',
    headers: { Authorization: auth(), Accept: 'application/json', 'X-Atlassian-Token': 'no-check' },
    body: form,
    signal: AbortSignal.timeout(30000),
  });
  if (!res.ok) throw new Error(`upload ${issueId} → ${res.status} ${(await res.text()).slice(0, 300)}`);
  return res.json();
}
```

Эталоны в `reference.mjs` — свой разбор условий и своя проверка, без `src/` (P-6); область по умолчанию — `project in (JQLG, RPT)`, переопределяется `--scope`; поддержаны условия `by` (accountId или имя), `after`/`before`/`on` (`YYYY-MM-DD` или `-N[dhm]`), `inRole`, `inGroup`, `roleLevel`, `groupLevel`, `ext` — образцы ScriptRunner (Task 1) и случаи `CASES.m3` пишутся только этими условиями:

```js
const SCOPE = 'project in (JQLG, RPT)';
const DAY = 86400000;
const commentCache = new Map();

async function allComments(scopeJql) {
  if (commentCache.has(scopeJql)) return commentCache.get(scopeJql);
  const out = [];
  for (const x of await bulk(await must(scopeJql), ['comment', 'attachment', 'project'])) {
    let list = x.fields.comment?.comments ?? [];
    if ((x.fields.comment?.total ?? 0) > list.length) list = (await api('GET', `/rest/api/3/issue/${x.id}/comment?maxResults=5000`)).comments;
    out.push({ id: String(x.id), project: x.fields.project.key, comments: list, attachments: x.fields.attachment ?? [] });
  }
  commentCache.set(scopeJql, out);
  return out;
}

const words = (text) => [...String(text ?? '').matchAll(/"([^"]*)"|(\S+)/g)].map((m) => m[1] ?? m[2]);
const lower = (v) => String(v ?? '').toLowerCase();

function dateOf(text) {
  const rel = /^-(\d+)([dhm])$/.exec(text);
  if (rel) return Date.now() - Number(rel[1]) * { d: DAY, h: 3600000, m: 60000 }[rel[2]];
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return Date.parse(`${text}T00:00:00Z`);
  throw new Error(`reference: unsupported date ${text}`);
}

async function membersOfGroup(name) {
  const out = [];
  for (let startAt = 0; ; startAt += 50) {
    const page = await api('GET', `/rest/api/3/group/member?groupname=${encodeURIComponent(name)}&includeInactiveUsers=true&startAt=${startAt}&maxResults=50`);
    out.push(...page.values.map((u) => u.accountId));
    if (page.isLast || !page.values.length) return new Set(out);
  }
}

async function membersOfRole(projectKey, roleName) {
  const roles = await api('GET', `/rest/api/3/project/${projectKey}/role`);
  const url = Object.entries(roles).find(([name]) => lower(name) === lower(roleName))?.[1];
  if (!url) return new Set();
  const role = await api('GET', `/rest/api/3/project/${projectKey}/role/${String(url).split('/').pop()}`);
  const out = (role.actors ?? []).filter((a) => a.actorUser).map((a) => a.actorUser.accountId);
  for (const a of (role.actors ?? []).filter((x) => x.actorGroup)) out.push(...(await membersOfGroup(a.actorGroup.name)));
  return new Set(out);
}

const DATE_TESTS = {
  after: (t) => (item) => jiraMs(item.created) > t,
  before: (t) => (item) => jiraMs(item.created) < t,
  on: (t) => {
    const day = Math.floor(t / DAY) * DAY;
    return (item) => jiraMs(item.created) >= day && jiraMs(item.created) < day + DAY;
  },
};

/** Clause text → test of one comment or attachment of a project, written apart from the app's parser. */
async function clauseTest(text, projects) {
  const w = words(text);
  const tests = [];
  for (let i = 0; i < w.length; i += 2) {
    const key = lower(w[i]);
    const value = w[i + 1];
    if (value === undefined) throw new Error(`reference: clause ${w[i]} has no value`);
    if (DATE_TESTS[key]) tests.push(DATE_TESTS[key](dateOf(value)));
    else if (key === 'by') {
      const people = /^[0-9a-f]{24}$|^\d+:[0-9a-f-]{36}$/i.test(value) ? [value] : (await api('GET', `/rest/api/3/user/search?query=${encodeURIComponent(value)}`)).map((u) => u.accountId);
      tests.push((item) => people.includes(item.author?.accountId));
    } else if (key === 'ext') tests.push((item) => lower(item.filename).endsWith(`.${lower(value).replace(/^\.+/, '')}`));
    else if (key === 'rolelevel') tests.push((item) => item.visibility?.type === 'role' && lower(item.visibility.value) === lower(value));
    else if (key === 'grouplevel') tests.push((item) => item.visibility?.type === 'group' && [item.visibility.value, item.visibility.identifier].some((v) => lower(v) === lower(value)));
    else if (key === 'ingroup') {
      const members = await membersOfGroup(value);
      tests.push((item) => members.has(item.author?.accountId));
    } else if (key === 'inrole') {
      const byProject = new Map();
      for (const p of projects) byProject.set(p, await membersOfRole(p, value));
      tests.push((item, project) => byProject.get(project).has(item.author?.accountId));
    } else throw new Error(`reference: unsupported clause ${w[i]}`);
  }
  return (item, project) => tests.every((t) => t(item, project));
}

const latest = (comments) => [...comments].sort((a, b) => jiraMs(a.created) - jiraMs(b.created) || Number(a.id) - Number(b.id)).slice(-1);

async function matching(text, scope, itemsOf) {
  const issues = await allComments(scope);
  const test = await clauseTest(text, [...new Set(issues.map((x) => x.project))]);
  return uniq(issues.filter((x) => itemsOf(x).some((item) => test(item, x.project))).map((x) => x.id));
}

Object.assign(REFERENCES, {
  commented: ([text = ''], { scope = SCOPE } = {}) => matching(text, scope, (x) => x.comments),
  lastComment: ([text = ''], { scope = SCOPE } = {}) => matching(text, scope, (x) => latest(x.comments)),
  fileAttached: ([text = ''], { scope = SCOPE } = {}) => matching(text, scope, (x) => x.attachments),
  async hasComments([n], { scope = SCOPE } = {}) {
    return uniq((await allComments(scope)).filter((x) => x.comments.length >= Number(n ?? 1)).map((x) => x.id));
  },
  async hasAttachments([ext], { scope = SCOPE } = {}) {
    const want = ext === undefined ? null : lower(ext).replace(/^\.+/, '');
    return uniq((await allComments(scope)).filter((x) => x.attachments.some((a) => !want || lower(a.filename).endsWith(`.${want}`))).map((x) => x.id));
  },
});
```

В `acceptance.mjs` (в импорт из `./lib/http.mjs` добавить `upload`; если импорта `readFileSync` ещё нет — `import { readFileSync } from 'node:fs';` в начало файла) — блок сразу после `export const FRESH = …` и до `const PHASES`. Случаи M3 собираются из частей (`M3_PARTS`), потому что Task 28 добавляет свою часть и тогда, когда эта задача не исполнялась. Каждый случай сужен до области эталонов (`and` = `project in (JQLG, RPT)`); размер — максимальный, какой дают данные (P-3): `hasComments("1")`, `commented("after 2020-01-01")` и `hasAttachments()` — все задачи с комментариями/вложениями; если результат случая больше ёмкости дерева (9 000 при одном уровне), случай переносится в `CASES.tree2` (Q-R10). Часть вложений (`attachmentCases`, `FRESH.attachment`) добавлять, только если группа `attachment` отгружена; часть комментариев (`commentCases`, `FRESH.comment`) — только если отгружена `comment`:

```js
const REF_SCOPE = 'project in (JQLG, RPT)';
const JG7_SEED = new URL('../../../atlassian/data/jg7-seed.json', import.meta.url);
const M3_PARTS = [];
Object.defineProperty(CASES, 'm3', { enumerable: true, get: () => M3_PARTS.flatMap((part) => part()) });

const commentCases = () => {
  const { comments } = JSON.parse(readFileSync(JG7_SEED, 'utf8'));
  return [
    ['hasComments', ['1'], 'every issue with a comment (site-wide)', REF_SCOPE],
    ['hasComments', ['3'], 'at least 3 comments', REF_SCOPE],
    ['commented', [], 'no clauses: any comment', REF_SCOPE],
    ['commented', ['after 2020-01-01'], 'any author since 2020 (site-wide)', REF_SCOPE],
    ['commented', ['by @me after 2020-01-01'], 'one author, all time', REF_SCOPE],
    ['commented', [`roleLevel "${comments.restricted.role}"`], 'restricted to a role', REF_SCOPE],
    ['commented', [`groupLevel "${comments.restricted.group}"`], 'restricted to a group', REF_SCOPE],
    ['lastComment', ['by @me'], 'last comment by one author', REF_SCOPE],
  ];
};
const attachmentCases = () => [
  ['hasAttachments', [], 'every issue with an attachment (site-wide, native)', REF_SCOPE],
  ['hasAttachments', ['pdf'], 'one extension', REF_SCOPE],
  ['fileAttached', ['ext xlsx after 2020-01-01'], 'extension and date', REF_SCOPE],
];
M3_PARTS.push(commentCases);
M3_PARTS.push(attachmentCases);

FRESH.comment = async () => {
  const me = await myAccountId();
  const today = new Date().toISOString().slice(0, 10);
  const mid = (await ids('project = JQLG AND labels = jg-mid ORDER BY key')).ids;
  const targets = (await bulk(mid, ['comment']))
    .filter((x) => !(x.fields.comment?.comments ?? []).some((c) => c.author?.accountId === me && String(c.created).startsWith(today)))
    .map((x) => String(x.id))
    .slice(0, args.n);
  const rows = { comment: [] };
  const t0 = Date.now();
  for (const [i, x] of targets.entries()) {
    const t = Date.now();
    await api('POST', `/rest/api/3/issue/${x}/comment`, { body: { type: 'doc', version: 1, content: [{ type: 'paragraph', content: [{ type: 'text', text: `aq probe ${i}` }] }] } });
    rows.comment.push(await waitFor(clause('commented', [`by ${me} after ${today}`]), x, true, t));
  }
  const result = latencyResult(rows, t0);
  log(JSON.stringify(result.summary));
  save(tagged('acceptance-fresh-comment'), { stats, ...result });
};

FRESH.attachment = async () => {
  const ext = `aq${Date.now() % 1000000}`;
  const targets = (await ids('project = JQLG AND labels = jg-mid ORDER BY key')).ids.slice(0, args.n);
  const rows = { attachment: [] };
  const t0 = Date.now();
  for (const x of targets) {
    const t = Date.now();
    await upload(x, `probe.${ext}`, 'aq probe');
    rows.attachment.push(await waitFor(clause('hasAttachments', [ext]), x, true, t));
  }
  const result = latencyResult(rows, t0);
  log(JSON.stringify(result.summary));
  save(tagged('acceptance-fresh-attachment'), { stats, ...result });
};
```

Расширение вложения уникально на прогон, поэтому до загрузки ни одна задача ему не соответствует.

- [ ] **Step 7: Run** `npx vitest run` → PASS; `npm run lint` → 0 ошибок; `forge lint` → без ошибок; `node --check apps/query/scripts/acceptance.mjs && node --check apps/query/scripts/lib/reference.mjs && node --check apps/query/scripts/lib/http.mjs` → без вывода.

- [ ] **Step 8: Commit**

```bash
git add apps/query
git commit -m "JQL-34: Ship comment and attachment functions over a metadata index

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 28: dateCompare и expression — вычисление, манифест, эталоны

**Model:** opus

**Files:**
- Create: `apps/query/src/compute/fields.js`
- Modify: `apps/query/src/core/errors.js` (`ERR.needsCommentIndex`), `apps/query/src/core/catalog.js` (`SHIPPED_GROUPS` + `'fields'`), `apps/query/test/core/catalog.test.js`, `apps/query/src/deps.js`, `apps/query/manifest.yml`, `apps/query/scripts/lib/reference.mjs`, `apps/query/scripts/acceptance.mjs`
- Test: `apps/query/test/compute/fields.test.js`

**Interfaces:**
- Consumes: `parseExpression`, `evaluate`, `fieldValue` (Task 26), `ERR.notFound`, `ERR.withFunction` (Task 5), `sortIds` (Task 7), `Jira.fields`, `Jira.searchIds`, `Jira.bulkIssues`, `IndexRepo.commentBounds` (Task 27, если группа `comment` отгружена), локальная `repo` в `createDeps` (Task 23, если исполнялась), `M3_PARTS`, `waitFor`, `latencyResult` (Tasks 16, 27).
- Produces: `createFieldCompute({ jira, repo, commentsShipped: () => boolean }) → { dateCompare, expression }` (результат `{ ids, field: 'id', watch: inner }`); `ERR.needsCommentIndex(field)` — текст ошибки собирается в `src/core/errors.js`, не в `compute`; эталоны `REFERENCES.{dateCompare,expression}` со своим вычислением выражения (P-6); случаи M3 полей и фаза `fresh --group fields`.

- [ ] **Step 1: Падающие тесты** `test/compute/fields.test.js`:

```js
import { describe, expect, it } from 'vitest';
import { createFieldCompute } from '../../src/compute/fields.js';

const FIELDS = [{ id: 'created', name: 'Created' }, { id: 'duedate', name: 'Due date' }, { id: 'resolutiondate', name: 'Resolved' }, { id: 'timespent', name: 'Time Spent' }, { id: 'timeoriginalestimate', name: 'Original Estimate' }, { id: 'customfield_10016', name: 'Story Points' }];
const ISSUES = [
  { id: '1', fields: { created: '2026-01-01T00:00:00.000+0000', duedate: '2026-01-05', resolutiondate: '2026-01-07T00:00:00.000+0000', timespent: 36000, timeoriginalestimate: 28800, customfield_10016: 8 } },
  { id: '2', fields: { created: '2026-01-01T00:00:00.000+0000', duedate: '2026-01-10', resolutiondate: '2026-01-07T00:00:00.000+0000', timespent: 3600, timeoriginalestimate: 28800, customfield_10016: null } },
];

function make({ comments = false } = {}) {
  const calls = [];
  const jira = {
    fields: async () => FIELDS,
    searchIds: async () => ['1', '2'],
    bulkIssues: async (ids, fields) => {
      calls.push(fields);
      return ISSUES;
    },
  };
  const repo = { commentBounds: async () => new Map([['1', { first: Date.UTC(2026, 0, 4), last: Date.UTC(2026, 0, 6) }]]) };
  return { compute: createFieldCompute({ jira, repo, commentsShipped: () => comments }), calls };
}

describe('field compute', () => {
  it('dateCompare compares date fields with calendar intervals', async () => {
    expect(await make().compute.dateCompare({ subquery: 'S', expression: 'resolutiondate > duedate' }, { reconcile: [] })).toEqual({ ids: ['1'], field: 'id', watch: ['1', '2'] });
  });
  it('expression uses work time and reads only the fields it needs', async () => {
    const { compute, calls } = make();
    expect((await compute.expression({ subquery: 'S', expression: 'timespent > originalestimate * 1.2' }, { reconcile: [] })).ids).toEqual(['1']);
    expect(calls[0]).toEqual(['timeoriginalestimate', 'timespent']);
  });
  it('resolves a quoted display name to its field id', async () => {
    expect((await make().compute.expression({ subquery: 'S', expression: '"Story Points" >= 5' }, { reconcile: [] })).ids).toEqual(['1']);
  });
  it('reads firstCommented from the comment index when it is shipped', async () => {
    expect((await make({ comments: true }).compute.dateCompare({ subquery: 'S', expression: 'created + 2d < firstCommented' }, { reconcile: [] })).ids).toEqual(['1']);
  });
  it('explains an unknown field, a parse error and firstCommented without the comment index', async () => {
    const { compute } = make();
    expect(await compute.expression({ subquery: 'S', expression: 'nope > 1' }, { reconcile: [] })).toEqual({ error: 'expression: Field "nope" not found' });
    expect(await compute.expression({ subquery: 'S', expression: 'timespent >' }, { reconcile: [] })).toEqual({ error: 'expression: Unexpected end of expression' });
    expect(await compute.dateCompare({ subquery: 'S', expression: 'created < firstCommented' }, { reconcile: [] })).toEqual({ error: 'dateCompare: firstCommented needs the comment index, which this site does not have' });
  });
});
```

- [ ] **Step 2: Run** `npx vitest run test/compute/fields.test.js` → FAIL.

- [ ] **Step 3: Текст ошибки и `src/compute/fields.js`.** В `ERR` (`src/core/errors.js`) добавить:

```js
  needsCommentIndex: (field) => `${field} needs the comment index, which this site does not have`,
```

`src/compute/fields.js`:

```js
import { ERR } from '../core/errors.js';
import { evaluate, fieldValue, parseExpression } from '../core/expression.js';
import { sortIds } from '../core/ids.js';

const PSEUDO = new Set(['firstcommented', 'lastcommented']);
const PSEUDO_NAME = { firstcommented: 'firstCommented', lastcommented: 'lastCommented' };

/** Value sources of dateCompare and expression: the subquery's issues whose field expression is true. */
export function createFieldCompute({ jira, repo, commentsShipped }) {
  async function fieldIds(names) {
    const all = await jira.fields();
    const out = new Map();
    for (const name of names) {
      if (PSEUDO.has(name)) continue;
      const f = all.find((x) => x.id.toLowerCase() === name.toLowerCase()) ?? all.find((x) => String(x.name).toLowerCase() === name.toLowerCase());
      if (!f) return { error: ERR.notFound('Field', name) };
      out.set(name, f.id);
    }
    return { ids: out };
  }

  const run = (functionName, mode) => async ({ subquery, expression }, { reconcile }) => {
    const parsed = parseExpression(expression);
    if (parsed.error) return { error: ERR.withFunction(functionName, parsed.error) };
    const pseudo = parsed.fields.filter((f) => PSEUDO.has(f));
    if (pseudo.length && !commentsShipped()) return { error: ERR.withFunction(functionName, ERR.needsCommentIndex(PSEUDO_NAME[pseudo[0]])) };
    const map = await fieldIds(parsed.fields);
    if (map.error) return { error: ERR.withFunction(functionName, map.error) };
    const inner = await jira.searchIds(subquery, { reconcile });
    const issues = await jira.bulkIssues(inner, [...new Set(map.ids.values())].sort());
    const bounds = pseudo.length ? await repo.commentBounds(inner) : new Map();
    const matching = issues.filter((issue) => evaluate(parsed.ast, (name) => {
      if (name === 'firstcommented') return bounds.get(String(issue.id))?.first ?? null;
      if (name === 'lastcommented') return bounds.get(String(issue.id))?.last ?? null;
      return fieldValue(issue.fields?.[map.ids.get(name)]);
    }, mode) === true);
    return { ids: sortIds(matching.map((x) => x.id)), field: 'id', watch: inner };
  };

  return { dateCompare: run('dateCompare', 'date'), expression: run('expression', 'number') };
}
```

- [ ] **Step 4: Отгрузка, манифест, эталоны.** `SHIPPED_GROUPS` += `'fields'`; `catalog.test.js` — ожидания; `deps.js` — в литерале `deps` (Task 23) `compute` += `...createFieldCompute({ jira, repo, commentsShipped: () => SHIPPED_GROUPS.includes('comment') })`, где `repo` — локальная константа `createDeps` (объявлена до литерала, Task 23); если Task 23 не исполнялась, константы нет и вызов пишется `createFieldCompute({ jira, repo: null, commentsShipped: () => SHIPPED_GROUPS.includes('comment') })` — `commentsShipped()` тогда ложно, и `repo` не читается. Обращаться к `deps.repo` внутри литерала `deps` нельзя: это ReferenceError при загрузке модуля. Манифест — блок из генератора.

Эталоны в `reference.mjs` — своё вычисление выражения над полями, без `src/` (P-6): свой разбор (поля и имена в кавычках, псевдонимы `originalestimate`, `remainingestimate`, `due`, `resolved`, числа, длительности `Nw/Nd/Nh/Nm` — календарные для `dateCompare`, рабочие 1d = 8h, 1w = 5d для `expression`, `+ - * /`, сравнения, `and`/`or`, `&&`/`||`), поля по id или имени из `/rest/api/3/field`, `firstCommented`/`lastCommented` — по комментариям REST; пустое поле или деление на ноль — сравнение ложно:

```js
const DURATION_REF = { date: { m: 60000, h: 3600000, d: 86400000, w: 604800000 }, number: { m: 60, h: 3600, d: 28800, w: 144000 } };
const FIELD_ALIAS = { originalestimate: 'timeoriginalestimate', remainingestimate: 'timeestimate', due: 'duedate', resolved: 'resolutiondate' };
const COMMENT_BOUNDS = new Set(['firstcommented', 'lastcommented']);
const CMP_REF = { '<': (a, b) => a < b, '<=': (a, b) => a <= b, '>': (a, b) => a > b, '>=': (a, b) => a >= b, '=': (a, b) => a === b, '==': (a, b) => a === b, '!=': (a, b) => a !== b };

/** Expression text → { test(get), fields }, written apart from the app's parser. */
function compileExpression(text, mode) {
  const tokens = [...String(text).matchAll(/(\d+(?:\.\d+)?)([wdhm])?(?![\w])|([A-Za-z_][\w.]*)|"([^"]*)"|(<=|>=|!=|==|&&|\|\||[=<>+\-*/()])|(\S)/g)];
  const fields = new Set();
  let i = 0;
  const op = () => tokens[i]?.[5] ?? (['and', 'or'].includes(String(tokens[i]?.[3]).toLowerCase()) ? String(tokens[i][3]).toLowerCase() : undefined);
  const fail = () => {
    throw new Error(`reference: cannot read ${text}`);
  };
  const arith = (l, r, o) => (get) => {
    const a = l(get);
    const b = r(get);
    if (a === null || b === null) return null;
    if (o === '+') return a + b;
    if (o === '-') return a - b;
    if (o === '*') return a * b;
    return b === 0 ? null : a / b;
  };
  function atom() {
    const t = tokens[i];
    i += 1;
    if (!t || t[6] !== undefined) return fail();
    if (t[1] !== undefined) {
      const v = Number(t[1]) * (t[2] ? DURATION_REF[mode][t[2]] : 1);
      return () => v;
    }
    if (t[5] === '(') {
      const inner = or();
      i += 1;
      return inner;
    }
    if (t[5] === '-') {
      const e = atom();
      return (get) => (e(get) === null ? null : -e(get));
    }
    if (t[5] !== undefined) return fail();
    const name = t[4] ?? FIELD_ALIAS[t[3].toLowerCase()] ?? t[3].toLowerCase();
    fields.add(name);
    return (get) => get(name);
  }
  function term() {
    let e = atom();
    while (op() === '*' || op() === '/') {
      const o = op();
      i += 1;
      e = arith(e, atom(), o);
    }
    return e;
  }
  function sum() {
    let e = term();
    while (op() === '+' || op() === '-') {
      const o = op();
      i += 1;
      e = arith(e, term(), o);
    }
    return e;
  }
  function cmp() {
    const l = sum();
    const o = op();
    if (!CMP_REF[o]) return fail();
    i += 1;
    const r = sum();
    return (get) => {
      const a = l(get);
      const b = r(get);
      return a !== null && b !== null && CMP_REF[o](a, b);
    };
  }
  function and() {
    let e = cmp();
    while (op() === 'and' || op() === '&&') {
      i += 1;
      const l = e;
      const r = cmp();
      e = (get) => l(get) && r(get);
    }
    return e;
  }
  function or() {
    let e = and();
    while (op() === 'or' || op() === '||') {
      i += 1;
      const l = e;
      const r = and();
      e = (get) => l(get) || r(get);
    }
    return e;
  }
  const test = or();
  if (i < tokens.length) fail();
  return { test, fields: [...fields] };
}

function valueOfField(raw) {
  if (raw === null || raw === undefined) return null;
  if (typeof raw === 'number') return raw;
  if (typeof raw === 'object') return ['votes', 'watchCount', 'value'].map((k) => raw[k]).find((v) => typeof v === 'number') ?? null;
  if (/^-?\d+(\.\d+)?$/.test(raw)) return Number(raw);
  const t = /^\d{4}-\d{2}-\d{2}$/.test(raw) ? Date.parse(`${raw}T00:00:00Z`) : jiraMs(raw);
  return Number.isFinite(t) ? t : null;
}

async function fieldExpression([q, expr], mode) {
  const { test, fields } = compileExpression(expr, mode);
  const all = await api('GET', '/rest/api/3/field');
  const idOf = new Map(fields.filter((f) => !COMMENT_BOUNDS.has(f)).map((f) => [f, (all.find((x) => x.id.toLowerCase() === f.toLowerCase()) ?? all.find((x) => x.name.toLowerCase() === f.toLowerCase())).id]));
  const issues = await bulk(await must(q), [...new Set(idOf.values())]);
  const bounds = new Map();
  if (fields.some((f) => COMMENT_BOUNDS.has(f))) {
    for (const x of await allComments(q)) {
      const times = x.comments.map((c) => jiraMs(c.created));
      if (times.length) bounds.set(x.id, { firstcommented: Math.min(...times), lastcommented: Math.max(...times) });
    }
  }
  return uniq(issues.filter((x) => test((name) => (COMMENT_BOUNDS.has(name) ? bounds.get(String(x.id))?.[name] ?? null : valueOfField(x.fields[idOf.get(name)])))).map((x) => x.id));
}

Object.assign(REFERENCES, {
  dateCompare: (userArgs) => fieldExpression(userArgs, 'date'),
  expression: (userArgs) => fieldExpression(userArgs, 'number'),
});
```

`allComments` — из эталонов Task 27; если Task 27 не исполнялась, псевдополя не отгружены, и ветка `firstCommented`/`lastCommented` не вызывается — тогда объявить `allComments` так же, как в Task 27 (функция и `commentCache`), чтобы модуль загружался.

В `acceptance.mjs` — блок сразу после `export const FRESH = …` и до `const PHASES`. Если Task 27 не исполнялась — сначала объявить `M3_PARTS` и геттер `CASES.m3` так же, как в Task 27. Случай `expression` на 50 000 значений (`project in (JQLG, RPT)`, `votes >= 0`) здесь не ставится: при `TREE_LEVELS = 1` (ёмкость 9 000, Q-R10) это ожидаемая ошибка «The result needs 50,000 issues…», а не неполнота; он живёт только в `CASES.tree2` (Task 30). Размер внутреннего запроса — максимальный, какой дают данные (P-3):

```js
M3_PARTS.push(() => [
  ['dateCompare', ['project in (JQLG, RPT)', 'resolutiondate > duedate'], 'dates over 50 000 issues'],
  ['expression', ['project in (JQLG, RPT)', 'timespent > originalestimate * 1.2'], 'work time over 50 000 issues'],
  ['expression', ['project = RPT AND key <= RPT-8500', 'votes >= 0'], '8 500 values: one-level tree (> 1 000, ≤ 9 000)'],
]);

FRESH.fields = async () => {
  const day = 86400000;
  const resolvedMs = (x) => Date.parse(x.fields.resolutiondate.replace(/([+-]\d{2})(\d{2})$/, '$1:$2'));
  const dueMs = (x) => (x.fields.duedate ? Date.parse(`${x.fields.duedate}T00:00:00Z`) : null);
  const resolved = await bulk((await ids('project = RPT AND resolution is not EMPTY ORDER BY key')).ids, ['duedate', 'resolutiondate']);
  const targets = resolved.filter((x) => x.fields.resolutiondate && (dueMs(x) === null || dueMs(x) >= resolvedMs(x))).slice(0, args.n);
  const C = clause('dateCompare', ['project = RPT', 'resolutiondate > duedate']);
  const rows = { enter: [], leave: [] };
  const t0 = Date.now();
  for (const x of targets) {
    const dayBefore = new Date(Math.floor(resolvedMs(x) / day) * day - day).toISOString().slice(0, 10);
    let t = Date.now();
    await api('PUT', `/rest/api/3/issue/${x.id}`, { fields: { duedate: dayBefore } });
    rows.enter.push(await waitFor(C, x.id, true, t));
    t = Date.now();
    await api('PUT', `/rest/api/3/issue/${x.id}`, { fields: { duedate: x.fields.duedate ?? null } });
    rows.leave.push(await waitFor(C, x.id, false, t));
    log(`fields ${x.id}: in ${rows.enter.at(-1)} s out ${rows.leave.at(-1)} s`);
  }
  const result = latencyResult(rows, t0);
  log(JSON.stringify(result.summary));
  save(tagged('acceptance-fresh-fields'), { stats, ...result });
};
```

Если на RPT нет задач с `duedate` раньше `resolutiondate` или с учётом времени — фаза `seed-fields` в `acceptance.mjs` проставляет 50 задачам RPT `duedate`, `resolution`/переход в Done и `timetracking` через REST (числа — в лог).

- [ ] **Step 5: Run** `npx vitest run` → PASS; `npm run coverage` → PASS (порог ветвлений `src/core/**`); `npm run lint` → 0 ошибок; `forge lint` → без ошибок; `node --check apps/query/scripts/acceptance.mjs && node --check apps/query/scripts/lib/reference.mjs` → без вывода.

- [ ] **Step 6: Commit**

```bash
git add apps/query
git commit -m "JQL-35: Ship dateCompare and expression over the subquery's fields

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 29: Админ-страница — исключение проектов, переиндексация проекта, сброс индекса

**Model:** opus

Исполняется, только если исполнялась Task 23 (индекс есть): по §3 админ-страница управляет только индексом, а исключение проектов действует только на индекс (Q-R13); без Task 23 нет `backfill.js`, `indexParts` и `repo`, на которые опирается `admin.js`. Если Task 23 не исполнялась (не пройдены ни J-G6, ни J-G7), вместо шагов ниже — **Без индекса: убрать админ-страницу**:
  1. `manifest.yml`: удалить модуль `jira:adminPage` (`query-admin-page`) и ресурс `admin-page`;
  2. `locales/*.json` (26): удалить ключ `module.adminPage.title`; в `test/manifestLocales.test.js` — `const KEYS = ['module.globalPage.title'];`;
  3. `static/app`: удалить `admin-page/index.html`, `src/app/adminMain.jsx`, `src/app/AdminApp.jsx`; в `vite.config.js` — `pageDirs = { 'global-page': 'global-page' }`; в `package.json` — `"build": "vite build --mode global-page"`; ключ `admin.title` — из 26 файлов `src/i18n/locales`;
  4. `npx vitest run` → PASS; `npm --prefix static/app test` → PASS; `npm run build:ui` → только `dist/global-page`; `forge lint` → без ошибок;
  5. коммит `git add apps/query && git commit -m "JQL-36: Remove the admin page: without an index there is nothing to manage" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"`; дальше — Task 30. В Task 33 матрица без `admin`, в Task 32 чек-лист без пункта 7, в Task 34 листинг и правовые страницы без админ-страницы.

**Files:**
- Create: `apps/query/src/handlers/admin.js`, `apps/query/static/app/src/admin/{AdminPanel.jsx,ResetDialog.jsx}`
- Modify: `apps/query/src/core/limits.js` (`EXCLUDED_MAX`), `apps/query/src/handlers/resolvers.js`, `apps/query/src/deps.js` (`isAdmin`), `apps/query/static/app/src/app/AdminApp.jsx`, `apps/query/static/app/src/api.js` (`KNOWN_CODES` + `'busy'`), `apps/query/static/app/src/i18n/locales/*.json` (26)
- Test: `apps/query/test/handlers/admin.test.js`, `apps/query/static/app/test/admin.test.jsx`

**Interfaces:**
- Consumes: `startBackfill` (Task 23), `IndexRepo.deleteProject`, `IndexRepo.clear` (Task 23), `createIndexing(...).shippedParts`, `parts[p].tables`, `state.setExcluded`, `state.progress`; UI — общие `Card` и `IndexProgress` (Task 15, импорт, не копия).
- Produces: резолверы (все требуют лицензию и права администратора Jira, иначе `forbidden`): `adminStatus → { excluded: string[], progress, parts: string[] }`, `setExcluded({ projectKeys: string[] ≤ 200 }) → { excluded }`, `reindexProject({ projectKey }) → { started: string[] }` (`busy`, пока идёт полное заполнение), `resetIndex() → { started: string[] }`; `deps.isAdmin(context) → Promise<boolean>` (боевой: `api.asUser().requestJira(route\`/rest/api/3/mypermissions?permissions=ADMINISTER\`)` → `permissions.ADMINISTER.havePermission`).

- [ ] **Step 1: Падающие тесты** `test/handlers/admin.test.js`:

```js
import { describe, expect, it, vi } from 'vitest';
import { createFakeKvs } from '../fakeKvs.js';
import { createState } from '../../src/infra/state.js';
import { createAdminActions } from '../../src/handlers/admin.js';

function makeDeps({ admin = true } = {}) {
  const state = createState({ kvs: createFakeKvs() });
  return {
    state,
    isAdmin: async () => admin,
    now: () => 50,
    repo: { deleteProject: vi.fn(async () => {}), clear: vi.fn(async () => {}) },
    jira: { projects: async () => [{ id: '1', key: 'A' }, { id: '2', key: 'B' }], approximateCount: async () => 10 },
    indexParts: { sprint: { tables: ['sprint_event', 'status_event'], prepare: async () => {} } },
    shippedParts: () => ['sprint'],
    backfillQueue: { push: vi.fn(async () => {}) },
  };
}
const DEV = { environmentType: 'DEVELOPMENT' };

describe('admin actions', () => {
  it('refuses a user who is not a Jira administrator', async () => {
    await expect(createAdminActions(makeDeps({ admin: false })).setExcluded({ projectKeys: ['A'] }, DEV)).rejects.toThrow('forbidden');
  });
  it('excludes projects and deletes their index rows', async () => {
    const deps = makeDeps();
    expect(await createAdminActions(deps).setExcluded({ projectKeys: ['B', 'A', 'B'] }, DEV)).toEqual({ excluded: ['A', 'B'] });
    expect(deps.repo.deleteProject.mock.calls).toEqual([['1', ['sprint_event', 'status_event']], ['2', ['sprint_event', 'status_event']]]);
  });
  it('rejects malformed project keys', async () => {
    await expect(createAdminActions(makeDeps()).setExcluded({ projectKeys: ['a b'] }, DEV)).rejects.toThrow('bad-request');
  });
  it('reindexes one project only when no full fill is running', async () => {
    const deps = makeDeps();
    await deps.state.progress.setPart('sprint', { generation: 1, finishedAt: null, readyAt: null });
    await expect(createAdminActions(deps).reindexProject({ projectKey: 'A' }, DEV)).rejects.toThrow('busy');
    await deps.state.progress.setPart('sprint', { generation: 1, finishedAt: 9, readyAt: 9 });
    expect(await createAdminActions(deps).reindexProject({ projectKey: 'A' }, DEV)).toEqual({ started: ['sprint'] });
    expect(deps.repo.deleteProject).toHaveBeenCalledWith('1', ['sprint_event', 'status_event']);
    expect((await deps.state.progress.getPart('sprint')).readyAt).toBe(9);
  });
  it('resets the index and builds it again from scratch', async () => {
    const deps = makeDeps();
    await deps.state.progress.setPart('sprint', { generation: 1, finishedAt: 9, readyAt: 9 });
    expect(await createAdminActions(deps).resetIndex({}, DEV)).toEqual({ started: ['sprint'] });
    expect(deps.repo.clear).toHaveBeenCalledWith(['sprint_event', 'status_event']);
    expect((await deps.state.progress.getPart('sprint')).readyAt).toBeNull();
  });
});
```

`static/app/test/admin.test.jsx`:

```jsx
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

const invoke = vi.fn(async (key) => (key === 'adminStatus' ? { excluded: ['RPT'], progress: null, parts: ['sprint'] } : { excluded: [], started: ['sprint'] }));
vi.mock('@forge/bridge', () => ({
  invoke: (...a) => invoke(...a),
  requestJira: async () => ({ ok: true, json: async () => ({ values: [{ key: 'RPT', name: 'Reports' }, { key: 'JQLG', name: 'JQL' }], isLast: true }) }),
}));
const { I18nProvider } = await import('../src/i18n/index.js');
const { AdminPanel } = await import('../src/admin/AdminPanel.jsx');

describe('AdminPanel', () => {
  it('shows the excluded projects and saves a change', async () => {
    render(<I18nProvider locale="en-US"><AdminPanel /></I18nProvider>);
    expect(await screen.findByText('Reports (RPT)')).toBeTruthy();
    fireEvent.click(screen.getByTestId('save-excluded'));
    await waitFor(() => expect(invoke).toHaveBeenCalledWith('setExcluded', { projectKeys: ['RPT'] }));
  });
  it('asks before resetting the index', async () => {
    render(<I18nProvider locale="en-US"><AdminPanel /></I18nProvider>);
    fireEvent.click(await screen.findByTestId('reset-index'));
    expect(screen.getByText('Rebuild the whole index?')).toBeTruthy();
    fireEvent.click(screen.getByTestId('reset-confirm'));
    await waitFor(() => expect(invoke).toHaveBeenCalledWith('resetIndex', {}));
  });
});
```

Run: `npx vitest run test/handlers/admin.test.js` и `npm --prefix static/app test` → FAIL.

- [ ] **Step 2: Предел и `src/handlers/admin.js`.** В конец `src/core/limits.js`:

```js
/** Projects one save may exclude from the index. */
export const EXCLUDED_MAX = 200;
```

`src/handlers/admin.js`:

```js
import { decideLicence } from '../access.js';
import { EXCLUDED_MAX } from '../core/limits.js';
import { startBackfill } from './backfill.js';

const PROJECT_KEY = /^[A-Z][A-Z0-9_]{0,99}$/;
const fail = (code) => {
  throw new Error(code);
};

/** Admin page actions: exclusion, project reindex and full reset; Jira administrators only. */
export function createAdminActions(deps) {
  const tablesOf = (part) => deps.indexParts[part].tables;

  async function guard(context) {
    if (!decideLicence({ environmentType: context?.environmentType, license: context?.license }).licensed) fail('unlicensed');
    if (!(await deps.isAdmin(context))) fail('forbidden');
  }

  async function fullFillRunning() {
    for (const part of deps.shippedParts()) {
      const p = await deps.state.progress.getPart(part);
      if (p && !p.finishedAt) return true;
    }
    return false;
  }

  return {
    async adminStatus(payload, context) {
      await guard(context);
      return { excluded: await deps.state.excluded(), progress: await deps.state.progress.get(), parts: deps.shippedParts() };
    },
    async setExcluded({ projectKeys } = {}, context) {
      await guard(context);
      if (!Array.isArray(projectKeys) || projectKeys.length > EXCLUDED_MAX || !projectKeys.every((k) => PROJECT_KEY.test(k))) fail('bad-request');
      const before = new Set(await deps.state.excluded());
      await deps.state.setExcluded(projectKeys);
      const after = await deps.state.excluded();
      const projects = await deps.jira.projects();
      for (const project of projects.filter((p) => after.includes(p.key) && !before.has(p.key))) {
        for (const part of deps.shippedParts()) await deps.repo.deleteProject(project.id, tablesOf(part));
      }
      const returned = projects.filter((p) => before.has(p.key) && !after.includes(p.key));
      if (returned.length && !(await fullFillRunning())) {
        for (const part of deps.shippedParts()) await startBackfill(deps, part, { projects: returned });
      }
      return { excluded: after };
    },
    async reindexProject({ projectKey } = {}, context) {
      await guard(context);
      if (!PROJECT_KEY.test(String(projectKey))) fail('bad-request');
      if (await fullFillRunning()) fail('busy');
      const project = (await deps.jira.projects()).find((p) => p.key === projectKey) ?? fail('not-found');
      for (const part of deps.shippedParts()) {
        await deps.repo.deleteProject(project.id, tablesOf(part));
        await startBackfill(deps, part, { projects: [project] });
      }
      return { started: deps.shippedParts() };
    },
    async resetIndex(payload, context) {
      await guard(context);
      for (const part of deps.shippedParts()) {
        await deps.repo.clear(tablesOf(part));
        await deps.state.progress.clearPart(part);
        await startBackfill(deps, part);
      }
      return { started: deps.shippedParts() };
    },
  };
}
```

В `createResolverDefinitions` добавить ключи: `adminStatus`, `setExcluded`, `reindexProject`, `resetIndex` — каждый `({ payload, context }) => actions[key](payload ?? {}, context)`, ошибки с кодами `unlicensed|forbidden|bad-request|not-found|busy` пробрасываются, остальные — `console.error` с именем ключа и `throw new Error('internal')` (как в Reports). `src/deps.js`:

```js
import api, { route } from '@forge/api';

const isAdmin = async () => {
  const res = await api.asUser().requestJira(route`/rest/api/3/mypermissions?permissions=ADMINISTER`);
  if (!res.ok) return false;
  return (await res.json()).permissions?.ADMINISTER?.havePermission === true;
};
```

и `isAdmin` в объект `deps`.

- [ ] **Step 3: UI.** `src/admin/AdminPanel.jsx` — три карточки `Card` (`import { Card } from '../components/Card.jsx'`, Task 15; свой `cardStyles` не заводить):
  1. «Projects excluded from the index» — `@atlaskit/select` `isMulti` с проектами из `requestJira('/rest/api/3/project/search?maxResults=100')` (все страницы), подпись `Name (KEY)`, начальное значение — `adminStatus.excluded`; основная кнопка «Save» (`testId="save-excluded"`) → `call('setExcluded', { projectKeys })`; ниже — `SectionMessage` с объяснением: исключённые проекты не попадают в индекс истории спринтов, комментариев и вложений; функции по запросу их видят;
  2. «Reindex a project» — одиночный `Select` + кнопка; ошибка `busy` → `SectionMessage` «Wait until the index is built»;
  3. «Rebuild the whole index» — кнопка `appearance="danger"` (`testId="reset-index"`) открывает `ResetDialog` (`@atlaskit/modal-dialog`: заголовок «Rebuild the whole index?», текст о том, что функции истории покажут «Index is building…» до конца заполнения, кнопки «Cancel» и «Rebuild» (`testId="reset-confirm"`) → `call('resetIndex', {})`).
  Под карточками — прогресс частей индекса: `<IndexProgress progress={status.progress} />` (`import { IndexProgress } from '../status/IndexProgress.jsx'`, Task 15 — тот же компонент, что в `StatusPanel`, не копия разметки). `AdminApp.jsx` — `AccessGate` → `AppHeader` с `t('admin.title')` → `AdminPanel`; ошибка `forbidden` → `EmptyState` «Only Jira administrators can change these settings.».
  Ключи `en-US.json`:

```json
{
  "admin.excluded.title": "Projects excluded from the index",
  "admin.excluded.help": "Sprint history, comment and attachment functions ignore these projects. Functions over a subquery still read them.",
  "admin.excluded.save": "Save",
  "admin.excluded.saved": "Saved",
  "admin.reindex.title": "Reindex a project",
  "admin.reindex.action": "Reindex",
  "admin.reindex.busy": "Wait until the index is built, then try again.",
  "admin.reindex.started": "Reindexing {project}",
  "admin.reset.title": "Rebuild the whole index",
  "admin.reset.action": "Rebuild",
  "admin.reset.confirmTitle": "Rebuild the whole index?",
  "admin.reset.confirmBody": "Sprint history, comment and attachment functions will answer \"Index is building\" until the index is filled again.",
  "admin.reset.cancel": "Cancel",
  "admin.forbidden": "Only Jira administrators can change these settings.",
  "admin.project": "{name} ({key})",
  "errors.busy": "The index is being built. Try again when it is ready."
}
```

с переводами в 25 файлах (ключи `admin.project` и плейсхолдеры не переводятся по форме).

- [ ] **Step 4: Run** `npx vitest run` → PASS; `npm --prefix static/app test` → PASS; `npm run build:ui`; `npm run lint` → 0 ошибок.

- [ ] **Step 5: Commit**

```bash
git add apps/query
git commit -m "JQL-36: Add the admin page to exclude projects, reindex a project and rebuild the index

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 30: Деплой M2/M3, проверка на сайте, полнота всех групп, проба дерева в 2 уровня

**Model:** sonnet

**Files:**
- Modify: `apps/query/docs/live-checks.md` (раздел «M2–M3 on site»), `apps/query/test/fixtures/events/*.json` (если живые тела событий отличаются), `apps/query/src/core/limits.js` и `apps/query/test/core/tree.test.js` (только если проба 2 уровней прошла), rulings

**Interfaces:**
- Consumes: Tasks 22–29 (отгруженные группы), `acceptance.mjs` с `CASES.m2`, `CASES.m3`.
- Produces: таблицы полноты M2/M3, свежесть по группам, время заполнения индекса продуктом, вердикт пробы `TREE_LEVELS = 2`, снимок сообщения «Index is building» (строка §6).

- [ ] **Step 1: Деплой** (команды Task 17 Step 2, с `forge variables set -e development QUERY_DEBUG_EVENTS 1`). Сразу после установки выполнить в поиске `issue in addedAfterSprintStart("JQLG board")` (и `issue in commented("after -1d")`, если группа отгружена) → ожидается ошибка «Index is building: N of M issues»; записать текст — это проверка строки §6 «индекс строится».

- [ ] **Step 2: Заполнение продуктом.** Каждые 60 с читать прогресс (страница «Status» или `forge logs` по `onBackfill`) до `readyAt` для каждой части; записать минуты (сравнить с J-G6/J-G7 прототипа). Если заполнение не стартовало после `forge deploy` (событие `upgraded` не пришло) — нажать «Rebuild» на админ-странице (Task 29) и записать это в `docs/live-checks.md` как известное поведение.

- [ ] **Step 3: Формы событий** спринтов, комментариев, вложений: по одному изменению каждого вида, `forge logs -e development --since 10m | grep '"event"'`, сверить с фикстурами; расхождение → исправление с тестом (исполнитель opus) в коммите этой задачи.

- [ ] **Step 4: Полнота.** `node apps/query/scripts/acceptance.mjs complete --cases m2` и `--cases m3` → все строки `complete: true` (группы, ушедшие в v1.1, в `CASES` не входят). Случая на 50 000 значений в `m3` нет — он только в `tree2` (Step 6), иначе при `TREE_LEVELS = 1` он дал бы ожидаемую ошибку ёмкости до пробы. Записать фактический размер каждого случая (`reference`) — его переносит Task 32 (P-3). Расхождение → стоп, исправление (opus) с тестом, повтор.

- [ ] **Step 5: Свежесть по группам.** `node apps/query/scripts/acceptance.mjs fresh --group sprint --n 30`, `--group comment --n 30`, `--group attachment --n 30`, `--group fields --n 30` (поля: правка `duedate`/`timetracking` задачи из внутреннего запроса `dateCompare`/`expression`) → p90 ≤ 60 с и 0 потерь в каждой группе.

- [ ] **Step 6: Проба дерева в 2 уровня.**

```bash
forge variables set -e development QUERY_TREE_LEVELS 2 && forge deploy -e development --non-interactive
node apps/query/scripts/acceptance.mjs complete --cases tree2
```

`CASES.tree2 = [['expression', ['project in (JQLG, RPT)', 'votes >= 0'], '50 000 values, 50 leaves under 6 middle nodes']]` (добавить в `acceptance.mjs`). Пройдено (`complete: true`, без ошибки) → `TREE_LEVELS = 2` в `src/core/limits.js`, в `tree.test.js` ожидания по умолчанию с 2 уровнями, строка rulings `| Q-Rn | дерево страниц — 2 уровня (до 81 000 значений): проба на 50 000 значениях полна | Q-R10 |`, затем `forge variables unset -e development QUERY_TREE_LEVELS`. Не пройдено → `TREE_LEVELS` остаётся 1, Ruling с числами (ошибка или неполнота), предел 9 000 значений — в справочник и листинг.

- [ ] **Step 7: Отключить отладку**, деплой, `forge eligibility -e development --non-interactive` → eligible. Записать раздел «M2–M3 on site» в `docs/live-checks.md`.

- [ ] **Step 8: Commit**

```bash
git add apps/query atlassian/plans/2026-10-03-artup-query-v1-rulings.md
git commit -m "JQL-37: Record M2 and M3 completeness, freshness, index fill time and the two-level tree probe

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

## Этап M4 — приёмка, листинг, сайт

### Task 31: Инструмент приёмки M4 — всплеск, аудит записей, ошибки, образцы ScriptRunner

**Model:** opus

**Files:**
- Modify: `apps/query/scripts/acceptance.mjs`

**Interfaces:**
- Consumes: `api`, `ids`, `pool`, `sleep`, `stats`, `UnsafeRetryError` (Task 16), `linkId` (общий `lib/latency.mjs`, Task 16), `REFERENCES` (Tasks 16, 24, 27, 28), `compare`, `save`, `test/fixtures/sr-samples.json` (Task 1, поле `group`).
- Produces: фазы `burst [--burst 200]` → `data/acceptance-burst.json` (`{ created, deleted }`, каждый `{ changes, spreadSeconds, lastChangeToVisibleSeconds, lost }`), `audit [--since -7d]` → `data/acceptance-audit.json` (`{ appAccountId, updatedByApp, pass }`), `errors [--groups …]` → `data/acceptance-errors.json` (`rows: [{ jql, expected, status, message, pass }]`), `sr [--groups …]` → `data/acceptance-sr.json` (20 строк: `compare` + `pass`, или `skipped: 'v1.1'` для образца группы, не отгруженной по воротам); `--groups` — отгруженные группы через запятую (по умолчанию все семь).

- [ ] **Step 1: Всплеск** — инструмент с таймаутом запросов и повтором сетевых ошибок (сломалось в J-G5: параллельные POST висели ~30 мин и рвались ECONNRESET). Импорты в начале файла расширить до `import { api, bulk, ids, pool, sleep, stats, UnsafeRetryError } from './lib/http.mjs';` и `import { latency, latencyResult, linkId, waitFor } from './lib/latency.mjs';` (имена, уже добавленные Tasks 24, 27, сохранить). Id связи читает общий `linkId` — своей копии в `acceptance.mjs` нет.

```js
const shippedGroups = () => String(args.groups ?? 'query,site,board,sprint,comment,attachment,fields').split(',');

async function createLink([from, to]) {
  for (let attempt = 1; attempt <= 5; attempt += 1) {
    try {
      await api('POST', '/rest/api/3/issueLink', { type: { name: 'Blocks' }, outwardIssue: { id: from }, inwardIssue: { id: to } }, { unsafe: true });
      return;
    } catch (error) {
      if (!(error instanceof UnsafeRetryError)) throw error;
      if (await linkId(from, to)) return;
      await sleep(1000 * attempt);
    }
  }
  throw new Error(`link ${from} → ${to} was not created`);
}

async function deleteLink([from, to]) {
  const id = await linkId(from, to);
  if (id) await api('DELETE', `/rest/api/3/issueLink/${id}`, undefined, { raw: true });
}

async function burst() {
  const C = 'issue in linkedIssuesOf("project = JQLG AND labels = jg-lnk")';
  await evaluate(C);
  const sources = (await ids('project = JQLG AND labels = jg-lnk ORDER BY key')).ids;
  const targets = (await ids('project = JQLG AND labels = jg-task AND issueLinkType is EMPTY AND labels not in (jg-big, jg-mid, jg-small, jg-lnk, jg-sprint) ORDER BY key ASC')).ids.slice(0, Number(args.burst ?? 200));
  const pairs = targets.map((to, i) => [sources[i % sources.length], to]);
  const gap = 60000 / pairs.length;
  const run = async (op, present) => {
    const t0 = Date.now();
    await pool(pairs, 4, async (pair, i) => {
      const due = t0 + i * gap;
      if (Date.now() < due) await sleep(due - Date.now());
      await op(pair);
    });
    const tLast = Date.now();
    for (;;) {
      const got = new Set((await ids(`(${C}) AND id in (${targets.join(',')})`)).ids ?? []);
      const ok = targets.filter((x) => got.has(x) === present).length;
      const base = { changes: pairs.length, spreadSeconds: (tLast - t0) / 1000 };
      if (ok === targets.length) return { ...base, lastChangeToVisibleSeconds: (Date.now() - tLast) / 1000, lost: 0 };
      if (Date.now() - tLast > 10 * 60000) return { ...base, lastChangeToVisibleSeconds: null, lost: targets.length - ok };
      await sleep(2000);
    }
  };
  const created = await run(createLink, true);
  const deleted = await run(deleteLink, false);
  log(`burst: ${JSON.stringify({ created, deleted })}`);
  save(`acceptance-burst${args.tag ? `-${args.tag}` : ''}`, { stats, created, deleted });
}
```

- [ ] **Step 2: Аудит «ничего не пишется в задачи».**

```js
async function audit() {
  const since = args.since ?? '-7d';
  const users = await api('GET', '/rest/api/3/users/search?maxResults=1000');
  const app = users.find((u) => u.accountType === 'app' && /ArtUp Query/i.test(u.displayName));
  if (!app) throw new Error('ArtUp Query app user not found');
  const touched = await ids(`issuekey in updatedBy("${app.accountId}", "${since}")`);
  const result = { appAccountId: app.accountId, since, updatedByApp: touched.ids?.length ?? null, error: touched.error, pass: touched.ids?.length === 0 };
  log(`audit: ${JSON.stringify(result)}`);
  save('acceptance-audit', { stats, ...result });
}
```

- [ ] **Step 3: Ошибки §6.**

```js
const ERRORS = [
  ['issue in subtasksOf("projekt = JQLG")', 'subtasksOf:', 'query'],
  ['issue in subtasksOf("assignee = currentUser()")', 'currentUser() is not supported', 'query'],
  ['issue in childIssuesOf("project = JQLG", "11")', 'depth must be between 1 and 10', 'query'],
  ['issue in linkedIssuesOf("project = JQLG", "nope")', 'Link type "nope" not found', 'query'],
  ['issue in previousSprint("No such board")', 'Board "No such board" not found', 'board'],
  ['issue in addedAfterSprintStart("JQLG board", "No such sprint")', 'Sprint "No such sprint" not found', 'sprint'],
  ['issue in commented("by nobody-xyz-123")', 'User "nobody-xyz-123" not found', 'comment'],
  ['issue in expression("project = JQLG", "nope > 1")', 'Field "nope" not found', 'fields'],
];

async function errors() {
  const shipped = shippedGroups();
  const rows = [];
  for (const [jql, expected, group] of ERRORS.filter((e) => shipped.includes(e[2]))) {
    const r = await api('POST', '/rest/api/3/search/jql', { jql, fields: ['id'], maxResults: 1 }, { raw: true });
    const message = r.text.slice(0, 400);
    rows.push({ jql, expected, status: r.status, message, pass: r.status === 400 && message.includes(expected) });
  }
  log(JSON.stringify(rows, null, 1));
  save('acceptance-errors', { stats, rows, allPass: rows.every((x) => x.pass) });
}
```

`--groups` — отгруженные группы (по итогам J-G6/J-G7).

- [ ] **Step 4: 20 образцов ScriptRunner.** Если импорта `readFileSync` ещё нет (Tasks 24, 27) — `import { readFileSync } from 'node:fs';` в начало файла.

```js
async function sr() {
  const { samples } = JSON.parse(readFileSync(new URL('../test/fixtures/sr-samples.json', import.meta.url), 'utf8'));
  const shipped = shippedGroups();
  const rows = [];
  for (const s of samples) {
    if (!shipped.includes(s.group)) {
      rows.push({ id: s.id, scriptrunner: s.scriptrunner, group: s.group, skipped: 'v1.1', pass: null });
      log(`sr ${s.id}: skipped, group ${s.group} is in v1.1`);
      continue;
    }
    const got = await evaluate(s.query);
    let ref = await REFERENCES[s.reference.fn](s.reference.args, args);
    if (s.reference.and) {
      const allowed = new Set((await ids(s.reference.and)).ids ?? []);
      ref = ref.filter((id) => allowed.has(String(id)));
    }
    const row = { id: s.id, scriptrunner: s.scriptrunner, query: s.query, error: got.error, ...(got.ids ? compare(got.ids, ref) : {}) };
    rows.push({ ...row, pass: row.complete === true });
    log(`sr ${s.id}: ${JSON.stringify(rows.at(-1))}`);
  }
  save('acceptance-sr', { stats, rows, passed: rows.filter((r) => r.pass === true).length, skipped: rows.filter((r) => r.skipped).length });
}
```

Образец группы, не прошедшей ворота (группа — поле `group` образца, Task 1), не сравнивается: строка `skipped: 'v1.1'`; критерий Task 32 — все не пропущенные образцы `pass: true`.

- [ ] **Step 5: Регистрация фаз.** `PHASES` += `{ burst, audit, errors, sr }`; `node --check apps/query/scripts/acceptance.mjs`; `npx vitest run` → PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/query/scripts/acceptance.mjs
git commit -m "JQL-38: Add burst, write audit, error and ScriptRunner sample phases to the acceptance tool

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 32: Нагрузочная приёмка на artuplabs-dev и чек-лист владельца

**Model:** sonnet

**Files:**
- Create: `atlassian/plans/2026-10-03-artup-query-acceptance.md`

**Interfaces:**
- Consumes: Tasks 17, 30, 31; брифа §4 (все строки), спецификации §8.
- Produces: документ приёмки: (а) строка на каждый критерий §4 брифа и §8 спецификации — порог, измерено, файл данных, прошло/нет; (б) чек-лист владельца для C2.

- [ ] **Step 1: Прогон** (из корня репозитория, секреты из `.env`):

```bash
node apps/query/scripts/acceptance.mjs complete --cases m1 --tag final
node apps/query/scripts/acceptance.mjs complete --cases m2 --tag final
node apps/query/scripts/acceptance.mjs complete --cases m3 --tag final
node apps/query/scripts/acceptance.mjs fresh --group query --n 30 --tag final
node apps/query/scripts/acceptance.mjs fresh --group sprint --n 30 --tag final
node apps/query/scripts/acceptance.mjs fresh --group comment --n 30 --tag final
node apps/query/scripts/acceptance.mjs fresh --group attachment --n 30 --tag final
node apps/query/scripts/acceptance.mjs fresh --group fields --n 30 --tag final
node apps/query/scripts/acceptance.mjs burst --burst 200 --tag final
node apps/query/scripts/acceptance.mjs errors --groups <отгруженные группы>
node apps/query/scripts/acceptance.mjs sr --groups <отгруженные группы>
node apps/query/scripts/acceptance.mjs audit --since -30d
forge eligibility -e development --non-interactive
```

(группы, ушедшие в v1.1 по J-G6/J-G7, не запускать — в том числе `fresh --group attachment`, если вложения не прошли J-G7; отметить «v1.1» в документе; `<отгруженные группы>` — `SHIPPED_GROUPS` через запятую.)

- [ ] **Step 2: Документ приёмки** `atlassian/plans/2026-10-03-artup-query-acceptance.md`, раздел (а) — таблица по каждой строке:

| Критерий (бриф §4 / спецификация §8) | Порог | Как мерили | Измерено | Прошло |
|---|---|---|---|---|
| нет предварительной индексации всего сайта для функций по запросу; первый результат на 50 000 | по J-G5: результат, а не ошибка; при > 20 с — «Computing», затем результат | Task 17 Step 5 | … | … |
| свежесть | p90 ≤ 60 с, по 30 изменений на группу | `acceptance-fresh-*` | … | … |
| 0 потерянных обновлений | 0 на ≥ 150 изменениях | `acceptance-fresh-query` (150) + остальные группы | … | … |
| полнота | 100% против REST на > 1 000 и > 10 000 для каждой функции §2 (размер случая — максимальный, какой дают данные, P-3) | `acceptance-complete-*` | … | … |
| всплеск 200 изменений/мин | замер (обещание листинга: «секунды для обычных правок, до минут при массовых») | `acceptance-burst` | … | … |
| понятная ошибка вместо пустого результата | все случаи §6 | `acceptance-errors` + Task 30 Step 1 («Index is building») + юнит-тесты (`unlicensed`, `tooMany`) | … | … |
| ноль egress, RoA | eligible | `forge eligibility` | … | … |
| ничего не пишется в задачи | 0 задач `updatedBy(<app>)` | `acceptance-audit` | … | … |
| > 1 000 — условием/деревом, иначе ошибка с числом | дерево до 9 000 / 81 000 (Q-R10) | `tree2` + юнит-тест `tooMany` | … | … |
| аргумент — любой JQL, `filter=…`, список ключей | 3 случая | `CASES.m1` | … | … |
| company- и team-managed | оба | `CASES.m1` JQLT | … | … |
| имена ScriptRunner | 20 образцов дают тот же смысл (образцы групп v1.1 — `skipped`, считаются отдельно) | `acceptance-sr` | … | … |

Под таблицей — подтаблица полноты по функциям: функция | случай | фактический размер результата (`reference`) | размер внутреннего запроса (для функций с `subquery`) | complete. Пишется измеренный размер, а не цель «> 1 000 / > 10 000»: где данные дают меньше (например, `incompleteInSprint` большого спринта — 50), так и записать.

Любая строка «не прошло» → стоп: листинг не подаётся (бриф §10), исправление — отдельной задачей с тестом, затем повтор строки.

- [ ] **Step 3: Чек-лист владельца (раздел (б)), по-русски, у каждого пункта — куда нажать и что ожидать:**
  1. «Приложения → ArtUp Query» → вкладка «Функции»: поиск «links» оставляет функции связей; кнопка «Скопировать» у примера → вставить в поиск задач (Ctrl+V) → запрос выполняется.
  2. Поиск задач: `issue in subtasksOf("project = JQLG AND labels = jg-big")` → 12 000 задач, без ошибки.
  3. Создать подзадачу у любой задачи с меткой `jg-mid` → обновить поиск `issue in subtasksOf("project = JQLG AND labels = jg-mid")` → новая подзадача видна в течение минуты.
  4. `issue in previousSprint("Нет такой доски")` → в редакторе понятная ошибка «Board … not found», не пустой результат.
  5. `issue in addedAfterSprintStart("JQLG board")` → задачи, добавленные в активный спринт после старта (если группа в v1).
  6. Оставить комментарий к задаче → `issue in commented("by <ваше имя> after -1d")` находит её (если группа в v1).
  7. (если админ-страница есть — Task 29) «Настройки → Приложения → ArtUp Query settings»: исключить RPT → «Сохранить» → на странице состояния виден список; вернуть.
  8. Тёмная тема и русский язык интерфейса: всё читается, ничего не обрезано.
  9. Решение владельца: production deploy (`forge deploy -e production`, установка) — делает владелец; подача листинга — владелец (C3).

- [ ] **Step 4: Commit**

```bash
git add atlassian/plans/2026-10-03-artup-query-acceptance.md
git commit -m "JQL-39: Record the acceptance run against every quality bar and the owner checklist

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

> **Чекпоинт C2 (владелец, после Task 32):** ручная приёмка по чек-листу в браузере; решение о production deploy (деплой и установку в production выполняет только владелец).

### Task 33: Матрица скриншотов, проверка переполнения, качество переводов, иконка

**Model:** opus (шаги 1, 4 — стенд `preview/**`, скрипты `screenshots.mjs`/`contact-sheet.mjs`, иконка в SVG и JSX; правка переполнения кодом, а не переводом), sonnet (шаги 2, 3, 5 — прогон снимков, проход переводов, коммит)

**Files:**
- Create: `apps/query/static/app/scripts/{screenshots.mjs,contact-sheet.mjs}` (адаптация Reports), `apps/query/static/app/preview/**` (страница-стенд с подменой `@forge/bridge`, как в Reports)
- Modify: `apps/query/resources/icon.svg`, `apps/query/static/app/src/illustrations/AppIcon.jsx`, файлы локалей, где проба нашла проблемы

- [ ] **Step 1:** Скопировать и адаптировать стенд и скрипты из `apps/reports/static/app/{preview,scripts/screenshots.mjs,scripts/contact-sheet.mjs}`: `MATRIX = { global: { states: ['reference', 'reference-empty-search', 'status-idle', 'status-building', 'status-errors', 'unlicensed'], widths: [1280, 800] }, admin: { states: ['admin', 'admin-busy', 'admin-reset-dialog', 'admin-forbidden'], widths: [1280, 800] } }` (ключ `admin` — только если админ-страница есть, Task 29); локали en-US, de-DE, ru-RU, ja-JP, fi-FI, zh-CN; темы светлая/тёмная; режим пробы по всем 26 локалям — элементы с `scrollWidth > clientWidth` или текстом, обрезанным `overflow: hidden`.
- [ ] **Step 2:** `npm run screenshots` → `static/app/screenshots/index.html`; исправить каждое переполнение (короче перевод — sonnet; перенос или вёрстка — исполнитель opus), повторять до 0.
- [ ] **Step 3:** Проход переводов: для каждой локали — проверка всех ключей носителем-уровнем: термины как в интерфейсе Jira на этом языке («задача», «спринт», «доска», «фильтр», «эпик», «подзадача»); имена функций и условий не переведены. Изменённые ключи — в тело коммита.
- [ ] **Step 4:** Иконка: перекрасить `resources/icon.svg` и `AppIcon.jsx` в свой цвет ArtUp Query (только токены дизайна в JSX; в SVG-ресурсе цвета допустимы, как в Reports).
- [ ] **Step 5: Commit**

```bash
git add apps/query
git commit -m "JQL-40: Add the screenshot matrix, fix overflows and translations, recolour the icon

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 34: Листинг, страница сайта, правовые страницы, статус проекта

**Model:** sonnet

**Files:**
- Create: `atlassian/listing-query/{listing.md,privacy-security.md,highlights.md,screenshots/}`, `site/query/index.html` (+ картинки), `site/docs/query/index.html`
- Modify: `site/index.html`, `site/privacy.html`, `site/terms.html`, `site/security.html`, `site/support.html`, `atlassian/README.md`, `NEXT_STEPS.md`

- [ ] **Step 1: Листинг** по структуре `atlassian/listing-reports/`: имя «ArtUp Query — JQL functions for subtasks, links, sprints and comments», слоган, описание; три главных преимущества по брифу §4 (результат свежий через секунды после правки — p90 из приёмки; полный при любом размере — числа полноты; Runs on Atlassian, ничего не пишет в задачи); список функций по группам (только отгруженные); блок «Coming from ScriptRunner?» (`issue in` вместо `issueFunction in`); честная строка о свежести: «seconds for ordinary edits; bulk imports and bulk edits can take minutes» (Q-R5, числа всплеска из приёмки); цена $175/мес за 200, ≤ 10 бесплатно; быстрый старт (3 шага); ответы Privacy & Security: egress нет; хранится — id задач, спринтов, записей changelog, категории статусов, даты, account id авторов комментариев и вложений, видимость (роль/группа), расширения файлов, кэш id результатов; текст задач, комментариев и вложений не хранится; удаление — по событиям удаления и при деинсталляции (Forge).
- [ ] **Step 2: Скриншоты** — 5 из матрицы Task 33 (1280, светлая, en-US): справочник, состояние, поиск задач с функцией (снять на `artuplabs-dev` через браузер), админ-страница (если её нет — Task 29 не исполнялась — второй поиск задач с функцией другой группы), пример ошибки в редакторе JQL; размеры Marketplace.
- [ ] **Step 3: Страница сайта** `site/query/index.html` в стиле `site/reports/` (тот же CSS, без внешних запросов сверх уже используемых `site/reports`), ссылка с `site/index.html`; `site/docs/query/index.html` — справочник функций (тексты из `fn.*` en-US, примеры), раздел о датах UTC и рабочем времени (Q-R12), исключённые проекты (Q-R13). **Сайт не деплоить** — деплоит владелец.
- [ ] **Step 4: Правовые страницы.** `site/privacy.html` — новый раздел «What data ArtUp Query processes» (что читает: задачи, связи, иерархию, changelog Sprint/status, метаданные комментариев и вложений — от имени приложения; что хранит — список Step 1; account id авторов — единственные персональные данные; журнал ошибок без аргументов, Q-R14; сроки хранения), ArtUp Query в «In short», списке приложений, таблице субпроцессоров (Atlassian: Forge SQL и Forge storage); `site/terms.html` — ArtUp Query в списках EULA, документации и Provider-Specific Terms (Runs on Atlassian, только чтение задач, хранит только метаданные индекса); `site/security.html` — архитектура и скоупы ArtUp Query (список из манифеста, с объяснением `write:app-data:jira` — только precomputation JQL-функций); `site/support.html` — ArtUp Query в списке поддержки. Даты «Last updated» — дата задачи.
- [ ] **Step 5: Статус.** `atlassian/README.md` — строка №5 (ArtUp Query: приёмка пройдена, ждёт C2/C3); `NEXT_STEPS.md` — шаги владельца: чек-лист C2, production deploy, подача листинга, деплой сайта. В родительском репозитории `/Users/artyomkarpets/IncomeApps` — строка проекта в `PROJECTS.md` (отдельный коммит там же, тем же форматом сообщения без номера JQL: `Update ArtUp Query status: acceptance passed, waiting for the owner`).
- [ ] **Step 6: Commit**

```bash
git add atlassian/listing-query site atlassian/README.md NEXT_STEPS.md
git commit -m "JQL-41: Draft the Marketplace listing, product and docs pages and legal updates for ArtUp Query

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

> **Чекпоинт C3 (владелец, после Task 34):** подача листинга в Marketplace (только владелец), деплой сайта.

---

## Порядок исполнения и чекпоинты

| Чекпоинт | После | Действие владельца |
|---|---|---|
| C1 | Task 17 | открыть справочник и выполнить 3–4 примера на `artuplabs-dev`; при необходимости создать team-managed проект JQLT (агент не ждёт C1) |
| C2 | Task 32 | ручная приёмка по чек-листу `2026-10-03-artup-query-acceptance.md`; решение о production deploy (выполняет владелец) |
| C3 | Task 34 | подача листинга; деплой сайта |

Зависимости: 1 → 2 → 3 → 4 → 5 → 6 → 7 → 8 → 9 → 10 → {11, 12} → 13 → 14 → 15 → 16 → 17 → 18 → 19 → 20 → 21 (всегда, при любом исходе J-G6) → [J-G6 или J-G7 пройден: 22 → 23] → [J-G6 пройден: 24] → [J-G7 пройден хотя бы по одной части: 25] → 26 → [J-G7 пройден хотя бы по одной части: 27] → 28 → [Task 23 исполнялась: 29; иначе — снятие админ-страницы по Task 29, коммит JQL-36] → 30 → 31 → 32 → 33 → 34. Задачи, пропущенные по воротам, не получают коммитов; номера коммитов остальных не сдвигаются: Task N → JQL-(N+7) (JQL-6 — план, JQL-7 — поправки pre-flight; Task 1 = JQL-8 … Task 34 = JQL-41). Tasks 5–8 (чистое ядро с полным кодом) можно отдать одному исполнителю подряд — по коммиту и ревью на задачу.

| Task | Model | Почему |
|---|---|---|
| 1, 2, 17, 20, 21, 30, 32, 34 | sonnet | сверка документации, замеры, деплой и проверки на сайте, приёмка, листинг; исправления кода внутри этих задач — исполнитель opus |
| 3 | opus (шаг 2), sonnet (шаги 1, 3, 4) | скрипт `live-checks.mjs` — код; документация, прогон и выводы — сбор данных |
| 33 | opus (шаги 1, 4), sonnet (шаги 2, 3, 5) | стенд, скрипты снимков и иконка — код; прогон снимков и переводы — sonnet |
| 4–16, 18, 19, 22–29, 31 | opus | код и тесты: каркас, ядро, клиент, обновление, индекс, UI, прототип и инструменты замера |

Ревью: проверка соответствия и качества — той же моделью, что исполнитель задачи; итоговое ревью ветки — opus.

## Покрытие спецификации

| Спецификация | Задачи |
|---|---|
| §1 охват: 24 функции, все продукты Jira, company/team-managed, 26 языков, ≤ 10 бесплатно | 5 (каталог), 11–12, 22–24, 25–28; 16–17 (JQLT); 4, 15, 29, 33 (языки); 4 (`licensing`) |
| §2 M1 по запросу | 6, 8, 11, 12, 13, 17 |
| §2 M2 (`hasLinks`/`hasSubtasks`/`previous`/`nextSprint` — Q-R9 в M1) | 8, 11, 12, 22–24 |
| §2 M3 | 25–28 |
| §2 вложенность, `in`/`not in` | 6 (`pageCall`), 13 (манифест), 16 (`CASES.m1` вложенная функция) |
| §3 модули Forge | 13, 14, 15, 23, 29 |
| §3 данные KVS и SQL | 10, 23, 27 |
| §3 порядок вычисления, дерево, права | 6, 9, 13; Q-R3 |
| §4 приватность, удаление, исключённые проекты | 23 (`deleteIssue`), 27, 29, 34 |
| §5 свежесть, сверка, первичное заполнение, «Index is building» | 7, 14 (включая события спринтов для функций доски), 17 (свежесть `previousSprint`/`nextSprint`), 23, 30 |
| §6 ошибки | 5, 6, 8, 13, 24, 25, 27, 28, 31 |
| §7 лицензия и цена | 4, 13, 34 |
| §8 тесты и приёмка | все задачи с кодом (vitest), покрытие ветвлений `src/core/**` ≥ 90% (4, 5 и задачи ядра — P-7), 16, 17, 30, 31, 32 |
| §9 этапы и ворота J-G6, J-G7 | 18–21 |
| §10 первые проверки | 1, 2, 3 |
