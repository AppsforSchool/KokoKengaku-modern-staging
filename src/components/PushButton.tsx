import { useEffect, useState } from 'react'
import {
	getPushSubscription,
	isPushEnabled,
	optInToPush,
	waitForPushInit,
	waitForPushInitIfStarted,
} from '../lib/push'
import { useDialog } from '../ui/DialogProvider'

/**
 * 「通知をオンにする」ボタン（既存の notify.js の setupPushButton と同じ挙動。ドロワーに置く）。
 * ボタンは「実際に購読まで完了したとき」だけ隠す（許可済みでも登録が未完了なら、再試行できるようにする）。
 * ※ 既存のコメントのとおり、.normal-button の display:block が .hidden より後に定義されていて .hidden が効かないため、
 *   表示/非表示は inline style（display）で直接切り替える。
 */
const RETRY_TEXT = '通知の登録をやり直す'

export function PushButton({ defaultText = '通知をオンにする' }: { defaultText?: string }) {
	const dialog = useDialog()
	const [visible, setVisible] = useState(true)
	const [label, setLabel] = useState(defaultText)
	const [disabled, setDisabled] = useState(false)

	// 最初に、いまの購読状態から、ボタンを出すかどうかを決める
	useEffect(() => {
		let cancelled = false
		void (async () => {
			try {
				if (!isPushEnabled()) {
					if (!cancelled) setVisible(true)
					return
				}
				await waitForPushInitIfStarted()
				const sub = await getPushSubscription()
				if (cancelled) return
				setVisible(!sub.optedIn)
				if (!sub.optedIn) setLabel(RETRY_TEXT)
			} catch (e) {
				console.warn(e)
				if (cancelled) return
				setVisible(true)
				setLabel(RETRY_TEXT)
			}
		})()
		return () => {
			cancelled = true
		}
	}, [])

	const handleClick = async () => {
		if (typeof Notification === 'undefined') {
			await dialog.alert(
				'この環境では通知を利用できません。\niPhoneの場合は、Safariの共有ボタンから「ホーム画面に追加」して、追加したアイコンから開いてください。',
			)
			return
		}
		if (Notification.permission === 'denied') {
			await dialog.alert('通知がブロックされています。\n端末（またはブラウザ）の設定から、このサイトの通知を許可してください。')
			return
		}

		setDisabled(true)
		let subscribed = false
		try {
			// ① ユーザー操作の直後に、まずブラウザ標準の許可ダイアログを出す（iOSはこの順序が重要）
			if (Notification.permission !== 'granted') {
				setLabel('許可を確認中...')
				const permission = await Notification.requestPermission()
				if (permission !== 'granted') {
					await dialog.alert('通知が許可されませんでした。')
					return
				}
			}

			// ② OneSignal側の初期化を待つ（前回失敗していれば再試行）
			setLabel('OneSignalを準備中...')
			await waitForPushInit()

			// ③ この端末を購読状態にする
			setLabel('購読を登録中...')
			await optInToPush()

			const sub = await getPushSubscription()
			subscribed = sub.optedIn

			// ダイアログを出す前にボタンの見た目を確定させる
			setDisabled(false)
			setVisible(!subscribed)
			setLabel(isPushEnabled() ? RETRY_TEXT : defaultText)

			await dialog.alert(
				subscribed
					? '通知をオンにしました。'
					: '許可はされましたが、購読の登録が完了していません。\nもう一度ボタンを押してください。',
			)
		} catch (e) {
			console.error(e)
			setDisabled(false)
			setVisible(true)
			setLabel(isPushEnabled() ? RETRY_TEXT : defaultText)
			await dialog.alert('通知の設定に失敗しました。\n\n' + (e instanceof Error ? e.message : String(e)))
		} finally {
			// 途中で return した場合（許可されなかった等）の後始末
			setDisabled(false)
			if (!subscribed) {
				setVisible(true)
				setLabel(isPushEnabled() ? RETRY_TEXT : defaultText)
			}
		}
	}

	return (
		<button
			id="enable-push-button"
			className="normal-button"
			style={{ marginBottom: '1rem', display: visible ? '' : 'none' }}
			disabled={disabled}
			onClick={() => void handleClick()}
		>
			{label}
		</button>
	)
}
