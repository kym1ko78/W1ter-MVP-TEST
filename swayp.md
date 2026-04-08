## Objective
Сделать так, чтобы в режиме мессенджера нельзя было свайпать и прокручивать всю страницу целиком, а двигались только разрешенные внутренние области: список чатов, результаты поиска пользователей и история сообщений.

## Constraints
- Изменение должно касаться именно chat-экрана, а не ломать обычные страницы вроде `login` и `register`.
- Внутренний scroll у `chat-list`, `user-search-results` и `message-list` должен сохраниться.
- Нужно учитывать мобильные браузеры и trackpad/desktop scroll.
- Текущий layout уже частично подготовлен: в [chat-shell.tsx](C:\Users\User\Desktop\Project\apps\web\components\chat-shell.tsx) есть `h-[100dvh]` и `overflow-hidden`, но `html/body` пока не заблокированы.
- Глобальные стили сейчас не ограничивают root page scroll: [globals.css](C:\Users\User\Desktop\Project\apps\web\app\globals.css).

## Current State
- В [chat-shell.tsx](C:\Users\User\Desktop\Project\apps\web\components\chat-shell.tsx) outer shell уже занимает высоту viewport.
- В [conversation-view.tsx](C:\Users\User\Desktop\Project\apps\web\components\conversation-view.tsx) история сообщений уже скроллится через `overflow-y-auto`.
- Sidebar list и search results тоже имеют внутренний scroll.
- Но `html` и `body` по-прежнему участвуют в page scrolling и overscroll поведении браузера.
- Из-за этого на мобильном и на некоторых touch/trackpad сценариях страница все еще может двигаться целиком, несмотря на внутренние scroll-контейнеры.

## Approach
Использовать route-scoped блокировку page scroll:
- На chat-экранах добавлять специальный class на `html` и `body`.
- Через глобальный CSS отключать root scroll и overscroll только когда этот class активен.
- Внутренним scroll-областям явно назначить режим, в котором они продолжают принимать вертикальные жесты.
- Не делать глобальный `overflow: hidden` для всего приложения без условий, чтобы не сломать auth и прочие страницы.

## Work Phases
### Phase 1: Зафиксировать область применения
- Определить, что блокировка страницы нужна только внутри chat-shell, а не во всем приложении.
- Выбрать источник truth для переключения режима: удобнее всего делать это из [chat-shell.tsx](C:\Users\User\Desktop\Project\apps\web\components\chat-shell.tsx), потому что именно он монтируется на chat-роутах.
- Зафиксировать ожидаемое поведение:
  - page scroll запрещен
  - внутренний scroll разрешен
  - при уходе с chat-страницы блокировка снимается
- Output / exit criterion:
  - определена route-scoped модель, которая не затрагивает auth pages и не требует хаков по всему приложению.

### Phase 2: Добавить route-scoped page lock
- В [chat-shell.tsx](C:\Users\User\Desktop\Project\apps\web\components\chat-shell.tsx) добавить `useEffect`, который при mount:
  - добавляет class на `document.documentElement`
  - добавляет class на `document.body`
- На unmount этот эффект должен гарантированно удалять те же class names.
- Название классов выбрать явно, например:
  - `chat-page-locked`
- Если понадобится, можно использовать два класса:
  - один для `html/body`
  - один для самого shell container
- Output / exit criterion:
  - при открытом чате корневая страница переводится в заблокированный scroll-mode, а при выходе с чата возвращается в обычный режим.

### Phase 3: Заблокировать scroll и overscroll у root page
- В [globals.css](C:\Users\User\Desktop\Project\apps\web\app\globals.css) добавить правила для `html.chat-page-locked` и `body.chat-page-locked`.
- Основные свойства, которые нужно заложить:
  - `height: 100dvh`
  - `overflow: hidden`
  - `overscroll-behavior: none`
- При необходимости добавить отдельно:
  - `overscroll-behavior-x: none`
  - `overscroll-behavior-y: none`
- Проверить, не нужен ли `position: relative` или `max-height: 100dvh`, если отдельные браузеры все еще пытаются растянуть страницу.
- Output / exit criterion:
  - root page больше не прокручивается и не bounce-ится целиком в chat-режиме.

### Phase 4: Явно оформить разрешенные scroll-регионы
- Для внутренних scroll-областей в [chat-shell.tsx](C:\Users\User\Desktop\Project\apps\web\components\chat-shell.tsx) и [conversation-view.tsx](C:\Users\User\Desktop\Project\apps\web\components\conversation-view.tsx) добавить единый класс или явные стили для разрешенного вертикального scroll.
- Зоны, которые нужно проверить и при необходимости пометить отдельно:
  - список чатов
  - результаты поиска пользователей
  - история сообщений
- Для них зафиксировать поведение:
  - `overflow-y-auto`
  - `overscroll-behavior: contain`
  - при необходимости `touch-action: pan-y`
  - при необходимости `-webkit-overflow-scrolling: touch`
- Это нужно, чтобы запрет page scroll не “съел” scroll внутри нужных контейнеров.
- Output / exit criterion:
  - скролл остался только внутри предусмотренных областей и не пропал после root lock.

### Phase 5: Проверить конфликт с composer и авто-растущим textarea
- В [conversation-view.tsx](C:\Users\User\Desktop\Project\apps\web\components\conversation-view.tsx) проверить, как новый page lock ведет себя рядом с auto-growing composer.
- Убедиться, что:
  - textarea по-прежнему растет по тексту
  - page при этом не начинает двигаться
  - уменьшается только доступная высота `message-list`, а не появляется scroll у страницы
- Если всплывет конфликт, зафиксировать `message-list` как единственный `flex-1 min-h-0 overflow-y-auto` scroll region в правой колонке.
- Output / exit criterion:
  - длинный текст в composer не возвращает page scroll и не ломает chat viewport.

### Phase 6: Проверить mobile edge cases
- Протестировать сценарии на мобильной ширине:
  - обычный вертикальный drag по пустым областям страницы
  - drag внутри истории сообщений
  - drag внутри списка чатов
  - drag по области вокруг composer
- Если на отдельных браузерах page все еще двигается, рассмотреть fallback:
  - закрепить chat-shell как `fixed inset-0` вместо flow-layout контейнера
  - или вынести root shell в отдельный viewport wrapper
- Отдельно отметить ограничение:
  - системный edge-swipe браузера назад на некоторых устройствах может не отключаться полностью веб-слоем
- Output / exit criterion:
  - в типовых mobile сценариях страница не свайпается, а работают только внутренние скроллы.

## Testing and Validation
- Открыть чат и попробовать прокрутить всю страницу по пустому месту:
  - страница не должна двигаться.
- Прокрутить список чатов:
  - список должен скроллиться независимо.
- Прокрутить историю сообщений:
  - history должна скроллиться независимо.
- Открыть user search и прокрутить результаты:
  - результаты должны скроллиться внутри своего контейнера.
- Набрать длинное сообщение, чтобы composer вырос:
  - page scroll не появляется.
- Перейти на `login` и `register`:
  - обычное поведение страниц не ломается.
- Прогнать существующий UI smoke / Playwright, чтобы убедиться, что блокировка scroll не ломает навигацию и отправку сообщений.

## Risks and Dependencies
- Риск: глобальный `overflow: hidden` сломает не только чат, но и auth pages.
- Mitigation:
  - применять lock только через class, который ставится в `ChatShell`.

- Риск: слишком агрессивный `touch-action: none` отключит внутренний scroll совсем.
- Mitigation:
  - не вешать `touch-action: none` на весь `body` без необходимости; сначала использовать `overflow + overscroll-behavior`, а `touch-action` давать только на разрешенные scroll-регионы.

- Риск: iOS Safari и похожие mobile браузеры будут вести себя не так, как desktop.
- Mitigation:
  - использовать `100dvh`, route-scoped lock и отдельную ручную проверку mobile сценариев.

- Риск: авто-растущий composer снова начнет выталкивать layout вниз.
- Mitigation:
  - сохранить `message-list` как основной `flex-1 min-h-0` scroll-container.

- Риск: системный gesture “назад” с края экрана не отключится полностью.
- Mitigation:
  - считать success-критерием именно запрет page movement и page scroll, а не гарантированное отключение всех OS-level gestures.

## Next Actions
- Добавить route-scoped `chat-page-locked` класс в [chat-shell.tsx](C:\Users\User\Desktop\Project\apps\web\components\chat-shell.tsx).
- Добавить root lock rules и scroll-region helpers в [globals.css](C:\Users\User\Desktop\Project\apps\web\app\globals.css).
- Проверить и при необходимости пометить `chat-list`, `user-search-results` и `message-list` как разрешенные scroll-регионы.
- Протестировать desktop/mobile и только после этого переходить к полировке, если какой-то browser edge case останется.