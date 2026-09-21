// 版本状态：排期列表、版本号与撤回锁定的响应式承载，变更经 storage 落盘
import { ref, watch } from "vue";
import {
  currentQuote,
  deriveStatus,
  pendingCount,
  validateCandidate,
  type Fuel,
  type PriceSchedule,
  type ScheduleCandidate,
  type ScheduleStatus
} from "./rules";
import { loadPricing, savePricing } from "./storage";

const persisted = loadPricing();

const version = ref(persisted?.version ?? 0);
const schedules = ref<PriceSchedule[]>(persisted?.schedules ?? []);
const filter = ref(persisted?.filter ?? "");
const now = ref(new Date());

setInterval(() => {
  now.value = new Date();
}, 30000);

watch(
  [version, schedules, filter],
  () => {
    savePricing({ version: version.value, schedules: schedules.value, filter: filter.value });
  },
  { deep: true }
);

function commit(candidate: ScheduleCandidate): string[] {
  const errors = validateCandidate(candidate, schedules.value, now.value);
  if (errors.length > 0) return errors; // 整次拒绝：原排期与当前报价保持不变
  schedules.value = [
    {
      ...candidate,
      id: crypto.randomUUID(),
      withdrawn: false,
      createdAt: new Date().toISOString(),
      version: version.value + 1
    },
    ...schedules.value
  ];
  version.value += 1;
  return [];
}

function withdraw(id: string): boolean {
  const entry = schedules.value.find((item) => item.id === id);
  if (!entry || deriveStatus(entry, now.value) !== "待生效") return false; // 已生效记录锁定
  entry.withdrawn = true; // 仅撤回该未生效项，其他排期不变
  version.value += 1;
  return true;
}

export function usePricingStore() {
  return {
    version,
    schedules,
    filter,
    commit,
    withdraw,
    statusOf: (entry: PriceSchedule): ScheduleStatus => deriveStatus(entry, now.value),
    quoteFor: (stationId: string, fuel: Fuel): number => currentQuote(schedules.value, stationId, fuel, now.value),
    pendingFor: (stationId: string): number => pendingCount(schedules.value, stationId, now.value)
  };
}
