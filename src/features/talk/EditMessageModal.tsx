import { useLayoutEffect, useState } from 'react'
import { timestampToDatetimeLocalValue } from './messageActions'

// ★ メッセージの編集モーダル（既存の openEditModal と同じHTML構造・同じ挙動）。
//   ・一般：本文のみ変更できる（送信者の欄は押せず、送信日時の欄は表示されない）。管理者：本文・送信者・送信日時。
//   ・本文が空（空白のみ）のときは、保存できない。
//   ・「保存」は、モーダルを閉じない（既存と同じ）。「削除」は、確認のあと、閉じる。

export interface EditTarget {
	messageId: string
	userId: string
	message: string
	time: { toDate?: () => Date } | null | undefined
	/** 同じメッセージでも開き直すために、開くたびに変える。 */
	token: number
}

interface Props {
	target: EditTarget | null
	meIsAdmin: boolean
	onClose: () => void
	onSave: (messageId: string, newUserId: string, newMessage: string, newTimeValue: string | null) => Promise<void>
	onDelete: (messageId: string) => Promise<void>
}

export function EditMessageModal({ target, meIsAdmin, onClose, onSave, onDelete }: Props) {
	const [userId, setUserId] = useState('')
	const [message, setMessage] = useState('')
	const [timeValue, setTimeValue] = useState('')

	// 開くたびに、対象のメッセージの内容を入れる
	useLayoutEffect(() => {
		if (!target) return
		setUserId(target.userId)
		setMessage(target.message)
		setTimeValue(timestampToDatetimeLocalValue(target.time))
	}, [target])

	return (
		<div id="edit-modal" className={'modal-overlay' + (target ? '' : ' hidden')}>
			<div className="modal-content">
				<div className="modal-header">
					<p className="title">編集</p>
					<span id="edit-modal-close" className="close-button" onClick={onClose}>
						&times;
					</span>
				</div>
				<div className="modal-scroll-body">
					<input id="new-userId-input" placeholder="user id" value={userId} disabled={!meIsAdmin} onChange={(e) => setUserId(e.target.value)} />
					<textarea id="new-message-input" rows={5} value={message} onChange={(e) => setMessage(e.target.value)}></textarea>
					<p id="new-message-time-label" className={'profile-label' + (meIsAdmin ? '' : ' hidden')} style={{ marginTop: '0.5rem' }}>
						送信日時（管理者のみ編集可）
					</p>
					<input
						id="new-message-time-input"
						type="datetime-local"
						className={meIsAdmin ? undefined : 'hidden'}
						value={timeValue}
						onChange={(e) => setTimeValue(e.target.value)}
					/>
					<button
						id="new-message-change-button"
						disabled={message.trim() === ''}
						onClick={() => {
							if (!target) return
							// 送信時刻の変更は管理者のみ反映する
							void onSave(target.messageId, userId, message, meIsAdmin ? timeValue : null)
						}}
					>
						保存
					</button>
					<span className="split-line"></span>
					<button id="message-delete-button" onClick={() => target && void onDelete(target.messageId)}>
						削除
					</button>
				</div>
			</div>
		</div>
	)
}
