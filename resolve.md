## Goal
Устранить `401 Unauthorized` на `POST /auth/refresh`, чтобы клиентская сессия корректно восстанавливалась при загрузке приложения и пользователь не упирался в ошибки обновления токена.

## Assumptions
- Проблема относится к механике refresh-сессии, а не к рендерингу интерфейса.
- `accessToken` в приложении либо отсутствует, либо истек, поэтому фронтенд пытается опереться на refresh-cookie.
- API уже запущен и доступен, а ошибка именно в валидации refresh flow.
- После недавних изменений в `rememberMe`, cookie или Prisma-схеме могла появиться рассинхронизация между клиентом, cookie и таблицей `refresh_tokens`.

## Plan
### Phase 1: Diagnose the refresh failure
- Проверить реализацию refresh flow на фронтенде в [auth-context.tsx](C:\Users\User\Desktop\Project\apps\web\lib\auth-context.tsx):
  - когда вызывается `refreshSession`;
  - при каких условиях он запускается сразу после загрузки;
  - как обрабатывается `401`.
- Проверить backend-логику `/auth/refresh`:
  - [auth.controller.ts](C:\Users\User\Desktop\Project\apps\api\src\auth\auth.controller.ts)
  - [auth.service.ts](C:\Users\User\Desktop\Project\apps\api\src\auth\auth.service.ts)
- Определить, почему refresh отвергается:
  - отсутствует refresh-cookie;
  - cookie есть, но токен не найден в БД;
  - токен найден, но помечен revoked/expired;
  - cookie не доходит до API из-за CORS/credentials/path/sameSite;
  - клиент пытается обновить сессию, уже будучи разлогинен.
- Output / exit criterion:
  - установлен точный источник `401` на `/auth/refresh`.

### Phase 2: Verify cookie transport and session state
- Проверить, выставляется ли refresh-cookie после `login/register`:
  - имя cookie;
  - `httpOnly`;
  - `sameSite`;
  - `path`;
  - `maxAge`/сессионность.
- Проверить, отправляет ли фронтенд запрос `/auth/refresh` с `credentials: "include"` и правильным базовым URL.
- Проверить dev-окружение:
  - фронтенд идет на `127.0.0.1:4000` или `localhost:4000`;
  - нет ли несовпадения между `127.0.0.1` и `localhost`, из-за которого cookie не прикрепляется.
- Если проблема в host mismatch:
  - выровнять frontend/API base URL;
  - или cookie domain/path поведение под локальную разработку.
- Output / exit criterion:
  - подтверждено, что refresh-cookie либо доходит до API, либо найдена причина, почему не доходит.

### Phase 3: Validate refresh token persistence
- Проверить таблицу `refresh_tokens` и логику сохранения refresh token:
  - создается ли запись при login;
  - создается ли запись при register;
  - не сбоит ли `rememberMe`-логика;
  - корректно ли заполняются `tokenHash`, `isPersistent`, `expiresAt`, `revokedAt`.
- Проверить refresh-валидацию в `auth.service`:
  - как ищется запись по refresh token;
  - как сравнивается hash;
  - что считается expired/revoked.
- Проверить, нет ли локальных старых cookie после миграций и изменений схемы, которые больше не соответствуют БД.
- При необходимости предусмотреть безопасный recovery-path:
  - очистка старой refresh-cookie;
  - повторный login;
  - повторная выдача refresh token в новом формате.
- Output / exit criterion:
  - refresh token storage и refresh validation согласованы между cookie, API и БД.

### Phase 4: Fix the actual auth flow
- В зависимости от найденной причины внести точечную правку:
  - исправить `credentials/include` на фронтенде;
  - исправить cookie options в backend;
  - исправить host/config mismatch `127.0.0.1` vs `localhost`;
  - исправить refresh lookup/rotation logic;
  - смягчить клиентский startup flow, если refresh не должен считаться ошибкой при полностью пустой сессии.
- Если `401` нормален для пустой сессии, но мешает UX:
  - сделать это ожидаемым quiet-path без шумной ошибки в консоли/состоянии приложения;
  - не считать такой ответ “падением”, если пользователь просто не авторизован.
- Проверить, что после успешного login:
  - приложение держит сессию;
  - перезагрузка страницы не выбрасывает пользователя мгновенно;
  - refresh проходит без `401`.
- Output / exit criterion:
  - auth-refresh работает корректно или безопасно деградирует без поломки UX.

### Phase 5: Regression and recovery checks
- Прогнать сценарии:
  - чистый заход без сессии;
  - login -> reload;
  - login с `rememberMe = false`;
  - login с `rememberMe = true`;
  - logout -> reload;
  - refresh после истечения access token.
- Проверить, что после logout старый refresh token не продолжает оживлять сессию.
- Проверить, что `401` на `/auth/refresh` не ломает остальные запросы и не зацикливает retry-механику.
- Проверить, что фронтенд корректно переводит пользователя в `login`, если refresh объективно невалиден.
- Output / exit criterion:
  - auth lifecycle стабилен на ключевых сценариях входа, обновления и выхода.

## Risks and Dependencies
- Риск: проблема не в коде, а в локальных старых cookies в браузере.
  - Mitigation: заложить шаг на очистку cookie и повторный login как часть recovery.
- Риск: `127.0.0.1` и `localhost` ведут себя как разные origin для cookie.
  - Mitigation: унифицировать host в конфиге фронтенда и API для локальной разработки.
- Риск: `401` на refresh для пустой сессии — это ожидаемое поведение, но фронтенд обрабатывает его слишком шумно.
  - Mitigation: отделить “нет refresh-сессии” от “сломанная авторизация”.
- Риск: после фикса refresh появятся побочные эффекты в logout или remember-me.
  - Mitigation: отдельно прогнать сценарии login/logout/reload/rememberMe.
- Dependency: решение затронет как минимум [auth-context.tsx](C:\Users\User\Desktop\Project\apps\web\lib\auth-context.tsx), [auth.controller.ts](C:\Users\User\Desktop\Project\apps\api\src\auth\auth.controller.ts) и [auth.service.ts](C:\Users\User\Desktop\Project\apps\api\src\auth\auth.service.ts).

## Next Actions
- Проверить фронтендовый `refreshSession` и backend `/auth/refresh` на предмет host/cookie mismatch.
- Убедиться, что refresh-cookie реально выставляется и доходит до API.
- После диагностики внести точечную правку и перепроверить сценарии login -> reload -> refresh.
