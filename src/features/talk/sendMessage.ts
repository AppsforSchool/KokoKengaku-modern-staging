import { addDoc, collection, db, doc, serverTimestamp, updateDoc } from '../../firebase'
import { sendMessageNotification, sendPushToUsers } from '../../lib/push'
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

/** アンケートを送る。質問文は message に、選択肢は choices に、回答は answer（ユーザーID → 選んだ番号）に入る。 */
export async function sendPollMessage(p: {
	talkId: string
	myUserId: string
	question: string
	choices: string[]
	replyTo: string | null
}): Promise<void> {
	await addDoc(collection(db, 'KokoKengaku', p.talkId, 'talk'), {
		userId: p.myUserId,
		message: p.question,
		choices: p.choices,
		answer: {},
		readBy: [],
		replyTo: p.replyTo || null,
		time: serverTimestamp(),
	})
	await updateDoc(doc(db, 'KokoKengaku', p.talkId), {
		lastUpdatedAt: serverTimestamp(),
	})
}

/** アンケートに回答（または回答を変更）する。自分の分（answer.{ユーザーID}）だけを書き込む。 */
export async function votePoll(p: { talkId: string; myUserId: string; messageId: string; selectedIndex: number }): Promise<void> {
	await updateDoc(doc(db, 'KokoKengaku', p.talkId, 'talk', p.messageId), {
		[`answer.${p.myUserId}`]: p.selectedIndex,
	})
}

/** アンケートに回答（または回答を変更）したことを、トークルームの全メンバー（本人を除く）に通知する。 */
export function notifyPollAnswer(p: {
	talkId: string
	myUserId: string
	myName: string
	roomTitle: string
	memberIds: string[]
	isChange: boolean
}): Promise<void> {
	const name = p.myName
	return sendPushToUsers(db, {
		targetIds: (p.memberIds || []).filter((id) => id && id !== p.myUserId),
		title: p.roomTitle ? `${p.roomTitle}|${name}` : name,
		body: p.isChange ? `${name}がアンケートの回答を変更しました` : `${name}がアンケートに回答しました`,
		url: `talk.html?id=${encodeURIComponent(p.talkId)}`,
	})
}
