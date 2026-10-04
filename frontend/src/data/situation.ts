import { MODULE_BY_KEY } from './modules'
import type { EntryRow } from './types'

// 汛期态势墙的纯聚合逻辑：不碰 localStorage、不碰 DOM，方便单测。
// 汇总规则（按河流聚合的口径、超警判定、待处理范围、设备在线口径）都集中在这一个文件里。

/**
 * 汇总规则版本：调整本文件里任何聚合口径时 +1。
 * 已归档快照存的是当时规则下算出的结果与结论，版本号随快照封存，
 * 之后规则升级不回溯重算，历史记录沿用原结论。
 */
export const RULE_VERSION = 1

/** 缺河流归属的站点与关联不上站点的设备统一归入这一组，等待人工补录。 */
export const UNASSIGNED_RIVER = '未归属河流'

/**
 * 快照封存时联动生成的巡检核查的「检查项目」标记。
 * 这类记录是封存的产物，不计入待处理事项：否则每封存一次态势就多一条待办，
 * 指纹跟着变，下一次确认永远能再封存，幂等就失效了。
 */
export const INSPECTION_CHECK_ITEM = '汛期态势核查'

/** 设备在线口径：遥测设备「正常运行」、通讯设备「通讯正常」视为在线。 */
const DEVICE_MODULES: { key: string; onlineStatus: string }[] = [
  { key: 'telemetry', onlineStatus: '正常运行' },
  { key: 'communication', onlineStatus: '通讯正常' },
]

/** 待处理事项口径：只捞汛期直接相关的模块，其余模块的待办不进态势墙。 */
const TODO_MODULES = [
  'station',
  'waterlevel',
  'discharge',
  'rainfall',
  'telemetry',
  'communication',
  'inspection',
  'warning',
]

export type StationBrief = {
  id: number
  code: string
  name: string
  status: string
}

export type RiverGroup = {
  river: string
  stationTotal: number
  stationByStatus: Record<string, number>
  stations: StationBrief[]
  deviceTotal: number
  deviceOnline: number
}

export type AlertItem = {
  id: number
  recordCode: string
  stationCode: string
  river: string
  observedAt: string
  currentLevel: number
  warningLevel: number
  overBy: number
  status: string
}

export type TodoItem = {
  moduleKey: string
  moduleName: string
  id: number
  code: string
  status: string
}

export type Situation = {
  ruleVersion: number
  stationTotal: number
  deviceTotal: number
  deviceOnline: number
  unassignedStationTotal: number
  rivers: RiverGroup[]
  alerts: AlertItem[]
  todos: TodoItem[]
}

export type SituationSnapshot = {
  id: number
  fingerprint: string
  ruleVersion: number
  confirmedBy: string
  confirmedAt: string
  conclusion: string
  rivers: RiverGroup[]
  alerts: AlertItem[]
  todos: TodoItem[]
  inspectionId: number
  inspectionCode: string
}

/**
 * 河流归属是否缺失：空值算缺失；历史种子/占位数据（如「监测站点样例1」）
 * 不是真实河流名，也按缺失处理。缺失不静默改写原记录，只在聚合时归入未归属组。
 */
export function isRiverMissing(value: unknown): boolean {
  const text = String(value ?? '').trim()
  if (text === '' || text === '-' || text === UNASSIGNED_RIVER) {
    return true
  }
  return text.includes('样例')
}

/** 水位只认纯数字文本；「水位监测样例1」这类占位值返回 null，不参与超警判定。 */
function parseLevel(value: unknown): number | null {
  const text = String(value ?? '').trim()
  if (!/^[+-]?(\d+\.?\d*|\.\d+)$/.test(text)) {
    return null
  }
  const num = Number(text)
  return Number.isFinite(num) ? num : null
}

function riverGroupOf(groups: Map<string, RiverGroup>, river: string): RiverGroup {
  let group = groups.get(river)
  if (!group) {
    group = { river, stationTotal: 0, stationByStatus: {}, stations: [], deviceTotal: 0, deviceOnline: 0 }
    groups.set(river, group)
  }
  return group
}

/** 按当前数据算出一份态势：左栏河流聚合 + 右栏超警与待处理。 */
export function buildSituation(rows: Record<string, EntryRow[]>): Situation {
  const groups = new Map<string, RiverGroup>()
  // 站点编号、站点名称都能把设备挂到站点上
  const riverByStation = new Map<string, string>()

  const stations = rows['station'] ?? []
  for (const station of stations) {
    const rawRiver = station['所在河流']
    const river = isRiverMissing(rawRiver) ? UNASSIGNED_RIVER : String(rawRiver).trim()
    const group = riverGroupOf(groups, river)
    const status = String(station.status)
    group.stationTotal += 1
    group.stationByStatus[status] = (group.stationByStatus[status] ?? 0) + 1
    group.stations.push({
      id: Number(station.id),
      code: String(station['站点编号'] ?? ''),
      name: String(station['站点名称'] ?? ''),
      status,
    })
    riverByStation.set(String(station['站点编号'] ?? ''), river)
    riverByStation.set(String(station['站点名称'] ?? ''), river)
  }

  let deviceTotal = 0
  let deviceOnline = 0
  for (const { key, onlineStatus } of DEVICE_MODULES) {
    for (const device of rows[key] ?? []) {
      const owner = String(device['所属站点'] ?? '').trim()
      const river = riverByStation.get(owner) ?? UNASSIGNED_RIVER
      const group = riverGroupOf(groups, river)
      const online = String(device.status) === onlineStatus
      group.deviceTotal += 1
      if (online) {
        group.deviceOnline += 1
      }
      deviceTotal += 1
      if (online) {
        deviceOnline += 1
      }
    }
  }

  const alerts: AlertItem[] = []
  for (const record of rows['waterlevel'] ?? []) {
    const current = parseLevel(record['当前水位'])
    const warning = parseLevel(record['警戒水位'])
    if (current === null || warning === null || current <= warning) {
      continue
    }
    const stationCode = String(record['站点编号'] ?? '')
    alerts.push({
      id: Number(record.id),
      recordCode: String(record['记录编号'] ?? ''),
      stationCode,
      river: riverByStation.get(stationCode) ?? UNASSIGNED_RIVER,
      observedAt: String(record['观测时间'] ?? ''),
      currentLevel: current,
      warningLevel: warning,
      overBy: Math.round((current - warning) * 100) / 100,
      status: String(record.status),
    })
  }

  const todos: TodoItem[] = []
  for (const key of TODO_MODULES) {
    const meta = MODULE_BY_KEY.get(key)
    if (!meta) {
      continue
    }
    const codeField = meta.fields[0]
    for (const row of rows[key] ?? []) {
      if (!row.pending) {
        continue
      }
      if (key === 'inspection' && row['检查项目'] === INSPECTION_CHECK_ITEM) {
        continue
      }
      todos.push({
        moduleKey: key,
        moduleName: meta.name,
        id: Number(row.id),
        code: String(row[codeField] ?? row.id),
        status: String(row.status),
      })
    }
  }

  // 真实河流排前面，未归属组固定垫底，方便站长一眼看到待补录
  const rivers = [...groups.values()].sort((a, b) => {
    if (a.river === UNASSIGNED_RIVER) return 1
    if (b.river === UNASSIGNED_RIVER) return -1
    return a.river.localeCompare(b.river, 'zh-CN')
  })

  return {
    ruleVersion: RULE_VERSION,
    stationTotal: stations.length,
    deviceTotal,
    deviceOnline,
    unassignedStationTotal: groups.get(UNASSIGNED_RIVER)?.stationTotal ?? 0,
    rivers,
    alerts,
    todos,
  }
}

/** 态势内容指纹：同一批数据算两次必须相同，数据一变指纹就变，靠它挡住重复封存。 */
export function fingerprintOf(situation: Situation): string {
  const basis = {
    ruleVersion: situation.ruleVersion,
    rivers: situation.rivers.map((group) => [
      group.river,
      group.stationTotal,
      group.stationByStatus,
      group.deviceTotal,
      group.deviceOnline,
    ]),
    alerts: situation.alerts.map((item) => [item.id, item.currentLevel, item.warningLevel, item.status]),
    todos: situation.todos.map((item) => [item.moduleKey, item.id, item.status]),
  }
  return hashString(JSON.stringify(basis))
}

function hashString(text: string): string {
  let hash = 5381
  for (let index = 0; index < text.length; index += 1) {
    hash = ((hash << 5) + hash + text.charCodeAt(index)) >>> 0
  }
  return hash.toString(36)
}

/** 态势结论：封存时写进快照，之后规则怎么改，历史快照都沿用这段原文。 */
export function conclusionOf(situation: Situation): string {
  const parts: string[] = []
  if (situation.alerts.length > 0) {
    const rivers = [...new Set(situation.alerts.map((item) => item.river))].join('、')
    parts.push(`超警 ${situation.alerts.length} 条（${rivers}）`)
  } else {
    parts.push('无超警记录')
  }
  parts.push(`待处理 ${situation.todos.length} 项`)
  parts.push(`设备在线 ${situation.deviceOnline}/${situation.deviceTotal}`)
  if (situation.unassignedStationTotal > 0) {
    parts.push(`未归属站点 ${situation.unassignedStationTotal} 个待补录`)
  }
  return parts.join(' · ')
}
