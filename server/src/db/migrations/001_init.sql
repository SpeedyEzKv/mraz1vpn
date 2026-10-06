-- 001: базовые таблицы и изоляция по владельцу (Row Level Security).
--
-- Роли (создаются в migrate.ts до этой миграции):
--   mraz_app    — запросы от имени юзера из mini app. RLS действует, DELETE запрещён.
--   mraz_system — бот, вебхуки оплат, фоновые задачи. BYPASSRLS, используется только сервером.
-- Владелец таблиц — администратор БД; ни одна из ролей приложения не владеет таблицами.

CREATE SCHEMA IF NOT EXISTS app;

-- Текущий юзер берётся из переменной транзакции app.user_id.
-- Не задана → NULL → политика не пропускает ни одной строки.
CREATE OR REPLACE FUNCTION app.current_user_id() RETURNS bigint
LANGUAGE sql STABLE AS $$
  SELECT nullif(current_setting('app.user_id', true), '')::bigint
$$;

GRANT USAGE ON SCHEMA app TO mraz_app, mraz_system;
GRANT EXECUTE ON FUNCTION app.current_user_id() TO mraz_app, mraz_system;

-- Юзеры. id = telegram_id: он уже уникален и проверен подписью Telegram.
CREATE TABLE users (
  id            bigint PRIMARY KEY CHECK (id > 0),
  username      text,
  first_name    text,
  last_name     text,
  language_code text,
  is_premium    boolean NOT NULL DEFAULT false,
  created_at    timestamptz NOT NULL DEFAULT now(),
  last_seen_at  timestamptz NOT NULL DEFAULT now()
);

-- Подписки. Ничего не удаляется: истёкшие уходят в статус archived.
CREATE TABLE subscriptions (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id     bigint NOT NULL REFERENCES users(id),
  status      text NOT NULL CHECK (status IN ('trial', 'active', 'expired', 'archived')),
  expires_at  timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now(),
  archived_at timestamptz
);
CREATE INDEX subscriptions_user_id_idx ON subscriptions(user_id);

-- Ключи (ссылки подписки). Отозванный ключ не удаляется, у него ставится revoked_at.
CREATE TABLE vpn_keys (
  id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id         bigint NOT NULL REFERENCES users(id),
  subscription_id bigint NOT NULL REFERENCES subscriptions(id),
  sub_token       text NOT NULL UNIQUE,
  created_at      timestamptz NOT NULL DEFAULT now(),
  revoked_at      timestamptz
);
CREATE INDEX vpn_keys_user_id_idx ON vpn_keys(user_id);

-- RLS включён и принудителен (FORCE) на каждой таблице.
ALTER TABLE users         ENABLE ROW LEVEL SECURITY;
ALTER TABLE users         FORCE  ROW LEVEL SECURITY;
ALTER TABLE subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE subscriptions FORCE  ROW LEVEL SECURITY;
ALTER TABLE vpn_keys      ENABLE ROW LEVEL SECURITY;
ALTER TABLE vpn_keys      FORCE  ROW LEVEL SECURITY;

-- users: юзер видит и правит только свою строку и может создать только себя.
CREATE POLICY users_owner ON users
  FOR ALL TO mraz_app
  USING (id = app.current_user_id())
  WITH CHECK (id = app.current_user_id());

-- subscriptions и vpn_keys: юзер только читает свои. Пишет их только сервер (mraz_system).
CREATE POLICY subscriptions_owner_read ON subscriptions
  FOR SELECT TO mraz_app
  USING (user_id = app.current_user_id());

CREATE POLICY vpn_keys_owner_read ON vpn_keys
  FOR SELECT TO mraz_app
  USING (user_id = app.current_user_id());

-- Права: минимально необходимые. DELETE не выдаётся никому из приложения.
GRANT SELECT, INSERT ON users TO mraz_app;
GRANT UPDATE (username, first_name, last_name, language_code, is_premium, last_seen_at) ON users TO mraz_app;
GRANT SELECT ON subscriptions, vpn_keys TO mraz_app;

GRANT SELECT, INSERT, UPDATE ON users, subscriptions, vpn_keys TO mraz_system;
