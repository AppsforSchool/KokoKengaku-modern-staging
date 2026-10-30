import { Link } from 'react-router-dom'
import { PageShell } from '../components/PageShell'

// ★ 仮の画面。見つかりません（*）の画面は、既存に対応するファイルがない（404.html は存在しない）ため、仮のまま。

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
