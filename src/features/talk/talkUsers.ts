import { db, doc, getDoc, hedged } from '../../firebase'
import { formatDateTime } from '../../lib/dateFormat'
import { perfSample } from '../../lib/perf'
import { getUserCache, setUserCache } from '../../lib/userCache'

// ★ トーク画面のユーザー情報の取得（既存の talkScript.js の fetchOneUser / fetchAndCacheUsers と同じ）。
//   複数ユーザーの情報を、1人1件の getDoc を「並列」で取得する。
//   以前は "in" クエリ（まとめて1回）だったが、計測で、そのクエリだけが数十秒止まることがあったため、この方式。
//   ・同じIDの取得がすでに進行中なら、その結果を待つだけにして、二重に取得しない。
//   ・デフォルトでは、キャッシュ済みのIDは取得しない。forceRefresh: true で、強制的に最新化する。
//   ・取得のたびに、このトークの「最終確認日時」（メンバー一覧に出す）も更新する。

export interface TalkUsers {
	/** ユーザーID → トークID → 最終確認日時の文字列（なければ ''）。メンバー一覧（⑤）が使う。 */
	lastChecked: Record<string, Record<string, string>>
	fetchAndCacheUsers(userIds: string[], options?: { forceRefresh?: boolean }): Promise<void>
}

export function createTalkUsers(talkId: string): TalkUsers {
	const inflight = new Map<string, Promise<void>>() // userId -> Promise
	const lastChecked: Record<string, Record<string, string>> = {}

	function fetchOneUser(userId: string): Promise<void> {
		const existing = inflight.get(userId)
		if (existing) return existing

		const promise = (async () => {
			const startedAt = performance.now()
			try {
				const snapshot = await hedged(() => getDoc(doc(db, 'users_random', userId)))
				perfSample('ユーザー1人分のgetDoc（並列）', performance.now() - startedAt)

				if (!snapshot.exists()) {
					// 存在しないIDは「不明なユーザー」として確定させておく
					setUserCache(userId, { name: '不明なユーザー', isAdmin: false, imageUrl: '', profileText: '' })
					return
				}
				const userData = snapshot.data()
				setUserCache(userId, {
					name: userData.name || '名前未設定',
					isAdmin: userData.isAdmin || false,
					imageUrl: userData.imageUrl || '',
					profileText: userData.profileText || '',
					prizeGrantedAt: userData.prizeGrantedAt,
				})

				if (talkId) {
					if (!lastChecked[userId]) lastChecked[userId] = {}
					if (userData.lastChecked && userData.lastChecked[talkId]) {
						lastChecked[userId][talkId] = formatDateTime(userData.lastChecked[talkId].toDate())
					} else {
						lastChecked[userId][talkId] = ''
					}
				}
			} catch (error) {
				console.error('ユーザー情報の取得エラー:', userId, error)
			} finally {
				inflight.delete(userId)
			}
		})()

		inflight.set(userId, promise)
		return promise
	}

	async function fetchAndCacheUsers(userIds: string[], options: { forceRefresh?: boolean } = {}): Promise<void> {
		const { forceRefresh = false } = options
		const idsToFetch = Array.from(new Set(userIds)).filter((id) => id && (forceRefresh || !getUserCache(id)))
		if (idsToFetch.length === 0) return
		await Promise.all(idsToFetch.map((id) => fetchOneUser(id)))
	}

	return { lastChecked, fetchAndCacheUsers }
}
