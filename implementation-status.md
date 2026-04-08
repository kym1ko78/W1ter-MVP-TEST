# Статус реализации MVP веб-мессенджера

## Статус
- MVP-план закрыт
- Локальный запуск работает
- API smoke/e2e и UI e2e проходят
- Локальный `pnpm dev` теперь имеет preflight-проверку портов
- Production deploy-каркас добавлен

## Что уже получилось

### Инфраструктура и репозиторий
- Монорепозиторий на `pnpm workspaces` собран и работает
- Созданы `apps/web`, `apps/api`, `packages/shared`, `docs`, `scripts`, `apps/api/test`, `tests/playwright`
- Инициализирован `git`-репозиторий
- Настроены root-конфиги проекта, `.env`, `.env.example`, `.env.production.example`, `README.md`
- Добавлены production-файлы: `Dockerfile.web`, `Dockerfile.api`, `docker-compose.production.yml`
- Проект перенесен в ASCII-путь `C:\Users\User\Desktop\Project`

### База данных и инфраструктура
- Docker Desktop настроен и работает
- PostgreSQL поднят в контейнере Docker
- Docker Postgres переведен на порт `5433`, чтобы не конфликтовать с локальным Windows PostgreSQL
- Prisma schema подготовлена для `users`, `refresh_tokens`, `chats`, `chat_members`, `messages`
- Начальная миграция `0001_init` успешно применена
- Seed успешно подготовил тестовые данные
- `.env.example` синхронизирован с реальным локальным портом `5433`

### Backend
- Backend на `NestJS` запущен локально
- Реализованы модули `auth`, `users`, `chat`, `realtime`, `prisma`
- Реализованы API-роуты для регистрации, входа, обновления сессии, выхода, получения текущего пользователя, поиска пользователей, создания direct chat, загрузки истории сообщений, отправки сообщений и отметки о прочтении
- Реализованы `JWT access token`, `refresh token` в `HttpOnly cookie`, хэширование паролей через `bcrypt`, Socket.IO gateway и presence в памяти процесса
- Добавлен in-memory rate limiting для чувствительных точек MVP
- Ограничены по частоте регистрация, вход, refresh, logout, создание direct chat и отправка сообщений
- Добавлено базовое логирование backend-событий для auth, chat и websocket-соединений
- Добавлен `GET /health` для быстрой локальной проверки готовности API и orchestration тестов

### Frontend
- Web-клиент на `Next.js + React + TypeScript` запущен локально
- Реализованы страницы `login` и `register`, auth context, layout мессенджера, sidebar со списком чатов, поиск пользователей, создание direct chat, окно диалога, отправка сообщений и realtime-обновления через Socket.IO
- Адаптивный UI для базового использования готов
- Отображаются `unread badge` и `last seen`
- В composer добавлены client-side ограничение длины сообщения, счетчик символов и inline-ошибка при неуспешной отправке
- Поле ввода по умолчанию выровнено по высоте с кнопкой Отправить, растет автоматически по мере набора текста и больше не показывает ручной resize
- Chat shell переведен на высоту viewport: страница чата не должна прокручиваться целиком, а скролл живет внутри списка чатов и истории сообщений
- Добавлены `data-testid` для стабильных UI e2e тестов
- Добавлена app-router страница `not-found`, а также минимальные fallback-файлы `pages/_app.tsx` и `pages/_document.tsx` для стабильной сборки Next.js на текущей Windows-конфигурации

### Исправления после ручного тестирования
- Исправлен баг с дублированием исходящих сообщений у отправителя
- Причина была в двойном добавлении одного и того же сообщения: один раз после успешного HTTP-ответа и второй раз после получения того же сообщения через Socket.IO
- Добавлена защита от дублей по `message.id`
- Дополнительно устранен warning React про одинаковые ключи сообщений за счет нормализации списка сообщений по `message.id`

### Тесты и релизная подготовка
- Добавлен локальный smoke test сценарий `register -> login -> create direct chat -> send message -> read` в `scripts/local-smoke-test.mjs`
- Добавлен root-скрипт `pnpm smoke:local`
- Добавлена инфраструктура API e2e-тестов на `Jest + Supertest`
- Добавлены `apps/api/tsconfig.spec.json`, `apps/api/test/jest-e2e.json`, `apps/api/test/app.e2e-spec.ts`
- Добавлен root-скрипт `pnpm test:api:e2e`
- Добавлена инфраструктура UI e2e-тестов на `Playwright`
- Добавлены `playwright.config.cjs` и `tests/playwright/chat-flow.spec.ts`
- Добавлены root-скрипты `pnpm test:ui:e2e` для manual-first режима и `pnpm test:ui:e2e:auto` для автоподъема серверов
- Добавлены `scripts/dev-port-utils.mjs`, `scripts/run-dev-check.mjs`, `scripts/run-dev-start.mjs` и root-скрипт `pnpm dev:check`
- `pnpm dev` теперь идет через preflight и заранее сообщает о занятых `3000/4000`, а не падает без контекста
- Автоматический UI e2e разведен с `pnpm dev` по web-порту `3100`, API-порту `4100` и build-папке `.next-e2e`, поэтому не конфликтует с уже запущенными dev-серверами на `3000/4000` и с основной `.next`
- В отдельную e2e web-сборку прокинуты `NEXT_PUBLIC_API_URL` и `NEXT_PUBLIC_SOCKET_URL`, поэтому регистрация и дальнейший realtime-сценарий корректно ходят в изолированный API на `4100`
- `tests/playwright/chat-flow.spec.ts` переведен на `PLAYWRIGHT_API_URL`, поэтому manual и auto режимы используют один и тот же тест без хардкода `4000`
- Добавлен ручной helper `scripts/run-ui-e2e-manual.mjs`, который быстро проверяет доступность `api` и `web` и выводит понятную подсказку вместо долгого зависания
- Добавлен релизный чеклист в `docs/release-checklist.md`
- Добавлен production deploy guide в `docs/deploy-production.md`
- Добавлен шаблон production-переменных в `.env.production.example`

## Что проверено
- Docker Postgres поднимается локально
- Миграция применяется успешно
- Seed выполняется без ошибок
- `web` запускается на `http://localhost:3000`
- `api` запускается на `http://localhost:4000`
- Регистрация и вход работают
- Поиск пользователей работает
- Создание direct chat работает
- Обмен сообщениями работает
- Дублирование сообщений у отправителя исправлено
- Warning React про одинаковые ключи сообщений устранен на уровне рендера и кэша
- `pnpm smoke:local` успешно прогнан вручную против живого локального API
- `pnpm --filter @repo/api typecheck` проходит
- `pnpm --filter @repo/api build` проходит
- `pnpm --filter @repo/api test:e2e` проходит
- `pnpm --filter @repo/web typecheck` проходит
- `pnpm --filter @repo/web build` проходит
- `pnpm build` проходит
- `pnpm typecheck` проходит
- `node --check scripts/local-smoke-test.mjs` проходит
- `node --check scripts/dev-port-utils.mjs` проходит
- `node --check scripts/run-dev-check.mjs` проходит
- `node --check scripts/run-dev-start.mjs` проходит
- `node --check scripts/run-ui-e2e-manual.mjs` проходит
- `node --check scripts/run-web-e2e-build.mjs` проходит
- `node --check scripts/run-web-e2e-start.mjs` проходит
- `pnpm test:ui:e2e:auto` проходит
- `docker compose -f docker-compose.production.yml config` проходит

## Что сейчас не получилось
- Нерешенных критических проблем в реализованной части нет
- В моей sandbox-среде изолированный `next build` может упираться в `spawn EPERM`, но вне sandbox тот же `pnpm test:ui:e2e:auto` проходит успешно
- Production deploy-каркас подготовлен и проверен на уровне конфигурации, но полноценный запуск на удаленном сервере еще не выполнялся

## Что остается после MVP
- Расширить API test coverage, а не держаться только за базовый smoke/e2e path
- Добавить UI-регрессии для большего числа сценариев, а не только direct chat flow
- Загрузка файлов и изображений
- Групповые чаты
- Поиск по сообщениям
- Push-уведомления
- Redis adapter для нескольких backend-инстансов
- Редактирование и удаление сообщений
- WebRTC-звонки

## Что важно знать по текущему поведению
- В логах API при старте может один раз появляться `Rejected socket connection with invalid token`, если страница открывается до восстановления access token
- Это не ломает работу приложения: после refresh flow сокет подключается нормально
- На Windows Playwright использует установленный `Microsoft Edge`
- Для локальной web-разработки frontend сейчас смотрит на API через `127.0.0.1:4000`, чтобы снизить риск проблем с `localhost` и `::1` в Windows-браузерах и тестах

## Технические замечания
- В `docker-compose.yml` используется порт `5433`, потому что `5432` занят локальным PostgreSQL в Windows
- Файл миграции `migration.sql` был пересохранен в `UTF-8`, иначе Prisma не могла его применить из-за ошибки `embedded null`
- Для локальной разработки проект сейчас готов к работе

## Что запускать сейчас
```powershell
cd C:\Users\User\Desktop\Project
docker compose up -d
pnpm dev:check
pnpm dev
```

## Что запускать для проверок
```powershell
cd C:\Users\User\Desktop\Project
pnpm dev:check
pnpm smoke:local
pnpm test:api:e2e
pnpm test:ui:e2e
pnpm test:ui:e2e:auto
```

## Демо-аккаунты
- `anna@example.com` / `password123`
- `max@example.com` / `password123`