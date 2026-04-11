## Goal
Исправить текущую анимацию переключения между микрофоном и кнопкой отправки в composer так, чтобы иконки больше не накладывались друг на друга и переход выглядел аккуратно.

## Assumptions
- Проблема находится в [conversation-view.tsx](C:\Users\User\Desktop\Project\apps\web\components\conversation-view.tsx).
- Сейчас `mic` и `send` живут в одном action-slot и анимируются через overlap.
- Из-за текущих `opacity/scale/rotate` обе кнопки визуально пересекаются в переходный момент.
- Нужно сохранить идею “send появляется из mic”, но сделать это чище.

## Plan
### Phase 1: Зафиксировать текущую причину наложения
- Проверить текущий action-slot:
  - две кнопки `absolute inset-0`
  - одинаковая геометрия
  - одновременный transition
- Подтвердить, что иконки конфликтуют, потому что:
  - обе видны в один момент
  - одна еще не ушла, а вторая уже появилась
- Output / exit criterion:
  - понятно, какой именно transition дает визуальную кашу

### Phase 2: Выбрать более чистую модель перехода
- Сохранить один общий slot.
- Но развести фазы анимации:
  - сначала старая кнопка быстрее уходит
  - потом новая кнопка появляется с короткой задержкой
- Либо уменьшить overlap так, чтобы на экране почти не было двух видимых иконок одновременно.
- Output / exit criterion:
  - выбран переход без видимого смешивания двух glyph-слоев

### Phase 3: Развести анимации mic и send
- Подправить:
  - `opacity`
  - `scale`
  - `rotate`
  - при необходимости `transition-delay`
- Сделать так, чтобы:
  - hidden button исчезала почти полностью до появления второй
  - active button входила из той же точки, но после очистки сцены
- Output / exit criterion:
  - иконки больше не склеиваются визуально

### Phase 4: Сохранить интерактивность
- Проверить:
  - `pointer-events`
  - `tabIndex`
  - `disabled`
  - `aria-label`
- Убедиться, что скрытая кнопка не кликается и не получает фокус.
- Output / exit criterion:
  - визуальный и интерактивный слои снова согласованы

### Phase 5: Проверить все состояния composer
- Проверить переходы:
  - пустое поле -> mic
  - начинаем печатать -> send
  - очищаем текст -> mic
  - pending send
  - attach without text
- Убедиться, что transition чистый во всех сценариях.
- Output / exit criterion:
  - проблема исчезла не только в одном моменте, а во всем цикле composer

## Risks and Dependencies
- Риск: если полностью убрать overlap, переход снова будет выглядеть как простая подмена.
- Mitigation:
  - оставить один slot и center-origin, но уменьшить одновременную видимость слоев.

- Риск: слишком сильные задержки сделают кнопку “тормозной”.
- Mitigation:
  - использовать короткий stagger, а не длинную паузу.

## Next Actions
- Подправить action-slot в [conversation-view.tsx](C:\Users\User\Desktop\Project\apps\web\components\conversation-view.tsx)
- Уменьшить overlap между `voice-message-button` и `send-message-button`
- Прогнать `pnpm --filter @repo/web typecheck` и `pnpm verify:web`
