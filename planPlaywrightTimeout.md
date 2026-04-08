## Goal
Стабильно убрать timeout в `pnpm test:ui:e2e` после UI-правок, чтобы Playwright снова проходил локально без ручного вмешательства.

## Assumptions
- Основная проблема сейчас не в самой верстке окна чата, а в оркестрации `Playwright + Next dev server` на Windows.
- `web build` и `web typecheck` уже проходят, значит кодовая база фронтенда в рабочем состоянии.
- Локальный API доступен и поднимается отдельно на `http://127.0.0.1:4000`.
- Текущий flaky-участок связан с `webServer.command`, прогревом Next dev server, `localhost`/`127.0.0.1` и первым `goto` в тесте.

## Plan
### Phase 1: Зафиксировать точную точку отказа
- Повторно воспроизвести `pnpm test:ui:e2e` и сохранить полный лог web server startup.
- Отдельно проверить, поднимается ли `pnpm dev:web` без Playwright и доступен ли `http://localhost:3000/login`.
- Отдельно проверить, доступен ли `http://127.0.0.1:4000/auth/refresh` до старта теста.
- Понять, где ломается сценарий:
  - Playwright не дождался webServer URL
  - Edge не открыл первую страницу
  - страница открылась, но dev server перезапустился во время `goto`
- Output / exit criterion:
  - есть точный зафиксированный тип сбоя, а не общее описание "timeout"

### Phase 2: Стабилизировать web server orchestration
- Проверить, что в `playwright.config.cjs` webServer ждет тот же host, который реально использует приложение.
- Рассмотреть перевод `baseURL` с `http://localhost:3000` на `http://127.0.0.1:3000`, чтобы убрать Windows-особенности с `localhost`.
- Если dev server нестабилен под Playwright, заменить `webServer.command`:
  - либо на `pnpm dev:web`
  - либо на production-пару `pnpm --filter @repo/web build && pnpm --filter @repo/web start`
- Если нужен dev-режим, увеличить readiness timeout и ждать не просто `/login`, а реально рендерящийся route.
- Output / exit criterion:
  - Playwright стабильно видит поднятый web server до старта тестов

### Phase 3: Разделить ответственность между web и api
- Не полагаться на скрытый запуск `api` внутри Playwright, если он уже должен быть поднят отдельно.
- Явно документировать режим запуска теста:
  - вариант A: API и web стартуют вручную, Playwright идет с `PLAYWRIGHT_SKIP_WEBSERVER=1`
  - вариант B: Playwright сам поднимает только web, а API поднимается заранее
- Если нужно, добавить отдельный root-скрипт вроде `test:ui:e2e:local`, рассчитанный именно на локальный dev workflow.
- Output / exit criterion:
  - у теста появляется один понятный контракт запуска без скрытых зависимостей

### Phase 4: Укрепить сам тест от dev-flakes
- Оставить мягкий retry на первичный `goto`, но не размазывать им реальные продуктовые ошибки.
- После перехода на `/register` и `/chat` ждать не только URL, но и конкретный `data-testid` целевого экрана.
- Если проблема именно в hot reload/перестроении dev-сервера, использовать `waitUntil: "domcontentloaded"` и повтор входа только на первом открытии страницы.
- Убедиться, что тест не зависит от сохраненных cookies, старых вкладок и устаревших dev artifacts.
- Output / exit criterion:
  - тест перестает падать на первом `goto` и на первом переходе после регистрации

### Phase 5: Проверить окружение Windows и браузерный канал
- Проверить, не вносит ли `channel: "msedge"` дополнительную нестабильность.
- При необходимости временно сравнить поведение `msedge` и обычного `chromium`.
- Проверить, не блокирует ли антивирус/файловый индексатор старт `.next` и временных test artifacts.
- Проверить, не конфликтуют ли старые процессы `next dev`, висящие на `3000`.
- Output / exit criterion:
  - подтверждено, что проблема либо в конфиге тестов, либо в конкретном Windows/browser runtime, а не в коде чата

### Phase 6: Зафиксировать стабильный режим и обновить документацию
- После выбора рабочего режима обновить `playwright.config.cjs`.
- При необходимости обновить `tests/playwright/chat-flow.spec.ts`.
- Обновить `README.md` и `implementation-status.md`:
  - как правильно запускать UI e2e локально
  - что поднимается автоматически, а что нужно стартовать вручную
- Если локально надежнее manual mode, добавить готовую команду с переменной окружения.
- Output / exit criterion:
  - инструкция по запуску UI e2e понятна и воспроизводима другим человеком на Windows

## Risks and Dependencies
- Риск: проблема не в Playwright, а в нестабильном `next dev` под Windows.
- Митигация: сравнить dev-mode и production-mode запуск для UI e2e.
- Риск: `localhost` и `127.0.0.1` ведут себя по-разному для web и api.
- Митигация: унифицировать host в `playwright.config.cjs`, `.env.local` и readiness checks.
- Риск: ручной retry в тесте замаскирует реальную функциональную ошибку.
- Митигация: ретраи держать только на bootstrap-этапе, а не на проверках бизнес-логики.
- Риск: зависший процесс на `3000` будет давать ложные таймауты.
- Митигация: перед прогоном проверять, какой процесс слушает порт и нужен ли `reuseExistingServer`.

## Next Actions
- Проверить ручной сценарий: `pnpm dev:web` и открыть `http://127.0.0.1:3000/login`.
- Определить, нужен ли Playwright режим с manual server через `PLAYWRIGHT_SKIP_WEBSERVER=1`.
- Сравнить `localhost` и `127.0.0.1` для `baseURL` в `playwright.config.cjs`.
- Если dev-mode нестабилен, перевести UI e2e на `build + start` режим для надежного локального прогона.
