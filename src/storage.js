// localStorage への保存・読み込み（複数プロジェクト対応）

const STORE_KEY = 'mindmap:store:v1'
const OLD_KEY = 'mindmap:v1' // 旧・単一マップ形式（あればプロジェクトとして取り込む）

export function loadStore() {
  try {
    const raw = localStorage.getItem(STORE_KEY)
    if (raw) {
      const data = JSON.parse(raw)
      if (data && Array.isArray(data.projects) && data.projects.length) return data
    }
    // 旧形式があれば移行
    const old = localStorage.getItem(OLD_KEY)
    if (old) {
      const od = JSON.parse(old)
      if (od && od.nodes && od.rootId) {
        return {
          currentId: 'migrated',
          projects: [
            { id: 'migrated', name: '最初のマップ', updatedAt: Date.now(), data: od },
          ],
        }
      }
    }
  } catch {
    // 壊れていたら無視して新規
  }
  return null
}

export function saveStore(store) {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(store))
  } catch {
    // 容量超過などは無視
  }
}
