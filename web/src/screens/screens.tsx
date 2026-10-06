// Экраны итерации 1: пустые, но по системе. Наполнение — в следующих итерациях.
import { useCallback, useEffect, useState } from 'preact/hooks';
import { Button, Card, CenterState, Field, List, ListItem, Screen, Sheet } from '../components/ui';
import { getBotUsername, type Me } from '../lib/api';
import { bindBackButton } from '../lib/telegram';

export function SubscriptionScreen() {
  return (
    <Screen title="Подписка">
      <Card title="Подписки пока нет">
        <p class="text-secondary">Здесь будет видно, до какого числа работает VPN и как его продлить.</p>
      </Card>
    </Screen>
  );
}

export function DevicesScreen() {
  return (
    <Screen title="Устройства">
      <Card title="Устройств пока нет">
        <p class="text-secondary">После подключения здесь будет видно, сколько устройств занято.</p>
      </Card>
    </Screen>
  );
}

const HELP_ITEMS = [
  { id: 'connect', title: 'Как подключить' },
  { id: 'broken', title: 'Не работает VPN' },
  { id: 'support', title: 'Написать в поддержку' },
] as const;

export function HelpScreen({ me, onOpenComponents }: { me: Me | null; onOpenComponents: () => void }) {
  const [openId, setOpenId] = useState<string | null>(null);
  const close = useCallback(() => setOpenId(null), []);
  const item = HELP_ITEMS.find((i) => i.id === openId);

  return (
    <Screen title="Помощь">
      <List>
        {HELP_ITEMS.map((i) => (
          <ListItem key={i.id} title={i.title} onClick={() => setOpenId(i.id)} />
        ))}
      </List>

      {me?.isAdmin && (
        <List title="Для администратора">
          <ListItem title="Компоненты интерфейса" onClick={onOpenComponents} />
        </List>
      )}

      {me && <p class="text-secondary text-s">Ваш Telegram ID: {me.id}</p>}

      <Sheet open={!!item} title={item?.title} onClose={close}>
        <p class="text-secondary">Этот раздел появится в ближайшем обновлении.</p>
        <Button variant="secondary" block onClick={close}>
          Понятно
        </Button>
      </Sheet>
    </Screen>
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
