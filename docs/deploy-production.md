# Production Deploy Guide

## Подход для первой production-версии
- Один VPS или VM с Docker
- Один контейнер `postgres`
- Один контейнер `api`
- Один контейнер `web`
- Отдельный reverse proxy и HTTPS можно добавить следующим шагом, когда появится домен

## Что нужно подготовить
1. Скопировать `.env.production.example` в `.env.production`
2. Задать реальные секреты `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`, `POSTGRES_PASSWORD`
3. Указать публичные адреса в `NEXT_PUBLIC_API_URL`, `NEXT_PUBLIC_SOCKET_URL`, `API_CORS_ORIGIN`
4. Убедиться, что Docker и Docker Compose доступны на сервере

## Сборка и запуск
```powershell
docker compose -f docker-compose.production.yml --env-file .env.production up -d --build
```

## Применение Prisma migration в production
После первого поднятия API-контейнера выполнить:

```powershell
docker compose -f docker-compose.production.yml --env-file .env.production exec api pnpm --filter @repo/api exec prisma migrate deploy
```

## Что проверить после запуска
- `web` доступен на `3000`
- `api` доступен на `4000`
- регистрация нового пользователя работает
- логин и refresh session работают
- можно создать direct chat и отправить сообщение
- websocket-соединение поднимается без постоянных ошибок в логах

## Полезные команды
```powershell
docker compose -f docker-compose.production.yml --env-file .env.production logs -f api
docker compose -f docker-compose.production.yml --env-file .env.production logs -f web
docker compose -f docker-compose.production.yml --env-file .env.production ps
```

## Ограничения текущего production-каркаса
- Это базовый deploy-template для MVP, а не финальная high-load инфраструктура
- Здесь пока нет Nginx, HTTPS termination, object storage, Redis и background workers
- `NEXT_PUBLIC_*` значения вшиваются в web-образ на этапе build, поэтому при смене публичного адреса web-образ нужно пересобрать