## Goal
Стилизовать правый скроллбар так, чтобы он выглядел аккуратно и в духе интерфейса мессенджера, а не как системный серый ползунок.

## Assumptions
- Стилизуем в первую очередь scroll-контейнеры с классом `scroll-region-y`.
- Основные зоны:
  - список сообщений
  - список чатов
  - результаты поиска пользователей
- Не трогаем системный скроллбар всей страницы, потому что root scroll у чата уже заблокирован.
- Нужна кроссбраузерная базовая поддержка:
  - Chrome / Edge / Safari через `::-webkit-scrollbar`
  - Firefox через `scrollbar-width` и `scrollbar-color`

## Current State
- В [globals.css](C:\Users\User\Desktop\Project\apps\web\app\globals.css) для `.scroll-region-y` сейчас есть только поведение скролла:
  - `overscroll-behavior-y: contain`
  - `touch-action: pan-y`
  - `-webkit-overflow-scrolling: touch`
- В [conversation-view.tsx](C:\Users\User\Desktop\Project\apps\web\components\conversation-view.tsx) `message-list` уже использует `scroll-region-y`.
- В [chat-shell.tsx](C:\Users\User\Desktop\Project\apps\web\components\chat-shell.tsx) `chat-list` и `user-search-results` тоже используют `scroll-region-y`.
- Значит стилизация может быть централизована через один общий CSS-класс.

## Plan
### Phase 1: Выбрать визуальное направление скроллбара
- Определить, каким должен быть ползунок:
  - тоньше системного
  - мягко скругленный
  - в теплой палитре текущего UI
  - с ненавязчивым треком
- Подобрать цвета из уже существующей темы:
  - `--accent`
  - `--accent-strong`
  - `--line`
  - светлый трек под фон панелей
- Решить поведение hover:
  - обычное состояние спокойное
  - при наведении thumb становится чуть контрастнее
- Output / exit criterion:
  - есть согласованный набор размеров и цветов для track/thumb

### Phase 2: Добавить базовые CSS-переменные для scrollbar
- В [globals.css](C:\Users\User\Desktop\Project\apps\web\app\globals.css) завести отдельные переменные под scrollbar:
  - ширина
  - цвет track
  - цвет thumb
  - hover-цвет thumb
- Не смешивать их с общими background/accent-переменными без явного названия.
- Output / exit criterion:
  - стилизация scrollbar управляется через отдельные понятные переменные

### Phase 3: Стилизовать `.scroll-region-y` для WebKit-браузеров
- Добавить в [globals.css](C:\Users\User\Desktop\Project\apps\web\app\globals.css):
  - `.scroll-region-y::-webkit-scrollbar`
  - `.scroll-region-y::-webkit-scrollbar-track`
  - `.scroll-region-y::-webkit-scrollbar-thumb`
  - `.scroll-region-y::-webkit-scrollbar-thumb:hover`
- Настроить:
  - узкую ширину
  - скругление thumb
  - прозрачный или мягкий track
  - небольшой внутренний отступ через border/background-clip, если понадобится визуально “утопить” thumb
- Output / exit criterion:
  - в Chrome/Edge/Safari системный серый scrollbar заменен на кастомный

### Phase 4: Добавить Firefox-совместимость
- Для `.scroll-region-y` добавить:
  - `scrollbar-width: thin`
  - `scrollbar-color: thumb track`
- Понять, что Firefox не даст такой же точный контроль, как WebKit, поэтому задача тут:
  - не полное совпадение
  - а аккуратная цветовая интеграция
- Output / exit criterion:
  - в Firefox scrollbar тоже выглядит тематически, а не полностью системно-серым

### Phase 5: Проверить визуальный баланс по зонам
- Проверить, как один и тот же scrollbar выглядит в:
  - `message-list`
  - `chat-list`
  - `user-search-results`
- Если один общий стиль везде хорош, оставить единый подход.
- Если сообщение-список визуально требует более мягкий вариант, рассмотреть второй modifier-класс, но только если реально нужен.
- Output / exit criterion:
  - scrollbar выглядит уместно во всех scroll-зонах без лишней сложности в коде

### Phase 6: Проверить взаимодействие с текущим no-swipe lock
- Убедиться, что новая стилизация не ломает:
  - `overscroll-behavior-y: contain`
  - `touch-action: pan-y`
  - mobile scrolling
- Особенно проверить, что scrollbar-стили не влияют на сам факт внутреннего скролла в `message-list`.
- Output / exit criterion:
  - scroll behavior остается прежним, меняется только внешний вид

### Phase 7: Довести детали под текущий UI
- Проверить:
  - не слишком ли контрастный scrollbar на светлом фоне
  - не выглядит ли он слишком “браузерным”
  - не перетягивает ли внимание на себя
- При необходимости:
  - уменьшить насыщенность
  - осветлить трек
  - сделать thumb уже или мягче
- Output / exit criterion:
  - scrollbar заметен, но не спорит с сообщениями и карточками

## Testing and Validation
- Проверить список сообщений:
  - scrollbar стилизован
  - прокрутка работает как раньше
- Проверить список чатов:
  - scrollbar тоже стилизован
  - hover выглядит аккуратно
- Проверить результаты поиска пользователей
- Проверить Chrome / Edge
- Проверить Firefox
- Проверить mobile width:
  - поведение не ломается
  - scrollbar не мешает касанию
- Прогнать:
  - `pnpm --filter @repo/web typecheck`
  - `pnpm verify:web`
  - при необходимости `pnpm test:ui:e2e:auto`

## Risks and Dependencies
- Риск: слишком заметный thumb будет визуально дешевить интерфейс.
- Mitigation:
  - делать track почти невидимым, а thumb мягким и узким.

- Риск: Firefox будет выглядеть иначе, чем Chrome/Edge.
- Mitigation:
  - принять упрощенную, но тематическую стилизацию через `scrollbar-color`.

- Риск: глобальная стилизация может случайно затронуть лишние scrollable элементы.
- Mitigation:
  - стилизовать только `.scroll-region-y`, а не все `*::-webkit-scrollbar`.

- Риск: на маленьких экранах слишком тонкий scrollbar станет неудобным.
- Mitigation:
  - не делать экстремально тонкий размер; оставить баланс между эстетикой и usability.

## Next Actions
- Добавить scrollbar-переменные в [globals.css](C:\Users\User\Desktop\Project\apps\web\app\globals.css)
- Стилизовать `.scroll-region-y` для WebKit и Firefox
- Проверить `message-list`, `chat-list`, `user-search-results`
- При необходимости чуть подправить оттенки под ваш текущий теплый интерфейс