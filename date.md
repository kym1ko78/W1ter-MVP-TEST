## Goal
Добавить в чат разделители дат между сообщениями так, чтобы при смене календарного дня в истории автоматически появлялась отдельная плашка с датой, как в вашем референсе.

## Assumptions
- Разделители дат нужны только в списке сообщений внутри [conversation-view.tsx](C:\Users\User\Desktop\Project\apps\web\components\conversation-view.tsx).
- Backend менять не нужно: все данные уже приходят с `createdAt`.
- Логика группировки должна идти по локальному календарному дню пользователя, а не по UTC-границе.
- Формат даты нужен дружелюбный для русского интерфейса, например `8 апреля`, `9 апреля`, а при необходимости с годом для старых сообщений.
- Attachment-сообщения, compact bubbles и текущие `data-testid` ломать нельзя.

## Current State
Сейчас в [conversation-view.tsx](C:\Users\User\Desktop\Project\apps\web\components\conversation-view.tsx):
- список сообщений рендерится простым `messageItems.map(...)`
- между сообщениями нет промежуточных service items
- есть только обычные message bubble
- форматирование времени уже вынесено в [utils.ts](C:\Users\User\Desktop\Project\apps\web\lib\utils.ts) через `formatTime`
- значит разделители дат логично строить на frontend из уже загруженного массива сообщений

## Plan
### Phase 1: Определить модель date separator items
- Решить, как представлять date separator в рендере списка:
  - не как отдельное сообщение из API
  - а как frontend-only item, добавляемый в итоговый render list
- Подготовить локальный union/derived structure вида:
  - `message item`
  - `date separator item`
- Это позволит не смешивать доменные данные API с чисто визуальной группировкой.
- Output / exit criterion:
  - есть понятная структура данных для рендера списка с датами

### Phase 2: Добавить утилиты для day grouping и label formatting
- В [utils.ts](C:\Users\User\Desktop\Project\apps\web\lib\utils.ts) добавить helper-утилиты:
  - получение day key из `createdAt`
  - форматирование label для separator
- Day key должен быть стабилен для локального часового пояса пользователя.
- Формат label можно сделать таким:
  - сегодня: при желании `Сегодня`
  - вчера: при желании `Вчера`
  - иначе: `8 апреля`
  - для старых сообщений: `8 апреля 2026`
- Если хотите строгий стиль как на референсе, можно начать без `Сегодня/Вчера`, только с датой.
- Output / exit criterion:
  - есть переиспользуемые функции для определения смены дня и текста separator

### Phase 3: Построить render list с date separators
- В [conversation-view.tsx](C:\Users\User\Desktop\Project\apps\web\components\conversation-view.tsx) заменить прямой `messageItems.map(...)` на вычисление списка render items через `useMemo`.
- Алгоритм:
  - идти по отсортированным сообщениям сверху вниз
  - перед первым сообщением дня добавлять separator
  - если текущий message day key отличается от предыдущего, вставлять новый separator
- Важно:
  - сохранять существующую дедупликацию сообщений
  - не менять поведение read-mark логики
- Output / exit criterion:
  - в render list появляются date separators между разными днями

### Phase 4: Добавить UI date separator
- В [conversation-view.tsx](C:\Users\User\Desktop\Project\apps\web\components\conversation-view.tsx) отрендерить отдельный блок separator между сообщениями.
- Визуальная модель под ваш референс:
  - компактная округлая плашка
  - по центру
  - нейтральный фон
  - ненавязчивый текст
- Проверить, чтобы separator не спорил по стилю с bubble и не выглядел как системная метка.
- Output / exit criterion:
  - date separator визуально читается и органично вписывается в чат

### Phase 5: Сохранить корректный scroll и layout
- Убедиться, что вставка separator items не ломает:
  - `message-list` scroll behavior
  - текущую высоту и spacing сообщений
  - auto-scroll/read logic
- Особое внимание:
  - separator не должен считаться сообщением для логики `lastMessage`
  - separator не должен ломать `data-testid="message-item"`
- Output / exit criterion:
  - список сообщений работает как раньше, просто теперь с датами

### Phase 6: Продумать edge cases
- Проверить сценарии:
  - все сообщения в один день
  - сообщения в два дня
  - сообщения через несколько дней
  - первое сообщение в истории
  - attachment-only message
  - длинная история с множеством дней
- Отдельно проверить случай, когда сообщения приходят realtime и создают новый separator для нового дня.
- Output / exit criterion:
  - date separators появляются только там, где действительно нужна новая дата

### Phase 7: Довести финальный формат даты
- После базовой реализации определить финальный стиль текста separator:
  - только дата: `8 апреля`
  - или с относительными метками `Сегодня/Вчера`
- Проверить консистентность с остальным интерфейсом на русском языке.
- Если будет нужно, сделать формат зависимым от давности сообщения.
- Output / exit criterion:
  - выбран один читаемый и визуально устойчивый формат separator labels

## Testing and Validation
- Проверить чат, где все сообщения в один день:
  - должен быть один separator на этот день
- Проверить чат с сообщениями в разные дни:
  - separator появляется перед первым сообщением каждого нового дня
- Проверить длинную переписку:
  - separator не ломает spacing списка
- Проверить входящие и исходящие сообщения рядом с separator
- Проверить attachment-сообщения около границы дней
- Проверить realtime-сообщение, если оно попадает в новый день
- Прогнать:
  - `pnpm --filter @repo/web typecheck`
  - `pnpm verify:web`
  - `pnpm test:ui:e2e:auto`

## Risks and Dependencies
- Риск: день будет считаться неправильно из-за UTC/local timezone расхождения.
- Mitigation:
  - строить day key через локальную дату, а не через сырой ISO substring.

- Риск: separator случайно вмешается в логику сообщений.
- Mitigation:
  - держать separator как отдельный frontend-only render item, а не как fake message.

- Риск: read logic начнет смотреть не на последнее сообщение, а на последний separator.
- Mitigation:
  - не менять `messageItems` как источник доменной логики; separators строить только для UI.

- Риск: визуально separator окажется слишком заметным или слишком слабым.
- Mitigation:
  - начать с нейтральной компактной плашки и потом подправить по месту.

## Next Actions
- Добавить date-format helpers в [utils.ts](C:\Users\User\Desktop\Project\apps\web\lib\utils.ts)
- Построить derived render list с date separators в [conversation-view.tsx](C:\Users\User\Desktop\Project\apps\web\components\conversation-view.tsx)
- Добавить UI-плашку даты между сообщениями
- Прогнать web-checks и UI e2e