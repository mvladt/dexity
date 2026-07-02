# Деплой Dexity на VPS

Immutable-артефакт: сборка происходит в CI, на сервере — только распаковка и рестарт.
На сервере node-тулчейн не нужен (после ухода с `better-sqlite3` на `node:sqlite` нативных
зависимостей нет).

## Структура на сервере

```
/srv/dexity/
├── releases/
│   └── <git-sha>/
│       ├── server/   # dist/ + node_modules (prod) + package.json
│       └── client/dist/
├── data/              # db.sqlite3 (+ -wal, -shm) — вне релизов, деплой её не трогает
├── .env               # общий для всех релизов, вне releases/
└── current -> releases/<git-sha>
```

Каждый релиз содержит симлинк `server/data -> /srv/dexity/data`, поэтому
`DATABASE_PATH=./data/db.sqlite3` в `.env` остаётся неизменным между релизами.

## Первый ручной деплой (Этап 2 — до автоматизации CD)

```bash
# Локально: собрать оба пакета
cd server && npm ci && npm run build
cd ../client && VITE_API_URL='' npm run build   # на проде api — тот же домен

# На сервере: подготовить релиз
ssh spb 'mkdir -p /srv/dexity/releases/<sha>/server /srv/dexity/releases/<sha>/client'

# Синхронизировать артефакты (с локальной машины)
rsync -az server/dist server/node_modules server/package.json spb:/srv/dexity/releases/<sha>/server/
rsync -az client/dist spb:/srv/dexity/releases/<sha>/client/

# На сервере: симлинки и .env (один раз — если ещё не создан)
ssh spb '
  ln -sfn /srv/dexity/data /srv/dexity/releases/<sha>/server/data
  ln -sfn /srv/dexity/releases/<sha> /srv/dexity/current
  mkdir -p /srv/dexity/data
'
# .env создаётся вручную один раз в /srv/dexity/.env (см. server/.env.example)

# systemd + nginx (один раз)
sudo cp deploy/dexity-server.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now dexity-server

sudo cp nginx/dexity.conf /etc/nginx/conf.d/dexity.conf
sudo nginx -t && sudo systemctl reload nginx
```

## Обновление (после первого деплоя, вручную)

```bash
# повторить шаги "подготовить релиз" + "синхронизировать артефакты" с новым <sha>
ssh spb '
  ln -sfn /srv/dexity/data /srv/dexity/releases/<sha>/server/data
  ln -sfn /srv/dexity/releases/<sha> /srv/dexity/current
  systemctl restart dexity-server
'
```

Этап 3 плана (`docs/vps-deploy-cicd-plan.md`) заменит эти шаги на GitHub Actions workflow
(`workflow_dispatch`) — ручных команд на сервере не останется.

## Логи

```bash
sudo journalctl -u dexity-server -f
```

## Сертификат Let's Encrypt

```bash
sudo certbot certonly --nginx -d dexity.mvladt.ru
```

Домен резолвится за Xray Reality fallback (`127.0.0.1:8443`, не в `sites-enabled`,
конфиг — в `/etc/nginx/conf.d/`), поэтому `--nginx` плагин можно использовать только
если certbot видит серверный блок `:80` для ACME-challenge — он есть в `nginx/dexity.conf`.
