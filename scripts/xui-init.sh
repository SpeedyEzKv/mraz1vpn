#!/bin/sh
# Первичная настройка панели 3x-ui: логин, пароль и секретный путь из .env,
# выпуск API-токена для сервера (записывается в .env).
# Вызывается из deploy.sh при первом запуске (пока XUI_API_TOKEN пуст).
# Повторный запуск безопасен: токен перевыпускается, старый перестаёт работать.
set -eu
cd "$(dirname "$0")/.."

[ -f .env ] || { echo "Нет .env — сначала ./scripts/init-env.sh"; exit 1; }

get() { sed -n "s/^$1=//p" .env | head -n 1; }
USER_=$(get XUI_USERNAME)
PASS_=$(get XUI_PASSWORD)
BASE_=$(get XUI_BASE_PATH)
[ -n "$USER_" ] && [ -n "$PASS_" ] && [ -n "$BASE_" ] || { echo "В .env не заполнены XUI_USERNAME / XUI_PASSWORD / XUI_BASE_PATH"; exit 1; }

echo "Запускаю панель…"
# 3x-ui работает в сети контейнера edge, поэтому поднимаем оба.
docker compose up -d edge xui
# Ждём, пока панель создаст свою базу.
i=0
until docker compose exec -T xui /app/x-ui setting -show >/dev/null 2>&1; do
  i=$((i + 1)); [ $i -gt 30 ] && { echo "Панель не запустилась: docker compose logs xui"; exit 1; }
  sleep 2
done

docker compose exec -T xui /app/x-ui setting -username "$USER_" -password "$PASS_" -webBasePath "/$BASE_/" >/dev/null
TOKEN=$(docker compose exec -T xui /app/x-ui setting -getApiToken -tokenName mraz1vpn | sed -n 's/^apiToken: *//p' | tr -d '\r')
[ -n "$TOKEN" ] || { echo "Не удалось получить API-токен панели"; exit 1; }

if grep -q '^XUI_API_TOKEN=' .env; then
  sed -i "s/^XUI_API_TOKEN=.*/XUI_API_TOKEN=$TOKEN/" .env
else
  echo "XUI_API_TOKEN=$TOKEN" >> .env
fi

docker compose restart xui >/dev/null
echo "Готово: панель настроена, токен записан в .env."
echo "Панель (с вашего компьютера): ssh -L 2053:127.0.0.1:2053 root@<IP сервера>, затем http://127.0.0.1:2053/$BASE_/"
