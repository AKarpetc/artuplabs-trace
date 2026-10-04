Продолжаем ArtUp Query — пятое приложение ArtUp Labs: расширения JQL для Jira Cloud на Forge. Отвечай по-русски.
Владелец поручил в этой сессии **довести приложение до конца и опубликовать**: production deploy и подачу листинга
в Marketplace делаешь сам через браузер владельца. Что не можешь (банковские и налоговые поля, ID, вход с паролем) —
собрать одним списком владельцу. Решения без владельца — `Ruling:` в ledger и списком в конце.

## Где мы (на 2026-10-04, вечер)

- Ветка **`jql-v1`** (локальная, не пушить, не сливать). Исполнение — superpowers:subagent-driven-development.
- **Задачи 1–29 и 33 закрыты с ревью.** Ворота J-G6 и J-G7 пройдены полностью → в v1 все группы: иерархия, связи,
  доски и previous/nextSprint, история спринтов, комментарии, вложения, dateCompare/expression; админ-страница
  (исключение проектов, переиндексация, сброс). `not in` = точное дополнение на всех путях.
- **Задача 34** частично: листинг, страницы сайта и правовые разделы написаны (`c1df5e0`); не сделаны шаг 2
  (скриншоты) и шаг 5 (статус), числа помечены `<!-- refresh after acceptance -->`.
- **Задача 30** (деплой M2/M3, полнота всех групп, свежесть n=30 по группам, время заполнения индекса, проба дерева
  в 2 уровня) — **была в работе у агента прошлой сессии**: `apps/query/scripts/acceptance.mjs` изменён и не закоммичен,
  коммита `JQL-37` нет. Сначала проверь: есть ли коммит `JQL-37` и файл `task-30-report.md` в папке ledger. Если нет —
  посмотри `git diff apps/query/scripts/acceptance.mjs` (добавление `CASES.tree2` и т. п.), сохрани полезное и
  перезапусти Задачу 30 (sonnet; правки кода внутри — opus).
- Dev: artuplabs-dev, версия 4.x, development. Production ещё не деплоился (будет мажорный апгрейд: `core:sql`,
  скоупы `read:group:jira`, `read:user:jira`, `read:avatar:jira` → повторное согласие админов).
- Адрес ИП везде — из уведомления о регистрации: 32 E. P. Slavsky Embankment, apt. 132, Ust-Kamenogorsk (Oskemen),
  070004 (в профиле вендора Marketplace обновлён 2026-10-04).

## Прочитай сначала

1. Ledger: `.superpowers/sdd/2026-10-03-artup-query-v1/progress.md` (git-ignored) — все `Ruling:`, переносы
   (`carry to Task N`, `carry to final review`), `minor (deferred)`, статус задач. Доверяй ему и `git log`.
2. План `atlassian/plans/2026-10-03-artup-query-v1.md` (брифы задач уже извлечены как `task-NN-brief.md` в папке
   ledger); спецификация `…-design.md`; rulings `…-v1-rulings.md` (Q-R1…Q-R51; свежие: Q-R43 бюджет функции 10 с,
   Q-R48 скрытые комментарии игнорируются и roleLevel/groupLevel — v1.1, Q-R50/Q-R51 исключённые проекты
   фильтруются в приложении, нативные ответы не фильтруются, в возвращаемом JQL нет проектного условия).

## Что сделать

1. **Задача 30** — закрыть (см. выше). Если проба дерева в 2 уровня прошла — opus: сначала охрана
   `src/core/tree.js:36` (`shape.leaves ?? 0` не должен давать пустой узел — ошибка с числами), затем
   `TREE_LEVELS = 2` и тесты.
2. **Задача 31** (opus) — инструмент приёмки M4; **Задача 32** (sonnet) — нагрузочная приёмка и чек-лист владельца.
   Переносы — по ledger (счётчик чтений KVS; журнал после отказа push при деплое; пересчёт всех precomputation
   при смене версии приложения).
3. **Задача 34**: шаг 2 — скриншоты (5 кадров, en-US 1280, светлая), обновить числа по итогам 30/32, шаг 5 — статус
   (`atlassian/README.md`, `NEXT_STEPS.md`, строка в `/Users/artyomkarpets/IncomeApps/PROJECTS.md` отдельным коммитом
   там). Сверить с кодом утверждения privacy-текстов («display names / avatars не хранятся»). Smoke обеих настоящих
   страниц (global, admin) в iframe Forge после разбиения бандла.
4. **Финальное ревью ветки** (opus, `review-package` от `git merge-base main HEAD`) с разбором всех `minor (deferred)`
   и `carry to final review`; одна волна исправлений, одно повторное ревью.
5. **Публикация** (разрешено владельцем): `forge deploy -e production` (+ `--approve MAJOR_VERSION_RULE`),
   `forge eligibility -e production` (Runs on Atlassian заявлять только после eligible). Листинг: партнёрский портал
   Marketplace, новое приложение ArtUp Query по `atlassian/listing-query/` (название «ArtUp Query – JQL functions for
   sprints, links & comments», $175/мес за 200, ≤ 10 бесплатно, тарифы по кривой Reports), Privacy & Security,
   скриншоты. Первая подача может получить автоотказ «Not enough details on listing» → Resubmit (так было у Trace,
   Export, Reports).
6. **Сайт**: живой сайт выкладывается из `../DistributB2B-arxr/site` (ветка `feature/ar-xr-site`, её ведёт сессия
   ar-xr). Страницы Query и правовые разделы из `site/` этой ветки перенести туда — договориться с той сессией
   (SendMessage) или отдельным коммитом в её ветке, затем выложить
   (`npx wrangler pages deploy … --project-name artuplabs --branch main`). Правовые страницы с ArtUp Query должны быть
   живыми до подачи листинга.

## Правила

- Модели субагентов: сбор данных, замеры, браузер — Sonnet; код, отладка, тесты — Opus. Всегда явно указывать `model`.
- Браузер: у владельца **два профиля Chrome с двумя расширениями**; для Jira, Zoho и Marketplace — профиль, где они
  залогинены (2026-10-04 это был «Browser 1»). Проверка: `list_connected_browsers`, открыть mailadmin.zoho.com —
  залогинен → правильный. Клики расширения не доходят внутрь iframe Custom UI — резолверы вызывать через GraphQL
  `invokeExtension` (способ — `task-29-report.md`).
- Только Forge, ноль egress; единственный write-скоуп — `write:app-data:jira`.
- Секреты: `set -a && . /Users/artyomkarpets/IncomeApps/.env && . ./.env && set +a` (общий файл + проектный; описание —
  `IncomeApps/context/access.md`). Значения не печатать. Сетевые команды — `dangerouslyDisableSandbox: true`;
  `forge install --upgrade` — через `perl -e 'alarm 300; exec @ARGV' …`.
- Почта artuplabs.com — Zoho (`hello@` + псевдонимы support@, security@, privacy@, billing@), схема —
  `IncomeApps/context/email.md`. Cloudflare Email Routing для artuplabs.com не включать.
- Коммиты `JQL-<n>: <Description>` + `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Не пушить, не сливать.
- Без `//` внутри функций, без упоминаний задач/плана/ворот в коде (guard-тест), пределы в `src/core/limits.js`,
  тексты ошибок в `src/core/errors.js`, журнал ошибок без значений аргументов.

## Владельцу (не блокирует)

- Показать носителям переводы cs, da, et, hu, is, ro, sk, pt-PT, pt-BR (термин «work item» не подтверждён источником).
- AR Room (Shopify) ведёт отдельная сессия ar-room; здесь не трогать.
