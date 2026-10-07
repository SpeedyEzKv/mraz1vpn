# Mraz1VPN

Telegram-бот и mini app для VPN-подписок.

## Состав

| Часть | Что внутри |
|---|---|
| `server/` | Node.js 22 + TypeScript: Fastify (API), grammY (бот), Kysely + PostgreSQL, pg-boss (фоновые задачи) |
| `web/` | Mini app: Preact + Vite, своя дизайн-система на CSS-токенах |
| `Caddyfile` | HTTPS (Let's Encrypt), статика mini app, прокси на API и ссылки подписки |
| `docker-compose.yml` | Postgres, миграции, сервер, Caddy, 3x-ui (Xray) |

## Как устроен VPN

Всё на одном VPS (Ubuntu 24.04, Нидерланды). Снаружи открыты только 22, 80 и 443.

```
                 ┌─ SNI = mraz1vpn.online ─▶ Caddy:8443 ▶ сайт, mini app, API, /sub, /pay
клиент ──443──▶ edge (nginx, по имени сайта, без расшифровки)
                 └─ любое другое имя ───────▶ Xray 127.0.0.1:4443, inbound mraz-vision
                                               (VLESS + TCP + Reality + Vision)
                                               ├─ VLESS-TCP .............. VPN
                                               ├─ HTTP/2 (XHTTP) ......... fallback ▶ mraz-xhttp ▶ VPN
                                               └─ не прошёл Reality ...... ▶ настоящий сайт-маска
```

- **Маскировка.** Reality выдаёт себя за крупный иностранный сайт (`REALITY_SERVER_NAME`,
  подбирает `scripts/reality-pick.sh` с самого сервера: TLS 1.3, HTTP/2, X25519, наименьшая задержка).
  Кто постучится на 443 с этим именем без ключа, увидит настоящий сайт.
- **Клиенты подключаются по IP**, а не по домену: если домен заблокируют, VPN продолжит работать.
- **IP клиента** edge передаёт по PROXY protocol в Xray и Caddy. 3x-ui работает в сетевом пространстве
  edge, поэтому лимит устройств (fail2ban) банит лишний IP прямо на входе.
- У каждого ключа две ссылки: основная (TCP Vision) и запасная (XHTTP).
- Inbound'ы сервер создаёт в панели сам. Если поменять маскировку или порт в `.env`, сервер при запуске
  перенесёт настройки в существующий inbound — ключи Reality и клиенты сохраняются.
- Ссылку подписки (`https://mraz1vpn.online/sub/<токен>`) отдаёт наш сервер: срок из нашей базы,
  ссылку можно сбросить в кабинете, панель наружу не открыта.
- Источник правды — наша база. Клиент в панели (`tg<telegram_id>`, лимит 3 устройства) обновляется
  сразу, сверка раз в 5 минут догоняет то, что не долетело (раз в 6 часов — полная).

## Безопасность данных

- Токен бота, ключи панели и платёжек есть только в `.env` на сервере. В mini app они не попадают.
- Вход: Telegram передаёт `initData`, сервер проверяет подпись токеном бота и свежесть, выдаёт сессию на час. Истекла — клиент молча входит заново.
- Изоляция в базе (Row Level Security): каждый запрос от юзера идёт ролью `mraz_app` с `app.user_id` из подписанной сессии. На каждой таблице RLS включён в режиме FORCE, а политика пропускает только строки владельца. Удалять (`DELETE`) приложению запрещено.
- Бот, вебхуки и фоновые задачи работают ролью `mraz_system`. Пароль администратора БД есть только у одноразового контейнера `migrate`.
- Админы: `ADMIN_IDS` в `.env`. Флаг `isAdmin` вычисляет сервер.
- Тесты изоляции (`server/test/isolation.test.ts`) запускаются на каждый push в GitHub Actions.

## Первый запуск на сервере

Нужно: VPS с Ubuntu 22.04/24.04 за пределами РФ (2 ГБ памяти, от 10 ГБ диска) и домен,
у которого A-запись `@` указывает на IP сервера.

С вашего компьютера (PowerShell или терминал):

```sh
ssh root@46.17.98.234
```

На сервере:

```sh
# 1. Код
apt-get update && apt-get install -y git
git clone https://github.com/SpeedyEzKv/mraz1vpn.git
cd mraz1vpn

# 2. Система: Docker, swap, файрвол, BBR, автообновления, бэкапы по расписанию
./scripts/server-setup.sh

# 3. Настройки: спросит токен бота и CryptoBot, остальное сгенерирует сам
./scripts/init-env.sh

# 4. Запуск: проверит домен, соберёт образы, подберёт маскировку,
#    настроит панель 3x-ui, запустит всё и проверит, что сайт и VPN отвечают
./scripts/deploy.sh
```

Обновление после изменений в репозитории:

```sh
cd ~/mraz1vpn && git pull && ./scripts/deploy.sh
```

Полезное:

```sh
docker compose ps                         # что запущено
docker compose logs --tail 100 server     # логи сервера (бот, оплаты, сверка)
./scripts/backup.sh                       # бэкап вручную (обычно — сам, каждый день в 04:20)
ls /var/backups/mraz1vpn                  # бэкапы за 14 дней
./scripts/reality-pick.sh && docker compose up -d server   # сменить сайт-маску
```

Бэкапы лежат на том же сервере. Раз в неделю-две скачивайте свежий себе:
`scp root@46.17.98.234:/var/backups/mraz1vpn/db_*.dump .`

### Оплата

Тарифы — `server/src/payments/plans.ts` (1 мес. 100 ₽, 3 мес. 249 ₽, 6 мес. 449 ₽, год 799 ₽).
Способ оплаты без ключей в `.env` просто не показывается в кабинете.

**ЮKassa (СБП и карта).** Магазин самозанятого: чек в «Мой налог» ЮKassa отправляет сама,
в чек попадает описание платежа («Доступ к VPN-сервису Mraz1VPN на 3 месяца»).

1. Личный кабинет ЮKassa → Интеграция → Ключи API: `shopId` и секретный ключ → `YOOKASSA_SHOP_ID`, `YOOKASSA_SECRET_KEY`.
2. Интеграция → HTTP-уведомления: URL `https://mraz1vpn.online/pay/yookassa`, события `payment.succeeded` и `payment.canceled`.
3. В настройках магазина должны быть включены СБП и банковские карты.

**CryptoBot (USDT, TON и др.).** Счёт выставляется в рублях, CryptoBot пересчитывает по курсу.

1. @CryptoBot → Crypto Pay → Create App → токен → `CRYPTOBOT_TOKEN`.
2. Там же Webhooks → включить, URL `https://mraz1vpn.online/pay/cryptobot`.
3. Для проверки без денег: @CryptoTestnetBot, его токен и `CRYPTOBOT_TESTNET=true`.

После правки `.env`: `docker compose up -d server`.

Как подтверждается оплата: телу вебхука ЮKassa сервер не верит, а перезапрашивает платёж у ЮKassa своим ключом;
у CryptoBot проверяется подпись. Сумма сверяется с тарифом. Если уведомление потерялось, раз в минуту
сервер сам опрашивает провайдеров по неоплаченным счетам. Продление срабатывает ровно один раз на платёж,
дни добавляются к концу текущей подписки (или от сегодня, если она уже закончилась).

Напоминания в боте: за 3 дня и за 1 день до конца подписки (для пробного периода — только за 1 день)
и в момент окончания.

### Панель 3x-ui

Наружу панель не открыта, только через SSH-туннель с вашего компьютера:

```sh
ssh -L 2053:127.0.0.1:2053 root@<IP сервера>
# в браузере: http://127.0.0.1:2053/<XUI_BASE_PATH из .env>/
# логин и пароль: XUI_USERNAME и XUI_PASSWORD из .env
```

В панели можно смотреть трафик и онлайн. Клиентов и inbound'ы `mraz-*` руками не меняйте: сверка вернёт их к состоянию базы.

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
# .env для разработки: BOT_MODE=polling, APP_DATABASE_URL, SYSTEM_DATABASE_URL,
# XUI_URL и XUI_API_TOKEN тестовой панели 3x-ui, REALITY_TARGET и т.д.
npm run dev

cd ../web && npm install && npm run dev
```

Тесты:

```sh
cd server
TEST_ADMIN_DATABASE_URL=postgres://postgres:dev@localhost:5432/postgres npm test
# + проверка на живой тестовой панели 3x-ui (в CI пропускается):
XUI_TEST_URL=http://127.0.0.1:2053/<путь>/ XUI_TEST_TOKEN=<токен> npm test
cd ../web && npm run lint:tokens && npm test
```

## Дизайн-система

Все цвета, шрифты, отступы и радиусы задаются в `web/src/design/tokens.css`. `npm run lint:tokens` не пропустит сборку, если цвет или шрифт где-то прописан напрямую, и запрещает градиенты, тени, стекло и капс с разрядкой.
