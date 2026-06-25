import { useCallback, useEffect, useRef, useState } from 'react'
import { loadStore, saveStore } from './storage'

// store = { currentId, projects: [ { id, name, updatedAt, data } ] }
// data  = { nodes: { id -> {id,text,x,y,parentId,color} }, rootId }

let idSeq = 1
const genId = () => `n${Date.now().toString(36)}_${(idSeq++).toString(36)}`

const PALETTE = ['#2563eb', '#16a34a', '#db2777', '#ea580c', '#7c3aed', '#0891b2', '#ca8a04']

function createProjectData() {
  const rootId = genId()
  return {
    nodes: {
      [rootId]: { id: rootId, text: 'メインテーマ', x: 0, y: 0, parentId: null, color: '#1e293b' },
    },
    rootId,
  }
}

function createProject(name) {
  return {
    id: genId(),
    name: name || '無題のマップ',
    updatedAt: Date.now(),
    data: createProjectData(),
  }
}

function createInitialStore() {
  const p = createProject('最初のマップ')
  return { currentId: p.id, projects: [p] }
}

// 子ノードの初期配置: 同じ親の既存の子の下に並べる
function placeChild(nodes, parentId) {
  const parent = nodes[parentId]
  const siblings = Object.values(nodes).filter((n) => n.parentId === parentId)
  return { x: parent.x + 220, y: parent.y + siblings.length * 70 }
}

export function useMindmap() {
  const [store, setStore] = useState(() => loadStore() || createInitialStore())
  const storeRef = useRef(store)
  storeRef.current = store

  const current = store.projects.find((p) => p.id === store.currentId) || store.projects[0]
  const [selectedId, setSelectedId] = useState(current.data.rootId)
  const saveTimer = useRef(null)

  // 自動保存（デバウンス）
  useEffect(() => {
    if (saveTimer.current) clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(() => saveStore(store), 300)
    return () => clearTimeout(saveTimer.current)
  }, [store])

  // 現在プロジェクトの data を更新するヘルパー
  const updateData = useCallback((updater) => {
    setStore((s) => ({
      ...s,
      projects: s.projects.map((p) =>
        p.id === s.currentId ? { ...p, updatedAt: Date.now(), data: updater(p.data) } : p,
      ),
    }))
  }, [])

  // ---- プロジェクト操作 ----
  const newProject = useCallback(() => {
    const p = createProject('無題のマップ')
    setStore((s) => ({ currentId: p.id, projects: [...s.projects, p] }))
    setSelectedId(p.data.rootId)
    return p.id
  }, [])

  const selectProject = useCallback((id) => {
    const s = storeRef.current
    const p = s.projects.find((x) => x.id === id)
    if (!p) return
    setStore((prev) => ({ ...prev, currentId: id }))
    setSelectedId(p.data.rootId)
  }, [])

  const renameProject = useCallback((id, name) => {
    setStore((s) => ({
      ...s,
      projects: s.projects.map((p) => (p.id === id ? { ...p, name } : p)),
    }))
  }, [])

  const deleteProject = useCallback((id) => {
    setStore((s) => {
      const remaining = s.projects.filter((p) => p.id !== id)
      if (remaining.length === 0) {
        // 最後の1つを消したら新規を作る
        const p = createProject('最初のマップ')
        return { currentId: p.id, projects: [p] }
      }
      const currentId = s.currentId === id ? remaining[0].id : s.currentId
      return { currentId, projects: remaining }
    })
    // 選択ノードは切替後のプロジェクトのルートへ
    setTimeout(() => {
      const s = storeRef.current
      const cur = s.projects.find((p) => p.id === s.currentId)
      if (cur) setSelectedId(cur.data.rootId)
    }, 0)
  }, [])

  const duplicateProject = useCallback((id) => {
    const s = storeRef.current
    const src = s.projects.find((p) => p.id === id)
    if (!src) return
    const copy = {
      id: genId(),
      name: `${src.name} のコピー`,
      updatedAt: Date.now(),
      data: JSON.parse(JSON.stringify(src.data)),
    }
    setStore((prev) => ({ currentId: copy.id, projects: [...prev.projects, copy] }))
    setSelectedId(copy.data.rootId)
  }, [])

  // ---- ノード操作（現在プロジェクト） ----
  const addChild = useCallback((parentId) => {
    let newId = null
    updateData((data) => {
      const id = genId()
      newId = id
      const { x, y } = placeChild(data.nodes, parentId)
      const colorIdx = Object.keys(data.nodes).length % PALETTE.length
      return {
        ...data,
        nodes: {
          ...data.nodes,
          [id]: { id, text: '新しいノード', x, y, parentId, color: PALETTE[colorIdx] },
        },
      }
    })
    if (newId) setSelectedId(newId)
    return newId
  }, [updateData])

  const addSibling = useCallback((nodeId) => {
    const data = (storeRef.current.projects.find((p) => p.id === storeRef.current.currentId) || {}).data
    const node = data?.nodes[nodeId]
    if (!node || node.parentId === null) return null
    return addChild(node.parentId)
  }, [addChild])

  const updateText = useCallback((id, text) => {
    updateData((data) => ({ ...data, nodes: { ...data.nodes, [id]: { ...data.nodes[id], text } } }))
  }, [updateData])

  const moveNode = useCallback((id, x, y) => {
    updateData((data) => ({ ...data, nodes: { ...data.nodes, [id]: { ...data.nodes[id], x, y } } }))
  }, [updateData])

  const setColor = useCallback((id, color) => {
    updateData((data) => ({ ...data, nodes: { ...data.nodes, [id]: { ...data.nodes[id], color } } }))
  }, [updateData])

  const deleteNode = useCallback((id) => {
    let rootId = null
    updateData((data) => {
      rootId = data.rootId
      if (id === data.rootId) return data // ルートは削除不可
      const toDelete = new Set([id])
      let changed = true
      while (changed) {
        changed = false
        for (const n of Object.values(data.nodes)) {
          if (n.parentId && toDelete.has(n.parentId) && !toDelete.has(n.id)) {
            toDelete.add(n.id)
            changed = true
          }
        }
      }
      const nodes = {}
      for (const n of Object.values(data.nodes)) if (!toDelete.has(n.id)) nodes[n.id] = n
      return { ...data, nodes }
    })
    if (rootId) setSelectedId(rootId)
  }, [updateData])

  return {
    store,
    current,
    state: current.data, // 後方互換: { nodes, rootId }
    selectedId,
    setSelectedId,
    // プロジェクト操作
    newProject,
    selectProject,
    renameProject,
    deleteProject,
    duplicateProject,
    // ノード操作
    addChild,
    addSibling,
    updateText,
    moveNode,
    setColor,
    deleteNode,
    PALETTE,
  }
}
