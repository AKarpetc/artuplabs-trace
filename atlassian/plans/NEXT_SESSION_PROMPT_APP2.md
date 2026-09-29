Начинаем второе платное приложение ArtUp Labs для Atlassian Marketplace — экспорт Confluence Cloud в Markdown, пригодный для git (рабочее название ArtUp Export). Отвечай по-русски.

## Прочитай сначала
1. Бриф: `/Users/artyomkarpets/IncomeApps/projects/DistributB2B/atlassian/20_app2_markdown_export.md` — это главный документ; всё, что ниже, — краткая выжимка.
2. Разбор ниши: `/Users/artyomkarpets/IncomeApps/projects/DistributB2B/atlassian/12_markdown_export_niche.md`.
3. Состояние вендора и первого приложения: `/Users/artyomkarpets/IncomeApps/projects/DistributB2B/STATE.md` (раздел «Что осталось до продаж»).
4. Платформа: `atlassian/02_forge_implementation.md` §1, `atlassian/03_build_guide.md` §3–4.
5. Образец кода: `~/Projects/My/artuplabs-trace` (main) — структура, Custom UI, i18n, лицензия, CI.

Папка DistributB2B переехала: старые документы пишут `~/DistributB2B/`, реальный путь — `/Users/artyomkarpets/IncomeApps/projects/DistributB2B/`.

## Что сделать в этой сессии
1. **Фаза 0 — ворота G1–G4 из брифа §3.** Никакого кода продукта до их прохождения. Результаты записать в §11 брифа. Любое «закрыть» — остановиться и сообщить владельцу с числами.
2. Если ворота пройдены: brainstorming по спорным местам (брифа §4 и §6) → план `atlassian/plans/2026-09-28-artup-export-v1.md` через superpowers:writing-plans → **показать план владельцу и ждать одобрения**.
3. После одобрения — исполнение через superpowers:subagent-driven-development в новом репозитории `~/Projects/My/artuplabs-export`.

## Правила
- Только Forge, ноль egress (Runs on Atlassian), полный набор read-only scopes в v1.
- Секреты: `set -a && . /Users/artyomkarpets/IncomeApps/projects/DistributB2B/.env && set +a`; токены не печатать.
- Коммиты `EXPORT-<n>: <Description>` + `Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>`. Не пушить и не сливать в main без слова владельца; GitHub-репозиторий создаёт владелец.
- Подача листинга, подключение Confluence к dev-сайту, покупки — только владелец.
- Решения без владельца — `Ruling:` в журнал и списком в конце.
- В конце: обновить `STATE.md` (раздел «ArtUp Export») и строку проекта в `/Users/artyomkarpets/IncomeApps/PROJECTS.md`.
