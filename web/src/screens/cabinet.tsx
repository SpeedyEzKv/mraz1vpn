// Кабинет: главная, тарифы, устройства, рефералы; подключение приложения и помощь (шиты).
import type { ComponentChildren } from 'preact';
import { useCallback, useEffect, useState } from 'preact/hooks';
import {
  IconBolt,
  IconChat,
  IconCheck,
  IconCopy,
  IconDevices,
  IconGift,
  IconInfinity,
  IconRefresh,
  IconShare,
  IconShield,
  IconShieldOff,
  IconUsers,
} from '../components/icons';
import { Button, Card, List, ListItem, Screen, Sheet } from '../components/ui';
import { appsFor, openPageUrl, PLATFORM_LABEL, type VpnApp } from '../lib/apps';
import {
  ApiError,
  createPayment,
  getPayment,
  getPublicConfig,
  getVpn,
  rotateKey,
  startTrial,
  type Catalog,
  type Me,
  type PaymentStatus,
  type Plan,
  type Provider,
  type Referrals,
  type Vpn,
} from '../lib/api';
import { copyText } from '../lib/clipboard';
import { daysLeft, formatDateTime, formatDay, formatRub, formatTimeLeft, plural } from '../lib/format';
import { getPlatform, haptic, openLink, openTelegramLink, type Platform } from '../lib/telegram';

export type Tab = 'home' | 'plans' | 'devices' | 'referrals';

type VpnProps = { vpn: Vpn | null; onVpn: (v: Vpn) => void; onConnect: () => void };

const devicesWord = (n: number) => plural(n, 'устройство', 'устройства', 'устройств');
const isOn = (v: Vpn | null): v is Vpn & { expiresAt: string } => !!v && (v.status === 'trial' || v.status === 'active') && !!v.expiresAt;

/** Пробный период: кнопка на главной и на тарифах. */
function useTrial(onVpn: (v: Vpn) => void, onConnect: () => void) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const start = async () => {
    setBusy(true);
    setError(null);
    try {
      const v = await startTrial();
      haptic();
      onVpn(v);
      onConnect();
    } catch (e) {
      setError(e instanceof ApiError && e.code === 'trial_used' ? 'Пробный период уже был использован.' : 'Не получилось. Попробуйте ещё раз.');
    } finally {
      setBusy(false);
    }
  };
  return { busy, error, start };
}

/* ---------- Мелкие части ---------- */
function Badge({ tone, children }: { tone?: 'ok' | 'warn' | 'off'; children: ComponentChildren }) {
  return <span class={tone ? `badge badge--${tone}` : 'badge'}>{children}</span>;
}

function Stat({ value, label }: { value: ComponentChildren; label: string }) {
  return (
    <div class="stat">
      <div class="stat__value">{value}</div>
      <div class="stat__label">{label}</div>
    </div>
  );
}

function Promo({ icon, title, text, onClick }: { icon: ComponentChildren; title: string; text: string; onClick: () => void }) {
  return (
    <button type="button" class="promo" onClick={onClick}>
      <span class="tile tile--s">{icon}</span>
      <span class="promo__body">
        <span class="promo__title">{title}</span>
        <br />
        <span class="promo__text">{text}</span>
      </span>
    </button>
  );
}

/** Ссылка в одну строку; тап — копировать. */
function LinkBox({ text }: { text: string }) {
  const [state, setState] = useState<'idle' | 'ok' | 'fail'>('idle');
  useEffect(() => {
    if (state === 'idle') return;
    const t = setTimeout(() => setState('idle'), 2000);
    return () => clearTimeout(t);
  }, [state]);
  return (
    <button
      type="button"
      class="linkbox"
      aria-label="Скопировать ссылку"
      onClick={async () => {
        const ok = await copyText(text);
        if (ok) haptic();
        setState(ok ? 'ok' : 'fail');
      }}
    >
      <span class="linkbox__text">{text.replace(/^https:\/\//, '')}</span>
      <span class="linkbox__action">
        {state === 'ok' ? <IconCheck /> : <IconCopy />}
        {state === 'ok' ? 'Скопировано' : state === 'fail' ? 'Не вышло' : 'Копировать'}
      </span>
    </button>
  );
}

function CopyButton({ text, label = 'Скопировать ссылку' }: { text: string; label?: string }) {
  const [state, setState] = useState<'idle' | 'ok' | 'fail'>('idle');
  useEffect(() => {
    if (state === 'idle') return;
    const t = setTimeout(() => setState('idle'), 2000);
    return () => clearTimeout(t);
  }, [state]);
  return (
    <Button
      variant="secondary"
      block
      onClick={async () => {
        const ok = await copyText(text);
        if (ok) haptic();
        setState(ok ? 'ok' : 'fail');
      }}
    >
      {state === 'ok' ? 'Скопировано' : state === 'fail' ? 'Не получилось — выделите вручную' : label}
    </Button>
  );
}

function Skeleton({ height }: { height: number }) {
  return <div class="skeleton" style={{ height: `${height}px` }} />;
}

/* ---------- Главная ---------- */
export function HomeScreen({
  me,
  vpn,
  onVpn,
  onConnect,
  onGo,
  catalog,
  referrals,
}: VpnProps & { me: Me | null; onGo: (t: Tab) => void; catalog: Catalog | null; referrals: Referrals | null }) {
  const trial = useTrial(onVpn, onConnect);
  const name = me?.firstName?.trim() || me?.username || null;
  const minMonthly = catalog?.plans.length ? Math.min(...catalog.plans.map((p) => p.perMonthRub)) : null;

  const greeting = (
    <h1 class="screen__title">
      Добро пожаловать{name ? ', ' : '!'}
      {name && <span class="text-gradient">{name}!</span>}
    </h1>
  );

  if (!vpn) {
    return (
      <Screen>
        {greeting}
        <Skeleton height={300} />
      </Screen>
    );
  }

  const on = isOn(vpn);
  const left = on ? daysLeft(vpn.expiresAt) : 0;
  const lessThanDay = on && Date.parse(vpn.expiresAt) - Date.now() < 86_400_000;

  let badge: ComponentChildren;
  let title: string;
  let subtitle: string;
  if (on) {
    badge = vpn.status === 'trial' ? <Badge tone="warn">Пробный период</Badge> : left <= 3 ? <Badge tone="warn">Скоро закончится</Badge> : <Badge tone="ok">Подписка активна</Badge>;
    title = 'VPN работает';
    subtitle = `до ${formatDateTime(vpn.expiresAt)}`;
  } else if (vpn.status === 'expired') {
    badge = <Badge tone="off">Подписка закончилась</Badge>;
    title = 'VPN выключен';
    subtitle = vpn.expiresAt ? `Закончилась ${formatDay(vpn.expiresAt)} — продлите, ссылка останется прежней` : 'Продлите — ссылка останется прежней';
  } else {
    badge = <Badge>Нет подписки</Badge>;
    title = 'VPN не подключён';
    subtitle = vpn.trialAvailable
      ? `Попробуйте ${vpn.trialDays} ${plural(vpn.trialDays, 'день', 'дня', 'дней')} бесплатно`
      : 'Оформите подписку — VPN заработает сразу после оплаты';
  }

  const firstStat = on ? (
    lessThanDay ? (
      <Stat value={formatTimeLeft(vpn.expiresAt).replace(/ час(а|ов)?$/, ' ч')} label="осталось" />
    ) : (
      <Stat value={left} label={`${plural(left, 'день', 'дня', 'дней')} осталось`} />
    )
  ) : vpn.status === 'none' && vpn.trialAvailable ? (
    <Stat value={vpn.trialDays} label={`${plural(vpn.trialDays, 'день', 'дня', 'дней')} бесплатно`} />
  ) : (
    <Stat value={0} label="дней осталось" />
  );

  return (
    <Screen>
      {greeting}
      {badge}

      <section class={vpn.status === 'expired' ? 'hero hero--off' : 'hero hero--star'}>
        <div class="hero__head">
          <span class={on ? 'tile' : 'tile tile--muted'}>{on ? <IconShield /> : <IconShieldOff />}</span>
          <div>
            <div class="hero__title">{title}</div>
            <div class="hero__subtitle">{subtitle}</div>
          </div>
        </div>

        <div class="stats">
          {firstStat}
          <Stat value={<IconInfinity />} label="трафик без лимита" />
          <Stat value={vpn.deviceLimit} label={`${devicesWord(vpn.deviceLimit)} сразу`} />
        </div>

        <div class="hero__actions">
          {on && (
            <>
              <Button block onClick={onConnect}>
                <IconBolt />
                Подключить устройство
              </Button>
              <Button block variant="secondary" onClick={() => onGo('plans')}>
                Продлить подписку
              </Button>
            </>
          )}
          {vpn.status === 'expired' && (
            <Button block onClick={() => onGo('plans')}>
              Продлить подписку
            </Button>
          )}
          {vpn.status === 'none' && (
            <>
              {vpn.trialAvailable && (
                <Button block disabled={trial.busy} onClick={trial.start}>
                  <IconBolt />
                  {trial.busy ? 'Включаем…' : 'Начать пробный период'}
                </Button>
              )}
              <Button block variant={vpn.trialAvailable ? 'secondary' : 'primary'} onClick={() => onGo('plans')}>
                {minMonthly ? `Тарифы — от ${formatRub(Math.round(minMonthly))} в месяц` : 'Выбрать тариф'}
              </Button>
            </>
          )}
          {trial.error && <p class="error-text text-center">{trial.error}</p>}
        </div>
      </section>

      {referrals && referrals.bonusDays > 0 && (
        <Promo
          icon={<IconGift />}
          title={`+${referrals.bonusDays} ${plural(referrals.bonusDays, 'день', 'дня', 'дней')} за друга`}
          text="Пригласите друга — получите дни VPN, когда он оформит подписку"
          onClick={() => onGo('referrals')}
        />
      )}
      {on && (
        <Promo icon={<IconDevices />} title="Как подключить" text="Пошаговая настройка для iPhone, Android и компьютера" onClick={onConnect} />
      )}
    </Screen>
  );
}

/* ---------- Тарифы ---------- */
const PROVIDER_LABEL: Record<Provider, { title: string; hint: string }> = {
  yookassa: { title: 'СБП или карта', hint: 'Оплата через ЮKassa' },
  cryptobot: { title: 'Криптовалюта', hint: 'USDT, TON и другие через @CryptoBot' },
};

export function PlansScreen({ vpn, onVpn, onConnect, catalog }: VpnProps & { catalog: Catalog | null }) {
  const [plan, setPlan] = useState<Plan | null>(null);
  const closePay = useCallback(() => setPlan(null), []);
  const trial = useTrial(onVpn, onConnect);
  const best = catalog?.plans.reduce<Plan | null>((b, p) => (!b || p.discountPct > b.discountPct ? p : b), null);

  const lead =
    vpn && isOn(vpn)
      ? `Подписка действует до ${formatDay(vpn.expiresAt)}. Новые дни добавятся к ней.`
      : vpn?.status === 'expired'
        ? 'Ссылка на ваших устройствах останется прежней — VPN заработает сразу после оплаты.'
        : 'VPN заработает сразу после оплаты.';

  return (
    <Screen title="Тарифы" lead={lead}>
      {vpn?.status === 'none' && vpn.trialAvailable && (
        <Promo
          icon={<IconGift />}
          title={trial.busy ? 'Включаем…' : `Сначала ${vpn.trialDays} ${plural(vpn.trialDays, 'день', 'дня', 'дней')} бесплатно`}
          text={trial.error ?? 'Без оплаты и без привязки карты'}
          onClick={() => !trial.busy && void trial.start()}
        />
      )}

      {!catalog ? (
        <Skeleton height={260} />
      ) : catalog.providers.length === 0 ? (
        <Card title="Оплата скоро появится">
          <p class="text-secondary">Приём платежей ещё настраивается. Напишите в поддержку — поможем оформить подписку.</p>
        </Card>
      ) : (
        <div class="plans" id="plans">
          {catalog.plans.map((p) => (
            <button key={p.id} type="button" class={p === best && p.discountPct > 0 ? 'plan plan--best' : 'plan'} onClick={() => setPlan(p)}>
              {p.discountPct > 0 && <span class="chip">−{p.discountPct}%</span>}
              <span class="plan__title">{p.title}</span>
              <span class="plan__price">{formatRub(p.priceRub)}</span>
              <span class="plan__per">{p.discountPct > 0 ? `≈ ${formatRub(Math.round(p.perMonthRub))} в месяц` : 'за 30 дней'}</span>
              <span class="plan__cta">{vpn && vpn.status !== 'none' ? 'Продлить' : 'Купить'}</span>
            </button>
          ))}
        </div>
      )}

      <List title="В любом тарифе">
        <ListItem title="Трафик и скорость без ограничений" value={<IconCheck class="icon" />} />
        <ListItem title={`До ${vpn?.deviceLimit ?? 3} ${devicesWord(vpn?.deviceLimit ?? 3)} одновременно`} value={<IconCheck class="icon" />} />
        <ListItem title="VLESS Reality — работает, где другие режут" value={<IconCheck class="icon" />} />
        <ListItem title="Без рекламы и без логов" value={<IconCheck class="icon" />} />
      </List>

      {catalog && catalog.providers.length > 0 && (
        <p class="text-secondary text-s text-center">Способы оплаты: {catalog.providers.map((pr) => PROVIDER_LABEL[pr].title).join(' · ')}</p>
      )}

      {catalog && <PaySheet plan={plan} providers={catalog.providers} onClose={closePay} onPaid={onVpn} />}
    </Screen>
  );
}

type PayState =
  | { step: 'choose'; error?: string }
  | { step: 'creating'; provider: Provider }
  | { step: 'waiting'; id: number; provider: Provider; url: string; status: PaymentStatus }
  | { step: 'done' };

function openPayment(provider: Provider, url: string) {
  // Счёт CryptoBot — ссылка t.me, открывается внутри Telegram; ЮKassa — в браузере.
  if (provider === 'cryptobot') openTelegramLink(url);
  else openLink(url);
}

/** Оплата тарифа: выбор способа → страница оплаты → ждём подтверждения от сервера. */
function PaySheet({
  plan,
  providers,
  onClose,
  onPaid,
}: {
  plan: Plan | null;
  providers: Provider[];
  onClose: () => void;
  onPaid: (v: Vpn) => void;
}) {
  const [state, setState] = useState<PayState>({ step: 'choose' });

  useEffect(() => {
    if (plan) setState({ step: 'choose' });
  }, [plan]);

  // Пока ждём оплату — спрашиваем сервер раз в 3 секунды и сразу при возврате в Telegram.
  const waitingId = state.step === 'waiting' ? state.id : null;
  useEffect(() => {
    if (waitingId === null) return;
    let stopped = false;
    const startedAt = Date.now();
    const check = async () => {
      try {
        const p = await getPayment(waitingId);
        if (stopped) return;
        if (p.status === 'succeeded') {
          stopped = true;
          haptic();
          setState({ step: 'done' });
          onPaid(await getVpn());
        } else {
          setState((s) => (s.step === 'waiting' && s.id === waitingId ? { ...s, status: p.status } : s));
        }
      } catch {
        /* сеть моргнула — попробуем на следующем шаге */
      }
    };
    const timer = setInterval(() => {
      if (Date.now() - startedAt > 30 * 60_000) clearInterval(timer);
      else void check();
    }, 3000);
    const onVisible = () => document.visibilityState === 'visible' && void check();
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      stopped = true;
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [waitingId, onPaid]);

  const start = async (provider: Provider) => {
    if (!plan) return;
    setState({ step: 'creating', provider });
    try {
      const p = await createPayment(plan.id, provider);
      setState({ step: 'waiting', id: p.id, provider, url: p.url, status: 'pending' });
      openPayment(provider, p.url);
    } catch (e) {
      const tooMany = e instanceof ApiError && e.code === 'too_many';
      setState({
        step: 'choose',
        error: tooMany ? 'Слишком много неоплаченных счетов. Попробуйте через час.' : 'Не получилось создать платёж. Попробуйте ещё раз или другой способ.',
      });
    }
  };

  if (!plan) return null;
  const title = `${plan.title} — ${formatRub(plan.priceRub)}`;

  return (
    <Sheet open={!!plan} title={title} onClose={onClose}>
      {(state.step === 'choose' || state.step === 'creating') && (
        <>
          <p class="text-secondary">Выберите способ оплаты. Дни добавятся к текущей подписке.</p>
          {providers.map((pr, i) => (
            <Button key={pr} block variant={i === 0 ? 'primary' : 'secondary'} disabled={state.step === 'creating'} onClick={() => start(pr)}>
              {state.step === 'creating' && state.provider === pr ? 'Создаём счёт…' : PROVIDER_LABEL[pr].title}
            </Button>
          ))}
          <p class="text-secondary text-s">{providers.map((pr) => `${PROVIDER_LABEL[pr].title}: ${PROVIDER_LABEL[pr].hint}.`).join(' ')}</p>
          {state.step === 'choose' && state.error && <p class="error-text">{state.error}</p>}
        </>
      )}

      {state.step === 'waiting' && (
        <>
          {state.status === 'pending' ? (
            <p class="text-secondary">Ждём подтверждение оплаты. Обычно это несколько секунд после оплаты — экран обновится сам.</p>
          ) : (
            <p>Платёж не прошёл или отменён. Можно попробовать снова.</p>
          )}
          {state.status === 'pending' ? (
            <Button block variant="secondary" onClick={() => openPayment(state.provider, state.url)}>
              Открыть оплату ещё раз
            </Button>
          ) : (
            <Button block onClick={() => setState({ step: 'choose' })}>
              Выбрать способ оплаты
            </Button>
          )}
        </>
      )}

      {state.step === 'done' && (
        <>
          <p>Оплата прошла. Подписка продлена — VPN работает по той же ссылке на всех устройствах.</p>
          <Button block onClick={onClose}>
            Готово
          </Button>
        </>
      )}
    </Sheet>
  );
}

/* ---------- Устройства ---------- */
export function DevicesScreen({ vpn, onVpn, onConnect, onGo }: VpnProps & { onGo: (t: Tab) => void }) {
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [failed, setFailed] = useState(false);
  const close = useCallback(() => setConfirm(false), []);

  const rotate = async () => {
    setBusy(true);
    setFailed(false);
    try {
      onVpn(await rotateKey());
      haptic();
      setDone(true);
      setConfirm(false);
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  };

  const limit = vpn?.deviceLimit ?? 3;
  const lead = `Одна ссылка на все ваши устройства — до ${limit} ${plural(limit, 'устройства', 'устройств', 'устройств')} одновременно.`;

  if (!vpn) {
    return (
      <Screen title="Устройства" lead={lead}>
        <Skeleton height={180} />
      </Screen>
    );
  }

  if (!vpn.subscriptionUrl || vpn.status === 'none') {
    return (
      <Screen title="Устройства" lead={lead}>
        <section class="hero">
          <div class="hero__head">
            <span class="tile tile--muted">
              <IconDevices />
            </span>
            <div>
              <div class="hero__title">Устройств пока нет</div>
              <div class="hero__subtitle">Включите пробный период или подписку — и подключите телефон или компьютер.</div>
            </div>
          </div>
          <Button block onClick={() => onGo('home')}>
            На главную
          </Button>
        </section>
      </Screen>
    );
  }

  const platforms = (Object.keys(PLATFORM_LABEL) as Platform[]).map((p) => PLATFORM_LABEL[p]).join(', ');

  return (
    <Screen title="Устройства" lead={lead}>
      <section class={vpn.status === 'expired' ? 'hero hero--off' : 'hero'}>
        <div class="hero__head">
          <span class={vpn.status === 'expired' ? 'tile tile--muted' : 'tile'}>
            <IconDevices />
          </span>
          <div>
            <div class="hero__title">Подключить устройство</div>
            <div class="hero__subtitle">{platforms} — в пару нажатий</div>
          </div>
        </div>
        {vpn.status === 'expired' ? (
          <Button block onClick={() => onGo('plans')}>
            Продлить подписку
          </Button>
        ) : (
          <Button block onClick={onConnect}>
            <IconBolt />
            Подключить
          </Button>
        )}
      </section>

      <div class="section-title">Ссылка подписки</div>
      <LinkBox text={vpn.subscriptionUrl} />
      <p class="text-secondary text-s">
        Добавьте её в VPN-приложение на каждом устройстве. Никому не показывайте: по ней работает ваш VPN. Если подключить больше {limit}{' '}
        {plural(limit, 'устройства', 'устройств', 'устройств')}, лишние будут отключаться.
      </p>
      {done && <p class="text-secondary text-s">Новая ссылка готова. Добавьте её на свои устройства заново.</p>}

      <List>
        <ListItem title={<>Сбросить ссылку</>} subtitle="Если ссылку увидел кто-то чужой" onClick={() => setConfirm(true)} />
      </List>

      <Sheet open={confirm} title="Сбросить ссылку?" onClose={close}>
        <p class="text-secondary">
          Старая ссылка перестанет работать на всех устройствах — это нужно, если ссылку увидел кто-то чужой. Срок подписки не изменится.
        </p>
        {failed && <p class="error-text">Не получилось. Попробуйте ещё раз.</p>}
        <Button block disabled={busy} onClick={rotate}>
          <IconRefresh />
          {busy ? 'Сбрасываем…' : 'Сбросить'}
        </Button>
        <Button variant="secondary" block onClick={close}>
          Отмена
        </Button>
      </Sheet>
    </Screen>
  );
}

/* ---------- Рефералы ---------- */
export function ReferralsScreen({ referrals, failed }: { referrals: Referrals | null; failed: boolean }) {
  if (failed) {
    return (
      <Screen title="Рефералы">
        <Card title="Скоро здесь">
          <p class="text-secondary">Программа приглашений пока не работает. Загляните позже.</p>
        </Card>
      </Screen>
    );
  }
  if (!referrals) {
    return (
      <Screen title="Рефералы">
        <Skeleton height={300} />
      </Screen>
    );
  }
  const { link, bonusDays: bonus, invited, paid, daysEarned } = referrals;
  const bonusText = `${bonus} ${plural(bonus, 'день', 'дня', 'дней')}`;
  const share = () => {
    const text = 'Подключи Mraz1VPN — быстрый VPN, который работает. Первые дни бесплатно 👇';
    openTelegramLink(`https://t.me/share/url?url=${encodeURIComponent(link)}&text=${encodeURIComponent(text)}`);
  };

  return (
    <Screen title="Рефералы" lead="Приглашайте друзей и пользуйтесь VPN бесплатно.">
      <section class="hero">
        <div class="hero__head">
          <span class="tile">
            <IconGift />
          </span>
          <div>
            <div class="hero__title">+{bonusText} за каждого друга</div>
            <div class="hero__subtitle">Когда друг оплатит первую подписку</div>
          </div>
        </div>
        <div class="stats">
          <Stat value={invited} label="пришли по ссылке" />
          <Stat value={paid} label="оформили подписку" />
          <Stat value={daysEarned} label={`${plural(daysEarned, 'день', 'дня', 'дней')} получено`} />
        </div>
        <LinkBox text={link} />
        <Button block onClick={share}>
          <IconShare />
          Поделиться ссылкой
        </Button>
      </section>

      <Card title="Как это работает">
        <div class="howto">
          <div class="howto__step">
            <span class="howto__num">1</span>
            <span class="howto__text">
              <b>Отправьте ссылку</b> другу — в личку, в чат или в сторис.
            </span>
          </div>
          <div class="howto__step">
            <span class="howto__num">2</span>
            <span class="howto__text">
              <b>Друг открывает бота</b> по ссылке и пробует VPN бесплатно.
            </span>
          </div>
          <div class="howto__step">
            <span class="howto__num">3</span>
            <span class="howto__text">
              <b>Друг оформляет подписку</b> — вам сразу +{bonusText} к вашей.
            </span>
          </div>
        </div>
      </Card>
      <p class="text-secondary text-s text-center">
        <IconUsers class="icon" /> Засчитываются только новые пользователи бота
      </p>
    </Screen>
  );
}

/* ---------- Подключение приложения ---------- */
export function ConnectSheet({ open, onClose, subscriptionUrl }: { open: boolean; onClose: () => void; subscriptionUrl: string | null }) {
  const [platform, setPlatform] = useState<Platform>(getPlatform);
  const [app, setApp] = useState<VpnApp | null>(null);

  useEffect(() => {
    if (open) setApp(null);
  }, [open]);

  if (!subscriptionUrl) return null;
  const apps = appsFor(platform);

  return (
    <Sheet open={open} title={app ? `Подключение: ${app.name}` : 'Подключить устройство'} onClose={onClose}>
      {!app ? (
        <>
          <div class="row row--fill">
            {(Object.keys(PLATFORM_LABEL) as Platform[]).map((p) => (
              <Button key={p} size="small" variant={p === platform ? 'primary' : 'secondary'} onClick={() => setPlatform(p)}>
                {PLATFORM_LABEL[p]}
              </Button>
            ))}
          </div>
          <List title="Выберите приложение">
            {apps.map(({ app: a, recommended }) => (
              <ListItem key={a.id} title={a.name} subtitle={recommended ? 'Рекомендуем' : undefined} onClick={() => setApp(a)} />
            ))}
          </List>
        </>
      ) : (
        <>
          <Card title={`1. Установите ${app.name}`}>
            {(app.stores[platform] ?? []).map((s) => (
              <Button key={s.url} variant="secondary" block onClick={() => openLink(s.url)}>
                {s.label}
              </Button>
            ))}
          </Card>
          <Card title="2. Добавьте подписку">
            <p class="text-secondary">Откроется {app.name} и сам добавит Mraz1VPN.</p>
            <Button block onClick={() => openLink(openPageUrl(app.deepLink(subscriptionUrl)))}>
              Добавить в {app.name}
            </Button>
            <CopyButton text={subscriptionUrl} label="Или скопировать ссылку" />
          </Card>
          <Card title="3. Включите VPN">
            <p class="text-secondary">В приложении нажмите кнопку подключения. Если не подключается, выберите сервер «Mraz1VPN запасной».</p>
          </Card>
          <Button variant="plain" block onClick={() => setApp(null)}>
            Другое приложение
          </Button>
        </>
      )}
    </Sheet>
  );
}

/* ---------- Помощь (кнопка в шапке) ---------- */
export function HelpSheet({
  open,
  onClose,
  me,
  vpn,
  onConnect,
  onGo,
  onOpenComponents,
}: {
  open: boolean;
  onClose: () => void;
  me: Me | null;
  vpn: Vpn | null;
  onConnect: () => void;
  onGo: (t: Tab) => void;
  onOpenComponents: () => void;
}) {
  const [view, setView] = useState<'menu' | 'broken'>('menu');
  const [support, setSupport] = useState<string | null>(null);
  const [docs, setDocs] = useState<{ privacyUrl: string | null; termsUrl: string | null }>({ privacyUrl: null, termsUrl: null });

  useEffect(() => {
    getPublicConfig().then((c) => {
      setSupport(c.supportUsername);
      setDocs({ privacyUrl: c.privacyUrl, termsUrl: c.termsUrl });
    });
  }, []);
  useEffect(() => {
    if (open) setView('menu');
  }, [open]);

  const canConnect = !!vpn?.subscriptionUrl && vpn.status !== 'expired' && vpn.status !== 'none';
  const then = (fn: () => void) => () => {
    onClose();
    fn();
  };

  return (
    <Sheet open={open} title={view === 'broken' ? 'Не работает VPN' : 'Помощь'} onClose={onClose}>
      {view === 'menu' ? (
        <>
          <List>
            <ListItem
              title="Как подключить"
              subtitle={canConnect ? 'Пошагово для вашего устройства' : 'Сначала включите пробный период или подписку'}
              onClick={then(canConnect ? onConnect : () => onGo('home'))}
            />
            <ListItem title="Не работает VPN" subtitle="Что проверить по порядку" onClick={() => setView('broken')} />
            <ListItem title="Оплата и тарифы" onClick={then(() => onGo('plans'))} />
          </List>
          {support && (
            <Button block onClick={() => openTelegramLink(`https://t.me/${support}`)}>
              <IconChat />
              Написать в поддержку
            </Button>
          )}
          {(docs.termsUrl || docs.privacyUrl) && (
            <List title="Документы">
              {docs.termsUrl && <ListItem title="Пользовательское соглашение" onClick={() => openLink(docs.termsUrl!)} />}
              {docs.privacyUrl && <ListItem title="Политика конфиденциальности" onClick={() => openLink(docs.privacyUrl!)} />}
            </List>
          )}
          {me?.isAdmin && (
            <List title="Для администратора">
              <ListItem title="Компоненты интерфейса" onClick={then(onOpenComponents)} />
            </List>
          )}
          {me && <p class="text-secondary text-s text-center">Ваш Telegram ID: {me.id}</p>}
        </>
      ) : (
        <>
          <ol class="steps text-secondary">
            <li>Проверьте на главной, что подписка не закончилась.</li>
            <li>В приложении обновите подписку (кнопка обновления рядом с Mraz1VPN).</li>
            <li>Выберите сервер «Mraz1VPN запасной» и подключитесь снова.</li>
            <li>Выключите и включите VPN, а если не помогло — перезапустите приложение.</li>
          </ol>
          {support && (
            <Button block onClick={() => openTelegramLink(`https://t.me/${support}`)}>
              <IconChat />
              Не помогло — написать в поддержку
            </Button>
          )}
          <Button variant="secondary" block onClick={() => setView('menu')}>
            Назад
          </Button>
        </>
      )}
    </Sheet>
  );
}

