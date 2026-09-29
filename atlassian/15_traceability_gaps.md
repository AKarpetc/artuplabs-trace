# 15. Прослеживаемость требований: на что жалуются покупатели лидеров

Дата: 2026-09-24. Продолжает [14_domain_scan.md](14_domain_scan.md) §6, вариант
**В2**: платное Forge-приложение для Jira Cloud на тему «требование → задача/код
→ тест → риск». Условия: Forge-native, UI Kit, без внешних вызовов
(Runs on Atlassian), без Connect-модулей, продажи только self-serve, цель
$5 000/мес.

Инструменты и данные:
[tools/fetch_traceability_reviews.py](tools/fetch_traceability_reviews.py) →
[data/reviews_traceability.json](data/reviews_traceability.json) (25
приложений, **1 436 отзывов, из них 852 с текстом**, отказов API — **ноль**);
предложения Atlassian → [data/sugg_traceability.json](data/sugg_traceability.json).

**Вывод вперёд.** Покупатели платят за три вещи: матрицу/покрытие, базовые
срезы (baselines) и экспорт для аудита, и **больше всего хвалят поддержку
вендора** (39% текстовых отзывов). Жалуются на: тяжёлую установку (новые
типы задач, своя модель данных, нельзя удалить), паритет Cloud с DC
(в первую очередь baselines), экспорт, скорость Xray. Самая простая идея
v1 («список требований без теста по родным связям Jira, zero setup,
Runs on Atlassian») **уже занята**: Trace Gap (выпущен 2026-09-08, 2 установки,
$184) и Links Explorer (231 установка, $82) продают ровно её. Отличие надо
брать следующим шагом: **связи, ставшие подозрительными после изменения
требования, и базовые срезы**. Это то, чего нет ни у одного Forge-native
конкурента, и то, чего облачные клиенты просят у Requirement Yogi и R4J.
Доказательная база по отзывам тонкая: 83 облачных текстовых отзыва с 2022 года
на всю тему без Xray/Zephyr.

## 1. Кто в теме: 15 листингов из 14 и соседи

Установки — поле `totalInstalls` списочного API (так же, как в 04/14). Цена —
$/мес на 200 мест, облачный прайс (`/pricing/cloud/live`). RoA — флаг
`isForgeROACompliant` со страницы листинга; «Connect» — есть ли у облачной
сборки скоупы `*:connect-*`. Оба признака сняты 2026-09-24 со страниц листингов,
потому что `/addons/{key}` и `/versions/latest` теперь отдают **410 на любой
User-Agent**, включая браузерный (в 04 было «только на небраузерный»).

**15 листингов темы** (ключевые слова из
[analysis/themes_regulated.json](analysis/themes_regulated.json)):

| Приложение | Вендор | Уст. | Отз. | ★ | $/200 | Обновл. | RoA | Connect |
|---|---|---:|---:|---:|---:|---|:-:|:-:|
| easeRequirements (R4J) | Ease Solutions | 1 964 | 62 | 4.48 | 282 | 2026-08-18 | — | да |
| Requirement Yogi для Confluence | Requirement Yogi | 1 557 | 37 | 4.29 | 162 | 2026-09-11 | — | — |
| Requirement Yogi для Jira | Requirement Yogi | 977 | 12 | 3.96 | 83 | 2026-09-11 | н/д | — |
| TestRay | Goldfinger | 602 | 68 | 4.54 | **914** | 2026-09-08 | — | — |
| Links Explorer Traceability | Optimizory | 231 | 18 | 4.93 | 82 | 2026-08-27 | **да** | — |
| easeRequirements Ultimate | Ease Solutions | 123 | 4 | 5.0 | 142 | 2025-05-20 | — | да |
| ReqView Connector | Eccam | 95 | 4 | 4.38 | бесплатно/нет цены | 2026-04-09 | — | — |
| RMsis | Optimizory | 61 | 34 | 4.19 | **1 250** | 2026-07-14 | — | — |
| JCreate | Methoda | 39 | 6 | 5.0 | 142 | 2025-10-16 | — | — |
| rmCloud | Purple Drapes | 29 | 9 | 3.06 | 333 | 2026-07-20 | — | да |
| TraceCloud | TraceCloud | 6 | 2 | 3.13 | 598 | 2023-12-12 | — | — |
| Testrail Traceability Matrix | Solidini | 6 | 0 | — | 54 | 2026-05-21 | н/д | — |
| QC Traceability (Confluence) | QC Analytics | 5 | 1 | 5.0 | 133 | 2026-08-20 | н/д | — |
| NSYS Requirements Management | NewSysRS | 3 | 0 | — | 226 | 2026-04-29 | **да** | — |
| **Trace Gap** | Bobook | 2 | 0 | — | 184 | **2026-09-08** | **да** | — |

**Соседи**, проверенные по `data/apps.json` (есть в каталоге):

| Приложение | Вендор | Уст. | Отз. | ★ | $/200 | RoA | Connect |
|---|---|---:|---:|---:|---:|:-:|:-:|
| Xray | Xblend | 25 490 | 552 | 4.30 | 915 | — | да |
| Zephyr (Scale) | SmartBear | 15 340 | 492 | 4.13 | 928 | — | — |
| Requirements & Test Management (RTM) | Deviniti | 2 001 | 66 | 4.36 | 291 | — | — |
| Links Hierarchy | Kintosoft | 920 | 28 | 4.11 | 150 | да | — |
| Issue Links Viewer | Transition Technologies | 414 | 23 | 3.59 | 40 | — | да |
| Ketryx (медтех, IEC 62304) | Ketryx | 290 | 12 | 5.0 | счёт вендора | — | да |
| Visual Dependencies | Uption | 186 | 4 | 5.0 | бесплатно | да | — |
| Snapshots + Xray | RadBee | 149 | 1 | 5.0 | 193 | — | — |
| STAGIL Link Maps | catworkx | 115 | 0 | — | 63 | — | — |
| easeConnect (Confluence) | Ease Solutions | 83 | 1 | 5.0 | нет цены | — | да |

Из подсказанных в задании: **Valiantys и Easy Agile в теме прослеживаемости
не найдены** (у Easy Agile — планирование, не требования). Requirements Yogi —
это Requirement Yogi, строки выше.

Что видно по таблице:

- **Ни один лидер темы не Runs on Atlassian.** Бейдж есть только у мелких:
  Links Explorer, NSYS, Trace Gap и Links Hierarchy у соседей.
- **Клиентов до $5 000/мес** по правилу из 14 (5 000 / цена на 200 мест):
  RMsis — 4, TestRay — 5, R4J — 18, Trace Gap — 27, Links Explorer — 61.
  Дорого стоят полные RM/TM-системы. Лёгкие «матрица по связям» стоят $54–184.
- **Trace Gap — прямой клон простейшего v1.** Слоган: «Which requirements have
  no verification? Answered from the issue links already in your project».
  Листинг обещает ноль настройки, ноль хранения, режим только для чтения,
  выгрузку в CSV «для аудиторской записи» и Runs on Atlassian. В материалах
  проекта это приложение не упоминается; если оно не ваше, это конкурент,
  который вышел 16 дней назад.

## 2. Что говорят отзывы

Выборка: 268 текстовых отзывов по всем приложениям, кроме Xray и Zephyr. Их
я прочитал целиком. Из 584 текстовых отзывов Xray и Zephyr отобраны 72 с 2022
года по словам traceab/requirement/coverage/export/slow/price/migrat и
прочитаны. **Шкала:** отзывы до перехода Marketplace на пять звёзд
ставились по четырёхбалльной шкале, поэтому «4★» в старых отзывах — максимум.
Негатив считался при 1–2★, «смешанный» — при 3★ или при просьбе в
положительном отзыве. Счёт — число отзывов, не авторов (один дубль Xray
2024-05-11 / 2025-05-23 учтён один раз).

### Сводка кластеров

| Кластер | Отзывов | Из них облако с 2022 | Сила |
|---|---:|---:|---|
| (d) Нет функции: экспорт/отчёт для аудита | 15 | 7 | средняя |
| (c) Тяжёлая установка, сложность, не находится в Cloud | 16 | 11 | средняя |
| (a) Cloud хуже DC / больная миграция | 13 + 4 «когда будет Cloud» | 11 | средняя |
| (e) Скорость | 12 | 9 (почти все Xray) | средняя, но про Xray |
| (d) Baselines / версии / «что изменилось» | 8 | 4 | слабая–средняя |
| (d) Связь с тестами | 7 | 2 | слабая |
| (d) Отчёт покрытия / «требования без теста» | 4 (+5 похвал) | 3 | слабая |
| (b) Цена | 7 | 5 | средняя, но структурная |
| (d) Отчёт в Confluence | 5 | 1 | слабая |
| (d) Повторное использование между проектами | 5 | 1 | слабая |
| Похвала поддержке вендора | 105 из 268 (39%) | — | сильная |

### (a) Миграция с DC и паритет Cloud

Покупатели переезжают, и в Cloud им не хватает того, что было на DC.

> «Using X-ray on Jira Server and then migrating to Jira Cloud don't do it! You
> will loose a lot of features» — Xray, 2022-03-31, 1★

> «The early versions of the Cloud implementation lacked some important features
> for us (Baselines, RY Link macro behavior, aspects of the reporting
> functions)» — Requirement Yogi, 2025-01-10, 4★

Сюда же: у R4J в Cloud нет шаблонного экспорта («a blocker», 2022-07-29) и
отстают DC-функции (2022-12-02). У Zephyr миграция «terrible» (2025-10-01), а
отчёт миграции не показывает пропущенные тест-кейсы (2026-04-08).
Links Hierarchy и Issue Links Viewer не работают или не находятся в Cloud и
team-managed проектах (2021–2025, 5 отзывов). **Вывод для нас:** приложение,
которое изначально построено для Cloud, само по себе ничего не доказывает.
Работает другое: закрыть конкретную DC-функцию, которой в Cloud нет,
и прежде всего baselines.

### (b) Цена

> «the licensing cost is based on all Jira users rather than just the QA team
> members who need it. For a team with only 4–5 QA engineers, the pricing was
> not cost-effective» — Zephyr, 2026-06-04, 3★

> «for a price of 18,000 usd, it is unacceptable that the add-on is not up to
> date» — Xray, 2023-12-13, 1★ (DC)

Жалоба почти всегда одна и та же: **платят за всех пользователей Jira**
(Zephyr 2022-06-07, 2024-09-27, 2026-06-04). Это правило площадки, и мы его не
обойдём. Обратная сторона: у Requirement Yogi, R4J и RMsis цену хвалят как
«tiny fraction» по сравнению с DOORS или codebeamer. **Демпинг ничего не даёт;
аргумент ценой — «дешевле DOORS», а не «дешевле R4J».**

### (c) Сложность и тяжёлая установка

> «It asked me to create 8 more issue types to start working… new generation
> projects are not supported… I gave it up having spent about an hour» — RTM
> (Deviniti), 2021-07-21, 1★

> «If you install xray there is no effective uninstall method. You will need to
> manually remove issue-types, custom fields…» — Xray, 2023-08-16, 1★

Ещё: R4J — не удалось настроить типы, «moved on to next product candidate»
(2023-11-23, 1★). TestRay не установил нужные типы задач (2024-08-01, 1★).
RTM — «everything is created as a new issue and goes into the backlog»
(2023-08-18, 2★). R4J — дерево живёт внутри приложения, его нельзя найти
через JQL (2017, 2★). rmCloud нельзя отписать после триала (2021, 1★).
**Это самый частый источник единиц в облаке.** Для self-serve это главное:
покупатель без звонка вендору бросает продукт в первый час.

### (d) Недостающие функции

**Экспорт и отчёт для аудита** (15). R4J: «The exporting is the main feature
why we are using this app» (2024-09-23, 3★). Xray: «We haven't found a way to
properly export Traceability reports… in Confluence pages… not all people can
access JIRA» (2024-05-11, 2★). Zephyr: «very slow, no export, very basic»
(2024-11-17, 1★). Ещё TestRay — RTM не выгружается в Excel; RTM — «waiting for
an export of tree to Excel»; Links Hierarchy — экспорт в Excel падает с 404.

**Покрытие и пробелы** (4 жалобы, 5 похвал).

> «No way to see if there are requirements that have no associated test cases
> (doesn't show in trace matrix)» — Zephyr, 2022-08-04, 1★

> «We also need to show percentage of tasks covered by test cases, but the
> current reports only allow to see ONLY the tasks covered» — Zephyr,
> 2023-04-20, 3★

Xray: «"Requirement status" field cannot be seen on Jira boards nor in Jira
search» (2022-04-28, 2★). Похвалы у Requirement Yogi, R4J и RTM — именно за
«finding gaps for coverage», «audit‑ready documentation».

**Baselines, версии, влияние изменений** (8). Три облачных отзыва Requirement
Yogi просят baselines («I consider this an essential feature», 2023-04-06).
R4J: вернуть прошлую версию истории (2020-01-14), сравнить описания (2022, 1★).
Zephyr: **«No ability to flag/notify if requirements are updated»**
(2022-08-04). Baselines названы главной ценностью в пяти положительных
отзывах R4J и RMsis.

**Связь с тестами** (7). R4J: «We are missing testcase functionality»
(2024-09-23). Requirement Yogi: «we cannot see the Xray test sets/cases/runs in
the traceability matrix» (2023-04-06). У rmCloud и старого RMsis нет связи с
тест-планами.

**Confluence** (5): отчёт прослеживаемости в Confluence (Xray, выше),
«no Macro to show hierarchies in Confluence» (Links Hierarchy, 2023-06-23), и
ещё две старые просьбы встроить матрицу в Confluence.

**Риски** (1 явный запрос, RTM 2020-01-12: risk severity/probability,
«is detected by»). Ketryx хвалят как раз за «automated traceability and risk
management», но это продукт с продажей через демо.

### (e) Скорость

Почти целиком Xray (8 из 12): «The test field is constantly freezing, not
loading, very slow» (2025-10-07, 1★). Ещё Zephyr, RTM и Requirement Yogi
(«The usage of the cloud comes at the cost of speed», 2022-04-20). Для нас
это не отличие, а требование: на 2 000+ требований экран должен открываться
быстро. У Forge есть лимиты времени вызова и частоты запросов, поэтому это
надо проверить.

### Вне кластеров, но важно

- **Размещение данных.** У Xray два облачных отзыва на 1★ про регион данных
  (2024-09-24, 2025-04-07). Runs on Atlassian наследует размещение данных
  хоста, и это конкретный аргумент против Xray.
- **Поддержка — главная ценность.** 105 из 268 текстовых отзывов говорят о
  поддержке, чаще всего «joined a call», «fixed within days». При модели без
  звонков это риск: отзывы в теме зарабатывают поддержкой, а у нас её не будет.

## 3. Предложения Atlassian

Поиск по заголовкам открытых предложений JRACLOUD и CONFCLOUD
(`summary ~`, 11 слов, 2026-09-24):

- `traceability` — **1** предложение, `requirement` — 5, `coverage` — 4,
  `baseline` — 1 (про Advanced Roadmaps, 323 голоса). Прямого спроса на
  прослеживаемость в трекере **нет**.
- Смежный спрос на связи есть, и он большой: сортировка ссылок
  (JRACLOUD-16281, 712 голосов), массовая перелинковка (JRACLOUD-2428, 663),
  схемы ссылок по проектам (JRACLOUD-16325, 617), поля в панели Linked issues
  (JRACLOUD-36490, 539), JQL по удалённым ссылкам (JRACLOUD-28064, 418),
  задачи, связанные со страницей Confluence, через JQL (JRACLOUD-81075, 119).

Вывод: трекер подтверждает, что родные связи Jira неудобны. Про
прослеживаемость он ничего не говорит, её покупатель ищет на Marketplace, а
не у Atlassian. Прежний [data/sugg_jira.json](data/sugg_jira.json) (топ-300 по
голосам) теме ничего не добавил.

## 4. Кандидаты в отличие v1

### 1. Подозрительные связи и базовые срезы на родных связях Jira — рекомендую

Когда требование меняется после того, как к нему привязали тест или задачу,
связь помечается «подозрительной» и держится в этом состоянии, пока её не
подтвердят. Базовый срез — неизменяемый снимок набора требований, их полей и
связей на дату. Сравнение двух срезов показывает, что добавлено, изменено и
удалено. Сверху — отчёт покрытия, как у Trace Gap, но он входит в продукт, а
не продаётся сам по себе.

- **Доказательства:** слабые–средние. Baselines просят 3 облачных отзыва
  Requirement Yogi и прямо называют DC-функцией, которой нет в Cloud. Их
  хвалят 5 отзывов R4J и RMsis. «Flag if requirements are updated» — 1 отзыв
  Zephyr. Сам запрос косвенно подтверждает цена: baselines есть только у
  продуктов за $282–1 250.
- **Forge/UI Kit/без egress:** хорошо. Триггер `avi:jira:updated:issue`,
  журнал изменений через REST, хранение в KVS или Forge SQL, экран на UI Kit
  (DynamicTable). Внешних серверов не нужно.
- **Self-serve:** хорошо, если оставить ноль новых типов задач и ноль записи в
  Jira по умолчанию. Это прямой ответ на кластер (c). Подтверждение
  подозрительной связи — одна кнопка.
- **Объём v1:** выбор типов «требование» и «проверка» и типов связей; экран
  покрытия с процентом и списком пробелов; флаг подозрительности и его снятие;
  ручной срез проекта или фильтра и сравнение двух срезов; выгрузка CSV.
- **Главный риск:** срез и история подозрительности — это хранимые данные.
  Надо проверить лимиты Forge storage на 10 000+ задач и то, что подозрения
  не теряются при пропущенных событиях (нужна сверка по журналу изменений).
  Второй риск: Trace Gap или Links Explorer добавят это раньше.

### 2. Аудиторский пакет: отчёт покрытия и среза в Confluence

Confluence-макрос (UI Kit) со снимком матрицы, покрытия и списка пробелов на
дату среза. Страницу открывают те, у кого нет Jira, её экспортируют штатным
PDF Confluence.

- **Доказательства:** средние по экспорту (15 отзывов), слабые по Confluence
  (5, из них свежий облачный один — Xray).
- **Forge:** нужно одно приложение на Jira и Confluence сразу (мульти-продукт)
  либо два листинга. **Не проверено**, насколько это сейчас доступно
  для Runs on Atlassian. PDF и DOCX внутри UI Kit не делаются. Опора на
  штатный экспорт Confluence снимает эту проблему.
- **Self-serve:** хорошо, результат виден в первый же день.
- **Объём:** один макрос, который читает сохранённый срез из кандидата 1.
- **Риск:** как отдельный продукт это слабо, это продолжение кандидата 1.
  Идёт вторым релизом.

### 3. Покрытие тестами Xray и Zephyr без их серверов

Матрица «требование → тест», где тест — задача Xray, связанная родной связью
«Tests».

- **Доказательства:** слабые (7 отзывов про связь с тестами, 1 — про Xray в
  матрице).
- **Forge:** плохо. Статусы прогонов Xray Cloud и Zephyr хранятся на
  серверах вендоров, и для них нужен внешний вызов. Это ломает Runs on
  Atlassian. Доступны только родные связи.
- **Self-serve:** средне, покупатель Xray уже заплатил $915 и ждёт полноты.
- **Риск:** пообещаем «покрытие тестами» и не покажем, прошёл ли тест.
  Не брать в v1.

### Итог

**v1 = кандидат 1.** Покрытие по родным связям — обязательный минимум, его
уже продают за $82–184. Платное отличие — подозрительные связи и базовые
срезы: это DC-функция, которой облачные клиенты не нашли в Requirement Yogi и
R4J, её нет ни у одного Forge-native конкурента, и она не требует внешних
серверов. Ориентир цены — между Trace Gap ($184) и R4J ($282) на 200 мест, то
есть 18–27 клиентов такого размера до цели, до доли Atlassian.

## Чего в этом отчёте нет

- **Выборка отзывов маленькая.** Облачных текстовых отзывов с 2022 года — 83
  на всю тему без Xray и Zephyr. Каждый кластер держится на 4–16 отзывах, а
  тезис про baselines — на 3 облачных. Это направление, а не доказанный спрос.
- **Большинство отзывов — Server/DC и старые.** Из 257 отзывов на 15
  листингах темы облачных 76. Про TestRay и RMsis облачных почти нет (12 и 1).
- **Xray и Zephyr прочитаны выборочно**, 72 из 584 текстовых отзывов, по
  ключевым словам. Жалобы на функции тест-менеджмента не разбирались.
- **Спрос на подозрительные связи не измерен напрямую.** Точного запроса
  «suspect link» нет ни в одном отзыве. Есть близкие формулировки: «flag if
  requirements updated» и «versioning». Проверять триалами, а не отзывами.
- **Трекер Atlassian проверен только по заголовкам** (11 слов). Поиск по
  тексту (`text ~`) даёт в основном шум и не использовался.
- **Признак Forge/Connect — эвристика** по состоянию страницы листинга
  (`isForgeROACompliant`, скоупы `*:connect-*`). У трёх листингов флага RoA
  на странице нет («н/д»).
- **Trace Gap не исследован глубже листинга.** Отзывов 0, установок 2. Чей
  он, не выяснено. Если ваш, §1 и §4 надо перечитать как «следующий шаг
  своего продукта».
- **Лимиты Forge storage и мульти-продуктовые приложения не проверены** по
  документации. Это первое, что проверить перед кандидатом 1 и кандидатом 2.
