import type { DocumentData } from 'firebase/firestore'
import { collection, db, doc, getDoc, getDocs, serverTimestamp, Timestamp, updateDoc, writeBatch } from '../../firebase'

// ★ メッセージの編集・削除・転送の書き込み（既存の talkScript.js の newMessageChange / messageDelete / forwardMessageToRoom / handleBulk* と同じ）。
//   Firestoreへの書き込みの形は、既存のまま（Firestoreのルールが依存している。変えないこと）：
//     編集  KokoKengaku/{ルームID}/talk/{ID}  updateDoc  { userId, message, changeLog, [time（管理者のみ）] }
//     削除  同上  updateDoc  { isDisplay: false }   ← 実際には消さず、非表示にする
//     転送  転送先の talk に、複製を batch.set ＋ 転送先ルームに batch.update { lastUpdatedAt }

/** Firestoreのタイムスタンプを、<input type="datetime-local"> 用のローカル日時文字列（YYYY-MM-DDTHH:mm）にする。 */
export function timestampToDatetimeLocalValue(timestamp: { toDate?: () => Date } | null | undefined): string {
	const date = timestamp && typeof timestamp.toDate === 'function' ? timestamp.toDate() : new Date()
	const yyyy = date.getFullYear()
	const mm = String(date.getMonth() + 1).padStart(2, '0')
	const dd = String(date.getDate()).padStart(2, '0')
	const hh = String(date.getHours()).padStart(2, '0')
	const min = String(date.getMinutes()).padStart(2, '0')
	return `${yyyy}-${mm}-${dd}T${hh}:${min}`
}

/** メッセージを編集する。変更前の本文は、changeLog に追記する。送信日時は、管理者が入力したときだけ変える。 */
export async function editMessage(p: {
	talkId: string
	messageId: string
	newUserId: string
	newMessage: string
	/** 管理者のときだけ渡す（一般は null）。 */
	newTimeValue: string | null
	meIsAdmin: boolean
}): Promise<void> {
	const docRef = doc(db, 'KokoKengaku', p.talkId, 'talk', p.messageId)

	// 変更前のメッセージ内容をchangeLogに記録する
	const docSnapshot = await getDoc(docRef)
	const currentData = docSnapshot.data() || {}
	const previousMessage: string = currentData.message || ''
	const existingChangeLog: string[] = Array.isArray(currentData.changeLog) ? currentData.changeLog : []
	const updatedChangeLog = previousMessage !== p.newMessage ? [...existingChangeLog, previousMessage] : existingChangeLog

	const updateData: DocumentData = {
		userId: p.newUserId,
		message: p.newMessage,
		changeLog: updatedChangeLog,
	}

	// 管理者が送信日時を入力していれば、それを新しい time として反映する
	if (p.meIsAdmin && p.newTimeValue) {
		const parsedDate = new Date(p.newTimeValue)
		if (!isNaN(parsedDate.getTime())) {
			updateData.time = Timestamp.fromDate(parsedDate)
		}
	}

	await updateDoc(docRef, updateData)
}

/** メッセージを削除する（実際にはdeleteせず、isDisplayをfalseにして非表示にする）。 */
export async function hideMessage(talkId: string, messageId: string): Promise<void> {
	await updateDoc(doc(db, 'KokoKengaku', talkId, 'talk', messageId), { isDisplay: false })
}

/** 選択した複数のメッセージを、まとめて非表示にする。 */
export async function hideMessages(talkId: string, messageIds: string[]): Promise<void> {
	const batch = writeBatch(db)
	messageIds.forEach((messageId) => {
		batch.update(doc(db, 'KokoKengaku', talkId, 'talk', messageId), { isDisplay: false })
	})
	await batch.commit()
}

/** 転送するメッセージの内容を作る。既読状態・返信先・表示フラグ以外は、送信者や日時も含めて、そのままコピーする。 */
export function makeForwardItem(data: DocumentData): DocumentData {
	const copied = Object.assign({}, data)
	delete copied.readBy
	delete copied.replyTo
	delete copied.isDisplay
	return copied
}

/** 選択中のメッセージの現在の内容を、まとめて取得する（存在するものだけ）。 */
export async function fetchMessageDatas(talkId: string, messageIds: string[]): Promise<DocumentData[]> {
	const docs = await Promise.all(messageIds.map((id) => getDoc(doc(db, 'KokoKengaku', talkId, 'talk', id))))
	return docs.filter((d) => d.exists()).map((d) => d.data() as DocumentData)
}

export interface ForwardRoom {
	id: string
	title: string
}

/** 転送先にできるルーム（いまのルーム以外のすべて）。 */
export async function loadForwardRooms(currentTalkId: string): Promise<ForwardRoom[]> {
	const roomsSnapshot = await getDocs(collection(db, 'KokoKengaku'))
	return roomsSnapshot.docs
		.filter((d) => d.id !== currentTalkId)
		.map((d) => ({ id: d.id, title: d.data().title || '（無題のルーム）' }))
}

/** 選ばれたルームへ、保持しておいた内容（複数可）を、まとめて新しいメッセージとして書き込む（既読・返信先だけリセット）。 */
export async function forwardMessagesToRoom(targetRoomId: string, items: DocumentData[]): Promise<void> {
	const batch = writeBatch(db)
	const targetTalkCollection = collection(db, 'KokoKengaku', targetRoomId, 'talk')

	items.forEach((item) => {
		const newMessageDoc = Object.assign({}, item, {
			readBy: [],
			replyTo: null,
		})
		batch.set(doc(targetTalkCollection), newMessageDoc)
	})

	batch.update(doc(db, 'KokoKengaku', targetRoomId), {
		lastUpdatedAt: serverTimestamp(),
	})

	await batch.commit()
}
