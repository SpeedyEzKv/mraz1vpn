#!/bin/sh
# Бэкап: база (pg_dump) и база панели 3x-ui. Хранится 14 последних дней в /var/backups/mraz1vpn.
# Запускается cron'ом каждый день (см. server-setup.sh). Вручную: ./scripts/backup.sh
# Восстановление базы:  docker compose exec -T db pg_restore -U postgres -d mraz1vpn --clean < файл.dump
set -eu
cd "$(dirname "$0")/.."

DIR=/var/backups/mraz1vpn
STAMP=$(date +%Y-%m-%d_%H%M)
mkdir -p "$DIR"
chmod 700 "$DIR"

docker compose exec -T db pg_dump -U postgres -Fc mraz1vpn > "$DIR/db_$STAMP.dump.tmp"
mv "$DIR/db_$STAMP.dump.tmp" "$DIR/db_$STAMP.dump"

# База панели: клиенты и ключи Reality. Без неё после потери сервера у всех сменятся ключи
# (подписки обновятся сами, но лучше не доводить).
docker compose cp xui:/etc/x-ui/x-ui.db "$DIR/xui_$STAMP.db" >/dev/null 2>&1 || true

find "$DIR" -type f -mtime +14 -delete
echo "$(date '+%F %T') бэкап готов: $DIR/db_$STAMP.dump ($(du -h "$DIR/db_$STAMP.dump" | cut -f1))"
