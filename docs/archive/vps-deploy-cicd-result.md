# Публикация Dexity на VPS с CI/CD — результат

Полный план и журнал решений — `vps-deploy-cicd-plan.md` (архив, рядом).

## Итог

Прод живой: **https://dexity.mvladt.ru** (сервер spb, `188.225.37.62`). Деплой — кнопкой
(`workflow_dispatch`) из вкладки Actions репозитория `mvladt/dexity`.

## Что сделано (сессии 2026-06-25 → 2026-07-02)

- **CI** (`ci.yml`) — typecheck + build на каждый push/PR в `main`
- **CD** (`deploy.yml`) — build → rsync в `releases/<sha>` → атомарное переключение `current` →
  `systemctl restart` → авто-очистка старых релизов → healthcheck без секретов
- **Сервер**: Node 24 LTS, systemd (`dexity-server.service`), nginx за Xray Reality
  (`127.0.0.1:8443`, TLS через `certbot --webroot`), immutable-релизы в `/srv/dexity`
- **Деплой-доступ**: отдельный SSH-ключ только для CI, пользователь `dexity` (не root), узкий
  `sudoers.d` (только рестарт сервиса)
- **YC на проде**: выделенный сервисный аккаунт `dexity-prod` с узкой ролью
  `ai.languageModels.user` (не широкий `editor`, как в dev)

## Существенные отклонения от исходного плана

- **Drizzle ORM убран целиком** (не апгрейд, как планировалось) — `drizzle-orm/node-sqlite`
  существует только в pre-release `1.0.0-rc.4`. Заменён на raw SQL + prepared statements
  (`server/src/db/queries.ts`)
- **AMS jump-host не понадобился** — заметка о нём касалась клиентской сети, не сервера; на spb
  нет geo/IP-фильтрации, раннер GitHub Actions подключается напрямую
- **Reality-fallback пропускает произвольный SNI** без правок конфига Xray — открытый вопрос
  плана закрылся положительно без изменений в VPN-инфраструктуре

## Что осталось за скобками (сознательно)

- Мульти-пользовательская авторизация — отдельная задача, см.
  `docs/multi-user-auth-task.md` (не блокирует текущий прод)
- Бэкапы SQLite (cron + `sqlite3 .backup`) — упомянуты в плане как решение по схеме каталогов,
  но сам cron-джоб не настроен
- Docker — сознательно не используется (см. `CLAUDE.md`)
