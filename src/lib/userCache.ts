// ★ ユーザーデータの統一キャッシュ（既存の appScript.js / talkScript.js の userDataCache と同じ）。
//   name / isAdmin / imageUrl / profileText / prizeGrantedAt をまとめて保持する。
//   既存のサイトは、ページを開くたびに空から始まっていたので、画面に入るときに resetUserCache() を呼んで、同じ挙動にする。

export interface UserCacheEntry {
	name?: string
	isAdmin?: boolean
	imageUrl?: string
	profileText?: string
	/** 景品を付与した時刻（ミリ秒）。なければ null。 */
	prizeGrantedAt?: number | null
}

type UserCacheInput = Omit<UserCacheEntry, 'prizeGrantedAt'> & { prizeGrantedAt?: unknown }

let userDataCache: Record<string, UserCacheEntry> = {}

export function resetUserCache(): void {
	userDataCache = {}
}

/** Firestoreのタイムスタンプ(またはミリ秒数値)を、比較に使いやすいミリ秒数値へ揃える。 */
export function toMillisOrNull(value: unknown): number | null {
	if (!value) return null
	if (typeof (value as { toMillis?: unknown }).toMillis === 'function') return (value as { toMillis: () => number }).toMillis()
	if (typeof value === 'number') return value
	return null
}

/** 景品(名前が虹色に光る演出)の持続時間。「問題投稿」アプリ側の仕様に合わせて10分間。 */
export const PRIZE_DURATION_MS = 10 * 60 * 1000

/** 景品が、付与されてからまだ持続時間内（＝現在も有効）かどうか。 */
export function hasActivePrize(cached: { prizeGrantedAt?: number | null } | null | undefined): boolean {
	const grantedAt = cached && cached.prizeGrantedAt
	return typeof grantedAt === 'number' && grantedAt + PRIZE_DURATION_MS > Date.now()
}

export function getUserCache(userId: string): UserCacheEntry | null {
	return userDataCache[userId] || null
}

export function setUserCache(userId: string, data: UserCacheInput): UserCacheEntry {
	const normalized: UserCacheEntry = { ...data, prizeGrantedAt: undefined }
	delete normalized.prizeGrantedAt
	if ('prizeGrantedAt' in data) normalized.prizeGrantedAt = toMillisOrNull(data.prizeGrantedAt)
	userDataCache[userId] = { ...(userDataCache[userId] || {}), ...normalized }
	return userDataCache[userId]
}
