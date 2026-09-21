<script setup lang="ts">
import { computed, reactive, ref } from "vue";
import { storeToRefs } from "pinia";
import { project } from "./config/project";
import {
  COST_LINES,
  FUEL_TYPES,
  SCHEDULE_STATUS_LABELS,
  type ScheduleDraft
} from "./domain/priceRules";
import { useStationStore } from "./stores/stationStore";
import type { Station } from "./utils/persistence";

type Field = {
  key: string;
  label: string;
  type?: "number" | "date" | "select";
  options?: readonly string[];
};

const fields = project.fields as readonly Field[];
const statuses = [...project.statuses];

const store = useStationStore();
const { schedules, history, filter, filteredStations, metrics, pendingCountByStation } = storeToRefs(store);

function createBlank() {
  return Object.fromEntries(fields.map((field) => [field.key, field.type === "number" ? 0 : ""]));
}

const form = reactive<Record<string, string | number>>(createBlank());
const note = ref("");

const chartRows = computed(() => statuses.map((status) => ({
  status,
  value: store.stations.filter((record) => record.status === status).length
})));

const maxChart = computed(() => Math.max(1, ...chartRows.value.map((row) => row.value)));

function fieldValue(record: Station, key: string) {
  const value = record[key as keyof Station];
  return typeof value === "object" ? "" : value;
}

function primaryText(record: Station) {
  return [record.station, record.area].filter(Boolean).join(" / ") || project.entityLabel;
}

function submit() {
  store.addStation({ ...form }, note.value);
  Object.assign(form, createBlank());
  note.value = "";
}

function blankDraft(): ScheduleDraft {
  return { stationId: "", fuel: FUEL_TYPES[0], price: 0, startDate: "", endDate: "", approval: "" };
}

const draft = reactive<ScheduleDraft>(blankDraft());
const scheduleErrors = ref<string[]>([]);
const scheduleNotice = ref("");

const costLineTip = computed(() =>
  FUEL_TYPES.map((fuel) => `${fuel} ¥${COST_LINES[fuel].toFixed(2)}`).join(" / ")
);

function submitSchedule() {
  scheduleNotice.value = "";
  const errors = store.registerSchedule({ ...draft, price: Number(draft.price) });
  scheduleErrors.value = errors;
  if (errors.length === 0) {
    Object.assign(draft, blankDraft());
    scheduleNotice.value = "已登记一条待生效调价";
  }
}

function formatTime(iso: string | null) {
  if (!iso) return "-";
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? "-" : date.toLocaleString("zh-CN", { hour12: false });
}
</script>

<template>
  <main class="app">
    <div class="shell">
      <header class="topbar">
        <div>
          <p class="eyebrow">{{ project.industry }}行业前端最小闭环</p>
          <h1>{{ project.title }}</h1>
          <p class="subtitle">{{ project.subtitle }}</p>
        </div>
        <div class="stack">
          <span v-for="item in project.stack" :key="item" class="tag">{{ item }}</span>
        </div>
      </header>

      <section class="metrics">
        <article v-for="(label, index) in project.metricLabels" :key="label" class="metric">
          <span>{{ label }}</span>
          <strong>{{ metrics[index] }}</strong>
        </article>
      </section>

      <section class="workspace">
        <div class="side">
          <form class="panel" @submit.prevent="submit">
            <h2>{{ project.formTitle }}</h2>
            <div class="form-grid">
              <label v-for="field in fields" :key="field.key">
                {{ field.label }}
                <select v-if="field.type === 'select'" v-model="form[field.key]" required>
                  <option value="">请选择</option>
                  <option v-for="option in field.options" :key="option">{{ option }}</option>
                </select>
                <input v-else v-model="form[field.key]" :type="field.type || 'text'" required />
              </label>
              <label>
                备注
                <textarea v-model="note" placeholder="填写处理说明或现场备注" />
              </label>
              <button type="submit">{{ project.primaryAction }}</button>
            </div>
          </form>

          <form class="panel" @submit.prevent="submitSchedule">
            <h2>登记调价排期</h2>
            <div class="form-grid">
              <label>
                油站
                <select v-model="draft.stationId" required>
                  <option value="">请选择</option>
                  <option v-for="station in store.stations" :key="station.id" :value="station.id">
                    {{ station.station }}
                  </option>
                </select>
              </label>
              <label>
                油品
                <select v-model="draft.fuel">
                  <option v-for="fuel in FUEL_TYPES" :key="fuel">{{ fuel }}</option>
                </select>
              </label>
              <label>
                新价格（元/L）
                <input v-model.number="draft.price" type="number" min="0" step="0.01" required />
              </label>
              <label>
                生效开始
                <input v-model="draft.startDate" type="date" required />
              </label>
              <label>
                生效结束
                <input v-model="draft.endDate" type="date" required />
              </label>
              <label>
                审批依据
                <textarea v-model="draft.approval" :placeholder="`涨幅超过当前价 ${MAX_INCREASE_RATIO * 100}% 时必填`" />
              </label>
              <p class="hint">成本线：{{ costLineTip }}；校验不过整次拒绝，排期与报价不变</p>
              <ul v-if="scheduleErrors.length" class="error-list">
                <li v-for="error in scheduleErrors" :key="error">{{ error }}</li>
              </ul>
              <p v-if="scheduleNotice" class="ok-tip">{{ scheduleNotice }}</p>
              <button type="submit">提交调价</button>
            </div>
          </form>
        </div>

        <section class="list-panel">
          <div class="toolbar">
            <h2>{{ project.entityLabel }}列表</h2>
            <select v-model="filter">
              <option v-for="item in project.filters" :key="item">{{ item }}</option>
            </select>
          </div>

          <div class="record-grid">
            <div v-if="filteredStations.length === 0" class="empty">暂无匹配数据</div>
            <article v-for="record in filteredStations" :key="record.id" class="record">
              <div class="record-head">
                <p class="record-title">{{ primaryText(record) }}</p>
                <span class="status">{{ record.status }}</span>
              </div>
              <div class="details">
                <span v-for="field in fields" :key="field.key">{{ field.label }}: {{ fieldValue(record, field.key) }}</span>
              </div>
              <div class="prices">
                <span v-for="fuel in FUEL_TYPES" :key="fuel" class="price-chip">
                  {{ fuel }} ¥{{ record.prices[fuel].toFixed(2) }}
                </span>
              </div>
              <p class="note">{{ record.notes }}</p>
              <p v-if="pendingCountByStation[record.id]" class="pending-tip">
                待生效调价 {{ pendingCountByStation[record.id] }} 条
              </p>
              <div class="actions">
                <button type="button" @click="store.flowStation(record.id)">流转状态</button>
                <button class="secondary" type="button" @click="navigator.clipboard?.writeText(primaryText(record))">复制摘要</button>
                <button class="danger" type="button" @click="store.removeStation(record.id)">删除</button>
              </div>
            </article>
          </div>

          <div class="mini-chart">
            <div v-for="row in chartRows" :key="row.status" class="bar">
              <span>{{ row.status }}</span>
              <div class="bar-track"><div class="bar-fill" :style="{ width: `${(row.value / maxChart) * 100}%` }" /></div>
              <strong>{{ row.value }}</strong>
            </div>
          </div>

          <section class="schedule-block">
            <div class="toolbar">
              <h2>调价排期</h2>
              <span class="hint">已生效记录锁定，仅待生效可撤回</span>
            </div>
            <div v-if="schedules.length === 0" class="empty">暂无调价排期</div>
            <article v-for="item in schedules" :key="item.id" class="schedule">
              <div class="record-head">
                <p class="record-title">{{ item.stationName }} / {{ item.fuel }}</p>
                <span class="status" :class="`st-${item.status}`">
                  {{ SCHEDULE_STATUS_LABELS[item.status] }} · v{{ item.version }}
                </span>
              </div>
              <div class="details">
                <span>新价格: ¥{{ item.price.toFixed(2) }}</span>
                <span>生效区间: {{ item.startDate }} ~ {{ item.endDate }}</span>
                <span>审批依据: {{ item.approval || "未填写" }}</span>
                <span>登记时间: {{ formatTime(item.createdAt) }}</span>
              </div>
              <div class="actions">
                <template v-if="item.status === 'pending'">
                  <button type="button" @click="store.activateSchedule(item.id)">标记生效</button>
                  <button class="danger" type="button" @click="store.withdrawSchedule(item.id)">撤回</button>
                </template>
                <span v-else-if="item.status === 'effective'" class="locked">
                  已锁定 · {{ formatTime(item.effectiveAt) }} 生效
                </span>
                <span v-else class="locked">已撤回 · v{{ item.version }}</span>
              </div>
            </article>
          </section>

          <section class="history-block">
            <h2>价格历史</h2>
            <div v-if="history.length === 0" class="empty">暂无价格变动</div>
            <ul v-else class="history-list">
              <li v-for="entry in history" :key="entry.id">
                <span>{{ entry.stationName }} / {{ entry.fuel }}</span>
                <strong>¥{{ entry.fromPrice.toFixed(2) }} → ¥{{ entry.toPrice.toFixed(2) }}</strong>
                <time>{{ formatTime(entry.changedAt) }}</time>
              </li>
            </ul>
          </section>
        </section>
      </section>
    </div>
  </main>
</template>
