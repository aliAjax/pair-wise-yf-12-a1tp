// 排期规则：油品、成本线、涨幅审批阈值与调价校验，纯函数不依赖界面与存储

export const FUEL_TYPES = ["92#汽油", "95#汽油", "0#柴油"] as const;
export type FuelType = (typeof FUEL_TYPES)[number];

// 成本线：新价格低于该线整次拒绝
export const COST_LINES: Record<FuelType, number> = {
  "92#汽油": 6.8,
  "95#汽油": 7.2,
  "0#柴油": 6.2
};

// 新油站的默认挂牌价
export const DEFAULT_PRICES: Record<FuelType, number> = {
  "92#汽油": 7.85,
  "95#汽油": 8.36,
  "0#柴油": 7.15
};

// 涨幅超过当前价两成时必须填写审批依据
export const MAX_INCREASE_RATIO = 0.2;

export const SCHEDULE_STATUSES = ["pending", "effective", "withdrawn"] as const;
export type ScheduleStatus = (typeof SCHEDULE_STATUSES)[number];

export const SCHEDULE_STATUS_LABELS: Record<ScheduleStatus, string> = {
  pending: "待生效",
  effective: "已生效",
  withdrawn: "已撤回"
};

export type PriceSchedule = {
  id: string;
  stationId: string;
  stationName: string;
  fuel: FuelType;
  price: number;
  startDate: string;
  endDate: string;
  approval: string;
  status: ScheduleStatus;
  version: number;
  createdAt: string;
  effectiveAt: string | null;
};

export type ScheduleDraft = {
  stationId: string;
  fuel: FuelType;
  price: number;
  startDate: string;
  endDate: string;
  approval: string;
};

// 区间按天计，端点相接视为重叠（同一天不能出现两个价格）
export function rangesOverlap(aStart: string, aEnd: string, bStart: string, bEnd: string): boolean {
  return aStart <= bEnd && bStart <= aEnd;
}

// 返回全部违规原因；非空即整次拒绝，调用方不得改动排期与当前报价
export function validateSchedule(
  draft: ScheduleDraft,
  currentPrice: number,
  schedules: readonly PriceSchedule[]
): string[] {
  const errors: string[] = [];
  const price = Number(draft.price);
  const approval = draft.approval.trim();

  if (!draft.stationId) errors.push("请选择油站");
  if (!Number.isFinite(price) || price <= 0) errors.push("新价格必须大于 0");
  if (!draft.startDate || !draft.endDate) {
    errors.push("请填写完整生效区间");
  } else if (draft.startDate > draft.endDate) {
    errors.push("生效开始日期不能晚于结束日期");
  }

  const costLine = COST_LINES[draft.fuel];
  if (Number.isFinite(price) && price > 0 && price < costLine) {
    errors.push(`新价格 ¥${price.toFixed(2)} 低于${draft.fuel}成本线 ¥${costLine.toFixed(2)}`);
  }

  if (currentPrice > 0 && Number.isFinite(price) && price > 0) {
    const ratio = (price - currentPrice) / currentPrice;
    if (ratio > MAX_INCREASE_RATIO && !approval) {
      errors.push(`涨幅 ${(ratio * 100).toFixed(1)}% 超过当前价两成，须填写审批依据`);
    }
  }

  if (draft.stationId && draft.startDate && draft.endDate && draft.startDate <= draft.endDate) {
    const related = schedules.filter(
      (item) => item.stationId === draft.stationId && item.fuel === draft.fuel && item.status !== "withdrawn"
    );
    // 每个油站按油品只保留一条待生效价格
    if (related.some((item) => item.status === "pending")) {
      errors.push("该油品已存在待生效调价，请先撤回或生效后再登记");
    }
    for (const item of related) {
      if (rangesOverlap(draft.startDate, draft.endDate, item.startDate, item.endDate)) {
        errors.push(`生效区间与${SCHEDULE_STATUS_LABELS[item.status]}排期 ${item.startDate} ~ ${item.endDate} 重叠`);
      }
    }
  }

  return errors;
}
