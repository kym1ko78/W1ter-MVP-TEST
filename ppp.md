## Goal
Аккуратно вернуть в текущий `main` весь функционал из ветки `feat/prompt-05-search-discovery`, связанный с сообщениями: ответы, редактирование, пересылка, реакции по ховеру и все зависимые изменения в `api`, Prisma и `web`, не ломая уже влитый редизайн sidebar и текущую структуру `conversation-view`.

## Assumptions
- Базовая ветка для работы: текущий `main`.
- Источником истины по функционалу считаем коммиты `2093dbd`, `1f91784`, `7fc36a4`, `336b82a` и связанные изменения в `origin/feat/prompt-05-search-discovery`.
- Prisma schema и миграции `0005_message_reply_and_edit` и `0006_forward_and_reactions` уже существуют и должны остаться в `main`.
- Возвращать нужно именно поведение и API-возможности из той ветки, но с адаптацией под текущий UI, а не слепым откатом всего файла `conversation-view.tsx`.
- Допустимо вручную переносить изменения вместо полного `cherry-pick`, если это уменьшает конфликты и сохраняет новые UI-решения.

## Plan
### Phase 1: Зафиксировать состав возвращаемого функционала
- Сверить коммиты ветки `feat/prompt-05-search-discovery`, которые добавляли:
  - ответы на сообщения
  - редактирование сообщений
  - пересылку сообщений
  - реакции на сообщения
  - hover-панель действий у сообщения
- Выписать список затронутых файлов по слоям:
  - Prisma: `apps/api/prisma/schema.prisma`, миграции `0005`, `0006`
  - API: `apps/api/src/chat/chat.controller.ts`, `apps/api/src/chat/chat.service.ts`, DTO, shared types
  - Web: `apps/web/components/conversation-view.tsx`, `apps/web/types/api.ts`
- Сравнить текущий `main` с содержимым этих коммитов и разделить различия на:
  - уже присутствует в `main`
  - отсутствует полностью
  - присутствует частично, но UI/состояние были переписаны
- Output / exit criterion:
  - есть точная карта, что именно возвращаем и что уже нельзя трогать без риска сломать текущий редизайн

### Phase 2: Стабилизировать backend-основу
- Проверить, что в `apps/api/prisma/schema.prisma` реально присутствуют:
  - `replyToMessageId`
  - relation `replyTo/replies`
  - `MessageReaction`
  - relation `reactions`
- Проверить, что DTO и controller-роуты в `main` уже содержат:
  - update message
  - forward message
  - toggle reaction
  - send message with `replyToMessageId`
- Проверить `ChatService` на полноту логики:
  - загрузка `replyTo` в `getMessages`
  - загрузка `reactions`
  - валидация reply target
  - обновление сообщения
  - пересылка сообщения
  - toggle reaction create/update/delete
  - корректная сериализация payload в `toMessagePayload`
- При расхождениях перенести недостающую бизнес-логику из ветки-источника в текущий `main`, не ломая уже существующие методы.
- Проверить, что Prisma Client сгенерирован из актуальной схемы, а БД применяет миграции `0005` и `0006`.
- Output / exit criterion:
  - `api` поднимается без Prisma-ошибок
  - `pnpm --filter @repo/api typecheck` проходит
  - роуты для reply/edit/forward/reaction реально работают на уровне сервиса

### Phase 3: Восстановить контракт данных между API и web
- Сверить `packages/shared/src/index.ts` и `apps/web/types/api.ts` с веткой-источником.
- Вернуть или подтвердить наличие в типах:
  - `replyTo`
  - `reactions`
  - поля edited/deleted state, если используются для UI
  - payload для forward/reaction/update message
- Проверить, что `normalizeMessagePage`, `message-cache` и прочие клиентские помощники не теряют новые поля при нормализации и upsert.
- Проверить совместимость типов с текущим `conversation-view.tsx`, чтобы не получить скрытые runtime-расхождения между UI и API.
- Output / exit criterion:
  - web-типизация знает про reply/reaction/edit/forward данные
  - клиентский кэш не затирает новые поля сообщения

### Phase 4: Вернуть message actions в текущий `conversation-view`
- Не копировать старую версию `conversation-view.tsx` целиком.
- Взять из ветки-источника только функциональные блоки:
  - `replyingToMessage`
  - `editingMessage`
  - `forwardingMessage`
  - поиск target chat для forward
  - `toggleReactionMutation`
  - hover action panel
  - quick reactions UI
  - composer context для reply/edit
- Встроить эти блоки в текущую структуру компонента поверх уже существующего редизайна:
  - сохранить текущий header с поиском/профилем/меню
  - сохранить текущий composer layout и voice UI
  - сохранить текущие размеры/отступы и список чатов
- Для сообщений адаптировать текущую разметку bubble так, чтобы:
  - кнопка удаления не потерялась
  - добавились `Ответ`, `Изменить`, `Переслать`
  - реакции отображались компактно под bubble
  - quick reactions открывались по hover/focus
- Вернуть переход к исходному сообщению по reply preview.
- Вернуть режим редактирования composer:
  - подстановка текста сообщения
  - отмена редактирования
  - корректная отправка `PATCH`
- Вернуть режим ответа:
  - preview исходного сообщения
  - отмена ответа
  - корректная отправка `replyToMessageId`
- Вернуть modal/overlay для пересылки:
  - список чатов
  - поиск по чатам
  - обработка пересылки в текущий и сторонний чат
- Output / exit criterion:
  - в UI снова есть все message actions из ветки-источника
  - текущий дизайн `main` не сломан полным откатом старого компонента

### Phase 5: Довести message interactions до целостного поведения
- Проверить взаимодействие новых режимов друг с другом:
  - нельзя одновременно редактировать и отвечать
  - нельзя начинать запись голосового во время редактирования/ответа
  - вложения и edit-mode не конфликтуют
  - forward modal не ломает фокус и overlay
- Проверить поведение удаления сообщений вместе с reply/reaction state.
- Проверить, что `focusMessageById` работает для:
  - поисковых результатов
  - reply preview
  - после редактирования
- Убедиться, что optimistic update или invalidation query работают корректно для:
  - edit
  - forward
  - reaction toggle
  - delete
- Проверить, что hover actions корректно видимы и доступны на desktop, а на touch не создают блокирующий UX.
- Output / exit criterion:
  - нет конфликтующих состояний в composer и message actions
  - основные пользовательские сценарии завершены end-to-end

### Phase 6: Валидация и smoke-проверка
- Прогнать:
  - `pnpm --filter @repo/api typecheck`
  - `pnpm --filter @repo/web typecheck`
  - `pnpm verify:web`
- Поднять локально `api` и `web`.
- Проверить вручную сценарии:
  - отправка обычного сообщения
  - ответ на сообщение
  - редактирование своего сообщения
  - удаление своего сообщения
  - пересылка сообщения в другой чат
  - постановка и снятие реакции
  - отображение reply preview и reaction chips
  - работа после перезагрузки страницы
- Если есть ошибки Prisma или payload mismatch, исправлять сначала backend contract, потом UI.
- Output / exit criterion:
  - функционал из `feat/prompt-05-search-discovery` работает в текущем `main`
  - основные сценарии проходят локально без регрессий

### Phase 7: Подготовить безопасную сдачу результата
- Свести итоговые изменения к понятному набору файлов.
- Отдельно проверить, что мы не перетёрли ваши recent UI-изменения в:
  - `chat-shell.tsx`
  - sidebar drawer
  - white panel / flat chat list
- Подготовить краткое описание:
  - что вернули из старой ветки
  - что адаптировали под новый дизайн вручную
  - какие ограничения или residual risks остались
- Output / exit criterion:
  - изменения готовы к коммиту без неясных конфликтов между старым функционалом и новым UI

## Risks and Dependencies
- Риск: прямой перенос старого `conversation-view.tsx` затрёт текущий дизайн `main`.
  - Mitigation: переносить только функциональные блоки и встраивать их в текущую разметку вручную.
- Риск: API и web уже частично разошлись по контракту типов.
  - Mitigation: сначала стабилизировать shared types и payload shape, затем править UI.
- Риск: Prisma Client и база могут снова рассинхрониться после ручных изменений.
  - Mitigation: после backend-правок обязательно запускать `prisma generate` и применять существующие миграции.
- Риск: старые hover actions и новые layout-решения могут конфликтовать по позиционированию.
  - Mitigation: отдельно проверить desktop hover и focus states после интеграции.
- Dependency: локальная БД должна содержать миграции `0005` и `0006`.
- Dependency: текущий `main` должен оставаться базой, чтобы не потерять уже смерженные UI-правки sidebar.

## Next Actions
- Снять подробный diff между `main` и `origin/feat/prompt-05-search-discovery` по `conversation-view.tsx`, `chat.service.ts`, `types`.
- Вернуть и проверить backend-логику reply/edit/forward/reaction, если что-то в `main` отсутствует или сломано.
- Интегрировать message actions обратно в текущий `conversation-view.tsx` без отката нового дизайна.
