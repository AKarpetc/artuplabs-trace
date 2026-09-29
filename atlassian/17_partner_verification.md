# Проверка партнёра Atlassian (Partner Verification) — подготовка

Сверено 2026-09-25 по документации Atlassian (ссылки внизу).

## Как это устроено

- Тикет проверки создаётся **в момент запроса одобрения приложения** (подача листинга), не раньше.
- После создания тикета — **14 дней**, иначе тикет отклоняют. За эти дни:
  1. форма с данными бизнеса (Identity Information Collection);
  2. анкета безопасности партнёра (Partner Security Questionnaire, 28 вопросов);
  3. проверка личности через Stripe Identity — телефон с камерой + документ;
  4. проверка бизнеса идёт сама, асинхронно.
- Отдельно при подаче приложения — анкета безопасности **приложения** (для Forge, 18 вопросов).
- Сроки проверки Atlassian не публикует.

Вывод: всё ниже готовим заранее, чтобы в 14 дней уложиться за один вечер.

## 1. Документы (собрать сейчас)

| Что | Откуда | Готово? |
|---|---|---|
| Название бизнеса: ИП «…» (как в регистрации) и торговое имя ArtUp Labs | талон/уведомление о регистрации ИП | ☐ |
| Физический адрес ИП: Protozanov Street 119, apt. 33, Ust-Kamenogorsk, East Kazakhstan Region, Kazakhstan | то же | ☑ |
| Налоговый/регистрационный номер: ИИН (есть, в site/terms.html) | то же | ☑ |
| Скан/фото талона о регистрации ИП (PDF) — на случай запроса «other documents» | eGov → «Уведомление о начале деятельности ИП» | ☐ |
| Загранпаспорт (Stripe Identity принимает паспорт; удостоверение РК может не пройти) | — | ☐ |
| Телефон с камерой | — | ☐ |
| Форма W-8BEN (налоги) — заполняется в Marketplace-профиле для выплат, см. STATE.md «Выплаты и налоги» | — | ☐ |

## 2. Письмо в Atlassian — отправить сейчас

Куда: https://ecosystem.atlassian.net/servicedesk/customer/portal/34 → карточка **App listing** → тип **«Questions about Marketplace»**. Войти как hello@artuplabs.com. В той же группе есть тип «Submit Partner Verification to publish your app on the Marketplace» — открывать только после ответа на вопрос 3 и готовности п.3 (14 дней пойдут с момента открытия).

> **Subject:** Partner verification for a Kazakhstan sole proprietor — questions before first app submission
>
> Hello,
>
> I run ArtUp Labs, a Marketplace partner profile created in September 2026. I am preparing my first paid Forge app (ArtUp Trace, requirements traceability for Jira Cloud) for submission and would like to prepare the partner verification in advance.
>
> My business is registered as an individual entrepreneur (sole proprietor, "ИП") in the Republic of Kazakhstan. Could you please confirm:
>
> 1. Is a Kazakhstan sole proprietorship accepted as the business entity for partner verification? Which document do you accept as proof of registration (the state registration notice issued by eGov, containing my Individual Identification Number, IIN)?
> 2. For identity verification via Stripe Identity, is a Kazakhstan passport supported?
> 3. I see the request type "Submit Partner Verification to publish your app on the Marketplace" in this portal. Can I use it now, before my app approval request, so that verification runs in parallel with development? Does the 14-day deadline start when I open that request?
> 4. For payouts: as a non-US individual I plan to submit form W-8BEN. Does Atlassian withhold any tax on Marketplace payouts to a Kazakhstan sole proprietor, and is payout by bank transfer (SWIFT, USD) to a Kazakhstan bank account supported?
>
> Thank you,
> Artyom Karpets
> ArtUp Labs — hello@artuplabs.com

(Фамилию и имя поправьте, если в документах иначе.)

## 3. Что сделать до подачи, чтобы честно ответить «да»

Дёшево и за вечер:

1. **MFA везде:** Atlassian-аккаунт hello@artuplabs.com, GitHub (когда будет), почта Zoho, Cloudflare, Apple/Google. → Q6, Q12.
2. **Контакт по безопасности:** security@artuplabs.com (псевдоним в Zoho на ту же почту) и аккаунт этого адреса на ecosystem.atlassian.net. → Q28 / app Q18.
3. **Прочитать** Marketplace Security Bug Fix Policy и Security Incident Notification Guide (ссылки внизу). → Q26, Q27a, app Q16.
4. **План реагирования на инциденты** — черновик готов: [18_incident_response_plan.md](18_incident_response_plan.md); опубликовать на artuplabs.com/security. → Q20.
5. **Проверка зависимостей в CI:** Dependabot + `npm audit` на GitHub (при заведении репозитория). Сейчас `npm audit` — 0 уязвимостей в обоих пакетах. → Q17, Q25 (SCA), app Q11, Q15.
6. **Менеджер паролей** (связка Apple/1Password) как «парольная политика» для компании из одного человека. → Q19.
7. **Ротация секретов:** токены Forge/Cloudflare в `.env` — записать правило «раз в 90 дней и при подозрении», один раз перевыпустить. → Q18.
8. **Антивирус:** на macOS встроенный XProtect/Gatekeeper — отвечать «да» можно, если они включены (по умолчанию включены). → Q3.

## 4. Анкета партнёра — черновик ответов

Отвечать честно: «нет» у компании из одного человека нормально, враньё — повод для отказа.

| # | Вопрос (кратко) | Ответ | Основание / что сделать |
|---|---|---|---|
| 1 | Число сотрудников | Micro 1–9 | один человек |
| 2 | Был ли бан на Marketplace | No | |
| 3 | Антивирус/защита рабочих станций | Yes | macOS XProtect + Gatekeeper включены |
| 4 | Полное шифрование диска | Yes | FileVault включён (проверено 2026-09-25) |
| 5 | Процесс обновлений ОС и ПО | Yes | автообновления macOS, `npm audit` |
| 6 | MFA на всех аккаунтах | Yes — **после п.3.1** | |
| 7 | Шифрование данных на серверах приложения | Yes | данные только в Forge SQL/KVS (Atlassian шифрует at rest); своих серверов нет |
| 7a | Шифрование бэкапов | Yes | то же, бэкапы — на стороне Atlassian |
| 8 | Логи с метками времени (9 категорий) | Частично → ответить честно | Forge логирует вызовы функций; входы/сессии — на стороне Jira. Уточнить поле: если одно «да/нет» на всё — **No** |
| 9 | Логируете ли секреты/токены | No | в коде логируются только ошибки синхронизации и число миграций |
| 10 | Хранение логов 12 месяцев | No | Forge хранит логи ограниченно |
| 11 | Мониторинг логов с алертами | No (или Yes, если включить алерты в Developer Console) | |
| 12 | MFA на системе контроля версий | Yes — **после заведения GitHub с MFA** | |
| 13 | Изменения в прод только через PR | Yes — если ветка main защищена на GitHub | |
| 14 | PR требует одобрения коллеги | No | один разработчик; ревью делает второй проход (AI-ревьюер) — это не «peer» |
| 15 | Ознакомлены с OWASP Top 10 | Yes | |
| 16 | Тестирование безопасности в разработке | Yes | проверки прав на каждом резолвере, валидация входов, ревью безопасности |
| 17 | Библиотеки без уязвимостей | Yes | `npm audit` 0; Dependabot после GitHub |
| 18 | Ротация ключей и секретов | Yes — **после п.3.7** | |
| 19 | Строгая парольная политика | Yes | менеджер паролей, уникальные пароли |
| 20 | План реагирования на инциденты | Yes — **после публикации п.3.4** | |
| 21 | Участие в bug bounty Marketplace | No | |
| 21a | Свой bug bounty у другого провайдера | No | |
| 21b | Интересно подключиться | Yes | |
| 22 | Регулярный пентест | No | |
| 23 | Сертификации (ISO, SOC 2 …) | No | |
| 24 | Внешние аудиты | No | |
| 25 | Сканирование уязвимостей | Yes — SCA | `npm audit` / Dependabot |
| 26 | Прочитали Bug Fix Policy | Yes — **после п.3.3** | |
| 27 | Уведомлять клиентов и Atlassian об инциденте | Yes | |
| 27a | Прочитали Incident Notification Guide | Yes — **после п.3.3** | |
| 28 | Контакт по безопасности на ecosystem.atlassian.net | Yes — **после п.3.2** | |

## 5. Анкета приложения (Forge) — черновик ответов

Проверено по коду `~/Projects/My/artuplabs-trace` (ветка trace-v1-custom-ui, 2026-09-25).

| # | Вопрос (кратко) | Ответ | Основание |
|---|---|---|---|
| 1 | Есть действия пользователя | Yes | страница проекта, панель задачи |
| 2 | `asUser()` для действий пользователя | Yes | все запросы к Jira из резолверов — `asUser()` (`src/infra/jira.js`, `resolvers.js`) |
| 3 | Forge Remote | No | |
| 4 | Проверка прав перед `asApp()` | Not applicable / Yes | фоновые задачи (`asApp`) идут без пользователя; каждый резолвер сначала проверяет права через `/rest/api/3/mypermissions` от имени пользователя |
| 5 | Web-триггеры | No | в манифесте нет |
| 6 | Display conditions | No | |
| 7 | Отправка данных наружу (egress) | No | внешних хостов нет; Runs on Atlassian — eligible |
| 8 | Минимальные права | Yes | скоупы `read:jira-work`, `read:jira-user`, `storage:app`; `write:jira-work` убран 2026-09-25 |
| 9 | Логирование чувствительных данных | No | только тексты ошибок синхронизации и счётчик миграций |
| 10 | Валидация входных данных | Yes | «Все id проектов, задач, связей и снимков проверяются на формат до обращения к хранилищу (`isJiraId`, `isBaselineId`); запросы к Forge SQL параметризованы; пути Jira REST собираются с `encodeURIComponent`; снимки сверяются с проектом пользователя; интерфейс выводит данные только через React (без HTML-вставок).» |
| 11 | Проверка зависимостей автоматически | Yes | `npm audit` — 0; Dependabot после GitHub |
| 12 | Сбор учётных данных Atlassian | No | |
| 13 | Сбор чужих токенов | No | |
| 14 | Секреты в открытом виде в коде/репо | No | секретов в коде нет; `.env` вне репозитория |
| 15 | Сканирование уязвимостей | Yes — SCA | |
| 16 | Прочитали Bug Fix Policy | Yes — после п.3.3 | |
| 17 | Уведомлять об инциденте | Yes | |
| 18 | Контакт по безопасности | Yes — после п.3.2 | |

## Источники

- https://developer.atlassian.com/platform/marketplace/partner-due-diligence/
- https://developer.atlassian.com/platform/marketplace/partner-security-questionnaire/
- https://developer.atlassian.com/platform/marketplace/app-security-questionnaires/
- https://developer.atlassian.com/platform/marketplace/app-approval-security-workflow/
- https://developer.atlassian.com/platform/marketplace/security-bugfix-policy/
- https://developer.atlassian.com/platform/marketplace/app-security-incident-management-guidelines/
- https://developer.atlassian.com/platform/marketplace/preparing-for-a-security-incident/
