import type { SituationSnapshot } from './types'

// 快照独立存一个键，并且每次直读 localStorage 不走内存缓存：
// 另一个标签页刚封存的快照要立刻可见，并发封存才能只生效一次。
const SNAPSHOT_KEY = 'hydrology-monitor-station:snapshots'

export function readSnapshots(): SituationSnapshot[] {
  if (typeof window === 'undefined' || !window.localStorage) {
    return []
  }
  const raw = window.localStorage.getItem(SNAPSHOT_KEY)
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
  if (typeof window !== 'undefined' && window.localStorage) {
    window.localStorage.setItem(SNAPSHOT_KEY, JSON.stringify(snapshots))
  }
}

export function snapshotStorageKey(): string {
  return SNAPSHOT_KEY
}
