# Release Checklist

## Перед демонстрацией или деплоем
- Убедиться, что `docker compose up -d` поднимает PostgreSQL без ошибок
- Проверить, что `.env.production.example` скопирован в реальные production-переменные и секреты заменены
- Проверить доступность `NEXT_PUBLIC_API_URL` и `NEXT_PUBLIC_SOCKET_URL`
- Подтвердить, что `API_CORS_ORIGIN` совпадает с адресом web-клиента
- Проверить синтаксис production compose через `docker compose -f docker-compose.production.yml config`

## Локальная валидация перед релизом
```powershell
pnpm prisma:generate
pnpm prisma:deploy
pnpm prisma:seed
pnpm typecheck
pnpm build
pnpm smoke:local
pnpm test:api:e2e
pnpm test:ui:e2e
```

## Ручной smoke checklist
- Зарегистрировать нового пользователя
- Выполнить вход и обновить страницу
- Найти второго пользователя и создать direct chat
- Отправить сообщение из первого окна
- Убедиться, что сообщение приходит во второе окно почти мгновенно
- Проверить badge непрочитанных сообщений
- Открыть чат вторым пользователем и убедиться, что badge исчезает
- Проверить `last seen` после закрытия одной из вкладок

## Что проверить в логах API
- Успешные регистрации и логины
- Создание direct chat
- Сохранение сообщений
- Маркировка чатов как прочитанных
- WebSocket connect и disconnect без лавины ошибок

## Минимальный production набор
- Один контейнер `postgres`
- Один контейнер `api`
- Один контейнер `web`
- HTTPS и reverse proxy перед `web` и `api`
- Регулярный backup PostgreSQL

## Что не выпускать без отдельной проверки
- Групповые чаты
- Вложения файлов
- Redis adapter
- WebRTC-звонки
- Любые изменения в auth flow или cookie policy