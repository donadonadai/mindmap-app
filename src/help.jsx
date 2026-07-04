// 使い方ガイド（トップバーの ? から。初回訪問時は自動表示）
import { createPortal } from 'react-dom'
import { Icon, LogoMark } from './icons'

const Kbd = ({ children }) => <kbd className="g-kbd">{children}</kbd>

export function HelpModal({ onClose }) {
  return createPortal(
    <div
      className="modal-overlay"
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div className="help-modal">
        <div className="help-hero">
          <LogoMark size={36} />
          <div>
            <div className="help-title">Nobleme MindMap の使い方</div>
            <div className="help-sub">考えを、つなげて広げるためのキャンバスです。</div>
          </div>
        </div>

        <div className="help-body">
          <section>
            <h3><Icon name="plus" size={14} /> まずはここから</h3>
            <ol className="help-steps">
              <li>中央の<b>「メインテーマ」をクリック</b>して選択します。</li>
              <li>ノードの上に出るツールバーの <b>子ノード追加</b>（またはキーボードの <Kbd>Tab</Kbd>）で枝を伸ばします。</li>
              <li><b>ダブルクリック</b>（または <Kbd>F2</Kbd>）で文字を書き換えます。</li>
              <li>あとはこの繰り返し。考えた順につなげていくだけです。</li>
            </ol>
          </section>

          <section>
            <h3><Icon name="mouse" size={14} /> マウス操作</h3>
            <table className="help-table">
              <tbody>
                <tr><td>ノードをドラッグ</td><td>ノードを移動</td></tr>
                <tr><td>ノードを別のノードに重ねて離す</td><td>その枝の子として付け替え（枝ごと引っ越し）</td></tr>
                <tr><td>背景をドラッグ</td><td>キャンバス全体を移動</td></tr>
                <tr><td>マウスホイール</td><td>ズーム（カーソル位置を中心に）</td></tr>
                <tr><td>ダブルクリック</td><td>テキストを編集</td></tr>
                <tr><td>右下の「%」をクリック</td><td>マップ全体を画面に収める</td></tr>
              </tbody>
            </table>
          </section>

          <section>
            <h3><Icon name="keyboard" size={14} /> キーボードショートカット</h3>
            <table className="help-table">
              <tbody>
                <tr><td><Kbd>Tab</Kbd></td><td>子ノードを追加</td></tr>
                <tr><td><Kbd>Enter</Kbd></td><td>兄弟ノードを追加（同じ階層に並べる）</td></tr>
                <tr><td><Kbd>F2</Kbd></td><td>テキストを編集（<Kbd>Esc</Kbd> で取り消し）</td></tr>
                <tr><td><Kbd>Delete</Kbd></td><td>ノードを削除（つながる子ごと）</td></tr>
                <tr><td><Kbd>Space</Kbd></td><td>枝を折りたたむ / 展開する</td></tr>
                <tr><td><Kbd>← → ↑ ↓</Kbd></td><td>ノード間を移動（←親 / →子 / ↑↓兄弟）</td></tr>
                <tr><td><Kbd>⌘Z</Kbd> / <Kbd>⌘⇧Z</Kbd></td><td>元に戻す / やり直す（Windowsは <Kbd>Ctrl</Kbd>）</td></tr>
              </tbody>
            </table>
          </section>

          <section>
            <h3><Icon name="layers" size={14} /> マップの管理</h3>
            <ul className="help-list">
              <li>左上の <Icon name="panel" size={13} /> でマップ一覧を開閉。<b>＋新規</b> で何枚でも作れます。</li>
              <li>マップ名は一覧の行、または上部のタイトルを<b>ダブルクリック</b>で変更できます。</li>
              <li>編集内容は<b>自動保存</b>されます。保存ボタンはありません。</li>
              <li>枝が増えたら、ノードを選んで <Kbd>Space</Kbd> で折りたたんで整理（<b>+N</b> バッジをクリックで展開）。</li>
              <li>ノードが重なって見づらくなったら、右上の <Icon name="tidy" size={13} /> <b>自動整列</b>で一発で整えられます。<b>横ツリー</b>と<b>放射状（円形）</b>の2パターンから選べて、<Kbd>⌘Z</Kbd> で戻せます。</li>
            </ul>
          </section>

          <section>
            <h3><Icon name="cloud" size={14} /> クラウド同期（無料）</h3>
            <ul className="help-list">
              <li>左パネルの<b>「ログイン / 新規登録」</b>からメールアドレスで登録すると、マップがクラウドに保存され、<b>他のPC・スマホでも同じマップ</b>を開けます。</li>
              <li>緑の●が「同期済み」の印。ログインしない場合は、このブラウザの中だけに保存されます。</li>
            </ul>
          </section>

          <section>
            <h3><Icon name="download" size={14} /> 取り込み・書き出し</h3>
            <ul className="help-list">
              <li><b>⬆読み込み</b>: MindMeister（.mind）/ OPML / FreeMind（.mm）/ Markdown / 本アプリのJSONを取り込めます。</li>
              <li><b>⬇バックアップ</b>: 全マップを1つのファイルに書き出し。マップ行の <Icon name="download" size={12} /> で1枚ずつも可能です。</li>
              <li>右上の <Icon name="image" size={13} /> で、いま見えているマップを<b>PNG画像</b>として保存（資料への貼り付けに）。</li>
            </ul>
          </section>
        </div>

        <div className="help-foot">
          <span className="help-foot-note">このガイドは右上の <Icon name="help" size={13} /> からいつでも開けます</span>
          <button type="button" className="btn-primary" onClick={onClose}>はじめる</button>
        </div>
      </div>
    </div>,
    document.body,
  )
}
