import { allRows, listRows, saveRows } from '@/data/local-store'
import {
  INSPECTION_CHECK_ITEM,
  buildSituation,
  conclusionOf,
  fingerprintOf,
  type Situation,
  type SituationSnapshot,
} from '@/data/situation'
import { readSnapshots, writeSnapshots } from '@/data/situation-store'
import type { ActionResult, EntryRow } from '@/data/types'

// 汛期态势墙的读写入口：页面只调这里，聚合口径在 data/situation.ts，持久化在 data/situation-store.ts。

export type SituationWall = {
  situation: Situation
  snapshots: SituationSnapshot[]
}

export type ConfirmResult = ActionResult & {
  snapshotId?: number
  inspectionCode?: string
}

export function loadSituationWall(): SituationWall {
  return {
    situation: buildSituation(allRows()),
    snapshots: readSnapshots(),
  }
}

// 封存锁：前一次封存还没落地时，后续的并发调用直接挡掉
let sealing = false

/**
 * 站长确认态势快照。只生效一次靠两道闸：
 * 1. sealing 锁挡住并发重入（双击、多标签页同时点）；
 * 2. 内容指纹比对：当前态势和最新一张快照一致时不再重复封存。
 * 封存成功后同步在巡检模块生成一条「汛期态势核查」待巡检记录。
 */
export function confirmSituationSnapshot(operator: string): ConfirmResult {
  if (sealing) {
    return { ok: false, message: '上一张快照正在封存，本次点击已忽略' }
  }
  sealing = true
  try {
    const situation = buildSituation(allRows())
    const fingerprint = fingerprintOf(situation)
    // 写之前重新读档案，不用缓存，尽量缩小多标签页竞态窗口
    const snapshots = readSnapshots()
    const latest = snapshots[snapshots.length - 1]
    if (latest && latest.fingerprint === fingerprint) {
      return { ok: false, message: `当前态势与快照 #${latest.id} 一致，无需重复封存` }
    }

    const snapshotId = snapshots.reduce((max, item) => Math.max(max, item.id), 0) + 1
    const confirmedAt = formatDateTime(new Date())
    const conclusion = conclusionOf(situation)
    const inspection = appendInspectionCheck(snapshotId, operator, conclusion)

    const snapshot: SituationSnapshot = {
      id: snapshotId,
      fingerprint,
      ruleVersion: situation.ruleVersion,
      confirmedBy: operator,
      confirmedAt,
      conclusion,
      rivers: situation.rivers,
      alerts: situation.alerts,
      todos: situation.todos,
      inspectionId: inspection.id,
      inspectionCode: inspection.code,
    }
    writeSnapshots([...snapshots, snapshot])
    return {
      ok: true,
      message: `快照 #${snapshotId} 已封存，巡检核查 ${inspection.code} 已同步生成`,
      snapshotId,
      inspectionCode: inspection.code,
    }
  } finally {
    sealing = false
  }
}

/** 缺河流归属的存量站补录：只改「所在河流」一个字段，其余不动。 */
export function assignStationRiver(stationId: number, river: string): ActionResult {
  const name = river.trim()
  if (!name) {
    return { ok: false, message: '河流名称不能为空' }
  }
  const rows = listRows('station')
  const index = rows.findIndex((row) => Number(row.id) === stationId)
  if (index < 0) {
    return { ok: false, message: `没有找到编号为 ${stationId} 的水文监测站` }
  }
  if (String(rows[index]['所在河流'] ?? '').trim() === name) {
    return { ok: false, message: `该站已归属「${name}」，不用重复补录` }
  }
  const next = [...rows]
  next[index] = { ...rows[index], 所在河流: name }
  saveRows('station', next)
  return { ok: true, message: `已将 ${rows[index]['站点名称']} 补录到「${name}」` }
}

function appendInspectionCheck(
  snapshotId: number,
  operator: string,
  conclusion: string,
): { id: number; code: string } {
  const rows = listRows('inspection')
  const id = rows.reduce((max, row) => Math.max(max, Number(row.id)), 0) + 1
  const code = nextInspectionCode(rows, id)
  const record: EntryRow = {
    id,
    status: '待巡检',
    pending: true,
    abnormal: false,
    记录编号: code,
    站点编号: '全网',
    巡检日期: formatDate(new Date()),
    巡检人员: operator,
    检查项目: INSPECTION_CHECK_ITEM,
    发现问题: conclusion,
    处理措施: `对照态势快照 #${snapshotId} 逐项核查`,
    巡检状态: '待巡检',
  }
  saveRows('inspection', [...rows, record])
  return { id, code }
}

/** 编号取「已有最大序号 + 1」，存量记录被删过也不会撞号。 */
function nextInspectionCode(rows: EntryRow[], nextId: number): string {
  const used = rows
    .map((row) => /^INSP-(\d+)$/.exec(String(row['记录编号'] ?? ''))?.[1])
    .filter((text): text is string => Boolean(text))
    .map(Number)
  const sequence = Math.max(nextId, ...used.map((num) => num + 1))
  return `INSP-${String(sequence).padStart(4, '0')}`
}

function formatDate(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${date.getFullYear()}-${month}-${day}`
}

function formatDateTime(date: Date): string {
  const hour = String(date.getHours()).padStart(2, '0')
  const minute = String(date.getMinutes()).padStart(2, '0')
  const second = String(date.getSeconds()).padStart(2, '0')
  return `${formatDate(date)} ${hour}:${minute}:${second}`
}
