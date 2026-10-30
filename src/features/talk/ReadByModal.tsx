import { useEffect, useState } from 'react'
import { Avatar } from '../../components/Avatar'
import { db, doc, getDoc } from '../../firebase'
import { getUserCache, hasActivePrize, setUserCache, type UserCacheEntry } from '../../lib/userCache'

// ★ 既読の人の一覧（既存の openReadByModal と同じ。キャッシュにいない人だけ、個別に取得する）。

export interface ReadByTarget {
	userIds: string[]
	/** 同じ一覧でも開き直すために、開くたびに変える。 */
	token: number
}

interface Entry {
	userId: string
	cached: UserCacheEntry
}

interface Props {
	target: ReadByTarget | null
	onClose: () => void
	onOpenProfile: (userId: string) => void
}

export function ReadByModal({ target, onClose, onOpenProfile }: Props) {
	const [entries, setEntries] = useState<Entry[] | null>(null) // null の間は「読み込み中...」

	useEffect(() => {
		if (!target) return
		let cancelled = false
		setEntries(null)
		void (async () => {
			const result: Entry[] = []
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

	return (
		<div id="read-modal" className={'modal-overlay' + (target ? '' : ' hidden')}>
			<div className="modal-content">
				<div className="modal-header">
					<p className="title">既読</p>
					<span id="read-modal-close" className="close-button" onClick={onClose}>
						&times;
					</span>
				</div>
				<div className="modal-scroll-body">
					<div id="read-area">
						{entries === null
							? '読み込み中...'
							: entries.map(({ userId, cached }: Entry) => (
									<p key={userId} className="clickable-user" style={{ cursor: 'pointer' }} onClick={() => onOpenProfile(userId)}>
										<Avatar name={cached.name} size="small" imageUrl={cached.imageUrl} />
										<span className={cached.isAdmin ? 'admin' : hasActivePrize(cached) ? 'prize' : undefined}>{cached.name}</span>
									</p>
								))}
					</div>
				</div>
			</div>
		</div>
	)
}
