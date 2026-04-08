## Objective
Убрать зависимость `pnpm --filter @repo/web typecheck` от предварительного `next build`, чтобы `typecheck` проходил стабильно даже на чистой рабочей директории, где еще нет `.next/types`.

## Constraints
- Сейчас в [tsconfig.json](C:\Users\User\Desktop\Project\apps\web\tsconfig.json) явно включены:
  - `.next/types/**/*.ts`
  - `.next-e2e/types/**/*.ts`
- Скрипты в [package.json](C:\Users\User\Desktop\Project\apps\web\package.json):
  - `typecheck`
  - `lint`
  оба запускают `tsc -p tsconfig.json --noEmit`
- После `next build` проблема исчезает, значит корень не в коде приложения, а в зависимости `tsc` от generated Next files.
- Нужно сохранить надежность route/type-валидации, но убрать хрупкость локального запуска.

## Recommended Approach
Рекомендую разделить проверки на два уровня:
- обычный `source-only` typecheck, который не зависит от `.next`
- отдельный `next-generated` check, который запускается после `build` или в CI

Это надежнее, чем заставлять обычный `typecheck` каждый раз сначала генерировать `.next/types`.

## Plan
### Phase 1: Зафиксировать источник проблемы
- Подтвердить, что падение связано именно с generated Next type files, а не с TypeScript-кодом.
- Проверить сценарий:
  - удалить/очистить `.next`
  - запустить `pnpm --filter @repo/web typecheck`
  - увидеть падение на `.next/types`
  - затем выполнить `pnpm --filter @repo/web build`
  - повторно выполнить `typecheck`
- Отдельно проверить, нужны ли для обычного `typecheck` вообще `.next-e2e/types`, или это только артефакт тестового pipeline.
- Output / exit criterion:
  - есть подтверждение, что проблема именно в смешении source-code и generated types в одном `tsconfig`

### Phase 2: Разделить source typecheck и generated typecheck
- Оставить основной [tsconfig.json](C:\Users\User\Desktop\Project\apps\web\tsconfig.json) как конфиг для исходников:
  - `**/*.ts`
  - `**/*.tsx`
  - `next-env.d.ts`
- Убрать из обычного `tsconfig.json` прямую зависимость от:
  - `.next/types/**/*.ts`
  - `.next-e2e/types/**/*.ts`
- Создать отдельный конфиг, например:
  - `tsconfig.next-generated.json`
- В нем уже держать generated include-пути:
  - `.next/types/**/*.ts`
  - при необходимости `.next-e2e/types/**/*.ts`
- Output / exit criterion:
  - обычный `typecheck` больше не зависит от наличия `.next`

### Phase 3: Перестроить package scripts
- В [package.json](C:\Users\User\Desktop\Project\apps\web\package.json) разделить сценарии:
  - `typecheck` = безопасный source-only `tsc`
  - `typecheck:next` = проверка с generated Next types
- На root-уровне в [package.json](C:\Users\User\Desktop\Project\package.json) решить, что именно должен делать:
  - `pnpm typecheck`
  - отдельный CI/verification script
- Рекомендуемый вариант:
  - локальный `typecheck` быстрый и стабильный
  - `build` или отдельный `verify:web` делает углубленную Next-aware проверку
- Output / exit criterion:
  - у команды есть понятное различие между быстрым локальным typecheck и полной проверкой перед релизом

### Phase 4: Решить судьбу `.next-e2e/types`
- Проверить, нужно ли обычному web-проекту вообще видеть `.next-e2e/types`.
- Если эти типы нужны только для auto e2e orchestration:
  - вынести их из базового `tsconfig`
  - оставить только в отдельном generated/e2e-check config
- Это особенно важно, чтобы test-артефакты не влияли на повседневную разработку.
- Output / exit criterion:
  - e2e-артефакты больше не ломают обычный `typecheck`

### Phase 5: Привести в порядок build-artifact strategy
- Убедиться, что `.next`, `.next-e2e` и `*.tsbuildinfo` не участвуют в обязательной логике локальной проверки без необходимости.
- Отдельно проверить `.gitignore`, чтобы generated artifacts не возвращались в рабочий цикл как источник шума.
- Если tracked build-артефакты еще живут в git, это оформить как отдельную git-cleanup задачу, не смешивая с фиксом typecheck.
- Output / exit criterion:
  - generated artifacts не мешают обычной разработке и не создают ложные падения проверок

### Phase 6: Валидация новой схемы
- Проверить сценарий с нуля:
  - удалить `.next`
  - запустить `pnpm --filter @repo/web typecheck`
  - он должен пройти без `build`
- Проверить углубленный сценарий:
  - `pnpm --filter @repo/web build`
  - `pnpm --filter @repo/web typecheck:next`
- Проверить root-команды:
  - `pnpm typecheck`
  - при необходимости `pnpm build`
  - `pnpm test:ui:e2e:auto`
- Output / exit criterion:
  - локальный `typecheck` больше не хрупкий, а Next-generated проверка остается доступной отдельно

## Alternative Path
Если вы захотите сохранить `.next/types` именно в основном `tsconfig`, тогда запасной путь такой:
- добавить `typecheck:web:prepare` helper
- он перед `tsc` проверяет наличие `.next/types`
- если их нет, сначала запускает генерацию Next build artifacts
- потом уже запускает `tsc`

Но это менее удобно, потому что:
- `typecheck` становится тяжелее
- локальная проверка начинает зависеть от build pipeline
- это хуже для обычного dev-цикла

## Risks and Dependencies
- Риск: если убрать `.next/types` из основного `tsconfig`, можно потерять часть Next-specific route typing в editor/runtime checks.
- Mitigation:
  - оставить отдельный `typecheck:next` или `verify:web`, который гоняется после build

- Риск: `.next-e2e/types` на самом деле используются глубже, чем кажется.
- Mitigation:
  - сначала выделить их в отдельный config, а не удалять без проверки

- Риск: root scripts начнут путать локальную и CI-проверку.
- Mitigation:
  - явно документировать:
    - что делает `typecheck`
    - что делает `typecheck:next`
    - что считать полной проверкой перед merge/release

- Риск: проблема частично связана еще и с tracked build artifacts.
- Mitigation:
  - считать это отдельной задачей git hygiene, а не смешивать с логикой tsconfig

## Next Actions
- Проверить и подтвердить, что обычный `tsconfig.json` действительно должен быть source-only
- Создать отдельный `tsconfig.next-generated.json`
- Переназначить `typecheck` и добавить `typecheck:next`
- Прогнать сценарий:
  - без `.next`
  - после `build`
  - через root scripts