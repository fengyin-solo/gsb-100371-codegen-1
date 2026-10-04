import { MODULES } from './modules'
import type {
  AbnormalSlice,
  AlertRecord,
  EntryRow,
  PendingItem,
  RiverStat,
  SituationWall,
  UnassignedStation,
} from './types'

// 汇总规则版本：规则每调整一次就 +1。已归档快照存的是封存时的版本与结论，不随新规重算。
export const RULE_VERSION = 1
export const RULE_SUMMARY =
  '站点在线=运行状态为正常运行/汛期加强；设备在线=遥测设备非待维修、已停用，通讯设备非通讯中断、待更换；' +
  '超警=当前水位超过警戒水位，超过保证水位记为超保证；缺河流归属的站点单列「待补录归属」。'

// 缺河流归属的存量站统一归到这个桶，不自动猜测河流，等人工作补录。
export const UNASSIGNED_RIVER = '待补录归属'

const STATION_ONLINE_STATUSES = ['正常运行', '汛期加强']
const TELEMETRY_OFFLINE_STATUSES = ['待维修', '已停用']
const COMMUNICATION_ONLINE_STATUSES = ['通讯正常', '信号弱']

function num(value: unknown): number | null {
  const parsed = Number(value)
  return Number.isFinite(parsed) && String(value ?? '').trim() !== '' ? parsed : null
}

export function isUnassignedRiver(value: unknown): boolean {
  return String(value ?? '').trim() === ''
}

function pad2(value: number): string {
  return String(value).padStart(2, '0')
}

export function formatDate(now: Date): string {
  return `${now.getFullYear()}-${pad2(now.getMonth() + 1)}-${pad2(now.getDate())}`
}

export function formatDateTime(now: Date): string {
  return `${formatDate(now)} ${pad2(now.getHours())}:${pad2(now.getMinutes())}`
}

/** 封存周期键：同一天同一班次只认一份快照，并发/重复确认按它去重。 */
export function currentPeriodKey(now: Date = new Date()): string {
  const hour = now.getHours()
  const shift = hour >= 8 && hour < 20 ? '白班' : '夜班'
  return `${formatDate(now)} ${shift}`
}

function buildRivers(
  stations: EntryRow[],
  telemetry: EntryRow[],
  communication: EntryRow[],
): RiverStat[] {
  const stationByCode = new Map(stations.map((row) => [String(row['站点编号'] ?? ''), row]))
  const buckets = new Map<string, RiverStat>()
  const bucketOf = (river: string): RiverStat => {
    let bucket = buckets.get(river)
    if (!bucket) {
      bucket = {
        river,
        stations: 0,
        stationsOnline: 0,
        devices: 0,
        devicesOnline: 0,
        unassigned: river === UNASSIGNED_RIVER,
      }
      buckets.set(river, bucket)
    }
    return bucket
  }

  for (const station of stations) {
    const river = isUnassignedRiver(station['所在河流'])
      ? UNASSIGNED_RIVER
      : String(station['所在河流']).trim()
    const bucket = bucketOf(river)
    bucket.stations += 1
    if (STATION_ONLINE_STATUSES.includes(String(station.status))) {
      bucket.stationsOnline += 1
    }
  }

  const riverOfDevice = (row: EntryRow): string => {
    const station = stationByCode.get(String(row['所属站点'] ?? ''))
    if (!station || isUnassignedRiver(station['所在河流'])) {
      return UNASSIGNED_RIVER
    }
    return String(station['所在河流']).trim()
  }

  for (const device of telemetry) {
    const bucket = bucketOf(riverOfDevice(device))
    bucket.devices += 1
    if (!TELEMETRY_OFFLINE_STATUSES.includes(String(device.status))) {
      bucket.devicesOnline += 1
    }
  }
  for (const device of communication) {
    const bucket = bucketOf(riverOfDevice(device))
    bucket.devices += 1
    if (COMMUNICATION_ONLINE_STATUSES.includes(String(device.status))) {
      bucket.devicesOnline += 1
    }
  }

  return [...buckets.values()].sort((a, b) => {
    if (a.unassigned !== b.unassigned) {
      return a.unassigned ? 1 : -1
    }
    return b.stations - a.stations || a.river.localeCompare(b.river)
  })
}

function buildAlerts(waterlevel: EntryRow[]): AlertRecord[] {
  const alerts: AlertRecord[] = []
  for (const row of waterlevel) {
    const current = num(row['当前水位'])
    const warning = num(row['警戒水位'])
    const guarantee = num(row['保证水位'])
    if (current === null || warning === null || current <= warning) {
      continue
    }
    const overGuarantee = guarantee !== null && current > guarantee
    alerts.push({
      id: Number(row.id),
      stationCode: String(row['站点编号'] ?? ''),
      time: String(row['观测时间'] ?? ''),
      current,
      warning,
      guarantee,
      level: overGuarantee ? '超保证' : '超警戒',
      status: String(row.status ?? ''),
    })
  }
  return alerts.sort((a, b) => b.current - b.warning - (a.current - a.warning))
}

function buildPendingItems(rows: Record<string, EntryRow[]>): PendingItem[] {
  return MODULES.map((meta) => ({
    moduleKey: meta.key,
    name: meta.name,
    count: (rows[meta.key] ?? []).filter((row) => row.pending).length,
  }))
    .filter((item) => item.count > 0)
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
}

function buildAbnormalSlices(rows: Record<string, EntryRow[]>): AbnormalSlice[] {
  return MODULES.map((meta) => {
    const entries = rows[meta.key] ?? []
    return {
      name: meta.name,
      abnormal: entries.filter((row) => row.abnormal).length,
      total: entries.length,
    }
  }).filter((slice) => slice.abnormal > 0)
}

export function buildSituationWall(rows: Record<string, EntryRow[]>): SituationWall {
  const stations = rows['station'] ?? []
  return {
    rivers: buildRivers(stations, rows['telemetry'] ?? [], rows['communication'] ?? []),
    alerts: buildAlerts(rows['waterlevel'] ?? []),
    pendingItems: buildPendingItems(rows),
    abnormalSlices: buildAbnormalSlices(rows),
    unassigned: stations
      .filter((row) => isUnassignedRiver(row['所在河流']))
      .map(
        (row): UnassignedStation => ({
          id: Number(row.id),
          code: String(row['站点编号'] ?? ''),
          name: String(row['站点名称'] ?? ''),
        }),
      ),
  }
}

/** 汇总结论：封存时随快照归档，历史快照就按这句话展示，不随规则调整重算。 */
export function buildConclusion(wall: SituationWall): string {
  const rivers = wall.rivers.filter((river) => !river.unassigned)
  const stations = rivers.reduce((sum, river) => sum + river.stations, 0)
  const stationsOnline = rivers.reduce((sum, river) => sum + river.stationsOnline, 0)
  const devices = wall.rivers.reduce((sum, river) => sum + river.devices, 0)
  const devicesOnline = wall.rivers.reduce((sum, river) => sum + river.devicesOnline, 0)
  const overGuarantee = wall.alerts.filter((alert) => alert.level === '超保证').length
  const pending = wall.pendingItems.reduce((sum, item) => sum + item.count, 0)
  const abnormal = wall.abnormalSlices.reduce((sum, slice) => sum + slice.abnormal, 0)
  return (
    `覆盖${rivers.length}条河流${stations}站（在线${stationsOnline}），设备在线${devicesOnline}/${devices}；` +
    `超警${wall.alerts.length}站次（超保证${overGuarantee}）；待处理${pending}项、异常${abnormal}条；` +
    `缺河流归属${wall.unassigned.length}站。`
  )
}
