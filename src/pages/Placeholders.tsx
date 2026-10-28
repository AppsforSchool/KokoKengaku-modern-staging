import { Link, useParams } from 'react-router-dom'
import { useAuth } from '../auth/AuthProvider'
import { PageShell } from '../components/PageShell'
import { useDialog } from '../ui/DialogProvider'

// ★ フェーズ1の動作確認用の、仮の画面。フェーズ2（ルーム一覧・トーク画面の移植）で、本物に置き換える。
//   見た目は、わざと作り込んでいない。ログインの共有・ログアウトの伝わり方・ルートの動きを確かめるためのもの。

export function HomePlaceholder() {
	const { userId, logout } = useAuth()
	const dialog = useDialog()
	return (
		<PageShell name="login">
			<main>
				<div>
					<p>ルーム一覧（フェーズ2aで移植します）</p>
					<p>ログイン中のID：{userId}</p>
					<p>
						<Link to="/talk/sample-room">トーク画面（仮）へ</Link>
					</p>
					<button
						onClick={async () => {
							if (await dialog.confirm('ログアウトしますか？')) {
								await logout()
								await dialog.alert('ログアウトしました。')
							}
						}}
					>
						ログアウト
					</button>
				</div>
			</main>
		</PageShell>
	)
}

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
