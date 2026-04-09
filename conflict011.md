## Goal
Сделать так, чтобы при удалении сообщение полностью исчезало из переписки, без placeholder-текста `Сообщение удалено`.

## Assumptions
- Backend остается на soft delete, чтобы не ломать историю, права и realtime.
- Меняем только frontend-поведение списка сообщений и клиентского кеша.
- Sidebar preview уже берет последнее не удаленное сообщение, поэтому отдельной сложной логики там не требуется.

## Plan
### Phase 1: Убрать deleted-state bubble из UI
- Удалить из `conversation-view.tsx` ветку рендера с текстом `Сообщение удалено`.
- Оставить список сообщений только для видимых сообщений.
- Output / exit criterion:
  - удаленное сообщение не отображается в истории вообще.

### Phase 2: Удалять deleted messages из query cache
- Обновить `message-cache.ts`, чтобы `normalizeMessagePage` и `upsertMessage` выкидывали сообщения с `isDeleted/deletedAt`.
- Это обеспечит исчезновение и после ручного delete, и после realtime update.
- Output / exit criterion:
  - cache больше не хранит удаленные сообщения как видимые элементы списка.

### Phase 3: Проверить разделители дат и соседние сообщения
- Убедиться, что после удаления не остаются лишние date separators без сообщений под ними.
- Проверить удаление последнего сообщения дня и единственного сообщения в чате.
- Output / exit criterion:
  - история остается визуально чистой после удаления.

### Phase 4: Обновить UI e2e
- Изменить `chat-flow.spec.ts` так, чтобы тест ждал исчезновения удаленного текста, а не placeholder.
- Проверить, что после delete сообщение пропадает у обоих участников.
- Output / exit criterion:
  - e2e отражает новое поведение.

## Risks and Dependencies
- Риск: удаленное сообщение исчезнет из списка, но временно останется в кеше до invalidation.
- Mitigation:
  - убирать deleted messages прямо в `upsertMessage` и `normalizeMessagePage`.

- Риск: при удалении последнего сообщения чат покажет пустую дату.
- Mitigation:
  - строить render-list только по уже отфильтрованным сообщениям.

## Next Actions
- Удалить deleted bubble из `conversation-view.tsx`.
- Отфильтровать deleted messages в `message-cache.ts`.
- Обновить `chat-flow.spec.ts`.
- Прогнать web-checks.
