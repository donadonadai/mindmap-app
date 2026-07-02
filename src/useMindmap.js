import { useCallback, useEffect, useRef, useState } from 'react'
import { loadStore, saveStore } from './storage'
import { supabase, cloudEnabled } from './supabase'

// store = { currentId, projects: [ { id, name, updatedAt, data } ] }
// data  = { nodes: { id -> {id,text,x,y,parentId,color,collapsed?} }, rootId }

let idSeq = 1
const genId = () => `n${Date.now().toString(36)}_${(idSeq++).toString(36)}`

const PALETTE = ['#2563eb', '#16a34a', '#db2777', '#ea580c', '#7c3aed', '#0891b2', '#ca8a04']

const HISTORY_LIMIT = 100
// 同じ操作タグ(連続ドラッグ・連続タイピング等)をひとつの取り消し単位にまとめる猶予
const COALESCE_MS = 1000

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

  // ---- 自動保存（デバウンス＋閉じる直前のフラッシュ） ----
  useEffect(() => {
    if (saveTimer.current) clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(() => saveStore(store), 300)
    return () => clearTimeout(saveTimer.current)
  }, [store])

  useEffect(() => {
    const flush = () => saveStore(storeRef.current)
    window.addEventListener('beforeunload', flush)
    return () => window.removeEventListener('beforeunload', flush)
  }, [])

  // ---- クラウド同期 (Supabase / 未設定なら全て無効) ----
  const [user, setUser] = useState(null)
  const userRef = useRef(null)
  userRef.current = user
  // idle=未ログイン, syncing=同期中, synced=同期済み, error=失敗
  const [syncState, setSyncState] = useState('idle')
  const lastPushedRef = useRef(new Map()) // id -> サーバへ送信済みの updatedAt(ms)
  const pushTimer = useRef(null)

  // ログイン状態の監視
  useEffect(() => {
    if (!supabase) return
    supabase.auth.getSession().then(({ data }) => setUser(data.session?.user ?? null))
    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null)
    })
    return () => sub.subscription.unsubscribe()
  }, [])

  const projectToRow = (p, userId) => ({
    user_id: userId,
    id: p.id,
    name: p.name,
    data: p.data,
    updated_at: new Date(p.updatedAt).toISOString(),
  })

  // 全体同期: サーバ⇄ローカルをマージ（新しい方が勝ち）して差分をアップロード
  const fullSync = useCallback(async () => {
    const u = userRef.current
    if (!supabase || !u) return
    setSyncState('syncing')
    try {
      const { data: rows, error } = await supabase.from('maps').select('id,name,data,updated_at')
      if (error) throw error

      const s = storeRef.current
      const byId = new Map(s.projects.map((p) => [p.id, p]))
      const serverMs = new Map()
      for (const r of rows) {
        const ms = new Date(r.updated_at).getTime()
        serverMs.set(r.id, ms)
        const local = byId.get(r.id)
        if (!local || ms > local.updatedAt) {
          byId.set(r.id, { id: r.id, name: r.name, updatedAt: ms, data: r.data })
        }
      }
      const projects = [...byId.values()]
      const currentId = byId.has(s.currentId) ? s.currentId : projects[0].id
      setStore({ currentId, projects })

      // ローカルにしかない/ローカルの方が新しいものを送る
      const toPush = projects.filter(
        (p) => !serverMs.has(p.id) || p.updatedAt > serverMs.get(p.id) + 500,
      )
      if (toPush.length) {
        const { error: e2 } = await supabase
          .from('maps')
          .upsert(toPush.map((p) => projectToRow(p, u.id)), { onConflict: 'user_id,id' })
        if (e2) throw e2
      }
      for (const p of projects) lastPushedRef.current.set(p.id, p.updatedAt)
      setSyncState('synced')
    } catch (err) {
      console.error('[sync] fullSync failed:', err)
      setSyncState('error')
    }
  }, [])

  // ログイン直後に全体同期・ログアウトで同期状態をリセット
  useEffect(() => {
    if (user) {
      fullSync()
    } else {
      lastPushedRef.current = new Map()
      setSyncState('idle')
    }
  }, [user, fullSync])

  // 変更を1.5秒デバウンスでアップロード（削除も反映）
  useEffect(() => {
    if (!supabase || !user) return
    clearTimeout(pushTimer.current)
    pushTimer.current = setTimeout(async () => {
      const s = storeRef.current
      const dirty = s.projects.filter((p) => (lastPushedRef.current.get(p.id) ?? 0) < p.updatedAt)
      const localIds = new Set(s.projects.map((p) => p.id))
      const removed = [...lastPushedRef.current.keys()].filter((id) => !localIds.has(id))
      if (!dirty.length && !removed.length) return
      setSyncState('syncing')
      try {
        if (dirty.length) {
          const { error } = await supabase
            .from('maps')
            .upsert(dirty.map((p) => projectToRow(p, user.id)), { onConflict: 'user_id,id' })
          if (error) throw error
          for (const p of dirty) lastPushedRef.current.set(p.id, p.updatedAt)
        }
        if (removed.length) {
          const { error } = await supabase.from('maps').delete().in('id', removed)
          if (error) throw error
          for (const id of removed) lastPushedRef.current.delete(id)
        }
        setSyncState('synced')
      } catch (err) {
        console.error('[sync] push failed:', err)
        setSyncState('error')
      }
    }, 1500)
    return () => clearTimeout(pushTimer.current)
  }, [store, user])

  // 認証操作（結果の error はそのまま返してUI側で表示）
  const signUp = useCallback(async (email, password) => {
    const { data, error } = await supabase.auth.signUp({ email, password })
    return { data, error }
  }, [])

  const signIn = useCallback(async (email, password) => {
    const { data, error } = await supabase.auth.signInWithPassword({ email, password })
    return { data, error }
  }, [])

  const signOut = useCallback(async () => {
    await supabase.auth.signOut()
  }, [])

  // ---- アンドゥ/リドゥ（現在のプロジェクトの data スナップショット） ----
  const historyRef = useRef({ past: [], future: [], lastTag: null, lastTime: 0 })
  const [, bumpHistory] = useState(0)

  const getCurrentData = () => {
    const s = storeRef.current
    return (s.projects.find((p) => p.id === s.currentId) || s.projects[0]).data
  }

  // 変更「前」に呼ぶ。tag が同じ操作の連続(ドラッグ・タイピング)はまとめる
  const pushHistory = useCallback((tag = null) => {
    const h = historyRef.current
    const now = Date.now()
    if (tag && tag === h.lastTag && now - h.lastTime < COALESCE_MS) {
      h.lastTime = now
      return
    }
    h.past.push(getCurrentData())
    if (h.past.length > HISTORY_LIMIT) h.past.shift()
    h.future = []
    h.lastTag = tag
    h.lastTime = now
    bumpHistory((t) => t + 1)
  }, [])

  // プロジェクトが切り替わったら履歴はリセット
  useEffect(() => {
    historyRef.current = { past: [], future: [], lastTag: null, lastTime: 0 }
    bumpHistory((t) => t + 1)
  }, [store.currentId])

  // 現在プロジェクトの data を更新するヘルパー
  const updateData = useCallback((updater) => {
    setStore((s) => ({
      ...s,
      projects: s.projects.map((p) =>
        p.id === s.currentId ? { ...p, updatedAt: Date.now(), data: updater(p.data) } : p,
      ),
    }))
  }, [])

  // 選択ノードが存在しない data になったらルートへ退避
  const fixSelection = useCallback((data) => {
    setSelectedId((sel) => (sel && data.nodes[sel] ? sel : data.rootId))
  }, [])

  const undo = useCallback(() => {
    const h = historyRef.current
    if (!h.past.length) return
    const cur = getCurrentData()
    const prev = h.past.pop()
    h.future.push(cur)
    h.lastTag = null
    updateData(() => prev)
    fixSelection(prev)
    bumpHistory((t) => t + 1)
  }, [updateData, fixSelection])

  const redo = useCallback(() => {
    const h = historyRef.current
    if (!h.future.length) return
    const cur = getCurrentData()
    const next = h.future.pop()
    h.past.push(cur)
    h.lastTag = null
    updateData(() => next)
    fixSelection(next)
    bumpHistory((t) => t + 1)
  }, [updateData, fixSelection])

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
        const p = createProject('最初のマップ')
        return { currentId: p.id, projects: [p] }
      }
      const currentId = s.currentId === id ? remaining[0].id : s.currentId
      return { currentId, projects: remaining }
    })
    setTimeout(() => {
      const s = storeRef.current
      const cur = s.projects.find((p) => p.id === s.currentId)
      if (cur) setSelectedId(cur.data.rootId)
    }, 0)
  }, [])

  // 取り込んだマップ群([{name,data}])を新規プロジェクトとして追加
  const addImportedProjects = useCallback((list) => {
    if (!list || !list.length) return 0
    const newProjects = list.map((p) => ({
      id: genId(),
      name: p.name || '読み込んだマップ',
      updatedAt: Date.now(),
      // 念のためディープコピー（外部由来データの共有参照を避ける）
      data: JSON.parse(JSON.stringify(p.data)),
    }))
    setStore((s) => ({ currentId: newProjects[0].id, projects: [...s.projects, ...newProjects] }))
    setSelectedId(newProjects[0].data.rootId)
    return newProjects.length
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
    pushHistory()
    let newId = null
    updateData((data) => {
      const id = genId()
      newId = id
      const { x, y } = placeChild(data.nodes, parentId)
      const colorIdx = Object.keys(data.nodes).length % PALETTE.length
      const parent = data.nodes[parentId]
      const nodes = {
        ...data.nodes,
        [id]: { id, text: '新しいノード', x, y, parentId, color: PALETTE[colorIdx] },
      }
      // 折りたたまれた親に追加したら自動で展開（見えない場所に増えるのを防ぐ）
      if (parent?.collapsed) nodes[parentId] = { ...parent, collapsed: false }
      return { ...data, nodes }
    })
    if (newId) setSelectedId(newId)
    return newId
  }, [updateData, pushHistory])

  const addSibling = useCallback((nodeId) => {
    const node = getCurrentData().nodes[nodeId]
    if (!node || node.parentId === null) return null
    return addChild(node.parentId)
  }, [addChild])

  const updateText = useCallback((id, text) => {
    pushHistory(`text:${id}`)
    updateData((data) => ({ ...data, nodes: { ...data.nodes, [id]: { ...data.nodes[id], text } } }))
  }, [updateData, pushHistory])

  const moveNode = useCallback((id, x, y) => {
    pushHistory(`move:${id}`)
    updateData((data) => ({ ...data, nodes: { ...data.nodes, [id]: { ...data.nodes[id], x, y } } }))
  }, [updateData, pushHistory])

  const setColor = useCallback((id, color) => {
    pushHistory(`color:${id}`)
    updateData((data) => ({ ...data, nodes: { ...data.nodes, [id]: { ...data.nodes[id], color } } }))
  }, [updateData, pushHistory])

  const toggleCollapse = useCallback((id) => {
    pushHistory()
    updateData((data) => {
      const n = data.nodes[id]
      if (!n) return data
      return { ...data, nodes: { ...data.nodes, [id]: { ...n, collapsed: !n.collapsed } } }
    })
  }, [updateData, pushHistory])

  const deleteNode = useCallback((id) => {
    pushHistory()
    let rootId = null
    updateData((data) => {
      rootId = data.rootId
      if (id === data.rootId) return data // ルートは削除不可
      // 子インデックスを作って一巡で子孫を収集（O(n)）
      const childrenOf = {}
      for (const n of Object.values(data.nodes)) {
        if (n.parentId != null) (childrenOf[n.parentId] ??= []).push(n.id)
      }
      const toDelete = new Set()
      const stack = [id]
      while (stack.length) {
        const cur = stack.pop()
        toDelete.add(cur)
        for (const c of childrenOf[cur] || []) stack.push(c)
      }
      const nodes = {}
      for (const n of Object.values(data.nodes)) if (!toDelete.has(n.id)) nodes[n.id] = n
      return { ...data, nodes }
    })
    if (rootId) setSelectedId(rootId)
  }, [updateData, pushHistory])

  return {
    store,
    current,
    state: current.data, // { nodes, rootId }
    selectedId,
    setSelectedId,
    // 履歴
    undo,
    redo,
    canUndo: historyRef.current.past.length > 0,
    canRedo: historyRef.current.future.length > 0,
    // クラウド同期
    cloud: { enabled: cloudEnabled, user, syncState, signUp, signIn, signOut, fullSync },
    // プロジェクト操作
    newProject,
    selectProject,
    renameProject,
    deleteProject,
    duplicateProject,
    addImportedProjects,
    // ノード操作
    addChild,
    addSibling,
    updateText,
    moveNode,
    setColor,
    toggleCollapse,
    deleteNode,
    PALETTE,
  }
}
