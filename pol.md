## Goal
Полностью убрать видимые стрелки по краям кастомного scrollbar в chat-зонах, чтобы остался только чистый rail и thumb без системных кнопок сверху и снизу.

## Assumptions
- Меняем только scrollbar для `.scroll-region-y`.
- Основные зоны применения:
  - история сообщений
  - список чатов
  - результаты поиска
- Основной целевой браузер для точного поведения: Edge/Chrome на Windows.
- Firefox может вести себя иначе, но там обычно таких стрелок нет в том же виде.

## Current State
Сейчас в [globals.css](C:\Users\User\Desktop\Project\apps\web\app\globals.css):
- scrollbar уже кастомный
- стрелки для `::-webkit-scrollbar-button` уже скрываются базовыми правилами
- но по скриншоту видно, что в текущем Windows/WebKit-рендере часть стрелочных кнопок все еще визуально остается
- значит текущего набора CSS недостаточно, и нужно более жестко сбросить browser-specific scrollbar buttons и связанные pseudo-elements

## Plan
### Phase 1: Подтвердить, какие pseudo-elements еще участвуют
- Проверить текущий набор scrollbar-стилей в [globals.css](C:\Users\User\Desktop\Project\apps\web\app\globals.css).
- Убедиться, что кроме `::-webkit-scrollbar-button` не нужны дополнительные сбросы для:
  - `::-webkit-scrollbar-corner`
  - `::-webkit-resizer`
  - directional button selectors, если браузер их рендерит отдельно
- Output / exit criterion:
  - понятно, какие именно scrollbar pseudo-elements нужно обнулить полностью

### Phase 2: Усилить скрытие scrollbar buttons
- Для `.scroll-region-y` добавить более жесткие правила для `::-webkit-scrollbar-button`:
  - `display: none`
  - `width: 0`
  - `height: 0`
  - `background: transparent`
- Если этого недостаточно, добавить directional selectors:
  - `::-webkit-scrollbar-button:single-button`
  - `::-webkit-scrollbar-button:vertical:decrement`
  - `::-webkit-scrollbar-button:vertical:increment`
- Output / exit criterion:
  - стрелочные области сверху и снизу больше не рисуются

### Phase 3: Сбросить связанные служебные области scrollbar
- Добавить reset для:
  - `::-webkit-scrollbar-corner`
  - `::-webkit-resizer`
- Сделать их невидимыми и нулевого размера там, где это применимо.
- Это важно, чтобы не оставалось темных или светлых “хвостов” около scrollbar.
- Output / exit criterion:
  - кроме rail и thumb в scrollbar больше нет лишних элементов

### Phase 4: Проверить, не остается ли зарезервированная кнопочная высота
- Иногда даже при скрытии кнопки браузер оставляет визуально странные отступы по краям scrollbar.
- Проверить, не нужно ли скорректировать:
  - высоту/отрисовку track
  - внутренние отступы thumb
  - `scrollbar-gutter`
- Output / exit criterion:
  - rail начинается и заканчивается чисто, без намека на кнопки

### Phase 5: Проверить все scroll-зоны
- Проверить:
  - `message-list`
  - `chat-list`
  - `user-search-results`
- Убедиться, что стрелки исчезли везде, а не только в одном контейнере.
- Output / exit criterion:
  - во всех chat-scroll областях отображается одинаковый чистый scrollbar

### Phase 6: Проверить Windows/Edge-специфику
- Так как проблема видна именно на Windows-скриншоте, отдельно проверить Edge/Chrome на Windows.
- Убедиться, что после правки:
  - стрелки не возвращаются
  - rail и thumb сохраняют текущий стиль
- Output / exit criterion:
  - проблема со стрелками закрыта именно в том окружении, где она воспроизводится

## Testing and Validation
- Открыть чат с длинной перепиской
- Проверить scrollbar в списке сообщений
- Проверить scrollbar в списке чатов
- Проверить scrollbar в поиске пользователей
- Убедиться, что:
  - стрелок сверху и снизу нет
  - rail выглядит непрерывным
  - thumb работает как раньше
- Прогнать:
  - `pnpm --filter @repo/web typecheck`
  - `pnpm verify:web`
  - при необходимости `pnpm test:ui:e2e:auto`

## Risks and Dependencies
- Риск: браузер проигнорирует только общий `::-webkit-scrollbar-button` и потребует directional selectors.
- Mitigation:
  - сразу предусмотреть отдельные vertical selectors.

- Риск: после скрытия кнопок останутся пустые зоны по краям rail.
- Mitigation:
  - проверить и при необходимости отдельно скорректировать track/corner/resizer.

- Риск: изменение затронет scrollbar во всех scroll-region зонах и где-то даст неожиданный вид.
- Mitigation:
  - стилизовать только `.scroll-region-y` и проверить все 3 зоны вручную.

## Next Actions
- Проверить текущий scrollbar CSS в [globals.css](C:\Users\User\Desktop\Project\apps\web\app\globals.css)
- Усилить скрытие `::-webkit-scrollbar-button` и directional button pseudo-elements
- Сбросить `corner` и `resizer`, если нужно
- Прогнать web-проверки и визуально убедиться, что стрелки исчезли