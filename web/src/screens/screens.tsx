// Служебные экраны: возврат после оплаты, переход в VPN-приложение, вне Telegram, ошибки, витрина.
import { useCallback, useEffect, useState } from 'preact/hooks';
import { Button, Card, CenterState, Field, List, ListItem, Screen, Sheet } from '../components/ui';
import { isAllowedDeepLink } from '../lib/apps';
import { getBotUsername } from '../lib/api';
import { bindBackButton } from '../lib/telegram';

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

  const colors = ['bg', 'surface', 'surface-2', 'border', 'text', 'text-secondary', 'brand-1', 'brand-2', 'brand-3', 'accent', 'ok', 'warn', 'off'];

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
        <p class="text-secondary">Вторичный текст. Тёмные поверхности, линии 1 px, без теней.</p>
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
