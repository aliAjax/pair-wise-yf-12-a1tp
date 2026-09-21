// 本地持久化：排期、版本号与区域筛选的读写，刷新后据此恢复
import type { PriceSchedule } from "./rules";

const STORAGE_KEY = "hxwlfront-21-station-pricing";

export interface PersistedPricing {
  version: number;
  schedules: PriceSchedule[];
  filter: string;
}

export function loadPricing(): PersistedPricing | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<PersistedPricing>;
    if (!parsed || !Array.isArray(parsed.schedules)) return null;
    return {
      version: Number(parsed.version) || 0,
      schedules: parsed.schedules as PriceSchedule[],
      filter: typeof parsed.filter === "string" ? parsed.filter : ""
    };
  } catch {
    return null;
  }
}

export function savePricing(state: PersistedPricing): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}
