# Web Messenger MVP

MVP веб-мессенджера на стеке `Next.js + NestJS + Socket.IO + PostgreSQL + Prisma`.

## Что уже есть
- монорепозиторий на `pnpm workspaces`
- web-клиент на Next.js App Router
- backend на NestJS
- Prisma schema для `users`, `refresh_tokens`, `chats`, `chat_members`, `messages`
- Socket.IO gateway для realtime-событий
- docker compose для локального PostgreSQL
- локальный smoke test для сценария `register -> create chat -> send message -> read`
- API e2e-тест на `Jest + Supertest`
- UI e2e-тест на `Playwright`
- production Dockerfiles, `docker-compose.production.yml` и `Caddyfile.production`

## Быстрый старт
1. Скопируйте `.env.example` в `.env` и при необходимости поправьте значения.
2. Поднимите PostgreSQL:

```powershell
docker compose up -d
```

3. Установите зависимости:

```powershell
pnpm install
```

4. Сгенерируйте Prisma Client и примените миграцию:

```powershell
pnpm prisma:generate
pnpm prisma:deploy
pnpm prisma:seed
```

5. Проверьте локальные порты и запустите проект:

```powershell
pnpm dev:check
pnpm dev
```

## Локальный запуск и проверки
Обычный dev-цикл:

```powershell
pnpm dev:check
pnpm dev
```

Важно:
- `pnpm dev` теперь заранее проверяет `3000` и `4000` и не стартует молча, если они заняты
- если занят `4000`, сначала остановите старый API-процесс
- если занят `3000`, сначала остановите старый frontend-процесс, потому что fallback-порт ломает ожидаемый local flow
- `pnpm dev` и `pnpm test:ui:e2e:auto` лучше не держать одновременно

## Проверки
Локальный smoke test против уже поднятого API:

```powershell
pnpm smoke:local
```

Автоматизированный API e2e-тест:

```powershell
pnpm test:api:e2e
```

Ручной Windows-friendly UI e2e-тест против уже поднятых `api + web`:

```powershell
pnpm test:ui:e2e
```

Полный автоматический прогон с отдельными портами и отдельной build-папкой для UI e2e:

```powershell
pnpm test:ui:e2e:auto
```

## Локальная и production инфраструктура
- локальный PostgreSQL: [docker-compose.yml](C:\Users\User\Desktop\Project\docker-compose.yml)
- production compose template: [docker-compose.production.yml](C:\Users\User\Desktop\Project\docker-compose.production.yml)
- reverse proxy template: [Caddyfile.production](C:\Users\User\Desktop\Project\Caddyfile.production)
- web image: [Dockerfile.web](C:\Users\User\Desktop\Project\Dockerfile.web)
- api image: [Dockerfile.api](C:\Users\User\Desktop\Project\Dockerfile.api)
- production guide: [deploy-production.md](C:\Users\User\Desktop\Project\docs\deploy-production.md)
- release checklist: [release-checklist.md](C:\Users\User\Desktop\Project\docs\release-checklist.md)

## Workspace
- `apps/web` — фронтенд
- `apps/api` — backend
- `packages/shared` — общие типы и socket event constants
- `docs` — архитектурные заметки, release checklist и deploy guide
- `scripts` — вспомогательные локальные сценарии
- `tests/playwright` — UI e2e тесты

## Полезные файлы
- [implementation-status.md](C:\Users\User\Desktop\Project\implementation-status.md) — текущий статус реализации
- [.env.production.example](C:\Users\User\Desktop\Project\.env.production.example) — стартовый шаблон production-переменных
- [osnova.md](C:\Users\User\Desktop\Project\osnova.md) — общий план следующих этапов

## Локальная инфраструктура
- Docker PostgreSQL опубликован на `localhost:5433`, потому что `5432` занят локальным Windows PostgreSQL
- API работает на `http://localhost:4000` и локально доступен как `http://127.0.0.1:4000`
- Web работает на `http://localhost:3000` и для manual UI e2e ожидается на `http://127.0.0.1:3000`
- Автоматический UI e2e использует отдельный web `http://127.0.0.1:3100`, отдельный API `http://127.0.0.1:4100` и отдельный `NEXT_DIST_DIR=.next-e2e`, чтобы не конфликтовать с `pnpm dev`
- На Windows Playwright использует установленный `Microsoft Edge`

## Демо-аккаунты после seed
- `anna@example.com` / `password123`
- `max@example.com` / `password123`