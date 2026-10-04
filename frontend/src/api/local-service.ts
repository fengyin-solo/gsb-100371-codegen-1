import { MODULE_BY_KEY } from '@/data/modules'
import { allRows, listRows, resetRows, saveRows } from '@/data/local-store'
import { readSnapshots, writeSnapshots } from '@/data/snapshots'
import {
  RULE_SUMMARY,
  RULE_VERSION,
  buildConclusion,
  buildSituationWall,
  currentPeriodKey,
  formatDate,
  formatDateTime,
} from '@/data/situation'
import type {
  ActionResult,
  EntryRow,
  ModuleMeta,
  OverviewResult,
  PageResult,
  SealResult,
  SituationSnapshot,
  SituationWall,
} from '@/data/types'

// 会写进数据的「往回走」动作：命中就把这条记录标成异常态，看板上能一眼看出来。
const NEGATIVE_ACTIONS = ['撤销', '作废', '拒绝', '驳回', '停用', '忽略', '下线', '回滚']

export function moduleMeta(key: string): ModuleMeta {
  const meta = MODULE_BY_KEY.get(key)
  if (!meta) {
    throw new Error(`没有登记名为 ${key} 的业务模块`)
  }
  return meta
}

export function filterRows(rows: EntryRow[], filters: Record<string, string>): EntryRow[] {
  const pairs = Object.entries(filters).filter(([, value]) => value.trim() !== '')
  if (pairs.length === 0) {
    return rows
  }
  return rows.filter((row) =>
    pairs.every(([field, value]) => String(row[field] ?? '').includes(value.trim())),
  )
}

export function listEntries(key: string, filters: Record<string, string> = {}): PageResult {
  const matched = filterRows(listRows(key), filters)
  return { items: matched, total: matched.length, page: 1, size: matched.length }
}

export function runAction(key: string, id: number, action: string): ActionResult {
  const meta = moduleMeta(key)
  const target = meta.actionTargets[action]
  if (!target) {
    return { ok: false, message: `${meta.entity}没有登记「${action}」这个动作` }
  }
  const rows = listRows(key)
  const index = rows.findIndex((row) => Number(row.id) === id)
  if (index < 0) {
    return { ok: false, message: `没有找到编号为 ${id} 的${meta.entity}` }
  }
  const current = String(rows[index].status)
  if (current === target) {
    return { ok: false, message: `${meta.entity}已经是「${target}」，不用重复操作` }
  }
  const lastStatus = meta.statuses[meta.statuses.length - 1]
  const updated: EntryRow = {
    ...rows[index],
    status: target,
    pending: target !== lastStatus,
    abnormal: NEGATIVE_ACTIONS.some((verb) => action.startsWith(verb)),
  }
  const next = [...rows]
  next[index] = updated
  saveRows(key, next)
  return { ok: true, message: `${meta.entity}已${action}，当前状态「${target}」` }
}

export function resetModule(key: string): PageResult {
  resetRows(key)
  return listEntries(key)
}

export function exportEntries(key: string): { filename: string; content: string } {
  const meta = moduleMeta(key)
  const header = ['编号', ...meta.fields, '当前状态']
  const lines = [header.join(',')]
  for (const row of listRows(key)) {
    lines.push([row.id, ...meta.fields.map((field) => row[field] ?? ''), row.status].join(','))
  }
  return { filename: `${meta.name}-清单.csv`, content: `\uFEFF${lines.join('\n')}` }
}

export function downloadEntries(key: string): void {
  const { filename, content } = exportEntries(key)
  const blob = new Blob([content], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  document.body.appendChild(anchor)
  anchor.click()
  document.body.removeChild(anchor)
  URL.revokeObjectURL(url)
}

export function loadOverview(): OverviewResult {
  const rows = allRows()
  const modules = [...MODULE_BY_KEY.values()].map((meta) => {
    const entries = rows[meta.key] ?? []
    return {
      name: meta.name,
      created: entries.length,
      pending: entries.filter((row) => row.pending).length,
      abnormal: entries.filter((row) => row.abnormal).length,
    }
  })
  const cards = [
    { label: '业务模块', value: modules.length },
    { label: '登记总量', value: modules.reduce((sum, item) => sum + item.created, 0) },
    { label: '待处理', value: modules.reduce((sum, item) => sum + item.pending, 0) },
    { label: '异常量', value: modules.reduce((sum, item) => sum + item.abnormal, 0) },
  ]
  return { cards, modules }
}

export function loadSituationWall(): SituationWall {
  return buildSituationWall(allRows())
}

export function listSituationSnapshots(): SituationSnapshot[] {
  return readSnapshots()
}

/** 封存时同步生成巡检核查：每条超警记录一条核查，每个缺归属站点一条归属核查。 */
function appendInspections(snapshot: SituationSnapshot, wall: SituationWall): number[] {
  const rows = listRows('inspection')
  let nextId = rows.reduce((max, row) => Math.max(max, Number(row.id) || 0), 0)
  const today = formatDate(new Date())
  const created: EntryRow[] = []

  for (const alert of wall.alerts) {
    nextId += 1
    created.push({
      id: nextId,
      status: '待巡检',
      pending: true,
      abnormal: false,
      记录编号: `INSP-${String(nextId).padStart(4, '0')}`,
      站点编号: alert.stationCode,
      巡检日期: today,
      巡检人员: '待指派',
      检查项目: `态势快照${snapshot.id}·超警核查`,
      发现问题: `${alert.level}：当前水位${alert.current}m，警戒水位${alert.warning}m`,
      处理措施: '待现场核查',
      巡检状态: '待巡检',
    })
  }
  for (const station of wall.unassigned) {
    nextId += 1
    created.push({
      id: nextId,
      status: '待巡检',
      pending: true,
      abnormal: false,
      记录编号: `INSP-${String(nextId).padStart(4, '0')}`,
      站点编号: station.code,
      巡检日期: today,
      巡检人员: '待指派',
      检查项目: `态势快照${snapshot.id}·归属核查`,
      发现问题: `站点「${station.name}」缺少河流归属，需补录`,
      处理措施: '待现场核查',
      巡检状态: '待巡检',
    })
  }

  if (created.length > 0) {
    saveRows('inspection', [...rows, ...created])
  }
  return created.map((row) => Number(row.id))
}

let sealing = false

/**
 * 站长确认封存态势快照。同一天同一班次只生效一次：
 * 函数内直读 localStorage 判重，重复点击、并发调用、另一个标签页已封存，都返回已存在的那份。
 */
export function sealSituationSnapshot(operator: string): SealResult {
  if (sealing) {
    return { ok: false, created: false, message: '快照封存进行中，请勿重复提交' }
  }
  sealing = true
  try {
    const now = new Date()
    const periodKey = currentPeriodKey(now)
    const snapshots = readSnapshots()
    const existing = snapshots.find((item) => item.periodKey === periodKey)
    if (existing) {
      return {
        ok: true,
        created: false,
        snapshot: existing,
        message: `本期（${periodKey}）快照 ${existing.id} 已封存，重复确认不再生效`,
      }
    }

    const wall = buildSituationWall(allRows())
    const seq = snapshots.filter((item) => item.periodKey.startsWith(formatDate(now))).length + 1
    const snapshot: SituationSnapshot = {
      id: `SNAP-${formatDate(now).replace(/-/g, '')}-${String(seq).padStart(2, '0')}`,
      periodKey,
      sealedAt: formatDateTime(now),
      operator,
      ruleVersion: RULE_VERSION,
      ruleSummary: RULE_SUMMARY,
      conclusion: buildConclusion(wall),
      wall,
      inspectionIds: [],
    }
    snapshot.inspectionIds = appendInspections(snapshot, wall)
    writeSnapshots([snapshot, ...snapshots])
    return {
      ok: true,
      created: true,
      snapshot,
      message: `态势快照 ${snapshot.id} 已封存，同步生成 ${snapshot.inspectionIds.length} 条巡检核查`,
    }
  } finally {
    sealing = false
  }
}

/** 缺河流归属的存量站走人工补录：不自动猜测，补录后持久化并参与下一次汇总。 */
export function assignStationRiver(id: number, river: string): ActionResult {
  const name = river.trim()
  if (!name) {
    return { ok: false, message: '河流名称不能为空' }
  }
  const rows = listRows('station')
  const index = rows.findIndex((row) => Number(row.id) === id)
  if (index < 0) {
    return { ok: false, message: `没有找到编号为 ${id} 的水文监测站` }
  }
  const next = [...rows]
  next[index] = { ...rows[index], 所在河流: name }
  saveRows('station', next)
  return { ok: true, message: `已为 ${String(next[index]['站点编号'])} 补录河流归属「${name}」` }
}
