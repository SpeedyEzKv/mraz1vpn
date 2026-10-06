# Mraz1VPN

Telegram-бот и mini app для VPN-подписок.

## Состав

| Часть | Что внутри |
|---|---|
| `server/` | Node.js 22 + TypeScript: Fastify (API), grammY (бот), Kysely + PostgreSQL |
| `web/` | Mini app: Preact + Vite, своя дизайн-система на CSS-токенах |
| `Caddyfile` | HTTPS (Let's Encrypt), статика mini app, прокси на API |
| `docker-compose.yml` | Postgres, миграции, сервер, Caddy |

## Безопасность данных

- Токен бота, ключи панели и платёжек есть только в `.env` на сервере. В mini app они не попадают.
- Вход: Telegram передаёт `initData`, сервер проверяет подпись токеном бота и свежесть, выдаёт сессию на час. Истекла — клиент молча входит заново.
- Изоляция в базе (Row Level Security): каждый запрос от юзера идёт ролью `mraz_app` с `app.user_id` из подписанной сессии. На каждой таблице RLS включён в режиме FORCE, а политика пропускает только строки владельца. Удалять (`DELETE`) приложению запрещено.
- Бот, вебхуки и фоновые задачи работают ролью `mraz_system`. Пароль администратора БД есть только у одноразового контейнера `migrate`.
- Админы: `ADMIN_IDS` в `.env`. Флаг `isAdmin` вычисляет сервер.
- Тесты изоляции (`server/test/isolation.test.ts`) запускаются на каждый push в GitHub Actions.

## Первый запуск на сервере

Нужно: VPS на Ubuntu 22.04/24.04 за пределами РФ, домен с A-записью на IP сервера.

```sh
# 1. Docker
curl -fsSL https://get.docker.com | sh

# 2. Код
git clone https://github.com/SpeedyEzKv/mraz1vpn.git
cd mraz1vpn

# 3. Секреты: скрипт сгенерирует пароли, вписать нужно только BOT_TOKEN
./scripts/init-env.sh
nano .env

# 4. Запуск
docker compose up -d --build

# 5. Проверка
docker compose ps
curl https://mraz1vpn.ru/api/health      # {"ok":true}
```

Затем откройте бота в Telegram, отправьте `/start` и нажмите «Открыть кабинет».

Обновление после изменений в репозитории:

```sh
git pull && docker compose up -d --build
```

## Разработка локально

```sh
# Postgres
docker run -d --name mraz-pg -e POSTGRES_PASSWORD=dev -p 5432:5432 postgres:16-alpine

cd server && npm install
ADMIN_DATABASE_URL=postgres://postgres:dev@localhost:5432/postgres \
APP_DB_PASSWORD=app SYSTEM_DB_PASSWORD=sys npm run migrate:dev
# .env для разработки: BOT_MODE=polling, APP_DATABASE_URL, SYSTEM_DATABASE_URL и т.д.
npm run dev

cd ../web && npm install && npm run dev
```

Тесты:

```sh
cd server
TEST_ADMIN_DATABASE_URL=postgres://postgres:dev@localhost:5432/postgres npm test
cd ../web && npm run lint:tokens
```

## Дизайн-система

Все цвета, шрифты, отступы и радиусы задаются в `web/src/design/tokens.css`. `npm run lint:tokens` не пропустит сборку, если цвет или шрифт где-то прописан напрямую, и запрещает градиенты, тени, стекло и капс с разрядкой.
