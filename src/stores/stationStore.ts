// 版本状态：油站、调价排期与价格历史的唯一状态源，所有变更先校验后落库

import { computed, ref, watch } from "vue";
import { defineStore } from "pinia";
import { project } from "../config/project";
import {
  DEFAULT_PRICES,
  validateSchedule,
  type PriceSchedule,
  type ScheduleDraft
} from "../domain/priceRules";
import {
  loadState,
  saveState,
  STATE_VERSION,
  type PersistedState,
  type PriceHistoryEntry,
  type Station
} from "../utils/persistence";

const statuses = project.statuses;

function seedState(): PersistedState {
  const stations: Station[] = project.records.map((record, index) => ({
    id: `seed-${index + 1}`,
    station: record.station,
    area: record.area,
    stock: record.stock,
    manager: record.manager,
    status: record.status,
    notes: record.notes,
    createdAt: new Date(Date.now() - index * 86400000).toISOString(),
    prices: { ...DEFAULT_PRICES }
  }));
  const [first, second] = stations;
  const schedules: PriceSchedule[] = [
    {
      id: "seed-sch-1",
      stationId: first.id,
      stationName: first.station,
      fuel: "92#汽油",
      price: DEFAULT_PRICES["92#汽油"],
      startDate: "2026-08-01",
      endDate: "2026-08-31",
      approval: "发改委调价函 2026-08",
      status: "effective",
      version: 2,
      createdAt: "2026-07-28T02:00:00.000Z",
      effectiveAt: "2026-08-01T00:00:00.000Z"
    },
    {
      id: "seed-sch-2",
      stationId: second.id,
      stationName: second.station,
      fuel: "0#柴油",
      price: 7.28,
      startDate: "2026-10-01",
      endDate: "2026-10-31",
      approval: "",
      status: "pending",
      version: 1,
      createdAt: "2026-09-18T02:00:00.000Z",
      effectiveAt: null
    }
  ];
  const history: PriceHistoryEntry[] = [
    {
      id: "seed-his-1",
      stationId: first.id,
      stationName: first.station,
      fuel: "92#汽油",
      fromPrice: 7.62,
      toPrice: DEFAULT_PRICES["92#汽油"],
      changedAt: "2026-08-01T00:00:00.000Z",
      version: 2
    }
  ];
  return { version: STATE_VERSION, stations, schedules, history, filter: project.filters[0] };
}

export const useStationStore = defineStore("hxwlfront-21", () => {
  const initial = loadState() ?? seedState();
  const stations = ref<Station[]>(initial.stations);
  const schedules = ref<PriceSchedule[]>(initial.schedules);
  const history = ref<PriceHistoryEntry[]>(initial.history);
  const filter = ref<string>(initial.filter);

  function persist() {
    saveState({
      version: STATE_VERSION,
      stations: stations.value,
      schedules: schedules.value,
      history: history.value,
      filter: filter.value
    });
  }

  // 任何状态变化整体落库，刷新后按版本号恢复
  watch([stations, schedules, history, filter], persist, { deep: true });
  persist();

  const filteredStations = computed(() => {
    if (filter.value.startsWith("全部")) return stations.value;
    return stations.value.filter((station) => Object.values(station).includes(filter.value));
  });

  const metrics = computed(() => [
    stations.value.length,
    stations.value.filter((station) => station.status === statuses[0]).length,
    stations.value.filter((station) => station.status === statuses[2]).length
  ]);

  const pendingCountByStation = computed(() => {
    const counts: Record<string, number> = {};
    for (const item of schedules.value) {
      if (item.status === "pending") counts[item.stationId] = (counts[item.stationId] ?? 0) + 1;
    }
    return counts;
  });

  function addStation(form: Record<string, string | number>, note: string) {
    const station: Station = {
      id: crypto.randomUUID(),
      station: String(form.station ?? ""),
      area: String(form.area ?? ""),
      stock: Number(form.stock ?? 0),
      manager: String(form.manager ?? ""),
      status: statuses[0],
      notes: note || "暂无备注",
      createdAt: new Date().toISOString(),
      prices: { ...DEFAULT_PRICES }
    };
    stations.value = [station, ...stations.value];
  }

  function flowStation(id: string) {
    const station = stations.value.find((item) => item.id === id);
    if (!station) return;
    const index = statuses.indexOf(station.status as (typeof statuses)[number]);
    station.status = statuses[(index + 1) % statuses.length];
  }

  function removeStation(id: string) {
    stations.value = stations.value.filter((station) => station.id !== id);
  }

  // 登记调价：校验不过整次拒绝，原排期和当前报价不变
  function registerSchedule(draft: ScheduleDraft): string[] {
    const station = stations.value.find((item) => item.id === draft.stationId);
    if (!station) return ["请选择油站"];
    const errors = validateSchedule(draft, station.prices[draft.fuel] ?? 0, schedules.value);
    if (errors.length > 0) return errors;
    schedules.value = [
      {
        ...draft,
        price: Number(draft.price),
        approval: draft.approval.trim(),
        id: crypto.randomUUID(),
        stationName: station.station,
        status: "pending",
        version: 1,
        createdAt: new Date().toISOString(),
        effectiveAt: null
      },
      ...schedules.value
    ];
    return [];
  }

  // 待生效 -> 已生效：写入当前报价并记录价格历史，记录随即锁定
  function activateSchedule(id: string) {
    const schedule = schedules.value.find((item) => item.id === id);
    if (!schedule || schedule.status !== "pending") return;
    const station = stations.value.find((item) => item.id === schedule.stationId);
    if (!station) return;
    const fromPrice = station.prices[schedule.fuel];
    station.prices = { ...station.prices, [schedule.fuel]: schedule.price };
    schedule.status = "effective";
    schedule.version += 1;
    schedule.effectiveAt = new Date().toISOString();
    history.value = [
      {
        id: crypto.randomUUID(),
        stationId: station.id,
        stationName: station.station,
        fuel: schedule.fuel,
        fromPrice,
        toPrice: schedule.price,
        changedAt: schedule.effectiveAt,
        version: schedule.version
      },
      ...history.value
    ];
  }

  // 仅未生效项可撤回，其他排期不变
  function withdrawSchedule(id: string) {
    const schedule = schedules.value.find((item) => item.id === id);
    if (!schedule || schedule.status !== "pending") return;
    schedule.status = "withdrawn";
    schedule.version += 1;
  }

  return {
    stations,
    schedules,
    history,
    filter,
    filteredStations,
    metrics,
    pendingCountByStation,
    addStation,
    flowStation,
    removeStation,
    registerSchedule,
    activateSchedule,
    withdrawSchedule
  };
});
