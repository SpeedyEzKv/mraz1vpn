import { useCallback, useEffect, useRef, useState } from 'preact/hooks';
import { IconCard, IconDevices, IconGift, IconHelp, IconHome, Logo } from './components/icons';
import { AuthError, getCatalog, getMe, getReferrals, getVpn, type Catalog, type Me, type Referrals, type Vpn } from './lib/api';
import { haptic, isInsideTelegram } from './lib/telegram';
import { ConnectSheet, DevicesScreen, HelpSheet, HomeScreen, PlansScreen, ReferralsScreen, type Tab } from './screens/cabinet';
import { AuthFailedScreen, ComponentsScreen, OfflineScreen, OpenAppScreen, OutsideTelegramScreen, PaidScreen } from './screens/screens';

/** Экран, который просили открыть кнопкой из бота: ?screen=plans|connect|trial. Читается один раз. */
const requestedScreen = new URLSearchParams(window.location.search).get('screen');
type Status = 'loading' | 'ready' | 'auth_failed' | 'offline';

const TABS: { id: Tab; label: string; Icon: typeof IconHome }[] = [
  { id: 'home', label: 'Главная', Icon: IconHome },
  { id: 'plans', label: 'Тарифы', Icon: IconCard },
  { id: 'devices', label: 'Устройства', Icon: IconDevices },
  { id: 'referrals', label: 'Рефералы', Icon: IconGift },
];

export function App() {
  // Страница-переходник в VPN-приложение: открывается в браузере, не в Telegram.
  if (window.location.pathname === '/open') return <OpenAppScreen />;
  if (window.location.pathname === '/paid') return <PaidScreen />;
  if (!isInsideTelegram()) return <OutsideTelegramScreen />;
  return <Cabinet />;
}

function Cabinet() {
  const [tab, setTab] = useState<Tab>(requestedScreen === 'plans' ? 'plans' : 'home');
  const [page, setPage] = useState<'components' | null>(null);
  const [status, setStatus] = useState<Status>('loading');
  const [me, setMe] = useState<Me | null>(null);
  const [vpn, setVpn] = useState<Vpn | null>(null);
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [referrals, setReferrals] = useState<Referrals | null>(null);
  const [referralsFailed, setReferralsFailed] = useState(false);
  const [connectOpen, setConnectOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const mainRef = useRef<HTMLElement>(null);

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

  // Кнопка бота «Как подключить» сразу открывает подключение (если есть что подключать).
  const [handled, setHandled] = useState(false);
  useEffect(() => {
    if (handled || status !== 'ready' || !vpn) return;
    if (requestedScreen === 'connect' && vpn.subscriptionUrl && vpn.status !== 'expired' && vpn.status !== 'none') setConnectOpen(true);
    setHandled(true);
  }, [handled, status, vpn]);

  // Тарифы и рефералы не критичны: если не загрузились, кабинет всё равно работает.
  useEffect(() => {
    getCatalog().then(setCatalog, () => setCatalog(null));
    getReferrals().then(setReferrals, () => setReferralsFailed(true));
  }, []);

  // После оплаты другом/себе цифры могли измениться — освежаем рефералы при заходе на вкладку.
  useEffect(() => {
    if (tab === 'referrals' && referrals) getReferrals().then(setReferrals, () => {});
    mainRef.current?.scrollTo({ top: 0 });
  }, [tab]);

  const closePage = useCallback(() => setPage(null), []);
  const openConnect = useCallback(() => setConnectOpen(true), []);
  const closeConnect = useCallback(() => setConnectOpen(false), []);
  const closeHelp = useCallback(() => setHelpOpen(false), []);

  const selectTab = useCallback((t: Tab) => {
    setTab((cur) => {
      if (t !== cur) haptic();
      return t;
    });
    setPage(null);
  }, []);

  if (status === 'auth_failed') return <AuthFailedScreen onRetry={load} />;
  if (status === 'offline') return <OfflineScreen onRetry={load} />;

  const vpnProps = { vpn, onVpn: setVpn, onConnect: openConnect };

  // Оболочка рисуется сразу, данные подставляются по мере прихода — без экрана логина и без спиннеров.
  return (
    <div class="shell">
      <header class="header">
        <Logo size={32} />
        <span class="header__name">Mraz1VPN</span>
        <button type="button" class="header__btn" onClick={() => setHelpOpen(true)}>
          <IconHelp />
          Помощь
        </button>
      </header>

      <main class="shell__main" ref={mainRef}>
        {page === 'components' ? (
          <ComponentsScreen onBack={closePage} />
        ) : tab === 'home' ? (
          <HomeScreen {...vpnProps} me={me} onGo={selectTab} catalog={catalog} referrals={referrals} />
        ) : tab === 'plans' ? (
          <PlansScreen {...vpnProps} catalog={catalog} />
        ) : tab === 'devices' ? (
          <DevicesScreen {...vpnProps} onGo={selectTab} />
        ) : (
          <ReferralsScreen referrals={referrals} failed={referralsFailed} />
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
      <HelpSheet
        open={helpOpen}
        onClose={closeHelp}
        me={me}
        vpn={vpn}
        onConnect={openConnect}
        onGo={selectTab}
        onOpenComponents={() => setPage('components')}
      />
    </div>
  );
}
