Продолжаем проект ArtUp Trace — платное приложение для Jira Cloud (Forge) по прослеживаемости требований. Отвечай по-русски.

## Где что лежит
- Состояние всей работы: `~/DistributB2B/STATE.md` — прочитай разделы «ArtUp Trace v1 — код написан», «Приёмка ArtUp Trace» и «Замечания приёмки → план Custom UI».
- Код: `~/Projects/My/artuplabs-trace`, ветка **`trace-v1-custom-ui`** (создана от `a288b15`, коммитов по новому плану ещё нет). Ветка `trace-v1` — рабочая v1 на UI Kit, прошла приёмку. Ничего не пушить, в main не сливать.
- План, который нужно выполнить: `~/DistributB2B/atlassian/plans/2026-09-25-artup-trace-custom-ui.md` (8 задач: Custom UI, 26 языков Jira, красивый и удобный интерфейс, экспорт CSV как скачивание файла).
- Предыдущий план и все принятые решения (R1–R27): `~/DistributB2B/atlassian/plans/2026-09-24-artup-trace-v1.md`, `~/DistributB2B/atlassian/plans/2026-09-24-artup-trace-v1-rulings.md`. Бэкенд (`src/core`, `src/infra`, `src/handlers`) не меняем.
- Секреты: `~/DistributB2B/.env` (CLOUDFLARE_API_TOKEN, FORGE_EMAIL, FORGE_API_TOKEN). Перед командами forge: `set -a && . ~/DistributB2B/.env && set +a`. Токен никогда не печатать.
- Тестовый сайт: `artuplabs-dev.atlassian.net`, проект **REQ** (id 10002; «История» 10005 = требование, «Задача» 10006 = проверка). Проект TRC — мусор от агентов, для приёмки не годится. Удалять задачи на сайте нельзя (403).

## Что сделать
1. Выполнить план `2026-09-25-artup-trace-custom-ui.md` через **superpowers:subagent-driven-development** (пользователь выбрал этот способ): по агенту на задачу, ревьюер после каждой, в конце итоговая проверка всей ветки на самой сильной модели. Журнал хода — в `.superpowers/sdd/` репозитория (скрипт `sdd-workspace`).
2. После итогового ревью — задеплоить в development и дать пользователю короткий список ручной проверки в браузере (русский/английский язык Jira, тёмная/светлая тема, карточки, поиск, клики по ключам, «подтвердить выбранные», сравнение снимков, скачивание CSV и открытие в Google Sheets, панель в задаче).
3. Обновить `~/DistributB2B/STATE.md` результатом.

## Проверенные факты (не перепроверять)
- Custom UI iframe в Forge имеет `allow-downloads` → Blob + `<a download>` работает по клику пользователя (developer.atlassian.com/platform/forge/custom-ui/iframe/).
- Custom UI сохраняет Runs on Atlassian и 100% выручки, если нет внешнего egress (всё бандлить, никаких CDN/шрифтов извне). Проверять `forge eligibility -e development --non-interactive`.
- Локали Forge: zh-CN, zh-TW, cs-CZ, da-DK, nl-NL, en-US, en-GB, et-EE, fi-FI, fr-FR, de-DE, hu-HU, is-IS, it-IT, ja-JP, ko-KR, no-NO, pl-PL, pt-BR, pt-PT, ro-RO, ru-RU, sk-SK, tr-TR, es-ES, sv-SE. Переводы бандлить во фронтенд (у `translations` в манифесте лимит 100 КБ суммарно).
- `forge install --upgrade` может зависнуть после успеха — запускать через `perl -e 'alarm 300; exec @ARGV' forge install ...`.
- Администратор Jira без роли админа проекта проходит в Settings (исправлено в a288b15, проверка ADMINISTER_PROJECTS или ADMINISTER).

## Правила
- Коммиты: `TRACE-<n>: <Description>` + пустая строка + `Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>`.
- Без `//` комментариев внутри функций; JSDoc 1–2 строки. Только Atlaskit-компоненты и design tokens (никаких hex-цветов).
- Переводы делает модель — предупредить пользователя, что азиатские и малые европейские языки стоит показать носителю до релиза.
- Решения, которые пришлось принять самому, записывать в журнал как `Ruling:` и перечислить пользователю в конце.
