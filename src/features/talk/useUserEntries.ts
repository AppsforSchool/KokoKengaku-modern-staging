import { useEffect, useState } from 'react'
import { db, doc, getDoc } from '../../firebase'
import { getUserCache, setUserCache, type UserCacheEntry } from '../../lib/userCache'

// ★ ユーザーIDの一覧を、表示用のユーザー情報（名前・アイコンなど）にする（既読の一覧・アンケートの回答者の一覧が使う）。
//   キャッシュにいない人だけ、1人ずつ取得する（既存の openReadByModal / openPollVotersModal と同じ）。
//   取得が終わるまでは null（画面は、「読み込み中...」を出す）。

export interface UserEntry {
	userId: string
	cached: UserCacheEntry
}

export interface UserListTarget {
	userIds: string[]
	/** 同じ一覧でも開き直すために、開くたびに変える。 */
	token: number
}

export function useUserEntries(target: UserListTarget | null): UserEntry[] | null {
	const [entries, setEntries] = useState<UserEntry[] | null>(null)

	useEffect(() => {
		if (!target) return
		let cancelled = false
		setEntries(null)
		void (async () => {
			const result: UserEntry[] = []
			for (const userId of target.userIds) {
				let cached: UserCacheEntry | null = getUserCache(userId)
				// 万が一キャッシュに載っていないイレギュラーなユーザーIDが含まれていた場合のみ、個別に取得する
				if (!cached) {
					try {
						const userSnapshot = await getDoc(doc(db, 'users_random', userId))
						if (userSnapshot.exists()) {
							const userData = userSnapshot.data()
							cached = setUserCache(userId, {
								name: userData.name || '名前未設定',
								isAdmin: userData.isAdmin || false,
								imageUrl: userData.imageUrl || '',
								profileText: userData.profileText || '',
								prizeGrantedAt: userData.prizeGrantedAt,
							})
						} else {
							cached = setUserCache(userId, { name: '不明なユーザー', isAdmin: false, imageUrl: '', profileText: '' })
						}
					} catch (e) {
						console.error(e)
						cached = { name: '不明なユーザー', isAdmin: false, imageUrl: '' }
					}
				}
				result.push({ userId, cached })
			}
			if (!cancelled) setEntries(result)
		})()
		return () => {
			cancelled = true
		}
	}, [target])

	return entries
}
