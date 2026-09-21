// 本地持久化：快照读写、版本标记与旧版迁移，不含业务规则

import { project } from "../config/project";
import { DEFAULT_PRICES, type FuelType, type PriceSchedule } from "../domain/priceRules";

export const STORAGE_KEY = project.storageKey;
export const STATE_VERSION = 2;

export type Station = {
  id: string;
  station: string;
  area: string;
  stock: number;
  manager: string;
  status: string;
  notes: string;
  createdAt: string;
  prices: Record<FuelType, number>;
};

export type PriceHistoryEntry = {
  id: string;
  stationId: string;
  stationName: string;
  fuel: FuelType;
  fromPrice: number;
  toPrice: number;
  changedAt: string;
  version: number;
};

export type PersistedState = {
  version: number;
  stations: Station[];
  schedules: PriceSchedule[];
  history: PriceHistoryEntry[];
  filter: string;
};

// 旧版仅存油站数组：补默认油价后并入当前版本快照
function migrateLegacyStation(record: Record<string, unknown>, index: number): Station {
  return {
    id: String(record.id ?? `legacy-${index + 1}`),
    station: String(record.station ?? ""),
    area: String(record.area ?? ""),
    stock: Number(record.stock ?? 0),
    manager: String(record.manager ?? ""),
    status: String(record.status ?? project.statuses[0]),
    notes: String(record.notes ?? ""),
    createdAt: String(record.createdAt ?? new Date().toISOString()),
    prices: { ...DEFAULT_PRICES }
  };
}

export function loadState(): PersistedState | null {
  let parsed: unknown;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (Array.isArray(parsed)) {
    return {
      version: STATE_VERSION,
      stations: (parsed as Record<string, unknown>[]).map(migrateLegacyStation),
      schedules: [],
      history: [],
      filter: project.filters[0]
    };
  }
  if (parsed && typeof parsed === "object" && (parsed as PersistedState).version === STATE_VERSION) {
    return parsed as PersistedState;
  }
  // 版本不符或结构损坏：返回空，由状态层回退种子数据
  return null;
}

export function saveState(state: PersistedState): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // 存储不可用时静默失败，页面状态仍保留在内存中
  }
}
