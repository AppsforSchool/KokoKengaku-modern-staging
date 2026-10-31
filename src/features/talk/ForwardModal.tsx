import { useEffect, useRef, useState } from 'react'
import { loadForwardRooms, type ForwardRoom } from './messageActions'
import { useDialog } from '../../ui/DialogProvider'

// ★ 転送先ルームの選択モーダル（管理者のみ。既存の openForwardModal / forwardMessageToRoom と同じ）。
//   ・開くと、転送先にできるルーム（いまのルーム以外のすべて）を読み込んで並べる。タップすると、そのルームへ転送する。
//   ・転送中は、一覧を操作できなくし、選んだルームの名前に「（転送中...）」を付ける。失敗したら、ダイアログで知らせて、やり直せる。

export interface ForwardTarget {
	/** 転送するメッセージの内容（readBy・replyTo・isDisplay は、取り除き済み）。 */
	items: Record<string, unknown>[]
	/** 開くたびに変える。 */
	token: number
}

interface Props {
	talkId: string
	target: ForwardTarget | null
	onClose: () => void
	/** 転送する。成功したら、モーダルを閉じて、案内を出すところまで、呼び出し側が行う。失敗したら例外を投げる。 */
	onForward: (targetRoomId: string, items: Record<string, unknown>[]) => Promise<void>
}

export function ForwardModal({ talkId, target, onClose, onForward }: Props) {
	const dialog = useDialog()
	const [loading, setLoading] = useState(true)
	const [rooms, setRooms] = useState<ForwardRoom[]>([])
	const [forwardingId, setForwardingId] = useState<string | null>(null)
	const runId = useRef(0)

	useEffect(() => {
		if (!target) return
		const myRun = ++runId.current
		setRooms([])
		setForwardingId(null)
		setLoading(true)
		void (async () => {
			try {
				const list = await loadForwardRooms(talkId)
				if (myRun !== runId.current) return
				setRooms(list)
				setLoading(false)
			} catch (error) {
				if (myRun !== runId.current) return
				setLoading(false)
				console.error('転送先ルーム一覧の取得エラー:', error)
				await dialog.alert('転送先ルームの取得に失敗しました。\n' + (error instanceof Error ? error.message : String(error)))
			}
		})()
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [target])

	const handleSelect = async (room: ForwardRoom) => {
		if (!target || target.items.length === 0 || forwardingId) return
		setForwardingId(room.id) // 二重送信防止（クリック直後に一覧全体を操作不能にする）
		try {
			await onForward(room.id, target.items)
		} catch (error) {
			console.error('メッセージ転送エラー:', error)
			await dialog.alert('転送に失敗しました。\n' + (error instanceof Error ? error.message : String(error)))
			setForwardingId(null)
		}
	}

	return (
		<div id="forward-modal" className={'modal-overlay' + (target ? '' : ' hidden')}>
			<div className="modal-content">
				<div className="modal-header">
					<p className="title">メッセージを転送</p>
					<span id="forward-modal-close" className="close-button" onClick={onClose}>
						&times;
					</span>
				</div>
				<div className="modal-scroll-body">
					<p id="forward-modal-loading" className={loading ? undefined : 'hidden'}>
						読み込み中...
					</p>
					<div id="forward-room-list">
						{!loading && rooms.length === 0 && <p>転送できるトークルームがありません。</p>}
						{rooms.map((room) => (
							<div
								key={room.id}
								className="forward-room-item"
								style={forwardingId ? { pointerEvents: 'none' } : undefined}
								onClick={() => void handleSelect(room)}
							>
								{room.title + (forwardingId === room.id ? '（転送中...）' : '')}
							</div>
						))}
					</div>
				</div>
			</div>
		</div>
	)
}
