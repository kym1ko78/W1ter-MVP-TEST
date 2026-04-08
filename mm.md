## Objective
Добавить:
- удаление сообщений
- удаление чата
- устойчивое “запомнить меня”, чтобы не приходилось логиниться заново
- отправку по `Enter`
- перенос строки по `Ctrl + Enter`
- убрать имя над каждым сообщением в direct chat

## Assumptions
- Проект пока работает только с `DIRECT` чатами.
- Удаление сообщений и чата должно быть доступно только участникам чата.
- Для MVP логично начать с “soft delete” сообщений, а не физического удаления строки из БД.
- “Запомнить меня” сейчас уже частично есть через refresh cookie, значит задача скорее в доводке UX и устойчивости session restore.
- Убирать имя над сообщением нужно именно для текущих личных чатов; для будущих групповых чатов это лучше оставить как условное поведение.

## Architecture / Approach
Разбить задачу на 5 рабочих потоков:

1. Message delete  
2. Chat delete  
3. Session persistence / remember me  
4. Composer keyboard behavior  
5. Message bubble cleanup for direct chats

Логика удаления затронет:
- [schema.prisma](C:\Users\User\Desktop\Project\apps\api\prisma\schema.prisma)
- [chat.service.ts](C:\Users\User\Desktop\Project\apps\api\src\chat\chat.service.ts)
- [chat.controller.ts](C:\Users\User\Desktop\Project\apps\api\src\chat\chat.controller.ts)
- [conversation-view.tsx](C:\Users\User\Desktop\Project\apps\web\components\conversation-view.tsx)
- [chat-shell.tsx](C:\Users\User\Desktop\Project\apps\web\components\chat-shell.tsx)

Session persistence затронет:
- [auth.controller.ts](C:\Users\User\Desktop\Project\apps\api\src\auth\auth.controller.ts)
- [auth.service.ts](C:\Users\User\Desktop\Project\apps\api\src\auth\auth.service.ts)
- [auth-context.tsx](C:\Users\User\Desktop\Project\apps\web\lib\auth-context.tsx)

## Plan

### Phase 1: Добавить удаление сообщений на backend
- Решить модель удаления:
  - сохранить запись сообщения
  - ставить `deletedAt`
  - очищать `body`
  - удалять/скрывать вложения
- Это лучше, чем hard delete, потому что:
  - не ломает read pointers
  - не ломает chronology
  - не требует сложной пересборки истории
- Добавить новый метод в `ChatService`, например `deleteMessage(chatId, messageId, currentUserId)`.
- Проверить права:
  - пользователь состоит в чате
  - пользователь удаляет только свое сообщение
- При удалении:
  - если сообщение последнее в чате, пересчитать `lastMessageId`
  - обновить `updatedAt` чата при необходимости
  - эмитить realtime update в сокет
- Output / exit criterion:
  - API умеет корректно “мягко” удалять сообщение и синхронизировать чат

### Phase 2: Добавить удаление сообщений в API и payload
- Добавить новый route в [chat.controller.ts](C:\Users\User\Desktop\Project\apps\api\src\chat\chat.controller.ts), скорее всего:
  - `DELETE /chats/:chatId/messages/:messageId`
- Обновить `toMessagePayload` в сервисе так, чтобы deleted message имело понятное состояние:
  - `body: null`
  - `deletedAt`
  - возможно `isDeleted: true`
  - `attachments: []`
- Обновить frontend type definitions в [api.ts](C:\Users\User\Desktop\Project\apps\web\types\api.ts)
- Output / exit criterion:
  - frontend получает явный признак, что сообщение удалено

### Phase 3: Добавить UI удаления сообщения
- В [conversation-view.tsx](C:\Users\User\Desktop\Project\apps\web\components\conversation-view.tsx):
  - добавить action для своих сообщений
  - это может быть:
    - hover button
    - мини-меню
    - иконка/текстовая кнопка
- После удаления:
  - оптимистично обновить query cache
  - либо сделать invalidate queries для сообщений и чатов
- Для deleted messages выбрать поведение:
  - либо полностью скрывать bubble
  - либо показывать “Сообщение удалено”
- Для текущего чата безопаснее и понятнее:
  - оставить место в истории
  - показать нейтральный deleted-state bubble
- Output / exit criterion:
  - свое сообщение можно удалить из UI, и история остается устойчивой

### Phase 4: Добавить удаление чата на backend
- Определить продуктовую семантику:
  - в direct chat у нас лучше удалять чат целиком для обоих участников
- Для MVP это нормально, если:
  - чат реально удаляется из БД
  - его сообщения и вложения удаляются каскадно
- Добавить метод `deleteChat(chatId, currentUserId)` в [chat.service.ts](C:\Users\User\Desktop\Project\apps\api\src\chat\chat.service.ts)
- Проверить:
  - пользователь состоит в чате
  - чат существует
- При удалении:
  - почистить attachment files с диска до или после удаления записей
  - эмитить realtime chat removed/update
- Output / exit criterion:
  - direct chat можно безопасно удалить целиком

### Phase 5: Добавить UI удаления чата
- В [chat-shell.tsx](C:\Users\User\Desktop\Project\apps\web\components\chat-shell.tsx) или в header текущего чата:
  - добавить кнопку удаления чата
  - добавить confirm step
- После удаления:
  - удалить чат из query cache
  - снять active chat route
  - редиректить на `/chat`
- Проверить состояние:
  - если удален открытый чат, экран не должен остаться в битом состоянии
- Output / exit criterion:
  - чат удаляется из списка и интерфейс корректно возвращается в пустое состояние

### Phase 6: Довести “запомнить меня”
- Сейчас основа уже есть:
  - refresh cookie
  - `refreshSession()` в [auth-context.tsx](C:\Users\User\Desktop\Project\apps\web\lib\auth-context.tsx)
- Нужно решить, что именно означает “запомнить меня”:
  - вариант A: всегда запоминать
  - вариант B: checkbox “Запомнить меня”
- Для текущего MVP проще и лучше:
  - всегда держать пользователя залогиненным, пока refresh token жив
- Проверить и усилить:
  - cookie attributes
  - восстановление сессии после reload
  - восстановление после закрытия вкладки/браузера
  - корректный logout с очисткой cookie и локального состояния
- При необходимости добавить:
  - стартовый `me`/`refresh` bootstrap guard
  - более явное session hydration состояние на frontend
- Output / exit criterion:
  - пользователь после перезапуска страницы/браузера остается в аккаунте, если refresh token еще валиден

### Phase 7: Добавить отправку по Enter и newline по Ctrl+Enter
- В [conversation-view.tsx](C:\Users\User\Desktop\Project\apps\web\components\conversation-view.tsx) добавить `onKeyDown` для `textarea`
- Поведение:
  - `Enter` без модификаторов:
    - `preventDefault()`
    - отправка сообщения
  - `Ctrl + Enter`:
    - не отправляет
    - вставляет перенос строки
- Дополнительно проверить:
  - пустое сообщение не отправляется
  - сообщение с файлом и текстом отправляется корректно
  - авто-рост textarea не ломается
- Output / exit criterion:
  - composer ведет себя как чат, а не как обычный textarea

### Phase 8: Убрать имя над сообщениями в direct chat
- В [conversation-view.tsx](C:\Users\User\Desktop\Project\apps\web\components\conversation-view.tsx) убрать рендер:
  - `message.sender.displayName`
  над incoming messages
- Сделать это условно под current chat type:
  - для `DIRECT` скрыть имя
  - оставить возможность потом вернуть имя для групповых чатов
- Output / exit criterion:
  - в личных чатах bubble чище и компактнее, без имени сверху

### Phase 9: Синхронизировать кеш, realtime и edge cases
- Проверить, что после удаления сообщения:
  - обновляется `message-list`
  - обновляется preview последнего сообщения в sidebar
  - unread/read состояние не ломается
- Проверить, что после удаления чата:
  - удаляется current chat
  - сокет не продолжает работать с уже несуществующим chat room
- Проверить session restore:
  - reload страницы
  - reload на `/chat/[chatId]`
  - открытие новой вкладки
- Output / exit criterion:
  - все новые действия согласованы между API, query cache и realtime

## Testing and Validation
- Backend:
  - удалить свое сообщение
  - попытаться удалить чужое сообщение
  - удалить чат участником
  - попытаться удалить чат неучастником
- Frontend:
  - удалить сообщение из открытого чата
  - удалить последнее сообщение в чате
  - удалить чат из списка и из открытого экрана
  - reload страницы после логина
  - закрыть/открыть браузер и проверить восстановление сессии
  - `Enter` отправляет
  - `Ctrl + Enter` делает перенос строки
  - имя над сообщением отсутствует
- Автотесты:
  - расширить [app.e2e-spec.ts](C:\Users\User\Desktop\Project\apps\api\test\app.e2e-spec.ts)
  - обновить [chat-flow.spec.ts](C:\Users\User\Desktop\Project\tests\playwright\chat-flow.spec.ts)

## Risks and Dependencies
- Риск: hard delete сообщения сломает `lastMessageId` и историю.
- Mitigation:
  - делать soft delete сообщений.

- Риск: удаление чата с вложениями оставит мусор на диске.
- Mitigation:
  - при delete chat удалить связанные attachment files.

- Риск: “запомнить меня” будет вести себя нестабильно из-за cookie attributes.
- Mitigation:
  - явно проверить `maxAge`, `sameSite`, `secure`, refresh bootstrap после reload.

- Риск: `Enter` начнет случайно отправлять многострочные сообщения.
- Mitigation:
  - строго развести `Enter` и `Ctrl + Enter`.

- Риск: скрытие имени сейчас хорошо для direct chat, но потом помешает group chat.
- Mitigation:
  - сделать условие на `chat.type`, а не удалять логику безвозвратно.

## Sequencing Rationale
Лучший порядок реализации такой:
1. убрать имя над сообщениями  
2. добавить `Enter` / `Ctrl+Enter`  
3. довести session restore  
4. сделать delete message  
5. сделать delete chat  
6. после этого обновить e2e тесты

Так быстрее получить видимый UX-результат, а более рискованные изменения в данных оставить после того, как мелкие UI-правки уже стабилизированы.

## Next Actions
- Подтвердить продуктовую семантику:
  - сообщение удаляем как `soft delete`
  - direct chat удаляем целиком
- Начать с frontend-small wins:
  - убрать имя
  - добавить `Enter` / `Ctrl+Enter`
- Затем перейти к auth persistence
- После этого реализовать delete message и delete chat end-to-end