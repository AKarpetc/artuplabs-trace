Начинаем третье платное приложение ArtUp Labs для Atlassian Marketplace — реестр рисков на родных задачах Jira (рабочее название ArtUp Risk). Отвечай по-русски.

## Прочитай сначала
1. Бриф: `/Users/artyomkarpets/IncomeApps/projects/DistributB2B/atlassian/21_app3_risk_register.md` — главный документ.
2. Замер: `/Users/artyomkarpets/IncomeApps/analysis/2026-09-28_atlassian_pipeline.md` §0 (ворота) и §5 №3, №4.
3. Состояние вендора и других приложений: `/Users/artyomkarpets/IncomeApps/projects/DistributB2B/STATE.md`.
4. Платформа: `atlassian/02_forge_implementation.md` §1, `atlassian/03_build_guide.md` §3–4.
5. Образец кода: `~/Projects/My/artuplabs-trace` (main) — связи, срезы со сравнением, Custom UI, i18n, лицензия, CI.

Папка DistributB2B переехала: старые документы пишут `~/DistributB2B/`, реальный путь — `/Users/artyomkarpets/IncomeApps/projects/DistributB2B/`.

## Что сделать
1. **Фаза 0 — ворота R-G1–R-G4 из брифа §3.** Кода продукта нет до их прохождения. Результаты — в §11 брифа. Любое «закрыть» — остановиться и сообщить владельцу с числами; при закрытии R-G1/R-G2 предложить бриф запасного №4 (ArtUp Release).
2. Ворота пройдены → brainstorming по §4 и §6 → план `atlassian/plans/YYYY-MM-DD-artup-risk-v1.md` через superpowers:writing-plans → **показать владельцу и ждать одобрения**.
3. Исполнение через superpowers:subagent-driven-development в `~/Projects/My/artuplabs-risk` — **только после подачи листинга ArtUp Export** (статус в STATE.md, раздел «ArtUp Export»). Если Export ещё не подан — остановиться после плана.

## Правила
- Только Forge, ноль egress (Runs on Atlassian), полный набор scopes в v1 (приложение пишет значения полей риска).
- Секреты: `set -a && . /Users/artyomkarpets/IncomeApps/projects/DistributB2B/.env && set +a`; токены не печатать.
- Коммиты `RISK-<n>: <Description>` + `Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>`. Не пушить и не сливать в main без слова владельца; GitHub-репозиторий создаёт владелец.
- Подача листинга, покупки, действия в браузере с аккаунтом — только владелец.
- Решения без владельца — `Ruling:` в журнал и списком в конце.
- В конце: обновить `STATE.md` (раздел «ArtUp Risk») и строку проекта в `/Users/artyomkarpets/IncomeApps/PROJECTS.md`.
