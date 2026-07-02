# Деплой Dexity на VPS

Immutable-артефакт: сборка происходит в CI, на сервере — только распаковка и рестарт.
На сервере node-тулчейн не нужен (после ухода с `better-sqlite3` на `node:sqlite` нативных
зависимостей нет).

## Как задеплоить

Вкладка **Actions** репозитория → workflow **Deploy** → **Run workflow** (`workflow_dispatch`,
без параметров). `.github/workflows/deploy.yml` делает всё сам: собирает `server`+`client`,
синкает артефакты в новый `releases/<sha>`, атомарно переключает симлинк `current`, перезапускает
`dexity-server`, чистит старые релизы (оставляет последние 5) и проверяет живой прод
(`GET /` → `200`, `POST /api/auth/verify` → `401`).

CI-гейт (`ci.yml`, typecheck + build) прогоняется отдельно на каждый push/PR в `main` — деплой
им не блокируется автоматически, запускается вручную кнопкой.

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

## Первичная настройка сервера (один раз)

Нужна только при поднятии с нуля (или переносе на другой сервер) — обычный деплой её не требует.

```bash
# Node 24 LTS (NodeSource)
curl -fsSL https://deb.nodesource.com/setup_24.x | bash -
apt install nodejs -y

# каталоги + системный пользователь
mkdir -p /srv/dexity/releases /srv/dexity/data
useradd --system --home /srv/dexity --shell /bin/bash dexity
chown -R dexity:dexity /srv/dexity

# .env — вручную, см. server/.env.example (права 600, владелец dexity)

# systemd
cp deploy/dexity-server.service /etc/systemd/system/
systemctl daemon-reload

# nginx: сначала только :80-блок (ACME), выпустить сертификат, потом полный конфиг
certbot certonly --webroot -w /var/www/html -d dexity.mvladt.ru
cp nginx/dexity.conf /etc/nginx/conf.d/dexity.conf
nginx -t && systemctl reload nginx

# деплой-ключ для CI: отдельный ed25519 (не тот же, что личные ключи!)
# публичный -> /srv/dexity/.ssh/authorized_keys (владелец dexity, права 700/600)
# приватный -> GitHub Secret DEPLOY_SSH_KEY
# host key -> `ssh-keyscan -t ed25519 <host>` -> GitHub Secret DEPLOY_HOST_KEY
# узкий sudo — только рестарт сервиса:
echo 'dexity ALL=(root) NOPASSWD: /usr/bin/systemctl restart dexity-server' \
  > /etc/sudoers.d/dexity-deploy
chmod 440 /etc/sudoers.d/dexity-deploy
```

Первый релиз в `releases/` и симлинк `current` создаёт сам workflow при первом запуске —
вручную ничего катить не нужно.

## Ручной деплой (fallback, если CI/CD недоступен)

```bash
cd server && npm ci && npm run build && npm prune --omit=dev
cd ../client && VITE_API_URL='' npm run build

SHA=$(git rev-parse --short=12 HEAD)
ssh dexity@188.225.37.62 "mkdir -p /srv/dexity/releases/$SHA/server /srv/dexity/releases/$SHA/client"
rsync -az server/dist server/node_modules server/package.json dexity@188.225.37.62:/srv/dexity/releases/$SHA/server/
rsync -az client/dist dexity@188.225.37.62:/srv/dexity/releases/$SHA/client/
ssh dexity@188.225.37.62 "
  ln -sfn /srv/dexity/data /srv/dexity/releases/$SHA/server/data &&
  ln -sfn /srv/dexity/releases/$SHA /srv/dexity/current &&
  sudo systemctl restart dexity-server
"
```

## Логи

```bash
sudo journalctl -u dexity-server -f
```

## Сертификат Let's Encrypt

```bash
sudo certbot certonly --webroot -w /var/www/html -d dexity.mvladt.ru
```

Метод `webroot` — как для `mvladt.ru` (см. `/etc/letsencrypt/renewal/mvladt.ru.conf`), не `--nginx`
плагин: домен терминирует TLS на `127.0.0.1:8443` за Xray Reality fallback, а конфиг лежит в
`/etc/nginx/conf.d/` (не в `sites-enabled/`), поэтому `--nginx` плагин может отредактировать не тот
файл. `:80`-блок в `nginx/dexity.conf` отдаёт `/.well-known/acme-challenge/` из `/var/www/html` —
общий webroot для всех доменов на сервере. Автопродление настроено certbot'ом (истекает
2026-09-30).
