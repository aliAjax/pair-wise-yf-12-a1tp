// 排期规则：油品、成本线、区间重叠与涨幅校验，全部为纯函数，不依赖状态

export const FUELS = ["92#汽油", "95#汽油", "0#柴油"] as const;
export type Fuel = (typeof FUELS)[number];

export const COST_LINE: Record<Fuel, number> = {
  "92#汽油": 6.55,
  "95#汽油": 6.98,
  "0#柴油": 6.12
};

export const BASE_PRICE: Record<Fuel, number> = {
  "92#汽油": 7.42,
  "95#汽油": 7.96,
  "0#柴油": 7.05
};

export const MAX_INCREASE = 0.2;

export type ScheduleStatus = "待生效" | "已生效" | "已结束" | "已撤回";

export interface PriceSchedule {
  id: string;
  stationId: string;
  stationName: string;
  fuel: Fuel;
  price: number;
  start: string;
  end: string;
  reason: string;
  withdrawn: boolean;
  createdAt: string;
  version: number;
}

export interface ScheduleCandidate {
  stationId: string;
  stationName: string;
  fuel: Fuel;
  price: number;
  start: string;
  end: string;
  reason: string;
}

function time(value: string): number | null {
  const stamp = new Date(value).getTime();
  return Number.isNaN(stamp) ? null : stamp;
}

export function rangesOverlap(aStart: string, aEnd: string, bStart: string, bEnd: string): boolean {
  const [as, ae, bs, be] = [time(aStart), time(aEnd), time(bStart), time(bEnd)];
  if (as === null || ae === null || bs === null || be === null) return false;
  return as <= be && bs <= ae;
}

export function deriveStatus(entry: PriceSchedule, now: Date): ScheduleStatus {
  if (entry.withdrawn) return "已撤回";
  const start = time(entry.start);
  const end = time(entry.end);
  const current = now.getTime();
  if (start !== null && current < start) return "待生效";
  if (end !== null && current > end) return "已结束";
  return "已生效";
}

// 已生效（含已结束、已撤回）记录锁定，仅待生效项可撤回
export function isLocked(entry: PriceSchedule, now: Date): boolean {
  return deriveStatus(entry, now) !== "待生效";
}

export function currentQuote(schedules: PriceSchedule[], stationId: string, fuel: Fuel, now: Date): number {
  const active = schedules
    .filter(
      (item) =>
        !item.withdrawn &&
        item.stationId === stationId &&
        item.fuel === fuel &&
        deriveStatus(item, now) === "已生效"
    )
    .sort((a, b) => b.version - a.version);
  return active.length > 0 ? active[0].price : BASE_PRICE[fuel];
}

export function pendingCount(schedules: PriceSchedule[], stationId: string, now: Date): number {
  return schedules.filter((item) => item.stationId === stationId && deriveStatus(item, now) === "待生效").length;
}

// 校验一次登记：任一违规则整次拒绝，调用方不得改动既有排期与报价
export function validateCandidate(
  candidate: ScheduleCandidate,
  existing: PriceSchedule[],
  now: Date
): string[] {
  const errors: string[] = [];
  const start = time(candidate.start);
  const end = time(candidate.end);

  if (start === null || end === null) {
    errors.push("请填写完整的生效区间");
  } else if (start >= end) {
    errors.push("生效开始时间必须早于结束时间");
  }

  if (!Number.isFinite(candidate.price) || candidate.price <= 0) {
    errors.push("新价格必须为正数");
  } else {
    if (candidate.price < COST_LINE[candidate.fuel]) {
      errors.push(
        `${candidate.fuel} 新价格 ¥${candidate.price.toFixed(2)} 低于成本线 ¥${COST_LINE[candidate.fuel].toFixed(2)}`
      );
    }
    const current = currentQuote(existing, candidate.stationId, candidate.fuel, now);
    if (candidate.price > current * (1 + MAX_INCREASE) && candidate.reason.trim() === "") {
      errors.push(`涨幅超过当前价 ¥${current.toFixed(2)} 的两成，须填写审批依据`);
    }
  }

  if (start !== null && end !== null) {
    const clash = existing.find(
      (item) =>
        !item.withdrawn &&
        item.stationId === candidate.stationId &&
        item.fuel === candidate.fuel &&
        rangesOverlap(candidate.start, candidate.end, item.start, item.end)
    );
    if (clash) {
      errors.push(`生效区间与既有排期（${clash.start.slice(0, 10)} ~ ${clash.end.slice(0, 10)}）重叠`);
    }
  }

  return errors;
}
