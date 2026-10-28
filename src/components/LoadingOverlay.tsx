import { useEffect, useState, type CSSProperties } from 'react'
import { perfWatchStall } from '../lib/perf'
import { probeEnvironment, resetLoginState } from '../lib/recover'
import { useDialog } from '../ui/DialogProvider'

// ★ 読み込み中の全面表示（既存の #loading-overlay と同じHTML構造）。
//   ・text … 段階を示す文言。percent を渡すと、その下に進捗バーを出す（0〜100）。
//   ・watchStall … 読み込みが12秒たっても終わらないとき、「どの段階で止まっているか」を表示し、
//     「ログイン情報をリセットして再試行」ボタンを出す（既存の perfWatchStall + attachRecoveryButton と同じ）。

const RECOVER_BUTTON_STYLE: CSSProperties = {
	marginTop: '1rem',
	padding: '.7rem 1.2rem',
	font: 'inherit',
	fontWeight: 700,
	border: 'none',
	borderRadius: '999px',
	background: '#fff',
	color: '#24303d',
	cursor: 'pointer',
	maxWidth: '90%',
}

function RecoveryButton() {
	const dialog = useDialog()
	const [busy, setBusy] = useState(false)
	return (
		<button
			id="recover-button"
			type="button"
			style={RECOVER_BUTTON_STYLE}
			disabled={busy}
			onClick={async () => {
				const ok = await dialog.confirm(
					'このブラウザに保存されているログイン情報を消して、ログイン画面に戻ります。\nよろしいですか？',
				)
				if (!ok) return
				setBusy(true)
				await resetLoginState()
			}}
		>
			{busy ? 'リセット中...' : 'ログイン情報をリセットして再試行'}
		</button>
	)
}

interface Props {
	text: string
	percent?: number
	hidden?: boolean
	watchStall?: boolean
}

export function LoadingOverlay({ text, percent, hidden = false, watchStall = false }: Props) {
	const [stallText, setStallText] = useState<string | null>(null)
	const [stalled, setStalled] = useState(false) // 復旧ボタンは、一度出たら残す（既存の attachRecoveryButton と同じ）

	// 段階の文言が更新されたら、停止の表示は、そちらで上書きされる（次の5秒おきの確認で、また出る）
	useEffect(() => {
		setStallText(null)
	}, [text])

	useEffect(() => {
		if (!watchStall || hidden) return
		let envText = ''
		return perfWatchStall(
			() => false, // 終わったら、このコンポーネントが外れて、後片付けで止まる
			(seconds, label) => {
				setStalled(true)
				setStallText(
					`読み込みに時間がかかっています（${seconds}秒経過）／最後に完了した段階: ${label}${envText ? '／' + envText : ''}`,
				)
				if (!envText) {
					envText = 'ブラウザ状態を確認中...'
					void probeEnvironment().then((t) => {
						envText = t
					})
				}
			},
		)
	}, [watchStall, hidden])

	const clamped = typeof percent === 'number' ? Math.max(0, Math.min(100, percent)) : null

	return (
		<div id="loading-overlay" className={hidden ? 'hidden' : undefined}>
			<h1>loading...</h1>
			<p id="loading-overlay-text">{stallText ?? text}</p>
			{clamped !== null && (
				<div id="loading-progress-bar" className="loading-progress-bar">
					<div id="loading-progress-bar-fill" className="loading-progress-bar-fill" style={{ width: `${clamped}%` }}></div>
				</div>
			)}
			{stalled && <RecoveryButton />}
		</div>
	)
}
