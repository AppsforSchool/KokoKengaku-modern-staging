// ★ ルーム一覧の、並べ方・分類の決まり（既存の appScript.js と同じ）。

/** 更新日時（ミリ秒）から「今日」「昨日」などの見出しを決める時の、見出しの並び順。 */
export const TALK_GROUP_ORDER = ['今日', '昨日', '1週間前', '1ヶ月前', 'それ以前'] as const

/** 更新日時（ミリ秒）から「今日」「昨日」などのグループ名を決める。 */
export function getDateGroupLabel(millis: number): string {
	if (!millis) return 'それ以前'

	const now = new Date()
	const target = new Date(millis)

	// 時刻を無視して「日」単位の差で判定する
	const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate())
	const startOfTarget = new Date(target.getFullYear(), target.getMonth(), target.getDate())
	const daysAgo = Math.round((startOfToday.getTime() - startOfTarget.getTime()) / (1000 * 60 * 60 * 24))

	if (daysAgo <= 0) return '今日'
	if (daysAgo === 1) return '昨日'
	if (daysAgo <= 6) return '1週間前'
	if (daysAgo <= 29) return '1ヶ月前'
	return 'それ以前'
}

export type RoomCategory = 'self' | 'personal' | 'group'

/** メンバー1人 = 自分のみのトーク / 2人 = 個人トーク / 3人以上 = グループ（人数だけで分類する）。 */
export function getRoomCategory(members: string[] | undefined): RoomCategory {
	const count = (members || []).length
	if (count <= 1) return 'self'
	if (count === 2) return 'personal'
	return 'group'
}

/**
 * この端末のユーザーに見せてよいルームか。
 * 自分が入っていれば表示。管理者は、自分が入っていなくてもグループ(3人以上)だけ閲覧できる
 * （他人同士の個人トークは管理者でも表示しない）。
 */
export function isRoomVisibleForMe(members: string[] | undefined, myUserId: string, meIsAdmin: boolean): boolean {
	const list = members || []
	if (list.includes(myUserId)) return true
	return meIsAdmin && list.length >= 3
}

export interface RoomMeta {
	category: RoomCategory
	/** 個人トークの相手のID（グループは空）。 */
	partnerId: string
	title: string
	imageUrl: string
	/** 個人タブの並べ替え用。まだサーバーに反映されていない書き込みは、いまの時刻にする。 */
	lastUpdatedAtMs: number
	/** グループの並べ替え用。未設定は 0（＝いちばん古い扱い）。 */
	groupUpdatedAtMs: number
}

export interface UserListItem {
	userId: string
	name: string
	isActive: boolean
	no: number
}

export interface PersonalRoom extends RoomMeta {
	roomId: string
}

/** 相手ごとに、いちばん新しい個人ルームを1つ選ぶ（既存の renderPersonalList の前半）。 */
export function pickRoomByPartner(rooms: Record<string, RoomMeta>): Record<string, PersonalRoom> {
	const roomByPartner: Record<string, PersonalRoom> = {}
	Object.keys(rooms).forEach((roomId) => {
		const meta = rooms[roomId]
		if (meta.category === 'group') return
		const current = roomByPartner[meta.partnerId]
		if (!current || meta.lastUpdatedAtMs > current.lastUpdatedAtMs) {
			roomByPartner[meta.partnerId] = { roomId, ...meta }
		}
	})
	return roomByPartner
}
