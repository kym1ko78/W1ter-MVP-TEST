## Goal
Исправить action-slot composer так, чтобы иконка отправки в неактивном состоянии исчезала полностью и не просвечивала/не оставалась за микрофоном.

## Assumptions
- Проблема находится в [conversation-view.tsx](C:\Users\User\Desktop\Project\apps\web\components\conversation-view.tsx).
- Сейчас mic и send живут в одном overlapping-slot.
- У send-кнопки в скрытом состоянии остаются визуальные следы:
  - остаточная иконка
  - фон
  - часть силуэта
- Нужно сохранить красивый transition, но гарантировать, что в каждый момент времени визуально читается только одна кнопка.

## Plan
### Phase 1: Зафиксировать источник остаточного слоя
- Проверить текущие hidden-state классы send-кнопки:
  - `opacity`
  - `scale`
  - `rotate`
  - `pointer-events`
- Убедиться, что сам элемент остается в DOM и занимает тот же absolute-slot.
- Определить, за счет чего send все еще видна:
  - opacity не падает до полностью незаметного эффекта
  - transform оставляет силуэт в пределах круга
  - у кнопки остается видимый background/glyph в transition-моменте
- Output / exit criterion:
  - точно понятно, почему send визуально “живет” за mic

### Phase 2: Разделить видимость слоя и morph-эффект
- Оставить идею одного action-slot.
- Но сделать так, чтобы скрытая кнопка:
  - полностью теряла видимость
  - не читалась как подложка
- Для этого рассмотреть:
  - `opacity-0` + сильнее уменьшенный `scale`
  - `visibility: hidden`
  - `pointer-events-none`
  - а при необходимости и `display`-подобную стратегию через delayed mount/unmount не применять, если можно решить проще
- Output / exit criterion:
  - скрытая send-кнопка реально перестает быть видимой

### Phase 3: Подправить hidden-state send-кнопки
- Ужесточить скрытое состояние send:
  - еще меньший scale
  - возможно более сильный translate/offset
  - более быстрый fade-out
- При необходимости уменьшить overlap-окно:
  - send появляется только когда mic уже почти ушел
  - send исчезает раньше при обратном переходе
- Output / exit criterion:
  - за микрофоном больше не виден темный кружок или иконка отправки

### Phase 4: Проверить обратный переход
- Проверить не только `mic -> send`, но и `send -> mic`.
- Убедиться, что при очистке текста:
  - send действительно исчезает полностью
  - mic возвращается чисто
  - нет остаточного черного фона под микрофоном
- Output / exit criterion:
  - обе стороны перехода чистые

### Phase 5: Сохранить доступность и интерактивность
- Скрытая send-кнопка не должна:
  - получать фокус
  - ловить клики
  - мешать hover-стилям mic
- Проверить:
  - `tabIndex`
  - `pointer-events`
  - disabled state
- Output / exit criterion:
  - скрытая send-кнопка не существует для пользователя ни визуально, ни интерактивно

## Risks and Dependencies
- Риск: если слишком резко скрыть send, transition станет грубым.
- Mitigation:
  - оставить короткий center-origin transition, но убрать остаточную видимость hidden-state.

- Риск: при чрезмерном scale-down кнопка будет “проваливаться” некрасиво.
- Mitigation:
  - подбирать скрытое состояние так, чтобы оно было невидимым, но не ломало общее ощущение morph.

## Next Actions
- Подправить hidden-state send-кнопки в [conversation-view.tsx](C:\Users\User\Desktop\Project\apps\web\components\conversation-view.tsx)
- Проверить оба перехода: `mic -> send` и `send -> mic`
- Прогнать `pnpm --filter @repo/web typecheck` и `pnpm verify:web`
