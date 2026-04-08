## Objective
Перенести действие удаления чата из header открытого диалога в левую колонку, внутрь блока `Ваши чаты`, чтобы удаление относилось к конкретной карточке чата в списке и воспринималось как действие над самим элементом списка.

## Assumptions
- Проект пока работает с `DIRECT` чатами.
- Удаление должно остаться подтверждаемым через `confirm`.
- Удалять чат по-прежнему может участник этого чата.
- Основная логика delete chat на backend уже реализована; меняем в первую очередь placement и UX.
- Текущий header-кнопку удаления в [conversation-view.tsx](C:\Users\User\Desktop\Project\apps\web\components\conversation-view.tsx) нужно убрать, чтобы не было дублирования.

## Architecture / Approach
Переносим точку входа удаления в [chat-shell.tsx](C:\Users\User\Desktop\Project\apps\web\components\chat-shell.tsx), потому что именно там рендерится список `Ваши чаты`.

Новая модель UX:
- у каждой карточки чата появляется локальное действие удаления
- удаление вызывается из sidebar
- после удаления:
  - чат исчезает из списка
  - если он был открыт, роут уходит на `/chat`
  - правый экран корректно очищается

## Plan

### Phase 1: Зафиксировать новый UX для delete action
- Выбрать, как именно выглядит действие удаления внутри списка чатов:
  - маленькая иконка/текстовая кнопка в правом верхнем углу карточки
  - либо action, появляющийся только на hover active item
- Для текущего интерфейса безопаснее сделать ненавязчивую кнопку в самой карточке, но не в центре контента.
- Сохранить визуальный приоритет чата, а не действия удаления.
- Output / exit criterion:
  - есть понятное место для delete action внутри карточки чата

### Phase 2: Перенести delete chat mutation в sidebar-слой
- Если delete mutation сейчас живет только в [conversation-view.tsx](C:\Users\User\Desktop\Project\apps\web\components\conversation-view.tsx), перенести его в [chat-shell.tsx](C:\Users\User\Desktop\Project\apps\web\components\chat-shell.tsx)
- Это логично, потому что:
  - список чатов уже управляется в `ChatShell`
  - cache для `chats` уже находится там
  - после удаления именно sidebar должен первым обновиться
- Output / exit criterion:
  - delete chat управляется там, где рендерится список чатов

### Phase 3: Добавить delete action в карточку чата
- Для каждого `chat-list-item` добавить кнопку удаления.
- Убедиться, что клик по кнопке удаления:
  - не активирует переход по `Link`
  - не открывает чат случайно
- Для этого нужно:
  - остановить всплытие
  - отменить стандартный переход ссылки
- Output / exit criterion:
  - удаление можно вызвать прямо из карточки, не открывая чат заново

### Phase 4: Убрать delete button из header диалога
- В [conversation-view.tsx](C:\Users\User\Desktop\Project\apps\web\components\conversation-view.tsx) удалить текущую кнопку `Удалить чат` из header.
- Сохранить в header только статус/тип чата и основную информацию о собеседнике.
- Output / exit criterion:
  - delete chat больше не дублируется в двух местах

### Phase 5: Сохранить корректный post-delete flow
- После удаления чата из sidebar:
  - удалить его из query cache `chats`
  - убрать query для `chat/:id` и `messages/:id`
  - если это был активный чат, сделать redirect на `/chat`
- Проверить сценарий:
  - удаляем открытый чат
  - удаляем неоткрытый чат
- Output / exit criterion:
  - интерфейс стабильно переживает удаление чата из списка

### Phase 6: Довести визуальное поведение в sidebar
- Проверить, как delete action выглядит в состояниях:
  - обычная карточка
  - active карточка
  - hover
  - mobile width
- Не допустить, чтобы кнопка ломала time stamp, unread badge или preview последнего сообщения.
- При необходимости:
  - сделать action компактнее
  - показать его только при hover/active
  - оставить текстовую кнопку только на мобильном fallback
- Output / exit criterion:
  - delete action читаем и доступен, но не перегружает карточку

### Phase 7: Обновить тесты под новый placement
- Обновить UI e2e в [chat-flow.spec.ts](C:\Users\User\Desktop\Project\tests\playwright\chat-flow.spec.ts):
  - удаление чата теперь идет из sidebar, а не из header conversation
- Если есть точечные `data-testid`, переназначить их так, чтобы тест находил delete action внутри `chat-list-item`.
- Output / exit criterion:
  - автотесты знают новый UX путь удаления чата

## Testing and Validation
- Удалить активный чат из списка `Ваши чаты`
- Удалить неактивный чат из списка
- Проверить, что клик по delete button не открывает карточку как ссылку
- Проверить, что после удаления:
  - чат исчезает из списка
  - если чат был открыт, экран уходит на `/chat`
- Проверить desktop и mobile width
- Прогнать:
  - `pnpm --filter @repo/web typecheck`
  - `pnpm verify:web`
  - `pnpm test:ui:e2e:auto`

## Risks and Dependencies
- Риск: delete button внутри `Link` будет открывать чат вместо удаления.
- Mitigation:
  - останавливать событие и отменять default navigation.

- Риск: карточка станет визуально перегруженной.
- Mitigation:
  - сделать action компактным и вторичным по визуальному весу.

- Риск: после удаления активного чата UI останется на битом route.
- Mitigation:
  - явно redirect на `/chat` и чистка cache/query.

## Next Actions
- Перенести delete chat mutation в sidebar-слой
- Добавить delete action в карточку chat list item
- Убрать delete button из header диалога
- Обновить UI e2e под новый путь удаления