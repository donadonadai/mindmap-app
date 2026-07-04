// 線画SVGアイコンセット（lucide風 24x24 stroke）
// 使い方: <Icon name="plus" size={16} />

const PATHS = {
  // 基本操作
  plus: (
    <>
      <path d="M12 5v14" />
      <path d="M5 12h14" />
    </>
  ),
  minus: <path d="M5 12h14" />,
  x: (
    <>
      <path d="M18 6 6 18" />
      <path d="m6 6 12 12" />
    </>
  ),
  check: <path d="M20 6 9 17l-5-5" />,
  pencil: (
    <>
      <path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" />
      <path d="m15 5 4 4" />
    </>
  ),
  trash: (
    <>
      <path d="M3 6h18" />
      <path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6" />
      <path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2" />
      <path d="M10 11v6" />
      <path d="M14 11v6" />
    </>
  ),
  copy: (
    <>
      <rect width="14" height="14" x="8" y="8" rx="2" />
      <path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2" />
    </>
  ),
  // ノード追加
  'add-child': (
    <>
      <path d="M4 5v11a2 2 0 0 0 2 2h9" />
      <path d="M15 12h6" />
      <path d="M18 9v6" />
      <circle cx="4" cy="4" r="1.5" />
    </>
  ),
  'add-sibling': (
    <>
      <path d="M4 6h10" />
      <path d="M4 12h10" />
      <path d="M4 18h6" />
      <path d="M18 15v6" />
      <path d="M15 18h6" />
    </>
  ),
  // 折りたたみ
  fold: (
    <>
      <path d="m7 20 5-5 5 5" />
      <path d="m7 4 5 5 5-5" />
    </>
  ),
  unfold: (
    <>
      <path d="m7 15 5 5 5-5" />
      <path d="m7 9 5-5 5 5" />
    </>
  ),
  // 履歴
  undo: (
    <>
      <path d="M9 14 4 9l5-5" />
      <path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11" />
    </>
  ),
  redo: (
    <>
      <path d="m15 14 5-5-5-5" />
      <path d="M20 9H9.5a5.5 5.5 0 0 0 0 11H13" />
    </>
  ),
  // 表示
  fit: (
    <>
      <path d="M8 3H5a2 2 0 0 0-2 2v3" />
      <path d="M21 8V5a2 2 0 0 0-2-2h-3" />
      <path d="M3 16v3a2 2 0 0 0 2 2h3" />
      <path d="M16 21h3a2 2 0 0 0 2-2v-3" />
    </>
  ),
  image: (
    <>
      <rect width="18" height="18" x="3" y="3" rx="2" />
      <circle cx="9" cy="9" r="2" />
      <path d="m21 15-3.09-3.09a2 2 0 0 0-2.83 0L6 21" />
    </>
  ),
  // 入出力
  download: (
    <>
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <path d="m7 10 5 5 5-5" />
      <path d="M12 15V3" />
    </>
  ),
  upload: (
    <>
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <path d="m7 8 5-5 5 5" />
      <path d="M12 3v12" />
    </>
  ),
  // パネル・ナビ
  panel: (
    <>
      <rect width="18" height="18" x="3" y="3" rx="2" />
      <path d="M9 3v18" />
    </>
  ),
  // クラウド・アカウント
  cloud: <path d="M17.5 19H9a7 7 0 1 1 6.71-9h1.79a4.5 4.5 0 1 1 0 9Z" />,
  refresh: (
    <>
      <path d="M21 12a9 9 0 1 1-2.64-6.36" />
      <path d="M21 3v6h-6" />
    </>
  ),
  key: (
    <>
      <circle cx="7.5" cy="15.5" r="4.5" />
      <path d="m21 2-9.6 9.6" />
      <path d="m15.5 7.5 3 3L22 7l-3-3" />
    </>
  ),
  logout: (
    <>
      <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
      <path d="m16 17 5-5-5-5" />
      <path d="M21 12H9" />
    </>
  ),
  tidy: (
    <>
      <rect x="3" y="3" width="7" height="7" rx="1.5" />
      <rect x="14" y="14" width="7" height="7" rx="1.5" />
      <path d="M6.5 10v4a3 3 0 0 0 3 3H14" />
    </>
  ),
  radial: (
    <>
      <circle cx="12" cy="12" r="2.5" />
      <path d="M12 9.5v-4" />
      <path d="M12 18.5v-4" />
      <path d="M9.5 12h-4" />
      <path d="M18.5 12h-4" />
      <circle cx="12" cy="4" r="1.4" />
      <circle cx="12" cy="20" r="1.4" />
      <circle cx="4" cy="12" r="1.4" />
      <circle cx="20" cy="12" r="1.4" />
    </>
  ),
  help: (
    <>
      <circle cx="12" cy="12" r="10" />
      <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" />
      <path d="M12 17h.01" />
    </>
  ),
  mouse: (
    <>
      <rect x="6" y="3" width="12" height="18" rx="6" />
      <path d="M12 7v4" />
    </>
  ),
  keyboard: (
    <>
      <rect width="20" height="14" x="2" y="5" rx="2" />
      <path d="M6 9h.01" />
      <path d="M10 9h.01" />
      <path d="M14 9h.01" />
      <path d="M18 9h.01" />
      <path d="M7 13h10" />
    </>
  ),
  layers: (
    <>
      <path d="m12 2 8.5 4.5L12 11 3.5 6.5Z" />
      <path d="m3.5 12 8.5 4.5 8.5-4.5" />
      <path d="m3.5 17.5 8.5 4.5 8.5-4.5" />
    </>
  ),
}

export function Icon({ name, size = 16, strokeWidth = 1.8 }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {PATHS[name] || null}
    </svg>
  )
}

// ブランドロゴマーク（ファビコンと同モチーフ）
export function LogoMark({ size = 20 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden="true">
      <rect width="64" height="64" rx="14" fill="#16181D" />
      <path d="M30 32 C 38 32, 40 18, 48 18" stroke="#5B8DEF" strokeWidth="3.5" fill="none" strokeLinecap="round" />
      <path d="M30 32 C 40 32, 42 32, 50 32" stroke="#34B27B" strokeWidth="3.5" fill="none" strokeLinecap="round" />
      <path d="M30 32 C 38 32, 40 46, 48 46" stroke="#E0538D" strokeWidth="3.5" fill="none" strokeLinecap="round" />
      <rect x="10" y="25" width="22" height="14" rx="7" fill="#ffffff" />
      <circle cx="50" cy="18" r="5" fill="#5B8DEF" />
      <circle cx="52" cy="32" r="5" fill="#34B27B" />
      <circle cx="50" cy="46" r="5" fill="#E0538D" />
    </svg>
  )
}
