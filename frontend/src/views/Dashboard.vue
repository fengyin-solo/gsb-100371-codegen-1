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
    <div class="stat-row">
      <article v-for="card in cards" :key="card.label" class="stat-card">
        <span class="stat-label">{{ card.label }}</span>
        <strong class="stat-value">{{ card.value }}</strong>
      </article>
    </div>

    <section class="situation-wall">
      <header class="wall-head">
        <div>
          <h3 class="wall-title">汛期态势墙</h3>
          <p class="page-desc">汇总规则 v{{ situation?.ruleVersion ?? '-' }}，快照封存后规则调整不影响历史结论。</p>
        </div>
        <div class="page-actions">
          <button class="btn primary" type="button" @click="confirmSnapshot">站长确认态势快照</button>
        </div>
      </header>
      <p v-if="wallMessage" class="wall-message">{{ wallMessage }}</p>
      <p v-if="wallError" class="wall-message error-text">{{ wallError }}</p>
      <div v-if="situation" class="wall-body">
        <div class="wall-left">
          <article v-for="group in situation.rivers" :key="group.river" class="river-group">
            <header class="river-head">
              <strong>{{ group.river }}</strong>
              <span class="river-meta">
                站点 {{ group.stationTotal }} · 设备在线 {{ group.deviceOnline }}/{{ group.deviceTotal }}
              </span>
            </header>
            <ul class="river-stations">
              <li v-for="station in group.stations" :key="station.id">
                <span>{{ station.name }}（{{ station.code }}）</span>
                <span class="station-status">{{ station.status }}</span>
              </li>
              <li v-if="!group.stations.length" class="empty-state">暂无站点</li>
            </ul>
            <p class="river-status">
              <span v-for="(count, status) in group.stationByStatus" :key="status" class="legend-item">
                {{ status }}：{{ count }}
              </span>
            </p>
            <div v-if="group.river === UNASSIGNED_RIVER && group.stations.length" class="assign-panel">
              <p class="assign-tip">以下站点缺河流归属，补录后自动归入对应河流：</p>
              <div v-for="station in group.stations" :key="station.id" class="assign-row">
                <span class="assign-name">{{ station.name }}</span>
                <input
                  v-model="assignDrafts[station.id]"
                  class="assign-input"
                  placeholder="输入河流名称，如：清江"
                />
                <button class="btn" type="button" @click="assignRiver(station.id)">补录</button>
              </div>
            </div>
          </article>
        </div>
        <div class="wall-right">
          <h4 class="wall-subtitle">超警记录（{{ situation.alerts.length }}）</h4>
          <ul class="wall-list">
            <li v-for="alert in situation.alerts" :key="alert.id">
              <strong>{{ alert.recordCode }}</strong>
              {{ alert.river }} · {{ alert.stationCode }} · 当前 {{ alert.currentLevel }}m，
              超警戒 {{ alert.overBy }}m · {{ alert.observedAt }} · {{ alert.status }}
            </li>
            <li v-if="!situation.alerts.length" class="empty-state">当前无超警记录</li>
          </ul>
          <h4 class="wall-subtitle">待处理事项（{{ situation.todos.length }}）</h4>
          <ul class="wall-list">
            <li v-for="todo in situation.todos" :key="`${todo.moduleKey}-${todo.id}`">
              <strong>{{ todo.moduleName }}</strong> {{ todo.code }} · {{ todo.status }}
            </li>
            <li v-if="!situation.todos.length" class="empty-state">当前无待处理事项</li>
          </ul>
        </div>
      </div>
      <footer class="wall-foot">
        <h4 class="wall-subtitle">异常变化条</h4>
        <div class="anomaly-bars">
          <div v-for="row in moduleRows" :key="row.name" class="anomaly-item">
            <span class="anomaly-name">{{ row.name }}</span>
            <span class="anomaly-track">
              <i class="anomaly-fill" :style="{ width: anomalyWidth(row) }"></i>
            </span>
            <span class="anomaly-count">{{ row.abnormal }}/{{ row.created }}</span>
          </div>
        </div>
      </footer>
    </section>

    <section v-if="snapshots.length" class="snapshot-history">
      <h3 class="wall-title">态势快照档案</h3>
      <table class="data-table">
        <thead>
          <tr>
            <th>编号</th><th>封存时间</th><th>确认人</th><th>规则版本</th>
            <th>超警</th><th>待处理</th><th>态势结论</th><th>联动巡检</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="snapshot in [...snapshots].reverse()" :key="snapshot.id">
            <td>#{{ snapshot.id }}</td>
            <td>{{ snapshot.confirmedAt }}</td>
            <td>{{ snapshot.confirmedBy }}</td>
            <td>v{{ snapshot.ruleVersion }}</td>
            <td>{{ snapshot.alerts.length }}</td>
            <td>{{ snapshot.todos.length }}</td>
            <td>{{ snapshot.conclusion }}</td>
            <td>{{ snapshot.inspectionCode }}</td>
          </tr>
        </tbody>
      </table>
    </section>

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
import { onMounted, ref } from 'vue'

import { loadOverview } from '@/api/local-service'
import {
  assignStationRiver,
  confirmSituationSnapshot,
  loadSituationWall,
} from '@/api/situation-service'
import { UNASSIGNED_RIVER, type Situation, type SituationSnapshot } from '@/data/situation'
import type { OverviewResult } from '@/data/types'
import { useSessionStore } from '@/stores/session'

const store = useSessionStore()

const cards = ref<OverviewResult['cards']>([])
const moduleRows = ref<OverviewResult['modules']>([])
const situation = ref<Situation | null>(null)
const snapshots = ref<SituationSnapshot[]>([])
const wallMessage = ref('')
const wallError = ref('')
const assignDrafts = ref<Record<number, string>>({})

function anomalyWidth(row: OverviewResult['modules'][number]): string {
  if (!row.created) {
    return '0%'
  }
  return `${Math.round((row.abnormal / row.created) * 100)}%`
}

function confirmSnapshot() {
  wallMessage.value = ''
  wallError.value = ''
  const result = confirmSituationSnapshot(store.operator)
  if (result.ok) {
    wallMessage.value = result.message
  } else {
    wallError.value = result.message
  }
  refresh()
}

function assignRiver(stationId: number) {
  wallMessage.value = ''
  wallError.value = ''
  const result = assignStationRiver(stationId, assignDrafts.value[stationId] ?? '')
  if (result.ok) {
    wallMessage.value = result.message
    delete assignDrafts.value[stationId]
  } else {
    wallError.value = result.message
  }
  refresh()
}

function refresh() {
  const payload = loadOverview()
  cards.value = payload.cards
  moduleRows.value = payload.modules
  const wall = loadSituationWall()
  situation.value = wall.situation
  snapshots.value = wall.snapshots
}

onMounted(refresh)
</script>
