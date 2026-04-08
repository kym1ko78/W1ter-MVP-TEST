## Objective
Исправить поведение длинных исходящих сообщений: bubble должен оставаться прижатым к правой стороне чата и не “отлепляться” от правой стенки при увеличении длины текста.

## Assumptions
- Проблема относится в первую очередь к `outgoing` сообщениям в [conversation-view.tsx](C:\Users\User\Desktop\Project\apps\web\components\conversation-view.tsx).
- Размер шрифта и общая визуальная стилистика пузырьков уже устраивают; нужно исправить именно layout/выравнивание.
- У коротких сообщений текущее поведение правильное и его важно не сломать.
- Для deleted-state bubble и attachment bubble поведение тоже нужно проверить, но ключевой дефект сейчас у длинных text-only сообщений.

## Architecture / Approach
Проблема почти наверняка в сочетании:
- внешнего `flex justify-end`
- внутреннего контейнера с `max-w-*`
- inline/stacked структуры bubble
- и, возможно, дополнительного контейнера `flex items-start gap-2`, который меняет геометрию для своих сообщений

Нужно добиться такой модели:
- весь блок исходящего сообщения занимает доступную ширину строки
- сам bubble внутри него выравнивается вправо
- длинный bubble растет влево, а не смещается в центр

## Plan

### Phase 1: Зафиксировать текущую проблемную геометрию
- Проверить структуру разметки исходящего сообщения в [conversation-view.tsx](C:\Users\User\Desktop\Project\apps\web\components\conversation-view.tsx):
  - outer row
  - wrapper с delete-button
  - bubble container
- Понять, какой именно контейнер сейчас ограничивает выравнивание и оставляет пустое пространство справа.
- Особое внимание уделить случаю, где у своего сообщения рядом есть кнопка `Удалить`.
- Output / exit criterion:
  - найден конкретный контейнер/класс, из-за которого длинный bubble теряет прижатие к правому краю

### Phase 2: Разделить layout incoming и outgoing сообщений
- Для `isMine` и `!isMine` сделать явные разные layout-ветки, если сейчас они слишком сильно делят одну структуру.
- Для исходящих сообщений лучше иметь отдельную схему:
  - строка занимает полную ширину
  - action-кнопка и bubble собираются в блок, который прижат вправо
- Не пытаться решать это только одним `justify-end`, если рядом живет второй элемент вроде delete action.
- Output / exit criterion:
  - исходящий ряд имеет отдельную, предсказуемую геометрию

### Phase 3: Исправить поведение delete-button рядом со своим bubble
- Сейчас у своих сообщений рядом есть кнопка удаления, и она может влиять на общую ширину и смещать bubble.
- Возможные решения:
  - располагать delete action слева от bubble, но внутри right-aligned wrapper фиксированной логики
  - показывать delete action поверх/по hover без участия в основном потоке
  - показывать action absolutely внутри строки, чтобы он не толкал bubble
- Наиболее надежный путь:
  - оставить кнопку в потоке, но обернуть `button + bubble` в контейнер, который сам прижимается к правому краю
- Output / exit criterion:
  - delete action больше не ломает прижатие длинного outgoing bubble к правой стороне

### Phase 4: Подправить max-width и shrink behavior bubble
- Проверить текущие ограничения:
  - `max-w-[85%]`
  - `sm:max-w-[70%]`
- Проверить, не мешает ли bubble комбинация `max-width` + внутренний `grid`/`inline meta` layout.
- При необходимости:
  - добавить `ml-auto` для outgoing bubble wrapper
  - явно задать `min-w-0` / `w-fit` / `max-w-*` на нужном уровне
- Output / exit criterion:
  - длинный bubble растет влево, сохраняя правое выравнивание

### Phase 5: Проверить deleted-state и короткие сообщения
- После перестройки outgoing layout проверить:
  - deleted message bubble
  - короткие bubble
  - длинные bubble
- Важно не получить побочный эффект, где короткие сообщения тоже меняют характер расположения.
- Output / exit criterion:
  - все варианты исходящих сообщений выровнены вправо консистентно

### Phase 6: Проверить attachment и multiline сценарии
- Проверить:
  - text-only длинное сообщение
  - multiline сообщение
  - attachment message
  - attachment + text
- Убедиться, что новый wrapper не ломает ширину preview/image/file cards.
- Output / exit criterion:
  - все исходящие варианты остаются визуально стабильными

### Phase 7: Уточнить hover/action UX при новом layout
- Если delete button после фикса still выглядит оторванно, подправить:
  - spacing между кнопкой и bubble
  - вертикальное выравнивание
  - поведение на hover
- Возможно, итогово стоит:
  - оставить кнопку менее заметной
  - но сделать так, чтобы она не влияла на позиционирование bubble
- Output / exit criterion:
  - action UI и bubble выглядят как связанный блок без побочного смещения

## Testing and Validation
- Проверить короткое исходящее сообщение
- Проверить длинное исходящее сообщение без переносов
- Проверить длинное исходящее сообщение с переносами
- Проверить deleted outgoing message
- Проверить outgoing message рядом с delete button
- Проверить incoming messages, чтобы не появилось новых сдвигов
- Проверить mobile width
- Прогнать:
  - `pnpm --filter @repo/web typecheck`
  - `pnpm verify:web`
  - `pnpm test:ui:e2e:auto`

## Risks and Dependencies
- Риск: fix для outgoing layout сломает incoming alignment.
- Mitigation:
  - явно развести layout-ветки для `isMine` и `!isMine`.

- Риск: delete button перестанет быть удобно кликабельной.
- Mitigation:
  - не делать ее полностью absolute без проверки hit area.

- Риск: attachment bubble начнет вести себя иначе, чем text-only.
- Mitigation:
  - проверить attachment сценарии отдельно и при необходимости дать им свой wrapper behavior.

## Next Actions
- Найти контейнер, который ломает right alignment у длинных своих сообщений
- Перестроить outgoing wrapper так, чтобы bubble рос влево, оставаясь прижатым вправо
- Проверить delete button рядом с bubble
- Прогнать web typecheck, verify и UI e2e