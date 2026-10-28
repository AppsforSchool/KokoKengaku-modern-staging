// ★ すべてのCSSを、ここで、決まった順序で読み込む。
//   src/styles/new/・old/ の CSS は、中身を書き換えず、ビルド時に、ページごと・新旧UIごとに限定される（build/scopeCss.ts）。
//   ・既存のCSSは、ページごとに別々に読み込まれていた。ページのCSSを移したら、ここに1行ずつ足す。
//   ・dialog は、全ページ共通のダイアログ用。元のサイトと同じく、ページのCSSより「あと」に読み込む（同じ詳細度のとき、あとのものが勝つため）。
import './base.css'
import './new/login.css'
import './old/login.css'
import './uiSwitch.css'
import './new/dialog.css'
import './old/dialog.css'
