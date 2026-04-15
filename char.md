## Goal
Аккуратно разрешить merge-conflict в `ChatShell`, сохранив весь функционал из обеих веток: текущий layout/sidebar и логику realtime, presence, typing, notifications, offline-state и socket lifecycle, без потери уже существующих UI-изменений и без появления новых runtime-регрессий.

## Assumptions
- Конфликт находится в файле `apps/web/components/chat-shell.tsx`.
- Ветка `feat/prompt-10-media-storage-upgrade` приносит расширенный realtime-функционал:
  - `connectionState`
  - `isOffline`
  - `onlineUserIds`
  - `typingByChat`
  - notifications permission / enable state
  - local typing sync
  - richer socket event handling
- Ветка `main` приносит актуальный layout/sidebar и более аккуратный socket cleanup/lifecycle вокруг `currentChatIdRef`.
- Задача не в выборе одной стороны, а в ручном объединении обеих.
- После merge нужно оставить код в рабочем состоянии для `web` и не сломать API-контракты, которые уже используются экраном чатов.

## Plan
### Phase 1: Зафиксировать конфликтные зоны и назначение каждой стороны
- Найти все merge-маркеры `<<<<<<<`, `=======`, `>>>>>>>` в `apps/web/components/chat-shell.tsx`.
- Разбить конфликт на независимые блоки:
  - imports
  - local state
  - refs
  - derived values / callbacks
  - socket `useEffect`
  - UI-разметка sidebar и chat list
  - provider / return tree
- Для каждого блока определить:
  - что добавляет `feat/prompt-10-media-storage-upgrade`
  - что добавляет `main`
  - что должно быть сохранено из обеих сторон
- Output / exit criterion:
  - есть карта конфликтов, где понятно, что именно мы объединяем, а не просто “берем левое или правое”

### Phase 2: Свести imports, types и state без потери функций
- Проверить imports на наличие всех нужных сущностей:
  - `RealtimeContext`
  - notification-related types
  - `io`, `Socket`
  - все UI-компоненты и util-функции
- Объединить state из обеих сторон:
  - сохранить `connectionState`
  - сохранить `isOffline`
  - сохранить `onlineUserIds`
  - сохранить `typingByChat`
  - сохранить `notificationPermission`
  - сохранить `notificationsEnabled`
  - сохранить `currentChatIdRef`
  - не потерять `deferredGlobalSearch`, `group composer`, `sidebar menu`, `delete/leave chat` state
- Исправить очевидные конфликтные ошибки, например:
  - `useDeferredValue(search)` должно остаться `useDeferredValue(globalSearch)`
  - дубликаты `currentChatIdRef`
- Output / exit criterion:
  - верхняя часть файла компилируется и содержит все состояния обеих веток

### Phase 3: Объединить derived callbacks и realtime helpers
- Сохранить callbacks из feature-ветки:
  - `updateOnlineUsers`
  - `isUserOnline`
  - `isUserTyping`
  - `setNotificationsEnabled`
  - `requestNotificationPermission`
  - `markMessageAsNotified`
  - `updateTyping`
- Проверить, как эти callbacks используются в текущем layout:
  - статус realtime в sidebar
  - статусы `online/offline`
  - typing indicators в списке чатов
  - управление notifications из UI
- Убедиться, что нет “мертвых” состояний или callbacks после merge.
- Output / exit criterion:
  - helper-логика собрана в одной версии без дубликатов и без потерянных зависимостей

### Phase 4: Объединить socket lifecycle из обеих веток
- Взять за основу более безопасный lifecycle из `main`, если он уже решал dev-warning про premature disconnect.
- Поверх него встроить функциональность из feature-ветки:
  - `connect`, `disconnect`, `connect_error`, `reconnect_attempt`
  - `message:new`
  - `message:updated`
  - `chat:updated`
  - `chat:deleted`
  - `chat:read`
  - `presence:changed`
  - `typing:changed`
  - `presence:sync`
- Сохранить join room semantics:
  - текущий чат должен join’иться после connect
  - `currentChatIdRef` должен обновляться отдельно effect’ом
- В cleanup сохранить оба требования:
  - сброс локального typing-state перед disconnect
  - мягкий disconnect/reconnection-safe cleanup из `main`
- Проверить, чтобы socket не создавался повторно без необходимости и не терялся при `Fast Refresh`.
- Output / exit criterion:
  - один целостный `useEffect` для socket, который умеет и realtime-features, и аккуратный cleanup

### Phase 5: Свести notification и offline-эффекты
- Вернуть эффекты из feature-ветки:
  - отслеживание `window.navigator.onLine`
  - чтение `Notification.permission`
  - восстановление значения из `localStorage`
  - interval для очистки устаревших typing entries
- Проверить, что они не конфликтуют с текущим `main` и не дублируют логику.
- Проверить зависимости эффектов:
  - не допустить stale closure для `user?.id`, `queryClient`, `router`
  - не допустить бесконечных перерендеров
- Output / exit criterion:
  - offline/notification logic снова работает и не ломает рендер

### Phase 6: Объединить return tree и UI обеих веток
- За основу взять текущий UI из `main`, если он уже содержит:
  - белый drawer
  - обновлённый sidebar
  - нужные изменения списка чатов
- Из feature-ветки вернуть визуально зависимые части:
  - `RealtimeContext.Provider`
  - статус realtime
  - notification controls
  - richer chat list status lines (`печатает`, `онлайн`, `статусы могут запаздывать`)
  - preview last message / typing text
- Не потерять:
  - кнопку меню sidebar
  - drawer c `Мой профиль`, `Выйти`, `Создать группу`
  - group composer flow
  - global search results
  - delete/leave group dialog behavior
- В спорных местах использовать правило:
  - layout и визуальная структура из актуального `main`
  - поведенческая логика и статусные функции из feature-ветки
- Output / exit criterion:
  - итоговый JSX содержит все рабочие панели и весь статусный функционал без визуального отката

### Phase 7: Восстановить контекст realtime для дочерних компонентов
- Убедиться, что `RealtimeContext.Provider` снова оборачивает `ChatShell`.
- Проверить, что `realtimeContextValue` включает:
  - `connectionState`
  - `isOffline`
  - `statusesMayBeStale`
  - `notificationPermission`
  - `notificationsEnabled`
  - `notificationsSupported`
  - `requestNotificationPermission`
  - `setNotificationsEnabled`
  - `isUserOnline`
  - `isUserTyping`
  - `updateTyping`
- Проверить, что дочерние экраны (`ConversationView` и др.) не ломаются от отсутствующих полей контекста.
- Output / exit criterion:
  - downstream components продолжают получать полный realtime context API

### Phase 8: Проверка и устранение регрессий
- Прогнать:
  - `pnpm --filter @repo/web typecheck`
  - `pnpm --filter @repo/api typecheck`
  - `pnpm verify:web`
- Поднять локально `web` и `api`.
- Проверить вручную:
  - открытие `/chat`
  - открытие конкретного чата
  - socket connect/disconnect
  - typing indicator
  - online/offline presence
  - sidebar drawer
  - создание группы
  - глобальный поиск
  - уведомления (если разрешены)
- Проверить, что dev-console не засыпана новыми cleanup/socket ошибками.
- Output / exit criterion:
  - merge разрешён и поведение подтверждено локально

### Phase 9: Финализация merge
- Убедиться, что merge-маркеров в файле больше нет.
- Проверить `git diff` на предмет случайно потерянных участков JSX.
- Подготовить краткое summary:
  - какие блоки взяты из feature-ветки
  - какие блоки сохранены из `main`
  - какие места пришлось адаптировать вручную
- Output / exit criterion:
  - файл готов к коммиту, а merge завершён без скрытых потерь функционала

## Risks and Dependencies
- Риск: взять весь JSX из feature-ветки и потерять актуальный sidebar/layout из `main`.
  - Mitigation: layout брать из `main`, функциональные статусы и socket logic переносить выборочно.
- Риск: взять cleanup из feature-ветки и вернуть шумный dev-disconnect behavior.
  - Mitigation: основываться на более мягком lifecycle из `main`, добавляя только недостающие realtime-события.
- Риск: не заметить логическую ошибку в merge вроде `useDeferredValue(search)` вместо `useDeferredValue(globalSearch)`.
  - Mitigation: после merge обязательно прогнать typecheck и глазами проверить все state-dependencies.
- Риск: notifications/offline/typing код может быть частично неиспользуемым после UI-изменений.
  - Mitigation: проверять каждое состояние на реальное использование в JSX или context.
- Dependency: актуальные Prisma миграции и API endpoints уже должны быть применены, чтобы realtime-панель и message updates не упирались в backend.

## Next Actions
- Открыть `apps/web/components/chat-shell.tsx` и выписать все конфликтные блоки по порядку.
- Сначала вручную объединить imports/state/refs/callbacks, затем socket effect, затем JSX.
- После ручного merge сразу прогнать `web` typecheck, не дожидаясь финала, чтобы поймать structural errors на раннем этапе.
