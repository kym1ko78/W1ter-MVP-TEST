## Goal
Найти все затертые или частично потерянные изменения после merge/resolve-конфликтов, в первую очередь в чате, сообщениях, реакциях, пересылке, голосовых, поиске, профиле диалога и связанных API/типах, чтобы получить точный список регрессий до начала правок.

## Assumptions
- Базовая зона риска находится в `apps/web/components/conversation-view.tsx` и `apps/web/components/chat-shell.tsx`, потому что именно там были крупные merge-конфликты.
- Часть функциональности уже физически присутствует в коде: реакции, пересылка, голосовые, звонки, поиск, group management, presence и typing видны в текущих файлах, значит возможны не полные потери, а частичные затирки UI, поведения, wiring или стилей.
- Ключевые ориентиры для сравнения есть в истории ветки: `1f91784` (пересылка и реакции), `336b82a` (реакции по ховеру), `29902c2` (restore message actions), `84b1c0a` (realtime и звонки), `9a07e87` и `85f43e9` (UI/chat layout перед merge).
- Цель этой задачи не чинить сразу, а сначала собрать полный audit-список потерь с привязкой к коммитам, файлам и уровню риска.

## Plan
### Phase 1: Зафиксировать контрольные точки сравнения
- Собрать список коммитов, которые вводили или заметно меняли chat UX и message UX.
- Разделить историю на смысловые блоки:
  - сообщения и действия над сообщениями;
  - реакции;
  - reply/edit/forward;
  - голосовые и вложения;
  - поиск в чатах и сообщениях;
  - realtime/presence/typing;
  - профиль диалога и правые панели;
  - group management;
  - звонки и call UI.
- Для каждого блока выписать “эталонный” коммит, где поведение точно было.
- Output / exit criterion:
  - есть таблица вида `feature -> эталонный commit -> ключевые файлы`.

### Phase 2: Сравнить текущее состояние с эталонными коммитами
- Снять diff между `HEAD` и ключевыми коммитами по:
  - `apps/web/components/conversation-view.tsx`
  - `apps/web/components/chat-shell.tsx`
  - `apps/web/lib/message-cache.ts`
  - `apps/web/lib/utils.ts`
  - `apps/web/types/api.ts`
  - связанным backend-файлам chat/message/realtime при необходимости.
- Не ограничиваться строковым поиском: отдельно смотреть, остались ли:
  - state/hooks;
  - mutation/query wiring;
  - кнопки и доступ к действиям в UI;
  - `data-testid`, если на них завязаны тесты;
  - helper-функции и типы;
  - классы/разметка, без которых фича “есть в коде, но не видна”.
- Для каждой найденной разницы помечать тип:
  - `полностью пропало`;
  - `логика есть, UI пропал`;
  - `UI есть, mutation/API wiring пропал`;
  - `поведение есть, но стало недоступно из-за layout/hover/overlay`;
  - `типизация/API разошлись`.
- Output / exit criterion:
  - есть черновой список всех подозрительных отклонений между текущим кодом и эталонами.

### Phase 3: Проверить самые вероятные затирки в `conversation-view.tsx`
- Отдельно пройти по message actions:
  - reply;
  - edit;
  - delete;
  - forward;
  - quick reactions;
  - existing reaction chips;
  - voice recorder;
  - attachment previews;
  - search in messages;
  - call panel;
  - profile side panel.
- Проверить не только наличие кода, но и доступность триггера:
  - показывается ли action only on hover;
  - не перекрыт ли action новым layout;
  - не изменились ли условия `isMine`, `isDeleted`, `group-hover`, `pointer-events`;
  - не исчез ли один из путей открытия модалки/панели.
- Сверить текущую реализацию с коммитами:
  - `1f91784`
  - `336b82a`
  - `29902c2`
  - `84b1c0a`
  - `9a07e87`
  - `85f43e9`
- Output / exit criterion:
  - составлен список конкретных регрессий внутри `conversation-view.tsx` с указанием, что именно затерлось и в каком коммите это точно было.

### Phase 4: Проверить возможные затирки в `chat-shell.tsx`
- Сверить:
  - global search;
  - group composer;
  - delete/leave chat flows;
  - socket presence sync;
  - typing state;
  - notifications flags;
  - sidebar drawer/profile entrypoints;
  - chat list badges and actions;
  - связь с layout provider/resizable panels, если они ожидались после merge.
- Отдельно проверить, не была ли потеряна логика, которая существовала в одной ветке, но визуально неочевидна:
  - синхронизация current chat;
  - join room/rejoin room;
  - invalidation query cache после realtime events;
  - переходы после create/delete/leave.
- Output / exit criterion:
  - есть отдельный список регрессий/рисков по `chat-shell.tsx`.

### Phase 5: Проверить связанную контрактную часть
- Сопоставить web и api по изменениям, которые могли сделать UI “формально живым, но реально сломанным”:
  - `apps/web/types/api.ts`
  - `apps/web/lib/message-cache.ts`
  - `apps/web/lib/utils.ts`
  - backend DTO/service/controller изменения вокруг message visibility, delete/edit/reaction/forward/search.
- Проверить, не ушли ли из web:
  - новые поля `ChatMessage`;
  - reactions shape;
  - attachments shape;
  - reply metadata;
  - unread/current role/group permissions;
  - call/realtime payload support.
- Output / exit criterion:
  - выявлены расхождения типов и контрактов, которые могли маскироваться под “затертый UI”.

### Phase 6: Прогнать поведенческий аудит по сценариям
- Собрать checklist ручной проверки в dev:
  - открыть чат;
  - навести на чужое сообщение;
  - навести на свое сообщение;
  - поставить реакцию;
  - снять реакцию;
  - открыть reply/edit/forward/delete;
  - записать голосовое;
  - открыть поиск по сообщениям;
  - открыть profile panel;
  - открыть group members;
  - открыть global search;
  - инициировать call UI;
  - проверить unread/presence/typing.
- Для каждого сценария фиксировать один из статусов:
  - `ok`;
  - `частично сломано`;
  - `не открывается`;
  - `визуально есть, но не работает`;
  - `не хватает backend/contract`.
- Output / exit criterion:
  - есть воспроизводимый список проблем по реальному UI, а не только по diff.

### Phase 7: Сформировать итоговый реестр затерок
- Собрать финальный документ в формате:
  - feature;
  - текущее состояние;
  - где найдено;
  - эталонный commit;
  - тип потери;
  - серьезность;
  - что нужно восстановить.
- Отдельно выделить:
  - критичные пользовательские потери;
  - визуальные потери;
  - скрытые технические расхождения;
  - сомнительные места, которые требуют подтверждения через UI.
- Output / exit criterion:
  - есть финальный backlog на восстановление, упорядоченный по риску и трудоемкости.

## Risks and Dependencies
- Самая вероятная ловушка: фича может “быть в файле”, но быть недоступной из-за нового layout, overlay, hover-state или смены условий рендера.
- Merge мог не удалить код целиком, а разорвать связку между UI, mutation, cache update и backend contract.
- Если проверять только `conversation-view.tsx`, можно пропустить затерки в utils/types/cache, которые ломают поведение косвенно.
- Без привязки к коммитам audit получится субъективным; поэтому сравнение надо вести от известных feature-коммитов.
- Часть различий может оказаться не затиркой, а осознанным merge-компромиссом; такие случаи нужно маркировать отдельно, а не автоматически восстанавливать.

## Next Actions
- Собрать таблицу `feature -> commit -> file`, начиная с реакций, reply/edit/forward, voice, search, calls и profile panel.
- Снять targeted diff текущего `HEAD` против `1f91784`, `336b82a`, `29902c2`, `84b1c0a`, `9a07e87`, `85f43e9`.
- Сразу после audit сделать отдельный список “точно затерлось” и “нужно проверить руками”, чтобы не смешивать факты и гипотезы.

## Initial Audit Findings
### Confirmed losses
- `conversation-view.tsx`: затерт отдельный message context menu, который был в `85f43e9`.
  - В старом варианте были `MessageContextMenuState`, `openMessageContextMenu`, `createPortal`, `MessageContextMenuRow`, быстрые реакции в контекстном меню, copy/pin/select и timestamp footer.
  - В текущем `HEAD` это отсутствует; остался только hover-набор действий и обычный confirm на удаление.
- `conversation-view.tsx`: затерта продвинутая схема удаления сообщения.
  - Ранее использовался `DeleteMessageDialog` с выбором `self/everyone`.
  - Сейчас файл импортирует только `ConfirmDialog`, а удаление сообщения сведено к одному confirm без выбора режима.
  - Дополнительно подтверждено, что backend DTO `apps/api/src/chat/dto/delete-message.dto.ts` все еще поддерживает `mode?: "self" | "everyone"`, то есть потеря находится именно во фронтовом wiring.
- `chat-shell.tsx`: затерт UI-блок realtime/notifications в drawer-панели.
  - В `85f43e9` были `connectionStatusCopy`, `notificationStatusCopy`, кнопка запроса разрешения и переключатель уведомлений.
  - В текущем `HEAD` состояние уведомлений и методы еще есть, но связанный render-блок не найден, то есть логика осталась, а пользовательский control surface пропал.

### Confirmed still present
- Базовые реакции не затерлись.
  - В текущем `conversation-view.tsx` есть `toggleReactionMutation`, `message-reaction-picker`, `quick-reaction-button` и `message-reaction-chip`.
- Пересылка и голосовые тоже присутствуют.
  - В текущем `conversation-view.tsx` есть `forward-message-modal` и `voice-recorder-panel`.
- Правая профильная панель, `Gift` tile, resize правой панели и split layout в текущем `HEAD` есть.

### Current priority classification
- `P1`: вернуть контекстное меню сообщения.
- `P1`: вернуть удаление сообщения с выбором `у себя / у всех`.
- `P2`: вернуть видимый notifications/realtime control block в `chat-shell`, либо сознательно удалить мертвую логику, если фича больше не нужна.
- `P3`: отдельно вручную проверить, не пострадали ли hover-state у message actions после замены context menu на hover controls.
