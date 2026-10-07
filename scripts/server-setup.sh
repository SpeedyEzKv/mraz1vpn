#!/bin/sh
# Подготовка чистого сервера Ubuntu 22.04/24.04. Запускать один раз от root.
# Что делает: обновления системы, Docker, swap 2 ГБ, файрвол (22, 80, 443), BBR,
# автоматические обновления безопасности, ежедневный бэкап и еженедельная чистка Docker.
# Повторный запуск безопасен.
set -eu
cd "$(dirname "$0")/.."
ROOT=$(pwd)

[ "$(id -u)" -eq 0 ] || { echo "Запустите от root: sudo $0"; exit 1; }

echo "== Обновление системы"
export DEBIAN_FRONTEND=noninteractive
apt-get update -q
apt-get -y -q -o Dpkg::Options::=--force-confold upgrade
apt-get install -y -q curl git ufw unattended-upgrades ca-certificates

echo "== Docker"
if ! command -v docker >/dev/null 2>&1; then
  curl -fsSL https://get.docker.com | sh
fi
docker compose version >/dev/null 2>&1 || apt-get install -y -q docker-compose-plugin
systemctl enable --now docker >/dev/null

echo "== Swap 2 ГБ (сборка образов на 2 ГБ памяти без него может упасть)"
if ! swapon --show | grep -q .; then
  fallocate -l 2G /swapfile || dd if=/dev/zero of=/swapfile bs=1M count=2048
  chmod 600 /swapfile
  mkswap /swapfile >/dev/null
  swapon /swapfile
  grep -q '^/swapfile' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
fi
sysctl -q -w vm.swappiness=10

echo "== Сеть: BBR (быстрее VPN на плохих каналах)"
cat > /etc/sysctl.d/90-mraz1vpn.conf <<'EOF'
net.core.default_qdisc = fq
net.ipv4.tcp_congestion_control = bbr
vm.swappiness = 10
EOF
sysctl -q --system

echo "== Файрвол: открыты только SSH, 80 и 443"
SSH_PORT=$(grep -oE '^[[:space:]]*Port[[:space:]]+[0-9]+' /etc/ssh/sshd_config 2>/dev/null | grep -oE '[0-9]+' | head -n 1)
SSH_PORT=${SSH_PORT:-22}
ufw allow "$SSH_PORT"/tcp >/dev/null
ufw allow 80/tcp >/dev/null
ufw allow 443/tcp >/dev/null
ufw --force enable >/dev/null

echo "== Автоматические обновления безопасности"
dpkg-reconfigure -f noninteractive unattended-upgrades >/dev/null 2>&1 || true

echo "== Логи Docker и journald не разрастаются"
mkdir -p /etc/systemd/journald.conf.d
printf '[Journal]\nSystemMaxUse=200M\n' > /etc/systemd/journald.conf.d/mraz1vpn.conf
systemctl restart systemd-journald

echo "== Бэкап базы каждый день в 04:20, чистка Docker по воскресеньям"
cat > /etc/cron.d/mraz1vpn <<EOF
SHELL=/bin/sh
PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
20 4 * * * root $ROOT/scripts/backup.sh >> /var/log/mraz1vpn-backup.log 2>&1
40 4 * * 0 root docker image prune -af --filter until=168h >/dev/null 2>&1; docker builder prune -af --filter until=168h >/dev/null 2>&1
EOF
chmod +x "$ROOT"/scripts/*.sh

echo
echo "Сервер готов. Дальше: ./scripts/init-env.sh"
