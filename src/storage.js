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

// ---- エクスポート / インポート ----

// JSON テキストをファイルとしてダウンロードさせる
export function downloadJSON(filename, obj) {
  const blob = new Blob([JSON.stringify(obj, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}

// ファイル名に使えない文字を置換
export function safeFileName(name) {
  return (name || 'map').replace(/[\\/:*?"<>|]/g, '_').slice(0, 60)
}

// 取り込んだ JSON を [{ name, data:{nodes,rootId} }] の配列に正規化
// 対応形式: 全体バックアップ / 単一マップ(ラップ) / 生の data
export function parseImport(text) {
  const obj = JSON.parse(text)
  const valid = (d) => d && d.nodes && d.rootId && d.nodes[d.rootId]

  if (obj && Array.isArray(obj.projects)) {
    const list = obj.projects
      .filter((p) => p && valid(p.data))
      .map((p) => ({ name: p.name || '無題のマップ', data: p.data }))
    if (list.length) return list
  }
  if (obj && valid(obj.data)) {
    return [{ name: obj.name || '読み込んだマップ', data: obj.data }]
  }
  if (valid(obj)) {
    return [{ name: '読み込んだマップ', data: obj }]
  }
  throw new Error('対応していない形式のファイルです')
}
