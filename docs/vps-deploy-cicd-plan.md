# Публикация Dexity на VPS с CI/CD — план

Статус: **в работе**. Многосессионная задача. Этот файл — источник правды по контексту и прогрессу.

## Цель

Развернуть Dexity на проде (`dexity.mvladt.ru`) и настроить CI/CD: проверки на каждый
push в `main`, выкатка на сервер — кнопкой из GitHub Actions.

## Зафиксированные решения

| Решение | Выбор | Обоснование |
| --- | --- | --- |
| Сервер | **spb** `188.225.37.62` (СПб) | Веб-узел под `mvladt.ru`. Стек уже наш: nginx + node v22 + systemd + certbot |
| Платформа CI/CD | **GitHub Actions** | Репо `git@github.com:mvladt/dexity.git`; согласовано с `mvladt/my-site` |
| Стратегия доставки | **CI собирает → rsync артефактов** | build-once/immutable; сервер без тулчейна; согласовано с `mvladt.ru` |
| SQLite-драйвер | **миграция на `node:sqlite`** (встроенный в Node) | убирает нативную зависимость целиком (`better-sqlite3` + `@types`). Мотив — минимализм: нативный API вместо стороннего пакета. На Node 24 LTS API **стабилен** (не experimental) — поэтому деплоим на 24, не на 22. NB: better-sqlite3 тоже поставляется prebuilt (immutable-артефакт достижим и с ним), так что выбор именно по критерию «−1 зависимость», а не по toolchain |
| ORM | **убран целиком** (2026-07-01) | `drizzle-orm/node-sqlite` существует только в 1.0-RC (стабильная ветка 0.x — без него). Взамен адаптации под pre-release ORM разобрали фактическое использование: 6 статичных CRUD-запросов без динамической композиции — Drizzle не давал ничего сверх типизации. Заменили на `server/src/db/queries.ts`: именованные функции над `node:sqlite` prepared statements (`?`-параметры, `RETURNING` — нативная поддержка SQLite), row-типы вручную. Итог: минус зависимость, минус проблема RC-версии, тот же уровень типобезопасности на входе/выходе |
| Версия Node на сервере | **Node 24 LTS** (NodeSource apt) | `node:sqlite` стабилизирован в Node 24 → нет experimental-warning'ов, `NODE_NO_WARNINGS` не нужен. Ставим с нуля — нет причин брать 22 |
| Xray Reality | **оставляем** | spb — входная нода личного VPN (`spb → ams → интернет`), Reality несёт анти-DPI камуфляж против РКН. Dexity лишь добавляет `server_name` в nginx за fallback'ом — отказ от Reality не упрощает Dexity, но ломает устойчивость VPN |
| Триггер деплоя | **ручной** (`workflow_dispatch`) | Проверки — авто на push в main; выкатка — кнопкой. Позже легко на auto |
| CI-гейт | **typecheck + build** обоих пакетов | Быстро, без секретов и внешних API. e2e — отдельно/позже |
| Домен | `dexity.mvladt.ru` | Уже прописан в `nginx/dexity.conf` и спеке |

## Контекст сервера spb (инспекция 2026-06-29, факты)

- Доступ: `ssh root@188.225.37.62` по ключу. Из-за рубежа — через AMS как jump host:
  `ssh -J root@147.45.171.176 root@188.225.37.62`.
- **Активны только `nginx` + `xray`.** Никаких node-сервисов сейчас нет
  (`mvladt-nuxt`, `webpush-scheduler` не запущены/удалены — `server-spb.md` устарел).
- **Схема TLS за Xray:** Xray слушает `:443` (VLESS+Reality), fallback `dest: 127.0.0.1:8443`,
  `serverNames: ["mvladt.ru"]`. **nginx сам терминирует TLS** на `127.0.0.1:8443 ssl`
  (см. `/etc/nginx/conf.d/mvladt.conf`). Реальные конфиги — в `conf.d/`, не в `sites-enabled/`.
- `mvladt.ru` сейчас — **чистая статика**: `root /srv/my-site; try_files`. Отдельный
  server-block на `:80` обслуживает ACME-challenge + редирект на https.
- certbot: выпущен только `mvladt.ru`. UFW **выключен**.
- ⚠️ **Node на сервере НЕ установлен** (`command -v node` пусто, пакета `nodejs` нет).
  Для Fastify-бэка Dexity Node ставим сами (Этап 2).
- ⚠️ **CI-deploy-ключа нет.** В `authorized_keys` только личные ключи (MacBook, iPhone, десктоп) —
  эталонного GitHub Actions deploy для `my-site` на сервере не обнаружено. Заводим с нуля (Этап 3).

## Критические риски / открытые вопросы

1. **nginx за Xray — схема понятна.** `nginx/dexity.conf` переписать по образцу `mvladt.conf`:
   server-block `listen 127.0.0.1:8443 ssl; server_name dexity.mvladt.ru;` (nginx сам терминирует
   TLS) + блок `:80` для ACME + редирект + `location /api/ → proxy_pass 127.0.0.1:3001`.
   **Открытый под-вопрос:** пустит ли Reality-fallback запрос с SNI `dexity.mvladt.ru`
   (не в `serverNames`). Вероятно да (чужой SNI → fallback dest), но возможно придётся
   добавить домен в `serverNames` Xray. Проверить экспериментально на Этапе 2.
2. ✅ **Нативная зависимость убрана — решено и выполнено (2026-07-01).** Уходим с `better-sqlite3`
   на встроенный `node:sqlite`. По пути обнаружилось: `drizzle-orm/node-sqlite` есть только
   в 1.0-RC, не в стабильной 0.x — апгрейд ORM оказался невозможен как задумано. Решение —
   убрать Drizzle целиком (см. таблицу решений), заменить на `db/queries.ts` с raw SQL.
   `node_modules` сервера — чистый JS, immutable-артефакт из CI подтверждён сборкой.
3. ✅ **Путь к энтрипоинту — решено (2026-06-30).** Факт: `package.json` и
   `deploy/dexity-server.service` уже используют рабочий `dist/server/src/index.js`
   (tsc так раскладывает из-за `include: ["src", "../shared"]`). Расходилась только спека —
   синхронизирована (`server/specs/backend.md`). Остаётся при реализации Этапа 1 сверить
   фактический выход `npm run build`.
4. ✅ **Атомарность релизов — решено (2026-06-30): да, `releases/<sha>` + симлинк `current`.**
   Деплой: rsync в новый `releases/<sha>` → переключить симлинк → `systemctl restart`. rsync поверх
   живого каталога при WAL-SQLite и работающем процессе исключён. Детали скрипта — Этап 3.
5. ✅ **Бэкап SQLite — решено (2026-06-30): БД живёт вне релизов.** Схема каталогов:
   `/srv/dexity/{releases/<sha>, data/, .env, current→releases/<sha>}`. `data/db.sqlite3` (+ `-wal`,
   `-shm`) — в `/srv/dexity/data`, симлинком внутрь релиза → деплой физически её не трогает.
   Бэкап — cron + `sqlite3 .backup` (или `cp` при остановленном процессе). → Этап 2.
6. **Секреты.** `.env` живёт **на сервере** (не в CI). В GitHub Secrets — только SSH deploy-ключ
   и хост. Yandex-ключи в CI не нужны (гейт без e2e).

## Этапы

### Этап 0 — Инспекция сервера (read-only) — ✅ выполнено 2026-06-29

- [x] Схема nginx за Xray — разобрана (см. контекст и риск 1)
- [x] Deploy-доступ `my-site` — отдельного CI-ключа нет, только личные ключи
- [x] `node`/`npm` — **не установлены**, ставим на Этапе 2
- [x] DNS `dexity.mvladt.ru` — A-записи нет, заводим на Этапе 2
- [x] certbot — выпущен только `mvladt.ru`, для dexity выпускаем на Этапе 2
- [x] Находки записаны, риски 1–3 уточнены

### Этап 1 — CI (проверки в репозитории) — ✅ выполнено 2026-07-01

- [x] **Миграция SQLite-драйвера на `node:sqlite` + удаление Drizzle** (2026-07-01):
      `db/client.ts` → `DatabaseSync` напрямую; `db/schema.ts` заменён на `db/queries.ts`
      (типизированные функции над prepared statements, `RETURNING` для insert/update);
      `routes/chats.ts` и `routes/messages.ts` переписаны на эти функции; удалены
      `better-sqlite3`, `@types/better-sqlite3`, `drizzle-orm`. Проверено: typecheck зелёный,
      живой dev-сервер (реальные данные в `data/db.sqlite3`) — полный CRUD + cascade delete +
      nullable-поля протестированы вручную через curl и изолированный скрипт
- [x] Добавить npm-скрипты `typecheck` в `client` и `server` (`tsc --noEmit`) — готово
- [x] Сверить фактический выход `npm run build` сервера — подтверждено:
      `dist/server/src/index.js`, совпадает с `package.json`/`deploy/dexity-server.service`
- [x] `.github/workflows/ci.yml`: два job'а (`server`, `client`), push/PR в `main`,
      Node 24 (совпадает с прод-версией), `npm ci` → `typecheck` → `build`. Оба билда
      прогнаны локально с чистым `node_modules` — зелёные
- [x] Прогнать CI на GitHub — зелёный (run [28518845555](https://github.com/mvladt/dexity/actions/runs/28518845555),
      оба job'а `client`/`server` за 16–34с)

### Этап 2 — Первичная настройка прода (ручная, один раз)

- [ ] **Установить Node 24 LTS через NodeSource (apt)** — `/usr/bin/node`, работает из systemd и
      неинтерактивного SSH (nvm отвергли: per-user, грузится через shell-хук, ломает юнит и CD).
      `build-essential`/`python3` НЕ нужны — после ухода на `node:sqlite` нативных модулей нет.
      Сверить glibc сервера (на случай если решим вернуть prebuilt-зависимости)
- [ ] DNS A-запись `dexity.mvladt.ru` → `188.225.37.62`
- [ ] Каталоги на сервере: `/srv/dexity` (релизы, `data/`, `.env`)
- [ ] `.env` на сервере (`NODE_ENV=production`, токены Yandex, `ACCESS_TOKEN`)
- [ ] systemd-юнит (поправить путь энтрипоинта), `enable --now`
- [ ] nginx server-block для `dexity.mvladt.ru` по образцу `mvladt.conf`
      (`listen 127.0.0.1:8443 ssl` + `:80` ACME/redirect + `location /api/` → `:3001`)
- [ ] TLS-сертификат (certbot) для `dexity.mvladt.ru`
- [ ] Проверить Reality-fallback для SNI `dexity.mvladt.ru` (риск 1); при необходимости
      добавить домен в `serverNames` Xray
- [ ] **Первый ручной деплой и проверка живого прода** — до автоматизации

### Этап 3 — CD (workflow выкатки)

- [ ] Сгенерировать SSH deploy-ключ, положить публичный на сервер, приватный — в GitHub Secrets
- [ ] Secrets: `SSH_KEY`, `DEPLOY_HOST` (+ при необходимости jump host)
- [ ] `.github/workflows/deploy.yml` (`workflow_dispatch`):
      build + `npm ci --omit=dev` в CI → rsync `client/dist` + `server/dist` + prod `node_modules`
      (чисто JS после ухода от better-sqlite3) → ssh: `systemctl restart` → healthcheck.
      На сервере `npm` не вызываем — артефакт immutable
- [ ] Решить про атомарность: `releases/<sha>` + симлинк `current` (риск 4)
- [ ] Тестовая выкатка кнопкой, проверка прода

### Этап 4 — Документация и чистка

- [ ] Обновить `deploy/README.md` под новый процесс (CI/CD вместо ручного)
- [ ] Обновить раздел «Деплой» в `server/specs/backend.md`
- [ ] Добавить Dexity в таблицу приложений `~/Projects/MyOwn/server-management/CLAUDE.md` (др. репо)
- [ ] Снять пункт CI/CD в корневом `TODO.md`
- [ ] Перенести этот план + result в `docs/archive/`

## Журнал

- 2026-06-25 — план составлен, решения зафиксированы. Следующий шаг: Этап 0 (инспекция сервера).
- 2026-06-29 — Этап 0 выполнен. Находки: node не установлен, CI-deploy-ключа нет, nginx за
  Xray на `127.0.0.1:8443 ssl`, mvladt.ru — статика. План скорректирован. Следующий шаг: Этап 1 (CI).
- 2026-06-30 — разбор рисков перед стартом. Решения: (1) Reality оставляем — spb это вход личного
  VPN, отказ ломает анти-РКН камуфляж и не упрощает Dexity; (2) подтверждён `node:sqlite`, но
  деплой на **Node 24 LTS** (там API стабилен, без warning'ов); (3) энтрипоинт — спека
  синхронизирована, риск закрыт; (4–5) атомарные релизы `releases/<sha>`+симлинк и БД вне релизов
  (`/srv/dexity/data`) — приняты. Сверился с `server-management`: `spb-reinstall-plan.md` уже
  выполнен (2026-06-10), сервер стабилен — конфликта по таймингу нет, путь свободен.
  Следующий шаг: Этап 1 (CI).
- 2026-07-01 — Этап 1 выполнен (кроме прогона CI на GitHub). По ходу миграции обнаружилось:
  `drizzle-orm/node-sqlite` есть только в 1.0-RC (вышла 3 дня назад), не в стабильной 0.x —
  план «апгрейд Drizzle 0.38→0.45+» оказался технически невозможен. Разбор фактического
  использования показал: 6 статичных CRUD-запросов, Drizzle не давал ничего сверх типизации —
  решили убрать ORM целиком, заменить на `db/queries.ts` (raw SQL + prepared statements +
  RETURNING). Плюс: минус зависимость, минус проблема pre-release версии. Добавлены
  typecheck-скрипты и `.github/workflows/ci.yml`. Всё проверено локально (typecheck, чистая
  сборка, живой CRUD на реальных данных). Запушено (3 коммита), CI на GitHub зелёный
  (run 28518845555). **Этап 1 полностью закрыт.** Следующий шаг: Этап 2 (первичная настройка
  прода — вручную, требует SSH-доступа к spb).
