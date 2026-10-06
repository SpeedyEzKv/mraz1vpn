-- 002: выдача ключей и пробный период.

-- Пробный период — один раз на Telegram-аккаунт. Ставит только сервер (mraz_system):
-- в GRANT UPDATE для mraz_app этой колонки нет.
ALTER TABLE users ADD COLUMN trial_used_at timestamptz;

-- UUID клиента VLESS. Ключ = (uuid в Xray, токен ссылки подписки). Перевыпуск ключа —
-- новая строка, старая получает revoked_at.
ALTER TABLE vpn_keys ADD COLUMN xray_uuid uuid NOT NULL DEFAULT gen_random_uuid();
ALTER TABLE vpn_keys ADD CONSTRAINT vpn_keys_xray_uuid_key UNIQUE (xray_uuid);

-- Подписка на юзера — одна; срок продлевается в той же строке.
ALTER TABLE subscriptions ADD COLUMN device_limit int NOT NULL DEFAULT 3 CHECK (device_limit BETWEEN 1 AND 10);
CREATE UNIQUE INDEX subscriptions_one_per_user ON subscriptions(user_id) WHERE status <> 'archived';

-- Действующий ключ у подписки — один.
CREATE UNIQUE INDEX vpn_keys_one_active ON vpn_keys(subscription_id) WHERE revoked_at IS NULL;

-- Когда клиент в 3x-ui последний раз приведён в соответствие с базой (для сверки).
ALTER TABLE vpn_keys ADD COLUMN panel_synced_at timestamptz;

-- Схема для очереди задач pg-boss. Таблицы в ней создаёт сам pg-boss под ролью mraz_system.
-- Права на создание объектов в базе у mraz_system нет — только в этой схеме.
CREATE SCHEMA IF NOT EXISTS pgboss AUTHORIZATION mraz_system;

-- Время последнего изменения подписки: сверка с панелью берёт подписки, изменённые после неё.
ALTER TABLE subscriptions ADD COLUMN updated_at timestamptz NOT NULL DEFAULT now();
