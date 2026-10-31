import { useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { PageShell } from '../components/PageShell'
import { useDialog } from '../ui/DialogProvider'

// ★ 存在しないページ（どのルートにも当てはまらないとき）。
//   「指定されたページは見つかりませんでした。」とアラートで知らせ、OKが押されたら、ルーム一覧（#/）へ戻る。
//   （存在しないトークルームを開いたときと、同じ動き。未ログインなら、一覧への移動のあと、ログイン画面になる）
//   対応する既存のページはない（既存は、GitHub Pagesの標準の404画面だった）。

export default function NotFoundPage() {
	const dialog = useDialog()
	const navigate = useNavigate()
	const shown = useRef(false) // 開発時の二重実行で、アラートが2回出ないようにする

	useEffect(() => {
		if (shown.current) return
		shown.current = true
		void (async () => {
			await dialog.alert('指定されたページは見つかりませんでした。')
			navigate('/', { replace: true })
		})()
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [])

	// アラートの下には、何も出さない（ダイアログの表示場所のために、ページの枠だけ置く）
	return <PageShell name="login">{null}</PageShell>
}
