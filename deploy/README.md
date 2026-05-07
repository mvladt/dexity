# Деплой Dexity на VPS

## Первый деплой

```bash
# 1. Клонировать репо
git clone <repo> /var/www/dexity
cd /var/www/dexity

# 2. Установить зависимости и собрать сервер
cd server
npm ci
npm run build

# 3. Настроить .env
cp .env.example .env
nano .env   # заполнить все переменные (NODE_ENV=production)

# 4. Создать папку для БД
mkdir -p data

# 5. Собрать фронт
cd ../client
npm ci
VITE_API_URL='' npm run build   # на проде апи — тот же домен

# 6. Установить systemd unit
sudo cp /var/www/dexity/deploy/dexity-server.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now dexity-server

# 7. Установить конфиг Nginx
sudo cp /var/www/dexity/nginx/dexity.conf /etc/nginx/sites-available/dexity
sudo ln -s /etc/nginx/sites-available/dexity /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
```

## Обновление

```bash
cd /var/www/dexity
git pull
cd server && npm ci && npm run build && sudo systemctl restart dexity-server
cd ../client && npm ci && npm run build
```

## Логи

```bash
sudo journalctl -u dexity-server -f
```

## Сертификат Let's Encrypt

```bash
sudo certbot --nginx -d dexity.mvladt.ru
```
