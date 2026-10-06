-- 003: оплата (ЮKassa, CryptoBot) и напоминания об окончании подписки.

-- Платёж. Создаёт и меняет только сервер; юзер видит свои (чтобы кабинет показал статус).
CREATE TABLE payments (
  id                  bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id             bigint NOT NULL REFERENCES users(id),
  provider            text NOT NULL CHECK (provider IN ('yookassa', 'cryptobot')),
  plan                text NOT NULL,
  days                int NOT NULL CHECK (days > 0),
  amount_kop          int NOT NULL CHECK (amount_kop > 0),
  status              text NOT NULL DEFAULT 'pending'
                      CHECK (status IN ('pending', 'succeeded', 'canceled', 'expired', 'failed')),
  provider_payment_id text,
  pay_url             text,
  created_at          timestamptz NOT NULL DEFAULT now(),
  paid_at             timestamptz,
  -- Когда оплата превратилась в дни подписки. Ставится один раз — повторный вебхук ничего не продлит.
  applied_at          timestamptz,
  UNIQUE (provider, provider_payment_id)
);
CREATE INDEX payments_user_id_idx ON payments(user_id);
CREATE INDEX payments_pending_idx ON payments(created_at) WHERE status = 'pending';

-- Отправленные напоминания: одно на (подписку, вид, срок). Продлили — срок другой, напомним снова.
CREATE TABLE reminders (
  id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id         bigint NOT NULL REFERENCES users(id),
  subscription_id bigint NOT NULL REFERENCES subscriptions(id),
  kind            text NOT NULL CHECK (kind IN ('3d', '1d', 'expired')),
  expires_at      timestamptz NOT NULL,
  sent_at         timestamptz NOT NULL DEFAULT now(),
  UNIQUE (subscription_id, kind, expires_at)
);

ALTER TABLE payments  ENABLE ROW LEVEL SECURITY;
ALTER TABLE payments  FORCE  ROW LEVEL SECURITY;
ALTER TABLE reminders ENABLE ROW LEVEL SECURITY;
ALTER TABLE reminders FORCE  ROW LEVEL SECURITY;

CREATE POLICY payments_owner_read ON payments
  FOR SELECT TO mraz_app
  USING (user_id = app.current_user_id());

CREATE POLICY reminders_owner_read ON reminders
  FOR SELECT TO mraz_app
  USING (user_id = app.current_user_id());

GRANT SELECT ON payments, reminders TO mraz_app;
GRANT SELECT, INSERT, UPDATE ON payments, reminders TO mraz_system;
