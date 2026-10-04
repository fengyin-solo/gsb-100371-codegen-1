import type { SituationSnapshot } from './situation'

// 快照档案单独存一个 key，和业务记录分开：快照是只进不出的档案，不随模块重置被清掉。
const SNAPSHOT_KEY = 'hydrology-monitor-station:snapshots'

function storage(): Storage | null {
  if (typeof window === 'undefined' || !window.localStorage) {
    return null
  }
  return window.localStorage
}

// 每次都直读 localStorage、不挂内存缓存：多标签页同时开着时，读到的一定是最新档案，
// 配合指纹比对，并发封存只生效一次。
export function readSnapshots(): SituationSnapshot[] {
  const store = storage()
  if (!store) {
    return []
  }
  const raw = store.getItem(SNAPSHOT_KEY)
  if (!raw) {
    return []
  }
  try {
    const parsed = JSON.parse(raw) as SituationSnapshot[]
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

export function writeSnapshots(snapshots: SituationSnapshot[]): void {
  const store = storage()
  if (store) {
    store.setItem(SNAPSHOT_KEY, JSON.stringify(snapshots))
  }
}
