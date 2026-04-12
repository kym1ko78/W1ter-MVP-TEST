## Goal
Исправить build-падение страницы `/verify-email`, вызванное использованием `useSearchParams()` без `Suspense`, чтобы `pnpm verify:web` снова проходил полностью.

## Assumptions
- Проблема находится в [verify-email/page.tsx](C:\Users\User\Desktop\Project\apps\web\app\verify-email\page.tsx) и/или в компоненте, который эта страница рендерит.
- Это ошибка Next.js App Router уровня prerender/build, а не runtime-ошибка бизнес-логики.
- Основная задача: не менять auth-flow глубже, чем нужно, а корректно оформить чтение query params под требования Next.js 15.

## Plan
### Phase 1: Найти точное место использования `useSearchParams`
- Открыть [verify-email/page.tsx](C:\Users\User\Desktop\Project\apps\web\app\verify-email\page.tsx) и связанный UI-компонент.
- Проверить, где именно вызывается `useSearchParams()`:
  - прямо в page
  - или внутри дочернего client-component
- Зафиксировать, какая часть логики зависит от query params:
  - `token`
  - `sent`
  - сообщения состояния экрана
- Output / exit criterion:
  - найден точный слой, где query params читаются сейчас

### Phase 2: Выбрать правильный Next.js-паттерн
- Выбрать один из безопасных вариантов:
  - вариант A: server page + `searchParams` через props
  - вариант B: client component, обернутый в `Suspense`
- Приоритетно выбрать наименее инвазивный путь.
- Если логика сильно client-side и уже завязана на hooks, вероятнее всего лучше:
  - оставить client component
  - вынести его под `Suspense` boundary в page
- Output / exit criterion:
  - выбран конкретный паттерн, совместимый с build/prerender

### Phase 3: Разделить page и client-logic при необходимости
- Если `page.tsx` сейчас client-only и использует `useSearchParams`, разнести слои:
  - `page.tsx` как server entry
  - отдельный client component для интерактивной логики
- В `page.tsx` добавить `Suspense` fallback вокруг client component.
- Если fallback нужен, сделать его минимальным и визуально совместимым с verify-email экраном.
- Output / exit criterion:
  - `useSearchParams()` больше не висит напрямую в проблемном build-контексте

### Phase 4: Сохранить поведение verify-email flow
- Проверить, что после рефакторинга не ломается:
  - чтение `token` из URL
  - чтение `sent=1`
  - подтверждение email
  - показ сообщений успеха/ошибки
- Не потерять переходы после регистрации и повторной отправки verification link.
- Output / exit criterion:
  - verify-email сценарий работает так же, как раньше, но уже без build-ошибки

### Phase 5: Проверить типы и Next build
- После правки прогнать:
  - `pnpm --filter @repo/web typecheck`
  - `pnpm verify:web`
- Убедиться, что ошибка `useSearchParams() should be wrapped in a suspense boundary` исчезла полностью.
- Output / exit criterion:
  - `verify:web` снова зеленый

## Risks and Dependencies
- Риск: при быстром переносе в `Suspense` можно случайно сломать query-param логику.
- Mitigation:
  - сначала выделить все зависимости от `token/sent`, потом переносить структуру.

- Риск: fallback внутри `Suspense` будет визуально выбиваться из verify-email экрана.
- Mitigation:
  - использовать минимальный совместимый fallback, а не отдельный новый дизайн.

- Риск: page и client component окажутся запутанно связаны.
- Mitigation:
  - держать `page.tsx` тонким wrapper-компонентом, а всю UI-логику оставить в одном client component.

## Next Actions
- Открыть [verify-email/page.tsx](C:\Users\User\Desktop\Project\apps\web\app\verify-email\page.tsx)
- Найти вызов `useSearchParams()`
- Обернуть client-часть в `Suspense` или вынести query-reading в server/page layer
- Прогнать `pnpm --filter @repo/web typecheck` и `pnpm verify:web`
