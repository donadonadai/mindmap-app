import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useMindmap } from './useMindmap'
import { downloadJSON, safeFileName } from './storage'
import { importAnyFile, importBinaryFile, isBinaryImport } from './importers'
import { TERMS_TEXT, PRIVACY_TEXT } from './legal'
import { Icon, LogoMark } from './icons'
import { HelpModal } from './help'
import './App.css'

const HELP_SEEN_KEY = 'mindmap:help-seen:v1'

const NODE_MIN_W = 80
const DEFAULT_SIZE = { w: 140, h: 44 }

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

  // 使い方ガイド（初回訪問時は自動で開く）
  const [helpOpen, setHelpOpen] = useState(() => {
    try {
      return !localStorage.getItem(HELP_SEEN_KEY)
    } catch {
      return false
    }
  })
  const closeHelp = useCallback(() => {
    try {
      localStorage.setItem(HELP_SEEN_KEY, '1')
    } catch {
      // 保存できなくても閉じる
    }
    setHelpOpen(false)
  }, [])

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

  // 画面中央基準のズーム（ズームコントロール用）
  const zoomBy = useCallback((factor) => {
    const v = viewRef.current
    const rect = canvasRef.current.getBoundingClientRect()
    const newScale = Math.min(2.5, Math.max(0.25, v.scale * factor))
    const mx = rect.width / 2
    const my = rect.height / 2
    const wx = (mx - v.x) / v.scale
    const wy = (my - v.y) / v.scale
    setView({ scale: newScale, x: mx - wx * newScale, y: my - wy * newScale })
  }, [])

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
        mm.toggleCollapse(cur.id)
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
      // 入力欄（ログイン・パスワード・名前変更など）へのタイプはショートカット対象外
      const t = e.target
      if (
        t instanceof HTMLElement &&
        (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)
      ) return

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
  // サイドバー展開中はその分だけ右側の余白にセンタリングする
  const SIDEBAR_W = 292
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
    const offsetL = sidebarOpen ? SIDEBAR_W : 0
    const availW = rect.width - offsetL
    const pad = 100
    const bw = maxX - minX + pad * 2
    const bh = maxY - minY + pad * 2
    const scale = Math.min(1, Math.min(availW / bw, rect.height / bh))
    const cx = (minX + maxX) / 2
    const cy = (minY + maxY) / 2
    setView({ scale, x: offsetL + availW / 2 - cx * scale, y: rect.height / 2 - cy * scale })
  }, [state.nodes, visibleIds, sidebarOpen])

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
    const scale = 2
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
      ctx.globalAlpha = 0.5
      ctx.lineWidth = 2
      ctx.stroke()
      ctx.globalAlpha = 1
    }
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    for (const id of ids) {
      const n = state.nodes[id]
      const s = sizesRef.current[id] || DEFAULT_SIZE
      const isRoot = id === state.rootId
      ctx.beginPath()
      ctx.roundRect(n.x, n.y, s.w, s.h, 10)
      ctx.fillStyle = isRoot ? n.color : '#ffffff'
      ctx.fill()
      ctx.strokeStyle = n.color
      ctx.lineWidth = 1.5
      ctx.stroke()
      ctx.fillStyle = isRoot ? '#ffffff' : '#16181D'
      ctx.font = `${isRoot ? '700 15px' : '500 13px'} Inter, 'Noto Sans JP', system-ui, sans-serif`
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
  const selectedSize = selected ? sizesRef.current[selected.id] || DEFAULT_SIZE : null

  return (
    <div className="app">
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
              <path key={edge.id} d={edge.d} fill="none" stroke={edge.color} strokeWidth={2} strokeOpacity={0.45} />
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

        {selected && editingId !== selected.id && (
          <SelectionBar
            node={selected}
            size={selectedSize}
            view={view}
            mm={mm}
            isRoot={selected.id === state.rootId}
            hasChildren={(childrenMap.get(selected.id) || []).length > 0}
            onEdit={() => setEditingId(selected.id)}
            setEditingId={setEditingId}
          />
        )}
      </div>

      <header className="topbar">
        <div className="tb-card">
          <button
            className={`icon-btn${sidebarOpen ? ' active' : ''}`}
            title="マップ一覧"
            onClick={() => setSidebarOpen((v) => !v)}
          >
            <Icon name="panel" />
          </button>
          <span className="tb-div" />
          <span className="brand">
            <LogoMark size={22} />
            <span className="wordmark">
              Nobleme<b>MindMap</b>
            </span>
          </span>
          <span className="tb-div" />
          <MapTitle mm={mm} />
        </div>
        <div className="tb-card">
          <button className="icon-btn" disabled={!mm.canUndo} onClick={mm.undo} title="元に戻す (⌘Z)">
            <Icon name="undo" />
          </button>
          <button className="icon-btn" disabled={!mm.canRedo} onClick={mm.redo} title="やり直す (⌘⇧Z)">
            <Icon name="redo" />
          </button>
          <span className="tb-div" />
          <button className="icon-btn" onClick={recenter} title="全体表示">
            <Icon name="fit" />
          </button>
          <button className="icon-btn" onClick={exportPNG} title="PNG画像として保存">
            <Icon name="image" />
          </button>
          <span className="tb-div" />
          <button className="icon-btn" onClick={() => setHelpOpen(true)} title="使い方">
            <Icon name="help" />
          </button>
        </div>
      </header>

      {sidebarOpen && <Sidebar mm={mm} />}

      <div className="zoombar">
        <button className="icon-btn" onClick={() => zoomBy(1 / 1.2)} title="縮小">
          <Icon name="minus" />
        </button>
        <button className="zoom-pct" onClick={recenter} title="全体表示">
          {Math.round(view.scale * 100)}%
        </button>
        <button className="icon-btn" onClick={() => zoomBy(1.2)} title="拡大">
          <Icon name="plus" />
        </button>
      </div>

      <div className="hint-chip" style={{ left: `calc(50% + ${sidebarOpen ? SIDEBAR_W / 2 : 0}px)` }}>
        <kbd>Tab</kbd>子 <kbd>Enter</kbd>兄弟 <kbd>Space</kbd>たたむ <kbd>⌘Z</kbd>戻す ・ ダブルクリックで編集
      </div>

      {helpOpen && <HelpModal onClose={closeHelp} />}

      {mm.cloud.recoveryMode && (
        <PasswordModal
          cloud={mm.cloud}
          title="新しいパスワードを設定"
          onClose={() => mm.cloud.setRecoveryMode(false)}
        />
      )}
    </div>
  )
}

// マップ名（ダブルクリックで変更）
function MapTitle({ mm }) {
  const [editing, setEditing] = useState(false)
  if (editing) {
    return (
      <input
        className="map-title-input"
        autoFocus
        defaultValue={mm.current.name}
        onFocus={(e) => e.target.select()}
        onBlur={(e) => {
          mm.renameProject(mm.current.id, e.target.value.trim() || '無題のマップ')
          setEditing(false)
        }}
        onKeyDown={(e) => {
          if (isComposingEvent(e)) return
          if (e.key === 'Enter') e.target.blur()
          if (e.key === 'Escape') setEditing(false)
        }}
      />
    )
  }
  return (
    <button className="map-title" title="ダブルクリックで名前を変更" onDoubleClick={() => setEditing(true)}>
      {mm.current.name}
    </button>
  )
}

// 選択中ノードのコンテキストツールバー
function SelectionBar({ node, size, view, mm, isRoot, hasChildren, onEdit, setEditingId }) {
  const left = view.x + (node.x + size.w / 2) * view.scale
  const top = view.y + node.y * view.scale
  return (
    <div
      className="selection-bar"
      style={{ left, top }}
      onPointerDown={(e) => e.stopPropagation()}
    >
      <button
        className="icon-btn"
        title="子ノードを追加 (Tab)"
        onClick={() => {
          const id = mm.addChild(node.id)
          if (id) setEditingId(id)
        }}
      >
        <Icon name="add-child" />
      </button>
      <button
        className="icon-btn"
        title="兄弟ノードを追加 (Enter)"
        disabled={isRoot}
        onClick={() => {
          const id = mm.addSibling(node.id)
          if (id) setEditingId(id)
        }}
      >
        <Icon name="add-sibling" />
      </button>
      <button className="icon-btn" title="テキストを編集 (F2)" onClick={onEdit}>
        <Icon name="pencil" />
      </button>
      <button
        className="icon-btn"
        title={node.collapsed ? '展開 (Space)' : '折りたたむ (Space)'}
        disabled={!hasChildren}
        onClick={() => mm.toggleCollapse(node.id)}
      >
        <Icon name={node.collapsed ? 'unfold' : 'fold'} />
      </button>
      <span className="sb-div" />
      <span className="sb-colors">
        {mm.PALETTE.map((c) => (
          <button
            key={c}
            className={`swatch${node.color === c ? ' on' : ''}`}
            title="色を変更"
            style={{ background: c }}
            onClick={() => mm.setColor(node.id, c)}
          />
        ))}
      </span>
      <span className="sb-div" />
      <button
        className="icon-btn danger"
        title="削除 (Delete)"
        disabled={isRoot}
        onClick={() => mm.deleteNode(node.id)}
      >
        <Icon name="trash" />
      </button>
    </div>
  )
}

function NodeView({
  node, isRoot, selected, editing, hiddenCount,
  onPointerDown, onStartEdit, onToggleCollapse, onText, onEndEdit,
}) {
  const inputRef = useRef(null)
  const originalRef = useRef(node.text)

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
        color: isRoot ? '#fff' : 'var(--ink)',
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
            if (isComposingEvent(e)) return
            if (e.key === 'Enter') {
              e.preventDefault()
              onEndEdit()
            } else if (e.key === 'Escape') {
              e.preventDefault()
              onText(originalRef.current)
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

function Sidebar({ mm }) {
  const { store, current } = mm
  const [renamingId, setRenamingId] = useState(null)
  const [legalTab, setLegalTab] = useState(null)
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
    e.target.value = ''
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
    <aside className="sidebar">
      <CloudPanel cloud={mm.cloud} />
      <div className="sidebar-head">
        <span>マイマップ</span>
        <button className="btn-primary sm" onClick={() => mm.newProject()}>
          <Icon name="plus" size={13} /> 新規
        </button>
      </div>
      <div className="backup-bar">
        <button className="btn sm" title="全マップをバックアップ書き出し" onClick={exportAll}>
          <Icon name="download" size={13} /> バックアップ
        </button>
        <button
          className="btn sm"
          title="ファイルから読み込み（JSON / MindMeister(.mind) / OPML / FreeMind(.mm) / Markdown）"
          onClick={() => fileRef.current?.click()}
        >
          <Icon name="upload" size={13} /> 読み込み
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
                  if (isComposingEvent(e)) return
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
                    <Icon name="download" size={13} />
                  </button>
                  <button
                    title="複製"
                    onClick={(e) => {
                      e.stopPropagation()
                      mm.duplicateProject(p.id)
                    }}
                  >
                    <Icon name="copy" size={13} />
                  </button>
                  <button
                    title="名前を変更"
                    onClick={(e) => {
                      e.stopPropagation()
                      setRenamingId(p.id)
                    }}
                  >
                    <Icon name="pencil" size={13} />
                  </button>
                  <button
                    title="削除"
                    onClick={(e) => {
                      e.stopPropagation()
                      if (confirm(`「${p.name}」を削除しますか？`)) mm.deleteProject(p.id)
                    }}
                  >
                    <Icon name="x" size={13} />
                  </button>
                </span>
              </>
            )}
          </div>
        ))}
      </div>
      <div className="sidebar-foot">
        <span>
          {projects.length} マップ ・ 自動保存
        </span>
        <span className="foot-links">
          <button type="button" onClick={() => setLegalTab('terms')}>利用規約</button>
          <button type="button" onClick={() => setLegalTab('privacy')}>プライバシー</button>
        </span>
      </div>
      {legalTab && <LegalModal tab={legalTab} onClose={() => setLegalTab(null)} />}
    </aside>
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
  const [pwOpen, setPwOpen] = useState(false)
  if (!cloud.enabled) return null

  if (!cloud.user) {
    return (
      <div className="cloud-bar">
        <button className="cloud-login-btn" onClick={() => setModalOpen(true)}>
          <Icon name="cloud" size={15} /> ログイン / 新規登録
        </button>
        <div className="cloud-note">ログインすると全デバイスでマップを同期</div>
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
        <button className="icon-btn xs" title="今すぐ同期" onClick={() => cloud.fullSync()}>
          <Icon name="refresh" size={13} />
        </button>
        <button className="icon-btn xs" title="パスワード変更" onClick={() => setPwOpen(true)}>
          <Icon name="key" size={13} />
        </button>
        <button
          className="icon-btn xs"
          title="ログアウト"
          onClick={() => {
            if (confirm('ログアウトしますか？\n（このPCのローカルデータはそのまま残ります）')) cloud.signOut()
          }}
        >
          <Icon name="logout" size={13} />
        </button>
      </div>
      {pwOpen && <PasswordModal cloud={cloud} title="パスワード変更" onClose={() => setPwOpen(false)} />}
    </div>
  )
}

function jpError(error) {
  const m = error?.message || ''
  if (/Invalid login credentials/i.test(m)) return 'メールアドレスかパスワードが違います'
  if (/already registered/i.test(m)) return 'このメールアドレスは登録済みです。ログインしてください'
  if (/at least 6 characters|Password should/i.test(m)) return 'パスワードは6文字以上にしてください'
  if (/valid email|is invalid/i.test(m)) return 'メールアドレスの形式が正しくありません'
  if (/rate limit|Too many/i.test(m)) return '試行回数が多すぎます。しばらく待ってから再度お試しください'
  if (/not confirmed/i.test(m)) return 'メール確認が完了していません。届いたメールのリンクを開いてください'
  if (/different from the old/i.test(m)) return '現在と同じパスワードは設定できません'
  return `エラー: ${m}`
}

function AuthModal({ cloud, onClose }) {
  const [mode, setMode] = useState('login') // login | signup | forgot
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState(null)
  const [legalTab, setLegalTab] = useState(null)

  const submit = async (e) => {
    e.preventDefault()
    if (busy) return
    setMessage(null)
    setBusy(true)
    try {
      if (mode === 'signup') {
        const { data, error } = await cloud.signUp(email.trim(), password)
        if (error) setMessage({ type: 'error', text: jpError(error) })
        else if (data.session) onClose()
        else setMessage({ type: 'info', text: '確認メールを送信しました。メール内のリンクを開くと登録完了です。' })
      } else if (mode === 'forgot') {
        const { error } = await cloud.resetPassword(email.trim())
        if (error) setMessage({ type: 'error', text: jpError(error) })
        else setMessage({ type: 'info', text: '再設定メールを送信しました。メール内のリンクから新しいパスワードを設定してください。' })
      } else {
        const { error } = await cloud.signIn(email.trim(), password)
        if (error) setMessage({ type: 'error', text: jpError(error) })
        else onClose()
      }
    } finally {
      setBusy(false)
    }
  }

  return createPortal(
    <div className="modal-overlay" onPointerDown={(e) => e.stopPropagation()} onClick={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <form className="auth-modal" onSubmit={submit}>
        {mode !== 'forgot' ? (
          <div className="auth-tabs">
            <button type="button" className={mode === 'login' ? 'on' : ''} onClick={() => { setMode('login'); setMessage(null) }}>ログイン</button>
            <button type="button" className={mode === 'signup' ? 'on' : ''} onClick={() => { setMode('signup'); setMessage(null) }}>新規登録</button>
          </div>
        ) : (
          <div className="auth-head">パスワード再設定</div>
        )}
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
        {mode !== 'forgot' && (
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
        )}
        {message && <div className={`auth-msg ${message.type}`}>{message.text}</div>}
        {mode === 'login' && (
          <button type="button" className="auth-link" onClick={() => { setMode('forgot'); setMessage(null) }}>
            パスワードをお忘れですか？
          </button>
        )}
        {mode === 'forgot' && (
          <button type="button" className="auth-link" onClick={() => { setMode('login'); setMessage(null) }}>
            ← ログインに戻る
          </button>
        )}
        <div className="auth-buttons">
          <button type="button" className="btn" onClick={onClose}>キャンセル</button>
          <button type="submit" className="btn-primary" disabled={busy}>
            {busy ? '処理中…' : mode === 'login' ? 'ログイン' : mode === 'signup' ? '登録する' : '再設定メールを送る'}
          </button>
        </div>
        {mode === 'signup' ? (
          <div className="auth-note">
            登録すると
            <button type="button" className="auth-link inline" onClick={() => setLegalTab('terms')}>利用規約</button>
            と
            <button type="button" className="auth-link inline" onClick={() => setLegalTab('privacy')}>プライバシーポリシー</button>
            に<br />同意したものとみなされます。
          </div>
        ) : (
          <div className="auth-note">
            ログインすると、マップがクラウドに保存され<br />どのPC・スマホからでも同じデータを使えます。
          </div>
        )}
        {legalTab && <LegalModal tab={legalTab} onClose={() => setLegalTab(null)} />}
      </form>
    </div>,
    document.body,
  )
}

function PasswordModal({ cloud, title, onClose }) {
  const [pw1, setPw1] = useState('')
  const [pw2, setPw2] = useState('')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState(null)

  const submit = async (e) => {
    e.preventDefault()
    if (busy) return
    if (pw1 !== pw2) {
      setMessage({ type: 'error', text: 'パスワードが一致しません' })
      return
    }
    setBusy(true)
    setMessage(null)
    try {
      const { error } = await cloud.updatePassword(pw1)
      if (error) setMessage({ type: 'error', text: jpError(error) })
      else {
        alert('パスワードを変更しました。')
        onClose()
      }
    } finally {
      setBusy(false)
    }
  }

  return createPortal(
    <div className="modal-overlay" onPointerDown={(e) => e.stopPropagation()} onClick={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <form className="auth-modal" onSubmit={submit}>
        <div className="auth-head">{title}</div>
        <label>
          新しいパスワード（6文字以上）
          <input type="password" required minLength={6} autoFocus value={pw1} onChange={(e) => setPw1(e.target.value)} />
        </label>
        <label>
          新しいパスワード（確認）
          <input type="password" required minLength={6} value={pw2} onChange={(e) => setPw2(e.target.value)} />
        </label>
        {message && <div className={`auth-msg ${message.type}`}>{message.text}</div>}
        <div className="auth-buttons">
          <button type="button" className="btn" onClick={onClose}>キャンセル</button>
          <button type="submit" className="btn-primary" disabled={busy}>{busy ? '処理中…' : '変更する'}</button>
        </div>
      </form>
    </div>,
    document.body,
  )
}

function LegalModal({ tab: initialTab, onClose }) {
  const [tab, setTab] = useState(initialTab || 'terms')
  return createPortal(
    <div className="modal-overlay" onPointerDown={(e) => e.stopPropagation()} onClick={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div className="legal-modal">
        <div className="auth-tabs">
          <button type="button" className={tab === 'terms' ? 'on' : ''} onClick={() => setTab('terms')}>利用規約</button>
          <button type="button" className={tab === 'privacy' ? 'on' : ''} onClick={() => setTab('privacy')}>プライバシーポリシー</button>
        </div>
        <div className="legal-body">{tab === 'terms' ? TERMS_TEXT : PRIVACY_TEXT}</div>
        <div className="auth-buttons">
          <button type="button" className="btn" onClick={onClose}>閉じる</button>
        </div>
      </div>
    </div>,
    document.body,
  )
}
