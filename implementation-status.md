# Статус реализации MVP веб-мессенджера

## Статус
- MVP-план закрыт
- Локальный запуск работает
- API smoke/e2e и UI e2e проходят
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

### Frontend
- Web-клиент на `Next.js + React + TypeScript` запущен локально
- Реализованы страницы `login` и `register`, auth context, layout мессенджера, sidebar со списком чатов, поиск пользователей, создание direct chat, окно диалога, отправка сообщений и realtime-обновления через Socket.IO
- Адаптивный UI для базового использования готов
- Отображаются `unread badge` и `last seen`
- В composer добавлены client-side ограничение длины сообщения, счетчик символов и inline-ошибка при неуспешной отправке
- Добавлены `data-testid` для стабильных UI e2e тестов

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
- Добавлен root-скрипт `pnpm test:ui:e2e`
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
- `pnpm test:ui:e2e` проходит
- `pnpm build` проходит
- `pnpm typecheck` проходит
- `node --check scripts/local-smoke-test.mjs` проходит
- `docker compose -f docker-compose.production.yml config` проходит

## Что сейчас не получилось
- На текущем этапе нерешенных технических проблем в уже реализованной части нет
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

## Технические замечания
- В `docker-compose.yml` используется порт `5433`, потому что `5432` занят локальным PostgreSQL в Windows
- Файл миграции `migration.sql` был пересохранен в `UTF-8`, иначе Prisma не могла его применить из-за ошибки `embedded null`
- Для локальной разработки проект сейчас готов к работе

## Что запускать сейчас
```powershell
cd C:\Users\User\Desktop\Project
docker compose up -d
pnpm dev
```

## Что запускать для проверок
```powershell
cd C:\Users\User\Desktop\Project
pnpm smoke:local
pnpm test:api:e2e
pnpm test:ui:e2e
```

## Демо-аккаунты
- `anna@example.com` / `password123`
- `max@example.com` / `password123`