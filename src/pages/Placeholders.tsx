import { useEffect } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useAuth } from '../auth/AuthProvider'
import { PageShell } from '../components/PageShell'
import { PushButton } from '../components/PushButton'
import { db, doc, getDoc, hedged } from '../firebase'
import { runFirestoreDiagnostics } from '../lib/diag'
import { perfMark, perfNotifyReportAvailable } from '../lib/perf'
import { notifyPageLoadFinished, sendPushToUsers, startPush } from '../lib/push'
import { useDialog } from '../ui/DialogProvider'

// ★ フェーズ1の動作確認用の、仮の画面。フェーズ2（ルーム一覧・トーク画面の移植）で、本物に置き換える。
//   見た目は、わざと作り込んでいない。ログインの共有・ログアウトの伝わり方・ルートの動きを確かめるためのもの。

export function HomePlaceholder() {
	const { userId, logout } = useAuth()
	const dialog = useDialog()

	// ★ フェーズ1bの動作確認用：本物のルーム一覧が、同じ順序でやることの、仮の版
	//   自分のユーザー情報の取得 → 通知の初期化（並行）→ 読み込み完了 → 管理者に「計測結果をみる」
	useEffect(() => {
		if (!userId) return
		let cancelled = false
		void (async () => {
			const snap = await hedged(() => getDoc(doc(db, 'users_random', userId)))
			perfMark('自分のユーザー情報の取得（Firestore）')
			const isAdmin = !!(snap.data() || {}).isAdmin
			if (cancelled) return
			startPush(userId)
			notifyPageLoadFinished()
			perfNotifyReportAvailable({
				isAdmin,
				page: 'ルーム一覧（仮）',
				diagnostics: () => runFirestoreDiagnostics(userId),
			})
		})()
		return () => {
			cancelled = true
		}
	}, [userId])

	return (
		<PageShell name="login">
			<main>
				<div>
					<p>ルーム一覧（フェーズ2aで移植します）</p>
					<p>ログイン中のID：{userId}</p>
					<PushButton />
					<p>
						<button
							onClick={async () => {
								if (!userId) return
								await sendPushToUsers(db, { targetIds: [userId], title: 'テスト通知', body: '自分宛のテストです', url: 'app.html' })
								await dialog.alert('自分宛にテスト通知を送りました。')
							}}
						>
							自分にテスト通知を送る（仮）
						</button>
					</p>
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
