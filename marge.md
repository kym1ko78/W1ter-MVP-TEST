## Goal
Довести PR `feat/prompt-10-media-storage-upgrade -> main` до mergeable-состояния в GitHub: перенести уже собранные локальные исправления, аккуратно разрешить оставшиеся конфликты в `chat-shell.tsx` и `conversation-view.tsx`, прогнать проверки и запушить ветку PR без потери функционала из обеих сторон.

## Assumptions
- Локально у нас уже есть рабочая версия [chat-shell.tsx](/C:/Users/User/Desktop/Проект/apps/web/components/chat-shell.tsx), собранная на `main`.
- PR на GitHub открыт из ветки `feat/prompt-10-media-storage-upgrade`, и именно она сейчас конфликтует с `main`.
- В PR конфликтуют как минимум:
  - `apps/web/components/chat-shell.tsx`
  - `apps/web/components/conversation-view.tsx`
- В `main` уже есть восстановленные message actions в `conversation-view.tsx` и локальный merge-fix для `chat-shell.tsx`.
- Цель не просто убрать conflict markers, а сохранить:
  - текущий UI/layout из актуального `main`
  - realtime/media/storage changes из PR-ветки
  - reply/edit/forward/reactions из уже влитых в `main` изменений

## Plan
### Phase 1: Подготовить безопасную базу для доведения PR
- Зафиксировать текущее локальное состояние:
  - проверить `git status`
  - убедиться, что merge-fix для `chat-shell.tsx` закоммичен
  - не потерять служебные файлы планов (`char.md`, `marge.md`) и не тащить их в PR случайно
- Подтянуть актуальные удаленные ветки:
  - `git fetch origin`
- Переключиться на локальную ветку PR из `origin/feat/prompt-10-media-storage-upgrade`.
- Проверить divergence между:
  - `origin/main`
  - `origin/feat/prompt-10-media-storage-upgrade`
  - локальным `main`
- Output / exit criterion:
  - есть локальная рабочая ветка PR, готовая к merge с `origin/main`

### Phase 2: Перенести уже готовый локальный fix для chat-shell в ветку PR
- Определить, каким способом безопаснее перенести локальный рабочий merge:
  - `cherry-pick` коммита `Resolve chat shell merge and restore realtime features`
  - или ручное копирование изменений после merge-конфликта
- Если `cherry-pick` дает конфликт в `chat-shell.tsx`, использовать уже проверенную локальную финальную версию как источник истины.
- Убедиться, что в ветке PR появился:
  - `apps/web/components/chat-shell.tsx`
  - `apps/web/lib/realtime-context.ts`
- Output / exit criterion:
  - ветка PR содержит рабочую merged-версию `chat-shell.tsx`, а не только локальный `main`

### Phase 3: Влить актуальный main в ветку PR
- Выполнить merge `origin/main` в локальную ветку `feat/prompt-10-media-storage-upgrade`.
- Зафиксировать полный список конфликтов после merge.
- Проверить, не появились ли новые конфликтующие файлы кроме двух уже ожидаемых.
- Output / exit criterion:
  - есть конкретный финальный список конфликтов, которые нужно закрыть вручную

### Phase 4: Разрешить conflict в chat-shell.tsx окончательно для ветки PR
- Использовать уже собранную рабочую версию `chat-shell.tsx` как основу.
- Проверить, чтобы в ветке PR остались:
  - drawer/sidebar и актуальный layout из `main`
  - realtime/presence/typing/notifications/offline-state из PR-ветки
  - `RealtimeContext.Provider`
  - `presence:sync`
  - typing-индикаторы и richer chat statuses
  - notification controls
  - корректный socket lifecycle и cleanup
- Убедиться, что file path [chat-shell.tsx](/C:/Users/User/Desktop/Проект/apps/web/components/chat-shell.tsx) не содержит merge markers.
- Output / exit criterion:
  - `chat-shell.tsx` в ветке PR совпадает по смыслу с уже проверенной локальной рабочей версией

### Phase 5: Разрешить conflict в conversation-view.tsx без потери фич
- Сравнить, что приносит PR-ветка в [conversation-view.tsx](/C:/Users/User/Desktop/Проект/apps/web/components/conversation-view.tsx) поверх уже текущего `main`.
- Сохранить уже существующие в `main` функции:
  - reply
  - edit
  - forward
  - reactions
  - hover actions
  - search/profile/group panel logic
- Поверх этого аккуратно вернуть из PR-ветки только действительно новые media/storage improvements:
  - улучшения вложений
  - media-related UI/UX
  - изменения, связанные именно с prompt-10
- Не допустить отката уже восстановленных message actions.
- Проверить, что файл не возвращается к более старой версии из другой ветки.
- Output / exit criterion:
  - `conversation-view.tsx` содержит и message actions из `main`, и нужные media/storage изменения из PR

### Phase 6: Проверить все зависимости между web и api
- Убедиться, что web-код после merge не требует отсутствующих backend contract changes.
- Проверить, что используются существующие типы из:
  - [api.ts](/C:/Users/User/Desktop/Проект/apps/web/types/api.ts)
- Убедиться, что realtime context import-paths и message attachments typings остаются валидными.
- Если PR затрагивает media storage contract, проверить, что фронт не ожидает поля, которых нет в API.
- Output / exit criterion:
  - после merge нет структурного рассинхрона между web и уже рабочим API

### Phase 7: Прогнать проверки после разрешения конфликтов
- Прогнать минимум:
  - `pnpm --filter @repo/web typecheck`
  - `pnpm --filter @repo/api typecheck`
  - `pnpm verify:web`
- Если сборка требует вне-sandbox запуск, повторить команду с escalated permission.
- При необходимости поднять локально:
  - `pnpm --filter @repo/api dev`
  - `pnpm --filter @repo/web dev`
- Проверить вручную сценарии:
  - открытие `/chat`
  - вход в конкретный чат
  - список чатов и статусы presence/typing
  - drawer/sidebar
  - profile link и group composer
  - message actions в conversation view
  - media/attachments behavior
- Output / exit criterion:
  - код в ветке PR проходит проверки и локально не показывает явных runtime-regressions

### Phase 8: Завершить merge и подготовить ветку к GitHub
- Убедиться, что `git status` показывает только ожидаемые изменения.
- Проверить, что merge markers больше нигде не остались.
- Просмотреть `git diff --stat` и ключевой `git diff` для `chat-shell.tsx` и `conversation-view.tsx`.
- Закоммитить разрешение конфликтов с понятным сообщением.
- Запушить именно ветку PR:
  - `feat/prompt-10-media-storage-upgrade`
- Проверить GitHub PR:
  - исчез ли badge `Merge conflicts`
  - проходят ли checks
  - корректно ли отображается итоговый diff
- Output / exit criterion:
  - PR на GitHub становится mergeable и готовым к review/merge

### Phase 9: Финальная приемка перед merge
- Повторно сверить, что в итоговом PR не исчезли ранее важные изменения из `main`.
- Подготовить короткое human-readable summary:
  - что именно было конфликтом
  - что взяли из `main`
  - что сохранили из `feat/prompt-10-media-storage-upgrade`
  - какие проверки пройдены
- Только после этого считать задачу завершенной.
- Output / exit criterion:
  - есть уверенность, что merge в GitHub не приведет к откату UI или функционала

## Risks and Dependencies
- Риск: мы починили `chat-shell.tsx` локально на `main`, но эти правки не попадут в PR-ветку автоматически.
  - Mitigation: переносить fix осознанно в ветку PR и проверять итоговый diff уже на ней.
- Риск: при разрешении `conversation-view.tsx` можно потерять уже восстановленные reply/edit/forward/reactions.
  - Mitigation: использовать текущий `main` как базу и переносить из PR только новые media/storage изменения.
- Риск: PR может принести дополнительные изменения в attachment/media contract, которые неочевидны из одного UI-конфликта.
  - Mitigation: после merge проверить typings и вручную открыть сценарии с вложениями.
- Риск: случайно запушить изменения в `main`, а не в ветку PR.
  - Mitigation: перед коммитом и push отдельно проверить `git branch --show-current`.
- Dependency: локальный рабочий `chat-shell.tsx` и `realtime-context.ts` должны остаться доступными как источник истины при переносе в PR-ветку.

## Next Actions
- Проверить чистоту текущего рабочего дерева и неслужебные файлы, которые не должны попасть в PR.
- Переключиться на локальную ветку `feat/prompt-10-media-storage-upgrade` из `origin/feat/prompt-10-media-storage-upgrade`.
- Влить в нее `origin/main` и начать ручное разрешение конфликтов с `chat-shell.tsx`, затем с `conversation-view.tsx`.
