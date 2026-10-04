import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

// local-store 与 situation-store 都只认 window.localStorage，这里用内存 Map 顶包
const backing = new Map<string, string>()
Object.assign(globalThis, {
  window: {
    localStorage: {
      getItem: (key: string) => (backing.has(key) ? backing.get(key)! : null),
      setItem: (key: string, value: string) => {
        backing.set(key, String(value))
      },
      removeItem: (key: string) => {
        backing.delete(key)
      },
      clear: () => backing.clear(),
    },
  },
})

import {
  assignStationRiver,
  confirmSituationSnapshot,
  loadSituationWall,
} from '../src/api/situation-service'
import { listRows, saveRows } from '../src/data/local-store'
import {
  RULE_VERSION,
  UNASSIGNED_RIVER,
  buildSituation,
  conclusionOf,
  fingerprintOf,
  isRiverMissing,
} from '../src/data/situation'
import type { EntryRow } from '../src/data/types'

describe('isRiverMissing', () => {
  it('空值、占位文本都算缺归属', () => {
    for (const value of ['', '  ', '-', UNASSIGNED_RIVER, '监测站点样例1', undefined, null]) {
      assert.equal(isRiverMissing(value), true, `「${value}」应判为缺归属`)
    }
  })

  it('真实河流名不算缺归属', () => {
    assert.equal(isRiverMissing('清江'), false)
    assert.equal(isRiverMissing('澜河'), false)
  })
})

const WALL_ROWS: Record<string, EntryRow[]> = {
  station: [
    { id: 1, status: '正常运行', pending: false, abnormal: false, 站点编号: 'STAT-0001', 站点名称: '上游站', 所在河流: '清江' },
    { id: 2, status: '设备故障', pending: true, abnormal: true, 站点编号: 'STAT-0002', 站点名称: '下游站', 所在河流: '清江' },
    { id: 3, status: '正常运行', pending: false, abnormal: false, 站点编号: 'STAT-0003', 站点名称: '河口站', 所在河流: '监测站点样例3' },
    { id: 4, status: '汛期加强', pending: false, abnormal: false, 站点编号: 'STAT-0004', 站点名称: '澜河站', 所在河流: '澜河' },
  ],
  telemetry: [
    { id: 1, status: '正常运行', pending: false, abnormal: false, 设备编号: 'TELE-0001', 所属站点: 'STAT-0001' },
    { id: 2, status: '待维修', pending: true, abnormal: false, 设备编号: 'TELE-0002', 所属站点: 'STAT-0002' },
    { id: 3, status: '正常运行', pending: false, abnormal: false, 设备编号: 'TELE-0003', 所属站点: '未知站' },
  ],
  communication: [
    { id: 1, status: '通讯正常', pending: false, abnormal: false, 设备编号: 'COMM-0001', 所属站点: 'STAT-0004' },
  ],
  waterlevel: [
    { id: 1, status: '待审核', pending: true, abnormal: false, 记录编号: 'WATE-0001', 站点编号: 'STAT-0002', 观测时间: '2026-10-01', 当前水位: '514.20', 警戒水位: '513.00' },
    { id: 2, status: '已通过', pending: false, abnormal: false, 记录编号: 'WATE-0002', 站点编号: 'STAT-0001', 观测时间: '2026-10-01', 当前水位: '512.10', 警戒水位: '513.00' },
    { id: 3, status: '已采集', pending: true, abnormal: false, 记录编号: 'WATE-0003', 站点编号: 'STAT-0003', 观测时间: '2026-10-01', 当前水位: '水位监测样例3', 警戒水位: '水位监测样例3' },
  ],
  rainfall: [
    { id: 1, status: '待审核', pending: true, abnormal: false, 记录编号: 'RAIN-0001', 站点编号: 'RAIN-0001' },
  ],
  plan: [
    { id: 1, status: '编制中', pending: true, abnormal: false, 方案编号: 'PLAN-0001' },
  ],
}

describe('buildSituation', () => {
  const situation = buildSituation(WALL_ROWS)
  const groupOf = (river: string) => situation.rivers.find((group) => group.river === river)

  it('按河流聚合站点，占位河流归入未归属组且垫底', () => {
    assert.equal(situation.stationTotal, 4)
    assert.equal(situation.rivers[situation.rivers.length - 1].river, UNASSIGNED_RIVER)
    assert.equal(groupOf('清江')?.stationTotal, 2)
    assert.deepEqual(groupOf('清江')?.stationByStatus, { 正常运行: 1, 设备故障: 1 })
    assert.equal(groupOf('澜河')?.stationTotal, 1)
    assert.equal(groupOf(UNASSIGNED_RIVER)?.stationTotal, 1)
    assert.equal(situation.unassignedStationTotal, 1)
  })

  it('设备按所属站点挂到河流，关联不上站点的设备进未归属组', () => {
    assert.equal(groupOf('清江')?.deviceTotal, 2)
    assert.equal(groupOf('清江')?.deviceOnline, 1)
    assert.equal(groupOf('澜河')?.deviceOnline, 1)
    assert.equal(groupOf(UNASSIGNED_RIVER)?.deviceTotal, 1)
    assert.equal(situation.deviceTotal, 4)
    assert.equal(situation.deviceOnline, 3)
  })

  it('超警只看纯数字水位，占位文本不参与判定', () => {
    assert.equal(situation.alerts.length, 1)
    const alert = situation.alerts[0]
    assert.equal(alert.recordCode, 'WATE-0001')
    assert.equal(alert.river, '清江')
    assert.equal(alert.overBy, 1.2)
  })

  it('待处理只算口径内模块的 pending 记录', () => {
    const keys = situation.todos.map((todo) => `${todo.moduleKey}#${todo.id}`)
    assert.deepEqual(keys.sort(), ['rainfall#1', 'station#2', 'telemetry#2', 'waterlevel#1', 'waterlevel#3'].sort())
  })
})

describe('fingerprintOf', () => {
  it('同一批数据算两次指纹相同', () => {
    assert.equal(fingerprintOf(buildSituation(WALL_ROWS)), fingerprintOf(buildSituation(WALL_ROWS)))
  })

  it('数据一变指纹就变', () => {
    const changed = {
      ...WALL_ROWS,
      waterlevel: WALL_ROWS.waterlevel.map((row) =>
        row.id === 1 ? { ...row, status: '已通过', pending: false } : row,
      ),
    }
    assert.notEqual(fingerprintOf(buildSituation(changed)), fingerprintOf(buildSituation(WALL_ROWS)))
  })
})

describe('conclusionOf', () => {
  it('结论覆盖超警、待处理、设备在线与未归属', () => {
    const conclusion = conclusionOf(buildSituation(WALL_ROWS))
    assert.match(conclusion, /超警 1 条（清江）/)
    assert.match(conclusion, /待处理 5 项/)
    assert.match(conclusion, /设备在线 3\/4/)
    assert.match(conclusion, /未归属站点 1 个待补录/)
  })
})

function seedServiceRows(): void {
  backing.clear()
  saveRows('station', [
    { id: 1, status: '正常运行', pending: false, abnormal: false, 站点编号: 'STAT-0001', 站点名称: '上游站', 所在河流: '清江' },
    { id: 2, status: '正常运行', pending: false, abnormal: false, 站点编号: 'STAT-0002', 站点名称: '河口站', 所在河流: '' },
  ])
  saveRows('telemetry', [
    { id: 1, status: '正常运行', pending: false, abnormal: false, 设备编号: 'TELE-0001', 所属站点: 'STAT-0001' },
  ])
  saveRows('waterlevel', [
    { id: 1, status: '待审核', pending: true, abnormal: false, 记录编号: 'WATE-0001', 站点编号: 'STAT-0001', 观测时间: '2026-10-01', 当前水位: '514.20', 警戒水位: '513.00' },
  ])
  saveRows('inspection', [
    { id: 1, status: '已巡检', pending: true, abnormal: false, 记录编号: 'INSP-0001', 站点编号: 'STAT-0001' },
    { id: 2, status: '待巡检', pending: true, abnormal: false, 记录编号: 'INSP-0002', 站点编号: 'STAT-0002' },
  ])
  for (const key of ['communication', 'discharge', 'rainfall', 'warning']) {
    saveRows(key, [])
  }
}

describe('confirmSituationSnapshot', () => {
  it('首次封存成功并同步生成巡检核查，重复封存只生效一次', () => {
    seedServiceRows()

    const first = confirmSituationSnapshot('站长甲')
    assert.equal(first.ok, true)
    assert.equal(first.snapshotId, 1)
    assert.equal(first.inspectionCode, 'INSP-0003')

    const inspections = listRows('inspection')
    assert.equal(inspections.length, 3)
    const check = inspections[2]
    assert.equal(check.status, '待巡检')
    assert.equal(check.pending, true)
    assert.equal(check['检查项目'], '汛期态势核查')
    assert.equal(check['巡检人员'], '站长甲')
    assert.match(String(check['处理措施']), /#1/)

    // 联动生成的核查是封存的产物，不计入待处理事项，否则指纹会被自己改变
    const wall = loadSituationWall()
    assert.equal(wall.snapshots.length, 1)
    assert.equal(wall.situation.todos.some((todo) => todo.code === 'INSP-0003'), false)

    // 数据没变，再确认（双击/并发重试）不再生成新快照
    const second = confirmSituationSnapshot('站长甲')
    assert.equal(second.ok, false)
    assert.match(second.message, /无需重复封存/)
    assert.equal(loadSituationWall().snapshots.length, 1)
    assert.equal(listRows('inspection').length, 3)
  })

  it('数据变化后允许再封存，已归档快照不随后续改动变化', () => {
    // 设备掉线 → 态势变化 → 可以封存第二张
    saveRows('telemetry', [
      { id: 1, status: '待维修', pending: true, abnormal: false, 设备编号: 'TELE-0001', 所属站点: 'STAT-0001' },
    ])
    const second = confirmSituationSnapshot('站长乙')
    assert.equal(second.ok, true)
    assert.equal(second.snapshotId, 2)

    // 补录河流归属 → 再封存第三张
    const assign = assignStationRiver(2, '澜河')
    assert.equal(assign.ok, true)
    const third = confirmSituationSnapshot('站长乙')
    assert.equal(third.ok, true)

    const snapshots = loadSituationWall().snapshots
    assert.equal(snapshots.length, 3)

    // 快照 #1 是归档：设备在线、未归属分组、结论都保持封存时的样子
    const archived = snapshots[0]
    assert.equal(archived.ruleVersion, RULE_VERSION)
    assert.match(archived.conclusion, /设备在线 1\/1/)
    assert.match(archived.conclusion, /未归属站点 1 个待补录/)
    const archivedUnassigned = archived.rivers.find((group) => group.river === UNASSIGNED_RIVER)
    assert.equal(archivedUnassigned?.stationTotal, 1)
    assert.equal(archivedUnassigned?.stations[0].code, 'STAT-0002')

    // 快照 #2 记录的是设备掉线后的结论，两张各说各话
    assert.match(snapshots[1].conclusion, /设备在线 0\/1/)
    // 快照 #3 里 STAT-0002 已归入澜河
    const latest = snapshots[2]
    assert.equal(latest.rivers.find((group) => group.river === UNASSIGNED_RIVER), undefined)
    assert.equal(latest.rivers.find((group) => group.river === '澜河')?.stationTotal, 1)
  })
})

describe('assignStationRiver', () => {
  it('空名称、未知站点、重复归属都拒绝', () => {
    seedServiceRows()
    assert.equal(assignStationRiver(1, '  ').ok, false)
    assert.equal(assignStationRiver(999, '清江').ok, false)
    assert.equal(assignStationRiver(1, '清江').ok, false)
  })

  it('补录后站点归入新河流', () => {
    seedServiceRows()
    const result = assignStationRiver(2, '澜河')
    assert.equal(result.ok, true)
    assert.equal(String(listRows('station')[1]['所在河流']), '澜河')
    const situation = loadSituationWall().situation
    assert.equal(situation.unassignedStationTotal, 0)
    assert.equal(situation.rivers.find((group) => group.river === '澜河')?.stationTotal, 1)
  })
})
