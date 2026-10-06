// Параметры VPN (ключ Reality, shortId, путь XHTTP, id inbound'ов) живут в панели.
// Читаем их один раз и держим в памяти; при неудаче пробуем снова при следующем обращении.

import type { XuiApi } from '../xui/client.js';
import { ensureTopology, type TopologyConfig, type VpnTopology } from '../xui/setup.js';

export function createTopologyCache(xui: XuiApi, cfg: TopologyConfig) {
  let cached: VpnTopology | null = null;
  let inFlight: Promise<VpnTopology> | null = null;

  function get(): Promise<VpnTopology> {
    if (cached) return Promise.resolve(cached);
    inFlight ??= ensureTopology(xui, cfg)
      .then((t) => (cached = t))
      .finally(() => {
        inFlight = null;
      });
    return inFlight;
  }

  /** Перечитать из панели (сверка вызывает раз в несколько минут — вдруг панель пересоздали). */
  async function refresh(): Promise<VpnTopology> {
    cached = null;
    return get();
  }

  return { get, refresh };
}
