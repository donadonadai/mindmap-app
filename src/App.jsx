import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useMindmap } from './useMindmap'
import { downloadJSON, safeFileName } from './storage'
import { importAnyFile, importBinaryFile, isBinaryImport } from './importers'
import './App.css'

const NODE_MIN_W = 80
const DEFAULT_SIZE = { w: 140, h: 48 }

// IME変換確定のEnter（や変換中のキー）を無視するための判定
const isComposingEvent = (e) =>
  e.nativeEvent?.isComposing || e.isComposing || e.keyCode === 229

export default function App() {
  const mm = useMindmap()
  const { state, current, selectedId, setSelectedId } = mm

  // キャンバスの変換 (パン・ズーム)
  const [view, setView] = useState({ x: 0, y: 0, scale: 1 })
  const viewRef = useRef(view)
  viewRef.current = view

  const canvasRef = useRef(null)
  const sizesRef = useRef({})              // id -> {w, h}
  const [, forceTick] = useState(0)        // サイズ確定後の再描画用
  const [editingId, setEditingId] = useState(null)
  const [sidebarOpen, setSidebarOpen] = useState(true)

  // ドラッグ状態 (ノード移動 or 背景パン)
  const drag = useRef(null)

  // ---- 子ノード索引・表示中ノード集合（折りたたみ反映）----
  const { childrenMap, visibleIds, descCount } = useMemo(() => {
    const cm = new Map()
    for (const n of Object.values(state.nodes)) {
      if (n.parentId != null && state.nodes[n.parentId]) {
        if (!cm.has(n.parentId)) cm.set(n.parentId, [])
        cm.get(n.parentId).push(n)
      }
    }
    for (const arr of cm.values()) arr.sort((a, b) => a.y - b.y)

    const visible = new Set()
    const walk = (id) => {
      visible.add(id)
      if (state.nodes[id]?.collapsed) return
      for (const c of cm.get(id) || []) walk(c.id)
    }
    if (state.nodes[state.rootId]) walk(state.rootId)

    // 折りたたみバッジ用: 子孫の総数
    const memo = new Map()
    const descCount = (id) => {
      if (memo.has(id)) return memo.get(id)
      let c = 0
      for (const k of cm.get(id) || []) c += 1 + descCount(k.id)
      memo.set(id, c)
      return c
    }
    return { childrenMap: cm, visibleIds: visible, descCount }
  }, [state.nodes, state.rootId])

  // --- ノードサイズ測定（接続線を中心に引くため） ---
  useLayoutEffect(() => {
    let changed = false
    for (const id of visibleIds) {
      const el = document.getElementById(`node-${id}`)
      if (el) {
        const w = el.offsetWidth
        const h = el.offsetHeight
        const prev = sizesRef.current[id]
        if (!prev || prev.w !== w || prev.h !== h) changed = true
        sizesRef.current[id] = { w, h }
      }
    }
    if (changed) forceTick((t) => t + 1)
  })

  // --- ホイールでズーム（カーソル位置中心） ---
  const onWheel = useCallback((e) => {
    e.preventDefault()
    const v = viewRef.current
    const rect = canvasRef.current.getBoundingClientRect()
    const factor = e.deltaY < 0 ? 1.1 : 1 / 1.1
    const newScale = Math.min(2.5, Math.max(0.25, v.scale * factor))
    const mx = e.clientX - rect.left
    const my = e.clientY - rect.top
    const wx = (mx - v.x) / v.scale
    const wy = (my - v.y) / v.scale
    setView({ scale: newScale, x: mx - wx * newScale, y: my - wy * newScale })
  }, [])

  useEffect(() => {
    const el = canvasRef.current
    if (!el) return
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [onWheel])

  // --- ポインタ操作 ---
  const onPointerDownBackground = (e) => {
    if (editingId) return
    setSelectedId(null)
    const v = viewRef.current
    drag.current = { type: 'pan', startX: e.clientX, startY: e.clientY, ox: v.x, oy: v.y }
    e.currentTarget.setPointerCapture?.(e.pointerId)
  }

  const onPointerDownNode = (e, node) => {
    if (editingId === node.id) return
    e.stopPropagation()
    setSelectedId(node.id)
    drag.current = {
      type: 'node',
      id: node.id,
      startX: e.clientX,
      startY: e.clientY,
      ox: node.x,
      oy: node.y,
    }
    e.currentTarget.setPointerCapture?.(e.pointerId)
  }

  const onPointerMove = (e) => {
    const d = drag.current
    if (!d) return
    if (d.type === 'pan') {
      setView((v) => ({ ...v, x: d.ox + (e.clientX - d.startX), y: d.oy + (e.clientY - d.startY) }))
    } else if (d.type === 'node') {
      const v = viewRef.current
      const dx = (e.clientX - d.startX) / v.scale
      const dy = (e.clientY - d.startY) / v.scale
      mm.moveNode(d.id, d.ox + dx, d.oy + dy)
    }
  }

  const onPointerUp = () => {
    drag.current = null
  }

  // --- 矢印キーでノード間を移動 ---
  const navigate = useCallback((key) => {
    const cur = state.nodes[selectedId]
    if (!cur) return
    if (key === 'ArrowLeft') {
      if (cur.parentId) setSelectedId(cur.parentId)
    } else if (key === 'ArrowRight') {
      if (cur.collapsed) {
        mm.toggleCollapse(cur.id) // 折りたたみ中なら展開
        return
      }
      const kids = childrenMap.get(cur.id) || []
      if (kids.length) setSelectedId(kids[0].id)
    } else if (key === 'ArrowUp' || key === 'ArrowDown') {
      const siblings = cur.parentId ? childrenMap.get(cur.parentId) || [] : [cur]
      const i = siblings.findIndex((n) => n.id === cur.id)
      const next = siblings[key === 'ArrowUp' ? i - 1 : i + 1]
      if (next) setSelectedId(next.id)
    }
  }, [state.nodes, selectedId, childrenMap, setSelectedId, mm])

  // --- キーボードショートカット ---
  const { addChild, addSibling, deleteNode, undo, redo, toggleCollapse } = mm
  useEffect(() => {
    const onKey = (e) => {
      if (e.isComposing || e.keyCode === 229) return // IME変換中は無視
      if (editingId) return // テキスト編集中は無効（入力側で処理）

      // アンドゥ/リドゥは選択なしでも効く
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault()
        if (e.shiftKey) redo()
        else undo()
        return
      }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'y') {
        e.preventDefault()
        redo()
        return
      }

      if (!selectedId) return
      if (e.key === 'Tab') {
        e.preventDefault()
        const id = addChild(selectedId)
        if (id) setEditingId(id)
      } else if (e.key === 'Enter') {
        e.preventDefault()
        const id = addSibling(selectedId)
        if (id) setEditingId(id)
      } else if (e.key === 'F2') {
        e.preventDefault()
        setEditingId(selectedId)
      } else if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault()
        deleteNode(selectedId)
      } else if (e.key === ' ') {
        e.preventDefault()
        toggleCollapse(selectedId)
      } else if (e.key.startsWith('Arrow')) {
        e.preventDefault()
        navigate(e.key)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [editingId, selectedId, addChild, addSibling, deleteNode, undo, redo, toggleCollapse, navigate])

  // --- 全体表示（表示中ノードが収まるようにオートフィット） ---
  const recenter = useCallback(() => {
    const rect = canvasRef.current.getBoundingClientRect()
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
    for (const id of visibleIds) {
      const n = state.nodes[id]
      const s = sizesRef.current[id] || DEFAULT_SIZE
      minX = Math.min(minX, n.x)
      minY = Math.min(minY, n.y)
      maxX = Math.max(maxX, n.x + s.w)
      maxY = Math.max(maxY, n.y + s.h)
    }
    if (!isFinite(minX)) return
    const pad = 80
    const bw = maxX - minX + pad * 2
    const bh = maxY - minY + pad * 2
    const scale = Math.min(1, Math.min(rect.width / bw, rect.height / bh))
    const cx = (minX + maxX) / 2
    const cy = (minY + maxY) / 2
    setView({ scale, x: rect.width / 2 - cx * scale, y: rect.height / 2 - cy * scale })
  }, [state.nodes, visibleIds])

  // プロジェクト切替時・初回にオートフィット
  const lastCenteredId = useRef(null)
  useEffect(() => {
    if (canvasRef.current && lastCenteredId.current !== current.id) {
      lastCenteredId.current = current.id
      requestAnimationFrame(() => recenter())
    }
  }, [current.id, recenter])

  // --- PNG画像として書き出し ---
  const exportPNG = useCallback(() => {
    const ids = [...visibleIds]
    if (!ids.length) return
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
    for (const id of ids) {
      const n = state.nodes[id]
      const s = sizesRef.current[id] || DEFAULT_SIZE
      minX = Math.min(minX, n.x)
      minY = Math.min(minY, n.y)
      maxX = Math.max(maxX, n.x + s.w)
      maxY = Math.max(maxY, n.y + s.h)
    }
    const pad = 40
    const scale = 2 // 高解像度
    const w = maxX - minX + pad * 2
    const h = maxY - minY + pad * 2
    const canvas = document.createElement('canvas')
    canvas.width = Math.ceil(w * scale)
    canvas.height = Math.ceil(h * scale)
    const ctx = canvas.getContext('2d')
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, canvas.width, canvas.height)
    ctx.scale(scale, scale)
    ctx.translate(pad - minX, pad - minY)

    // 接続線
    for (const id of ids) {
      const n = state.nodes[id]
      if (n.parentId == null || !visibleIds.has(n.parentId)) continue
      const p = state.nodes[n.parentId]
      const ps = sizesRef.current[p.id] || DEFAULT_SIZE
      const cs = sizesRef.current[n.id] || DEFAULT_SIZE
      const x1 = p.x + ps.w / 2, y1 = p.y + ps.h / 2
      const x2 = n.x + cs.w / 2, y2 = n.y + cs.h / 2
      const mx = (x1 + x2) / 2
      ctx.beginPath()
      ctx.moveTo(x1, y1)
      ctx.bezierCurveTo(mx, y1, mx, y2, x2, y2)
      ctx.strokeStyle = n.color
      ctx.globalAlpha = 0.55
      ctx.lineWidth = 2.5
      ctx.stroke()
      ctx.globalAlpha = 1
    }
    // ノード
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    for (const id of ids) {
      const n = state.nodes[id]
      const s = sizesRef.current[id] || DEFAULT_SIZE
      const isRoot = id === state.rootId
      ctx.beginPath()
      ctx.roundRect(n.x, n.y, s.w, s.h, 12)
      ctx.fillStyle = isRoot ? n.color : '#ffffff'
      ctx.fill()
      ctx.strokeStyle = n.color
      ctx.lineWidth = 2
      ctx.stroke()
      ctx.fillStyle = isRoot ? '#ffffff' : '#1e293b'
      ctx.font = `${isRoot ? '700 16px' : '500 14px'} system-ui, -apple-system, 'Hiragino Sans', sans-serif`
      ctx.fillText(n.text, n.x + s.w / 2, n.y + s.h / 2 + 1)
    }

    canvas.toBlob((blob) => {
      if (!blob) return
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `mindmap-${safeFileName(current.name)}.png`
      document.body.appendChild(a)
      a.click()
      a.remove()
      URL.revokeObjectURL(url)
    }, 'image/png')
  }, [visibleIds, state.nodes, state.rootId, current.name])

  // --- 接続線（親→子・表示中のみ） ---
  const edges = []
  for (const id of visibleIds) {
    const node = state.nodes[id]
    if (node.parentId == null || !visibleIds.has(node.parentId)) continue
    const parent = state.nodes[node.parentId]
    const ps = sizesRef.current[parent.id] || DEFAULT_SIZE
    const cs = sizesRef.current[node.id] || DEFAULT_SIZE
    const x1 = parent.x + ps.w / 2
    const y1 = parent.y + ps.h / 2
    const x2 = node.x + cs.w / 2
    const y2 = node.y + cs.h / 2
    const mx = (x1 + x2) / 2
    edges.push({ id: node.id, d: `M ${x1} ${y1} C ${mx} ${y1}, ${mx} ${y2}, ${x2} ${y2}`, color: node.color })
  }

  const selected = selectedId ? state.nodes[selectedId] : null

  return (
    <div className="app">
      <Toolbar
        mm={mm}
        selected={selected}
        hasChildren={selected ? (childrenMap.get(selected.id) || []).length > 0 : false}
        onRecenter={recenter}
        onExportPNG={exportPNG}
        setEditingId={setEditingId}
        sidebarOpen={sidebarOpen}
        onToggleSidebar={() => setSidebarOpen((v) => !v)}
      />
      <div className="body">
        {sidebarOpen && <Sidebar mm={mm} />}
        <div
          className="canvas"
          ref={canvasRef}
          onPointerDown={onPointerDownBackground}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerLeave={onPointerUp}
        >
          <div
            className="world"
            style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.scale})` }}
          >
            <svg className="edges" style={{ overflow: 'visible' }}>
              {edges.map((edge) => (
                <path key={edge.id} d={edge.d} fill="none" stroke={edge.color} strokeWidth={2.5} strokeOpacity={0.55} />
              ))}
            </svg>
            {[...visibleIds].map((id) => {
              const node = state.nodes[id]
              return (
                <NodeView
                  key={node.id}
                  node={node}
                  isRoot={node.id === state.rootId}
                  selected={node.id === selectedId}
                  editing={node.id === editingId}
                  hiddenCount={node.collapsed ? descCount(node.id) : 0}
                  onPointerDown={onPointerDownNode}
                  onStartEdit={() => setEditingId(node.id)}
                  onToggleCollapse={() => mm.toggleCollapse(node.id)}
                  onText={(t) => mm.updateText(node.id, t)}
                  onEndEdit={() => setEditingId(null)}
                />
              )
            })}
          </div>
          <div className="hint">
            ダブルクリック: 編集 ・ ドラッグ: 移動 ・ ホイール: ズーム ・ 矢印キー: 選択移動
            <br />
            Tab: 子 ・ Enter: 兄弟 ・ Space: 折りたたみ ・ Delete: 削除 ・ ⌘Z: 元に戻す
          </div>
        </div>
      </div>
    </div>
  )
}

function NodeView({
  node, isRoot, selected, editing, hiddenCount,
  onPointerDown, onStartEdit, onToggleCollapse, onText, onEndEdit,
}) {
  const inputRef = useRef(null)
  const originalRef = useRef(node.text) // Escでの取り消し用

  useEffect(() => {
    if (editing && inputRef.current) {
      originalRef.current = node.text
      inputRef.current.focus()
      inputRef.current.select()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editing])

  return (
    <div
      id={`node-${node.id}`}
      className={`node${isRoot ? ' root' : ''}${selected ? ' selected' : ''}`}
      style={{
        left: node.x,
        top: node.y,
        minWidth: NODE_MIN_W,
        borderColor: node.color,
        background: isRoot ? node.color : '#ffffff',
        color: isRoot ? '#fff' : '#1e293b',
      }}
      onPointerDown={(e) => onPointerDown(e, node)}
      onDoubleClick={(e) => {
        e.stopPropagation()
        onStartEdit()
      }}
    >
      {editing ? (
        <input
          ref={inputRef}
          className="node-input"
          defaultValue={node.text}
          onChange={(e) => onText(e.target.value)}
          onBlur={onEndEdit}
          onKeyDown={(e) => {
            e.stopPropagation()
            // IME変換確定のEnterでは決定しない
            if (isComposingEvent(e)) return
            if (e.key === 'Enter') {
              e.preventDefault()
              onEndEdit()
            } else if (e.key === 'Escape') {
              e.preventDefault()
              onText(originalRef.current) // 編集前に戻す
              onEndEdit()
            }
          }}
          onPointerDown={(e) => e.stopPropagation()}
        />
      ) : (
        <span className="node-text">{node.text || ' '}</span>
      )}
      {hiddenCount > 0 && (
        <button
          className="node-badge"
          title={`${hiddenCount}個のノードを表示`}
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation()
            onToggleCollapse()
          }}
        >
          +{hiddenCount}
        </button>
      )}
    </div>
  )
}

function Toolbar({ mm, selected, hasChildren, onRecenter, onExportPNG, setEditingId, sidebarOpen, onToggleSidebar }) {
  const canEdit = !!selected
  return (
    <div className="toolbar">
      <button className="icon-btn" title="マップ一覧" onClick={onToggleSidebar}>
        {sidebarOpen ? '◀' : '☰'}
      </button>
      <span className="brand">🧠 MindMap</span>
      <span className="cur-name" title="現在のマップ">{mm.current.name}</span>

      <span className="sep" />

      <button title="元に戻す (⌘Z)" disabled={!mm.canUndo} onClick={mm.undo}>↩︎</button>
      <button title="やり直す (⌘⇧Z)" disabled={!mm.canRedo} onClick={mm.redo}>↪︎</button>

      <span className="sep" />

      <button
        disabled={!canEdit}
        onClick={() => {
          const id = mm.addChild(selected.id)
          if (id) setEditingId(id)
        }}
      >
        ＋ 子ノード
      </button>
      <button
        disabled={!canEdit || selected.parentId == null}
        onClick={() => {
          const id = mm.addSibling(selected.id)
          if (id) setEditingId(id)
        }}
      >
        ＋ 兄弟ノード
      </button>
      <button disabled={!canEdit} onClick={() => setEditingId(selected.id)}>
        ✎ 編集
      </button>
      <button
        title="子ノードを折りたたみ/展開 (Space)"
        disabled={!canEdit || !hasChildren}
        onClick={() => mm.toggleCollapse(selected.id)}
      >
        {selected?.collapsed ? '⊞ 展開' : '⊟ たたむ'}
      </button>
      <button
        disabled={!canEdit || selected.id === mm.state.rootId}
        onClick={() => mm.deleteNode(selected.id)}
      >
        🗑 削除
      </button>

      <span className="sep" />

      <div className="colors">
        {mm.PALETTE.map((c) => (
          <button
            key={c}
            className="swatch"
            title="色を変更"
            disabled={!canEdit}
            style={{ background: c }}
            onClick={() => mm.setColor(selected.id, c)}
          />
        ))}
      </div>

      <span className="sep" />

      <button onClick={onRecenter}>⌖ 全体表示</button>
      <button title="PNG画像として保存" onClick={onExportPNG}>🖼 PNG</button>
    </div>
  )
}

function Sidebar({ mm }) {
  const { store, current } = mm
  const [renamingId, setRenamingId] = useState(null)
  const fileRef = useRef(null)
  const projects = [...store.projects].sort((a, b) => b.updatedAt - a.updatedAt)

  const dateStamp = () => {
    const d = new Date()
    const p = (n) => String(n).padStart(2, '0')
    return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}`
  }

  const exportAll = () => {
    downloadJSON(`mindmap-backup-${dateStamp()}.json`, {
      type: 'mindmap-backup',
      version: 1,
      exportedAt: new Date().toISOString(),
      projects: store.projects.map((p) => ({ name: p.name, data: p.data })),
    })
  }

  const exportOne = (p) => {
    downloadJSON(`mindmap-${safeFileName(p.name)}.json`, {
      type: 'mindmap-project',
      version: 1,
      name: p.name,
      exportedAt: new Date().toISOString(),
      data: p.data,
    })
  }

  const onImportFile = (e) => {
    const file = e.target.files?.[0]
    e.target.value = '' // 同じファイルを連続で選べるようにリセット
    if (!file) return
    const binary = isBinaryImport(file.name)
    const reader = new FileReader()
    reader.onload = () => {
      try {
        const list = binary
          ? importBinaryFile(file.name, reader.result)
          : importAnyFile(file.name, String(reader.result))
        const n = mm.addImportedProjects(list)
        alert(`${n} 件のマップを読み込みました。`)
      } catch (err) {
        alert(`読み込みに失敗しました：${err.message}`)
      }
    }
    if (binary) reader.readAsArrayBuffer(file)
    else reader.readAsText(file)
  }

  return (
    <div className="sidebar">
      <div className="sidebar-head">
        <span>マイマップ</span>
        <button className="new-btn" onClick={() => mm.newProject()}>＋ 新規</button>
      </div>
      <CloudPanel cloud={mm.cloud} />
      <div className="backup-bar">
        <button title="全マップをバックアップ書き出し" onClick={exportAll}>⬇ バックアップ</button>
        <button
          title="ファイルから読み込み（JSON / MindMeister(.mind) / OPML / FreeMind(.mm) / Markdown）"
          onClick={() => fileRef.current?.click()}
        >
          ⬆ 読み込み
        </button>
        <input
          ref={fileRef}
          type="file"
          accept=".json,.mind,.opml,.mm,.md,.markdown,.txt,.xml,application/json,text/*"
          style={{ display: 'none' }}
          onChange={onImportFile}
        />
      </div>
      <div className="project-list">
        {projects.map((p) => (
          <div
            key={p.id}
            className={`project-item${p.id === current.id ? ' active' : ''}`}
            title={`更新: ${new Date(p.updatedAt).toLocaleString('ja-JP')}`}
            onClick={() => mm.selectProject(p.id)}
            onDoubleClick={() => setRenamingId(p.id)}
          >
            {renamingId === p.id ? (
              <input
                className="rename-input"
                autoFocus
                defaultValue={p.name}
                onClick={(e) => e.stopPropagation()}
                onBlur={(e) => {
                  mm.renameProject(p.id, e.target.value.trim() || '無題のマップ')
                  setRenamingId(null)
                }}
                onKeyDown={(e) => {
                  if (isComposingEvent(e)) return // IME変換確定のEnterは無視
                  if (e.key === 'Enter') e.target.blur()
                  if (e.key === 'Escape') setRenamingId(null)
                }}
              />
            ) : (
              <>
                <span className="project-name">{p.name}</span>
                <span className="project-actions">
                  <button
                    title="このマップを書き出し"
                    onClick={(e) => {
                      e.stopPropagation()
                      exportOne(p)
                    }}
                  >
                    ⬇
                  </button>
                  <button
                    title="複製"
                    onClick={(e) => {
                      e.stopPropagation()
                      mm.duplicateProject(p.id)
                    }}
                  >
                    ⧉
                  </button>
                  <button
                    title="名前を変更"
                    onClick={(e) => {
                      e.stopPropagation()
                      setRenamingId(p.id)
                    }}
                  >
                    ✎
                  </button>
                  <button
                    title="削除"
                    onClick={(e) => {
                      e.stopPropagation()
                      if (confirm(`「${p.name}」を削除しますか？`)) mm.deleteProject(p.id)
                    }}
                  >
                    ×
                  </button>
                </span>
              </>
            )}
          </div>
        ))}
      </div>
      <div className="sidebar-foot">{projects.length} マップ ・ 自動保存</div>
    </div>
  )
}

// ---- クラウド同期パネル（Supabase 未設定なら非表示） ----

const SYNC_LABEL = {
  idle: '未ログイン',
  syncing: '同期中…',
  synced: '同期済み',
  error: '同期エラー',
}

function CloudPanel({ cloud }) {
  const [modalOpen, setModalOpen] = useState(false)
  if (!cloud.enabled) return null

  if (!cloud.user) {
    return (
      <div className="cloud-bar">
        <button className="cloud-login-btn" onClick={() => setModalOpen(true)}>
          ☁ ログイン / 新規登録
        </button>
        <div className="cloud-note">ログインすると全PCでマップを同期</div>
        {modalOpen && <AuthModal cloud={cloud} onClose={() => setModalOpen(false)} />}
      </div>
    )
  }

  return (
    <div className="cloud-bar">
      <div className="cloud-user">
        <span className={`sync-dot ${cloud.syncState}`} title={SYNC_LABEL[cloud.syncState]} />
        <span className="cloud-email" title={cloud.user.email}>{cloud.user.email}</span>
      </div>
      <div className="cloud-actions">
        <span className="sync-label">{SYNC_LABEL[cloud.syncState]}</span>
        <button title="今すぐ同期" onClick={() => cloud.fullSync()}>↻</button>
        <button
          title="ログアウト"
          onClick={() => {
            if (confirm('ログアウトしますか？\n（このPCのローカルデータはそのまま残ります）')) cloud.signOut()
          }}
        >
          ログアウト
        </button>
      </div>
    </div>
  )
}

function AuthModal({ cloud, onClose }) {
  const [mode, setMode] = useState('login') // login | signup
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState(null) // {type:'error'|'info', text}

  const jpError = (error) => {
    const m = error?.message || ''
    if (/Invalid login credentials/i.test(m)) return 'メールアドレスかパスワードが違います'
    if (/already registered/i.test(m)) return 'このメールアドレスは登録済みです。ログインしてください'
    if (/at least 6 characters/i.test(m)) return 'パスワードは6文字以上にしてください'
    if (/valid email/i.test(m)) return 'メールアドレスの形式が正しくありません'
    if (/rate limit/i.test(m)) return '試行回数が多すぎます。しばらく待ってから再度お試しください'
    if (/not confirmed/i.test(m)) return 'メール確認が完了していません。届いたメールのリンクを開いてください'
    return `エラー: ${m}`
  }

  const submit = async (e) => {
    e.preventDefault()
    if (busy) return
    setMessage(null)
    setBusy(true)
    try {
      if (mode === 'signup') {
        const { data, error } = await cloud.signUp(email.trim(), password)
        if (error) setMessage({ type: 'error', text: jpError(error) })
        else if (data.session) onClose() // 即ログイン（メール確認オフ設定時）
        else setMessage({ type: 'info', text: '確認メールを送信しました。メール内のリンクを開くと登録完了です。' })
      } else {
        const { error } = await cloud.signIn(email.trim(), password)
        if (error) setMessage({ type: 'error', text: jpError(error) })
        else onClose()
      }
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="modal-overlay" onPointerDown={(e) => e.stopPropagation()} onClick={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <form className="auth-modal" onSubmit={submit}>
        <div className="auth-tabs">
          <button type="button" className={mode === 'login' ? 'on' : ''} onClick={() => { setMode('login'); setMessage(null) }}>ログイン</button>
          <button type="button" className={mode === 'signup' ? 'on' : ''} onClick={() => { setMode('signup'); setMessage(null) }}>新規登録</button>
        </div>
        <label>
          メールアドレス
          <input
            type="email"
            required
            autoFocus
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
          />
        </label>
        <label>
          パスワード（6文字以上）
          <input
            type="password"
            required
            minLength={6}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="••••••"
          />
        </label>
        {message && <div className={`auth-msg ${message.type}`}>{message.text}</div>}
        <div className="auth-buttons">
          <button type="button" onClick={onClose}>キャンセル</button>
          <button type="submit" className="primary" disabled={busy}>
            {busy ? '処理中…' : mode === 'login' ? 'ログイン' : '登録する'}
          </button>
        </div>
        <div className="auth-note">
          ログインすると、マップがクラウドに保存され<br />どのPC・スマホからでも同じデータを使えます。
        </div>
      </form>
    </div>
  )
}
