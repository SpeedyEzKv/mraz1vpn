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

Всё на одном VPS. Порт 443 принадлежит Xray (контейнер `xui`, панель 3x-ui v3.9):

```
клиент VPN ──443──▶ Xray, inbound mraz-vision (VLESS + TCP + Reality + Vision)
                     ├─ внутри VLESS-TCP ......... VPN
                     ├─ внутри HTTP/2 (XHTTP) .... fallback ▶ mraz-xhttp (127.0.0.1:10443) ▶ VPN
                     └─ не Reality (браузер, Telegram) ▶ Caddy:8443 ▶ сайт и mini app
```

- Reality маскируется под наш же домен: снаружи mraz1vpn.ru выглядит обычным сайтом с настоящим сертификатом.
- У каждого ключа две ссылки: основная (TCP Vision) и запасная (XHTTP) — если первую начнут резать.
- Inbound'ы сервер создаёт в панели сам при первом запуске. Руками в панели ничего настраивать не нужно.
- Ссылку подписки (`https://mraz1vpn.ru/sub/<токен>`) отдаёт наш сервер, а не панель: срок берётся из нашей базы, ссылку можно сбросить в кабинете, панель наружу не открыта.
- Источник правды — наша база. Клиент в панели (`tg<telegram_id>`, лимит 3 устройства) обновляется сразу после изменения, а раз в 5 минут сверка догоняет всё, что не долетело (раз в 6 часов — полная сверка всех юзеров).

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

# 4. Панель 3x-ui: логин, пароль, секретный путь и API-токен для сервера
./scripts/xui-init.sh

# 5. Запуск
docker compose up -d --build

# 6. Проверка
docker compose ps
curl https://mraz1vpn.ru/api/health      # {"ok":true}
docker compose logs server | grep "inbound"   # vpn: inbound’ы готовы
```

Файрвол: снаружи нужны только 22 (SSH), 80 и 443 (TCP).

```sh
ufw allow 22/tcp && ufw allow 80/tcp && ufw allow 443/tcp && ufw enable
```

### Оплата

Тарифы — `server/src/payments/plans.ts` (1 мес. 100 ₽, 3 мес. 249 ₽, 6 мес. 449 ₽, год 799 ₽).
Способ оплаты без ключей в `.env` просто не показывается в кабинете.

**ЮKassa (СБП и карта).** Магазин самозанятого: чек в «Мой налог» ЮKassa отправляет сама,
в чек попадает описание платежа («Доступ к VPN-сервису Mraz1VPN на 3 месяца»).

1. Личный кабинет ЮKassa → Интеграция → Ключи API: `shopId` и секретный ключ → `YOOKASSA_SHOP_ID`, `YOOKASSA_SECRET_KEY`.
2. Интеграция → HTTP-уведомления: URL `https://mraz1vpn.ru/pay/yookassa`, события `payment.succeeded` и `payment.canceled`.
3. В настройках магазина должны быть включены СБП и банковские карты.

**CryptoBot (USDT, TON и др.).** Счёт выставляется в рублях, CryptoBot пересчитывает по курсу.

1. @CryptoBot → Crypto Pay → Create App → токен → `CRYPTOBOT_TOKEN`.
2. Там же Webhooks → включить, URL `https://mraz1vpn.ru/pay/cryptobot`.
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
