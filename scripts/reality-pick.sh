#!/bin/sh
# Подбирает сайт для маскировки VPN (Reality) прямо с этого сервера и записывает его в .env.
# Запускается из deploy.sh, если REALITY_SERVER_NAME пуст. Можно запустить вручную,
# чтобы сменить сайт: ./scripts/reality-pick.sh && docker compose up -d server
set -eu
cd "$(dirname "$0")/.."

echo "Проверяю сайты для маскировки (около минуты)…"
BEST=$(docker compose run --rm --no-deps -T server node dist/tools/reality-pick.js "$@")
[ -n "$BEST" ] || { echo "Не удалось подобрать сайт."; exit 1; }

if grep -q '^REALITY_SERVER_NAME=' .env; then
  sed -i "s/^REALITY_SERVER_NAME=.*/REALITY_SERVER_NAME=$BEST/" .env
else
  echo "REALITY_SERVER_NAME=$BEST" >> .env
fi
echo "Маскировка: $BEST"
