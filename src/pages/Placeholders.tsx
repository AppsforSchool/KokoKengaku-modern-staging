import { Link, useParams } from 'react-router-dom'
import { PageShell } from '../components/PageShell'

// ★ 仮の画面。トーク画面は2bで、本物に置き換える。見つかりません（*）の画面は、既存に対応するファイルがない（404.html は存在しない）ため、仮のまま。

export function TalkPlaceholder() {
	const { roomId } = useParams()
	return (
		<PageShell name="login">
			<main>
				<div>
					<p>トーク画面（フェーズ2bで移植します）</p>
					<p>ルームID：{roomId}</p>
					<p>
						<Link to="/">ルーム一覧へ戻る</Link>
					</p>
				</div>
			</main>
		</PageShell>
	)
}

export function NotFoundPlaceholder() {
	return (
		<PageShell name="login">
			<main>
				<div>
					<p>ページが見つかりません。</p>
					<p>
						<Link to="/">ルーム一覧へ</Link>
					</p>
				</div>
			</main>
		</PageShell>
	)
}
