// 他のマインドマップ形式 → 本アプリ形式({nodes, rootId}) への変換
//
// 対応:
//  - テキスト系: OPML(.opml) / FreeMind・Freeplane(.mm) / Markdown(.md) / 自前JSON
//  - バイナリ系: MindMeister(.mind, zip内 map.json)
// 位置情報を持つ形式(.mind)は元座標を保持。無い形式はツリー自動レイアウトする。

import { parseImport } from './storage'
import { unzipSync, strFromU8 } from 'fflate'

const PALETTE = ['#2563eb', '#16a34a', '#db2777', '#ea580c', '#7c3aed', '#0891b2', '#ca8a04']
const COL_W = 220 // 階層ごとの横間隔
const ROW_H = 70 // 葉ノードの縦間隔

// 中間ツリー: { text, children:[...], pos?:[x,y], color?:string }

// --- 中間ツリー → {nodes, rootId} ---
// opts.positions=true のとき node.pos(数値ペア)があれば座標として採用、無ければ depth*COL_W
function treeToData(tree, { positions = false } = {}) {
  const nodes = {}
  let idc = 0
  const genId = () => `imp_${(idc++).toString(36)}`

  const assign = (node, parentId, depth) => {
    const id = genId()
    node._id = id
    nodes[id] = {
      id,
      text: (node.text || '').replace(/\s*\n\s*/g, ' ').trim() || '（無題）',
      x: depth * COL_W,
      y: 0,
      parentId,
      color: parentId === null ? '#1e293b' : node.color || PALETTE[(depth - 1) % PALETTE.length],
    }
    for (const c of node.children) assign(c, id, depth + 1)
  }
  assign(tree, null, 0)

  if (positions) {
    const place = (node) => {
      const p = node.pos
      if (p && typeof p[0] === 'number' && typeof p[1] === 'number') {
        nodes[node._id].x = p[0]
        nodes[node._id].y = p[1]
      }
      // pos が無いノード(ルート等)は assign 時の既定値(depth*COL_W, 0)のまま
      node.children.forEach(place)
    }
    place(tree)
  } else {
    // 縦位置: 葉を順に並べ、親は子の中央（横は depth*COL_W）
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
  }

  return { nodes, rootId: tree._id }
}

function parseXML(text) {
  const doc = new DOMParser().parseFromString(text, 'text/xml')
  if (doc.querySelector('parsererror')) throw new Error('XMLの解析に失敗しました')
  return doc
}

const childrenByTag = (el, tag) =>
  [...el.children].filter((c) => c.tagName.toLowerCase() === tag)

function baseName(filename) {
  return (filename || 'map').replace(/\.[^.]+$/, '')
}

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
  const root = tops.length === 1 ? tops[0] : { text: title || baseName(filename), children: tops }
  return { name: title || root.text || baseName(filename), data: treeToData(root) }
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
    const rich = childrenByTag(el, 'richcontent')[0]
    return rich ? rich.textContent.replace(/\s+/g, ' ').trim() : ''
  }
  const walk = (el) => ({ text: nodeText(el), children: childrenByTag(el, 'node').map(walk) })
  const root = walk(rootEl)
  return { name: root.text || baseName(filename), data: treeToData(root) }
}

// --- Markdown（見出し # と 箇条書き -,*,+ の混在に対応） ---
function parseMarkdown(text, filename) {
  const items = []
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
      const base = items.length ? headingDepth + 1 : 0
      items.push({ depth: base + indent, text: b[2].trim() })
    }
  }
  if (items.length === 0) throw new Error('Markdownから項目を抽出できませんでした')

  const root = { text: baseName(filename), children: [] }
  const stack = [{ node: root, depth: -1 }]
  for (const it of items) {
    const node = { text: it.text, children: [] }
    while (stack.length > 1 && stack[stack.length - 1].depth >= it.depth) stack.pop()
    stack[stack.length - 1].node.children.push(node)
    stack.push({ node, depth: it.depth })
  }
  const realRoot = root.children.length === 1 ? root.children[0] : root
  return { name: realRoot.text || baseName(filename), data: treeToData(realRoot) }
}

// --- MindMeister (.mind の中の map.json) ---
function styleColor(style) {
  if (!style) return undefined
  if (typeof style === 'string') return /^#[0-9a-f]{3,8}$/i.test(style.trim()) ? style.trim() : undefined
  if (typeof style === 'object') {
    const c = style.color || style.borderColor || style.background || style.backgroundColor
    return typeof c === 'string' && /^#[0-9a-f]{3,8}$/i.test(c.trim()) ? c.trim() : undefined
  }
  return undefined
}

function parseMind(jsonText, filename) {
  const obj = JSON.parse(jsonText)
  const root = obj.root || obj.idea || obj
  if (!root || typeof root !== 'object') throw new Error('mapデータが見つかりません')

  const toTree = (n) => ({
    text: n.title ?? n.text ?? '',
    pos: Array.isArray(n.pos) ? n.pos : null,
    color: styleColor(n.style),
    children: (n.children || [])
      .slice()
      .sort((a, b) => (a.rank ?? 0) - (b.rank ?? 0))
      .map(toTree),
  })
  const tree = toTree(root)

  // 座標が十分にあれば元レイアウトを保持、無ければ自動レイアウト
  let total = 0
  let withPos = 0
  const count = (t) => {
    total++
    if (t.pos && typeof t.pos[0] === 'number' && typeof t.pos[1] === 'number') withPos++
    t.children.forEach(count)
  }
  count(tree)
  const usePos = total > 1 && withPos >= (total - 1) * 0.5

  const name = (tree.text || '').split('\n')[0].trim() || baseName(filename)
  return { name, data: treeToData(tree, { positions: usePos }) }
}

// --- テキストファイルのディスパッチャ ---
export function importAnyFile(filename, text) {
  const ext = (filename.split('.').pop() || '').toLowerCase()
  const head = text.trimStart()

  if (ext === 'json' || head.startsWith('{') || head.startsWith('[')) {
    return parseImport(text)
  }
  if (ext === 'opml' || /<opml[\s>]/i.test(head)) return [parseOPML(text, filename)]
  if (ext === 'mm' || /<map\b/i.test(head)) return [parseFreeMind(text, filename)]
  return [parseMarkdown(text, filename)]
}

// --- バイナリ(zip)ファイルのディスパッチャ ---
export function importBinaryFile(filename, arrayBuffer) {
  const ext = (filename.split('.').pop() || '').toLowerCase()
  let files
  try {
    files = unzipSync(new Uint8Array(arrayBuffer))
  } catch {
    throw new Error('ファイルを展開できませんでした（壊れているか非対応の形式です）')
  }
  const find = (name) => files[name] || files[Object.keys(files).find((k) => k.endsWith(name)) || '']

  if (ext === 'mind') {
    const entry = find('map.json')
    if (!entry) throw new Error('.mind 内に map.json が見つかりません')
    return [parseMind(strFromU8(entry), filename)]
  }
  throw new Error(`未対応の形式です: .${ext}`)
}

// 拡張子がバイナリ(zip)系かどうか
export function isBinaryImport(filename) {
  const ext = (filename.split('.').pop() || '').toLowerCase()
  return ext === 'mind' || ext === 'xmind'
}
