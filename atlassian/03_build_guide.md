# Сборка приложения Forge: от нуля до листинга

Дата: 2026-09-15. Продолжение [02](02_forge_implementation.md), которое отвечало
«что надо / где релизим / как делаем» на уровне решений. Здесь — руки на клавиатуре:
команды, манифест, код, тесты, CI и гейты.

Проверка и старт бесплатны: аккаунт разработчика, dev-сайт Jira/Confluence,
`forge create`, деплой и установка в development не стоят ничего и не создают
обязательств. Платить и проходить верификацию нужно только перед листингом.

## 0. Что уже сделано

Первый шаг плана — замер предложения — не требует ни аккаунта, ни денег, и он
сделан. В репозитории:

| Файл | Что делает |
|---|---|
| [tools/fetch_marketplace.py](tools/fetch_marketplace.py) | тянет все облачные листинги через публичный REST без авторизации |
| [tools/analyze_marketplace.py](tools/analyze_marketplace.py) | считает по категориям: медиана установок против доли заброшенных приложений |
| `data/apps.json` | выгрузка (в git не коммитить, пересобирается за 3 минуты) |

Результаты замера — в [04](04_market_measurement.md).

**Важная поправка к 02:** API v2 (`/rest/2`) на 2026-09-15 **отвечает 200**, а не
410 — отключение анонсировано, но не включено. И он отдаёт без авторизации больше,
чем ожидалось:

| Данные | Эндпоинт |
|---|---|
| Число установок (`totalInstalls`) | `/rest/2/addons?withVersion=true` |
| Дата последнего релиза | там же, `version.release.date` |
| Цены по всем ступеням, месяц и год | `/rest/2/addons/{key}/pricing/cloud/live` |
| Отзывы: текст, звёзды, дата | `/rest/2/addons/{key}/reviews?sort=recent` |
| Cloud Fortified, Bug Bounty | `/rest/2/addons/{key}` → `programs` |
| Forge или Connect | `/rest/2/addons/{key}/versions/latest` → `cloud.appId` = `ari:cloud:ecosystem::app/…` |

Это значит, что **гейт недели 3 из плана 02 тоже автоматизируется**: «прочитать 10
отрицательных отзывов у лидеров» — не ручная работа, а запрос с `stars<=2`.

## 1. День 1: бесплатно и без обязательств

```bash
npm install -g @forge/cli
forge login                       # Atlassian account + API-токен
forge create                      # шаблон: jira-issue-panel, UI Kit
cd <app>
forge deploy                      # среда development по умолчанию
forge install                     # на бесплатный dev-сайт
forge tunnel                      # живая перезагрузка, только в development
```

Бесплатный dev-сайт заводится на `atlassian.com` (Jira/Confluence Free до 10
пользователей). Ничего из этого не требует партнёрского аккаунта, верификации
или оплаты.

Скелет, который создаёт `forge create`:

```
├── manifest.yml
├── package.json
└── src
    ├── frontend/index.jsx      # UI Kit
    ├── resolvers/index.js      # бэкенд-функции
    └── index.js                # точка входа
```

**Правило, которое экономит часы:** канонический синтаксис — тот, что сгенерировал
`forge create` вашей версией CLI, а не тот, что написан в любой доке, включая эту.
Forge меняется быстро. Docs — для понимания, шаблон — для копирования.

## 2. Манифест

Тот же файл решает три вещи из 02: право на 100% ревшары, бейдж Runs on Atlassian
и попадание (или нет) в ловушку мажорных версий.

```yaml
app:
  id: ari:cloud:ecosystem::app/00000000-0000-0000-0000-000000000000
  licensing:
    enabled: true          # платный листинг; ставить ДО подачи, см. §4

modules:
  jira:issuePanel:
    - key: panel
      resource: main
      resolver:
        function: resolver
      render: native       # UI Kit; условие 100% ревшары
      title: Название
      icon: resource:icons;panel.svg

  function:
    - key: resolver
      handler: resolvers/index.handler
    - key: worker
      handler: worker.handler
      timeoutSeconds: 600  # тяжёлая работа; до 900

  consumer:
    - key: work-queue
      queue: work
      function: worker

  scheduledTrigger:
    - key: nightly
      function: worker
      interval: day

resources:
  - key: main
    path: src/frontend/index.jsx

permissions:
  scopes:
    - read:jira-work
    - write:jira-work
    - storage:app
  # external: НЕ объявлять. Любой egress с пользовательскими данными
  # отбирает Runs on Atlassian, а Connect-модули — 100% ревшары.
```

Три правила по манифесту:

1. **`permissions.scopes` объявляются с запасом в v1.** Добавленный позже scope
   делает версию мажорной: обновление не применяется само, нужен consent админа,
   bulk-апгрейд блокируется. Половина клиентов останется на старой версии.
2. **Секции `permissions.external` быть не должно.** Она же — и потеря RoA, и
   лишние вопросы на security-ревью.
3. **Никаких модулей Connect.** Иначе ревшара 84/83% вместо 100%.

## 3. Код

Логика живёт отдельно от хендлеров — не ради красоты, а потому что резолверы
Forge нельзя запустить локально без туннеля, а чистые функции тестируются за
секунды обычным jest.

```
src/
  frontend/index.jsx     # UI Kit
  resolvers/index.js     # тонкие: распарсил → domain → отдал
  domain/                # чистые функции, сюда смотрят тесты
  storage/               # единственное место с I/O
  worker.js              # обработчик очереди и расписания
```

**Резолвер.** Тонкий, с проверкой лицензии:

```js
import Resolver from '@forge/resolver';
import { buildSummary } from '../domain/summary';
import { loadState } from '../storage/state';

const resolver = new Resolver();

resolver.define('getSummary', async (req) => {
  const { license, extension } = req.context;
  const state = await loadState(extension.issue.id);
  return buildSummary(state, { licensed: license?.active === true });
});

export const handler = resolver.getDefinitions();
```

`req.context.license.active` — `true` только при действующей коммерческой
лицензии; для бесплатных приложений всегда `false`. Проверять нужно **и** во
фронте (что показать), **и** в резолвере (что посчитать) — иначе ограничение
обходится запросом мимо UI.

**Фронт (UI Kit).** `@forge/react` версии 10+:

```jsx
import React, { useEffect, useState } from 'react';
import ForgeReconciler, { Text, Button } from '@forge/react';
import { invoke } from '@forge/bridge';

const App = () => {
  const [data, setData] = useState(null);
  useEffect(() => { invoke('getSummary').then(setData); }, []);
  if (!data) return <Text>Загрузка…</Text>;
  if (!data.licensed) return <Text>Нужна лицензия</Text>;
  return <Text>{data.title}</Text>;
};

ForgeReconciler.render(<React.StrictMode><App /></React.StrictMode>);
```

**Тяжёлая работа — в очередь, не в резолвер.** Синхронный резолвер живёт 25 секунд;
обработчик очереди — до 900.

```js
// producer, внутри резолвера
import { Queue } from '@forge/events';
const queue = new Queue({ key: 'work' });
await queue.push({ body: { issueId } });

// consumer, src/worker.js
export async function handler(event) {
  const { issueId } = event.body;
  if (event.retryContext) {
    console.warn(`повтор ${event.retryContext.retryCount} для ${issueId}`);
  }
  await process(issueId);
}
```

Повторы идут с экспоненциальной паузой в окне 24 часов (расширяется до 96).
Обработчик обязан быть идемпотентным — повтор случится.

**Хранилище — с оглядкой на счёт.** Из 02: бесплатно 0.1 GB записей KVS в месяц,
сверх — $1.09/GB. Это самая дорогая строка в сетке.

| Что храним | Куда | Почему |
|---|---|---|
| Состояние, настройки, кэш | KVS (`@forge/api` → `storage`) | мало записей, частые чтения (чтения дешевле в 20 раз) |
| История, журнал событий, всё растущее | Forge SQL | хранение в ~1400 раз дешевле записи в KVS |
| Временные файлы | `/tmp`, 512 МБ | между вызовами не сохраняется |

Правило: **KVS — для состояния, не для журнала.**

## 4. Лицензирование и ловушка раздачи

Из 02: приложение с `licensing.enabled: true` **нельзя раздать по sharing-ссылке**.
Порядок, который из этого следует:

1. Пока `licensing` выключен — можно раздавать по ссылке. Это черновой прогон
   на 2–3 знакомых админах: проверить, что ставится и не ломает UI.
2. Включили `licensing` → sharing-ссылка отключается. Дальше только листинг.
3. Первые платящие приходят через **private (unlisted) listing**, не через бету.

Не делать бету на 50 человек: установки без оплаты ничего не говорят о том,
платят ли за это.

## 5. Тесты

```
__tests__/domain/*.test.js     # jest, быстрые, 80% покрытия
__tests__/resolvers/*.test.js  # с подменённым storage
```

Интеграционно — установка на dev-сайт и ручной чеклист; Playwright по dev-сайту
подключать, когда сценарии перестанут меняться каждый день. Резолверы Forge в CI
не запустить, и попытка это сделать — потраченная неделя.

## 6. CI

GitHub Actions. Секреты: `FORGE_EMAIL`, `FORGE_API_TOKEN`. CLI в `--non-interactive`.

```yaml
name: forge
on: [push, pull_request]

jobs:
  check:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: lts/*, cache: npm }
      - run: npm ci
      - run: npx jest
      - run: npm i -g @forge/cli && forge lint
      - run: python3 tools/check_manifest_permissions.py   # гейт мажорных версий

  deploy-staging:
    needs: check
    if: github.ref == 'refs/heads/main'
    runs-on: ubuntu-latest
    env:
      FORGE_EMAIL: ${{ secrets.FORGE_EMAIL }}
      FORGE_API_TOKEN: ${{ secrets.FORGE_API_TOKEN }}
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: lts/*, cache: npm }
      - run: npm ci && npm i -g @forge/cli
      - run: forge deploy -e staging --non-interactive
```

Прод — отдельная job по тегу `v*`, с `forge deploy -e production` и
`forge eligibility` после деплоя.

## 7. Гейты перед релизом

Три проверки, каждая закрывает риск из 02, который иначе замечается поздно.

| Гейт | Команда | Что ловит |
|---|---|---|
| Манифест валиден | `forge lint` | опечатки, которые иначе видны только после деплоя |
| Право на Runs on Atlassian | `forge eligibility` | случайно добавленный egress = потерян бейдж = вернулись security-ревью и звонки |
| Мажорная версия не проехала незаметно | [tools/check_manifest_permissions.py](tools/check_manifest_permissions.py) | новый scope = обновление встанет у всех клиентов |

Третий гейт — свой, его нет в платформе. Он сравнивает `permissions` в манифесте
с зафиксированным слепком и роняет сборку при расхождении. Чтобы провести
изменение осознанно, слепок обновляется явно:

```bash
python3 tools/check_manifest_permissions.py --update
```

Это тот же принцип, что «плохой замер закрывает нишу в тот же день»: дешевле
сломать сборку, чем разослать мажорную версию, которую никто не подтвердит.

## 8. Что мониторить по деньгам

| Где | Что | Порог тревоги |
|---|---|---|
| Developer Console → Usage and charges | KVS writes | 50% от 0.1 GB |
| там же | Логи | 50% от 1 GB |
| там же | GB-секунды функций | 50% от 200 000 |
| Marketplace портал → Cloud conversions | evaluations → sales, против бенчмарка площадки | появляется только после листинга |

Уровень логирования в production — `warn`. `console.log` в горячем пути — это
строка в счёте.

## 9. Порядок на ближайшие недели

| Когда | Что | Стоит |
|---|---|---|
| ✅ сделано | Замер предложения: сбор и анализ листингов | $0 |
| сейчас | Выбор 3 категорий по [04](04_market_measurement.md); выгрузка отзывов ≤2 звёзд у лидеров → гипотезы о недостающей функции | $0 |
| день 1–2 | `forge create`, деплой в development, установка на dev-сайт — проверить, что среда рабочая | $0 |
| неделя 3 | Выбор функции. Регистрация партнёра, **старт Partner Verification** (срок не публикуется — поэтому раньше, чем понадобится) | $0 |
| недели 3–4 | Модель воронки по нише; не сходится — ниша закрывается | $0 |
| недели 5–9 | v1: манифест, domain, UI Kit, лицензирование, тесты, CI | $0 |
| недели 9–13 | Листинг, ревью, private listing, первые платящие | $0 |

Денег не требует ничего до момента, когда появляется выручка. Единственный
невозвратный ресурс — время, и единственный механизм его защиты — гейты:
ниша закрывается замером, а не разочарованием.
