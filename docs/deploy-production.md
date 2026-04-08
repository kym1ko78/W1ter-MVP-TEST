# Production Deploy Guide

## Целевая production-модель
Для первой production-версии используется простая и реалистичная схема:
- 1 VPS c Ubuntu
- Docker Engine + Docker Compose plugin
- `postgres` в Docker
- `api` в Docker
- `web` в Docker
- `caddy` как reverse proxy и HTTPS termination
- 2 домена или поддомена:
  - `chat.example.com` -> web
  - `api.example.com` -> api

Это не high-load архитектура, а рабочий MVP deploy для первой публичной выкладки.

## Что уже подготовлено в репозитории
- production compose: [docker-compose.production.yml](C:\Users\User\Desktop\Project\docker-compose.production.yml)
- reverse proxy config: [Caddyfile.production](C:\Users\User\Desktop\Project\Caddyfile.production)
- web image: [Dockerfile.web](C:\Users\User\Desktop\Project\Dockerfile.web)
- api image: [Dockerfile.api](C:\Users\User\Desktop\Project\Dockerfile.api)
- production env template: [.env.production.example](C:\Users\User\Desktop\Project\.env.production.example)

## Пререквизиты
Перед деплоем у вас должны быть:
- VPS с публичным IP
- домен или поддомены, которыми вы управляете
- SSH-доступ к серверу
- Git установлен на сервере
- Docker Engine и Docker Compose plugin установлены на сервере
- открыты порты `80` и `443` в firewall

## DNS-схема
Нужно создать записи:
- `A` или `AAAA` для `chat.example.com` -> IP вашего VPS
- `A` или `AAAA` для `api.example.com` -> IP вашего VPS

Пока DNS не смотрит на сервер, Caddy не сможет выпустить HTTPS сертификаты.

## Что заполнить в `.env.production`
Создайте `.env.production` на основе [.env.production.example](C:\Users\User\Desktop\Project\.env.production.example).

Минимально нужно задать:
- `APP_DOMAIN`
- `API_DOMAIN`
- `LETSENCRYPT_EMAIL`
- `POSTGRES_DB`
- `POSTGRES_USER`
- `POSTGRES_PASSWORD`
- `DATABASE_URL`
- `JWT_ACCESS_SECRET`
- `JWT_REFRESH_SECRET`
- `API_CORS_ORIGIN`
- `NEXT_PUBLIC_API_URL`
- `NEXT_PUBLIC_SOCKET_URL`

Важно:
- `API_CORS_ORIGIN` должен совпадать с публичным адресом web, например `https://chat.example.com`
- `NEXT_PUBLIC_API_URL` и `NEXT_PUBLIC_SOCKET_URL` должны смотреть на публичный API, например `https://api.example.com`
- `DATABASE_URL` должен использовать внутреннее имя сервиса `postgres`, а не `localhost`

## Пошаговый deploy-runbook
### 1. Подключиться к серверу
```bash
ssh user@your-server-ip
```

### 2. Подготовить директорию приложения
```bash
mkdir -p /opt/web-messenger
cd /opt/web-messenger
```

### 3. Клонировать репозиторий
```bash
git clone https://github.com/YOUR_USERNAME/YOUR_REPO.git .
```

### 4. Создать production env
```bash
cp .env.production.example .env.production
nano .env.production
```

### 5. Проверить итоговый compose
```bash
docker compose -f docker-compose.production.yml --env-file .env.production config
```

### 6. Собрать и поднять контейнеры
```bash
docker compose -f docker-compose.production.yml --env-file .env.production up -d --build
```

### 7. Применить production migration
После первого поднятия контейнеров:
```bash
docker compose -f docker-compose.production.yml --env-file .env.production exec api pnpm --filter @repo/api exec prisma migrate deploy
```

### 8. Проверить состояние контейнеров
```bash
docker compose -f docker-compose.production.yml --env-file .env.production ps
```

## Post-deploy проверки
Сразу после выкладки проверьте:
- открывается `https://chat.example.com/login`
- `https://api.example.com/health` возвращает `{"status":"ok"}`
- регистрация нового пользователя проходит
- логин проходит
- refresh session работает после обновления страницы
- можно создать direct chat
- можно отправить сообщение
- websocket соединение не падает постоянно в логах

## Полезные команды эксплуатации
Логи:
```bash
docker compose -f docker-compose.production.yml --env-file .env.production logs -f caddy
docker compose -f docker-compose.production.yml --env-file .env.production logs -f api
docker compose -f docker-compose.production.yml --env-file .env.production logs -f web
```

Перезапуск сервиса:
```bash
docker compose -f docker-compose.production.yml --env-file .env.production restart api
docker compose -f docker-compose.production.yml --env-file .env.production restart web
docker compose -f docker-compose.production.yml --env-file .env.production restart caddy
```

Обновление после нового коммита:
```bash
git pull
docker compose -f docker-compose.production.yml --env-file .env.production up -d --build
docker compose -f docker-compose.production.yml --env-file .env.production exec api pnpm --filter @repo/api exec prisma migrate deploy
```

## Rollback-сценарий
Если новая выкладка сломалась:
1. посмотреть логи `api`, `web`, `caddy`
2. откатиться на предыдущий коммит:
```bash
git log --oneline
git checkout <PREVIOUS_COMMIT>
```
3. заново поднять контейнеры:
```bash
docker compose -f docker-compose.production.yml --env-file .env.production up -d --build
```
4. если проблема в миграции, отдельно решить вопрос с БД до повторного запуска

## Backup и базовая эксплуатация
Минимум для MVP:
- делать регулярный backup volume или дамп PostgreSQL
- хранить секреты вне репозитория
- периодически проверять `docker compose ps`
- проверять `https://api.example.com/health`
- не обновлять домены в `.env.production` без пересборки `web`, потому что `NEXT_PUBLIC_*` вшиваются на этапе build

Пример ручного dump PostgreSQL:
```bash
docker compose -f docker-compose.production.yml --env-file .env.production exec postgres pg_dump -U "$POSTGRES_USER" "$POSTGRES_DB" > backup.sql
```

## Ограничения текущего production-каркаса
- это production-ready шаблон для MVP, но не high-load инфраструктура
- здесь пока нет object storage, Redis, background workers и централизованного мониторинга
- для нескольких backend-инстансов позже понадобится Redis adapter для Socket.IO
- если нагрузка вырастет, стоит вынести PostgreSQL из compose в managed service