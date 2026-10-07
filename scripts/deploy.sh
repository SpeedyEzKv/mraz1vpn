#!/bin/sh
# Запуск и обновление. Первый раз — после server-setup.sh и init-env.sh.
# Обновление после изменений в репозитории: git pull && ./scripts/deploy.sh
set -eu
cd "$(dirname "$0")/.."

[ -f .env ] || { echo "Нет .env — сначала ./scripts/init-env.sh"; exit 1; }
get() { sed -n "s/^$1=//p" .env | head -n 1; }
DOMAIN=$(get DOMAIN)
SERVER_IP=$(get SERVER_IP)

# Сертификат Let's Encrypt выдадут, только если домен уже указывает на этот сервер.
# Иначе Caddy будет безуспешно пытаться и упрётся в лимиты Let's Encrypt.
RESOLVED=$(getent ahostsv4 "$DOMAIN" | awk '{ print $1; exit }')
if [ "$RESOLVED" != "$SERVER_IP" ] && [ "${SKIP_DNS_CHECK:-}" != "1" ]; then
  echo "Домен $DOMAIN указывает на ${RESOLVED:-ничего}, а IP сервера — $SERVER_IP."
  echo "У регистратора домена создайте A-запись: имя @, значение $SERVER_IP."
  echo "Обычно она начинает работать за 5–30 минут. Потом запустите этот скрипт снова."
  exit 1
fi

echo "== Сборка образов (первый раз — несколько минут)"
docker compose build --pull

if [ -z "$(get REALITY_SERVER_NAME)" ]; then
  echo "== Подбор сайта для маскировки VPN"
  ./scripts/reality-pick.sh
fi

if [ -z "$(get XUI_API_TOKEN)" ]; then
  echo "== Первичная настройка панели 3x-ui"
  ./scripts/xui-init.sh
fi

echo "== Запуск"
docker compose up -d --remove-orphans

echo "== Проверка"
i=0
until curl -fsS --max-time 5 "https://$DOMAIN/api/health" >/dev/null 2>&1; do
  i=$((i + 1))
  if [ $i -gt 36 ]; then
    echo "Сайт не отвечает за 3 минуты. Смотрите логи: docker compose logs --tail 50 caddy server"
    exit 1
  fi
  sleep 5
done
echo "Сайт и API: ok (https://$DOMAIN)"

i=0
until docker compose logs server 2>/dev/null | grep -q 'inbound’ы готовы'; do
  i=$((i + 1))
  if [ $i -gt 24 ]; then
    echo "Сервер не дождался панели 3x-ui. Логи: docker compose logs --tail 50 server xui"
    exit 1
  fi
  sleep 5
done
echo "VPN (3x-ui): ok, маскировка под $(get REALITY_SERVER_NAME)"

docker compose ps --format 'table {{.Service}}\t{{.Status}}'
echo
echo "Готово. Откройте @$(get BOT_USERNAME) в Telegram и отправьте /start."
if [ -n "$(get CRYPTOBOT_TOKEN)" ]; then
  echo "CryptoBot: @CryptoBot → Crypto Pay → My Apps → ваше приложение → Webhooks → https://$DOMAIN/pay/cryptobot"
fi
