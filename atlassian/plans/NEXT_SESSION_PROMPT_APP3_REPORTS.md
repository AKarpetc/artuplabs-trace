Продолжаем третье платное приложение ArtUp Labs — экспорт задач Jira в Excel, Word и PDF по шаблонам (рабочее название ArtUp Reports). Отвечай по-русски.

## Прочитай сначала
1. Бриф: `/Users/artyomkarpets/IncomeApps/projects/DistributB2B/atlassian/22_app3_jira_reports.md` — главный документ, особенно §4 «Планка качества» и §11 «Результаты фазы 0».
2. Выбор темы: `/Users/artyomkarpets/IncomeApps/analysis/2026-09-29_atlassian_top5.md` §4 №1.
3. Образец кода и конвейера: `apps/export` (сборка в браузере, повторы 429, скачивание), `apps/trace` (лицензия, i18n).
4. Состояние: `NEXT_STEPS.md`, `STATE.md`.

## Что сделать
1. Досдать фазу 0: X-G4 (вопросы Community с 2025 г. о форматированном экспорте) и X-G5 (прототип-замер 10 000 задач в .xlsx, 500 задач в .docx/PDF с картинками) → §11 брифа. Любое «закрыть» — стоп и числа владельцу.
2. superpowers:brainstorming по §5–§6 → план `atlassian/plans/2026-09-29-artup-reports-v1.md` (+ `-rulings.md`) через superpowers:writing-plans → **план владельцу, ждать одобрения**.
3. После одобрения — superpowers:subagent-driven-development в `apps/reports`, ветка от `main`.

## Правила
- Только Forge, ноль egress (Runs on Atlassian), полный набор scopes в v1.
- Секреты: `set -a && . /Users/artyomkarpets/IncomeApps/projects/DistributB2B/.env && set +a`; токены не печатать.
- Коммиты `REPORTS-<n>: <Description>` + `Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>`. Не пушить и не сливать в main без слова владельца.
- Подача листинга и покупки — только владелец. Решения без владельца — `Ruling:` в журнал и списком в конце.
- Каждая строка §4 брифа — критерий приёмки; не прошла — не подаём.
