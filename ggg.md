## Goal
Исправить поведение composer в [conversation-view.tsx](/C:/Users/User/Desktop/Проект/apps/web/components/conversation-view.tsx), чтобы после успешной отправки сообщения или сохранения редактирования пользователь мог сразу продолжать печатать и отправлять следующее сообщение без повторного клика по полю ввода.

## Assumptions
- Баг воспроизводится в текущем `main`.
- Текущая попытка вернуть фокус уже есть, но она не срабатывает стабильно.
- Наиболее вероятная причина: `focusComposer()` вызывается в момент, когда `textarea` еще `disabled` из-за `isComposerSubmitPending`.
- Дополнительный риск: после submit фокус может забирать кнопка отправки, rerender формы, scroll logic или другой эффект.
- Изменение должно быть точечным: не ломать reply/edit/voice/attachment UX и не менять бизнес-логику отправки.

## Plan
### Phase 1: Подтвердить точную причину потери фокуса
- Проверить последовательность состояний вокруг:
  - `submitComposer`
  - `sendMessageMutation.onSuccess`
  - `editMessageMutation.onSuccess`
  - `isComposerSubmitPending`
  - `textarea disabled`
- Подтвердить, что текущий `focusComposer()` вызывается слишком рано:
  - либо до снятия `disabled`
  - либо до завершения rerender
  - либо после этого фокус перехватывается другим элементом
- Проверить отдельно два сценария:
  - обычная отправка сообщения
  - сохранение редактирования
- Output / exit criterion:
  - понятна конкретная причина, почему текущий `focusComposer()` не дает нужного UX

### Phase 2: Выбрать устойчивую стратегию возврата фокуса
- Сравнить 2 безопасных подхода:
  - вызывать фокус не прямо в `onSuccess`, а через `useEffect`, который реагирует на переход `isComposerSubmitPending: true -> false`
  - или ставить флаг `shouldRefocusComposerRef`, а затем фокусировать поле после снятия `disabled`
- Предпочесть стратегию, которая:
  - не зависит от тайминга конкретного mutation callback
  - одинаково работает для send и edit
  - не ломается на медленном UI/rerender
- Output / exit criterion:
  - выбрана одна централизованная стратегия refocus, а не разрозненные вызовы `focus()`

### Phase 3: Ввести явный механизм “refocus after submit”
- Добавить отдельный ref или state, например:
  - `shouldRefocusComposerRef`
  - или `pendingComposerFocus`
- Перед отправкой и перед сохранением редактирования помечать, что после завершения операции поле нужно вернуть в активное состояние.
- После завершения pending-состояния:
  - проверить, что `textarea` существует
  - проверить, что `textarea` больше не `disabled`
  - вернуть фокус
  - поставить каретку в конец
  - сбросить флаг refocus
- Output / exit criterion:
  - composer reliably refocuses именно после завершения submit flow

### Phase 4: Сохранить корректное поведение для reply/edit/voice
- Убедиться, что новый refocus не ломает:
  - режим ответа
  - режим редактирования
  - голосовые сообщения
  - блокировку composer во время записи
  - очистку вложений
- Проверить, что сценарии работают логично:
  - после обычной отправки поле пустое и готово к следующему сообщению
  - после сохранения edit поле пустое и доступно для нового текста
  - во время `recordingState !== "idle"` refocus не пытается активировать disabled textarea
- Output / exit criterion:
  - новый механизм фокуса совместим со всеми режимами composer

### Phase 5: Защититься от перехвата фокуса другими UI-элементами
- Проверить, не перехватывают ли фокус:
  - submit button
  - voice/send action button
  - file picker button
  - search/profile side effects
  - scroll/focus effects после обновления сообщений
- Если нужно, сделать focus recovery более устойчивым:
  - `queueMicrotask`
  - `requestAnimationFrame`
  - двойной `requestAnimationFrame`
  - либо effect, который срабатывает уже после DOM update
- Не использовать “магические” таймеры без необходимости.
- Output / exit criterion:
  - фокус остается в поле даже если UI пересобирается и кнопки меняют состояние

### Phase 6: Реализовать с минимальным изменением архитектуры
- Оставить текущие mutation callbacks простыми:
  - очистка draft
  - очистка pending file
  - очистка reply/edit context
  - scroll to bottom / focus message
- Перенести сам момент refocus в один предсказуемый механизм, вместо дублирования логики в нескольких местах.
- Не разбрасывать `textareaRef.current?.focus()` по коду больше, чем нужно.
- Output / exit criterion:
  - решение локализовано и код легче поддерживать

### Phase 7: Проверить UX вручную на реальных сценариях
- Проверить обычную отправку:
  - написать сообщение
  - отправить Enter
  - сразу начать печатать следующее
- Проверить отправку через кнопку:
  - набрать сообщение
  - кликнуть send
  - сразу снова печатать
- Проверить edit flow:
  - открыть редактирование
  - сохранить
  - сразу начать писать новое сообщение
- Проверить reply flow:
  - ответить на сообщение
  - отправить
  - убедиться, что reply context очищается, а фокус остается в поле
- Проверить attachment flow:
  - отправить текст + файл
  - после отправки снова писать без повторного клика
- Проверить, что при voice recording или disabled-state фокус не ведет себя странно
- Output / exit criterion:
  - баг больше не воспроизводится в основных пользовательских сценариях

### Phase 8: Прогнать валидацию и подготовить к коммиту
- Прогнать:
  - `pnpm --filter @repo/web typecheck`
  - при необходимости `pnpm verify:web`
- Просмотреть diff только по [conversation-view.tsx](/C:/Users/User/Desktop/Проект/apps/web/components/conversation-view.tsx)
- Убедиться, что изменение действительно про focus lifecycle, а не про случайные побочные правки
- Output / exit criterion:
  - исправление проверено, локально воспроизводится правильно и готово к коммиту

## Risks and Dependencies
- Риск: фокус будет ставиться в момент, когда textarea еще `disabled`.
  - Mitigation:
  - переносить refocus на этап после снятия `isComposerSubmitPending`.

- Риск: submit button или другой элемент повторно заберет фокус после refocus.
  - Mitigation:
  - использовать refocus через effect или следующий кадр после DOM update, а не только прямой вызов в mutation callback.

- Риск: решение сломает режим voice recording, где composer сознательно disabled.
  - Mitigation:
  - refocus выполнять только если `textarea` существует и реально доступна для ввода.

- Риск: reply/edit контекст очистится корректно, но каретка не окажется в поле.
  - Mitigation:
  - централизовать очистку и refocus в одном стабильном post-submit flow.

## Next Actions
- Подтвердить, что проблема связана с `focusComposer()` во время `disabled` состояния.
- Ввести флаг отложенного refocus и effect, который срабатывает после завершения submit.
- Проверить send/edit/reply/button-click/Enter сценарии и затем закоммитить точечное исправление.
