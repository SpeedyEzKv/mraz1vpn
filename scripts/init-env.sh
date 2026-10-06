#!/bin/sh
# Создаёт .env со случайными секретами. Существующий .env не трогает.
set -eu
cd "$(dirname "$0")/.."

if [ -f .env ]; then
  echo ".env уже есть — ничего не меняю."
  exit 0
fi

rand() { openssl rand -hex 32; }

sed \
  -e "s/^BOT_WEBHOOK_SECRET=.*/BOT_WEBHOOK_SECRET=$(rand)/" \
  -e "s/^SESSION_SECRET=.*/SESSION_SECRET=$(rand)/" \
  -e "s/^POSTGRES_PASSWORD=.*/POSTGRES_PASSWORD=$(rand)/" \
  -e "s/^APP_DB_PASSWORD=.*/APP_DB_PASSWORD=$(rand)/" \
  -e "s/^SYSTEM_DB_PASSWORD=.*/SYSTEM_DB_PASSWORD=$(rand)/" \
  -e "s/^XUI_USERNAME=.*/XUI_USERNAME=admin$(openssl rand -hex 3)/" \
  -e "s/^XUI_PASSWORD=.*/XUI_PASSWORD=$(rand)/" \
  -e "s/^XUI_BASE_PATH=.*/XUI_BASE_PATH=$(openssl rand -hex 12)/" \
  .env.example > .env
chmod 600 .env

echo "Готово: .env создан. Впишите BOT_TOKEN (nano .env), затем запустите ./scripts/xui-init.sh"
