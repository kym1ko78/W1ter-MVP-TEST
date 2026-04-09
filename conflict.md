## Goal
Восстановить локальный запуск проекта и регистрацию, устранив текущую блокирующую проблему: Docker daemon недоступен, поэтому PostgreSQL не поднимается, API не стартует, а `pnpm dev` останавливается на preflight-проверке.

## Assumptions
- Пользователь работает на Windows.
- Проект ожидает локальную PostgreSQL через `docker compose` на порту `5433`.
- `pnpm dev` уже исправлен и теперь правильно блокирует старт без базы.
- Текущая ошибка не в коде frontend или backend, а в инфраструктурной зависимости: Docker Desktop / Docker engine сейчас не запущены или недоступны.

## Plan
### Phase 1: Подтвердить точную причину сбоя Docker
- Проверить, что ошибка воспроизводится не на уровне compose-файла, а именно на уровне Docker daemon.
- Проверить команды:
  - `docker version`
  - `docker info`
  - `docker context ls`
- Убедиться, что ошибка связана с отсутствием доступа к `dockerDesktopLinuxEngine`, а не с правами проекта.
- Output / exit criterion:
  - есть подтверждение, что проблема именно в неработающем Docker Desktop / daemon, а не в `docker-compose.yml`.

### Phase 2: Восстановить Docker Desktop / Docker engine
- Открыть и запустить Docker Desktop вручную.
- Дождаться, пока Docker Desktop покажет состояние `Engine running`.
- Повторно проверить:
  - `docker version`
  - `docker ps`
- Если daemon все еще не поднимается:
  - перезапустить Docker Desktop
  - проверить WSL2 backend
  - проверить, что Windows virtualization / WSL не отключены
  - при необходимости перезагрузить ПК
- Output / exit criterion:
  - `docker` CLI отвечает без ошибки про `dockerDesktopLinuxEngine`.

### Phase 3: Поднять PostgreSQL для проекта
- После восстановления Docker выполнить:
  - `docker compose up -d`
- Проверить, что контейнер Postgres реально запущен:
  - `docker compose ps`
  - при необходимости `docker compose logs postgres`
- Проверить, что порт `5433` слушает.
- Output / exit criterion:
  - контейнер базы поднят и доступен на `localhost:5433`.

### Phase 4: Проверить backend startup path
- После появления базы снова выполнить:
  - `pnpm dev:check`
  - `pnpm dev`
- Убедиться, что теперь стартуют оба сервиса:
  - web на `3000`
  - api на `4000`
- Проверить `http://127.0.0.1:4000/health`.
- Если API падает уже после появления базы:
  - смотреть лог Prisma
  - проверить миграции
  - проверить `DATABASE_URL` в `apps/api/.env`
- Output / exit criterion:
  - API стабильно поднимается и отвечает на `/health`.

### Phase 5: Проверить регистрацию end-to-end
- Открыть `http://localhost:3000/register`.
- Повторить регистрацию нового пользователя.
- Проверить, что:
  - ошибка `Failed to fetch` исчезла
  - запрос уходит в API
  - после успешной регистрации происходит вход в приложение
- Output / exit criterion:
  - регистрация проходит полностью, и frontend/backend снова работают как единый поток.

### Phase 6: Добавить fallback-сценарий на случай отсутствия Docker
- Если Docker Desktop недоступен надолго, оценить временный обходной путь:
  - использовать локально установленный PostgreSQL вместо Docker
  - временно перенаправить `DATABASE_URL` на локальный инстанс
- Перед этим проверить:
  - есть ли уже локальный Postgres на машине
  - не занят ли `5432`
  - можно ли создать ту же БД `messenger`
- Это не основной путь, а запасной вариант, если Docker невозможно восстановить быстро.
- Output / exit criterion:
  - есть documented fallback, если Docker-среда недоступна.

## Risks and Dependencies
- Риск: Docker Desktop установлен, но его backend не стартует из-за WSL2 или virtualization.
- Mitigation:
  - проверить Docker Desktop status, WSL backend и при необходимости перезагрузить машину.

- Риск: После запуска Docker база поднимется, но API все еще упадет на Prisma/migrations.
- Mitigation:
  - отдельно проверить `docker compose logs`, `pnpm dev` и состояние миграций.

- Риск: Пользователь снова увидит frontend-ошибку и подумает, что проблема в форме.
- Mitigation:
  - сначала проверять `docker`, потом `5433`, потом `4000`, и только потом UI.

- Риск: Пользователь попробует запускать `pnpm dev` до восстановления Docker и снова упрется в preflight.
- Mitigation:
  - считать это ожидаемым и правильным поведением: dev-старт должен быть заблокирован, пока база не доступна.

## Next Actions
- Запустить Docker Desktop вручную.
- Проверить `docker version` и `docker ps`.
- После этого выполнить `docker compose up -d`.
- Затем проверить `pnpm dev:check` и запустить `pnpm dev`.
- Если Docker daemon не восстановится, перейти к fallback-плану с локальным PostgreSQL.
