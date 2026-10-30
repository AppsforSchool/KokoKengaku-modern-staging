import type { ReactNode } from 'react'

// ★ トーク画面で、画面に出すメッセージ1件分の情報。
//   既存は、メッセージが「追加・変更」されたときだけ、その分のDOMを作り直していた（変化のないメッセージは、作った時点のまま）。
//   同じ挙動にするため、追加・変更のときに、この形（作った時点の送信者名・返信元など）を作って保持し、画面は、これをそのまま表示する。

export interface ReplyContextView {
	/** 返信元が見つからないとき true（「元のメッセージは見つかりません」を出す）。 */
	missing: boolean
	label: string
	/** 返信元が自分のものなら 'own'（青）、そうでなければ 'other'（薄いグレー）。 */
	tone: 'own' | 'other'
	snippet: string
	targetId: string
}

export interface MessageView {
	id: string
	isOwn: boolean
	userId: string | undefined
	senderName: string
	senderIsAdmin: boolean
	senderHasPrize: boolean
	senderImageUrl: string
	displayTime: string
	readBy: string[]
	reply: ReplyContextView | null
	imageUrl: string
	hasText: boolean
	/** 本文（許可したタグだけを残した表示用）。 */
	textNode: ReactNode
	/** 以降の機能（アンケート・編集など）が使う、Firestoreの元データ。 */
	data: MessageData
}

export interface MessageData {
	userId?: string
	message?: string
	time?: { toDate(): Date }
	readBy?: string[]
	replyTo?: string
	imageUrl?: string
	choices?: string[]
	answer?: Record<string, unknown>
	isDisplay?: boolean
	[key: string]: unknown
}
