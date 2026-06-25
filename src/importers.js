// 他のマインドマップ形式 → 本アプリ形式({nodes, rootId}) への変換
//
// 対応: OPML(.opml) / FreeMind・Freeplane(.mm) / Markdown(.md) / 自前JSON
// すべてテキスト/XMLなので外部ライブラリ不要。位置は自動ツリー配置する。

import { parseImport } from './storage'

const PALETTE = ['#2563eb', '#16a34a', '#db2777', '#ea580c', '#7c3aed', '#0891b2', '#ca8a04']
const COL_W = 220 // 階層ごとの横間隔
const ROW_H = 70 // 葉ノードの縦間隔

// 中間ツリー: { text, children: [...] }

// --- 中間ツリー → {nodes, rootId} へ（id付与・自動レイアウト） ---
function treeToData(tree) {
  const nodes = {}
  let idc = 0
  const genId = () => `imp_${(idc++).toString(36)}`

  const assign = (node, parentId, depth) => {
    const id = genId()
    node._id = id
    nodes[id] = {
      id,
      text: (node.text || '').trim() || '（無題）',
      x: depth * COL_W,
      y: 0,
      parentId,
      color: parentId === null ? '#1e293b' : PALETTE[(depth - 1) % PALETTE.length],
    }
    for (const c of node.children) assign(c, id, depth + 1)
  }
  assign(tree, null, 0)

  // 縦位置: 葉を順に並べ、親は子の中央
  let nextRow = 0
  const layoutY = (node) => {
    if (node.children.length === 0) {
      nodes[node._id].y = nextRow * ROW_H
      nextRow++
    } else {
      for (const c of node.children) layoutY(c)
      const first = nodes[node.children[0]._id].y
      const last = nodes[node.children[node.children.length - 1]._id].y
      nodes[node._id].y = (first + last) / 2
    }
  }
  layoutY(tree)

  return { nodes, rootId: tree._id }
}

// XML をパースして parsererror を検知
function parseXML(text) {
  const doc = new DOMParser().parseFromString(text, 'text/xml')
  if (doc.querySelector('parsererror')) throw new Error('XMLの解析に失敗しました')
  return doc
}

const childrenByTag = (el, tag) =>
  [...el.children].filter((c) => c.tagName.toLowerCase() === tag)

// --- OPML ---
function parseOPML(text, filename) {
  const doc = parseXML(text)
  const body = doc.querySelector('body')
  if (!body) throw new Error('OPMLのbodyが見つかりません')

  const walk = (el) => ({
    text: el.getAttribute('text') ?? el.getAttribute('title') ?? '',
    children: childrenByTag(el, 'outline').map(walk),
  })
  const tops = childrenByTag(body, 'outline').map(walk)
  if (tops.length === 0) throw new Error('OPMLに項目がありません')

  const title = doc.querySelector('head > title')?.textContent?.trim()
  let root
  if (tops.length === 1) {
    root = tops[0]
  } else {
    root = { text: title || baseName(filename), children: tops }
  }
  const name = title || root.text || baseName(filename)
  return { name, data: treeToData(root) }
}

// --- FreeMind / Freeplane (.mm) ---
function parseFreeMind(text, filename) {
  const doc = parseXML(text)
  const map = doc.querySelector('map')
  if (!map) throw new Error('FreeMind形式のmapが見つかりません')
  const rootEl = childrenByTag(map, 'node')[0]
  if (!rootEl) throw new Error('ノードが見つかりません')

  const nodeText = (el) => {
    const attr = el.getAttribute('TEXT') ?? el.getAttribute('text')
    if (attr != null) return attr
    // Freeplane の richcontent(HTML) フォールバック
    const rich = childrenByTag(el, 'richcontent')[0]
    return rich ? rich.textContent.replace(/\s+/g, ' ').trim() : ''
  }
  const walk = (el) => ({
    text: nodeText(el),
    children: childrenByTag(el, 'node').map(walk),
  })
  const root = walk(rootEl)
  return { name: root.text || baseName(filename), data: treeToData(root) }
}

// --- Markdown（見出し # と 箇条書き -,*,+ の混在に対応） ---
function parseMarkdown(text, filename) {
  const items = [] // { depth, text }
  let headingDepth = 0
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/\t/g, '  ')
    if (!line.trim()) continue
    const h = line.match(/^(#{1,6})\s+(.*)$/)
    if (h) {
      headingDepth = h[1].length - 1
      items.push({ depth: headingDepth, text: h[2].trim() })
      continue
    }
    const b = line.match(/^(\s*)[-*+]\s+(.*)$/)
    if (b) {
      const indent = Math.floor(b[1].length / 2)
      // 直近の見出しの下にぶら下げる
      const base = items.some((it) => it.text) ? headingDepth + 1 : 0
      items.push({ depth: base + indent, text: b[2].trim() })
      continue
    }
    // 通常のテキスト行は無視（段落など）
  }
  if (items.length === 0) throw new Error('Markdownから項目を抽出できませんでした')

  // depth リスト → ツリー
  const root = { text: baseName(filename), children: [] }
  const stack = [{ node: root, depth: -1 }]
  for (const it of items) {
    const node = { text: it.text, children: [] }
    while (stack.length > 1 && stack[stack.length - 1].depth >= it.depth) stack.pop()
    stack[stack.length - 1].node.children.push(node)
    stack.push({ node, depth: it.depth })
  }

  // ルート直下が1件だけならそれを実ルートに昇格
  let realRoot = root
  if (root.children.length === 1) realRoot = root.children[0]
  return { name: realRoot.text || baseName(filename), data: treeToData(realRoot) }
}

function baseName(filename) {
  return (filename || 'map').replace(/\.[^.]+$/, '')
}

// --- ディスパッチャ: 拡張子と中身から形式を判定 ---
export function importAnyFile(filename, text) {
  const ext = (filename.split('.').pop() || '').toLowerCase()
  const head = text.trimStart()

  // 自前JSON
  if (ext === 'json' || head.startsWith('{') || head.startsWith('[')) {
    return parseImport(text)
  }
  if (ext === 'opml' || /<opml[\s>]/i.test(head)) {
    return [parseOPML(text, filename)]
  }
  if (ext === 'mm' || /<map\b/i.test(head)) {
    return [parseFreeMind(text, filename)]
  }
  // md / markdown / txt などはMarkdownとして扱う
  return [parseMarkdown(text, filename)]
}
