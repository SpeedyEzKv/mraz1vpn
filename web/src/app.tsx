import { useCallback, useEffect, useState } from 'preact/hooks';
import { IconDevices, IconHelp, IconShield } from './components/icons';
import { AuthError, getMe, type Me } from './lib/api';
import { haptic, isInsideTelegram } from './lib/telegram';
import {
  AuthFailedScreen,
  ComponentsScreen,
  DevicesScreen,
  HelpScreen,
  OfflineScreen,
  OutsideTelegramScreen,
  SubscriptionScreen,
} from './screens/screens';

type Tab = 'subscription' | 'devices' | 'help';
type Status = 'loading' | 'ready' | 'auth_failed' | 'offline';

const TABS: { id: Tab; label: string; Icon: typeof IconShield }[] = [
  { id: 'subscription', label: 'Подписка', Icon: IconShield },
  { id: 'devices', label: 'Устройства', Icon: IconDevices },
  { id: 'help', label: 'Помощь', Icon: IconHelp },
];

export function App() {
  if (!isInsideTelegram()) return <OutsideTelegramScreen />;
  return <Cabinet />;
}

function Cabinet() {
  const [tab, setTab] = useState<Tab>('subscription');
  const [page, setPage] = useState<'components' | null>(null);
  const [status, setStatus] = useState<Status>('loading');
  const [me, setMe] = useState<Me | null>(null);

  const load = useCallback(() => {
    setStatus('loading');
    getMe()
      .then((m) => {
        setMe(m);
        setStatus('ready');
      })
      .catch((e) => setStatus(e instanceof AuthError ? 'auth_failed' : 'offline'));
  }, []);

  useEffect(load, [load]);

  const closePage = useCallback(() => setPage(null), []);

  if (status === 'auth_failed') return <AuthFailedScreen onRetry={load} />;
  if (status === 'offline') return <OfflineScreen onRetry={load} />;

  const selectTab = (t: Tab) => {
    if (t !== tab) haptic();
    setPage(null);
    setTab(t);
  };

  // Оболочка рисуется сразу, данные подставляются по мере прихода — без экрана логина и без спиннеров.
  return (
    <div class="shell">
      <main class="shell__main">
        {page === 'components' ? (
          <ComponentsScreen onBack={closePage} />
        ) : tab === 'subscription' ? (
          <SubscriptionScreen />
        ) : tab === 'devices' ? (
          <DevicesScreen />
        ) : (
          <HelpScreen me={me} onOpenComponents={() => setPage('components')} />
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
    </div>
  );
}
