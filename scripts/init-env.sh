#!/bin/sh
# Создаёт .env: случайные пароли и секреты генерирует сам, IP сервера определяет сам,
# токены бота и CryptoBot спрашивает (ввод не отображается на экране).
# Существующий .env не трогает.
set -eu
cd "$(dirname "$0")/.."

if [ -f .env ]; then
  echo ".env уже есть — ничего не меняю. Поправить вручную: nano .env"
  exit 0
fi

rand() { openssl rand -hex 32; }

ask_secret() {
  # $1 — подсказка. Ввод скрыт.
  printf '%s' "$1" >&2
  stty -echo 2>/dev/null || true
  read -r value || value=""
  stty echo 2>/dev/null || true
  printf '\n' >&2
  printf '%s' "$value"
}

BOT_TOKEN=$(ask_secret 'Токен бота от @BotFather (вида 123456:ABC...): ')
case "$BOT_TOKEN" in
  *:*) ;;
  *) echo "Это не похоже на токен бота. Запустите скрипт ещё раз."; exit 1 ;;
esac
CRYPTOBOT_TOKEN=$(ask_secret 'Токен CryptoBot (Crypto Pay → API Token), Enter — пропустить: ')
YOOKASSA_SHOP_ID=''
YOOKASSA_SECRET_KEY=''

# Внешний IP сервера — по нему подключаются VPN-клиенты. Сначала спрашиваем у внешнего сервиса
# (у некоторых хостеров на сетевой карте частный адрес), иначе берём адрес с сетевой карты.
SERVER_IP=$(curl -4 -fsS --max-time 5 https://api.ipify.org 2>/dev/null || true)
[ -n "$SERVER_IP" ] || SERVER_IP=$(ip -4 route get 1.1.1.1 2>/dev/null | sed -n 's/.* src \([0-9.]*\).*/\1/p' | head -n 1)

# В sed-подстановке экранируем / и &, чтобы токены с такими символами не ломали замену.
esc() { printf '%s' "$1" | sed 's/[\/&]/\\&/g'; }

sed \
  -e "s/^SERVER_IP=.*/SERVER_IP=$(esc "$SERVER_IP")/" \
  -e "s/^BOT_TOKEN=.*/BOT_TOKEN=$(esc "$BOT_TOKEN")/" \
  -e "s/^CRYPTOBOT_TOKEN=.*/CRYPTOBOT_TOKEN=$(esc "$CRYPTOBOT_TOKEN")/" \
  -e "s/^YOOKASSA_SHOP_ID=.*/YOOKASSA_SHOP_ID=$(esc "$YOOKASSA_SHOP_ID")/" \
  -e "s/^YOOKASSA_SECRET_KEY=.*/YOOKASSA_SECRET_KEY=$(esc "$YOOKASSA_SECRET_KEY")/" \
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

echo "Готово: .env создан (IP сервера: $SERVER_IP, домен: $(sed -n 's/^DOMAIN=//p' .env))."
echo "Дальше: ./scripts/deploy.sh"
