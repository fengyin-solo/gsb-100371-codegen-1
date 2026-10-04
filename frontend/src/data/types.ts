/** 纯前端数据层的公共类型：与全栈版后端返回的结构保持一致，换回后端时页面不用改。 */

export type EntryRow = {
  id: number
  status: string
  pending: boolean
  abnormal: boolean
  [field: string]: string | number | boolean
}

export type ModuleMeta = {
  key: string
  name: string
  entity: string
  desc: string
  fields: string[]
  statuses: string[]
  actions: string[]
  actionTargets: Record<string, string>
  metrics: string[]
}

export type PageResult = {
  items: EntryRow[]
  total: number
  page: number
  size: number
}

export type ActionResult = {
  ok: boolean
  message: string
}

export type OverviewResult = {
  cards: { label: string; value: number }[]
  modules: { name: string; created: number; pending: number; abnormal: number }[]
}

/** 汛期态势墙：按河流聚合的一行。 */
export type RiverStat = {
  river: string
  stations: number
  stationsOnline: number
  devices: number
  devicesOnline: number
  unassigned: boolean
}

/** 超警记录：当前水位越过警戒/保证水位的水位记录。 */
export type AlertRecord = {
  id: number
  stationCode: string
  time: string
  current: number
  warning: number
  guarantee: number | null
  level: '超警戒' | '超保证'
  status: string
}

export type PendingItem = { moduleKey: string; name: string; count: number }

export type AbnormalSlice = { name: string; abnormal: number; total: number }

export type UnassignedStation = { id: number; code: string; name: string }

export type SituationWall = {
  rivers: RiverStat[]
  alerts: AlertRecord[]
  pendingItems: PendingItem[]
  abnormalSlices: AbnormalSlice[]
  unassigned: UnassignedStation[]
}

/** 态势快照：封存那一刻的墙数据与结论整体归档，之后汇总规则调整不回算。 */
export type SituationSnapshot = {
  id: string
  periodKey: string
  sealedAt: string
  operator: string
  ruleVersion: number
  ruleSummary: string
  conclusion: string
  wall: SituationWall
  inspectionIds: number[]
}

export type SealResult = {
  ok: boolean
  created: boolean
  message: string
  snapshot?: SituationSnapshot
}
