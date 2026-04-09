# Статус реализации MVP веб-мессенджера

## Статус
- MVP-план закрыт
- Локальный запуск работает
- API smoke/e2e и UI e2e проходят
- Локальный `pnpm dev` имеет preflight-проверку портов
- Web typecheck разведен на source-only и Next-generated режимы и больше не зависит от предварительного `.next/types`; основной `tsconfig.json` синхронизирован и с `.next`, и с `.next-e2e`
- Production deploy-каркас добавлен и расширен до VPS + Caddy + domain runbook
- Первый post-MVP батч `file attachments` реализован и проверен
- Следующий рекомендуемый батч: `message search`

## Что уже получилось

### Инфраструктура и репозиторий
- Монорепозиторий на `pnpm workspaces` собран и работает
- Созданы `apps/web`, `apps/api`, `packages/shared`, `docs`, `scripts`, `apps/api/test`, `tests/playwright`
- Инициализирован `git`-репозиторий
- Настроены root-конфиги проекта, `.env`, `.env.example`, `.env.production.example`, `README.md`
- Добавлены production-файлы: `Dockerfile.web`, `Dockerfile.api`, `docker-compose.production.yml`, `Caddyfile.production`
- Проект перенесен в ASCII-путь `C:\Users\User\Desktop\Project`

### База данных и инфраструктура
- Docker Desktop настроен и работает
- PostgreSQL поднят в контейнере Docker
- Docker Postgres переведен на порт `5433`, чтобы не конфликтовать с локальным Windows PostgreSQL
- Prisma schema подготовлена для `users`, `refresh_tokens`, `chats`, `chat_members`, `messages`, `attachments`
- Миграции `0001_init` и `0002_add_attachments` успешно применены
- Seed успешно подготовил тестовые данные
- `.env.example` синхронизирован с реальным локальным портом `5433`
- Production compose получил отдельный volume для uploads

### Backend
- Backend на `NestJS` запущен локально
- Реализованы модули `auth`, `users`, `chat`, `realtime`, `prisma`
- Реализованы API-роуты для регистрации, входа, обновления сессии, выхода, получения текущего пользователя, поиска пользователей, создания direct chat, загрузки истории сообщений, отправки сообщений, soft delete сообщений, удаления direct chat и отметки о прочтении
- Реализованы `JWT access token`, `refresh token` в `HttpOnly cookie`, хэширование паролей через `bcrypt`, Socket.IO gateway и presence в памяти процесса; TTL refresh-cookie теперь синхронизирован с `JWT_REFRESH_TTL_DAYS`, чтобы пользователь дольше оставался в сессии без повторного входа
- Добавлен in-memory rate limiting для чувствительных точек MVP
- Ограничены по частоте регистрация, вход, refresh, logout, создание direct chat, отправка сообщений и загрузка вложений
- Добавлено базовое логирование backend-событий для auth, chat и websocket-соединений
- Добавлен `GET /health` для быстрой локальной проверки готовности API и orchestration тестов
- Добавлены upload/download endpoints для вложений:
  - `POST /chats/:chatId/attachments`
  - `GET /attachments/:attachmentId`
- Доступ к вложению ограничен участниками чата, а URL поддерживает `access_token` query param для защищенного просмотра/скачивания

### Frontend
- Web-клиент на `Next.js + React + TypeScript` запущен локально
- Реализованы страницы `login` и `register`, auth context, layout мессенджера, sidebar со списком чатов, поиск пользователей, создание direct chat, окно диалога, отправка сообщений и realtime-обновления через Socket.IO
- Адаптивный UI для базового использования готов
- Отображаются `unread badge` и `last seen`
- В composer добавлены client-side ограничение длины сообщения, счетчик символов и inline-ошибка при неуспешной отправке
- Поле ввода по умолчанию выровнено по высоте с кнопкой Отправить, растет автоматически по мере набора текста и больше не показывает ручной resize
- Chat shell переведен на высоту viewport: страница чата не прокручивается целиком, а скролл живет внутри списка чатов и истории сообщений
- Свайп/scroll всей страницы на chat-экране заблокирован route-scoped lock-режимом; скролл сохранен только внутри списка чатов, результатов поиска и истории сообщений
- Scrollbar внутри chat-зон переведен в более точный референсный стиль: узкий темный rail, inset thumb, кроссбраузерная поддержка для WebKit/Firefox и усиленно скрытые стрелочные кнопки по краям
- Пузырьки сообщений уплотнены в три прохода: уменьшены лишние нижние отступы, расстояние до времени, radius и padding у коротких text-only сообщений, а timestamp у text-only bubble перенесен к правому краю карточки
- В истории сообщений добавлены date separators: при смене календарного дня в чате появляется отдельная плашка с датой
- В direct chat убрано имя над каждым bubble, composer отправляет сообщение по `Enter`, а `Ctrl+Enter` вставляет новую строку`r`n- Исправлено выравнивание длинных исходящих сообщений: outgoing bubble снова остается прижатым к правой стороне и растет влево даже рядом с delete action
- Добавлены удаление своего сообщения с soft delete-state bubble `Сообщение удалено`; действие удаления whole direct chat перенесено из header диалога в карточку чата внутри списка `Ваши чаты`
- Добавлены `data-testid` для стабильных UI e2e тестов
- Добавлена app-router страница `not-found`, а также минимальные fallback-файлы `pages/_app.tsx` и `pages/_document.tsx` для стабильной сборки Next.js на текущей Windows-конфигурации
- Реализован UI первого post-MVP батча `file attachments`:
  - выбор одного файла в composer
  - attachment-only сообщение без текста
  - preview выбранного файла до отправки
  - inline preview для изображений
  - карточки PDF/TXT и других поддержанных файлов с открытием в новой вкладке
  - preview последнего сообщения в sidebar для attachment-only чатов

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
- API e2e теперь покрывает upload/download flow для attachment message, soft delete сообщения и удаление direct chat
- Добавлена инфраструктура UI e2e-тестов на `Playwright`
- Добавлены `playwright.config.cjs` и `tests/playwright/chat-flow.spec.ts`
- Добавлены root-скрипты `pnpm test:ui:e2e` для manual-first режима и `pnpm test:ui:e2e:auto` для автоподъема серверов
- Добавлены `scripts/dev-port-utils.mjs`, `scripts/run-dev-check.mjs`, `scripts/run-dev-start.mjs` и root-скрипт `pnpm dev:check`
- `pnpm dev` теперь идет через preflight и заранее сообщает о занятых `3000/4000`, а не падает без контекста
- Автоматический UI e2e разведен с `pnpm dev` по web-порту `3100`, API-порту `4100` и build-папке `.next-e2e`, поэтому не конфликтует с уже запущенными dev-серверами на `3000/4000` и с основной `.next`
- В отдельную e2e web-сборку прокинуты `NEXT_PUBLIC_API_URL` и `NEXT_PUBLIC_SOCKET_URL`, поэтому регистрация и дальнейший realtime-сценарий корректно ходят в изолированный API на `4100`
- `tests/playwright/chat-flow.spec.ts` переведен на `PLAYWRIGHT_API_URL`, поэтому manual и auto режимы используют один и тот же тест без хардкода `4000`
- UI e2e теперь дополнительно проверяет session restore после reload, отправку по `Enter`, перенос строки по `Ctrl+Enter`, delete message и delete chat
- Добавлен ручной helper `scripts/run-ui-e2e-manual.mjs`, который быстро проверяет доступность `api` и `web` и выводит понятную подсказку вместо долгого зависания
- Добавлен релизный чеклист в `docs/release-checklist.md`
- Добавлен production deploy guide в `docs/deploy-production.md`
- Добавлен `Caddyfile.production` и production compose обновлен под схему `caddy + web + api + postgres`
- `.env.production.example` расширен до реального VPS/domain шаблона
- Добавлены [post-mvp-roadmap.md](C:\Users\User\Desktop\Project\docs\post-mvp-roadmap.md) и [attachments-batch-1.md](C:\Users\User\Desktop\Project\docs\attachments-batch-1.md) как опорные документы для следующей итерации

## Что проверено
- Docker Postgres поднимается локально
- Миграции применяются успешно
- Seed выполняется без ошибок
- `web` запускается на `http://localhost:3000`
- `api` запускается на `http://localhost:4000`
- Регистрация и вход работают
- Поиск пользователей работает
- Создание direct chat работает
- Обмен сообщениями работает
- Attachment upload/download работает для PNG, JPEG, WEBP, PDF и TXT
- Attachment-only сообщения работают
- Дублирование сообщений у отправителя исправлено
- Warning React про одинаковые ключи сообщений устранен на уровне рендера и кэша
- `pnpm smoke:local` успешно прогнан вручную против живого локального API
- `pnpm --filter @repo/api typecheck` проходит
- `pnpm --filter @repo/api build` проходит
- `pnpm --filter @repo/api test:e2e` проходит
- `pnpm prisma:deploy` с миграцией вложений проходит
- `pnpm --filter @repo/web typecheck` проходит
- `pnpm verify:web` проходит
- `pnpm typecheck` проходит
- `pnpm --filter @repo/web build` проходит
- `pnpm test:ui:e2e:auto` проходит
- Delete message / delete chat работают и синхронизируются через realtime между участниками
- `docker compose -f docker-compose.production.yml --env-file .env.production.example config` проходит

## Что сейчас не получилось
- Нерешенных критических проблем в реализованной части нет
- В моей sandbox-среде изолированный `next build` может упираться в `spawn EPERM`, но вне sandbox тот же `pnpm test:ui:e2e:auto` проходит успешно
- Production deploy-каркас подготовлен и проверен на уровне конфигурации, но полноценный запуск на удаленном сервере еще не выполнялся

## Что остается после MVP
- Реализовать `message search` как следующий post-MVP батч
- Затем перейти к `group chats`
- Push-уведомления
- Redis adapter для нескольких backend-инстансов
- Редактирование сообщений
- WebRTC-звонки

## Что важно знать по текущему поведению
- В логах API при старте может один раз появляться `Rejected socket connection with invalid token`, если страница открывается до восстановления access token
- Это не ломает работу приложения: после refresh flow сокет подключается нормально
- На Windows Playwright использует установленный `Microsoft Edge`
- Для локальной web-разработки frontend сейчас смотрит на API через `127.0.0.1:4000`, чтобы снизить риск проблем с `localhost` и `::1` в Windows-браузерах и тестах
- Вложения хранятся в `UPLOADS_DIR`; локально по умолчанию это `apps/api/uploads`, а в production — `/app/uploads` через отдельный volume

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

## Обновление от 2026-04-09
- `pnpm dev:check` и `pnpm dev` теперь считают PostgreSQL на `5433` обязательной зависимостью для полного локального запуска, а не просто warning
- При недоступном API auth-экран больше не показывает сырой `Failed to fetch`; вместо этого выводится понятная подсказка проверить `docker compose up -d` и `pnpm dev`
- Удаленные сообщения больше не показывают placeholder `Сообщение удалено`; после soft delete они сразу исчезают из списка сообщений через client cache filtering
- Confirm-панель удаления сообщения и чата теперь появляется и исчезает плавно через короткий fade + slide transition
- Серый контурный рисунок на фоне основной области чата убран; полотно переписки стало чище
- Такой же серый контурный рисунок убран и с auth-экранов login/register




