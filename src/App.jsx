import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useMindmap } from './useMindmap'
import './App.css'

const NODE_MIN_W = 80

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

  // --- ノードサイズ測定（接続線を中心に引くため） ---
  useLayoutEffect(() => {
    const sizes = {}
    let changed = false
    for (const id of Object.keys(state.nodes)) {
      const el = document.getElementById(`node-${id}`)
      if (el) {
        const w = el.offsetWidth
        const h = el.offsetHeight
        sizes[id] = { w, h }
        const prev = sizesRef.current[id]
        if (!prev || prev.w !== w || prev.h !== h) changed = true
      }
    }
    sizesRef.current = sizes
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
      moved: false,
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
      if (Math.abs(dx) > 2 || Math.abs(dy) > 2) d.moved = true
      mm.moveNode(d.id, d.ox + dx, d.oy + dy)
    }
  }

  const onPointerUp = () => {
    drag.current = null
  }

  // --- キーボードショートカット ---
  useEffect(() => {
    const onKey = (e) => {
      if (editingId) return // 編集中は無効
      if (!selectedId) return
      if (e.key === 'Tab') {
        e.preventDefault()
        const id = mm.addChild(selectedId)
        if (id) setEditingId(id)
      } else if (e.key === 'Enter') {
        e.preventDefault()
        const id = mm.addSibling(selectedId)
        if (id) setEditingId(id)
      } else if (e.key === 'F2') {
        e.preventDefault()
        setEditingId(selectedId)
      } else if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault()
        mm.deleteNode(selectedId)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [editingId, selectedId, mm])

  // --- 全ノードが収まるように表示（オートフィット） ---
  const recenter = useCallback(() => {
    const rect = canvasRef.current.getBoundingClientRect()
    const nodes = Object.values(state.nodes)
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
    for (const n of nodes) {
      const s = sizesRef.current[n.id] || { w: 140, h: 48 }
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
  }, [state.nodes])

  // プロジェクト切替時・初回にオートフィット
  const lastCenteredId = useRef(null)
  useEffect(() => {
    if (canvasRef.current && lastCenteredId.current !== current.id) {
      lastCenteredId.current = current.id
      // サイズ測定後に実行
      requestAnimationFrame(() => recenter())
    }
  }, [current.id, recenter])

  // --- 接続線（親→子）のパス生成 ---
  const edges = []
  for (const node of Object.values(state.nodes)) {
    if (node.parentId == null) continue
    const parent = state.nodes[node.parentId]
    if (!parent) continue
    const ps = sizesRef.current[parent.id] || { w: 120, h: 40 }
    const cs = sizesRef.current[node.id] || { w: 120, h: 40 }
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
        onRecenter={recenter}
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
            {Object.values(state.nodes).map((node) => (
              <NodeView
                key={node.id}
                node={node}
                isRoot={node.id === state.rootId}
                selected={node.id === selectedId}
                editing={node.id === editingId}
                onPointerDown={onPointerDownNode}
                onStartEdit={() => setEditingId(node.id)}
                onText={(t) => mm.updateText(node.id, t)}
                onEndEdit={() => setEditingId(null)}
              />
            ))}
          </div>
          <div className="hint">
            ダブルクリックで編集 ・ ドラッグで移動 ・ ホイールでズーム ・ 背景ドラッグで移動
            <br />
            Tab: 子を追加 ・ Enter: 兄弟を追加 ・ F2: 編集 ・ Delete: 削除
          </div>
        </div>
      </div>
    </div>
  )
}

function NodeView({ node, isRoot, selected, editing, onPointerDown, onStartEdit, onText, onEndEdit }) {
  const inputRef = useRef(null)

  useEffect(() => {
    if (editing && inputRef.current) {
      inputRef.current.focus()
      inputRef.current.select()
    }
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
            if (e.key === 'Enter' || e.key === 'Escape') {
              e.preventDefault()
              onEndEdit()
            }
            e.stopPropagation()
          }}
          onPointerDown={(e) => e.stopPropagation()}
        />
      ) : (
        <span className="node-text">{node.text || ' '}</span>
      )}
    </div>
  )
}

function Toolbar({ mm, selected, onRecenter, setEditingId, sidebarOpen, onToggleSidebar }) {
  const canEdit = !!selected
  return (
    <div className="toolbar">
      <button className="icon-btn" title="マップ一覧" onClick={onToggleSidebar}>
        {sidebarOpen ? '◀' : '☰'}
      </button>
      <span className="brand">🧠 MindMap</span>
      <span className="cur-name" title="現在のマップ">{mm.current.name}</span>

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
    </div>
  )
}

function Sidebar({ mm }) {
  const { store, current } = mm
  const [renamingId, setRenamingId] = useState(null)
  const projects = [...store.projects].sort((a, b) => b.updatedAt - a.updatedAt)

  return (
    <div className="sidebar">
      <div className="sidebar-head">
        <span>マイマップ</span>
        <button className="new-btn" onClick={() => mm.newProject()}>＋ 新規</button>
      </div>
      <div className="project-list">
        {projects.map((p) => (
          <div
            key={p.id}
            className={`project-item${p.id === current.id ? ' active' : ''}`}
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
                  if (e.key === 'Enter') e.target.blur()
                  if (e.key === 'Escape') setRenamingId(null)
                }}
              />
            ) : (
              <>
                <span className="project-name">{p.name}</span>
                <span className="project-actions">
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
