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
| Рантайм-зависимости сервера | **ставятся на VPS** (`npm ci --omit=dev`) | `better-sqlite3` — нативный модуль, ABI раннера ≠ ABI сервера |
| Триггер деплоя | **ручной** (`workflow_dispatch`) | Проверки — авто на push в main; выкатка — кнопкой. Позже легко на auto |
| CI-гейт | **typecheck + build** обоих пакетов | Быстро, без секретов и внешних API. e2e — отдельно/позже |
| Домен | `dexity.mvladt.ru` | Уже прописан в `nginx/dexity.conf` и спеке |

## Контекст сервера spb (из `~/Projects/MyOwn/server-management`)

- Доступ: `ssh root@188.225.37.62` по ключу. Из-за рубежа — через AMS как jump host:
  `ssh -J root@147.45.171.176 root@188.225.37.62`.
- **nginx слушает `127.0.0.1:8443` за Xray** (VLESS+Reality на `:443`). `mvladt.ru`,
  `scheduler.push.mvladt.ru`, `webpushtest.mvladt.ru` маршрутизируются через эту схему.
- `mvladt.ru` катится через **GitHub Actions → rsync → `/srv/my-site`** (репо `mvladt/my-site`) —
  это эталон, на который равняемся.
- certbot + cron (автообновление сертификатов). UFW на spb **выключен**.
- PostgreSQL есть, но нам не нужен (у нас SQLite).

## Критические риски / открытые вопросы

1. **nginx за Xray.** Заготовленный `nginx/dexity.conf` с `listen 443 ssl` в лоб **не ляжет** —
   на spb 443 занят Xray, nginx сидит на `127.0.0.1:8443`. Надо понять схему фронтинга и
   встроить `dexity.mvladt.ru` так же, как остальные домены. → Этап 0.
2. **`better-sqlite3` нативный.** Не rsync'им `node_modules` сервера из CI — ставим на VPS
   (`npm ci --omit=dev`), там же он соберётся под платформу сервера.
3. **Путь к энтрипоинту.** `package.json` → `start: node dist/server/src/index.js`, но
   `deploy/dexity-server.service` и спека говорят `dist/index.js`. Из-за `include: ["src", "../shared"]`
   tsc раскладывает в `dist/server/src/...`. Сверить фактический выход `npm run build` и
   согласовать unit + спеку. → Этап 1/2.
4. **Атомарность релизов.** Желательно `releases/<sha>` + симлинк `current` вместо rsync поверх
   живого каталога (иначе юзер может застать полусобранное состояние). Решить на Этапе 3.
5. **Бэкап SQLite.** `data/db.sqlite3` — единственное состояние. Не затирать при деплое; подумать
   о бэкапе. → Этап 2.
6. **Секреты.** `.env` живёт **на сервере** (не в CI). В GitHub Secrets — только SSH deploy-ключ
   и хост. Yandex-ключи в CI не нужны (гейт без e2e).

## Этапы

### Этап 0 — Инспекция сервера (read-only, до любого кода)

- [ ] Схема nginx за Xray: как маршрутизируются домены, куда встроить `dexity.mvladt.ru`
- [ ] Как сделан deploy-доступ для `my-site` (deploy-ключ? пользователь? rsync-таргет?) — переиспользовать паттерн
- [ ] Версии `node`/`npm` на сервере; совместимость с нативной сборкой `better-sqlite3`
- [ ] DNS: есть ли A-запись `dexity.mvladt.ru` → `188.225.37.62`
- [ ] Как certbot выпускает/обновляет сертификаты на этом сервере
- [ ] Записать находки в этот файл, уточнить риски 1–3

### Этап 1 — CI (проверки в репозитории)

- [ ] Добавить npm-скрипты `typecheck` в `client` и `server` (`tsc --noEmit`)
- [ ] Сверить фактический выход `npm run build` сервера, согласовать путь энтрипоинта (риск 3)
- [ ] `.github/workflows/ci.yml`: на push/PR в `main` — typecheck + build обоих пакетов
- [ ] Прогнать CI, убедиться что зелёный

### Этап 2 — Первичная настройка прода (ручная, один раз)

- [ ] DNS A-запись `dexity.mvladt.ru` → `188.225.37.62`
- [ ] Каталоги на сервере: `/srv/dexity` (релизы, `data/`, `.env`)
- [ ] `.env` на сервере (`NODE_ENV=production`, токены Yandex, `ACCESS_TOKEN`)
- [ ] systemd-юнит (поправить путь энтрипоинта), `enable --now`
- [ ] nginx server-block для `dexity.mvladt.ru`, встроенный в схему за Xray
- [ ] TLS-сертификат (certbot) для `dexity.mvladt.ru`
- [ ] **Первый ручной деплой и проверка живого прода** — до автоматизации

### Этап 3 — CD (workflow выкатки)

- [ ] Сгенерировать SSH deploy-ключ, положить публичный на сервер, приватный — в GitHub Secrets
- [ ] Secrets: `SSH_KEY`, `DEPLOY_HOST` (+ при необходимости jump host)
- [ ] `.github/workflows/deploy.yml` (`workflow_dispatch`):
      build → rsync `client/dist` + `server/dist` → ssh: `npm ci --omit=dev` → `systemctl restart` → healthcheck
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
