## Goal
Исправить создание direct-чата из результатов поиска пользователей и упростить empty-state рабочей области, убрав лишние декоративные надписи и карточки, которые сейчас перегружают интерфейс.

## Assumptions
- Проблема с direct-чатом находится на фронтенде, а backend-ручка `/chats/direct` уже рабочая.
- Текущий баг связан не с поиском пользователей как таковым, а с переходом/обновлением UI после успешного создания direct-чата.
- Декоративные элементы `Ready to chat`, `Workspace`, `Messaging`, а также карточки `Direct / Realtime / Focused` находятся в пустом состоянии компонента [chat-placeholder.tsx](C:\Users\User\Desktop\Project\apps\web\components\chat-placeholder.tsx).
- Нужно сохранить текущий визуальный стиль сцены, но сделать empty-state заметно чище.

## Plan
### Phase 1: Diagnose direct-chat creation flow
- Проверить текущую реализацию `createDirectChatMutation` в [chat-shell.tsx](C:\Users\User\Desktop\Project\apps\web\components\chat-shell.tsx).
- Сверить, что возвращает backend после `POST /chats/direct`:
  - id созданного или найденного direct-чата;
  - достаточно ли этого для мгновенного перехода в диалог.
- Проверить текущий `onSuccess`:
  - сбрасывается ли поиск;
  - происходит ли переход в конкретный чат или только в общий `/chat`;
  - не теряется ли возвращенный `chat.id`.
- Определить, есть ли вторичный UI-хвост:
  - поиск остается открытым;
  - список чатов не успевает обновиться;
  - drawer или sidebar перекрывает переход.
- Output / exit criterion:
  - понятна точная причина, почему при выборе пользователя direct-чат визуально “не создается”.

### Phase 2: Fix direct-chat navigation and UI refresh
- Исправить `createDirectChatMutation` так, чтобы после успешного ответа происходил переход прямо в созданный чат:
  - `router.replace(/chat/${chat.id})`, а не возврат в общий список.
- Убедиться, что после создания:
  - поиск сбрасывается;
  - список чатов инвалидируется;
  - пользователь сразу видит открытую переписку;
  - при повторном выборе того же пользователя открывается уже существующий direct, а не создается дубль.
- Если поиск открыт в sidebar, дополнительно проверить, нужно ли:
  - сохранять список результатов;
  - или очищать его после перехода.
- Output / exit criterion:
  - клик по найденному пользователю стабильно открывает его direct-чат.

### Phase 3: Simplify chat placeholder content
- Открыть и переработать [chat-placeholder.tsx](C:\Users\User\Desktop\Project\apps\web\components\chat-placeholder.tsx).
- Удалить верхнюю надпись:
  - `Ready to chat`
- Удалить левую floating-карточку:
  - `Workspace`
  - `01`
  - поясняющий текст про список диалогов и рабочее поле
- Удалить нижний темный promo-блок:
  - `Messaging`
  - крупный текст про выбор чата слева
  - декоративные вертикальные плашки
- Удалить сетку карточек:
  - `Direct`
  - `Realtime`
  - `Focused`
- После удаления проверить, не остались ли:
  - лишние absolute-обертки;
  - пустые контейнеры;
  - неработающие компоненты вроде `InfoCard`, если они больше не используются.
- Output / exit criterion:
  - empty-state стал чище и содержит только действительно нужный контент.

### Phase 4: Rebalance empty-state layout after cleanup
- Пересобрать композицию placeholder после удаления декоративных блоков:
  - выровнять основной контент;
  - убрать пустое пространство, оставшееся от absolute-элементов;
  - сохранить аккуратную типографику и общий стиль страницы.
- Проверить, не нужно ли:
  - уменьшить высоту контейнера;
  - убрать специальные декоративные отступы;
  - сместить основной текст ближе к центру.
- Если после удаления некоторые стили станут лишними, аккуратно зачистить их без смены визуальной темы.
- Output / exit criterion:
  - placeholder выглядит намеренно минималистично, а не “недорендеренным”.

### Phase 5: Regression checks
- Проверить сценарий direct-чата:
  - найти пользователя в поиске;
  - кликнуть по нему;
  - попасть в конкретный диалог;
  - обновить страницу и убедиться, что чат остался в списке.
- Проверить сценарий повторного открытия того же direct-чата через поиск.
- Проверить empty-state:
  - без активного чата;
  - после первого созданного чата;
  - на desktop и на узкой ширине.
- Проверить, что удаление декоративных блоков не сломало импортов и сборку.
- Прогнать:
  - `pnpm --filter @repo/web typecheck`
  - `pnpm verify:web`
- Output / exit criterion:
  - direct-чат создается/открывается корректно, а пустое состояние упрощено без регрессий.

## Risks and Dependencies
- Риск: direct-чаты создаются корректно на backend, но UI открывает не тот маршрут.
  - Mitigation: использовать объект `chat`, возвращаемый mutation, как единственный источник truth для редиректа.
- Риск: после удаления promo-блоков placeholder станет слишком пустым.
  - Mitigation: сохранить один основной информативный текст и аккуратно перевыстроить layout.
- Риск: после зачистки появятся неиспользуемые компоненты или импорты.
  - Mitigation: после удаления пройтись по файлу и убрать мертвый JSX/вспомогательные компоненты.
- Dependency: исправление затрагивает как минимум [chat-shell.tsx](C:\Users\User\Desktop\Project\apps\web\components\chat-shell.tsx) и [chat-placeholder.tsx](C:\Users\User\Desktop\Project\apps\web\components\chat-placeholder.tsx).

## Next Actions
- Исправить `createDirectChatMutation` в [chat-shell.tsx](C:\Users\User\Desktop\Project\apps\web\components\chat-shell.tsx), чтобы после выбора пользователя открывался конкретный direct-чат.
- Удалить из [chat-placeholder.tsx](C:\Users\User\Desktop\Project\apps\web\components\chat-placeholder.tsx) `Ready to chat`, `Workspace`, `Messaging` и карточки `Direct / Realtime / Focused`.
- Прогнать `typecheck` и `verify:web`, чтобы подтвердить, что bug закрыт и empty-state очищен без побочных эффектов.
