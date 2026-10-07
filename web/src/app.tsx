import { useCallback, useEffect, useState } from 'preact/hooks';
import { IconDevices, IconHelp, IconShield } from './components/icons';
import { AuthError, getCatalog, getMe, getVpn, type Catalog, type Me, type Vpn } from './lib/api';
import { haptic, isInsideTelegram } from './lib/telegram';
import {
  AuthFailedScreen,
  ComponentsScreen,
  ConnectSheet,
  DevicesScreen,
  HelpScreen,
  OfflineScreen,
  OpenAppScreen,
  PaidScreen,
  OutsideTelegramScreen,
  SubscriptionScreen,
} from './screens/screens';

type Tab = 'subscription' | 'devices' | 'help';

/** Экран, который просили открыть кнопкой из бота: ?screen=plans|connect|trial. Читается один раз. */
const requestedScreen = new URLSearchParams(window.location.search).get('screen');
type Status = 'loading' | 'ready' | 'auth_failed' | 'offline';

const TABS: { id: Tab; label: string; Icon: typeof IconShield }[] = [
  { id: 'subscription', label: 'Подписка', Icon: IconShield },
  { id: 'devices', label: 'Устройства', Icon: IconDevices },
  { id: 'help', label: 'Помощь', Icon: IconHelp },
];

export function App() {
  // Страница-переходник в VPN-приложение: открывается в браузере, не в Telegram.
  if (window.location.pathname === '/open') return <OpenAppScreen />;
  if (window.location.pathname === '/paid') return <PaidScreen />;
  if (!isInsideTelegram()) return <OutsideTelegramScreen />;
  return <Cabinet />;
}

function Cabinet() {
  const [tab, setTab] = useState<Tab>('subscription');
  const [page, setPage] = useState<'components' | null>(null);
  const [status, setStatus] = useState<Status>('loading');
  const [me, setMe] = useState<Me | null>(null);
  const [vpn, setVpn] = useState<Vpn | null>(null);
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [connectOpen, setConnectOpen] = useState(false);

  const load = useCallback(() => {
    setStatus('loading');
    Promise.all([getMe(), getVpn()])
      .then(([m, v]) => {
        setMe(m);
        setVpn(v);
        setStatus('ready');
      })
      .catch((e) => setStatus(e instanceof AuthError ? 'auth_failed' : 'offline'));
  }, []);

  useEffect(load, [load]);
  // Кнопки бота: «Как подключить» открывает подключение, «Продлить» — прокручивает к тарифам.
  const [handled, setHandled] = useState(false);
  useEffect(() => {
    if (handled || status !== 'ready' || !vpn) return;
    if (requestedScreen === 'connect' && vpn.subscriptionUrl && vpn.status !== 'expired') setConnectOpen(true);
    setHandled(true);
  }, [handled, status, vpn]);
  useEffect(() => {
    if (requestedScreen !== 'plans' || !catalog) return;
    requestAnimationFrame(() => document.getElementById('plans')?.scrollIntoView({ block: 'start' }));
  }, [catalog]);

  // Тарифы не критичны: если не загрузились, кабинет всё равно работает.
  useEffect(() => {
    getCatalog().then(setCatalog, () => setCatalog(null));
  }, []);

  const closePage = useCallback(() => setPage(null), []);
  const openConnect = useCallback(() => setConnectOpen(true), []);
  const closeConnect = useCallback(() => setConnectOpen(false), []);

  if (status === 'auth_failed') return <AuthFailedScreen onRetry={load} />;
  if (status === 'offline') return <OfflineScreen onRetry={load} />;

  const selectTab = (t: Tab) => {
    if (t !== tab) haptic();
    setPage(null);
    setTab(t);
  };

  const vpnProps = { vpn, onVpn: setVpn, onConnect: openConnect };

  // Оболочка рисуется сразу, данные подставляются по мере прихода — без экрана логина и без спиннеров.
  return (
    <div class="shell">
      <main class="shell__main">
        {page === 'components' ? (
          <ComponentsScreen onBack={closePage} />
        ) : tab === 'subscription' ? (
          <SubscriptionScreen {...vpnProps} catalog={catalog} />
        ) : tab === 'devices' ? (
          <DevicesScreen {...vpnProps} />
        ) : (
          <HelpScreen me={me} vpn={vpn} onConnect={openConnect} onOpenComponents={() => setPage('components')} />
        )}
      </main>

      <nav class="tabbar" aria-label="Разделы">
        {TABS.map(({ id, label, Icon }) => (
          <button
            key={id}
            type="button"
            class="tabbar__item"
            aria-current={tab === id && !page ? 'page' : undefined}
            onClick={() => selectTab(id)}
          >
            <Icon />
            {label}
          </button>
        ))}
      </nav>

      <ConnectSheet open={connectOpen} onClose={closeConnect} subscriptionUrl={vpn?.subscriptionUrl ?? null} />
    </div>
  );
}
