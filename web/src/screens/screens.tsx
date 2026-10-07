// Экраны кабинета: подписка, устройства, помощь; подключение приложения; служебные состояния.
import { useCallback, useEffect, useState } from 'preact/hooks';
import { Button, Card, CenterState, Field, List, ListItem, Screen, Sheet } from '../components/ui';
import { appsFor, isAllowedDeepLink, openPageUrl, PLATFORM_LABEL, type VpnApp } from '../lib/apps';
import {
  ApiError,
  createPayment,
  getBotUsername,
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
  type Vpn,
} from '../lib/api';
import { copyText } from '../lib/clipboard';
import { formatDateTime, formatTimeLeft, plural } from '../lib/format';
import { bindBackButton, getPlatform, haptic, openLink, openTelegramLink, type Platform } from '../lib/telegram';

type VpnProps = { vpn: Vpn | null; onVpn: (v: Vpn) => void; onConnect: () => void };

/* ---------- Подписка ---------- */
export function SubscriptionScreen({ vpn, onVpn, onConnect, catalog }: VpnProps & { catalog: Catalog | null }) {
  const [plan, setPlan] = useState<Plan | null>(null);
  const closePay = useCallback(() => setPlan(null), []);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const trial = async () => {
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

  if (!vpn) {
    // Данные ещё едут: оболочка уже на экране, карточка появится через мгновение.
    return <Screen title="Подписка" />;
  }

  return (
    <Screen title="Подписка">
      {vpn.status === 'none' && vpn.trialAvailable && (
        <Card
          title="Попробуйте бесплатно"
          actions={
            <Button block disabled={busy} onClick={trial}>
              {busy ? 'Включаем…' : 'Начать пробный период'}
            </Button>
          }
        >
          <p class="text-secondary">
            {vpn.trialDays} {plural(vpn.trialDays, 'день', 'дня', 'дней')} без оплаты, до {vpn.deviceLimit} {plural(vpn.deviceLimit, 'устройства', 'устройств', 'устройств')} одновременно.
          </p>
          {error && <p>{error}</p>}
        </Card>
      )}

      {vpn.status === 'none' && !vpn.trialAvailable && (
        <Card title="Подписки нет">
          <p class="text-secondary">Выберите срок ниже — VPN заработает сразу после оплаты.</p>
        </Card>
      )}

      {(vpn.status === 'trial' || vpn.status === 'active') && vpn.expiresAt && (
        <>
          <Card
            title={vpn.status === 'trial' ? 'Пробный период' : 'Подписка активна'}
            actions={
              <Button block onClick={onConnect}>
                Подключить устройство
              </Button>
            }
          >
            <p class="text-secondary">VPN работает, пока подписка действует.</p>
          </Card>
          <List>
            <ListItem title="Действует до" value={formatDateTime(vpn.expiresAt)} />
            <ListItem title="Осталось" value={formatTimeLeft(vpn.expiresAt)} />
            <ListItem title="Устройств одновременно" value={`до ${vpn.deviceLimit}`} />
          </List>
        </>
      )}

      {vpn.status === 'expired' && (
        <Card title="Подписка закончилась">
          <p class="text-secondary">
            {vpn.expiresAt && `Закончилась ${formatDateTime(vpn.expiresAt)}. `}Продлите — ссылка на устройствах останется прежней.
          </p>
        </Card>
      )}

      {catalog && catalog.providers.length > 0 && (
        <div id="plans">
        <List title={vpn.status === 'trial' || vpn.status === 'active' || vpn.status === 'expired' ? 'Продлить' : 'Купить подписку'}>
          {catalog.plans.map((p) => (
            <ListItem
              key={p.id}
              title={p.title}
              subtitle={p.discountPct > 0 ? `≈ ${formatRub(p.perMonthRub)} в месяц, выгода ${p.discountPct}%` : undefined}
              value={formatRub(p.priceRub)}
              onClick={() => setPlan(p)}
            />
          ))}
        </List>
        </div>
      )}

      {catalog && (
        <PaySheet plan={plan} providers={catalog.providers} onClose={closePay} onPaid={onVpn} />
      )}
    </Screen>
  );
}

const formatRub = (n: number) => `${Number.isInteger(n) ? n : n.toFixed(2).replace('.', ',')} ₽`;

const PROVIDER_LABEL: Record<Provider, { title: string; hint: string }> = {
  yookassa: { title: 'СБП или карта', hint: 'Оплата через ЮKassa' },
  cryptobot: { title: 'Криптовалюта', hint: 'USDT, TON и другие через @CryptoBot' },
};

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
            <Button
              key={pr}
              block
              variant={i === 0 ? 'primary' : 'secondary'}
              disabled={state.step === 'creating'}
              onClick={() => start(pr)}
            >
              {state.step === 'creating' && state.provider === pr ? 'Создаём счёт…' : PROVIDER_LABEL[pr].title}
            </Button>
          ))}
          <p class="text-secondary text-s">{providers.map((pr) => `${PROVIDER_LABEL[pr].title}: ${PROVIDER_LABEL[pr].hint}.`).join(' ')}</p>
          {state.step === 'choose' && state.error && <p>{state.error}</p>}
        </>
      )}

      {state.step === 'waiting' && (
        <>
          {state.status === 'pending' ? (
            <p class="text-secondary">
              Ждём подтверждение оплаты. Обычно это несколько секунд после оплаты — экран обновится сам.
            </p>
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
export function DevicesScreen({ vpn, onVpn, onConnect }: VpnProps) {
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

  if (!vpn) return <Screen title="Устройства" />;

  if (!vpn.subscriptionUrl || vpn.status === 'none') {
    return (
      <Screen title="Устройства">
        <Card title="Устройств пока нет">
          <p class="text-secondary">Начните пробный период на вкладке «Подписка» — и подключите телефон или компьютер.</p>
        </Card>
      </Screen>
    );
  }

  return (
    <Screen title="Устройства">
      <Card
        title={`До ${vpn.deviceLimit} ${plural(vpn.deviceLimit, 'устройства', 'устройств', 'устройств')} одновременно`}
        actions={
          <Button block onClick={onConnect} disabled={vpn.status === 'expired'}>
            Подключить устройство
          </Button>
        }
      >
        <p class="text-secondary">
          Одна ссылка подписки на все ваши устройства. Если подключить больше, лишние будут отключаться.
        </p>
      </Card>

      <List title="Ссылка подписки">
        <div class="list__item">
          <div class="list__body">
            <div class="list__subtitle text-break">{vpn.subscriptionUrl}</div>
          </div>
        </div>
      </List>
      <CopyButton text={vpn.subscriptionUrl} />
      <Button variant="plain" block onClick={() => setConfirm(true)}>
        Сбросить ссылку
      </Button>
      {done && <p class="text-secondary text-s">Новая ссылка готова. Добавьте её на свои устройства заново.</p>}

      <Sheet open={confirm} title="Сбросить ссылку?" onClose={close}>
        <p class="text-secondary">
          Старая ссылка перестанет работать на всех устройствах — это нужно, если ссылку увидел кто-то чужой. Срок
          подписки не изменится.
        </p>
        {failed && <p>Не получилось. Попробуйте ещё раз.</p>}
        <Button block disabled={busy} onClick={rotate}>
          {busy ? 'Сбрасываем…' : 'Сбросить'}
        </Button>
        <Button variant="secondary" block onClick={close}>
          Отмена
        </Button>
      </Sheet>
    </Screen>
  );
}

function CopyButton({ text, label = 'Скопировать ссылку', variant = 'secondary' }: { text: string; label?: string; variant?: 'primary' | 'secondary' }) {
  const [state, setState] = useState<'idle' | 'ok' | 'fail'>('idle');
  useEffect(() => {
    if (state === 'idle') return;
    const t = setTimeout(() => setState('idle'), 2000);
    return () => clearTimeout(t);
  }, [state]);
  return (
    <Button
      variant={variant}
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
          <div class="row">
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
            <p class="text-secondary">
              В приложении нажмите кнопку подключения. Если не подключается, выберите сервер «Mraz1VPN запасной».
            </p>
          </Card>
          <Button variant="plain" block onClick={() => setApp(null)}>
            Другое приложение
          </Button>
        </>
      )}
    </Sheet>
  );
}

/* ---------- Помощь ---------- */
const HELP_ITEMS = [
  { id: 'connect', title: 'Как подключить' },
  { id: 'broken', title: 'Не работает VPN' },
  { id: 'support', title: 'Написать в поддержку' },
] as const;

export function HelpScreen({
  me,
  vpn,
  onConnect,
  onOpenComponents,
}: {
  me: Me | null;
  vpn: Vpn | null;
  onConnect: () => void;
  onOpenComponents: () => void;
}) {
  const [openId, setOpenId] = useState<string | null>(null);
  const [support, setSupport] = useState<string | null>(null);
  const close = useCallback(() => setOpenId(null), []);
  const item = HELP_ITEMS.find((i) => i.id === openId);

  useEffect(() => {
    getPublicConfig().then((c) => setSupport(c.supportUsername));
  }, []);

  const select = (id: (typeof HELP_ITEMS)[number]['id']) => {
    if (id === 'connect' && vpn?.subscriptionUrl && vpn.status !== 'expired') onConnect();
    else if (id === 'support' && support) openTelegramLink(`https://t.me/${support}`);
    else setOpenId(id);
  };

  return (
    <Screen title="Помощь">
      <List>
        {HELP_ITEMS.map((i) => (
          <ListItem key={i.id} title={i.title} onClick={() => select(i.id)} />
        ))}
      </List>

      {me?.isAdmin && (
        <List title="Для администратора">
          <ListItem title="Компоненты интерфейса" onClick={onOpenComponents} />
        </List>
      )}

      {me && <p class="text-secondary text-s">Ваш Telegram ID: {me.id}</p>}

      <Sheet open={!!item} title={item?.title} onClose={close}>
        {item?.id === 'connect' && (
          <p class="text-secondary">Сначала включите подписку или пробный период на вкладке «Подписка» — затем здесь появится пошаговое подключение.</p>
        )}
        {item?.id === 'broken' && (
          <ol class="steps text-secondary">
            <li>Проверьте на вкладке «Подписка», что срок не закончился.</li>
            <li>В приложении обновите подписку (кнопка обновления рядом с Mraz1VPN).</li>
            <li>Выберите сервер «Mraz1VPN запасной» и подключитесь снова.</li>
            <li>Выключите и включите VPN, а если не помогло — перезапустите приложение.</li>
          </ol>
        )}
        {item?.id === 'support' && <p class="text-secondary">Поддержка скоро появится. Пока напишите боту — мы увидим.</p>}
        <Button variant="secondary" block onClick={close}>
          Понятно
        </Button>
      </Sheet>
    </Screen>
  );
}

/* ---------- Страница /paid: сюда ЮKassa возвращает после оплаты (в браузере) ---------- */
export function PaidScreen() {
  const [bot, setBot] = useState<string | null>(null);
  useEffect(() => {
    getBotUsername().then(setBot);
  }, []);
  return (
    <CenterState
      title="Спасибо!"
      text="Если оплата прошла, подписка продлится в течение минуты. Вернитесь в Telegram — бот пришлёт подтверждение."
      actions={
        bot && (
          <a class="btn btn--primary btn--block" href={`https://t.me/${bot}`}>
            Вернуться в Telegram
          </a>
        )
      }
    />
  );
}

/* ---------- Страница /open: открывает VPN-приложение из браузера ---------- */
export function OpenAppScreen() {
  const link = (() => {
    try {
      return decodeURIComponent(window.location.hash.slice(1));
    } catch {
      return '';
    }
  })();
  const ok = isAllowedDeepLink(link, window.location.origin);

  useEffect(() => {
    if (ok) window.location.href = link;
  }, [ok, link]);

  if (!ok) {
    return <CenterState title="Ссылка не работает" text="Вернитесь в Telegram и нажмите «Добавить» ещё раз." />;
  }
  return (
    <CenterState
      title="Открываем приложение"
      text="Если ничего не произошло — установите приложение, затем нажмите кнопку ниже."
      actions={
        <a class="btn btn--primary btn--block" href={link}>
          Открыть приложение
        </a>
      }
    />
  );
}

/** Витрина дизайн-системы. Видна только админам (isAdmin приходит с сервера). */
export function ComponentsScreen({ onBack }: { onBack: () => void }) {
  const [sheet, setSheet] = useState(false);
  const [value, setValue] = useState('');
  const closeSheet = useCallback(() => setSheet(false), []);

  // Пока шит закрыт, системная «Назад» ведёт из витрины обратно.
  useEffect(() => (sheet ? undefined : bindBackButton(onBack)), [sheet, onBack]);

  const colors = ['bg', 'text', 'text-secondary', 'border', 'accent'];

  return (
    <Screen title="Компоненты">
      <List title="Цвета">
        <div class="list__item">
          <div class="swatches" style={{ width: '100%' }}>
            {colors.map((c) => (
              <div class="swatch" key={c}>
                <span class="swatch__chip" style={{ background: `var(--color-${c})` }} />
                {c}
              </div>
            ))}
          </div>
        </div>
      </List>

      <Card title="Карточка">
        <p class="text-secondary">Вторичный текст. Линии 1 px, углы умеренные, без теней.</p>
      </Card>

      <List title="Список">
        <ListItem title="Строка с переходом" onClick={() => setSheet(true)} />
        <ListItem title="Строка со значением" value="30 дней" />
        <ListItem title="С подзаголовком" subtitle="Пояснение мельче и светлее" />
      </List>

      <Field
        label="Промокод"
        placeholder="Например, FRIEND"
        value={value}
        onInput={(e) => setValue((e.target as HTMLInputElement).value)}
        hint="Подсказка под полем"
        error={value.length > 0 && value.length < 3 ? 'Минимум 3 символа' : undefined}
      />

      <div class="row">
        <Button>Основная</Button>
        <Button variant="secondary">Вторичная</Button>
        <Button variant="plain">Простая</Button>
      </div>
      <div class="row">
        <Button size="small">Маленькая</Button>
        <Button disabled>Недоступна</Button>
      </div>
      <Button block onClick={() => setSheet(true)}>
        Открыть нижний шит
      </Button>

      <Sheet open={sheet} title="Нижний шит" onClose={closeSheet}>
        <p class="text-secondary">Закрывается кнопкой, тапом по фону и системной «Назад» Telegram.</p>
        <Button block onClick={closeSheet}>
          Готово
        </Button>
      </Sheet>
    </Screen>
  );
}

export function OutsideTelegramScreen() {
  const [bot, setBot] = useState<string | null>(null);
  useEffect(() => {
    getBotUsername().then(setBot);
  }, []);

  return (
    <CenterState
      title="Откройте из Telegram"
      text="Кабинет Mraz1VPN работает внутри Telegram. Откройте бота и нажмите «Открыть кабинет»."
      actions={
        bot && (
          <Button block href={`https://t.me/${bot}`}>
            Перейти к боту
          </Button>
        )
      }
    />
  );
}

export function AuthFailedScreen({ onRetry }: { onRetry: () => void }) {
  return (
    <CenterState
      title="Не получилось войти"
      text="Закройте кабинет и откройте его снова из бота. Обычно этого достаточно."
      actions={
        <Button variant="secondary" block onClick={onRetry}>
          Попробовать ещё раз
        </Button>
      }
    />
  );
}

export function OfflineScreen({ onRetry }: { onRetry: () => void }) {
  return (
    <CenterState
      title="Нет связи с сервером"
      text="Проверьте интернет и попробуйте ещё раз."
      actions={
        <Button variant="secondary" block onClick={onRetry}>
          Обновить
        </Button>
      }
    />
  );
}
