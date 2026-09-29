# Что делать дальше — инструкция для владельца

Составлено 2026-09-27. Отмечайте галочки прямо здесь.

**Обозначения:** 👤 — делаете вы (нужен ваш вход, телефон или решение). 🤖 — делаю я сам, от вас ничего не нужно.

**🤖 Уже делаю параллельно с вами:** тексты карточки Marketplace, сетка цен под 2–3 варианта, список скриншотов, первый деплой в production — нужен ваш запуск или разрешение (этап 4.1).

---

## Этап 1. Прямо сейчас (≈1 час, в любом порядке)

### 1.1 Двухфакторный вход (MFA) — нужен для анкеты безопасности
- [x] 👤 **Atlassian** (hello@artuplabs.com): https://id.atlassian.com/manage-profile/security → **Two-step verification** → Configure → приложение-аутентификатор.
- [x] 👤 **Zoho Mail**: https://accounts.zoho.com/home#security/mfa → **Multi-Factor Authentication** → включить (Zoho OneAuth или любое приложение-аутентификатор).
- [x] 👤 **Cloudflare**: вход через Google — двухфакторка у аккаунта Google (https://myaccount.google.com/signinoptions/two-step-verification). Иначе: https://dash.cloudflare.com/profile/authentication → **Two-Factor Authentication** → Mobile App Authentication. Сохраните резервные коды.
- [x] 👤 **GitHub** (AKarpetc): https://github.com/settings/security → **Two-factor authentication** → Enable.

### 1.2 Адрес security@artuplabs.com
- [x] 👤 https://mailadmin.zoho.com → **Users** → ваш пользователь → **Mail Alias / Email Alias** → **Add** → `security` → сохранить.
- [x] 👤 Проверка: с личной почты отправьте письмо на `security@artuplabs.com` и на `hello@artuplabs.com` — оба должны прийти в ящик Zoho.
- [x] 👤 Аккаунт Atlassian для этого адреса: https://id.atlassian.com/signup (email `security@artuplabs.com`), затем один раз войдите на https://ecosystem.atlassian.net — это и есть «контакт по безопасности» из анкет.

### 1.3 Прочитать две страницы (анкета прямо спрашивает «прочитали?»)
- [x] 👤 Правила исправления уязвимостей: https://developer.atlassian.com/platform/marketplace/security-bugfix-policy/
- [x] 👤 Правила при инциденте: https://developer.atlassian.com/platform/marketplace/app-security-incident-management-guidelines/

### 1.4 Документы для проверки партнёра
- [x] 👤 Документ о регистрации ИП в PDF: https://egov.kz → поиск «уведомление о начале деятельности ИП» / «справка о регистрации ИП» → скачать (или кабинет налогоплательщика https://cabinet.salyk.kz). **Готово: `~/DistributB2B/IE/` — Талон.pdf, Уведомление.pdf, банковские реквизиты.**
- [x] 👤 Загранпаспорт: проверить срок действия (проверка личности через Stripe на телефоне).

### 1.5 Обновить секреты (правило «раз в 90 дней» из анкеты) — сделано 2026-09-28, следующая замена до **2026-12-27**
- [x] 👤 Новый токен Atlassian API: https://id.atlassian.com/manage-profile/security/api-tokens → **Create API token** → вписать в `~/DistributB2B/.env` вместо `FORGE_API_TOKEN` → старый **Revoke**.
- [x] 👤 Токен Cloudflare: https://dash.cloudflare.com/profile/api-tokens → у текущего токена **⋯ → Roll** → новое значение в `.env` вместо `CLOUDFLARE_API_TOKEN`.
- [x] 👤 Напишите мне «секреты обновил» (сами токены в чат не присылайте).
- [x] 🤖 Проверю, что Forge и Cloudflare работают с новыми токенами.

---

## Этап 2. Когда Atlassian ответит на письмо
- [ ] 👤 Ответ придёт на hello@artuplabs.com (или в https://ecosystem.atlassian.net/servicedesk/customer/user/requests). Перешлите/вставьте его мне.
- [ ] 🤖 Разберу ответ и скажу: открываем проверку партнёра заранее (запрос «Submit Partner Verification to publish your app on the Marketplace» в группе App listing) или ждём подачи приложения. Поправлю черновики анкет, если потребуется.
- [ ] 👤 Если через 5 рабочих дней ответа нет — комментарий в тот же запрос: «Kind reminder — could you please advise on the questions above?».

---

## Этап 3. Карточка приложения в Marketplace
- [ ] 🤖 Тексты: название, короткое и полное описание, 3 главных преимущества, раздел Privacy & Security, обоснование каждого скоупа — в `atlassian/listing/`.
- [ ] 🤖 Сетка цен по числу пользователей под 2–3 варианта уровня.
- [ ] 🤖 Список скриншотов с точными шагами съёмки.
- [ ] 👤 **Цена:** выбрать вариант (для ориентира: Trace Gap ≈ $184, Links Explorer ≈ $82 за 200 пользователей в месяц).
- [ ] 👤 **Скриншоты:** снять по моему списку на https://artuplabs-dev.atlassian.net, проект REQ (светлая тема, English, окно ≈ 1440 px), сохранить в `~/DistributB2B/atlassian/listing/screenshots/`.
- [x] 👤 **Юрист:** решено 2026-09-28 — без юриста до первых платящих клиентов.
- [x] 🤖 Пометка «Draft» снята, сайт перевыложен.

---

## Этап 4. Выпуск (в конце)
1. ✅ Первый деплой в production — сделан 2026-09-28 (v2.0.0). 🤖 Проверка лицензии — после появления листинга.
2. 👤 Консоль разработчика https://developer.atlassian.com/console/myapps/ → **ArtUp Trace** → **Distribution** → включить **sharing**. Пришлите скриншот, если кнопки называются иначе — подскажу.
3. 👤 Создать карточку (из консоли разработчика или профиля партнёра https://marketplace.atlassian.com/manage/vendors), вставить мои тексты, скриншоты и ссылки:
   - Privacy Policy — https://artuplabs.com/privacy
   - EULA / Terms — https://artuplabs.com/terms
   - Support — https://artuplabs.com/support
   - Security — https://artuplabs.com/security
4. 👤 Отправить на одобрение. Откроется проверка партнёра (если не открыли раньше) — **14 дней** на анкеты; черновики ответов — [17_partner_verification.md](17_partner_verification.md). 🤖 Помогу заполнить.
5. Ждём решения Atlassian: они пишут «в пределах недели», на практике бывает 2–3 недели.

---

## Параллельно, не срочно
- [ ] 👤 Найти носителей языка для проверки переводов (ja, ko, zh, is, et, fi, cs, sk, hu, ro, tr, pt-PT) — хотя бы японский и китайский. 🤖 Внесу их правки.
- [ ] 👤🤖 Нагрузочный прогон на 300 требований: 🤖 я запускаю скрипт и снимаю замеры; 👤 от вас ~10 минут — один раз сохранить настройки нового проекта на dev-сайте. Скажите, когда будет время.
