# Что дальше — ArtUp Labs (Atlassian)

Составлено 2026-09-29, обновлено 2026-10-01. Отмечайте галочки прямо здесь. В следующей сессии начинать с этого файла.

## Где мы сейчас

| | Состояние |
|---|---|
| **ArtUp Trace** (Jira) | подан 2026-09-28 → автоотказ «Not enough details on listing»; профиль вендора заполнен, **Resubmit 2026-09-29 — SUBMITTED**. Ждём ответа (ECOHELP-168810, письмо на hello@artuplabs.com) и тикета Partner Verification |
| **ArtUp Export** (Confluence) | приёмка 16 пунктов пройдена 2026-09-29; production v2.1.0, development v2.8.0 (исправлен белый экран после экспорта, EXPORT-19), оба подходят под Runs on Atlassian; проверен на 1 000 страниц; сайт https://artuplabs.com/export/ опубликован; **листинг подан 2026-09-29 — SUBMITTED** (app id 1478660823; первая подача тоже дала автоотказ, после заполнения профиля вендора — Resubmit) |
| **Репозиторий** | всё по Atlassian в одном репозитории: эта папка = `AKarpetc/artuplabs-trace` (ветка `monorepo`, PR #8 не слит). Внутри: `apps/trace`, `apps/export`, `atlassian/` (документы), `site/`, `STATE.md` |
| **ArtUp Reports** (Jira, №3) | production 2.0.0; **листинг подан 2026-09-30 — SUBMITTED** (app id 3870724810; первая подача — автоотказ, Resubmit). Открыт пункт 6 приёмки (второй аккаунт) — раздел 8 ниже |
| **Приложение №4** | **ArtUp Import** — импорт папок Markdown в Confluence: бриф [atlassian/24_app4_markdown_import.md](atlassian/24_app4_markdown_import.md), **закрыт на фазе 0 2026-10-01** по I-G4 (спрос: 1–3 вопроса при пороге 5). Тестовые пространства IGSMK, IMPT удалены. **№5 ArtUp Query (расширения JQL)** — бриф [atlassian/25_app5_jql.md](atlassian/25_app5_jql.md), фаза 0 с 2026-10-01, ветка `jql-v1` |

---

## Что сделать вам (по порядку)

### 1. Слить PR с монорепозиторием (⏱ 2 мин)
- [x] https://github.com/AKarpetc/artuplabs-trace/pull/8 → **Merge**. CI `test` зелёный.
- [x] После слияния в этой папке: `git checkout main && git pull` (2026-09-29, после PR #10).

### 2. Проверить ArtUp Export в браузере (⏱ 40–60 мин) — до подачи листинга
- [x] Пройдите 16 пунктов из [atlassian/plans/2026-09-28-artup-export-acceptance.md](atlassian/plans/2026-09-28-artup-export-acceptance.md) на https://artuplabs-dev.atlassian.net, пространство **EXPT**. Главное: в zip есть картинки (`*.assets`), zip скачивается, а если не скачался сам — срабатывает «Скачать ещё раз».
- [x] Если что-то не так, напишите в новой сессии номер пункта и что увидели.

### 3. Решить название и цену ArtUp Export (⏱ 10 мин)
- [x] Название: «ArtUp Export – Markdown for Git & Docs Sites» или вариант из [atlassian/listing-export/description.md](atlassian/listing-export/description.md).
- [x] Цена: рекомендую **B — $165/мес за 200 пользователей, до 10 бесплатно** ([pricing.md](atlassian/listing-export/pricing.md)).
- [x] Прочитать разделы про Export: https://artuplabs.com/privacy (§5), /security (§1.1, §2), /terms.

### 4. Подать листинг ArtUp Export (⏱ 30–40 мин)
- [x] Подан 2026-09-29 (агент в браузере + владелец: Payment, Resubmit). Заодно заполнен профиль вендора: логотип, About, Support Channels, Hours of Operation, Payment.
- [ ] Если снова придёт «Automatic Rejection» — сказать мне: составлю вопрос в ecosystem-поддержку (портал 34, «Questions about Marketplace»).

### 5. ArtUp Trace — ждать и отвечать
- [ ] Следить за письмами на hello@artuplabs.com: ответ по ревью (ECOHELP-168810), тикет Partner Verification.
- [ ] Когда придёт тикет верификации, на анкету даётся **14 дней**. Всё подготовлено в [atlassian/17_partner_verification.md](atlassian/17_partner_verification.md) (документы ИП в `IE/`, черновики обеих анкет).
- [ ] Когда Trace появится в Marketplace, скажите мне — отключу ежедневную облачную проверку публикации.

### 6. Навести порядок в папках (⏱ 10 мин, когда удобно)
- [ ] `IncomeApps/projects/DistributB2B-docs` — полная копия старой папки. Перенесите оттуда `mobile/`, `ideas/` и прочее не-Atlassian в родительскую папку, потом удалите её (Atlassian-часть уже здесь).
- [ ] Удалить `~/Projects/My/artuplabs-export` — больше не нужна (код в `apps/export`).
- [ ] По желанию переименовать репозиторий на GitHub (например, в `artuplabs`): Settings → Rename. Старые ссылки GitHub перенаправит; потом `git remote set-url origin git@github.com:AKarpetc/<новое имя>.git`.

### 7. Когда будет возможность (не блокирует)
- [ ] Показать переводы носителям: ja, ko, zh-CN, zh-TW, is, et, fi, cs, sk, hu, ro, tr, pt-PT (файлы `apps/*/static/app/src/i18n/locales/`).
- [ ] До **2026-12-27** — перевыпустить токены Atlassian и Cloudflare (лежат в `.env`).

### 8. ArtUp Reports — подан на одобрение 2026-09-30
- [x] C1/C2 браузерная приёмка пройдена 2026-09-30 (кроме п.6 — нет второго аккаунта; сделать до одобрения): [atlassian/plans/2026-09-30-artup-reports-browser-test.md](atlassian/plans/2026-09-30-artup-reports-browser-test.md).
- [x] Production: `forge deploy -e production` 2026-09-30 → версия 2.0.0, eligible для Runs on Atlassian; dev 3.5.0.
- [x] Сайт: разделы Reports в privacy/security/terms, документация https://artuplabs.com/docs/reports/ (деплой 2026-09-30).
- [x] Листинг Marketplace (app id 3870724810, `com.artuplabs.reports`) заполнен и подан: цены R32 ($319 за 200, до 10 бесплатно), Privacy & Security отправлены, R23 закрыт R31 (предел 2 000).
- [ ] Пункт 6 (права на проектный шаблон) — завести второй аккаунт и проверить до одобрения.
- [x] Первая подача сразу получила «Automatic Rejection – Not enough details on listing» (как у Trace и Export) → Resubmit 2026-09-30 → **SUBMITTED**. Наблюдение: автопроверка отклоняет первую подачу, повторная проходит.

#### Архив: исходный список шагов
Всё лежит в ветке `reports-v1` (локально, не запушена). Замеры и чек-лист C2: [atlassian/plans/2026-09-29-artup-reports-acceptance.md](atlassian/plans/2026-09-29-artup-reports-acceptance.md).
- [ ] **C1 (⏱ 20 мин).** На https://artuplabs-dev.atlassian.net открыть шесть точек входа один раз: страница «ArtUp Reports» (меню приложений), поиск задач (Приложения → «Экспорт в Excel, Word или PDF»), доска, бэклог, меню спринта, одна задача. Проверить, что модальное окно шире 600 px и что ссылка «Open ArtUp Reports» ведёт на страницу приложения, а не на 404 (Ruling R22 — маршрут не проверен). Посмотреть контактный лист скриншотов: `apps/reports/static/app/screenshots/index.html` (локально; если нет — `npm run screenshots` в `apps/reports/static/app`).
- [ ] **C2 (⏱ 1–1,5 ч).** Чек-лист из 9 пунктов в разделе B файла приёмки, включая **пункт 9** (память вкладки на 500–2 000 задач с картинками) и пункт 4 (скорость картинок в браузере). Результат — в колонку «Итог».
- [ ] **Решение по R23.** Предел Word/PDF 2 000 задач: в Node на 2 000 задач с картинками пик 2,3 ГБ (Word) и 2,2 ГБ (PDF) при пороге тревоги 1,5 ГБ. Варианты: оставить 2 000, снизить до ≈ 1 000 для Word/PDF с картинками, уходить на миниатюры. Пока решения нет, в листинге и на сайте число задач для Word/PDF не указано (в `listing.md` стоит метка `[OWNER: …]`); после решения вписать число, которое подтверждено замером.
- [ ] **Скриншот результата** (`listing-reports/screenshots/draft/3-result.png`) показывает «30 issues in 0 s»: фикстура предпросмотра берёт реальное время прогона. Перед подачей сделать кадр после реального экспорта на dev или оставить как есть (решение владельца). Заявление «без водяного знака» проверено только на файлах; поведение сайта без лицензии — после листинга (строка 7 приёмки), на странице сайта оно не заявлено.
- [ ] **Переводы.** Показать носителям ko, is, et, hu (файлы `apps/reports/static/app/src/i18n/locales/`); остальные — по желанию (ja, zh-CN, zh-TW, fi, cs, sk, ro, tr, pt-PT — как у Export).
- [ ] **Черновики листинга** [atlassian/listing-reports/](atlassian/listing-reports/): прочитать `listing.md`, `highlights.md`, `privacy-security.md`; заполнить метки `[OWNER: …]` — **цена** (в брифе только якорь $319 за 200 мест и «до 10 бесплатно», тарифов нет), категории, ответ «хранит ли приложение персональные данные» (хранится Atlassian account id автора шаблона — ответ «Да»), формулировка про удаление данных при деинсталляции.
- [ ] **Юридические страницы сайта.** `site/privacy.html`, `security.html`, `terms.html` про Reports пока ничего не говорят: попросить меня добавить разделы (факты — в `privacy-security.md`) и прочитать их до деплоя сайта.
- [ ] **Production deploy (по вашему слову).** `forge deploy -e production` потребует `--approve MAJOR_VERSION_RULE` (новые scope: `read:board-scope.admin:jira-software`, `read:project:jira`); после деплоя админы сайтов должны заново дать согласие на установку. Затем `forge eligibility -e production` — только после него заявлять Runs on Atlassian.
- [ ] **Сайт.** Проверить `site/reports/index.html` локально, затем деплой сайта (как для Export). Страница продукта и карточка на главной уже в ветке; деплой — только вы.
- [ ] **Подача листинга — только вы** (партнёрский портал): после production deploy, деплоя сайта и решения по R23. Скриншоты: `atlassian/listing-reports/screenshots/draft/*.png` (1840×900).

---

## Что делаем дальше (моя работа, в следующих сессиях)

| Когда | Что | Где лежит |
|---|---|---|
| Сразу, если приёмка Export нашла проблемы | исправить, перевыложить development и production | [atlassian/23_export_owner_steps.md](atlassian/23_export_owner_steps.md) |
| Сейчас (2026-10-01) | **приложение №5 ArtUp Query**: фаза 0 → §11 брифа [25](atlassian/25_app5_jql.md); прототип свежести J-G5 — только после J-G1…J-G4. №4 ArtUp Import закрыт 2026-10-01 по I-G4. Дальше: №6 ArtUp Release → №7 Гант | `analysis/2026-09-29_atlassian_top5.md` §4 №3 |
| После одобрения Trace | проверка лицензии в production; бэклог v1.1: убрать scope `read:jira-user`, если не нужен (мажорная версия), новый логотип, нагрузочный прогон на 300 требований | `STATE.md` → «Бэклог следующей версии» |
| После одобрения Export | бэклог v1.1: папки в корне пространства (CQL `type=folder`) + предупреждение, если найдено меньше страниц, чем в поиске; удаление осиротевших `_category_.json`/`.pages`; параллельное чтение меток; `:emoji:` для неизвестных смайлов | [atlassian/plans/2026-09-28-artup-export-v1-rulings.md](atlassian/plans/2026-09-28-artup-export-v1-rulings.md) (строки «parked») |
| Через 60 дней после листинга каждого приложения | замер: < 30 установок — снимаем и записываем отрицательный результат; ≥ 30 и ≥ 5 платящих — развиваем | бриф §10 |

---

## Промпт для следующей сессии

Вставить в новую сессию Claude Code, открытую в этой папке:

```
Продолжаем ArtUp Labs (Atlassian Marketplace). Отвечай по-русски.
Прочитай сначала: NEXT_STEPS.md (что сделано и что дальше), STATE.md, atlassian/README.md.
Репозиторий — эта папка (GitHub AKarpetc/artuplabs-trace): apps/trace, apps/export, atlassian/ (документы), site/.
Команды npm и forge — из папки приложения; секреты: set -a && . ./.env && set +a (токены не печатать).
Я сделал: <перечислите пункты из «Что сделать вам» или результаты приёмки Export>.
Задача сессии: <например: «исправить замечания приёмки Export» или «приложение №3 ArtUp Release: бриф и фаза 0»>.
Правила прежние: PR в main сливаю я; коммиты <KEY>-<n>: Description + Co-Authored-By; решения без меня — Ruling в журнал и списком в конце.
```
