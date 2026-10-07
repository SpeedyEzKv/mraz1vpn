-- 004: реферальная программа.

-- Код для ссылки-приглашения (случайный, чтобы не светить Telegram ID) и кто пригласил.
-- Обе колонки пишет только сервер: в GRANT UPDATE для mraz_app их нет.
ALTER TABLE users ADD COLUMN ref_code text UNIQUE;
ALTER TABLE users ADD COLUMN referred_by bigint REFERENCES users(id);
ALTER TABLE users ADD CONSTRAINT users_not_self_referred CHECK (referred_by IS NULL OR referred_by <> id);
CREATE INDEX users_referred_by_idx ON users(referred_by);

-- Начисленные бонусы: один на приглашённого (за его первую оплату).
CREATE TABLE referral_rewards (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  referrer_id bigint NOT NULL REFERENCES users(id),
  referred_id bigint NOT NULL UNIQUE REFERENCES users(id),
  payment_id  bigint NOT NULL REFERENCES payments(id),
  days        int NOT NULL CHECK (days > 0),
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX referral_rewards_referrer_idx ON referral_rewards(referrer_id);

ALTER TABLE referral_rewards ENABLE ROW LEVEL SECURITY;
ALTER TABLE referral_rewards FORCE  ROW LEVEL SECURITY;
CREATE POLICY referral_rewards_referrer_read ON referral_rewards
  FOR SELECT TO mraz_app
  USING (referrer_id = app.current_user_id());

GRANT SELECT ON referral_rewards TO mraz_app;
GRANT SELECT, INSERT ON referral_rewards TO mraz_system;
