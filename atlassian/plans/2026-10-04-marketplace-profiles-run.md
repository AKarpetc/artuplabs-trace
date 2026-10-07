# Проход по профилям Marketplace — 2026-10-04

Браузер: своя вкладка, вход в Atlassian уже был (запрос логина не появлялся). Пароли, карты, ИИН не вводились.

## Главное

- **Все три листинга сейчас в статусе SUBMITTED, и портал показывает «This app is pending approval by Atlassian and cannot be edited».** Поля листинга (App details, версия: Details/Highlights/Media/Compatibility/Links, Pricing) заблокированы (`disabled`), «Save» недоступен. Править их нельзя до ответа Atlassian; отзывать подачу не стал (запрещено заданием).
- Изменено одно: **адрес в профиле вендора** (было «Protozanova 119 - 33»).

## Профиль вендора ArtUp Labs (Vendor 260356594) — Details

| Раздел | Было | Стало |
|---|---|---|
| Contact Info, адрес | `Protozanova 119 - 33`, Ust-Kamenogorsk, VKO 070004, Kazakhstan | Line 1 `32 E. P. Slavsky Embankment`, Line 2 `apt. 132`, Ust-Kamenogorsk, VKO 070004, Kazakhstan. Сохранено, повторное чтение страницы подтвердило. Источник: уведомление о регистрации ИП (коммит cc765d3, `17_partner_verification.md`). |
| About | заполнен 2026-09-29; упоминает только Trace и Export | не менялось (см. «Владельцу», п. 2) |
| Support Channels (email, /support, телефон) | заполнено | без изменений |
| Hours of Operation / SLA | Mon-Fri 9:00 AM - 6:00 PM GMT+5, SLA-ссылка на /support | без изменений |
| Trust center link | не добавлен (необязательное) | не менялось |
| Team, Payment, Security (вкладки вендора) | не открывались: Payment содержит платёжные реквизиты, их заполняет только владелец | — |

Поля State = «VKO» и Postal Code 070004 оставил как были (совпадают с документами). City = Ust-Kamenogorsk.

## ArtUp Trace (app 2914407754, com.artuplabs.trace) — SUBMITTED

Только чтение, правок нет (заблокировано).
- App details: название, tagline, summary, категории (Project management, Software development), ключевые слова (Audit, Compliance, Reporting, Testing & QA), логотип, Jira и JSM compatible, privacy URL https://artuplabs.com/privacy — заполнены. «App stores personal data» отмечено (значение Yes). Пусты необязательные: Analytics ID, Issue tracker URL, Support ticketing URL, Statuspage, Forums, JSM widget, баннер UPM.
- Версия 2.1.0 (PUBLIC; 2.2.0 — служебная PRIVATE, создана Marketplace Hub): Details (Commercial, supported Yes, Release summary, More details, Release notes) заполнены; Highlights, Media, Links (documentation https://artuplabs.com/docs) заполнены.
- Pricing: бесплатно до 10, далее $0.70 / $0.59 / $0.49 … за пользователя, single = multi-instance — как в черновике.
- Privacy & Security (подано 2026-09-28): Runs on Atlassian, данные вне Atlassian не хранятся, REST API нет, Bug Bounty No, сертификаты None, GDPR processor Yes с перечнем данных — заполнено. **Адрес ИП в форме не показывается** (поле адреса в нём не отображается, он есть только в черновике `privacy-security-tab.md` и в тексте политики на сайте), поэтому «Protozanov» нигде в листинге не найден.

## ArtUp Export (app 1478660823, com.artuplabs.export) — SUBMITTED

Только чтение.
- App details: полные (категории Content and communication, Software development; ключевые слова Document Management, Documentation, Import/Export, Knowledge Base; логотип; privacy URL).
- Версия 2.1.0: Details с описанием и release notes, Compatibility = Confluence Cloud, Links documentation https://artuplabs.com/docs/export/ — заполнено.
- Pricing: бесплатно до 10; $0.90 (1–100), $0.75 (101–250), $0.63 (251–1000)…; 200 пользователей = $165/мес — вариант B из `pricing.md`.
- Privacy & Security (подано 2026-09-29): заполнено (данные не хранятся, права доступа перечислены, processor Yes). Адреса в форме нет.

## ArtUp Reports (app 3870724810, com.artuplabs.reports) — SUBMITTED

Только чтение.
- Версия 2.0.0 (PUBLIC; 2.1.0 — служебная): Details, release summary и notes заполнены, support Yes.
- Privacy & Security подано 2026-09-30, содержимое присутствует (данные вне Atlassian не хранятся, REST API нет).
- Pricing (по NEXT_STEPS): $319 за 200, до 10 бесплатно — на странице цен не перепроверял.
- Highlights, Media, Compatibility — не открывал подробно, заполнены при подаче 2026-09-30 по `NEXT_STEPS.md`.

## Что осталось владельцу

1. Дождаться ответа Atlassian; править листинги можно только после снятия «pending approval» или при отклонении (тогда — Resubmit).
2. По желанию добавить в About вендора ArtUp Reports (сейчас упомянуты только Trace и Export). Правка About разрешена, но я не менял: текст визитной карточки лучше утвердить вам.
3. Необязательные пустые поля: Issue tracker URL, Support ticketing URL, Statuspage, Trust center link. Заполнять их можно, когда листинги разблокируются.
4. Если форма Privacy & Security когда-нибудь запросит адрес — использовать `32 E. P. Slavsky Embankment, apt. 132, Ust-Kamenogorsk, 070004`.
5. Вкладки Payment и Team, налоговые данные и Partner Verification — только вы.
6. Сайт: адрес в `site/terms.html` и `site/privacy.html` приведён к новому в репозитории (2026-10-04), но по `NEXT_STEPS.md` п. 7a сайт ещё нужно перевыложить.
7. Пункт 6 приёмки Reports (второй аккаунт) остаётся открытым.

## Follow-up

**A. Деплой сайта с новым адресом — НЕ выполнен (защита сработала).** Сравнил живой https://artuplabs.com (страницы отдаются без .html) с `site/` локально. Бинарные файлы (png, webp, svg) совпадают, но все HTML и `style.css` отличаются, причём не только адресом:
- На живом сайте новее: favicon.svg и apple-touch-icon, i18n-атрибуты (`data-i18n-html`), логотип-марка `../assets/artuplabs-mark.svg` в шапке, другой размер бренд-иконки в `style.css`.
- `index.html`: на живом сайте другие title и description с продуктом ArtUp AR XR (в локальной копии его нет).
- Затронуты: index, support, terms, security, docs, privacy, export/index, reports/index, docs/export/index, docs/reports/index, style.css (всего 11 файлов).
Деплой локальной копии затёр бы более новый живой контент. Нужно сначала подтянуть живую версию в `site/` (или найти ветку/репозиторий, откуда её выкладывали), применить правку адреса из cc765d3 к ней и только потом выкладывать.

**B. About вендора — обновлён.** В профиле ArtUp Labs (Vendor 260356594) → Details → About добавлена фраза «ArtUp Reports exports Jira issues to Excel, Word or PDF.» в том же стиле. Сохранено, страница перечитана после перезагрузки, текст на месте. Payment, Team и налоги не трогались, запрос логина не появлялся. Вкладка закрыта.
