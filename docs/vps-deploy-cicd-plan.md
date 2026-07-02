# Публикация Dexity на VPS с CI/CD — план

Статус: **в работе**. Многосессионная задача. Этот файл — источник правды по контексту и прогрессу.

**Прод живой:** https://dexity.mvladt.ru — деплой через GitHub Actions (`workflow_dispatch`),
кнопкой из вкладки Actions репозитория

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

1. ✅ **nginx за Xray — решено и проверено (2026-07-02).** `nginx/dexity.conf` по образцу
   `mvladt.conf`: `listen 127.0.0.1:8443 ssl; server_name dexity.mvladt.ru;` + блок `:80` для
   ACME/редирект + `location /api/ → proxy_pass 127.0.0.1:3001`. Экспериментально подтверждено:
   Reality-fallback пропускает произвольный SNI (не только из `serverNames`) на fallback dest —
   правки в конфиг Xray не потребовались.
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
6. ✅ **Секреты — решено и выполнено (2026-07-02).** `.env` живёт **на сервере**
   (`/srv/dexity/.env`, права `600`), не в CI. В GitHub Secrets — только `DEPLOY_SSH_KEY` и
   `DEPLOY_HOST_KEY` (host не секрет, захардкожен). Yandex-ключи в CI не нужны (гейт и healthcheck
   без обращения к реальному токену).

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

- [x] **Установить Node 24 LTS через NodeSource (apt)** — готово (2026-07-02): Debian 13 (trixie),
      glibc 2.41, `node v24.18.0`. `build-essential`/`python3` не потребовались (нативных модулей
      нет после ухода на `node:sqlite`)
- [x] DNS A-запись `dexity.mvladt.ru` → `188.225.37.62` — добавлена вручную в Timeweb (2026-07-02),
      резолвится через внешние DNS (1.1.1.1, 8.8.8.8)
- [x] Каталоги на сервере: `/srv/dexity/{releases, data}` + системный пользователь `dexity`
- [x] `.env` на сервере (2026-07-02): `NODE_ENV=production`, новый `ACCESS_TOKEN` (сгенерирован
      отдельно от dev), выделенный YC-сервисный аккаунт `dexity-prod` с узкой ролью
      `ai.languageModels.user` (не переиспользуем широкий `editor` от dev-аккаунта `ai-model-user`),
      `YC_SEARCH_API_KEY` — тот же, что в dev (там уже узкий `dexity-search` SA). Права `600`,
      владелец `dexity`
- [x] systemd-юнит установлен, `enable --now` — сервис активен (`dexity-server.service`)
- [x] nginx server-block для `dexity.mvladt.ru` — установлен двухфазно: сначала только `:80`
      (ACME), затем полный конфиг с `:8443 ssl` после выпуска сертификата (иначе `nginx -t`
      падает на отсутствующих файлах сертификата)
- [x] TLS-сертификат (certbot) — выпущен методом `webroot` (`-w /var/www/html`), как для
      `mvladt.ru` (не `--nginx` плагин — конфиг лежит в `conf.d/`, не в `sites-enabled/`).
      Истекает 2026-09-30, автопродление настроено certbot'ом
- [x] **Проверен Reality-fallback для SNI `dexity.mvladt.ru` (риск 1) — работает без изменений
      в Xray**: `curl --resolve` с этим SNI на `:443` доходит до nginx `:8443` (получен ответ от
      дефолтного vhost на `:8443` ещё до того, как для домена появился `:8443`-блок) →
      Reality пропускает произвольный SNI на fallback dest. Добавлять домен в `serverNames`
      Xray не потребовалось
- [x] **Первый ручной деплой и проверка живого прода** — готово (2026-07-02): собраны локально
      `server`+`client` (чистая сборка, `npm ci --omit=dev` для прод-артефакта сервера),
      разложены в `/srv/dexity/releases/16680f821440/`, симлинки `data`→`/srv/dexity/data` и
      `current`→релиз. Живая проверка: статика `200`, `/api/chats` без токена `401`, с прод-токеном
      `200` и пустой БД `[]`

### Этап 3 — CD (workflow выкатки) — ✅ выполнено 2026-07-02

- [x] Сгенерирован отдельный SSH-ключ (`ed25519`, только для CI). На сервере — не root:
      пользователь `dexity` (владелец `/srv/dexity`), шелл сменён с `nologin` на `bash`, ключ в
      `~/.ssh/authorized_keys`, узкий `sudoers.d`: `NOPASSWD` только на
      `systemctl restart dexity-server`, всё остальное через sudo требует пароль (проверено —
      `sudo cat /etc/shadow` отклонён). Приватный ключ удалён с локальной машины после загрузки
      секрета
- [x] Проверено: firewall на spb (`iptables -L`) не режет по IP/гео — прямое SSH-подключение
      работает и от раннера GitHub Actions, jump-хост через AMS не понадобился (та заметка была
      актуальна для клиентской сети, не для сервера)
- [x] Secrets в GitHub: `DEPLOY_SSH_KEY`, `DEPLOY_HOST_KEY` (пиннинг host key через
      `ssh-keyscan`, без `StrictHostKeyChecking=no`). Host/user/root — не секрет, захардкожены в
      workflow (`188.225.37.62`, `dexity`, `/srv/dexity`)
- [x] `.github/workflows/deploy.yml` (`workflow_dispatch`): build (`npm ci` → `npm run build` →
      `npm prune --omit=dev` для сервера, `VITE_API_URL='' npm run build` для клиента) → rsync в
      `releases/<sha>` → на сервере: симлинки `data`/`current` → `sudo systemctl restart` →
      очистка старых релизов (оставляет последние 5) → healthcheck (`POST /api/auth/verify`
      ожидает `401` — сервер жив, токен намеренно неверный, секрет в CI не нужен; `GET /`
      ожидает `200`)
- [x] Тестовая выкатка кнопкой — зелёная за 49с (run
      [28596778955](https://github.com/mvladt/dexity/actions/runs/28596778955)), прод обновился
      на `35c6106f8b85`, старый релиз `16680f821440` сохранён под авто-очисткой

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
- 2026-07-02 — Этап 2 выполнен полностью. Локальные deploy-конфиги (`nginx/dexity.conf`,
  `deploy/dexity-server.service`, `deploy/README.md`) синхронизированы с решениями плана (были
  под старую модель `git clone`+build на сервере). На spb: Node 24.18.0 (NodeSource), каталоги
  `/srv/dexity/{releases,data}` + системный пользователь `dexity`, DNS A-запись добавлена вручную
  в веб-панели Timeweb (`dexity.mvladt.ru → 188.225.37.62`; `yc` CLI для этого не подходит —
  DNS регистратора не относится к Yandex Cloud). `.env` на сервере: новый `ACCESS_TOKEN`,
  выделенный YC service account `dexity-prod` (роль `ai.languageModels.user`, без широкого
  `editor`, который используется в dev-аккаунте `ai-model-user`) — создан через `yc iam
  service-account create` + `yc resource-manager folder add-access-binding` + `yc iam api-key
  create` (весь процесс через `yc` CLI, без браузера). `YC_SEARCH_API_KEY` — тот же, что в dev
  (уже узкий `dexity-search` SA). TLS-сертификат — `certbot certonly --webroot` (тот же метод,
  что для `mvladt.ru`, не `--nginx` плагин — конфиг лежит в `conf.d/`, не в `sites-enabled/`).
  nginx-конфиг применён двухфазно (сначала только `:80` для ACME, потом полный конфиг с
  `:8443 ssl` — иначе `nginx -t` падает на отсутствующих файлах сертификата). Reality-fallback
  экспериментально пропускает произвольный SNI — риск 1 закрыт без правок Xray. Первый ручной
  деплой: локальная чистая сборка `server`+`client` → rsync в `/srv/dexity/releases/<sha>` →
  симлинки `data`/`current` → `systemctl enable --now`. Живая проверка: статика 200, API 401 без
  токена / 200 с прод-токеном, пустая БД. **Прод живой: https://dexity.mvladt.ru.**
  **Этап 2 полностью закрыт.** Следующий шаг: Этап 3 (CD — workflow автоматической выкатки).
- 2026-07-02 — Этап 3 выполнен полностью, сразу следом за Этапом 2. Перед генерацией deploy-ключа
  перепроверил риск с jump-хостом AMS: `iptables -L` на spb — `INPUT policy ACCEPT`, правил нет,
  никакого geo/IP-фильтра. Прямое SSH с раннера GitHub Actions отработало с первого раза — заметка
  «из-за рубежа нужен jump host» относится к клиентской сети (личный ISP/роутинг), не к серверу.
  Ключ на CI — отдельный, не root: пользователь `dexity` получил `bash`-шелл и узкий `sudoers.d`
  (`NOPASSWD` только на `systemctl restart dexity-server`, проверено что остальной sudo просит
  пароль). Host key запиннен через `ssh-keyscan` в секрет, не `StrictHostKeyChecking=no`.
  `.github/workflows/deploy.yml`: build → `npm prune --omit=dev` → rsync в `releases/<sha>` →
  симлинки → restart → авто-очистка старых релизов (оставляет 5) → healthcheck без секретов
  (`POST /api/auth/verify` ожидает `401` — сам факт ответа подтверждает, что процесс жив).
  Тестовый прогон кнопкой — зелёный за 49с (run 28596778955), прод обновился корректно.
  **Этап 3 полностью закрыт.** Остался только Этап 4 (документация/чистка, низкий приоритет).
