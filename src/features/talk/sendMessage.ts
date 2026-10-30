import { addDoc, collection, db, doc, serverTimestamp, updateDoc } from '../../firebase'
import { sendMessageNotification } from '../../lib/push'
import { getUserCache } from '../../lib/userCache'
import { stripTagsToPlainText } from './messageText'
import type { MessageData } from './types'

// ★ メッセージの送信と、新着通知（既存の talkScript.js の addMessage / 画像送信 / notifyRoom と同じ）。
//   Firestoreへの書き込みの形は、既存のまま（Firestoreのルールが依存している。変えないこと）：
//     KokoKengaku/{ルームID}/talk  addDoc  { userId, message, [imageUrl], readBy: [], replyTo, time: serverTimestamp() }
//     KokoKengaku/{ルームID}       updateDoc  { lastUpdatedAt: serverTimestamp() }   ← ルーム一覧の並び順・未読数のため

/** 本文のメッセージを送る。 */
export async function sendTextMessage(p: { talkId: string; myUserId: string; message: string; replyTo: string | null }): Promise<void> {
	await addDoc(collection(db, 'KokoKengaku', p.talkId, 'talk'), {
		userId: p.myUserId,
		message: p.message,
		readBy: [],
		replyTo: p.replyTo || null,
		time: serverTimestamp(),
	})
	await updateDoc(doc(db, 'KokoKengaku', p.talkId), {
		lastUpdatedAt: serverTimestamp(),
	})
}

/** 画像（キャプション付き）のメッセージを送る。画像は、アップロード済みのURLを渡す。 */
export async function sendImageMessage(p: {
	talkId: string
	myUserId: string
	caption: string
	imageUrl: string
	replyTo: string | null
}): Promise<void> {
	await addDoc(collection(db, 'KokoKengaku', p.talkId, 'talk'), {
		userId: p.myUserId,
		message: p.caption,
		imageUrl: p.imageUrl,
		readBy: [],
		replyTo: p.replyTo || null,
		time: serverTimestamp(),
	})
	// ルーム一覧側の未読カウント・並び順のためにlastUpdatedAtも更新
	await updateDoc(doc(db, 'KokoKengaku', p.talkId), {
		lastUpdatedAt: serverTimestamp(),
	})
}

export interface NotifyRoomParams {
	talkId: string
	myUserId: string
	myName: string
	/** 通知のタイトルに使うルーム名。個人トークは ''（送信者名だけの通知にする）。 */
	roomTitle: string
	/** ルームのメンバー全員（自分を含む。通知の宛先は、送信側で自分を除く）。 */
	memberIds: string[]
	text: string
	replyTargetId: string | null
	/** 返信先のメッセージの元データを調べる。 */
	getMessage: (id: string) => MessageData | undefined
}

/** 現在のトークルームのメンバー（自分以外）へ新着通知を送る。失敗しても送信処理には影響しない（待たない）。 */
export function notifyRoom(p: NotifyRoomParams): Promise<void> {
	// 返信メッセージなら、返信先の投稿者（ユーザーID・表示名）を調べて通知文に使う
	let replyToUserId: string | null = null
	let replyToName = ''
	if (p.replyTargetId) {
		const target = p.getMessage(p.replyTargetId)
		if (target) {
			replyToUserId = target.userId || null
			replyToName = (getUserCache(target.userId || '') || {}).name || target.userId || ''
		}
	}
	return sendMessageNotification(db, {
		roomId: p.talkId,
		roomTitle: p.roomTitle,
		memberIds: p.memberIds,
		senderId: p.myUserId,
		senderName: p.myName,
		text: stripTagsToPlainText(p.text), // <link>・<a>・<large> などのタグは、通知には出さず、文字だけを送る
		replyToUserId,
		replyToName,
	})
}
