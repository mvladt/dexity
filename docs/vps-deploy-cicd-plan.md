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
| SQLite-драйвер | **миграция на `node:sqlite`** (встроенный в Node) | убирает нативную зависимость целиком (`better-sqlite3` + `@types`). Мотив — минимализм: нативный API вместо стороннего пакета. Drizzle поддерживает через `drizzle-orm/node-sqlite`; drizzle-kit не нужен. На Node 24 LTS API **стабилен** (не experimental) — поэтому деплоим на 24, не на 22. NB: better-sqlite3 тоже поставляется prebuilt (immutable-артефакт достижим и с ним), так что выбор именно по критерию «−1 зависимость», а не по toolchain |
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
2. **Нативная зависимость убрана.** Уходим с `better-sqlite3` на встроенный `node:sqlite`
   (см. решение). После миграции `node_modules` сервера — чистый JS, можно собрать в CI и
   rsync'нуть как immutable-артефакт. Требует апгрейда `drizzle-orm` 0.38 → 0.45+
   (драйвер `node-sqlite` появился в 0.45) — возможны breaking changes Drizzle.
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

### Этап 1 — CI (проверки в репозитории)

- [ ] **Миграция SQLite-драйвера на `node:sqlite`:**
      апгрейд `drizzle-orm` 0.38 → 0.45+; переписать `db/client.ts` на `node:sqlite` +
      `drizzle-orm/node-sqlite`; тип в `migrate.ts` (`Database` → `DatabaseSync`); удалить
      `better-sqlite3` + `@types/better-sqlite3`. На Node 24 API стабилен → `NODE_NO_WARNINGS`
      не нужен. Проверить typecheck + ручной прогон; сверить Drizzle 0.45+ с Node 24.
      Локально (v22.18) node:sqlite работает с experimental-warning'ом
- [ ] Добавить npm-скрипты `typecheck` в `client` и `server` (`tsc --noEmit`)
- [ ] Сверить фактический выход `npm run build` сервера, согласовать путь энтрипоинта (риск 3)
- [ ] `.github/workflows/ci.yml`: на push/PR в `main` — typecheck + build обоих пакетов
- [ ] Прогнать CI, убедиться что зелёный

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
