Продолжаем ArtUp Reports — третье платное приложение ArtUp Labs: экспорт задач Jira в Excel, Word и PDF по шаблонам. Отвечай по-русски.

## Где мы (на 2026-09-30)

- Фаза 0 пройдена, спецификация и план одобрены владельцем, идёт исполнение плана через superpowers:subagent-driven-development.
- Ветка **`reports-v1`** (локальная, не запушена). Последний принятый коммит — `14dcb49` (задача 17).
- **Готовы и прошли ревью задачи 1–17 из 23**: каркас Forge (6 модулей, лицензия, 26 языков), живые проверки на artuplabs-dev, всё ядро (`core/*`), клиент Jira, рендеры Excel / Word / PDF / свой .docx-шаблон, конвейер выгрузки, хранилище шаблонов с правами, визуальная основа и превью-стенд. Тестов в `apps/reports/static/app` — 600, в `apps/reports` — 159, все зелёные.
- **Задача 18 (мастер выгрузки) прервана на середине.** Недоделанная работа исполнителя (без ревью) лежит в `git stash`: `REPORTS task 18 WIP (wizard, unreviewed, interrupted 2026-09-29)` — `src/wizard/`, `test/wizard/`, `preview/WizardScreen.jsx`, ~200 новых ключей в 26 локалях, зависимость `@atlaskit/textarea 10.2.7`.
- Осталось: задачи 18–23 (мастер, вкладка шаблонов, точки входа, скриншоты и переводы, нагрузочная приёмка на dev, листинг и страница сайта) и финальное ревью всей ветки.

## Прочитай сначала

1. План: `atlassian/plans/2026-09-29-artup-reports-v1.md` (задачи 18–23, у каждой строка **Model**).
2. Спецификация: `atlassian/plans/2026-09-29-artup-reports-design.md`.
3. Журнал решений: `atlassian/plans/2026-09-29-artup-reports-v1-rulings.md` (R1–R18).
4. **Журнал исполнения (ledger)**: `.superpowers/sdd/2026-09-29-artup-reports-v1/progress.md` (git-ignored). Копия — `atlassian/plans/2026-09-29-artup-reports-v1-ledger.md`. В нём: какие задачи закрыты, контроллерные rulings (P1, P2, T3a…T16a), **строки `CARRY to Task N`** — обязательные вводные для задач 18–20, и `minor (deferred)` — список для финального ревью.
5. Бриф: `atlassian/22_app3_jira_reports.md` (§4 — критерии приёмки).

## Что сделать

1. Вызвать superpowers:subagent-driven-development с планом `atlassian/plans/2026-09-29-artup-reports-v1.md`. Скрипт `sdd-workspace` найдёт тот же ledger — задачи 1–17 не переделывать, начать с задачи 18.
2. **Задача 18:** `git stash list` → свежий исполнитель **opus** получает бриф (`scripts/task-brief … 18`), constraints (`.superpowers/sdd/…/constraints.md`), все строки `CARRY to Task 18` из ledger и разрешение начать с `git stash apply stash@{N}` (проверить, дописать, прогнать тесты) или отбросить WIP и сделать заново. Затем обычное ревью (opus).
3. Задачи 19–23 — по плану; модели: 19, 20, 21, 22, 23 — sonnet (по строке **Model**), ревьюер — той же модели. Вводные:
   - T19: контракт `uploadTemplatePart({ id, uploadId, index, total, data })`, новый UUID `uploadId` на каждую загрузку, части ровно по 150 КиБ (последняя короче), код ошибки `internal` → `errors.internal`; `lodash` — прямой зависимостью static/app; ограничить суммарный распакованный размер .docx (≈ 20 МБ) до разбора.
   - T18–T20: `StepSection` принимает `number`, `AppHeader` — `{ subtitle, scopeName, actions }` без `title`; `createExportRun` получает клиента **фабрикой** `({ onRetry }) => createBridgeClient({ signal, onRetry })`.
   - T22: манифест получил скоупы `read:board-scope.admin:jira-software` и `read:project:jira` → деплой с `forge install --upgrade`; шрифт SC в сборке 11,4 МБ — проверить, что Forge принимает; замерить память вкладки на Word/PDF 2 000 задач с картинками (Ruling T15a).
4. Финальное ревью всей ветки (opus) с указанием на строки `minor (deferred)` и `parked` в ledger; одна волна исправлений.
5. В конце — список всех `Ruling:` владельцу; чекпоинты C1–C3 плана (владелец открывает точки входа, проходит чек-лист приёмки, подаёт листинг).

## Правила

- Модели субагентов: сбор данных, анализ, замеры, браузер — Sonnet; код, отладка, тесты — Opus (глобальное правило `~/.claude/CLAUDE.md`), простые задачи — Sonnet (указание владельца).
- Только Forge, ноль egress (Runs on Atlassian).
- Секреты: `set -a && . /Users/artyomkarpets/IncomeApps/projects/DistributB2B/.env && set +a`; токены не печатать. `forge register` — только с `-s 249db86b-0aa6-4b81-96ba-62341736ad15`.
- Коммиты `REPORTS-<n>: <Description>` + `Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>`. Не пушить и не сливать в main без слова владельца.
- Подача листинга и покупки — только владелец. Решения без владельца — `Ruling:` в журнал и списком в конце.
- Каждая строка §4 брифа — критерий приёмки; не прошла — не подаём.
