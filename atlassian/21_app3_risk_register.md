# Третье приложение: реестр рисков на родных задачах Jira

Дата: 2026-09-28. Бриф для отдельной сессии: что строим, почему, что проверить до кода,
границы v1, архитектура, что переиспользуем и когда остановиться.
Промпт для запуска — [plans/NEXT_SESSION_PROMPT_APP3.md](plans/NEXT_SESSION_PROMPT_APP3.md).
Исходный замер — `/Users/artyomkarpets/IncomeApps/analysis/2026-09-28_atlassian_pipeline.md` §5 №3.

## 0. Когда и зачем

- Третье в конвейере: №1 ArtUp Trace (подан), №2 ArtUp Export ([20](20_app2_markdown_export.md), в работе).
- **Фаза 0 (ворота) — можно сейчас**, это исследование. **Код — после подачи листинга
  ArtUp Export**, чтобы не держать две сборки одновременно.
- Покупатель общий с Trace: инженерная организация под надзором, цепочка
  «требование → риск → мера → проверка». Это портфель в одной области
  (правило из [06](06_niche_selection.md) и SoftComply: 11 листингов, один покупатель).

## 1. Продукт одной строкой

**Реестр рисков поверх обычных задач Jira: оценка по матрице (3×3–5×5) или FMEA (S×O×D),
остаточный риск у самого риска, покрытие мерами через родные связи и датированные
неизменяемые срезы реестра для аудита. Runs on Atlassian, без новых типов задач.**

Рабочее название: **ArtUp Risk** (ключ `com.artuplabs.risk`).

## 2. Почему эта ниша — выжимка из замера

| | |
|---|---|
| Лидеры | ProjectBalm Risk Register — 2 200 уст., $225/200 мест, 4.51★, без RoA; SoftComply — 563 и 555 уст., $321–450, без RoA; BOJA — 548, $175, RoA; Appbox — 328, $100, RoA; Hedge (Appfire) — 308, $191; Risk Radar — 181, $198, RoA |
| Новичок может войти | Risk Radar (2025-02): ≈ 9.5 уст./мес против медианы 0.9 у листингов младше года |
| RoA | у приложений с бейджем только 19% установок темы — два крупнейших без него |
| Цена | медиана темы $198/200 мест; наша **$225**, тир ≤10 бесплатно |
| До $5 000/мес | 23 клиента на 200 мест, ~75 установок при 30% платящих [гипотеза] |
| Слабое место | спрос измерен через предложение: в трекере Atlassian по «risk» 3 предложения, 5 голосов |

Просьбы из отзывов лидеров, годные в функции: макрос Confluence с матрицей; остаточный риск
у риска, а не у реестра (Hedge 2★); настройка не только глобальным админом (ProjectBalm 2★);
третий множитель «обнаружение» = FMEA (Appbox 3★); отчёты/гаджеты поверх матрицы; связь
риска с требованием, мерой и проверкой — главная похвала SoftComply.

## 3. Фаза 0 — ворота до кода (в этом порядке)

Результаты — в §11. Любое «закрыть» — остановиться и сообщить владельцу с числами.

| # | Проверка | Как | Закрыть, если |
|---|---|---|---|
| R-G1 | **Спрос сверх предложения** | Atlassian Community (community.atlassian.com) + все ~96 текстов отзывов лидеров: просьбы о срезах/аудите реестра, покрытии мерами, RoA / размещении данных | < 5 независимых упоминаний этих трёх вещей |
| R-G2 | **Нет ли отличия у RoA-конкурентов** | BOJA, Risk Radar, Appbox: листинг, документация, пробная установка на artuplabs-dev | RoA-приложение ≥ 200 уст. уже делает **и** срезы реестра, **и** покрытие мерами |
| R-G3 | **Выдержит ли $225** | жалобы на цену у лидеров (сейчас 2) | ≥ 3 → пересчитать цену, не закрывать |
| R-G4 | **Forge** | прототип-замер: 2 000 рисков, custom field + JQL, срез и сравнение в лимитах 25 с / KVS | не укладывается без egress |

Инструменты для отзывов и каталога — `/Users/artyomkarpets/IncomeApps/analysis/tools/atlassian_reviews.py`,
`atlassian_theme_detail.py` и `atlassian/tools/`. Снимки — в `atlassian/data/` (в `.gitignore`).

**Если R-G1 или R-G2 закрывает нишу** — запасной кандидат №4 **ArtUp Release**
(кросс-проектные релизы и дерево компонентов, 6 592 голоса в трекере, медиана $100/200 мест,
наша $175): разбор в том же файле замера §5 №4. Его главный риск — встроенные
cross-project releases в Jira Premium (Plans). Под него написать отдельный бриф `22_…`,
этот не переделывать.

## 4. Границы v1

### Входит

1. **Риск = обычная задача Jira** выбранного админом типа (новых типов не создаём — главный
   источник 1★ в теме прослеживаемости, [15](15_traceability_gaps.md) §2c).
2. **Поля риска** как Forge custom field types (значение в задаче, ищется JQL): вероятность,
   влияние, [обнаружение для FMEA], итоговая оценка, остаточная оценка, категория, владелец-поле Jira.
3. **Модель оценки:** матрица 3×3 / 4×4 / 5×5 с настраиваемыми порогами и цветами, или FMEA
   S×O×D (RPN) — выбирается на проект.
4. **Реестр** на `jira:projectPage` (Custom UI): таблица с фильтрами и сортировкой, **тепловая
   карта** до и после мер, клик в клетку → список рисков.
5. **Покрытие мерами:** через родные связи Jira (тип связи настраивается) — какие риски выше
   порога без меры; какие меры без проверки. Логика связей — как в Trace.
6. **Срезы реестра на дату:** неизменяемые, со сравнением двух срезов (что появилось, ушло,
   изменило оценку). Хранится только набор полей риска, не задачи целиком.
7. **Экспорт** реестра и среза в CSV (скачивание файла, как в Trace).
8. **Настройки на уровне проекта** админом проекта, не только глобальным (жалоба ProjectBalm).
9. Лицензия: ≤10 бесплатно, проверка `license.active` в резолвере и фронте.
10. 26 языков, светлая/тёмная тема — как в Trace.

### Не входит в v1

- Макрос Confluence с матрицей (второй релиз или отдельный листинг — решить после продаж).
- Гаджеты дашборда, Jira Service Management, Data Center.
- Отраслевые шаблоны медтеха (ISO 14971) — не идём в сегмент SoftComply ($450+, продажи звонком).

## 5. Жёсткие требования платформы

Как в [20](20_app2_markdown_export.md) §5: только Forge, ноль egress, `forge eligibility` на
каждом деплое; Custom UI с Atlaskit и токенами, всё в бандле; **полный набор scopes в v1**
(здесь приложение **пишет** в задачи — значения полей риска; заявить write-scope сразу, чтобы
не попасть в мажорную версию); не хранить персональные данные (account id) в срезах —
как TRACE-30; лимиты: резолвер 25 с, очередь 900 с, KVS $1.09/GB сверх 0.1 GB.

## 6. Архитектура — гипотеза, проверяется в R-G4

- Поля — `jira:customFieldType` (значение в задаче, JQL-поиск по оценке).
- Реестр — постранично через JQL-поиск из резолвера; тяжёлое (срез 2 000 рисков) — в очередь.
- Срезы — Forge SQL (как журнал в Trace), движок срезов и сравнения — перенести паттерн из
  Trace, не общий пакет.
- Ядро — чистые функции без I/O: расчёт оценки и порогов, покрытие мерами, дифф срезов.

## 7. Что переиспользуем из ArtUp Trace

`~/Projects/My/artuplabs-trace` (main): структура репо, CI, Custom UI (Vite, Atlaskit, i18n на
26 языков, тема), проверка лицензии, скачивание CSV, **логика родных связей и срезов со
сравнением**, листинг (`atlassian/listing/`), сайт `../site/`. Копировать паттерны, не
заводить общий npm-пакет.

## 8. Окружение

- Репозиторий: `~/Projects/My/artuplabs-risk` (локальный git); GitHub `AKarpetc/artuplabs-risk`
  создаёт владелец, до этого не пушить.
- Forge: Developer Space «ArtUp Labs», `forge register`.
- Секреты: `set -a && . /Users/artyomkarpets/IncomeApps/projects/DistributB2B/.env && set +a`;
  токены не печатать. Старые документы пишут `~/DistributB2B/` — реальный путь
  `/Users/artyomkarpets/IncomeApps/projects/DistributB2B/`.
- Тестовый сайт `artuplabs-dev.atlassian.net`: завести проект RISK; засев 2 000 рисков с
  мерами и проверками по образцу `scripts/seed-requirements.mjs` из Trace.
- `forge install --upgrade` может зависнуть — `perl -e 'alarm 300; exec @ARGV' forge install ...`.

## 9. Процесс

1. Фаза 0 (§3) → §11 → при «закрыть» стоп.
2. superpowers:brainstorming по спорным местам §4 и §6 → спецификация.
3. superpowers:writing-plans → `atlassian/plans/YYYY-MM-DD-artup-risk-v1.md` (+ `-rulings.md`)
   → **одобрение владельца**.
4. superpowers:subagent-driven-development — после подачи листинга ArtUp Export.
5. Деплой в development → ручная приёмка владельцем → production → листинг
   (`atlassian/listing-risk/`, подача — владелец).

Правила: коммиты `RISK-<n>: <Description>` + пустая строка +
`Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>`; без `//` внутри
функций, JSDoc 1–2 строки; только Atlaskit и design tokens; решения без владельца —
`Ruling:`; не пушить и не сливать в main без слова владельца.

## 10. Критерии успеха и остановки

| Когда | Что | Решение |
|---|---|---|
| до кода | R-G1–R-G4 | «закрыть» → стоп, бриф №4 |
| приёмка | 2 000 рисков: реестр и тепловая карта < 3 с на страницу, срез и сравнение в лимитах | не прошло → не подавать |
| 60 дней после листинга | < 30 установок | снять, записать отрицательный результат в IncomeApps |
| 60 дней после листинга | ≥ 30 установок и ≥ 5 платящих | развивать; макрос Confluence |

По этапам обновлять `STATE.md` (раздел «ArtUp Risk») и строку в
`/Users/artyomkarpets/IncomeApps/PROJECTS.md`.

## 11. Результаты фазы 0

| # | Результат | Дата | Вердикт |
|---|---|---|---|
| R-G1 | **3 независимых упоминания** (порог 5): 1 — история/срез реестра, 2 — покрытие мерами/проверкой, 0 — RoA/размещение данных. Ещё 3 пограничных не засчитаны (ниже). В 96 текстах отзывов лидеров — **0** просьб о любой из трёх вещей | 2026-09-29 | **закрыть** |
| R-G2 | RoA ≥ 200 уст. — BOJA (548) и Appbox (328): ни одно не делает **ни** датированных срезов реестра со сравнением, **ни** покрытия мерами. Risk Radar (181) и Hedge (308, без RoA) — тоже нет | 2026-09-29 | не закрывает |
| R-G3 | **2** жалобы на цену (как и было), 5 отзывов хвалят цену | 2026-09-29 | не закрывает, $225 держится |
| R-G4 | не выполнялся — прототип на Forge, для проектной сессии | — | — |

### R-G1 — спрос сверх предложения

Источники. (1) Atlassian Community: публичный поисковый API форума
`community.atlassian.com/forums/api/v2/search`, 50 запросов (risk register/matrix/management,
snapshot, baseline, history, audit, mitigation, coverage, residual, FMEA, ISO 14971/27001,
data residency, Forge, DORA, NIS2 …), обсуждения и комментарии — 6 805 записей, из них 840
вопросов раздела Q&A; снимки `analysis/data/atlassian/community_risk_2026-09-29.json` и
`community_risk2_2026-09-29.json`. Статьи App Central (пишут вендоры) — это предложение, а не
спрос, в счёт не идут. (2) Все отзывы 8 листингов темы, свежий снимок
`reviews_risk_2026-09-29.json` (121 отзыв, 96 с текстом). (3) Reddit — `search.json` отдаёт
403, веб-поиск по Reddit ничего по теме не нашёл; не измерено.

Засчитано (разные авторы, разные ветки):

| # | Что | Дата | Ссылка | Цитата |
|---|---|---|---|---|
| 1 | срез/история реестра | 2024-03-12 | [2637295](https://community.atlassian.com/forums/discussion/2637295/graphing-risk-score-criticality-over-time) | «I would like a graph, monthly, that shows a combination of open risks for the month … I have tried exporting data, but I don't get the risk history in the data dump» |
| 2 | покрытие проверкой | 2023-12-14 | [2559632](https://community.atlassian.com/forums/discussion/2559632) | «How can I exclude … the FRAs WITHOUT UAT test exe» (FRA = Functional Risk Assessment, риск без связанной проверки) |
| 3 | покрытие мерами и проверкой | 2021-07-12 | [1748002](https://community.atlassian.com/forums/discussion/1748002/traceability-matrix-output-in-jira-or-confluence) | «linked to mitigation means ("is mitigated by" link) and also linked to test protocols ("is verified by" link) … I'd like to export a table … there really are none available» |

Пограничные, не засчитаны: история поля «blocked reason» у эпиков для «aging of the risks» —
не реестр ([2548476](https://community.atlassian.com/forums/discussion/2548476), 2023-11-30);
«Risks and Controls … can't visualise the information as a bowtie» — просьба о визуализации,
не о пробелах покрытия ([2685028](https://community.atlassian.com/forums/discussion/2685028/risk-bowtie-functionality-in-jira), 2024-04-29);
ProjectBalm 3★, 2018-01-24, «not able to link another JIRA issue to the risk» — дефект связей
на Server, связи сейчас есть у всех. Даже с ними — 6 за 15 лет, и ни одного про RoA.

Что нашлось вместо спроса — предложение: SoftComply в статьях App Central продаёт «static
snapshots» реестра для ISO 27001/SOC 2 и макрос Risk History; статья 2026-04 «How to Track
Risks in Jira — A Practical Guide for Regulated Teams» советует Forge-приложения ради
размещения данных. Вендоры считают это ценным, покупатели об этом не просят (правило 2 метода).

### R-G2 — нет ли отличия у RoA-конкурентов

Пробная установка не делалась (нет входа); листинг + публичная документация. Снимки:
`risk_listing_{1223298,1225439,1237030,1227408}.html`, `boja_docs_2026-09-29.json` (28 страниц
пространства ARM), `hedge_docs_2026-09-29.json` (31 страница HED).

| Приложение | Уст. | RoA | Срезы реестра со сравнением | Покрытие мерами | Доказательство |
|---|---:|:-:|---|---|---|
| BOJA Risk Register | 548 | да | **нет**: журнал изменений вероятности/влияния одного риска (комментарии в задаче), графики Average Risk Score и Risk Burndown по датам — тренд, не неизменяемый срез и не дифф | **нет**: меры = связь «is mitigated by» или подзадача, колонки мер в реестре; отчёта «риски без меры / меры без проверки» нет ни в 7 отчётах, ни в доке | [Risk Register](https://bojaprod.atlassian.net/wiki/spaces/ARM/pages/1001881826/Risk+Register), [Risk Mitigations](https://bojaprod.atlassian.net/wiki/spaces/ARM/pages/2165964803/Risk+Mitigations), [Reports](https://bojaprod.atlassian.net/wiki/spaces/ARM/pages/1001816530/Reports) |
| Appbox Risk Analyzer (Pro) | 328 | да | **нет** | **нет**: «Plan, Develop and Track a risk mitigation strategy» только в листинге; в доке 3 отчёта — Initial/Residual Risk Matrix, Risk Distribution Pie | [листинг](https://marketplace.atlassian.com/apps/1225439/risk-analyzer-for-jira-pro), [документация](https://support.appbox.ai/docs/risk-analyzer-for-jira/) |
| Risk Radar (TypeSwitch) | 181 | да | **нет**: оценка одной задачи; «visible record of risk decisions» — комментарий в задаче | **нет** | [листинг](https://marketplace.atlassian.com/apps/1237030/risk-radar-for-jira-risk-management-assess-track), [сайт](https://typeswitch.net/risk-radar-for-jira/) |
| Hedge (Appfire) | 308 | нет | **нет**: отчёт «risks raised over time» | **нет**: «Mitigation plan» в release notes 2022 как «coming soon» | [Risk reports](https://appfire.atlassian.net/wiki/spaces/HED/pages/602865689/Risk+reports) |

Справка вне ворот: у SoftComply (без RoA) есть и прослеживаемость риск → мера → проверка, и
статические снимки через Confluence. Названное отличие v1 уникально только вместе с RoA.
Вывод по R-G2: отличие не занято, но это только предложение. Спрос на него R-G1 не подтвердил.

### R-G3 — выдержит ли $225

Все 96 текстов отзывов (ProjectBalm, SoftComply ×2, BOJA, Appbox, Hedge, Risk Radar, easeRisk).
Жалобы: ProjectBalm 3★ 2022-09-21 «not worth the money :)»; SoftComply Basic 2024-07-15 «The
paid version is too expensive». Похвалы цене: ProjectBalm 2023-10-31 «Excellent money saver»,
BOJA 2021-09-20 «great value for the money», BOJA 2022-10-18 «functionality provided at this
price-point», SoftComply Plus 2024-02-09 «worth the investment», 2020-10-15 «at a fair price».
В Community жалоб на цену риск-приложений нет. 2 < 3 — цену не пересчитывать.

### Итог фазы 0

**No-go: R-G1 закрывает нишу.** 3 независимых упоминания против порога 5, из них ноль про
Runs on Atlassian; в отзывах лидеров — ни одного. R-G2 (отличие у RoA-конкурентов не занято) и
R-G3 (2 жалобы, $225 держится) нишу не закрывают, но одно закрытие ворот — стоп по §3. Слабое
место из замера подтвердилось: спрос на названное отличие измерен только через предложение.
Что осталось: R-G4 (Forge-прототип) — для проектной сессии; после закрытия R-G1 его не
запускать, пока владелец не решит иначе. **Рекомендация:** перейти на запасной кандидат №4
ArtUp Release (кросс-проектные релизы и дерево компонентов, 6 592 голоса в трекере; разбор —
`analysis/2026-09-28_atlassian_pipeline.md` §5 №4) и написать под него отдельный бриф `22_…`
со своими воротами; начать с его главного риска — встроенных cross-project releases в Jira
Premium (Plans). Этот бриф не переделывать.
