import { Avatar } from '../../components/Avatar'
import { hasActivePrize } from '../../lib/userCache'
import { useUserEntries, type UserEntry, type UserListTarget } from './useUserEntries'

// ★ 既読の人の一覧（既存の openReadByModal と同じ）。

export type ReadByTarget = UserListTarget

interface Props {
	target: ReadByTarget | null
	onClose: () => void
	onOpenProfile: (userId: string) => void
}

export function ReadByModal({ target, onClose, onOpenProfile }: Props) {
	const entries = useUserEntries(target) // null の間は「読み込み中...」

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
							: entries.map(({ userId, cached }: UserEntry) => (
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
