<template>
  <section class="page">
    <header class="page-head">
      <div>
        <h2>运营概览</h2>
        <p class="page-desc">汇总各业务模块的关键指标，先看总量再看异常。</p>
      </div>
      <div class="page-actions">
        <button class="btn" type="button" @click="refresh">重新统计</button>
      </div>
    </header>

    <section class="wall">
      <header class="wall-head">
        <div>
          <h3 class="wall-title">汛期态势墙</h3>
          <p class="wall-desc">汇总规则 v{{ ruleVersion }}：{{ ruleSummary }}</p>
        </div>
        <div class="page-actions">
          <button class="btn primary" type="button" @click="seal">站长确认封存快照</button>
        </div>
      </header>
      <p v-if="sealMessage" class="wall-message" :class="{ 'error-text': sealFailed }">{{ sealMessage }}</p>

      <div class="wall-grid">
        <div class="wall-col">
          <h4>河流态势</h4>
          <table class="data-table">
            <thead>
              <tr><th>河流</th><th>站点（在线/总数）</th><th>设备（在线/总数）</th></tr>
            </thead>
            <tbody>
              <tr v-for="river in wall.rivers" :key="river.river" :class="{ 'unassigned-row': river.unassigned }">
                <td>{{ river.river }}</td>
                <td>{{ river.stationsOnline }}/{{ river.stations }}</td>
                <td>{{ river.devicesOnline }}/{{ river.devices }}</td>
              </tr>
              <tr v-if="!wall.rivers.length">
                <td colspan="3" class="empty-state">暂无站点数据</td>
              </tr>
            </tbody>
          </table>
          <div v-if="wall.unassigned.length" class="backfill">
            <p class="backfill-tip">以下存量站缺河流归属，不自动猜测，请人工补录：</p>
            <div v-for="station in wall.unassigned" :key="station.id" class="backfill-item">
              <span class="backfill-name">{{ station.code }} · {{ station.name }}</span>
              <input v-model="riverDrafts[station.id]" placeholder="填写所在河流" />
              <button class="btn" type="button" @click="backfill(station.id)">补录归属</button>
            </div>
          </div>
        </div>

        <div class="wall-col">
          <h4>超警记录</h4>
          <table class="data-table">
            <thead>
              <tr><th>站点</th><th>观测时间</th><th>级别</th><th>当前/警戒水位</th></tr>
            </thead>
            <tbody>
              <tr v-for="alert in wall.alerts" :key="alert.id">
                <td>{{ alert.stationCode }}</td>
                <td>{{ alert.time }}</td>
                <td><span class="alert-level" :class="{ severe: alert.level === '超保证' }">{{ alert.level }}</span></td>
                <td>{{ alert.current }}m / {{ alert.warning }}m</td>
              </tr>
              <tr v-if="!wall.alerts.length">
                <td colspan="4" class="empty-state">当前无超警记录</td>
              </tr>
            </tbody>
          </table>
          <h4>待处理事项</h4>
          <ul class="pending-list">
            <li v-for="item in wall.pendingItems" :key="item.moduleKey">
              <span>{{ item.name }}</span>
              <strong>{{ item.count }}</strong>
            </li>
            <li v-if="!wall.pendingItems.length" class="empty-state">当前无待处理事项</li>
          </ul>
        </div>
      </div>

      <div class="abnormal-bar">
        <h4>异常变化条</h4>
        <div v-if="abnormalTotal" class="abnormal-strip">
          <span
            v-for="(slice, index) in wall.abnormalSlices"
            :key="slice.name"
            class="abnormal-segment"
            :style="{ width: `${(slice.abnormal / abnormalTotal) * 100}%`, background: segmentColor(index) }"
            :title="`${slice.name} 异常${slice.abnormal}条`"
          ></span>
        </div>
        <p v-else class="empty-state">当前各模块均无异常</p>
        <p class="abnormal-legend">
          <span v-for="(slice, index) in wall.abnormalSlices" :key="slice.name" class="legend-item">
            <i class="legend-dot" :style="{ background: segmentColor(index) }"></i>
            {{ slice.name }} {{ slice.abnormal }}/{{ slice.total }}
          </span>
        </p>
      </div>
    </section>

    <section v-if="snapshots.length" class="wall">
      <h3 class="wall-title">快照历史</h3>
      <p class="wall-desc">已归档快照按封存时的汇总规则固化，规则调整不影响历史结论。</p>
      <table class="data-table">
        <thead>
          <tr><th>快照编号</th><th>封存时间</th><th>确认人</th><th>规则版本</th><th>结论</th><th>核查记录</th></tr>
        </thead>
        <tbody>
          <tr v-for="snapshot in snapshots" :key="snapshot.id">
            <td>{{ snapshot.id }}</td>
            <td>{{ snapshot.sealedAt }}</td>
            <td>{{ snapshot.operator }}</td>
            <td>v{{ snapshot.ruleVersion }}</td>
            <td>{{ snapshot.conclusion }}</td>
            <td>{{ snapshot.inspectionIds.length }} 条</td>
          </tr>
        </tbody>
      </table>
    </section>

    <div class="stat-row">
      <article v-for="card in cards" :key="card.label" class="stat-card">
        <span class="stat-label">{{ card.label }}</span>
        <strong class="stat-value">{{ card.value }}</strong>
      </article>
    </div>
    <table class="data-table">
      <thead>
        <tr><th>业务模块</th><th>今日新增</th><th>待处理</th><th>异常量</th></tr>
      </thead>
      <tbody>
        <tr v-for="row in moduleRows" :key="row.name">
          <td>{{ row.name }}</td>
          <td>{{ row.created }}</td>
          <td>{{ row.pending }}</td>
          <td>{{ row.abnormal }}</td>
        </tr>
      </tbody>
    </table>
    <footer class="page-foot">
      <span>数据保存在本机浏览器里，换浏览器或清缓存会回到示例数据</span>
    </footer>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'

import {
  assignStationRiver,
  listSituationSnapshots,
  loadOverview,
  loadSituationWall,
  sealSituationSnapshot,
} from '@/api/local-service'
import { RULE_SUMMARY, RULE_VERSION } from '@/data/situation'
import type { OverviewResult, SituationSnapshot, SituationWall } from '@/data/types'
import { useSessionStore } from '@/stores/session'

const store = useSessionStore()

const cards = ref<OverviewResult['cards']>([])
const moduleRows = ref<OverviewResult['modules']>([])
const wall = ref<SituationWall>({ rivers: [], alerts: [], pendingItems: [], abnormalSlices: [], unassigned: [] })
const snapshots = ref<SituationSnapshot[]>([])
const riverDrafts = ref<Record<number, string>>({})
const sealMessage = ref('')
const sealFailed = ref(false)

const ruleVersion = RULE_VERSION
const ruleSummary = RULE_SUMMARY

const abnormalTotal = computed(() =>
  wall.value.abnormalSlices.reduce((sum, slice) => sum + slice.abnormal, 0),
)

const SEGMENT_COLORS = ['#d92d20', '#f79009', '#7a5af8', '#12805c', '#e31b54', '#0ba5ec']

function segmentColor(index: number): string {
  return SEGMENT_COLORS[index % SEGMENT_COLORS.length]
}

function seal() {
  const result = sealSituationSnapshot(store.operator)
  sealMessage.value = result.message
  sealFailed.value = !result.ok
  refresh()
}

function backfill(id: number) {
  const result = assignStationRiver(id, riverDrafts.value[id] ?? '')
  sealMessage.value = result.message
  sealFailed.value = !result.ok
  if (result.ok) {
    delete riverDrafts.value[id]
  }
  refresh()
}

function refresh() {
  const payload = loadOverview()
  cards.value = payload.cards
  moduleRows.value = payload.modules
  wall.value = loadSituationWall()
  snapshots.value = listSituationSnapshots()
}

onMounted(refresh)
</script>
