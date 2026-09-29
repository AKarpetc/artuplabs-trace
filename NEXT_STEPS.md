# Что дальше — ArtUp Labs (Atlassian)

Составлено 2026-09-29. Отмечайте галочки прямо здесь. В следующей сессии начинать с этого файла.

## Где мы сейчас

| | Состояние |
|---|---|
| **ArtUp Trace** (Jira) | листинг подан 2026-09-28, ждём одобрения (тикет ECOHELP-168810, ответ письмом на hello@artuplabs.com) и тикета Partner Verification |
| **ArtUp Export** (Confluence) | приёмка 16 пунктов пройдена 2026-09-29; production v2.1.0, development v2.8.0 (исправлен белый экран после экспорта, EXPORT-19), оба подходят под Runs on Atlassian; проверен на 1 000 страниц; сайт https://artuplabs.com/export/ опубликован; **листинг не подан** — ждёт ваших шагов ниже |
| **Репозиторий** | всё по Atlassian в одном репозитории: эта папка = `AKarpetc/artuplabs-trace` (ветка `monorepo`, PR #8 не слит). Внутри: `apps/trace`, `apps/export`, `atlassian/` (документы), `site/`, `STATE.md` |
| **Приложение №3** | ArtUp Risk закрыт на фазе 0; следующий кандидат — ArtUp Release (кросс-проектные релизы), бриф не написан |

---

## Что сделать вам (по порядку)

### 1. Слить PR с монорепозиторием (⏱ 2 мин)
- [x] https://github.com/AKarpetc/artuplabs-trace/pull/8 → **Merge**. CI `test` зелёный.
- [ ] После слияния в этой папке: `git checkout main && git pull`.

### 2. Проверить ArtUp Export в браузере (⏱ 40–60 мин) — до подачи листинга
- [x] Пройдите 16 пунктов из [atlassian/plans/2026-09-28-artup-export-acceptance.md](atlassian/plans/2026-09-28-artup-export-acceptance.md) на https://artuplabs-dev.atlassian.net, пространство **EXPT**. Главное: в zip есть картинки (`*.assets`), zip скачивается, а если не скачался сам — срабатывает «Скачать ещё раз».
- [x] Если что-то не так, напишите в новой сессии номер пункта и что увидели.

### 3. Решить название и цену ArtUp Export (⏱ 10 мин)
- [ ] Название: «ArtUp Export – Markdown for Git & Docs Sites» или вариант из [atlassian/listing-export/description.md](atlassian/listing-export/description.md).
- [ ] Цена: рекомендую **B — $165/мес за 200 пользователей, до 10 бесплатно** ([pricing.md](atlassian/listing-export/pricing.md)).
- [ ] Прочитать разделы про Export: https://artuplabs.com/privacy (§5), /security (§1.1, §2), /terms.

### 4. Подать листинг ArtUp Export (⏱ 30–40 мин)
- [ ] 10 шагов с готовыми текстами и скриншотами — [atlassian/23_export_owner_steps.md](atlassian/23_export_owner_steps.md), шаг 3.

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

---

## Что делаем дальше (моя работа, в следующих сессиях)

| Когда | Что | Где лежит |
|---|---|---|
| Сразу, если приёмка Export нашла проблемы | исправить, перевыложить development и production | [atlassian/23_export_owner_steps.md](atlassian/23_export_owner_steps.md) |
| Следующая сессия (не ждёт ничего) | **приложение №3 ArtUp Release**: бриф `atlassian/22_app3_release.md` по образцу [20](atlassian/20_app2_markdown_export.md)/[21](atlassian/21_app3_risk_register.md), фаза 0 (ворота спроса до кода), при прохождении — план и код в `apps/release` | [atlassian/README.md](atlassian/README.md) |
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
