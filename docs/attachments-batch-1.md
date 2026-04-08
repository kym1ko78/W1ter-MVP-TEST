# Batch 1 Design: File Attachments

## Objective
Добавить в direct chats поддержку вложений файлов как первый post-MVP релизный батч.

## Current Constraints
- Сейчас сообщение в [schema.prisma](C:\Users\User\Desktop\Project\apps\api\prisma\schema.prisma) хранит только `body`.
- Отправка сообщений идет через JSON endpoint `POST /chats/:chatId/messages`.
- Frontend composer в [conversation-view.tsx](C:\Users\User\Desktop\Project\apps\web\components\conversation-view.tsx) умеет только текст.
- Production deploy пока ориентирован на VPS + Docker Compose + Caddy.

## Recommended Scope for First Release
В первый релиз вложений включить только управляемый MVP-объем:
- 1 файл на сообщение
- direct chats only
- текст в сообщении опционален, файл тоже может быть единственным содержимым
- inline preview только для изображений
- для остальных файлов: имя, размер, mime type и ссылка на скачивание
- лимит размера файла, например `10 MB`
- ограниченный белый список MIME types:
  - `image/png`
  - `image/jpeg`
  - `image/webp`
  - `application/pdf`
  - `text/plain`

Что не включать в первый релиз:
- множественные файлы в одном сообщении
- drag-and-drop upload queue
- редактирование подписи вложения после отправки
- virus scanning
- S3/presigned upload flow
- вложения в групповых чатах

## Recommended Storage Strategy
### MVP strategy
Использовать локальное файловое хранилище на сервере с отдельным volume.

Почему это подходит для первого релиза:
- минимальный time-to-market
- хорошо сочетается с текущей VPS-схемой
- проще отлаживать локально и в первом production deploy

Предлагаемая схема:
- физическое хранение файлов в директории вида `/app/uploads`
- отдельный docker volume для uploads
- API или reverse proxy отдает файлы по стабильному публичному URL

### Future-ready note
Сразу не внедрять S3, но заложить abstraction по `storageKey`, чтобы позже перейти на объектное хранилище без полной переделки модели.

## Data Model Changes
### New model
Добавить таблицу `attachments`.

Рекомендуемая структура:
- `id`
- `messageId`
- `uploaderId`
- `storageKey`
- `originalName`
- `mimeType`
- `sizeBytes`
- `imageWidth` nullable
- `imageHeight` nullable
- `createdAt`

### Message changes
Есть два варианта:
1. оставить `body: String` и разрешить пустую строку
2. сделать `body: String?`

Рекомендация:
- перейти на `body: String?`, потому что attachment-only message тогда моделируется чище

Бизнес-правило:
- сообщение должно содержать либо `body`, либо вложение, либо оба значения сразу

## API Design
### Keep existing endpoint stable
Текущий endpoint `POST /chats/:chatId/messages` оставить для text-only сообщений.

### Add new upload endpoint
Добавить отдельный endpoint:
- `POST /chats/:chatId/attachments`

Формат:
- `multipart/form-data`
- поля:
  - `file`
  - `body` optional

Почему так лучше для первой итерации:
- не ломает текущий JSON flow
- не требует сразу переписывать существующие клиенты и тесты
- проще валидировать upload отдельно от text-only send flow

### Response contract
Ответ должен возвращать message payload того же уровня, что и обычное сообщение, но с новым полем:
- `attachments: AttachmentDto[]`

### Download access
Варианты:
- отдавать файл через API endpoint `GET /attachments/:attachmentId`
- или отдавать публичный URL из message payload

Рекомендация для MVP:
- отдавать через API контролируемый URL, например `GET /attachments/:attachmentId`
- это дает единый контроль доступа и скрывает физический storage layout

## Authorization Rules
- загружать файл может только участник чата
- скачивать вложение может только участник того же чата
- attachment URL не должен быть анонимно доступным, если не принято отдельное решение про public files

## Backend Work Breakdown
### Phase 1: Schema and persistence
- добавить Prisma model `Attachment`
- обновить `Message` relation
- сгенерировать migration
- обновить Prisma payload mappings в chat service

### Phase 2: Upload handling
- добавить upload controller/service
- использовать `multipart/form-data`
- валидировать размер и mime type
- сохранять файл в volume
- создавать `message + attachment` в одной транзакции

### Phase 3: Read models and serialization
- вернуть attachments в:
  - `GET /chats/:chatId/messages`
  - `POST /chats/:chatId/attachments`
  - при необходимости `GET /chats/:chatId`
- обновить realtime payload `message:new`

### Phase 4: File serving
- добавить download endpoint
- проверить membership before file access
- настроить корректные content-type и content-disposition

## Frontend Work Breakdown
### Composer changes
- добавить кнопку выбора файла в composer
- хранить pending attachment в локальном state
- показать preview перед отправкой
- разрешить отмену до отправки

### Message rendering
- если attachment image:
  - показать thumbnail/preview
- если attachment non-image:
  - показать карточку файла: имя, размер, тип, action на открытие/скачивание

### Query and cache changes
- расширить frontend типы `ChatMessage`
- обновить message cache helpers
- убедиться, что optimistic/normal append не ломает attachment payload

## UX Rules
- отправка пустого текста без файла запрещена
- attachment-only message разрешен
- при превышении лимита размера показывать понятную inline ошибку
- пока файл загружается, кнопку отправки блокировать
- после успешной отправки очищать и `draft`, и выбранный файл

## Testing and Validation
### Backend tests
- upload endpoint rejects oversized files
- upload endpoint rejects unsupported mime types
- non-member cannot upload
- non-member cannot download
- message list returns attachments

### UI tests
- user selects file and sends attachment message
- recipient sees attachment in chat
- image preview renders
- file-only message works
- invalid file type shows error

### Manual checks
- upload in local dev
- download in browser
- refresh page and verify attachment persists
- production deploy with upload volume mounted

## Production Notes
Для production нужно добавить volume для uploads в `docker-compose.production.yml`.

Рекомендуемая следующая правка после начала реализации:
- volume `uploads_data`
- mount в `api`
- при необходимости mount в `caddy`, если файлы будут отдаваться не через Nest endpoint, а напрямую

## Risks
- Риск: локальный disk storage усложнит будущий переход на несколько API-инстансов.
- Mitigation: хранить в БД `storageKey`, а не полный физический путь.

- Риск: attachment-only messages потребуют изменения текущей модели `body`.
- Mitigation: явно провести migration и обновить все DTO/type mappings одним батчем.

- Риск: upload flow увеличит сложность `chat.service` и realtime payloads.
- Mitigation: выделить attachment service отдельно, а не смешивать все в один метод sendMessage.

- Риск: файловые лимиты и mime filtering будут работать по-разному в dev и production.
- Mitigation: зафиксировать один upload config и покрыть его e2e/manual checks.

## Recommended Exit Criteria
Batch считается завершенным, когда:
- пользователь может отправить файл в direct chat
- собеседник получает attachment через realtime
- вложение сохраняется и переживает перезагрузку страницы
- UI e2e покрывает сценарий upload -> receive -> open
- production compose учитывает upload volume