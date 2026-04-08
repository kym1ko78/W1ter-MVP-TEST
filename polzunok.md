## Goal
Сделать scrollbar в чат-зонах черно-белым, полупрозрачным, более минималистичным и убрать стрелки по краям.

## Assumptions
- Меняем только кастомный scrollbar для `.scroll-region-y`.
- Зоны применения остаются те же:
  - список сообщений
  - список чатов
  - результаты поиска
- Системный root-scroll не трогаем.
- Нужна поддержка:
  - Chrome / Edge / Safari через `::-webkit-scrollbar`
  - Firefox через `scrollbar-width` и `scrollbar-color`

## Current State
Сейчас в [globals.css](C:\Users\User\Desktop\Project\apps\web\app\globals.css):
- у `.scroll-region-y` уже есть кастомный scrollbar
- thumb сейчас в теплой акцентной палитре
- track мягкий, но не монохромный
- стрелки браузерного scrollbar визуально еще могут появляться в WebKit/Windows

## Plan
### Phase 1: Перевести scrollbar в монохромную палитру
- Заменить текущие accent-цвета на черно-белую полупрозрачную схему.
- Подготовить отдельные переменные:
  - базовый track
  - базовый thumb
  - hover thumb
- Пример направления:
  - track: почти прозрачный бело-серый
  - thumb: полупрозрачный темно-серый
  - hover: чуть контрастнее, но без “черной палки”
- Output / exit criterion:
  - scrollbar больше не выглядит теплым/оранжевым

### Phase 2: Сделать thumb более минималистичным
- Оставить тонкий размер scrollbar.
- Убрать излишнюю декоративность:
  - сделать однотонный или почти однотонный thumb
  - при желании оставить очень мягкий градиент в серых тонах, но лучше начать с плоского цвета
- Сохранить:
  - скругление
  - прозрачную рамку для “внутреннего воздуха”
- Output / exit criterion:
  - thumb выглядит легче и чище

### Phase 3: Убрать стрелки по краям в WebKit
- Добавить стили для:
  - `.scroll-region-y::-webkit-scrollbar-button`
- Скрыть их через:
  - `display: none`
  - при необходимости `width: 0`, `height: 0`
- Проверить, что после этого scrollbar не ломается на Windows/Edge.
- Output / exit criterion:
  - стрелки сверху и снизу больше не показываются

### Phase 4: Синхронизировать Firefox-версию
- Обновить `scrollbar-color` под новую монохромную схему.
- Принять, что Firefox будет чуть менее кастомным, чем WebKit.
- Главное:
  - черно-белая палитра
  - аккуратная полупрозрачность
- Output / exit criterion:
  - Firefox визуально идет в ту же сторону, что и Chrome/Edge

### Phase 5: Проверить все scroll-зоны
- Проверить:
  - `message-list`
  - `chat-list`
  - `user-search-results`
- Убедиться, что новый scrollbar:
  - не слишком яркий
  - не спорит с bubble и карточками
  - не выглядит как тяжелая черная полоса
- Output / exit criterion:
  - один стиль подходит всем трем зонам

### Phase 6: Проверить поведение на светлом фоне
- Так как фон интерфейса светлый, важно не переборщить с контрастом.
- Подобрать баланс:
  - thumb заметен
  - track почти растворяется
  - hover немного усиливается, но не становится грубым
- Output / exit criterion:
  - scrollbar читается, но не перетягивает внимание

## Testing and Validation
- Проверить список сообщений:
  - scrollbar черно-белый
  - полупрозрачный
  - без стрелок
- Проверить список чатов
- Проверить результаты поиска
- Проверить hover в Edge/Chrome
- Проверить Firefox
- Проверить mobile width:
  - scroll behavior не ломается
- Прогнать:
  - `pnpm --filter @repo/web typecheck`
  - `pnpm verify:web`
  - при необходимости `pnpm test:ui:e2e:auto`

## Risks and Dependencies
- Риск: слишком темный thumb будет смотреться грубо на светлом фоне.
- Mitigation:
  - держать thumb полупрозрачным и не делать чисто черным.

- Риск: `::-webkit-scrollbar-button` может вести себя чуть по-разному в разных браузерах.
- Mitigation:
  - скрывать кнопки минимальным набором правил и проверить в Edge.

- Риск: слишком прозрачный thumb станет плохо заметен.
- Mitigation:
  - оставить умеренный hover-state.

## Next Actions
- Обновить scrollbar-переменные в [globals.css](C:\Users\User\Desktop\Project\apps\web\app\globals.css)
- Убрать `::-webkit-scrollbar-button`
- Проверить scroll-зоны в чате
- Прогнать web-проверки